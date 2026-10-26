import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Stripe webhook signature verification.
 *
 * A pure function over the raw body, the header and the secret, so that it can
 * be tested against known-good and tampered inputs rather than asserted from
 * reading. The route is a thin shell around it.
 *
 * Why hand-rolled rather than `stripe.webhooks.constructEvent`: the scheme is
 * one HMAC and a timestamp comparison, and pulling in the SDK for it would
 * mean trusting a dependency tree to do a thing that is eight lines. The three
 * properties that make it sound are each enforced below and each has a test:
 *
 *   1. The signature covers `${timestamp}.${rawBody}` — the *raw* bytes, not a
 *      re-serialised object. A route that parses the JSON first and re-encodes
 *      it verifies a signature over a document Stripe never signed.
 *   2. The comparison is timing-safe. A byte-by-byte early exit lets an
 *      attacker recover a valid signature one byte at a time.
 *   3. The timestamp is bounded. Without it, any signed body Stripe ever sent
 *      can be replayed for ever — and `payment_intent.payment_failed` replayed
 *      against a later order is a cancellation.
 *
 * Replay *within* the tolerance window is not this function's job: the handler
 * claims the event id in `IdempotencyKey`, so a redelivery is a no-op.
 */
export const SIGNATURE_TOLERANCE_SECONDS = 300

export type SignatureFailure =
  | 'missing_signature'
  | 'malformed_signature'
  | 'timestamp_outside_tolerance'
  | 'signature_mismatch'

export type SignatureCheck = { ok: true } | { ok: false; reason: SignatureFailure }

/** Parses `t=…,v1=…,v1=…`. Stripe may send several `v1` during a secret roll. */
function parseHeader(header: string): { timestamp: number; signatures: string[] } | null {
  let timestamp: number | null = null
  const signatures: string[] = []

  for (const part of header.split(',')) {
    const index = part.indexOf('=')
    if (index < 1) continue
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (key === 't') {
      if (!/^\d{1,15}$/.test(value)) return null
      timestamp = Number(value)
    } else if (key === 'v1') {
      if (/^[0-9a-f]{64}$/.test(value)) signatures.push(value)
    }
  }

  if (timestamp === null || signatures.length === 0) return null
  return { timestamp, signatures }
}

export function signPayload(secret: string, timestamp: number, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
}

export function verifyStripeSignature(input: {
  rawBody: string
  header: string | null
  secret: string
  now?: Date
  toleranceSeconds?: number
}): SignatureCheck {
  if (!input.header) return { ok: false, reason: 'missing_signature' }
  if (!input.secret) {
    // An empty secret would make the HMAC computable by anyone. Treated as a
    // mismatch rather than thrown, so a misconfigured deployment rejects
    // webhooks instead of 500ing on every one.
    return { ok: false, reason: 'signature_mismatch' }
  }

  const parsed = parseHeader(input.header)
  if (!parsed) return { ok: false, reason: 'malformed_signature' }

  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000)
  const tolerance = input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS
  if (Math.abs(nowSeconds - parsed.timestamp) > tolerance) {
    return { ok: false, reason: 'timestamp_outside_tolerance' }
  }

  const expected = Buffer.from(signPayload(input.secret, parsed.timestamp, input.rawBody), 'hex')
  for (const signature of parsed.signatures) {
    const candidate = Buffer.from(signature, 'hex')
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      return { ok: true }
    }
  }

  return { ok: false, reason: 'signature_mismatch' }
}

/** The subset of a Stripe event this build acts on. */
export interface StripePaymentEvent {
  id: string
  type: string
  paymentIntentId: string
  /** Stripe's own failure code, where it sent one. */
  failureCode: string | null
  /**
   * What the provider says it reversed, in minor units.
   *
   * Set on a refund or a dispute, where the amount is the point and is not
   * necessarily the order total — a partial refund is a partial reversal. Null
   * on a payment failure, where nothing was ever taken.
   */
  reversedMinor: number | null
  /** The currency of `reversedMinor`, upper-cased. */
  reversedCurrency: string | null
}

/**
 * Narrows a verified event body to the fields the handler uses.
 *
 * Returns null for anything else, including an event whose payload does not
 * contain a payment-intent id — a shape change at Stripe should make ARC do
 * nothing, not make it guess which order an event is about.
 *
 * ## Two event families, two places the intent id lives
 *
 * A `payment_intent.*` event's object **is** the intent, so the id is the
 * object's own. A `charge.*` or `charge.dispute.*` event's object *references*
 * one through `payment_intent`, which is a field in a payload an attacker
 * cannot forge (the signature covers it) but which does point at a different
 * row than the object itself.
 *
 * That difference used to be the reason only the first family was read at all.
 * It is now read from `payment_intent` explicitly, and shape-checked the same
 * way, because the alternative — ignoring every refund and chargeback — meant
 * a guest could get their money back at Stripe and keep the boat seat for
 * ever. What stops the reference being dangerous is not where it comes from
 * but what the handler is allowed to *do* with it: a refund or dispute event
 * records a report and opens an approval. It cancels nothing. See ADR-033.
 */
export function readPaymentEvent(body: unknown): StripePaymentEvent | null {
  if (body === null || typeof body !== 'object') return null
  const event = body as Record<string, unknown>

  if (typeof event.id !== 'string' || typeof event.type !== 'string') return null

  const data = event.data as Record<string, unknown> | undefined
  const object = data?.object as Record<string, unknown> | undefined
  if (!object) return null

  const intentId = paymentIntentIdFor(event.type, object)
  if (!intentId) return null

  const lastError = object.last_payment_error as Record<string, unknown> | undefined
  const failureCode = typeof lastError?.code === 'string' ? lastError.code : null

  const reversal = reversedAmountFor(event.type, object)

  return {
    id: event.id,
    type: event.type,
    paymentIntentId: intentId,
    failureCode,
    reversedMinor: reversal?.amountMinor ?? null,
    reversedCurrency: reversal?.currency ?? null,
  }
}

/** The intent this event is about, from whichever field holds it. */
function paymentIntentIdFor(type: string, object: Record<string, unknown>): string | null {
  const looksLikeAnIntent = (value: unknown): value is string =>
    typeof value === 'string' && /^pi_[A-Za-z0-9_]{8,200}$/.test(value)

  if (type.startsWith('payment_intent.')) {
    return looksLikeAnIntent(object.id) ? object.id : null
  }

  if (type.startsWith('charge.')) {
    // `payment_intent` can be an expanded object rather than a string id,
    // depending on the account's API version and expansion settings.
    const field = object.payment_intent
    if (looksLikeAnIntent(field)) return field
    if (field !== null && typeof field === 'object') {
      const nested = (field as Record<string, unknown>).id
      return looksLikeAnIntent(nested) ? nested : null
    }
    return null
  }

  return null
}

/**
 * How much the provider says went back, for the event types where that is the
 * substance of the message.
 *
 * `charge.refunded` carries `amount_refunded` on the charge — the cumulative
 * total refunded, which is the number that matters: two partial refunds
 * produce two events and the second one's cumulative figure is the whole
 * story. A dispute's `amount` is what is being challenged.
 */
function reversedAmountFor(
  type: string,
  object: Record<string, unknown>,
): { amountMinor: number; currency: string } | null {
  const currency = typeof object.currency === 'string' ? object.currency.toUpperCase() : null
  if (!currency) return null

  if (type === 'charge.refunded') {
    const refunded = object.amount_refunded
    return typeof refunded === 'number' && refunded > 0
      ? { amountMinor: refunded, currency }
      : null
  }

  if (type.startsWith('charge.dispute.')) {
    const amount = object.amount
    return typeof amount === 'number' && amount > 0 ? { amountMinor: amount, currency } : null
  }

  return null
}

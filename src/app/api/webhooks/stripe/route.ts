import { NextResponse } from 'next/server'
import { AppError } from '@/lib/errors'
import { getEnv } from '@/lib/env'
import { consumeRateLimit } from '@/lib/rate-limit'
import { applyPaymentEvent } from '@/modules/commerce/payment-events'
import { readPaymentEvent, verifyStripeSignature } from '@/modules/integrations/stripe-webhook'

/**
 * Stripe's webhook endpoint.
 *
 * A thin shell: verify, narrow, hand to the service. Everything that decides
 * anything lives in `modules/commerce/payment-events`, which is why this file
 * has no business rules in it.
 *
 * Four things it is careful about:
 *
 *   1. **The raw body.** `request.text()` is read once and the signature is
 *      checked over those bytes. Parsing first and re-serialising would verify
 *      a signature over a document Stripe never signed.
 *   2. **Not existing in demo mode.** While `ARC_DATA_MODE=demo` there is no
 *      live provider and no real payment, so an endpoint that could fail an
 *      order is a liability with no purpose. It 404s.
 *   3. **Status codes Stripe reads.** A bad signature is 400 and will not be
 *      retried. A genuine server fault is 500 and will be, which is what we
 *      want: redelivery is safe because the handler is idempotent.
 *   4. **Saying nothing.** The response body carries no order reference, no
 *      amount and no reason. The caller is unauthenticated until the signature
 *      passes, and an error message is an oracle.
 */
export const dynamic = 'force-dynamic'

/** A Stripe event is a few kilobytes. */
const MAX_BODY_BYTES = 256_000

/**
 * Unsigned requests that reach the HMAC per minute.
 *
 * The HMAC itself is cheap, but each request also costs a connection and a
 * log line, and the endpoint is necessarily public. Keyed by nothing but the
 * route: Stripe's own delivery volume sits far below this, and a per-IP key
 * would be the attacker's to choose.
 */
const EVENTS_PER_MINUTE = 600

export async function POST(request: Request): Promise<NextResponse> {
  const env = getEnv()

  if (env.ARC_DATA_MODE === 'demo' || env.PAYMENTS_PROVIDER !== 'stripe') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const budget = await consumeRateLimit({
    bucket: 'webhook:stripe',
    limit: EVENTS_PER_MINUTE,
    windowSeconds: 60,
  })
  if (!budget.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const rawBody = await request.text()
  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  }

  const signature = verifyStripeSignature({
    rawBody,
    header: request.headers.get('stripe-signature'),
    secret: env.STRIPE_WEBHOOK_SECRET ?? '',
  })
  if (!signature.ok) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const event = readPaymentEvent(body)
  if (!event) {
    // Verified as Stripe's, but not a shape this build acts on. 200, so Stripe
    // stops retrying something we will never handle.
    return NextResponse.json({ received: true, applied: false }, { status: 200 })
  }

  try {
    const outcome = await applyPaymentEvent(event)
    return NextResponse.json({ received: true, outcome: outcome.kind }, { status: 200 })
  } catch (error) {
    /*
     * An event for an order this deployment does not have is not a fault, and
     * must not be retried for ever — it happens whenever a test-mode event
     * reaches a live endpoint or an order has been purged.
     */
    if (error instanceof AppError && error.code === 'NOT_FOUND') {
      return NextResponse.json({ received: true, applied: false }, { status: 200 })
    }
    // Anything else: let Stripe retry. The handler is idempotent.
    console.error('[stripe-webhook] failed to apply %s:', event.type, error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

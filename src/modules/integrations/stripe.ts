import { money, type Money } from '@/lib/money'
import {
  providerFailed,
  providerOk,
  type PaymentIntent,
  type PaymentsProvider,
  type ProviderResult,
  type RefundResult,
} from './types'

/**
 * Stripe payments, live.
 *
 * Implemented with `fetch` against the REST API rather than the SDK, for the
 * same reason `modules/ai/anthropic-provider` is: two HTTP calls do not justify
 * a dependency whose own transitive tree then has to be trusted, pinned and
 * audited. The shape is the same as `GovUkTravelAdviceProvider` — every
 * failure comes back as `{ ok: false, reason }` and nothing is ever guessed.
 *
 * What this class deliberately does **not** do:
 *
 *   * **It never invents a status.** A Stripe status this code does not
 *     recognise maps to `requires_confirmation`, the one value that causes the
 *     caller to treat the money as not yet taken. Mapping an unknown status
 *     optimistically would confirm a booking against a payment that had not
 *     happened.
 *   * **It never retries.** `createIntent` is given an idempotency key and
 *     passes it to Stripe, so the *caller* may retry safely. Retrying inside,
 *     on a response we could not read, risks a second charge we cannot see.
 *   * **It never captures.** `confirm` is not sent. The intent comes back for
 *     the client to confirm, and the webhook is what tells ARC the money
 *     arrived. See `src/app/api/webhooks/stripe/route.ts`.
 *   * **It never collects card data.** `createIntent` returns Stripe's
 *     `client_secret` and nothing else the browser needs. The card is typed
 *     into an iframe Stripe serves, so no card number reaches an ARC origin, an
 *     ARC server or an ARC log. That is the whole reason the client half of
 *     checkout is Stripe's Payment Element rather than a form of our own.
 *
 * It is unreachable while `ARC_DATA_MODE=demo`: `getEnv()` refuses the
 * combination, `getIntegrations()` refuses it again, and `checkout()` refuses a
 * live provider a third time.
 */
const STRIPE_API = 'https://api.stripe.com/v1'

/** A payment-intent object is a few kilobytes. Anything near this is not one. */
const MAX_RESPONSE_BYTES = 200_000

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/**
 * Stripe's `status`, mapped onto the three states the domain understands.
 *
 * Anything absent from this table is treated as "not paid yet" rather than as
 * a failure or a success, because those are the two answers that would cause
 * ARC to act: confirming a booking, or releasing capacity.
 */
const STATUS: Record<string, PaymentIntent['status']> = {
  succeeded: 'succeeded',
  canceled: 'failed',
  requires_payment_method: 'requires_confirmation',
  requires_confirmation: 'requires_confirmation',
  requires_action: 'requires_confirmation',
  requires_capture: 'requires_confirmation',
  processing: 'requires_confirmation',
}

export class StripePaymentsProvider implements PaymentsProvider {
  readonly name = 'stripe'
  readonly isLive = true

  constructor(
    private readonly options: { secretKey: string; fetch?: Fetch; timeoutMs?: number },
  ) {
    if (!options.secretKey) {
      // Constructing a live provider with no key would produce a provider that
      // fails every call at runtime, which looks like Stripe being down.
      throw new Error('StripePaymentsProvider requires a secret key.')
    }
  }

  async createIntent(input: {
    idempotencyKey: string
    amount: Money
    orderReference: string
    description: string
  }): Promise<ProviderResult<PaymentIntent>> {
    if (input.amount.amountMinor <= 0) return providerFailed(this.name, 'non_positive_amount')

    const body = new URLSearchParams({
      amount: String(input.amount.amountMinor),
      currency: input.amount.currency.toLowerCase(),
      description: input.description.slice(0, 350),
      'automatic_payment_methods[enabled]': 'true',
      'metadata[order_reference]': input.orderReference,
    })

    const result = await this.post('/payment_intents', body, input.idempotencyKey)
    if (!result.ok || !result.data) return providerFailed(this.name, result.reason ?? 'unknown')

    return this.readIntent(result.data, { withClientSecret: true })
  }

  async retrieveIntent(input: { reference: string }): Promise<ProviderResult<PaymentIntent>> {
    // Interpolated into a URL path, so the shape is checked before use.
    if (!/^pi_[A-Za-z0-9_]{8,200}$/.test(input.reference)) {
      return providerFailed(this.name, 'invalid_reference')
    }

    const result = await this.get(`/payment_intents/${input.reference}`)
    if (!result.ok || !result.data) return providerFailed(this.name, result.reason ?? 'unknown')

    return this.readIntent(result.data, { withClientSecret: false })
  }

  async refund(input: {
    idempotencyKey: string
    paymentReference: string
    amount: Money
    reason: string
  }): Promise<ProviderResult<RefundResult>> {
    if (input.amount.amountMinor <= 0) return providerFailed(this.name, 'non_positive_amount')

    const body = new URLSearchParams({
      payment_intent: input.paymentReference,
      amount: String(input.amount.amountMinor),
      // Stripe's own `reason` accepts three enum values; ours is free text, so
      // it goes in metadata rather than being coerced into one of theirs.
      'metadata[arc_reason]': input.reason.slice(0, 500),
    })

    const result = await this.post('/refunds', body, input.idempotencyKey)
    if (!result.ok || !result.data) return providerFailed(this.name, result.reason ?? 'unknown')

    const object = result.data
    const reference = typeof object.id === 'string' ? object.id : null
    const amountMinor = typeof object.amount === 'number' ? object.amount : null
    const currency = typeof object.currency === 'string' ? object.currency.toUpperCase() : null
    const status = typeof object.status === 'string' ? object.status : null

    if (!reference || amountMinor === null || !currency) {
      return providerFailed(this.name, 'unexpected_payload')
    }
    // `failed` and `canceled` refunds moved no money. Reporting one as a
    // refund would leave a guest with a refund record and no refund.
    if (status === 'failed' || status === 'canceled') {
      return providerFailed(this.name, `refund_${status}`)
    }

    return providerOk(this.name, {
      reference,
      amount: money(amountMinor, currency),
      isSimulated: false,
    })
  }

  /**
   * Narrows a Stripe payment-intent object.
   *
   * Stripe is the authority on what it was asked to charge, so the amount and
   * currency reported back are *its* values, never the ones ARC asked for. The
   * caller compares the two and refuses the checkout when they differ, which
   * is only a real check if this does not quietly substitute our own number.
   */
  private readIntent(
    object: Record<string, unknown>,
    options: { withClientSecret: boolean },
  ): ProviderResult<PaymentIntent> {
    const reference = typeof object.id === 'string' ? object.id : null
    const status = typeof object.status === 'string' ? STATUS[object.status] : undefined
    const amountMinor = typeof object.amount === 'number' ? object.amount : null
    const currency = typeof object.currency === 'string' ? object.currency.toUpperCase() : null

    if (!reference || !status || amountMinor === null || !currency) {
      return providerFailed(this.name, 'unexpected_payload')
    }

    /*
     * The client secret is surfaced only by `createIntent`.
     *
     * Stripe returns it on a retrieve as well, and carrying it through there
     * would put a live payment credential into the one code path that runs
     * *after* the guest has paid, where nothing needs it. `retrieveIntent`
     * answers "did this payment stand"; it has no business also handing out
     * the means to confirm one.
     */
    const clientSecret =
      options.withClientSecret && typeof object.client_secret === 'string'
        ? object.client_secret
        : null
    if (options.withClientSecret && !clientSecret) {
      // An intent the browser cannot confirm is not a usable intent, and
      // without this the failure mode is a payment form that renders and then
      // does nothing when the guest presses Pay.
      return providerFailed(this.name, 'missing_client_secret')
    }

    return providerOk(this.name, {
      reference,
      status,
      amount: money(amountMinor, currency),
      isSimulated: false,
      clientSecret,
    })
  }

  private post(
    path: string,
    body: URLSearchParams,
    idempotencyKey: string,
  ): Promise<ProviderResult<Record<string, unknown>>> {
    return this.request(path, {
      method: 'POST',
      // Stripe honours this for 24 hours, which is what makes the caller's
      // retry safe rather than a second charge.
      extraHeaders: { 'idempotency-key': idempotencyKey },
      body: body.toString(),
    })
  }

  private get(path: string): Promise<ProviderResult<Record<string, unknown>>> {
    return this.request(path, { method: 'GET' })
  }

  private async request(
    path: string,
    init: {
      method: 'GET' | 'POST'
      extraHeaders?: Record<string, string>
      body?: string
    },
  ): Promise<ProviderResult<Record<string, unknown>>> {
    const fetchImpl = this.options.fetch ?? fetch

    let response: Response
    try {
      response = await fetchImpl(`${STRIPE_API}${path}`, {
        method: init.method,
        headers: {
          authorization: `Bearer ${this.options.secretKey}`,
          ...(init.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
          'stripe-version': '2026-09-30.preview',
          accept: 'application/json',
          ...init.extraHeaders,
        },
        body: init.body,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
        redirect: 'error',
      })
    } catch (error) {
      const name = error instanceof Error ? error.name : ''
      return providerFailed(
        this.name,
        name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network_error',
      )
    }

    let payload: unknown
    try {
      const text = await response.text()
      if (text.length > MAX_RESPONSE_BYTES) return providerFailed(this.name, 'response_too_large')
      payload = JSON.parse(text)
    } catch {
      return providerFailed(this.name, 'invalid_json')
    }
    if (payload === null || typeof payload !== 'object') {
      return providerFailed(this.name, 'unexpected_payload')
    }

    const object = payload as Record<string, unknown>

    if (!response.ok) {
      /*
       * Stripe's error code, not its message.
       *
       * The message is prose written for a developer and can contain the
       * amount, the card brand and the account name; this reason is recorded
       * on an `AgentRun`-style row and shown in logs.
       */
      const error = object.error as Record<string, unknown> | undefined
      const code = typeof error?.code === 'string' ? error.code : null
      return providerFailed(this.name, code ? `stripe_${code}` : `http_${response.status}`)
    }

    return providerOk(this.name, object)
  }
}

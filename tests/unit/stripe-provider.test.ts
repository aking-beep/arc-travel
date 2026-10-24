import { describe, expect, it } from 'vitest'
import { money } from '@/lib/money'
import { StripePaymentsProvider } from '@/modules/integrations/stripe'

interface Call {
  url: string
  init: RequestInit
}

interface Stubbed {
  status: number
  body: unknown
}

function stub(responses: Stubbed[]) {
  const calls: Call[] = []
  let index = 0
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init: init ?? {} })
    const next = responses.at(Math.min(index++, responses.length - 1))
    if (!next) throw new Error('stub() was given no responses')
    return new Response(JSON.stringify(next.body), { status: next.status })
  }
  return { calls, fetchImpl }
}

/** The one call the assertion is about. Fails loudly rather than optionally. */
function onlyCall(calls: Call[]): Call {
  expect(calls).toHaveLength(1)
  const call = calls[0]
  if (!call) throw new Error('no call was made')
  return call
}

const INTENT = {
  id: 'pi_3MtwBwLkdIwHu7ix28a3tqPa',
  status: 'succeeded',
  amount: 285_000,
  currency: 'mxn',
}

function provider(responses: Array<{ status: number; body: unknown }>) {
  const { calls, fetchImpl } = stub(responses)
  return {
    calls,
    payments: new StripePaymentsProvider({ secretKey: 'sk_test_not_a_real_key', fetch: fetchImpl }),
  }
}

describe('StripePaymentsProvider', () => {
  it('refuses to be constructed without a key', () => {
    // A live provider with no key fails every call at runtime, which looks
    // identical to Stripe being down.
    expect(() => new StripePaymentsProvider({ secretKey: '' })).toThrow(/secret key/i)
  })

  it('sends the amount in minor units, the idempotency key, and no confirmation', async () => {
    const { payments, calls } = provider([{ status: 200, body: INTENT }])
    await payments.createIntent({
      idempotencyKey: 'key-1',
      amount: money(285_000, 'MXN'),
      orderReference: 'ARC-0001',
      description: 'ARC Stay order ARC-0001',
    })

    const call = onlyCall(calls)
    expect(call.url).toBe('https://api.stripe.com/v1/payment_intents')
    const headers = call.init.headers as Record<string, string>
    expect(headers['idempotency-key']).toBe('key-1')
    expect(headers.authorization).toBe('Bearer sk_test_not_a_real_key')

    const body = new URLSearchParams(String(call.init.body))
    expect(body.get('amount')).toBe('285000')
    expect(body.get('currency')).toBe('mxn')
    expect(body.get('metadata[order_reference]')).toBe('ARC-0001')
    // ARC never confirms on the guest's behalf.
    expect(body.get('confirm')).toBeNull()
  })

  it('reports the amount Stripe echoes, not the amount it was asked for', async () => {
    const { payments } = provider([{ status: 200, body: { ...INTENT, amount: 1_000 } }])
    const result = await payments.createIntent({
      idempotencyKey: 'key-2',
      amount: money(285_000, 'MXN'),
      orderReference: 'ARC-0002',
      description: 'x',
    })

    // The caller compares the two and refuses the checkout. That check is only
    // real if the provider does not substitute our own number back.
    expect(result.data?.amount.amountMinor).toBe(1_000)
    expect(result.data?.isSimulated).toBe(false)
  })

  it('maps an unrecognised status to "not paid yet", never to success', async () => {
    for (const status of ['requires_action', 'processing', 'something_new']) {
      const { payments } = provider([{ status: 200, body: { ...INTENT, status } }])
      const result = await payments.retrieveIntent({ reference: 'pi_3MtwBwLkdIwHu7ix28a3tqPa' })
      if (status === 'something_new') {
        // Unknown statuses are not readable at all rather than optimistically
        // mapped: `STATUS` has no entry, so the payload is unexpected.
        expect(result.ok).toBe(false)
      } else {
        expect(result.data?.status).toBe('requires_confirmation')
      }
    }
  })

  it('maps a cancelled intent to failed and a succeeded one to succeeded', async () => {
    const cancelled = provider([{ status: 200, body: { ...INTENT, status: 'canceled' } }])
    expect((await cancelled.payments.retrieveIntent({ reference: 'pi_3MtwBwLkdIwHu7ix28a3tqPa' })).data?.status).toBe(
      'failed',
    )
    const ok = provider([{ status: 200, body: INTENT }])
    expect((await ok.payments.retrieveIntent({ reference: 'pi_3MtwBwLkdIwHu7ix28a3tqPa' })).data?.status).toBe(
      'succeeded',
    )
  })

  it('refuses a reference that is not a payment-intent id, without calling out', async () => {
    const { payments, calls } = provider([{ status: 200, body: INTENT }])
    const result = await payments.retrieveIntent({ reference: '../charges/ch_1' })
    expect(result).toMatchObject({ ok: false, reason: 'invalid_reference' })
    expect(calls).toHaveLength(0)
  })

  it("returns Stripe's error code and never its prose", async () => {
    const { payments } = provider([
      {
        status: 402,
        body: {
          error: {
            code: 'card_declined',
            message: 'Your card ending 4242 was declined for MX$2,850.00.',
          },
        },
      },
    ])
    const result = await payments.createIntent({
      idempotencyKey: 'key-3',
      amount: money(285_000, 'MXN'),
      orderReference: 'ARC-0003',
      description: 'x',
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('stripe_card_declined')
    expect(result.reason).not.toContain('4242')
  })

  it('fails rather than guesses on a non-JSON or unexpected payload', async () => {
    const malformed = new StripePaymentsProvider({
      secretKey: 'sk_test_x',
      fetch: async () => new Response('<html>502</html>', { status: 200 }),
    })
    expect(await malformed.retrieveIntent({ reference: 'pi_3MtwBwLkdIwHu7ix28a3tqPa' })).toMatchObject({
      ok: false,
      reason: 'invalid_json',
    })

    const { payments } = provider([{ status: 200, body: { id: 'pi_3MtwBwLkdIwHu7ix28a3tqPa' } }])
    expect(await payments.retrieveIntent({ reference: 'pi_3MtwBwLkdIwHu7ix28a3tqPa' })).toMatchObject({
      ok: false,
      reason: 'unexpected_payload',
    })
  })

  it('reports a network failure and a timeout distinctly', async () => {
    const network = new StripePaymentsProvider({
      secretKey: 'sk_test_x',
      fetch: async () => {
        throw new Error('ECONNRESET')
      },
    })
    expect(await network.retrieveIntent({ reference: 'pi_3MtwBwLkdIwHu7ix28a3tqPa' })).toMatchObject({
      reason: 'network_error',
    })

    const timeout = new StripePaymentsProvider({
      secretKey: 'sk_test_x',
      fetch: async () => {
        const error = new Error('timed out')
        error.name = 'TimeoutError'
        throw error
      },
    })
    expect(await timeout.retrieveIntent({ reference: 'pi_3MtwBwLkdIwHu7ix28a3tqPa' })).toMatchObject({
      reason: 'timeout',
    })
  })

  it('refuses a refund the provider reported as failed', async () => {
    const { payments } = provider([
      { status: 200, body: { id: 're_1', amount: 1_000, currency: 'mxn', status: 'failed' } },
    ])
    const result = await payments.refund({
      idempotencyKey: 'key-4',
      paymentReference: 'pi_3MtwBwLkdIwHu7ix28a3tqPa',
      amount: money(1_000, 'MXN'),
      reason: 'guest cancelled',
    })
    // A guest with a refund record and no refund is worse than a visible error.
    expect(result).toMatchObject({ ok: false, reason: 'refund_failed' })
  })

  it('puts the free-text reason in metadata, not in Stripe’s reason enum', async () => {
    const { payments, calls } = provider([
      { status: 200, body: { id: 're_1', amount: 1_000, currency: 'mxn', status: 'succeeded' } },
    ])
    await payments.refund({
      idempotencyKey: 'key-5',
      paymentReference: 'pi_3MtwBwLkdIwHu7ix28a3tqPa',
      amount: money(1_000, 'MXN'),
      reason: 'guest cancelled inside the window',
    })
    const body = new URLSearchParams(String(onlyCall(calls).init.body))
    expect(body.get('reason')).toBeNull()
    expect(body.get('metadata[arc_reason]')).toBe('guest cancelled inside the window')
  })

  it('refuses a non-positive amount without calling out', async () => {
    const { payments, calls } = provider([{ status: 200, body: INTENT }])
    expect(
      await payments.createIntent({
        idempotencyKey: 'k',
        amount: money(0, 'MXN'),
        orderReference: 'ARC-0004',
        description: 'x',
      }),
    ).toMatchObject({ ok: false, reason: 'non_positive_amount' })
    expect(calls).toHaveLength(0)
  })
})

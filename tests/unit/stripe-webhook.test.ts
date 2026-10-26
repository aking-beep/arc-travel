import { describe, expect, it } from 'vitest'
import {
  readPaymentEvent,
  signPayload,
  verifyStripeSignature,
} from '@/modules/integrations/stripe-webhook'

const SECRET = 'whsec_test_do_not_use_anywhere_real'
const NOW = new Date('2026-10-24T12:00:00Z')
const TIMESTAMP = Math.floor(NOW.getTime() / 1000)

function header(body: string, options: { secret?: string; timestamp?: number } = {}): string {
  const timestamp = options.timestamp ?? TIMESTAMP
  return `t=${timestamp},v1=${signPayload(options.secret ?? SECRET, timestamp, body)}`
}

const BODY = JSON.stringify({
  id: 'evt_1',
  type: 'payment_intent.payment_failed',
  data: { object: { id: 'pi_3MtwBwLkdIwHu7ix28a3tqPa', last_payment_error: { code: 'card_declined' } } },
})

describe('verifyStripeSignature', () => {
  it('accepts a signature over the exact raw body', () => {
    const result = verifyStripeSignature({
      rawBody: BODY,
      header: header(BODY),
      secret: SECRET,
      now: NOW,
    })
    expect(result.ok).toBe(true)
  })

  it('rejects a body that changed after it was signed', () => {
    // The whole point of signing the raw bytes: this payload is well-formed
    // JSON that Stripe never sent, and it names a different payment.
    const tampered = BODY.replace('pi_3MtwBwLkdIwHu7ix28a3tqPa', 'pi_3MtwBwLkdIwHu7ix28a3tqPb')
    const result = verifyStripeSignature({
      rawBody: tampered,
      header: header(BODY),
      secret: SECRET,
      now: NOW,
    })
    expect(result).toEqual({ ok: false, reason: 'signature_mismatch' })
  })

  it('rejects a signature made with another secret', () => {
    const result = verifyStripeSignature({
      rawBody: BODY,
      header: header(BODY, { secret: 'whsec_someone_elses' }),
      secret: SECRET,
      now: NOW,
    })
    expect(result).toEqual({ ok: false, reason: 'signature_mismatch' })
  })

  it('rejects a replay from outside the tolerance window', () => {
    // A genuine, correctly signed delivery from six minutes ago. Without the
    // timestamp bound, any signed body Stripe ever sent could be replayed —
    // and a replayed payment_failed is a cancellation.
    const old = TIMESTAMP - 360
    const result = verifyStripeSignature({
      rawBody: BODY,
      header: header(BODY, { timestamp: old }),
      secret: SECRET,
      now: NOW,
    })
    expect(result).toEqual({ ok: false, reason: 'timestamp_outside_tolerance' })
  })

  it('rejects a timestamp too far in the future', () => {
    const result = verifyStripeSignature({
      rawBody: BODY,
      header: header(BODY, { timestamp: TIMESTAMP + 3_600 }),
      secret: SECRET,
      now: NOW,
    })
    expect(result).toEqual({ ok: false, reason: 'timestamp_outside_tolerance' })
  })

  it('accepts any one of several v1 signatures, for a secret roll', () => {
    const stale = signPayload('whsec_previous', TIMESTAMP, BODY)
    const live = signPayload(SECRET, TIMESTAMP, BODY)
    const result = verifyStripeSignature({
      rawBody: BODY,
      header: `t=${TIMESTAMP},v1=${stale},v1=${live}`,
      secret: SECRET,
      now: NOW,
    })
    expect(result.ok).toBe(true)
  })

  it('refuses a missing, malformed or unsigned header', () => {
    expect(verifyStripeSignature({ rawBody: BODY, header: null, secret: SECRET, now: NOW })).toEqual(
      { ok: false, reason: 'missing_signature' },
    )
    for (const bad of ['', 'garbage', `t=${TIMESTAMP}`, 'v1=abc', `t=nope,v1=${'a'.repeat(64)}`]) {
      const result = verifyStripeSignature({
        rawBody: BODY,
        header: bad,
        secret: SECRET,
        now: NOW,
      })
      expect(result.ok, bad).toBe(false)
    }
  })

  it('refuses everything when the secret is unset', () => {
    // A misconfigured deployment must reject webhooks, not accept any HMAC
    // computed over the empty string.
    const result = verifyStripeSignature({
      rawBody: BODY,
      header: header(BODY, { secret: '' }),
      secret: '',
      now: NOW,
    })
    expect(result).toEqual({ ok: false, reason: 'signature_mismatch' })
  })
})

describe('readPaymentEvent', () => {
  it('narrows a payment_intent event to id, type, intent and failure code', () => {
    expect(readPaymentEvent(JSON.parse(BODY))).toEqual({
      id: 'evt_1',
      type: 'payment_intent.payment_failed',
      paymentIntentId: 'pi_3MtwBwLkdIwHu7ix28a3tqPa',
      failureCode: 'card_declined',
      // A failed payment took nothing, so it reversed nothing. Null rather
      // than zero, so a caller cannot read it as a reversal of no money.
      reversedMinor: null,
      reversedCurrency: null,
    })
  })

  it('reports no failure code when the provider sent none', () => {
    const event = readPaymentEvent({
      id: 'evt_2',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_3MtwBwLkdIwHu7ix28a3tqPc' } },
    })
    expect(event?.failureCode).toBeNull()
  })

  it('returns null for anything that is not a payment_intent event', () => {
    for (const body of [
      null,
      'a string',
      {},
      { id: 'evt', type: 'charge.refunded', data: { object: { id: 'ch_1' } } },
      { id: 'evt', type: 'payment_intent.succeeded' },
      { id: 'evt', type: 'payment_intent.succeeded', data: {} },
      // Not an intent id: a shape change at Stripe must make ARC do nothing,
      // not guess which order an event belongs to.
      { id: 'evt', type: 'payment_intent.succeeded', data: { object: { id: 'ch_1' } } },
      { type: 'payment_intent.succeeded', data: { object: { id: 'pi_1' } } },
    ]) {
      expect(readPaymentEvent(body), JSON.stringify(body)).toBeNull()
    }
  })
})

describe('readPaymentEvent, charge events', () => {
  it('reads the intent from a refund’s payment_intent field', () => {
    const event = readPaymentEvent({
      id: 'evt_1',
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_1',
          payment_intent: 'pi_3MtwBwLkdIwHu7ix28a3tqPa',
          currency: 'mxn',
          amount: 285_000,
          amount_refunded: 285_000,
        },
      },
    })

    /*
     * A `charge.*` event's object references an intent rather than being one.
     * That difference was the reason this family was ignored entirely, which
     * meant a guest could get their money back at Stripe and keep the boat
     * seat for ever. What makes the reference safe is not where it comes from
     * but what the handler may do with it: a refund opens an approval and
     * cancels nothing.
     */
    expect(event?.paymentIntentId).toBe('pi_3MtwBwLkdIwHu7ix28a3tqPa')
    expect(event?.reversedMinor).toBe(285_000)
    expect(event?.reversedCurrency).toBe('MXN')
  })

  it('reads the cumulative refunded total, not the charge amount', () => {
    // Two partial refunds produce two events, and the second one's cumulative
    // figure is the whole story. Reading `amount` would report the sale.
    const event = readPaymentEvent({
      id: 'evt_1',
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_1',
          payment_intent: 'pi_3MtwBwLkdIwHu7ix28a3tqPa',
          currency: 'mxn',
          amount: 285_000,
          amount_refunded: 95_000,
        },
      },
    })
    expect(event?.reversedMinor).toBe(95_000)
  })

  it('accepts an expanded payment_intent object', () => {
    // Whether this field is a string or an object depends on the account's
    // API version and expansion settings, which are not ARC's to pin.
    const event = readPaymentEvent({
      id: 'evt_1',
      type: 'charge.dispute.created',
      data: {
        object: {
          id: 'dp_1',
          payment_intent: { id: 'pi_3MtwBwLkdIwHu7ix28a3tqPa', object: 'payment_intent' },
          currency: 'mxn',
          amount: 285_000,
        },
      },
    })
    expect(event?.paymentIntentId).toBe('pi_3MtwBwLkdIwHu7ix28a3tqPa')
    expect(event?.reversedMinor).toBe(285_000)
  })

  it('refuses a charge event whose payment_intent is not one', () => {
    for (const field of [null, '', 'cus_123', 'pi_short', { id: 'cus_123' }, 42]) {
      expect(
        readPaymentEvent({
          id: 'evt_1',
          type: 'charge.refunded',
          data: {
            object: { id: 'ch_1', payment_intent: field, currency: 'mxn', amount_refunded: 1 },
          },
        }),
      ).toBeNull()
    }
  })

  it('reports no reversal for a payment that was never taken', () => {
    const event = readPaymentEvent({
      id: 'evt_1',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_3MtwBwLkdIwHu7ix28a3tqPa',
          currency: 'mxn',
          amount: 285_000,
          last_payment_error: { code: 'card_declined' },
        },
      },
    })
    // Nothing went back, because nothing arrived. Null rather than zero, so a
    // caller cannot read "a reversal of 0" as a reversal.
    expect(event?.reversedMinor).toBeNull()
    expect(event?.failureCode).toBe('card_declined')
  })

  it('still ignores an event family it has no handler for', () => {
    expect(
      readPaymentEvent({
        id: 'evt_1',
        type: 'customer.subscription.created',
        data: { object: { id: 'sub_1', payment_intent: 'pi_3MtwBwLkdIwHu7ix28a3tqPa' } },
      }),
    ).toBeNull()
  })
})

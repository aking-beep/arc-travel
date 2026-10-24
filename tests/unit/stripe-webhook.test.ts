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
  data: { object: { id: 'pi_123', last_payment_error: { code: 'card_declined' } } },
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
    const tampered = BODY.replace('pi_123', 'pi_456')
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
      paymentIntentId: 'pi_123',
      failureCode: 'card_declined',
    })
  })

  it('reports no failure code when the provider sent none', () => {
    const event = readPaymentEvent({
      id: 'evt_2',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_abc' } },
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

import { describe, expect, it } from 'vitest'
import { pseudonymize, redact, redactString } from '@/lib/redact'

/**
 * The audit trail is the product's evidence that it did not act on its own,
 * so a redactor that corrupts an identifier is not a cosmetic problem: it is
 * the difference between "this event, from this provider" and a record nobody
 * can tie to anything.
 */
describe('redactString', () => {
  it('redacts a telephone number written the way a guest writes one', () => {
    for (const phone of [
      '+52 954 582 0170',
      '+52 (954) 582-0170',
      '9545820170',
      '954-582-0170',
    ]) {
      expect(redactString(`call me on ${phone} after six`), phone).toBe(
        'call me on [phone] after six',
      )
    }
  })

  it('redacts an email address', () => {
    expect(redactString('write to ana.lopez+surf@example.mx instead')).toBe(
      'write to [email] instead',
    )
  })

  it('leaves an opaque identifier alone', () => {
    /*
     * Found in CI, not by reading: the unanchored pattern turned
     * `evt_59cd7601-41ed-4d95-9be6-c8f721151699` into
     * `…-c8f[phone]`, because the tail of a UUID is a long enough run of
     * digits to pass for a phone number. Whether it fired at all depended on
     * which UUID was generated, which is the worst kind of defect to own: a
     * test that passes until the audit record that matters is the mangled one.
     */
    for (const id of [
      'evt_59cd7601-41ed-4d95-9be6-c8f721151699',
      '59cd7601-41ed-4d95-9be6-123456789012',
      'pi_3MtwBwLkdIwHu7ix28a3tqPa',
      'ARC-1792869825507',
      '2026-10-24T19:23:37.699Z',
      'payment_failed:card_declined',
    ]) {
      expect(redactString(id), id).toBe(id)
    }
  })
})

describe('redact', () => {
  it('redacts by key name, whatever the value looks like', () => {
    expect(
      redact({ guestPhone: '954 582 0170', contactEmail: 'a@b.mx', note: 'ok' }),
    ).toEqual({ guestPhone: '[redacted]', contactEmail: '[redacted]', note: 'ok' })
  })

  it('keeps a key whose name only contains a sensitive word by accident', () => {
    // `description` and `participantNotes` both contain "ip". Hollowing those
    // out is the same mistake as the phone pattern, one level up.
    expect(redact({ description: 'two surfers', participantNotes: 'left-handed' })).toEqual({
      description: 'two surfers',
      participantNotes: 'left-handed',
    })
  })

  it('passes audit metadata through unchanged when none of it is guest data', () => {
    const metadata = {
      provider: 'stripe',
      eventId: 'evt_59cd7601-41ed-4d95-9be6-c8f721151699',
      failureCode: 'card_declined',
      previousStatus: 'CONFIRMED',
    }
    expect(redact(metadata)).toEqual(metadata)
  })

  it('recurses into arrays and nested objects, and stops at a depth limit', () => {
    expect(redact({ items: [{ guestEmail: 'a@b.mx' }] })).toEqual({
      items: [{ guestEmail: '[redacted]' }],
    })

    let deep: Record<string, unknown> = { note: 'bottom' }
    for (let i = 0; i < 12; i += 1) deep = { inner: deep }
    expect(JSON.stringify(redact(deep))).toContain('[depth-limit]')
  })

  it('leaves null, undefined and a Date as they are', () => {
    const when = new Date('2026-10-24T00:00:00.000Z')
    expect(redact({ a: null, b: undefined, when })).toEqual({ a: null, b: undefined, when })
  })
})

describe('pseudonymize', () => {
  it('is stable for one subject and different across salts', () => {
    expect(pseudonymize('guest-1', 'salt-a')).toBe(pseudonymize('guest-1', 'salt-a'))
    expect(pseudonymize('guest-1', 'salt-a')).not.toBe(pseudonymize('guest-1', 'salt-b'))
    expect(pseudonymize('guest-1', 'salt-a')).not.toBe(pseudonymize('guest-2', 'salt-a'))
  })

  it('does not leak the subject', () => {
    expect(pseudonymize('ana.lopez@example.mx', 'salt')).not.toContain('ana')
    expect(pseudonymize('ana.lopez@example.mx', 'salt')).toHaveLength(22)
  })
})

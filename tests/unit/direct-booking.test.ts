import { describe, expect, it } from 'vitest'
import { additionalTripSchema, directTripSchema } from '@/modules/guest/schemas'

const trip = {
  name: 'Sam Okafor',
  email: 'Sam@Example.COM ',
  propertySlug: 'casa-olas',
  fromDate: '2026-11-01',
  toDate: '2026-11-03',
  partySize: '2',
  password: 'an entirely ordinary passphrase',
  confirmPassword: 'an entirely ordinary passphrase',
  acceptedTerms: 'on',
}

/**
 * The open sign-up form's shape.
 *
 * `.strict()` is the point: this form is reachable by anybody, so a field it
 * cannot name is a field nobody can set. There is no `kind` here — a caller
 * cannot ask for a `HOTEL_RESERVATION` — no `organizationId`, no `propertyId`,
 * no reference and no status. See ADR-042.
 */
describe('directTripSchema', () => {
  it('accepts a trip and normalises the address', () => {
    const parsed = directTripSchema.parse(trip)
    expect(parsed.email).toBe('sam@example.com')
    expect(parsed.partySize).toBe(2)
    expect(parsed.acceptedTerms).toBe(true)
  })

  it.each([
    'kind',
    'propertyId',
    'organizationId',
    'reference',
    'status',
    'portalToken',
    'roomTypeId',
    'roomRevenueMinor',
    'guestId',
  ])('cannot name %s', (field) => {
    expect(() => directTripSchema.parse({ ...trip, [field]: 'x' })).toThrow()
  })

  it('refuses a last day before the first', () => {
    expect(() => directTripSchema.parse({ ...trip, toDate: '2026-10-30' })).toThrow(
      /cannot be before the first/,
    )
  })

  it('accepts a single day', () => {
    expect(directTripSchema.parse({ ...trip, toDate: trip.fromDate }).toDate).toBe(trip.fromDate)
  })

  it('refuses a date that is not a calendar day', () => {
    expect(() => directTripSchema.parse({ ...trip, fromDate: '01/11/2026' })).toThrow(
      /YYYY-MM-DD/,
    )
  })

  it('refuses mismatched passwords', () => {
    expect(() =>
      directTripSchema.parse({ ...trip, confirmPassword: 'something else entirely' }),
    ).toThrow(/do not match/)
  })

  it('refuses a sign-up that did not accept the terms', () => {
    const { acceptedTerms: _omitted, ...withoutTerms } = trip
    expect(() => directTripSchema.parse(withoutTerms)).toThrow()
    expect(() => directTripSchema.parse({ ...trip, acceptedTerms: '' })).toThrow(/Accept the terms/)
  })

  it('refuses a party of nobody, and a bus', () => {
    expect(() => directTripSchema.parse({ ...trip, partySize: '0' })).toThrow()
    expect(() => directTripSchema.parse({ ...trip, partySize: '40' })).toThrow()
  })

  it('refuses a password nobody could remember being short', () => {
    expect(() =>
      directTripSchema.parse({ ...trip, password: 'short', confirmPassword: 'short' }),
    ).toThrow()
  })
})

describe('additionalTripSchema', () => {
  it('asks for the trip and nothing about the person', () => {
    const parsed = additionalTripSchema.parse({
      propertySlug: 'casa-olas',
      fromDate: '2026-11-01',
      toDate: '2026-11-02',
      partySize: '3',
    })
    expect(parsed.partySize).toBe(3)
  })

  it.each(['userId', 'email', 'password', 'kind', 'guestId'])('cannot name %s', (field) => {
    expect(() =>
      additionalTripSchema.parse({
        propertySlug: 'casa-olas',
        fromDate: '2026-11-01',
        toDate: '2026-11-02',
        partySize: '2',
        [field]: 'x',
      }),
    ).toThrow()
  })
})

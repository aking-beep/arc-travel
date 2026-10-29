import { describe, expect, it } from 'vitest'
import {
  decodeTrip,
  encodeTrip,
  TRIP_MAX_AGE_SECONDS,
  type TripSession,
} from '@/modules/guest/visitor-session'

/**
 * The storefront trip cookie.
 *
 * The basket id inside it is a bearer credential: whoever holds it can add to
 * that basket, empty it and buy from it. So the signature is the whole of the
 * security story here, and these tests are about what happens when it does not
 * hold rather than about the happy path.
 */
const session: TripSession = {
  cartId: '2f9a4f6e-0000-4000-8000-000000000001',
  propertySlug: 'casa-olas',
  fromDate: '2026-11-05',
  toDate: '2026-11-09',
  partySize: 2,
  surfAbility: 'IMPROVER',
}

describe('trip cookie', () => {
  it('round-trips a session', () => {
    expect(decodeTrip(encodeTrip(session))).toEqual(session)
  })

  it('refuses a payload whose body was edited', () => {
    const token = encodeTrip(session)
    const dot = token.lastIndexOf('.')
    const body = token.slice(0, dot)
    const signature = token.slice(dot + 1)
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(body, 'base64url').toString('utf8')),
        cartId: 'somebody-elses-basket',
      }),
      'utf8',
    ).toString('base64url')

    expect(decodeTrip(`${forged}.${signature}`)).toBeNull()
  })

  it('refuses a signature of the wrong length rather than throwing', () => {
    const token = encodeTrip(session)
    expect(decodeTrip(`${token.slice(0, token.lastIndexOf('.'))}.short`)).toBeNull()
  })

  it('refuses nothing, rubbish and a token with no signature', () => {
    expect(decodeTrip(undefined)).toBeNull()
    expect(decodeTrip('')).toBeNull()
    expect(decodeTrip('not-a-token')).toBeNull()
  })

  it('expires', () => {
    const issued = Date.UTC(2026, 0, 1)
    const token = encodeTrip(session, issued)
    expect(decodeTrip(token, issued + (TRIP_MAX_AGE_SECONDS - 60) * 1000)).not.toBeNull()
    expect(decodeTrip(token, issued + (TRIP_MAX_AGE_SECONDS + 60) * 1000)).toBeNull()
  })

  /**
   * An ability the enum does not know reads as no answer, which is the strict
   * case the conditions gate applies — not a value that sails through into the
   * gate's comparisons and ranks as unknown-but-truthy.
   */
  it('reads an unrecognised ability as no answer', () => {
    const token = encodeTrip({
      ...session,
      surfAbility: 'PROFESSIONAL' as TripSession['surfAbility'],
    })
    expect(decodeTrip(token)?.surfAbility).toBeNull()
  })

  it('refuses a party size that is not a whole number of people', () => {
    expect(decodeTrip(encodeTrip({ ...session, partySize: 0 }))).toBeNull()
    expect(decodeTrip(encodeTrip({ ...session, partySize: 1.5 }))).toBeNull()
  })
})

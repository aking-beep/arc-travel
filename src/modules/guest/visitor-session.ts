import { createHmac, timingSafeEqual } from 'node:crypto'
import { getEnv } from '@/lib/env'
import type { DateKey } from '@/lib/dates'
import type { AbilityLevel } from '@/lib/prisma-types'

const ABILITIES = ['BEGINNER', 'IMPROVER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'] as const

/**
 * The cookie that carries a storefront basket before anybody has an account.
 *
 * It holds the basket's id and the trip window the person declared, and it is
 * signed for one reason: the basket id is the bearer credential for that
 * basket. Anything holding it can read the lines, add to them and check them
 * out, so a cookie the browser could edit would let somebody paste another
 * visitor's basket id and buy from it. The dates and the party size are the
 * person's own declaration about themselves, so signing those adds no secrecy
 * — they travel inside the same envelope because they have to survive a page
 * load and there is no row to put them on until the trip exists.
 *
 * Deliberately not a `Stay`. A row with a hotel's name and a pair of dates on
 * it is a booking as far as every operator screen is concerned, and somebody
 * who opened a property page and changed their mind has booked nothing. The
 * `Stay` is written at the till, in the same transaction as the account and
 * the order.
 */
export const TRIP_COOKIE = 'arc_trip'

/**
 * How long a half-filled basket survives.
 *
 * Longer than the basket's own 30-minute TTL and the 15-minute holds inside
 * it, on purpose: when a person comes back after an hour the right answer is
 * their basket with its lapsed lines shown as needing re-reserving, which the
 * basket view already renders. A cookie that expired first would instead show
 * them an empty storefront and no explanation.
 */
export const TRIP_MAX_AGE_SECONDS = 60 * 60 * 12

export interface TripSession {
  cartId: string
  propertySlug: string
  fromDate: DateKey
  toDate: DateKey
  partySize: number
  /**
   * The ability they stated, or null.
   *
   * A declaration about themselves, so the signature protects nothing here —
   * it rides along because the whole session travels in one envelope. The
   * `Guest` row is the authority once one exists: a recorded ability is never
   * overwritten by a later self-declaration, and the stricter answer wins.
   */
  surfAbility: AbilityLevel | null
}

interface TripPayload extends TripSession {
  exp: number
}

function sign(value: string): string {
  return createHmac('sha256', getEnv().AUTH_SECRET).update(value).digest('base64url')
}

export function encodeTrip(session: TripSession, now = Date.now()): string {
  const payload: TripPayload = {
    ...session,
    exp: Math.floor(now / 1000) + TRIP_MAX_AGE_SECONDS,
  }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${body}.${sign(body)}`
}

export function decodeTrip(token: string | undefined | null, now = Date.now()): TripSession | null {
  if (!token) return null
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null

  const body = token.slice(0, dot)
  const a = Buffer.from(token.slice(dot + 1))
  const b = Buffer.from(sign(body))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TripPayload
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < now) return null
    if (typeof payload.cartId !== 'string' || payload.cartId.length === 0) return null
    if (typeof payload.propertySlug !== 'string' || payload.propertySlug.length === 0) return null
    if (typeof payload.fromDate !== 'string' || typeof payload.toDate !== 'string') return null
    if (!Number.isInteger(payload.partySize) || payload.partySize < 1) return null

    return {
      cartId: payload.cartId,
      propertySlug: payload.propertySlug,
      fromDate: payload.fromDate,
      toDate: payload.toDate,
      partySize: payload.partySize,
      // An unrecognised value is read as no answer, which is the strict case.
      surfAbility: ABILITIES.includes(payload.surfAbility as (typeof ABILITIES)[number])
        ? payload.surfAbility
        : null,
    }
  } catch {
    return null
  }
}

export const tripCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: process.env.NODE_ENV === 'production',
  maxAge: TRIP_MAX_AGE_SECONDS,
}

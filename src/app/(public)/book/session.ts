import { cookies } from 'next/headers'
import { decodeTrip, TRIP_COOKIE, type TripSession } from '@/modules/guest/visitor-session'

/**
 * The trip cookie, for a Server Component to render from.
 *
 * Not in `actions.ts`: a `'use server'` module exports server *actions*, and
 * an exported reader there would be callable from the browser as one.
 */
export async function readTripSession(): Promise<TripSession | null> {
  const store = await cookies()
  return decodeTrip(store.get(TRIP_COOKIE)?.value)
}

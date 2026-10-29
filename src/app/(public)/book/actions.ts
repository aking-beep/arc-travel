'use server'

import { randomUUID } from 'node:crypto'
import { cookies, headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { toFormState, type FormState } from '@/lib/form-state'
import { signInAs, getActor } from '@/modules/auth/service'
import {
  addToVisitorTrip,
  purchaseVisitorTrip,
  purchaseVisitorTripForAccount,
  removeFromVisitorTrip,
  startVisitorTrip,
} from '@/modules/guest/visitor'
import {
  decodeTrip,
  encodeTrip,
  tripCookieOptions,
  TRIP_COOKIE,
  type TripSession,
} from '@/modules/guest/visitor-session'

/**
 * The storefront's server actions.
 *
 * Each one turns a `FormData` into a plain object, calls one service and turns
 * a thrown error into a `FormState`. The one thing they do that the services
 * cannot is touch cookies: the trip cookie is this layer's, exactly as the
 * session cookie is, because a domain module that set one could not be called
 * from a test or a script.
 *
 * No action accepts a basket id from the client. The only basket any of them
 * can act on is the one inside the signed cookie, for the reason the guest
 * portal gives about its token: a basket id in a form field would let anybody
 * who guessed one add to, empty or buy somebody else's trip.
 */

function clientKey(headerList: Headers): string | null {
  const forwarded = headerList.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  return first || headerList.get('x-real-ip') || null
}

async function currentTrip(): Promise<TripSession | null> {
  const store = await cookies()
  return decodeTrip(store.get(TRIP_COOKIE)?.value)
}

export async function startTripAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const trip = await startVisitorTrip({
      propertySlug: String(formData.get('propertySlug') ?? ''),
      fromDate: String(formData.get('fromDate') ?? ''),
      toDate: String(formData.get('toDate') ?? ''),
      partySize: formData.get('partySize') ?? 2,
      surfAbility: String(formData.get('surfAbility') ?? '') || null,
    })

    const store = await cookies()
    store.set(TRIP_COOKIE, encodeTrip(trip), tripCookieOptions)
  } catch (error) {
    return toFormState(error)
  }

  // `redirect` throws, so it cannot sit inside the try above.
  redirect('/book')
}

/**
 * Changes the dates or the party size without losing the basket.
 *
 * The lines stay put and the ones that now fall outside the window are shown
 * as such on the basket, rather than being removed silently: somebody who
 * shifts their trip by a day and finds two bookings gone has lost work they
 * did not know they could lose.
 */
export async function changeTripAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await currentTrip()
    if (!session) return { ok: false, message: 'Your trip has expired. Start it again.' }

    const next = await startVisitorTrip({
      propertySlug: session.propertySlug,
      fromDate: String(formData.get('fromDate') ?? ''),
      toDate: String(formData.get('toDate') ?? ''),
      partySize: formData.get('partySize') ?? session.partySize,
      surfAbility: String(formData.get('surfAbility') ?? '') || null,
    })

    /*
     * A new window keeps the basket it had.
     *
     * `startVisitorTrip` opens a fresh basket, which is right for a first
     * visit and wrong here, so the new window is stored against the basket
     * that already holds the lines. The unused basket is an empty row that
     * the cart sweeper expires.
     */
    const store = await cookies()
    store.set(
      TRIP_COOKIE,
      encodeTrip({ ...next, cartId: session.cartId }),
      tripCookieOptions,
    )
  } catch (error) {
    return toFormState(error)
  }

  revalidatePath('/book')
  return { ok: true, message: 'Dates updated.' }
}

export async function addToTripAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await currentTrip()
    if (!session) return { ok: false, message: 'Your trip has expired. Start it again.' }

    const { holdExpiresAt } = await addToVisitorTrip({
      session,
      slotId: String(formData.get('slotId') ?? ''),
      quantity: Number(formData.get('quantity') ?? session.partySize),
    })

    revalidatePath('/book')
    return {
      ok: true,
      message: 'Added to your trip.',
      notes: [`Your places are held until ${holdExpiresAt.toISOString().slice(11, 16)} UTC.`],
    }
  } catch (error) {
    return toFormState(error)
  }
}

export async function removeFromTripAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const session = await currentTrip()
    if (!session) return { ok: false, message: 'Your trip has expired. Start it again.' }

    await removeFromVisitorTrip({ session, slotId: String(formData.get('slotId') ?? '') })
    revalidatePath('/book')
    return { ok: true, message: 'Removed.' }
  } catch (error) {
    return toFormState(error)
  }
}

/**
 * Pay, and get an account in the same breath.
 *
 * Somebody already signed in takes the second path: their basket must not be
 * dropped at the till, and they must not be asked to make a second account.
 * Either way the trip cookie is cleared, because the basket behind it has been
 * checked out and a stale one would show them an empty storefront.
 */
export async function payForTripAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let reference: string

  try {
    const session = await currentTrip()
    if (!session) return { ok: false, message: 'Your trip has expired. Start it again.' }

    // From the rendered form, so a resubmission of the same page replays
    // rather than buying twice. A fresh basket gets a fresh key.
    const idempotencyKey = String(formData.get('idempotencyKey') ?? '') || randomUUID()
    const actor = await getActor()

    const purchase = actor
      ? await purchaseVisitorTripForAccount({ session, userId: actor.userId, idempotencyKey })
      : await purchaseVisitorTrip({
          session,
          raw: {
            name: String(formData.get('name') ?? ''),
            email: String(formData.get('email') ?? ''),
            password: String(formData.get('password') ?? ''),
            confirmPassword: String(formData.get('confirmPassword') ?? ''),
            acceptedTerms: formData.get('acceptedTerms') === 'on',
          },
          idempotencyKey,
          clientKey: clientKey(await headers()),
        })

    // The services deliberately do not touch cookies; both are this layer's.
    if (!actor) await signInAs(purchase.userId)
    const store = await cookies()
    store.delete(TRIP_COOKIE)

    reference = purchase.orderReference
  } catch (error) {
    return toFormState(error)
  }

  revalidatePath('/me')
  redirect(`/me/orders/${reference}`)
}

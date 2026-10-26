'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { toFormState, type FormState } from '@/lib/form-state'
import { registerDirectTrip } from '@/modules/guest/direct'
import { signInAs } from '@/modules/auth/service'

/**
 * Open sign-up for somebody who is not a hotel's guest.
 *
 * The caller's address is read here because only the app layer may touch
 * headers, and the service needs it to bound sign-ups per caller.
 */
function clientKey(headerList: Headers): string | null {
  const forwarded = headerList.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  return first || headerList.get('x-real-ip') || null
}

export async function directSignUpAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  let portalPath: string

  try {
    const trip = await registerDirectTrip(
      {
        name: String(formData.get('name') ?? ''),
        email: String(formData.get('email') ?? ''),
        propertySlug: String(formData.get('propertySlug') ?? ''),
        fromDate: String(formData.get('fromDate') ?? ''),
        toDate: String(formData.get('toDate') ?? ''),
        partySize: formData.get('partySize') ?? 2,
        password: String(formData.get('password') ?? ''),
        confirmPassword: String(formData.get('confirmPassword') ?? ''),
        acceptedTerms: formData.get('acceptedTerms') === 'on',
      },
      { clientKey: clientKey(await headers()) },
    )

    // The service deliberately does not touch cookies; the session is this
    // layer's job.
    await signInAs(trip.userId)
    portalPath = `/g/${trip.portalToken}`
  } catch (error) {
    return toFormState(error)
  }

  // Straight into the portal rather than to the account index: the person came
  // here to plan something, and the portal is where that happens. `redirect`
  // throws, so it cannot sit inside the try above.
  redirect(portalPath)
}

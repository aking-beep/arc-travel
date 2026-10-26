'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { toFormState, type FormState } from '@/lib/form-state'
import { signInAs } from '@/modules/auth/service'
import { registerGuestAccountFromPortal } from '@/modules/guest/account'
import { clientKeyFromHeaders, resolvePortalForRequest } from '../resolve'

/**
 * Creates a guest account for the stay the token names.
 *
 * The token arrives as a form field because a server action does not run under
 * the route's layout and so cannot read the route params. It is re-resolved
 * here through `resolvePortalForRequest` — the same guard, the same rate
 * limits, the same grace window as every other entry point to the guest
 * surface. The booking and the address come from that resolution, never from
 * the form.
 */
export async function portalAccountSignUpAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const context = await resolvePortalForRequest(String(formData.get('token') ?? ''))

    const { userId } = await registerGuestAccountFromPortal(
      { stayReference: context.reference, guestEmail: context.guestEmail },
      {
        name: String(formData.get('name') ?? ''),
        password: String(formData.get('password') ?? ''),
        confirmPassword: String(formData.get('confirmPassword') ?? ''),
        acceptedTerms: formData.get('acceptedTerms') === 'on',
      },
      { clientKey: clientKeyFromHeaders(await headers()) },
    )

    await signInAs(userId)
  } catch (error) {
    return toFormState(error)
  }

  redirect('/me')
}

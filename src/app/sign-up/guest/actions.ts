'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { toFormState, type FormState } from '@/lib/form-state'
import { registerGuestAccount } from '@/modules/guest/account'
import { signInAs } from '@/modules/auth/service'

/**
 * Guest sign-up.
 *
 * The caller's address comes from the request headers here, because only the
 * app layer may read them, and the service needs it to bound both sign-ups and
 * booking-reference attempts per caller.
 */
function clientKey(headerList: Headers): string | null {
  const forwarded = headerList.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  return first || headerList.get('x-real-ip') || null
}

export async function guestSignUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const registered = await registerGuestAccount(
      {
        name: String(formData.get('name') ?? ''),
        email: String(formData.get('email') ?? ''),
        reference: String(formData.get('reference') ?? ''),
        password: String(formData.get('password') ?? ''),
        confirmPassword: String(formData.get('confirmPassword') ?? ''),
        acceptedTerms: formData.get('acceptedTerms') === 'on',
      },
      { clientKey: clientKey(await headers()) },
    )
    // The service deliberately does not touch cookies; establishing the
    // session is this layer's job.
    await signInAs(registered.userId)
  } catch (error) {
    return toFormState(error)
  }

  // `redirect` throws, so it cannot sit inside the try above.
  redirect('/me')
}

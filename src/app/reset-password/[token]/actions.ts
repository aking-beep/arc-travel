'use server'

import { redirect } from 'next/navigation'
import { toFormState, type FormState } from '@/lib/form-state'
import { completePasswordReset } from '@/modules/auth/password-reset'

export async function completeResetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await completePasswordReset({
      token: String(formData.get('token') ?? ''),
      password: String(formData.get('password') ?? ''),
      confirmPassword: String(formData.get('confirmPassword') ?? ''),
    })
  } catch (error) {
    return toFormState(error)
  }

  /*
   * To the sign-in page, not into a session.
   *
   * A reset link arriving in a mailbox is weaker proof than a password.
   * Treating it as a session would make a readable inbox equivalent to a
   * credential for as long as that session lasted; asking the person to use
   * the password they just set costs one form and closes that.
   *
   * Outside the try, because `redirect` works by throwing.
   */
  redirect('/sign-in?reset=1')
}

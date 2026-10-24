'use server'

import { redirect } from 'next/navigation'
import { toFormState, type FormState } from '@/lib/form-state'
import { acceptInvitation } from '@/modules/auth/credentials'
import { landingFor } from '@/app/sign-in/actions'

export async function acceptInvitationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  let target: string
  try {
    const actor = await acceptInvitation({
      token: String(formData.get('token') ?? ''),
      name: String(formData.get('name') ?? '') || undefined,
      password: String(formData.get('password') ?? ''),
      confirmPassword: String(formData.get('confirmPassword') ?? ''),
    })
    target = await landingFor(actor)
  } catch (error) {
    return toFormState(error)
  }

  redirect(target)
}

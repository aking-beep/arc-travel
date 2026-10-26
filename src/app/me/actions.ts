'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { toFormState, type FormState } from '@/lib/form-state'
import { requireActor } from '@/modules/auth/service'
import { claimStayForAccount } from '@/modules/guest/account'

function clientKey(headerList: Headers): string | null {
  const forwarded = headerList.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  return first || headerList.get('x-real-ip') || null
}

/**
 * Adds a further booking to the signed-in account.
 *
 * The user id comes from the session, never from the form: the only
 * client-supplied values here are the reference and the address, and the
 * service matches on both.
 */
export async function claimStayAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await requireActor()
    const email = String(formData.get('email') ?? '').trim()

    await claimStayForAccount(
      actor.userId,
      {
        reference: String(formData.get('reference') ?? ''),
        email: email || undefined,
      },
      { clientKey: clientKey(await headers()) },
    )
  } catch (error) {
    return toFormState(error)
  }

  revalidatePath('/me')
  return { ok: true, message: 'Added. It is in the list above.' }
}

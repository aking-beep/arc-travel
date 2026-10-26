'use server'

import { headers } from 'next/headers'
import { toFormState, type FormState } from '@/lib/form-state'
import { getTranslator } from '@/lib/i18n/server'
import { requestPasswordReset } from '@/modules/auth/password-reset'

/**
 * The caller's address, for the per-caller limit.
 *
 * Read here because only the app layer may touch request headers, and handed
 * to the service, which needs it to bound walking the form down a list of
 * addresses as well as mail-bombing one.
 */
function clientKey(headerList: Headers): string | null {
  const forwarded = headerList.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  return first || headerList.get('x-real-ip') || null
}

export async function requestResetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { t } = await getTranslator()

  try {
    const outcome = await requestPasswordReset(
      { email: String(formData.get('email') ?? '') },
      { requesterKey: clientKey(await headers()) },
    )

    /*
     * The same message whatever happened.
     *
     * The service already refuses to distinguish a known address from an
     * unknown one; this is the other half of that — a page that said "we have
     * sent you a link" only for real accounts would answer the question the
     * service declined to. The one thing it does vary is whether this
     * deployment can send at all, which is a fact about the deployment rather
     * than about the address.
     */
    return {
      ok: true,
      message: outcome.willDeliver ? t('auth.reset.sent') : t('auth.reset.notConfigured'),
    }
  } catch (error) {
    /*
     * A rate-limit refusal is the one thing that may differ, and it has to:
     * silently dropping the request would leave somebody waiting for a link
     * that is never coming. It reveals nothing about the address — the limit
     * is consumed before anything is looked up.
     */
    return toFormState(error)
  }
}

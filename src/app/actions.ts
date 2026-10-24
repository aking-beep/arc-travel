'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { safeNext } from '@/lib/demo-gate'
import { LOCALE_COOKIE, isAppLocale } from '@/lib/i18n'
import { signInByEmail, signOut as clearSession } from '@/modules/auth/service'

/** Persists a language choice for a year. The only cookie ARC sets by choice. */
export async function setLocaleAction(formData: FormData): Promise<void> {
  const locale = formData.get('locale')
  // Narrowed, not trusted: the field is posted by the client and feeds a
  // redirect, so an absolute or protocol-relative value would be an open
  // redirect on a route that needs no session at all.
  const next = safeNext(String(formData.get('next') ?? '/'))

  if (isAppLocale(locale)) {
    const store = await cookies()
    store.set(LOCALE_COOKIE, locale, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
    })
  }

  redirect(next)
}

export async function signInAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '')
  const next = safeNext(String(formData.get('next') ?? '/'))
  await signInByEmail(email)
  redirect(next)
}

export async function signOutAction(): Promise<void> {
  await clearSession()
  redirect('/')
}

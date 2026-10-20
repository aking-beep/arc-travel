'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { LOCALE_COOKIE, isAppLocale } from '@/lib/i18n'
import { signInByEmail, signOut as clearSession } from '@/modules/auth/service'

/** Persists a language choice for a year. The only cookie ARC sets by choice. */
export async function setLocaleAction(formData: FormData): Promise<void> {
  const locale = formData.get('locale')
  const next = String(formData.get('next') ?? '/')

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
  const next = String(formData.get('next') ?? '/')
  await signInByEmail(email)
  redirect(next)
}

export async function signOutAction(): Promise<void> {
  await clearSession()
  redirect('/')
}

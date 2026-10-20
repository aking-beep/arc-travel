'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { GATE_COOKIE, gatePassphrase, gateToken, safeNext, tokensMatch } from '@/lib/demo-gate'

/**
 * Exchanges the shared passphrase for the gate cookie.
 *
 * A wrong passphrase redirects back with a flag rather than returning a
 * `FormState`, so the page stays a Server Component and no attempt is recorded
 * in the URL beyond "that one failed".
 */
export async function enterDemoAction(formData: FormData): Promise<void> {
  const passphrase = gatePassphrase()
  const next = safeNext(String(formData.get('next') ?? '/'))

  if (!passphrase) redirect(next)

  // Compared as derived tokens: equal length and constant time, so neither the
  // passphrase nor its length can be read off a response time.
  const secret = process.env.AUTH_SECRET ?? ''
  const expected = await gateToken(passphrase, secret)
  const offered = await gateToken(String(formData.get('passphrase') ?? ''), secret)
  if (!tokensMatch(offered, expected)) {
    redirect(`/gate?next=${encodeURIComponent(next)}&error=1`)
  }

  const store = await cookies()
  store.set(GATE_COOKIE, expected, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 7,
  })

  redirect(next)
}

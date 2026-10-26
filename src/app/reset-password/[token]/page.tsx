import Link from 'next/link'
import { KeyRound } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DemoBanner } from '@/components/demo-banner'
import { getTranslator } from '@/lib/i18n/server'
import { getResetToken } from '@/modules/auth/password-reset'
import { ResetPasswordForm } from './form'

export const metadata = {
  title: 'Choose a new password · ARC Stay',
}

/**
 * Setting the new password.
 *
 * Resolves the token server-side so the form can name the account it is about
 * — somebody with two ARC addresses needs to know which one they are changing.
 * Every way a token can be refused renders the same thing: unlike an
 * invitation, where the holder of the link is by definition the person it was
 * sent to, a reset link may be presented by whoever is reading a mailbox, and
 * "this expired four minutes ago" tells them a valid one recently existed.
 */
export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const { t } = await getTranslator()

  let email: string | null = null
  try {
    email = (await getResetToken(token)).email
  } catch {
    email = null
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBanner />
      <main className="mx-auto w-full max-w-md flex-1 px-5 py-10">
        <div className="flex items-center gap-2">
          <KeyRound className="text-jade-700 size-5" aria-hidden />
          <h1 className="font-display text-2xl font-semibold">{t('auth.reset.setTitle')}</h1>
        </div>

        {email === null ? (
          <Card className="mt-8">
            <CardContent className="pt-6">
              <p className="text-sm leading-relaxed">{t('auth.reset.invalid')}</p>
              <p className="mt-4 text-sm">
                <Link
                  href="/forgot-password"
                  className="text-jade-800 underline underline-offset-4"
                >
                  {t('auth.reset.title')}
                </Link>
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <p className="text-sand-600 mt-2 text-sm leading-relaxed">
              {t('auth.reset.setLede', { email })}
            </p>
            <Card className="mt-8">
              <CardHeader>
                <CardTitle className="text-base">{t('auth.reset.newPassword')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ResetPasswordForm
                  token={token}
                  labels={{
                    newPassword: t('auth.reset.newPassword'),
                    confirmPassword: t('auth.reset.confirmPassword'),
                    submit: t('auth.reset.setSubmit'),
                  }}
                />
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  )
}

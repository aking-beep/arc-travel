import { KeyRound } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DemoBanner } from '@/components/demo-banner'
import { getTranslator } from '@/lib/i18n/server'
import { ForgotPasswordForm } from './form'

export const metadata = {
  title: 'Reset your password · ARC Stay',
  description: 'Ask for a link that lets you set a new ARC Stay password.',
}

/**
 * Asking for a reset.
 *
 * ARC Stay had no password reset until transactional mail existed, which was
 * honest while there was nowhere to send one — and a gap a real hotel finds in
 * its first week, when a manager forgets the password to their own dashboard.
 *
 * The page is careful about one thing: it never says whether the address has an
 * account. See the note in `modules/auth/password-reset.ts` — the accounts here
 * are a named list of boutique hotels and their partners, so "is this hotel on
 * ARC" is commercially interesting information to hand to whoever asks.
 */
export default async function ForgotPasswordPage() {
  const { t } = await getTranslator()

  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBanner />
      <main className="mx-auto w-full max-w-md flex-1 px-5 py-10">
        <div className="flex items-center gap-2">
          <KeyRound className="text-jade-700 size-5" aria-hidden />
          <h1 className="font-display text-2xl font-semibold">{t('auth.reset.title')}</h1>
        </div>
        <p className="text-sand-600 mt-2 text-sm leading-relaxed">{t('auth.reset.lede')}</p>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="text-base">{t('auth.reset.emailLabel')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ForgotPasswordForm
              labels={{
                email: t('auth.reset.emailLabel'),
                submit: t('auth.reset.submit'),
                backToSignIn: t('auth.reset.backToSignIn'),
              }}
            />
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

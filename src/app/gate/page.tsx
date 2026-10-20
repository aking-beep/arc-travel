import { redirect } from 'next/navigation'
import { Lock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/field'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { enterDemoAction } from '@/app/gate/actions'
import { gatePassphrase, safeNext } from '@/lib/demo-gate'

export const metadata = { title: 'ARC Stay' }

/**
 * Front door for a hosted demo. Deliberately says nothing about what is behind
 * it: no property name, no partner names, no figures.
 */
export default async function GatePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>
}) {
  const { next, error } = await searchParams

  // Nothing to gate. Visiting /gate directly on an open build is a no-op.
  if (!gatePassphrase()) redirect('/')

  const target = safeNext(next)

  return (
    <main className="bg-sand-50 flex min-h-dvh items-center justify-center px-5 py-12">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-5 pt-6">
          <div className="flex items-center gap-2">
            <Lock className="text-jade-700 size-5" aria-hidden />
            <h1 className="font-display text-xl font-semibold">ARC Stay</h1>
          </div>
          <p className="text-sand-600 text-sm leading-relaxed">
            A private walkthrough of a demonstration build. Everything inside is
            synthetic — no real hotel, partner, price or booking. Enter the
            passphrase you were given.
          </p>

          <form action={enterDemoAction} className="space-y-4">
            <input type="hidden" name="next" value={target} />
            <Field label="Passphrase" htmlFor="passphrase">
              <Input
                id="passphrase"
                name="passphrase"
                type="password"
                autoComplete="current-password"
                autoFocus
                required
              />
            </Field>
            {error ? (
              <FormFeedback state={{ ok: false, message: 'That passphrase is not right.' }} />
            ) : null}
            <SubmitButton className="w-full" pendingLabel="Checking…">
              Enter
            </SubmitButton>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}

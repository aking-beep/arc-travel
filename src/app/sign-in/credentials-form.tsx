'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Field, Input } from '@/components/ui/field'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import { passwordSignInAction } from './actions'

/**
 * The real sign-in form.
 *
 * A client component only because `useActionState` requires one. The refusal
 * message is deliberately the same for an unknown address and a wrong
 * password — the service makes no distinction, and neither does this.
 */
export function CredentialsForm({ next }: { next: string }) {
  const [state, formAction] = useActionState(passwordSignInAction, emptyFormState)

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />

      <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          placeholder="you@yourhotel.com"
        />
      </Field>

      <Field label="Password" htmlFor="password" error={state.fieldErrors?.password}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>

      <FormFeedback state={state} />

      <SubmitButton className="w-full" pendingLabel="Signing in…">
        Sign in
      </SubmitButton>

      <p className="text-sand-600 text-sm">
        <Link href="/forgot-password" className="text-jade-800 underline underline-offset-4">
          Forgotten your password?
        </Link>
      </p>

      <p className="text-sand-600 text-sm">
        No account yet?{' '}
        <Link href="/sign-up" className="text-jade-800 underline underline-offset-4">
          Register your hotel
        </Link>
      </p>
    </form>
  )
}

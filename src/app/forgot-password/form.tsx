'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Field, Input } from '@/components/ui/field'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import { requestResetAction } from './actions'

export function ForgotPasswordForm({
  labels,
}: {
  labels: { email: string; submit: string; backToSignIn: string }
}) {
  const [state, formAction] = useActionState(requestResetAction, emptyFormState)

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Field label={labels.email} htmlFor="email" error={state.fieldErrors?.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          placeholder="you@yourhotel.com"
        />
      </Field>

      <FormFeedback state={state} />

      <SubmitButton className="w-full" pendingLabel="…">
        {labels.submit}
      </SubmitButton>

      <p className="text-sand-600 text-sm">
        <Link href="/sign-in" className="text-jade-800 underline underline-offset-4">
          {labels.backToSignIn}
        </Link>
      </p>
    </form>
  )
}

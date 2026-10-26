'use client'

import { useActionState } from 'react'
import { Field, Hint, Input } from '@/components/ui/field'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import { PASSWORD_MIN_LENGTH } from '@/lib/password-policy'
import { completeResetAction } from './actions'

export function ResetPasswordForm({
  token,
  labels,
}: {
  token: string
  labels: { newPassword: string; confirmPassword: string; submit: string }
}) {
  const [state, formAction] = useActionState(completeResetAction, emptyFormState)

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="token" value={token} />

      <Field
        label={labels.newPassword}
        htmlFor="password"
        error={state.fieldErrors?.password}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          required
        />
        <Hint>At least {PASSWORD_MIN_LENGTH} characters.</Hint>
      </Field>

      <Field
        label={labels.confirmPassword}
        htmlFor="confirmPassword"
        error={state.fieldErrors?.confirmPassword}
      >
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>

      <FormFeedback state={state} />

      <SubmitButton className="w-full" pendingLabel="…">
        {labels.submit}
      </SubmitButton>
    </form>
  )
}

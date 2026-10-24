'use client'

import { useActionState } from 'react'
import { Field, Hint, Input } from '@/components/ui/field'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import { PASSWORD_MIN_LENGTH } from '@/lib/password-policy'
import { acceptInvitationAction } from './actions'

export function AcceptInvitationForm({
  token,
  email,
  name,
}: {
  token: string
  email: string
  name: string
}) {
  const [state, formAction] = useActionState(acceptInvitationAction, emptyFormState)
  const error = (field: string) => state.fieldErrors?.[field]

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="token" value={token} />

      <Field label="Email" htmlFor="email">
        {/* Fixed by the invitation: this is what makes it an invitation rather
            than a sign-up form. */}
        <Input id="email" value={email} readOnly disabled autoComplete="username" />
      </Field>

      <Field label="Your name" htmlFor="name" error={error('name')}>
        <Input id="name" name="name" defaultValue={name} autoComplete="name" required />
      </Field>

      <Field
        label="Choose a password"
        htmlFor="password"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        error={error('password')}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          required
        />
      </Field>

      <Field label="Confirm password" htmlFor="confirmPassword" error={error('confirmPassword')}>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>

      <FormFeedback state={state} />

      <SubmitButton className="w-full" pendingLabel="Setting your password…">
        Set my password
      </SubmitButton>

      <Hint>This link works once, and only for this account.</Hint>
    </form>
  )
}

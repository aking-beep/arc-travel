'use client'

import { useActionState } from 'react'
import { Field, Hint, Input } from '@/components/ui/field'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import { claimStayAction } from './actions'

/**
 * Adds another booking to an account.
 *
 * The labels arrive as props rather than being looked up here: this is a
 * client component, and the locale lives in a cookie only the server render
 * may read.
 */
export interface ClaimFormLabels {
  reference: string
  email: string
  emailHint: string
  submit: string
  pending: string
  note: string
}

export function ClaimForm({ labels }: { labels: ClaimFormLabels }) {
  const [state, formAction] = useActionState(claimStayAction, emptyFormState)
  const error = (field: string) => state.fieldErrors?.[field]

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Field label={labels.reference} htmlFor="claim-reference" error={error('reference')}>
        <Input
          id="claim-reference"
          name="reference"
          autoCapitalize="characters"
          spellCheck={false}
          className="font-mono"
          required
        />
      </Field>

      <Field
        label={labels.email}
        htmlFor="claim-email"
        hint={labels.emailHint}
        error={error('email')}
      >
        <Input id="claim-email" name="email" type="email" autoComplete="email" />
      </Field>

      <Hint>{labels.note}</Hint>

      <FormFeedback state={state} />

      <SubmitButton variant="outline" pendingLabel={labels.pending}>
        {labels.submit}
      </SubmitButton>
    </form>
  )
}

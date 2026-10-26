'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Field, Hint, Input } from '@/components/ui/field'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import { PASSWORD_MIN_LENGTH } from '@/lib/password-policy'
import { portalAccountSignUpAction } from './actions'

/**
 * Two fields and a checkbox.
 *
 * The address is shown, not asked for: it is the one the property recorded,
 * the account will be keyed on it, and a person who is about to set a password
 * should be able to see which address it belongs to. It is not an input,
 * because changing it here would mean claiming a booking against an address
 * the property never had.
 */
export function PortalAccountForm({
  token,
  email,
  defaultName,
}: {
  token: string
  email: string
  defaultName: string
}) {
  const [state, formAction] = useActionState(portalAccountSignUpAction, emptyFormState)
  const error = (field: string) => state.fieldErrors?.[field]

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <input type="hidden" name="token" value={token} />

      <div className="border-sand-200 bg-sand-50 rounded-xl border px-4 py-3 text-sm">
        <p className="text-sand-500 text-xs tracking-wide uppercase">Your email</p>
        <p className="mt-0.5 font-medium break-all">{email}</p>
      </div>

      <Field label="Your name" htmlFor="name" error={error('name')}>
        <Input id="name" name="name" defaultValue={defaultName} autoComplete="name" required />
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters. Length matters more than punctuation.`}
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

      <div className="space-y-3">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="acceptedTerms"
            className="border-sand-300 text-jade-700 mt-0.5 size-4 rounded"
            required
          />
          <span>
            I accept the{' '}
            <Link href="/terms" className="text-jade-800 underline underline-offset-4">
              terms of service
            </Link>{' '}
            and the{' '}
            <Link href="/privacy" className="text-jade-800 underline underline-offset-4">
              privacy notice
            </Link>
            .
          </span>
        </label>
        {error('acceptedTerms') ? (
          <p className="text-xs font-medium text-red-700">{error('acceptedTerms')}</p>
        ) : null}

        <Hint>
          Nothing about this stay changes. The account is how you get back to it without the QR
          code, and where any other booking you claim will appear.
        </Hint>
      </div>

      <FormFeedback state={state} />

      <SubmitButton block pendingLabel="Creating your account…">
        Create the account
      </SubmitButton>
    </form>
  )
}

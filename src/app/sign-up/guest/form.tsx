'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Field, Hint, Input } from '@/components/ui/field'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import { PASSWORD_MIN_LENGTH } from '@/lib/password-policy'
import { guestSignUpAction } from './actions'

/**
 * Guest sign-up: the account and the booking it is proved with, in one
 * submission.
 *
 * `reference` is prefilled from the query string when the guest arrived from
 * their own portal, where the reference is already on screen. It stays an
 * editable field rather than a hidden one: the person typing it is proving
 * something, and a proof they cannot see is not one they can correct.
 */
export function GuestSignUpForm({ reference = '' }: { reference?: string }) {
  const [state, formAction] = useActionState(guestSignUpAction, emptyFormState)
  const error = (field: string) => state.fieldErrors?.[field]

  return (
    <form action={formAction} className="space-y-8" noValidate>
      <fieldset className="space-y-4">
        <legend className="font-display text-lg font-semibold">Your booking</legend>

        <Field
          label="Booking reference"
          htmlFor="reference"
          hint="On your confirmation, and at the top of your stay in the portal. Dashes are optional."
          error={error('reference')}
        >
          <Input
            id="reference"
            name="reference"
            defaultValue={reference}
            autoCapitalize="characters"
            spellCheck={false}
            className="font-mono"
            required
          />
        </Field>

        <Field
          label="Email"
          htmlFor="email"
          hint="The address the property has for you."
          error={error('email')}
        >
          <Input id="email" name="email" type="email" autoComplete="username" required />
        </Field>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="font-display text-lg font-semibold">Your account</legend>

        <Field label="Your name" htmlFor="name" error={error('name')}>
          <Input id="name" name="name" autoComplete="name" required />
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
      </fieldset>

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
          Your account shows the bookings you have claimed and nothing else. It does not change
          anything the property holds about you, and no payment details are taken here.
        </Hint>
      </div>

      <FormFeedback state={state} />

      <SubmitButton className="w-full" pendingLabel="Creating your account…">
        Create the account
      </SubmitButton>
    </form>
  )
}

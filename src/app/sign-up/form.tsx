'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Field, Hint, Input } from '@/components/ui/field'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import { PASSWORD_MIN_LENGTH } from '@/lib/password-policy'
import { signUpAction } from './actions'

/**
 * Hotel registration: the person, the business and the first property in one
 * submission, because the three are useless apart.
 */
export function SignUpForm() {
  const [state, formAction] = useActionState(signUpAction, emptyFormState)
  const error = (field: string) => state.fieldErrors?.[field]

  return (
    <form action={formAction} className="space-y-8" noValidate>
      <fieldset className="space-y-4">
        <legend className="font-display text-lg font-semibold">You</legend>

        <Field label="Your name" htmlFor="name" error={error('name')}>
          <Input id="name" name="name" autoComplete="name" required />
        </Field>

        <Field label="Email" htmlFor="email" error={error('email')}>
          <Input id="email" name="email" type="email" autoComplete="username" required />
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

        <Field
          label="Confirm password"
          htmlFor="confirmPassword"
          error={error('confirmPassword')}
        >
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
          />
        </Field>

        <Field label="Phone (optional)" htmlFor="contactPhone" error={error('contactPhone')}>
          <Input id="contactPhone" name="contactPhone" type="tel" autoComplete="tel" />
        </Field>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="font-display text-lg font-semibold">Your business</legend>

        <Field
          label="Business name"
          htmlFor="organizationName"
          hint="The group or company that owns the property."
          error={error('organizationName')}
        >
          <Input id="organizationName" name="organizationName" required />
        </Field>

        <Field label="Legal name (optional)" htmlFor="legalName" error={error('legalName')}>
          <Input id="legalName" name="legalName" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Country" htmlFor="countryCode" error={error('countryCode')}>
            <Input id="countryCode" name="countryCode" defaultValue="MX" maxLength={2} required />
          </Field>
          <Field label="Currency" htmlFor="currency" error={error('currency')}>
            <Input id="currency" name="currency" defaultValue="MXN" maxLength={3} required />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="font-display text-lg font-semibold">Your first property</legend>

        <Field label="Property name" htmlFor="propertyName" error={error('propertyName')}>
          <Input id="propertyName" name="propertyName" required />
        </Field>

        <Field
          label="One line about it (optional)"
          htmlFor="propertyTagline"
          error={error('propertyTagline')}
        >
          <Input id="propertyTagline" name="propertyTagline" />
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
          Registering creates a draft property. Nothing is published, nothing is marked verified,
          and no payment details are taken.
        </Hint>
      </div>

      <FormFeedback state={state} />

      <SubmitButton className="w-full" pendingLabel="Creating your account…">
        Create the account
      </SubmitButton>
    </form>
  )
}

'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Field, Input, Select } from '@/components/ui/field'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import { directSignUpAction } from './actions'

/**
 * Plan a trip without booking a room.
 *
 * The dates are a trip window and the copy says so twice, because a form with
 * "from" and "to" next to a hotel's name reads as a room booking, and this
 * reserves no room at all.
 *
 * The defaults are server-computed and passed in: a client component must not
 * read the clock during render.
 */
export function DirectSignUpForm({
  storefronts,
  defaultFromDate,
  defaultToDate,
}: {
  storefronts: Array<{ slug: string; name: string; placeName: string | null }>
  defaultFromDate: string
  defaultToDate: string
}) {
  const [state, formAction] = useActionState(directSignUpAction, emptyFormState)
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-4">
      <FormFeedback state={state} />

      <Field
        label="Where you want to book through"
        htmlFor="propertySlug"
        hint="A hotel curates what is on offer and stands behind it. You are not booking a room."
        error={errors.propertySlug}
      >
        <Select id="propertySlug" name="propertySlug" required>
          <option value="">Choose…</option>
          {storefronts.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.placeName ? `${s.name} — ${s.placeName}` : s.name}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="First day" htmlFor="fromDate" error={errors.fromDate}>
          <Input
            id="fromDate"
            name="fromDate"
            type="date"
            required
            defaultValue={defaultFromDate}
          />
        </Field>
        <Field label="Last day" htmlFor="toDate" error={errors.toDate}>
          <Input id="toDate" name="toDate" type="date" required defaultValue={defaultToDate} />
        </Field>
      </div>

      <Field
        label="How many of you"
        htmlFor="partySize"
        hint="Used to check a departure has room for all of you."
        error={errors.partySize}
      >
        <Input
          id="partySize"
          name="partySize"
          type="number"
          min={1}
          max={12}
          required
          defaultValue={2}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Your name" htmlFor="name" error={errors.name}>
          <Input id="name" name="name" required autoComplete="name" />
        </Field>
        <Field label="Email" htmlFor="email" error={errors.email}>
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Password"
          htmlFor="password"
          hint="At least twelve characters. This is how you get back to your plan."
          error={errors.password}
        >
          <Input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="new-password"
          />
        </Field>
        <Field label="Confirm password" htmlFor="confirmPassword" error={errors.confirmPassword}>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            autoComplete="new-password"
          />
        </Field>
      </div>

      <Field error={errors.acceptedTerms}>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="acceptedTerms"
            className="border-sand-300 text-jade-700 mt-0.5 size-4 rounded"
          />
          <span>
            I accept the{' '}
            <Link href="/terms" className="text-jade-800 underline underline-offset-4">
              terms
            </Link>{' '}
            and the{' '}
            <Link href="/privacy" className="text-jade-800 underline underline-offset-4">
              privacy notice
            </Link>
            .
          </span>
        </label>
      </Field>

      <SubmitButton>Create the account and start planning</SubmitButton>
    </form>
  )
}

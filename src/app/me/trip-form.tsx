'use client'

import { useActionState } from 'react'
import { Field, Input, Select } from '@/components/ui/field'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import { addTripAction } from './actions'

/**
 * Adds a trip with no room to an account that already exists.
 *
 * Labels and date defaults arrive as props: this is a client component, so it
 * may neither read the locale cookie nor the clock during render.
 */
export interface TripFormLabels {
  property: string
  from: string
  to: string
  party: string
  submit: string
  pending: string
}

export function TripForm({
  labels,
  storefronts,
  defaultFromDate,
  defaultToDate,
}: {
  labels: TripFormLabels
  storefronts: Array<{ slug: string; name: string; placeName: string | null }>
  defaultFromDate: string
  defaultToDate: string
}) {
  const [state, formAction] = useActionState(addTripAction, emptyFormState)
  const error = (field: string) => state.fieldErrors?.[field]

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Field label={labels.property} htmlFor="trip-property" error={error('propertySlug')}>
        <Select id="trip-property" name="propertySlug" required>
          <option value="">—</option>
          {storefronts.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.placeName ? `${s.name} — ${s.placeName}` : s.name}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={labels.from} htmlFor="trip-from" error={error('fromDate')}>
          <Input
            id="trip-from"
            name="fromDate"
            type="date"
            required
            defaultValue={defaultFromDate}
          />
        </Field>
        <Field label={labels.to} htmlFor="trip-to" error={error('toDate')}>
          <Input id="trip-to" name="toDate" type="date" required defaultValue={defaultToDate} />
        </Field>
      </div>

      <Field label={labels.party} htmlFor="trip-party" error={error('partySize')}>
        <Input id="trip-party" name="partySize" type="number" min={1} max={12} defaultValue={2} />
      </Field>

      <FormFeedback state={state} />

      <SubmitButton variant="outline" pendingLabel={labels.pending}>
        {labels.submit}
      </SubmitButton>
    </form>
  )
}

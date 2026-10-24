'use client'

import { useActionState, useState } from 'react'
import { Field, Hint, Input, Select, Textarea } from '@/components/ui/field'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import {
  saveCommissionDefaultsAction,
  saveCommissionRuleAction,
  toggleCommissionRuleAction,
} from './actions'

const CATEGORIES = ['SURF', 'WELLNESS', 'ADVENTURE', 'DINING', 'TRANSPORT', 'CULTURE'] as const

export function CommissionDefaultsForm({
  hotelBps,
  platformBps,
}: {
  hotelBps: number
  platformBps: number
}) {
  const [state, formAction] = useActionState(saveCommissionDefaultsAction, emptyFormState)

  return (
    <form action={formAction} className="space-y-4">
      <FormFeedback state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Your share (%)" htmlFor="d-hotel" error={state.fieldErrors?.hotelBps}>
          <Input
            id="d-hotel"
            name="hotelPct"
            inputMode="decimal"
            defaultValue={(hotelBps / 100).toFixed(1)}
            required
          />
        </Field>
        <Field label="ARC share (%)" htmlFor="d-platform" error={state.fieldErrors?.platformBps}>
          <Input
            id="d-platform"
            name="platformPct"
            inputMode="decimal"
            defaultValue={(platformBps / 100).toFixed(1)}
            required
          />
        </Field>
      </div>
      <Hint>
        Used when no rule below matches. The partner takes the remainder, including every rounding
        centavo, so the three shares always add back up to the gross.
      </Hint>
      <SubmitButton pendingLabel="Saving…">Save the defaults</SubmitButton>
    </form>
  )
}

export function CommissionRuleForm({
  experiences,
}: {
  experiences: Array<{ id: string; title: string }>
}) {
  const [state, formAction] = useActionState(saveCommissionRuleAction, emptyFormState)
  // Which unit the two share fields are in. Interactivity, not a clock read.
  const [basis, setBasis] = useState<'PERCENT_OF_GROSS' | 'FIXED_PER_UNIT'>('PERCENT_OF_GROSS')
  const fixed = basis === 'FIXED_PER_UNIT'

  return (
    <form action={formAction} className="space-y-4">
      <FormFeedback state={state} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="One experience"
          htmlFor="r-experience"
          hint="The most specific scope. Leave empty for a broader rule."
          error={state.fieldErrors?.experienceId}
        >
          <Select id="r-experience" name="experienceId" defaultValue="">
            <option value="">Any experience</option>
            {experiences.map((experience) => (
              <option key={experience.id} value={experience.id}>
                {experience.title}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Or a category" htmlFor="r-category" error={state.fieldErrors?.category}>
          <Select id="r-category" name="category" defaultValue="">
            <option value="">Any category</option>
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Basis" htmlFor="r-basis">
          <Select
            id="r-basis"
            name="basis"
            value={basis}
            onChange={(event) =>
              setBasis(event.target.value as 'PERCENT_OF_GROSS' | 'FIXED_PER_UNIT')
            }
          >
            <option value="PERCENT_OF_GROSS">Percentage of gross</option>
            <option value="FIXED_PER_UNIT">Fixed amount per person</option>
          </Select>
        </Field>

        <Field
          label="Priority"
          htmlFor="r-priority"
          hint="Breaks a tie between two rules of the same scope. Higher wins."
        >
          <Input id="r-priority" name="priority" type="number" min={0} max={1000} defaultValue={0} />
        </Field>

        <Field
          label={fixed ? 'Your share (MXN per person)' : 'Your share (%)'}
          htmlFor="r-hotel"
          error={state.fieldErrors?.hotelShare}
        >
          <Input id="r-hotel" name="hotelShare" inputMode="decimal" required />
        </Field>

        <Field
          label={fixed ? 'ARC share (MXN per person)' : 'ARC share (%)'}
          htmlFor="r-platform"
          error={state.fieldErrors?.platformShare}
        >
          <Input id="r-platform" name="platformShare" inputMode="decimal" required />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="scopeProperty"
          className="border-sand-300 text-jade-700 size-4 rounded"
          defaultChecked
        />
        Only this property
      </label>

      <Field label="Note" htmlFor="r-note" error={state.fieldErrors?.note}>
        <Textarea id="r-note" name="note" rows={2} maxLength={240} />
      </Field>

      <SubmitButton pendingLabel="Saving…">Add the rule</SubmitButton>
    </form>
  )
}

export function ToggleRuleForm({ ruleId, isActive }: { ruleId: string; isActive: boolean }) {
  const [state, formAction] = useActionState(toggleCommissionRuleAction, emptyFormState)

  return (
    <form action={formAction}>
      <input type="hidden" name="ruleId" value={ruleId} />
      <input type="hidden" name="isActive" value={isActive ? 'false' : 'true'} />
      <SubmitButton size="sm" variant="outline" pendingLabel="Updating…">
        {isActive ? 'Deactivate' : 'Reactivate'}
      </SubmitButton>
      <FormFeedback state={state} className="mt-2" />
    </form>
  )
}

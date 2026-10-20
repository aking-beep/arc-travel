'use client'

import { useActionState } from 'react'
import { Field, Input, Select } from '@/components/ui/field'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import { closeSlotAction, confirmBookingAction, scheduleAvailabilityAction } from './actions'

const WEEKDAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
] as const

/**
 * Bulk availability.
 *
 * An operator who runs 07:30 and 10:00 every day except Sunday should say that
 * once. Re-running the same schedule is harmless — the unique constraint on
 * (experience, start time) means duplicates are skipped, not rejected.
 */
export function ScheduleForm({
  experiences,
  defaultFromDate,
  defaultToDate,
}: {
  experiences: Array<{ id: string; titleEn: string; defaultCapacity: number }>
  /** Supplied by the server: a client component must not read the clock. */
  defaultFromDate: string
  defaultToDate: string
}) {
  const [state, formAction] = useActionState(scheduleAvailabilityAction, emptyFormState)
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-4">
      <FormFeedback state={state} />

      <Field label="Experience" htmlFor="experienceId" error={errors.experienceId}>
        <Select id="experienceId" name="experienceId" required>
          <option value="">Choose…</option>
          {experiences.map((e) => (
            <option key={e.id} value={e.id}>
              {e.titleEn}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="From" htmlFor="fromDate" error={errors.fromDate}>
          <Input id="fromDate" name="fromDate" type="date" required defaultValue={defaultFromDate} />
        </Field>
        <Field label="To" htmlFor="toDate" error={errors.toDate}>
          <Input id="toDate" name="toDate" type="date" required defaultValue={defaultToDate} />
        </Field>
      </div>

      <Field
        label="Start times"
        htmlFor="startTimes"
        hint="Comma-separated, 24-hour. For example 07:30, 10:00, 15:30."
        error={errors.startTimes}
      >
        <Input id="startTimes" name="startTimes" required placeholder="07:30, 10:00" />
      </Field>

      <Field
        label="Places per departure"
        htmlFor="capacity"
        error={errors.capacity}
        hint="How many people you can genuinely take, not how many you would like to."
      >
        <Input
          id="capacity"
          name="capacity"
          type="number"
          min={1}
          max={60}
          required
          defaultValue={experiences[0]?.defaultCapacity ?? 6}
        />
      </Field>

      <fieldset>
        <legend className="text-sand-800 text-sm font-medium">Days</legend>
        <p className="text-sand-500 text-xs">Leave all unchecked to run every day.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {WEEKDAYS.map((day) => (
            <label
              key={day.value}
              className="border-sand-300 has-checked:border-jade-700 has-checked:bg-jade-50 flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm"
            >
              <input
                type="checkbox"
                name="weekdays"
                value={day.value}
                className="accent-jade-800 size-3.5"
              />
              {day.label}
            </label>
          ))}
        </div>
      </fieldset>

      <SubmitButton pendingLabel="Scheduling…">Add departures</SubmitButton>
    </form>
  )
}

export function CloseSlotForm({ slotId, booked }: { slotId: string; booked: number }) {
  const [state, formAction] = useActionState(closeSlotAction, emptyFormState)

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="slotId" value={slotId} />
      <input
        type="hidden"
        name="reason"
        value={booked > 0 ? 'Closed by the partner with guests already booked.' : 'Closed by the partner.'}
      />
      <SubmitButton variant="ghost" size="sm" pendingLabel="Closing…">
        Close
      </SubmitButton>
      <FormFeedback state={state} />
    </form>
  )
}

export function ConfirmBookingForm({ orderItemId }: { orderItemId: string }) {
  const [state, formAction] = useActionState(confirmBookingAction, emptyFormState)

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="orderItemId" value={orderItemId} />
      <SubmitButton size="sm" pendingLabel="Confirming…">
        Confirm
      </SubmitButton>
      <FormFeedback state={state} />
    </form>
  )
}

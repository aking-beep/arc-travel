'use client'

import { useActionState } from 'react'
import { Field, Hint, Input, Select, Textarea } from '@/components/ui/field'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import { createStayAction, reissueTokenAction, setStayStatusAction } from './actions'

/**
 * The front desk's forms.
 *
 * `defaultCheckIn` and `defaultCheckOut` arrive as props: a client component
 * must not read the clock during render, and these are dates derived from one.
 */
export function CreateStayForm({
  roomTypes,
  defaultCheckIn,
  defaultCheckOut,
}: {
  roomTypes: Array<{ id: string; code: string; name: string }>
  defaultCheckIn: string
  defaultCheckOut: string
}) {
  const [state, formAction] = useActionState(createStayAction, emptyFormState)
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-4">
      <FormFeedback state={state} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="First name" htmlFor="g-first" error={errors.firstName}>
          <Input id="g-first" name="firstName" required />
        </Field>
        <Field label="Last name" htmlFor="g-last" error={errors.lastName}>
          <Input id="g-last" name="lastName" required />
        </Field>
        <Field
          label="Email"
          htmlFor="g-email"
          hint="Identifies the guest at this property, so a returning guest keeps their preferences."
          error={errors.email}
        >
          <Input id="g-email" name="email" type="email" required />
        </Field>
        <Field label="Phone" htmlFor="g-phone" error={errors.phone}>
          <Input id="g-phone" name="phone" type="tel" />
        </Field>
        <Field label="Language" htmlFor="g-locale" error={errors.locale}>
          <Select id="g-locale" name="locale" defaultValue="EN">
            <option value="EN">English</option>
            <option value="ES">Español</option>
          </Select>
        </Field>
        <Field label="Country code" htmlFor="g-country" error={errors.countryCode}>
          <Input id="g-country" name="countryCode" maxLength={2} placeholder="MX" />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Check-in" htmlFor="g-in" error={errors.checkIn}>
          <Input id="g-in" name="checkIn" type="date" defaultValue={defaultCheckIn} required />
        </Field>
        <Field label="Check-out" htmlFor="g-out" error={errors.checkOut}>
          <Input id="g-out" name="checkOut" type="date" defaultValue={defaultCheckOut} required />
        </Field>
        <Field label="Adults" htmlFor="g-adults" error={errors.adults}>
          <Input id="g-adults" name="adults" type="number" min={1} max={12} defaultValue={2} required />
        </Field>
        <Field label="Children" htmlFor="g-children" error={errors.children}>
          <Input id="g-children" name="children" type="number" min={0} max={12} defaultValue={0} />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Room type" htmlFor="g-room" error={errors.roomTypeId}>
          <Select id="g-room" name="roomTypeId" defaultValue="">
            <option value="">Not assigned</option>
            {roomTypes.map((room) => (
              <option key={room.id} value={room.id}>
                {room.code} — {room.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Room revenue (MXN)"
          htmlFor="g-revenue"
          hint="What the room itself earned. Kept separate from experience revenue."
          error={errors.roomRevenueMinor}
        >
          <Input id="g-revenue" name="roomRevenue" inputMode="decimal" placeholder="0" />
        </Field>
      </div>

      <Field label="Arrival notes" htmlFor="g-notes" error={errors.arrivalNotes}>
        <Textarea id="g-notes" name="arrivalNotes" rows={2} maxLength={500} />
      </Field>

      <Hint>
        Creating the stay mints the guest’s portal link. It is shown once here and on the arrival
        card, and it is the guest’s only credential — treat it like a room key.
      </Hint>

      <SubmitButton pendingLabel="Creating…">Create the stay</SubmitButton>
    </form>
  )
}

/** Issues a replacement link, which invalidates the previous one. */
export function ReissueTokenForm({ stayId }: { stayId: string }) {
  const [state, formAction] = useActionState(reissueTokenAction, emptyFormState)

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="stayId" value={stayId} />
      <SubmitButton size="sm" variant="outline" pendingLabel="Issuing…">
        Issue a new link
      </SubmitButton>
      <FormFeedback state={state} />
    </form>
  )
}

export function StayStatusForm({
  stayId,
  options,
}: {
  stayId: string
  options: Array<{ value: string; label: string }>
}) {
  const [state, formAction] = useActionState(setStayStatusAction, emptyFormState)

  if (options.length === 0) return null

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="stayId" value={stayId} />
      <Field label="Move to" htmlFor={`status-${stayId}`}>
        <Select id={`status-${stayId}`} name="status" defaultValue={options[0]!.value}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
      <SubmitButton size="sm" variant="outline" pendingLabel="Updating…">
        Update
      </SubmitButton>
      <FormFeedback state={state} className="w-full" />
    </form>
  )
}

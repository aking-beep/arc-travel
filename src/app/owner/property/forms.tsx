'use client'

import { useActionState } from 'react'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import { addAmenityAction, updateProfileAction, upsertRoomTypeAction } from './actions'

const CATEGORIES = ['SURF', 'WELLNESS', 'ADVENTURE', 'DINING', 'TRANSPORT', 'CULTURE'] as const

export function PropertyProfileForm({
  values,
  places,
}: {
  values: {
    name: string
    tagline: string
    description: string
    houseNotes: string
    checkInTime: string
    checkOutTime: string
    defaultLocale: string
    brandPrimary: string
    brandAccent: string
    placeId: string
    contactEmail: string
    contactPhone: string
  }
  places: Array<{ id: string; name: string; kind: string }>
}) {
  const [state, formAction] = useActionState(updateProfileAction, emptyFormState)
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-4">
      <FormFeedback state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Property name" htmlFor="name" error={errors.name}>
          <Input id="name" name="name" required defaultValue={values.name} />
        </Field>
        <Field label="Tagline" htmlFor="tagline" hint="One line, shown to guests.">
          <Input id="tagline" name="tagline" defaultValue={values.tagline} maxLength={160} />
        </Field>
        <Field
          label="Neighbourhood"
          htmlFor="placeId"
          hint="Drives every travel-time estimate in a guest itinerary."
          error={errors.placeId}
        >
          <Select id="placeId" name="placeId" defaultValue={values.placeId}>
            <option value="">Not set</option>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.kind.toLowerCase().replace('_', ' ')})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Default language" htmlFor="defaultLocale">
          <Select id="defaultLocale" name="defaultLocale" defaultValue={values.defaultLocale}>
            <option value="EN">English</option>
            <option value="ES">Español</option>
          </Select>
        </Field>
        <Field label="Check-in" htmlFor="checkInTime" error={errors.checkInTime}>
          <Input id="checkInTime" name="checkInTime" type="time" required defaultValue={values.checkInTime} />
        </Field>
        <Field label="Check-out" htmlFor="checkOutTime" error={errors.checkOutTime}>
          <Input id="checkOutTime" name="checkOutTime" type="time" required defaultValue={values.checkOutTime} />
        </Field>
        <Field label="Contact email" htmlFor="contactEmail" error={errors.contactEmail}>
          <Input id="contactEmail" name="contactEmail" type="email" defaultValue={values.contactEmail} />
        </Field>
        <Field label="Contact phone" htmlFor="contactPhone">
          <Input id="contactPhone" name="contactPhone" defaultValue={values.contactPhone} />
        </Field>
        <Field label="Brand colour" htmlFor="brandPrimary" error={errors.brandPrimary}>
          <Input id="brandPrimary" name="brandPrimary" type="color" defaultValue={values.brandPrimary} className="h-11 p-1" />
        </Field>
        <Field label="Accent colour" htmlFor="brandAccent" error={errors.brandAccent}>
          <Input id="brandAccent" name="brandAccent" type="color" defaultValue={values.brandAccent} className="h-11 p-1" />
        </Field>
        <Field label="Description" htmlFor="description" className="sm:col-span-2">
          <Textarea id="description" name="description" rows={4} defaultValue={values.description} />
        </Field>
        <Field
          label="House notes"
          htmlFor="houseNotes"
          className="sm:col-span-2"
          hint="Practical things a guest needs: breakfast hours, where the boards live, the stairway."
        >
          <Textarea id="houseNotes" name="houseNotes" rows={4} defaultValue={values.houseNotes} />
        </Field>
      </div>
      <SubmitButton>Save profile</SubmitButton>
    </form>
  )
}

export function RoomTypeForm() {
  const [state, formAction] = useActionState(upsertRoomTypeAction, emptyFormState)
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-4">
      <FormFeedback state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code" htmlFor="rt-code" hint="Short, uppercase. Reusing a code edits it." error={errors.code}>
          <Input id="rt-code" name="code" required maxLength={16} placeholder="JARDIN" />
        </Field>
        <Field label="Name" htmlFor="rt-name" error={errors.name}>
          <Input id="rt-name" name="name" required placeholder="Casita Jardín" />
        </Field>
        <Field label="Rooms of this type" htmlFor="rt-count" error={errors.roomCount}>
          <Input id="rt-count" name="roomCount" type="number" min={1} max={200} required defaultValue={1} />
        </Field>
        <Field label="Sleeps" htmlFor="rt-occ" error={errors.maxOccupancy}>
          <Input id="rt-occ" name="maxOccupancy" type="number" min={1} max={12} required defaultValue={2} />
        </Field>
        <Field label="Nightly rate (MXN)" htmlFor="rt-rate" error={errors.baseRateMinor}>
          <Input id="rt-rate" name="baseRate" type="number" min={0} required defaultValue={0} />
        </Field>
        <Field label="Description" htmlFor="rt-desc">
          <Input id="rt-desc" name="description" maxLength={600} />
        </Field>
      </div>
      <SubmitButton variant="outline" size="sm">
        Save room type
      </SubmitButton>
    </form>
  )
}

export function AmenityForm() {
  const [state, formAction] = useActionState(addAmenityAction, emptyFormState)
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-4">
      <FormFeedback state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amenity" htmlFor="am-name" error={errors.name}>
          <Input id="am-name" name="name" required placeholder="Board storage and rinse" />
        </Field>
        <Field label="Category" htmlFor="am-cat">
          <Select id="am-cat" name="category" defaultValue="WELLNESS">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Description" htmlFor="am-desc" className="sm:col-span-2">
          <Input id="am-desc" name="description" maxLength={600} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isIncluded" defaultChecked className="accent-jade-800 size-4" />
        Included in the room rate
      </label>
      <SubmitButton variant="outline" size="sm">
        Add amenity
      </SubmitButton>
    </form>
  )
}

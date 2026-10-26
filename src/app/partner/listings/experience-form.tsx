'use client'

import { useActionState } from 'react'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import { createOwnExperienceAction, updateOwnExperienceAction } from '../actions'

export interface ExperienceFormOptions {
  storefronts: Array<{ propertyId: string; name: string; hotelCommissionBps: number }>
  activities: Array<{ id: string; name: string; category: string; guideRequired: boolean }>
  places: Array<{ id: string; name: string }>
}

export interface ExperienceFormDefaults {
  propertyId: string
  activityId: string
  placeId: string | null
  titleEn: string
  titleEs: string | null
  summaryEn: string | null
  summaryEs: string | null
  descriptionEn: string | null
  descriptionEs: string | null
  durationMinutes: number
  minParty: number
  maxParty: number
  defaultCapacity: number
  minAgeYears: number | null
  includesTransfer: boolean
  guideIncluded: boolean
  meetingPoint: string | null
  whatToBringEn: string | null
  whatToBringEs: string | null
  cancellationPolicyHours: number
  /** Pesos, not centavos: the form edge is where the conversion happens. */
  price: string
}

const BLANK: ExperienceFormDefaults = {
  propertyId: '',
  activityId: '',
  placeId: null,
  titleEn: '',
  titleEs: null,
  summaryEn: null,
  summaryEs: null,
  descriptionEn: null,
  descriptionEs: null,
  durationMinutes: 120,
  minParty: 1,
  maxParty: 6,
  defaultCapacity: 6,
  minAgeYears: null,
  includesTransfer: false,
  guideIncluded: true,
  meetingPoint: null,
  whatToBringEn: null,
  whatToBringEs: null,
  cancellationPolicyHours: 24,
  price: '',
}

/**
 * A partner drafting or editing their own listing.
 *
 * There is no status control and no supplier field. The status is `DRAFT` until
 * the hotel publishes it, and the supplier is whoever is signed in — a form
 * that offered either would be offering a partner a decision that is not
 * theirs.
 *
 * The ability range is not asked for either: it comes from the activity, which
 * is what ADR-018 and ADR-017 rest on. A partner choosing "beginner" on a
 * heavy-water activity would be turning the conditions gate off for the people
 * it exists to protect.
 */
export function ExperienceForm({
  mode,
  options,
  defaults = BLANK,
  experienceId,
  disabled = false,
}: {
  mode: 'create' | 'edit'
  options: ExperienceFormOptions
  defaults?: ExperienceFormDefaults
  experienceId?: string
  /** Set while the listing is published: the service refuses, so the form says so. */
  disabled?: boolean
}) {
  const [state, formAction] = useActionState(
    mode === 'create' ? createOwnExperienceAction : updateOwnExperienceAction,
    emptyFormState,
  )
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-5">
      <FormFeedback state={state} />
      {experienceId ? <input type="hidden" name="experienceId" value={experienceId} /> : null}

      {disabled ? (
        <p
          role="status"
          className="max-w-prose rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          This listing is live on the hotel’s storefront, so the details are locked. Somebody may
          have it in their basket at the duration and meeting point below. Pause it to edit, or ask
          the hotel to. The price is the exception — you can change that below at any time.
        </p>
      ) : null}

      <fieldset disabled={disabled} className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Which hotel"
            htmlFor="propertyId"
            hint="One listing sells through one storefront."
            error={errors.propertyId}
          >
            <Select id="propertyId" name="propertyId" required defaultValue={defaults.propertyId}>
              <option value="">Choose…</option>
              {options.storefronts.map((s) => (
                <option key={s.propertyId} value={s.propertyId}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Kind of activity"
            htmlFor="activityId"
            hint="This sets the hours it may run and, where it matters, the conditions check."
            error={errors.activityId}
          >
            <Select id="activityId" name="activityId" required defaultValue={defaults.activityId}>
              <option value="">Choose…</option>
              {options.activities.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title (English)" htmlFor="titleEn" error={errors.titleEn}>
            <Input id="titleEn" name="titleEn" required defaultValue={defaults.titleEn} />
          </Field>
          <Field label="Título (español)" htmlFor="titleEs" error={errors.titleEs}>
            <Input id="titleEs" name="titleEs" defaultValue={defaults.titleEs ?? ''} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="One line (English)"
            htmlFor="summaryEn"
            hint="What a guest sees in a list."
            error={errors.summaryEn}
          >
            <Input id="summaryEn" name="summaryEn" defaultValue={defaults.summaryEn ?? ''} />
          </Field>
          <Field label="Una línea (español)" htmlFor="summaryEs" error={errors.summaryEs}>
            <Input id="summaryEs" name="summaryEs" defaultValue={defaults.summaryEs ?? ''} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Description (English)" htmlFor="descriptionEn" error={errors.descriptionEn}>
            <Textarea
              id="descriptionEn"
              name="descriptionEn"
              rows={6}
              defaultValue={defaults.descriptionEn ?? ''}
            />
          </Field>
          <Field label="Descripción (español)" htmlFor="descriptionEs" error={errors.descriptionEs}>
            <Textarea
              id="descriptionEs"
              name="descriptionEs"
              rows={6}
              defaultValue={defaults.descriptionEs ?? ''}
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label="How long (minutes)"
            htmlFor="durationMinutes"
            error={errors.durationMinutes}
          >
            <Input
              id="durationMinutes"
              name="durationMinutes"
              type="number"
              min={15}
              max={720}
              required
              defaultValue={defaults.durationMinutes}
            />
          </Field>
          <Field
            label="Smallest party"
            htmlFor="minParty"
            hint="Below this you will not run it."
            error={errors.minParty}
          >
            <Input
              id="minParty"
              name="minParty"
              type="number"
              min={1}
              max={40}
              required
              defaultValue={defaults.minParty}
            />
          </Field>
          <Field label="Largest party" htmlFor="maxParty" error={errors.maxParty}>
            <Input
              id="maxParty"
              name="maxParty"
              type="number"
              min={1}
              max={40}
              required
              defaultValue={defaults.maxParty}
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label="Places per departure"
            htmlFor="defaultCapacity"
            hint="How many you can genuinely take."
            error={errors.defaultCapacity}
          >
            <Input
              id="defaultCapacity"
              name="defaultCapacity"
              type="number"
              min={1}
              max={60}
              required
              defaultValue={defaults.defaultCapacity}
            />
          </Field>
          <Field
            label="Minimum age"
            htmlFor="minAgeYears"
            hint="Leave empty if there is none."
            error={errors.minAgeYears}
          >
            <Input
              id="minAgeYears"
              name="minAgeYears"
              type="number"
              min={0}
              max={99}
              defaultValue={defaults.minAgeYears ?? ''}
            />
          </Field>
          <Field
            label="Free cancellation up to (hours)"
            htmlFor="cancellationPolicyHours"
            error={errors.cancellationPolicyHours}
          >
            <Input
              id="cancellationPolicyHours"
              name="cancellationPolicyHours"
              type="number"
              min={0}
              max={336}
              required
              defaultValue={defaults.cancellationPolicyHours}
            />
          </Field>
        </div>

        <Field
          label="Where you meet"
          htmlFor="meetingPoint"
          hint="Specific enough that a guest who has never been here finds it."
          error={errors.meetingPoint}
        >
          <Input id="meetingPoint" name="meetingPoint" defaultValue={defaults.meetingPoint ?? ''} />
        </Field>

        <Field
          label="Where it happens"
          htmlFor="placeId"
          hint="Optional. Used for travel times when a guest plans a day."
          error={errors.placeId}
        >
          <Select id="placeId" name="placeId" defaultValue={defaults.placeId ?? ''}>
            <option value="">Not set</option>
            {options.places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="What to bring (English)" htmlFor="whatToBringEn" error={errors.whatToBringEn}>
            <Textarea
              id="whatToBringEn"
              name="whatToBringEn"
              rows={3}
              defaultValue={defaults.whatToBringEn ?? ''}
            />
          </Field>
          <Field label="Qué traer (español)" htmlFor="whatToBringEs" error={errors.whatToBringEs}>
            <Textarea
              id="whatToBringEs"
              name="whatToBringEs"
              rows={3}
              defaultValue={defaults.whatToBringEs ?? ''}
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-5">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="includesTransfer"
              defaultChecked={defaults.includesTransfer}
              className="border-sand-300 text-jade-700 size-4 rounded"
            />
            Pick-up and drop-off included
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="guideIncluded"
              defaultChecked={defaults.guideIncluded}
              className="border-sand-300 text-jade-700 size-4 rounded"
            />
            A guide or instructor comes with it
          </label>
        </div>

        {/*
          * Price is asked for once, and only when there is no price yet.
          *
          * On edit this field used to appear with a hint saying it was the
          * same as the price form below. It was not: `updateOwnExperience`
          * never wrote it, so a partner who changed the price here was told
          * the listing was saved while the live price row stayed as it was.
          * The price form is the one that works, in every state including
          * published, so on edit this is its job alone.
          */}
        {mode === 'create' ? (
          <Field
            label="Price per person (pesos)"
            htmlFor="price"
            hint="What you charge. ARC and the hotel take their share out of this, and your earnings page shows what reaches you."
            error={errors.price ?? errors.priceMinor}
          >
            <Input
              id="price"
              name="price"
              inputMode="decimal"
              required
              defaultValue={defaults.price}
            />
          </Field>
        ) : null}
      </fieldset>

      {disabled ? null : (
        <SubmitButton>{mode === 'create' ? 'Save as a draft' : 'Save'}</SubmitButton>
      )}
    </form>
  )
}

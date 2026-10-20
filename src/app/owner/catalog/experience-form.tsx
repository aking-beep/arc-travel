'use client'

import { useActionState, useState } from 'react'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState, type FormState } from '@/lib/form-state'

const ABILITIES = ['BEGINNER', 'IMPROVER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'] as const
const CATEGORIES = ['SURF', 'WELLNESS', 'ADVENTURE', 'DINING', 'TRANSPORT', 'CULTURE'] as const

export interface ActivityOption {
  id: string
  name: string
  category: string
  minAbility: string
  maxAbility: string
  guideRequired: boolean
  maxSafeRisk: string
  typicalDurationMinutes: number
  minAgeYears: number | null
}

export interface SupplierOption {
  id: string
  name: string
  verification: string
}

export interface PlaceOption {
  id: string
  name: string
  kind: string
}

export interface ExperienceFormValues {
  experienceId?: string
  supplierId: string
  activityId: string
  placeId: string
  titleEn: string
  titleEs: string
  summaryEn: string
  summaryEs: string
  descriptionEn: string
  descriptionEs: string
  category: string
  durationMinutes: number
  minAbility: string
  maxAbility: string
  minParty: number
  maxParty: number
  minAgeYears: number | ''
  defaultCapacity: number
  includesTransfer: boolean
  guideIncluded: boolean
  meetingPoint: string
  whatToBringEn: string
  whatToBringEs: string
  cancellationPolicyHours: number
  /** Pesos, not centavos: this is the number the owner types. */
  price: string
  bookingFee: string
}

/**
 * The experience editor.
 *
 * The one piece of real logic in the client: selecting an activity narrows the
 * ability range and forces a guide where the activity requires one, and the
 * form says so in plain language. The server clamps these again regardless —
 * this is a courtesy, not the enforcement.
 */
export function ExperienceForm({
  action,
  values,
  suppliers,
  activities,
  places,
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>
  values: ExperienceFormValues
  suppliers: SupplierOption[]
  activities: ActivityOption[]
  places: PlaceOption[]
  submitLabel: string
}) {
  const [state, formAction] = useActionState(action, emptyFormState)
  const [activityId, setActivityId] = useState(values.activityId)
  const [category, setCategory] = useState(values.category)

  const activity = activities.find((a) => a.id === activityId)
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-6">
      {values.experienceId ? (
        <input type="hidden" name="experienceId" value={values.experienceId} />
      ) : null}

      <FormFeedback state={state} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What it is</CardTitle>
          <p className="text-sand-600 text-sm">
            The activity type carries the safety rules. Pick it first — it decides who this can be
            offered to and whether a guide is mandatory.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Activity type" htmlFor="activityId" error={errors.activityId}>
            <Select
              id="activityId"
              name="activityId"
              required
              value={activityId}
              onChange={(e) => setActivityId(e.target.value)}
            >
              <option value="">Choose…</option>
              {activities.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.category} — {a.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Partner" htmlFor="supplierId" error={errors.supplierId}>
            <Select id="supplierId" name="supplierId" required defaultValue={values.supplierId}>
              <option value="">Choose…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.verification === 'VERIFIED' ? '' : ' (unverified)'}
                </option>
              ))}
            </Select>
          </Field>

          {activity ? (
            <div className="border-jade-200 bg-jade-50 text-jade-900 rounded-xl border px-4 py-3 text-sm sm:col-span-2">
              <p className="font-medium">{activity.name} constraints</p>
              <ul className="mt-1.5 space-y-1 text-[0.8125rem]">
                <li>
                  Suitable for{' '}
                  <strong>
                    {activity.minAbility} to {activity.maxAbility}
                  </strong>{' '}
                  only. A narrower range is allowed; a wider one is not.
                </li>
                <li>
                  Will not be recommended above{' '}
                  <strong>{activity.maxSafeRisk}</strong> conditions risk.
                </li>
                <li>
                  {activity.guideRequired
                    ? 'A certified guide is mandatory and cannot be turned off.'
                    : 'No guide required.'}
                </li>
                {activity.minAgeYears ? (
                  <li>
                    Minimum age <strong>{activity.minAgeYears}</strong>.
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}

          <Field
            label="Category"
            htmlFor="category"
            error={errors.category}
            hint={
              activity
                ? 'Set by the activity type. A surf lesson cannot be filed under dining.'
                : undefined
            }
          >
            <Select
              id="category"
              name="category"
              value={activity?.category ?? category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={Boolean(activity)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Place" htmlFor="placeId" hint="Where it happens. Drives travel time.">
            <Select id="placeId" name="placeId" defaultValue={values.placeId}>
              <option value="">Not tied to one place</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How you describe it</CardTitle>
          <p className="text-sand-600 text-sm">
            Write it the way you would say it at the desk. Spanish is optional but Spanish-speaking
            guests will see the English text without it.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Title (English)" htmlFor="titleEn" error={errors.titleEn}>
            <Input id="titleEn" name="titleEn" required defaultValue={values.titleEn} maxLength={120} />
          </Field>
          <Field label="Título (Español)" htmlFor="titleEs" error={errors.titleEs}>
            <Input id="titleEs" name="titleEs" defaultValue={values.titleEs} maxLength={120} />
          </Field>
          <Field label="One-line summary (English)" htmlFor="summaryEn" error={errors.summaryEn}>
            <Input id="summaryEn" name="summaryEn" defaultValue={values.summaryEn} maxLength={240} />
          </Field>
          <Field label="Resumen (Español)" htmlFor="summaryEs">
            <Input id="summaryEs" name="summaryEs" defaultValue={values.summaryEs} maxLength={240} />
          </Field>
          <Field label="Description (English)" htmlFor="descriptionEn" className="sm:col-span-2">
            <Textarea
              id="descriptionEn"
              name="descriptionEn"
              defaultValue={values.descriptionEn}
              rows={5}
              maxLength={4000}
            />
          </Field>
          <Field label="Descripción (Español)" htmlFor="descriptionEs" className="sm:col-span-2">
            <Textarea
              id="descriptionEs"
              name="descriptionEs"
              defaultValue={values.descriptionEs}
              rows={5}
              maxLength={4000}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Who it suits, and how many</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field label="Minimum ability" htmlFor="minAbility" error={errors.minAbility}>
            <Select id="minAbility" name="minAbility" defaultValue={values.minAbility}>
              {ABILITIES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Maximum ability" htmlFor="maxAbility" error={errors.maxAbility}>
            <Select id="maxAbility" name="maxAbility" defaultValue={values.maxAbility}>
              {ABILITIES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Minimum age" htmlFor="minAgeYears" hint="Blank for no limit.">
            <Input
              id="minAgeYears"
              name="minAgeYears"
              type="number"
              min={0}
              max={99}
              defaultValue={values.minAgeYears}
            />
          </Field>
          <Field label="Duration (minutes)" htmlFor="durationMinutes" error={errors.durationMinutes}>
            <Input
              id="durationMinutes"
              name="durationMinutes"
              type="number"
              min={15}
              max={720}
              required
              defaultValue={values.durationMinutes}
            />
          </Field>
          <Field label="Smallest party" htmlFor="minParty" error={errors.minParty}>
            <Input id="minParty" name="minParty" type="number" min={1} max={40} required defaultValue={values.minParty} />
          </Field>
          <Field label="Largest party" htmlFor="maxParty" error={errors.maxParty}>
            <Input id="maxParty" name="maxParty" type="number" min={1} max={40} required defaultValue={values.maxParty} />
          </Field>
          <Field
            label="Capacity per departure"
            htmlFor="defaultCapacity"
            error={errors.defaultCapacity}
            hint="Used as the default when a departure is created."
          >
            <Input
              id="defaultCapacity"
              name="defaultCapacity"
              type="number"
              min={1}
              max={60}
              required
              defaultValue={values.defaultCapacity}
            />
          </Field>
          <Field
            label="Free cancellation window (hours)"
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
              defaultValue={values.cancellationPolicyHours}
            />
          </Field>
          <div className="flex flex-col justify-center gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="includesTransfer"
                defaultChecked={values.includesTransfer}
                className="accent-jade-800 size-4"
              />
              Includes transfer
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="guideIncluded"
                defaultChecked={activity?.guideRequired ? true : values.guideIncluded}
                disabled={activity?.guideRequired}
                className="accent-jade-800 size-4"
              />
              Guide included
              {activity?.guideRequired ? (
                <Badge tone="warning" className="ml-1">
                  required
                </Badge>
              ) : null}
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Price and practicalities</CardTitle>
          <p className="text-sand-600 text-sm">
            Prices are in Mexican pesos per person. Changing a price creates a new version — past
            orders keep the price they were charged.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Price per person (MXN)" htmlFor="price" error={errors.priceMinor}>
            <Input id="price" name="price" type="number" min={0} step="1" required defaultValue={values.price} />
          </Field>
          <Field
            label="Booking fee per booking (MXN)"
            htmlFor="bookingFee"
            hint="Charged once, not per person. Leave at 0 if there is none."
          >
            <Input id="bookingFee" name="bookingFee" type="number" min={0} step="1" defaultValue={values.bookingFee} />
          </Field>
          <Field label="Meeting point" htmlFor="meetingPoint" className="sm:col-span-2">
            <Input
              id="meetingPoint"
              name="meetingPoint"
              defaultValue={values.meetingPoint}
              maxLength={240}
              placeholder="Top of the Carrizalillo stairway, by the taxi turnaround"
            />
          </Field>
          <Field label="What to bring (English)" htmlFor="whatToBringEn">
            <Textarea id="whatToBringEn" name="whatToBringEn" defaultValue={values.whatToBringEn} rows={3} />
          </Field>
          <Field label="Qué llevar (Español)" htmlFor="whatToBringEs">
            <Textarea id="whatToBringEs" name="whatToBringEs" defaultValue={values.whatToBringEs} rows={3} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <SubmitButton size="lg">{submitLabel}</SubmitButton>
        <p className="text-sand-500 text-xs">
          Saved as a draft. Publishing is a separate step with its own checks.
        </p>
      </div>
    </form>
  )
}

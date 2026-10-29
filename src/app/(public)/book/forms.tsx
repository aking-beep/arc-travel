'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import Link from 'next/link'
import { Minus, Plus, Trash2 } from 'lucide-react'
import { Field, Input, Select } from '@/components/ui/field'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import {
  addToTripAction,
  changeTripAction,
  payForTripAction,
  removeFromTripAction,
  startTripAction,
} from './actions'

/**
 * The storefront's client islands.
 *
 * Every date and party-size default is computed on the server and passed in as
 * a prop: a client component here must not read the clock during render, and
 * the linter enforces it.
 */

/**
 * The panel on a property page: when you are here, who with, and go.
 *
 * It is a form, not a link. The estimator beside it answers "what would a room
 * cost"; this answers "I am coming, show me what I can book", and the dates it
 * carries are what the planner, the conditions gate and the departures list
 * all reason over.
 */
export function StartTripForm({
  propertySlug,
  defaultArrive,
  defaultDepart,
  defaultParty,
  ability,
  labels,
}: {
  propertySlug: string
  defaultArrive: string
  defaultDepart: string
  defaultParty: number
  ability: AbilityFieldProps
  labels: {
    arrive: string
    depart: string
    travellers: string
    submit: string
    pending: string
  }
}) {
  const [state, formAction] = useActionState(startTripAction, emptyFormState)
  const [party, setParty] = useState(defaultParty)
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-3">
      <FormFeedback state={state} />
      <input type="hidden" name="propertySlug" value={propertySlug} />

      <div className="grid grid-cols-2 gap-3">
        <Field label={labels.arrive} htmlFor="fromDate" error={errors.fromDate}>
          <Input id="fromDate" name="fromDate" type="date" required defaultValue={defaultArrive} />
        </Field>
        <Field label={labels.depart} htmlFor="toDate" error={errors.toDate}>
          <Input id="toDate" name="toDate" type="date" required defaultValue={defaultDepart} />
        </Field>
      </div>

      <PartyStepper
        label={labels.travellers}
        value={party}
        onChange={setParty}
        error={errors.partySize}
      />

      <AbilityField {...ability} />

      <SubmitButton block pendingLabel={labels.pending}>
        {labels.submit}
      </SubmitButton>
    </form>
  )
}

function PartyStepper({
  label,
  value,
  onChange,
  error,
}: {
  label: string
  value: number
  onChange: (next: number) => void
  error?: string
}) {
  return (
    <div>
      <div className="border-line flex items-center justify-between rounded-xl border px-4 py-2.5">
        <span className="text-sm">{label}</span>
        <span className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onChange(Math.max(1, value - 1))}
            aria-label={`${label} −`}
            className="border-line hover:bg-paper flex size-8 items-center justify-center rounded-full border"
          >
            <Minus className="size-4" aria-hidden />
          </button>
          <span className="w-4 text-center tabular-nums">{value}</span>
          <button
            type="button"
            onClick={() => onChange(Math.min(12, value + 1))}
            aria-label={`${label} +`}
            className="border-line hover:bg-paper flex size-8 items-center justify-center rounded-full border"
          >
            <Plus className="size-4" aria-hidden />
          </button>
        </span>
      </div>
      <input type="hidden" name="partySize" value={value} />
      {error ? <p className="mt-1 text-sm text-red-700">{error}</p> : null}
    </div>
  )
}


/**
 * Where they say they stand in the water.
 *
 * Optional, and "rather not say" is a real answer rather than a nudge: the
 * conditions gate treats an unstated ability as the strict case and withholds
 * anything demanding, which is the behaviour ADR-017 exists to keep. Asking is
 * what makes the surf catalogue buyable at all; pretending the answer does not
 * matter would be the thing not to do.
 */
export interface AbilityFieldProps {
  value: string | null
  label: string
  hint: string
  unanswered: string
  options: Array<{ value: string; label: string }>
}

export function AbilityField({
  value,
  label,
  hint,
  unanswered,
  options,
}: AbilityFieldProps) {
  return (
    <Field label={label} htmlFor="surfAbility" hint={hint}>
      <Select id="surfAbility" name="surfAbility" defaultValue={value ?? ''}>
        <option value="">{unanswered}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </Field>
  )
}

/** Change the window without losing what is already in the basket. */
export function ChangeTripForm({
  fromDate,
  toDate,
  partySize,
  ability,
  labels,
}: {
  fromDate: string
  toDate: string
  partySize: number
  ability: AbilityFieldProps
  labels: { arrive: string; depart: string; travellers: string; submit: string; pending: string }
}) {
  const [state, formAction] = useActionState(changeTripAction, emptyFormState)
  const [party, setParty] = useState(partySize)
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-3">
      <FormFeedback state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={labels.arrive} htmlFor="changeFrom" error={errors.fromDate}>
          <Input id="changeFrom" name="fromDate" type="date" required defaultValue={fromDate} />
        </Field>
        <Field label={labels.depart} htmlFor="changeTo" error={errors.toDate}>
          <Input id="changeTo" name="toDate" type="date" required defaultValue={toDate} />
        </Field>
      </div>
      <PartyStepper
        label={labels.travellers}
        value={party}
        onChange={setParty}
        error={errors.partySize}
      />
      <AbilityField {...ability} />
      <SubmitButton variant="outline" pendingLabel={labels.pending}>
        {labels.submit}
      </SubmitButton>
    </form>
  )
}

export interface DepartureChoice {
  slotId: string
  time: string
  /** Why it cannot be taken, or null when it can. */
  blockedReason: string | null
  inBasket: boolean
}

/**
 * A listing's departures, as a day of times rather than a stack of cards.
 *
 * One card per departure read as a wall: a ten-listing catalogue over a
 * four-day window is sixty-odd of them, and the page stopped being something
 * anybody could scan. Grouping by day and rendering each time as a chip is the
 * same information in the shape people already read a timetable in.
 *
 * A chip that cannot be taken stays on the page, disabled, with its reason as
 * its title and in the text beneath. Hiding it would answer "why is there
 * nothing on Thursday" with silence, and the gate's reasons are the most
 * useful thing this page says.
 */
export function DepartureDay({
  date,
  choices,
  defaultQuantity,
  maxParty,
  labels,
}: {
  date: string
  choices: DepartureChoice[]
  defaultQuantity: number
  maxParty: number
  labels: { adding: string; inBasket: string }
}) {
  const [state, formAction] = useActionState(addToTripAction, emptyFormState)
  const quantity = Math.min(defaultQuantity, maxParty)
  const blocked = choices.filter((choice) => choice.blockedReason !== null)

  return (
    <div>
      <p className="text-muted text-xs tracking-wide tabular-nums">{date}</p>
      <form action={formAction} className="mt-1.5 flex flex-wrap gap-2">
        <input type="hidden" name="quantity" value={quantity} />
        {choices.map((choice) => (
          <DepartureChip key={choice.slotId} choice={choice} labels={labels} />
        ))}
      </form>
      {blocked.length > 0 ? (
        <ul className="text-muted mt-1.5 space-y-0.5 text-xs">
          {[...new Set(blocked.map((choice) => choice.blockedReason as string))].map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
      <FormFeedback state={state} className="mt-2" />
    </div>
  )
}

function DepartureChip({
  choice,
  labels,
}: {
  choice: DepartureChoice
  labels: { adding: string; inBasket: string }
}) {
  const { pending } = useFormStatus()

  if (choice.inBasket) {
    return (
      <span className="border-ink bg-ink text-ivory rounded-full border px-3 py-1.5 text-sm tabular-nums">
        {choice.time} · {labels.inBasket}
      </span>
    )
  }

  return (
    <button
      type="submit"
      name="slotId"
      value={choice.slotId}
      disabled={choice.blockedReason !== null || pending}
      title={choice.blockedReason ?? undefined}
      aria-disabled={choice.blockedReason !== null || undefined}
      className="border-line hover:border-ink rounded-full border px-3 py-1.5 text-sm tabular-nums transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-current"
    >
      {pending ? labels.adding : choice.time}
    </button>
  )
}

export function RemoveLineForm({ slotId, label }: { slotId: string; label: string }) {
  const [state, formAction] = useActionState(removeFromTripAction, emptyFormState)

  return (
    <form action={formAction}>
      <input type="hidden" name="slotId" value={slotId} />
      <button
        type="submit"
        className="text-muted hover:text-ink flex items-center gap-1 text-xs underline underline-offset-4"
        aria-label={label}
      >
        <Trash2 className="size-3.5" aria-hidden />
        {label}
      </button>
      {state.message && !state.ok ? (
        <p className="mt-1 text-xs text-red-700">{state.message}</p>
      ) : null}
    </form>
  )
}

/**
 * The till.
 *
 * Two shapes behind one action. Somebody signed in sees a confirm button and
 * nothing else to type; somebody who is not is asked for a name, an address
 * and a password — which is the account they will sign in with afterwards, not
 * a field collected for its own sake.
 *
 * `idempotencyKey` is rendered into the form, so a double-tap or a resubmitted
 * page replays the first order rather than buying twice.
 */
export function PayForTripForm({
  idempotencyKey,
  signedInAs,
  labels,
}: {
  idempotencyKey: string
  signedInAs: string | null
  labels: {
    name: string
    email: string
    password: string
    confirmPassword: string
    passwordHint: string
    terms: string
    submit: string
    pending: string
    signedIn: string
  }
}) {
  const [state, formAction] = useActionState(payForTripAction, emptyFormState)
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-4">
      <FormFeedback state={state} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      {signedInAs ? (
        <p className="text-muted text-sm">
          {labels.signedIn} <span className="text-ink font-medium">{signedInAs}</span>
        </p>
      ) : (
        <>
          <Field label={labels.name} htmlFor="name" error={errors.name}>
            <Input id="name" name="name" autoComplete="name" required />
          </Field>
          <Field label={labels.email} htmlFor="email" error={errors.email}>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </Field>
          <Field
            label={labels.password}
            htmlFor="password"
            hint={labels.passwordHint}
            error={errors.password}
          >
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
            />
          </Field>
          <Field
            label={labels.confirmPassword}
            htmlFor="confirmPassword"
            error={errors.confirmPassword}
          >
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
            />
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="acceptedTerms" className="mt-1" required />
            <span>
              {labels.terms}{' '}
              <Link href="/terms" className="underline underline-offset-4">
                Terms
              </Link>{' '}
              ·{' '}
              <Link href="/privacy" className="underline underline-offset-4">
                Privacy
              </Link>
            </span>
          </label>
          {errors.acceptedTerms ? (
            <p className="text-sm text-red-700">{errors.acceptedTerms}</p>
          ) : null}
        </>
      )}

      <SubmitButton block pendingLabel={labels.pending}>
        {labels.submit}
      </SubmitButton>
    </form>
  )
}

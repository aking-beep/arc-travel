'use client'

import { useActionState } from 'react'
import { Field, Input, Select } from '@/components/ui/field'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import { createTranslator, type AppLocale } from '@/lib/i18n'
import { addToBasketAction, buildItineraryAction, revokePersonalizationAction } from './actions'

const PACES = ['RELAXED', 'BALANCED', 'PACKED'] as const

/** Dates, pace, budget and party size — the four levers on a plan. */
export function ItineraryControls({
  token,
  locale,
  startDate,
  endDate,
  pace,
  budget,
  partySize,
  label,
  personalizationAllowed,
}: {
  token: string
  locale: AppLocale
  startDate: string
  endDate: string
  pace: string
  budget: string
  partySize: number
  label: string
  personalizationAllowed?: boolean
}) {
  const [state, formAction] = useActionState(buildItineraryAction, emptyFormState)
  const [revokeState, revokeAction] = useActionState(revokePersonalizationAction, emptyFormState)
  const t = createTranslator(locale)
  const errors = state.fieldErrors ?? {}

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <FormFeedback state={state} />

        <div className="grid grid-cols-2 gap-3">
          <Field label="From" htmlFor="startDate" error={errors.startDate}>
            <Input id="startDate" name="startDate" type="date" required defaultValue={startDate} />
          </Field>
          <Field label="To" htmlFor="endDate" error={errors.endDate}>
            <Input id="endDate" name="endDate" type="date" required defaultValue={endDate} />
          </Field>
          <Field label={t('guest.pace')} htmlFor="itinerary-pace">
            <Select id="itinerary-pace" name="pace" defaultValue={pace}>
              {PACES.map((p) => (
                <option key={p} value={p}>
                  {t(`pace.${p}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('guest.partySize')} htmlFor="itinerary-party">
            <Input
              id="itinerary-party"
              name="partySize"
              type="number"
              min={1}
              max={12}
              defaultValue={partySize}
            />
          </Field>
          <Field
            label={t('guest.budget')}
            htmlFor="itinerary-budget"
            hint="Blank means no price filter."
            className="col-span-2"
          >
            <Input id="itinerary-budget" name="budget" type="number" min={0} step="50" defaultValue={budget} />
          </Field>
        </div>

        <SubmitButton size="lg" block pendingLabel="Building…">
          {label}
        </SubmitButton>
      </form>

      {personalizationAllowed ? (
        <form action={revokeAction}>
          <input type="hidden" name="token" value={token} />
          <FormFeedback state={revokeState} className="mb-2" />
          <button
            type="submit"
            className="text-sand-500 hover:text-sand-800 text-xs underline underline-offset-4"
          >
            Stop using my answers to rank recommendations
          </button>
        </form>
      ) : null}
    </div>
  )
}

/**
 * Add-to-basket for one departure.
 *
 * Shows what is genuinely left rather than a generic "book now": on a six-seat
 * panga, "2 places left" is the useful fact.
 */
export function ItemActions({
  token,
  slotId,
  quantity,
  remaining,
  startsAt,
  locale,
}: {
  token: string
  slotId: string
  quantity: number
  remaining: number
  startsAt: string
  locale: AppLocale
}) {
  const [state, formAction] = useActionState(addToBasketAction, emptyFormState)
  const t = createTranslator(locale)
  const sellable = Math.min(quantity, remaining)

  if (remaining <= 0) {
    return <span className="text-sand-500 text-xs">Full at {startsAt}</span>
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="slotId" value={slotId} />
      <input type="hidden" name="quantity" value={sellable} />
      <SubmitButton size="sm" variant="accent" pendingLabel="Adding…">
        {t('guest.addToBasket')}
      </SubmitButton>
      <span className="text-sand-500 text-xs">
        {remaining} {remaining === 1 ? 'place' : 'places'} left
      </span>
      <FormFeedback state={state} className="w-full" />
    </form>
  )
}

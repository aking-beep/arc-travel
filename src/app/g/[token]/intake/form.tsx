'use client'

import { useActionState } from 'react'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import { createTranslator, type AppLocale } from '@/lib/i18n'
import { saveIntakeAction } from '../actions'

const CATEGORIES = ['SURF', 'WELLNESS', 'ADVENTURE', 'DINING', 'CULTURE', 'TRANSPORT'] as const
const ABILITIES = ['BEGINNER', 'IMPROVER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'] as const
const PACES = ['RELAXED', 'BALANCED', 'PACKED'] as const
const TRANSPORT = ['WALK', 'TAXI', 'SHUTTLE', 'MOTO', 'BOAT'] as const

/**
 * Preference intake.
 *
 * Two things are deliberately honest here. Surf ability has an explicit
 * "I'd rather not say" option that stores null, because a guessed level is what
 * puts someone on the wrong wave. And the consent checkboxes say what each one
 * actually changes, rather than one blanket agreement.
 */
export function IntakeForm({
  token,
  locale,
  defaults,
}: {
  token: string
  locale: AppLocale
  defaults: {
    interests: string[]
    surfAbility: string | null
    pace: string | null
    partySize: number
    budget: string
    preferredTransport: string[]
    dietaryNotes: string
    mobilityNotes: string
    personalizationConsent: boolean
    marketingConsent: boolean
  }
}) {
  const [state, formAction] = useActionState(saveIntakeAction, emptyFormState)
  const t = createTranslator(locale)
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="token" value={token} />
      <FormFeedback state={state} />

      <fieldset>
        <legend className="font-medium">{t('guest.interests')}</legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {CATEGORIES.map((category) => (
            <label
              key={category}
              className="border-sand-300 has-checked:border-jade-700 has-checked:bg-jade-50 has-checked:text-jade-900 flex cursor-pointer items-center gap-2 rounded-full border px-3.5 py-2 text-sm transition-colors"
            >
              <input
                type="checkbox"
                name="interests"
                value={category}
                defaultChecked={defaults.interests.includes(category)}
                className="accent-jade-800 size-4"
              />
              {t(`category.${category}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <Field
        label={t('guest.surfAbility')}
        htmlFor="surfAbility"
        hint="If you are not sure, leave it unanswered — we will not guess on a rough day."
        error={errors.surfAbility}
      >
        <Select id="surfAbility" name="surfAbility" defaultValue={defaults.surfAbility ?? ''}>
          <option value="">I’d rather not say</option>
          {ABILITIES.map((ability) => (
            <option key={ability} value={ability}>
              {t(`ability.${ability}`)}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('guest.pace')} htmlFor="pace">
          <Select id="pace" name="pace" defaultValue={defaults.pace ?? 'BALANCED'}>
            {PACES.map((pace) => (
              <option key={pace} value={pace}>
                {t(`pace.${pace}`)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('guest.partySize')} htmlFor="partySize" error={errors.partySize}>
          <Input
            id="partySize"
            name="partySize"
            type="number"
            min={1}
            max={12}
            required
            defaultValue={defaults.partySize}
          />
        </Field>

        <Field
          label={t('guest.budget')}
          htmlFor="budget"
          hint="Mexican pesos. Leave blank and we will not filter on price."
          className="sm:col-span-2"
        >
          <Input id="budget" name="budget" type="number" min={0} step="50" defaultValue={defaults.budget} />
        </Field>
      </div>

      <fieldset>
        <legend className="font-medium">{t('guest.transport')}</legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {TRANSPORT.map((mode) => (
            <label
              key={mode}
              className="border-sand-300 has-checked:border-jade-700 has-checked:bg-jade-50 has-checked:text-jade-900 flex cursor-pointer items-center gap-2 rounded-full border px-3.5 py-2 text-sm transition-colors"
            >
              <input
                type="checkbox"
                name="preferredTransport"
                value={mode}
                defaultChecked={defaults.preferredTransport.includes(mode)}
                className="accent-jade-800 size-4"
              />
              {t(`transport.${mode}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('guest.dietary')} htmlFor="dietaryNotes">
          <Textarea id="dietaryNotes" name="dietaryNotes" rows={3} maxLength={500} defaultValue={defaults.dietaryNotes} />
        </Field>
        <Field label={t('guest.mobility')} htmlFor="mobilityNotes">
          <Textarea id="mobilityNotes" name="mobilityNotes" rows={3} maxLength={500} defaultValue={defaults.mobilityNotes} />
        </Field>
      </div>

      <fieldset className="border-sand-200 bg-sand-50 space-y-3 rounded-xl border p-4">
        <legend className="px-1 text-sm font-medium">Your data</legend>

        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            name="dataProcessingConsent"
            required
            className="accent-jade-800 mt-0.5 size-4 shrink-0"
          />
          <span>
            {t('guest.consentData')}
            <span className="text-sand-500 block text-xs">
              Required. Without this we do not store your answers at all.
            </span>
          </span>
        </label>
        {errors.dataProcessingConsent ? (
          <p className="text-xs font-medium text-red-700">{errors.dataProcessingConsent}</p>
        ) : null}

        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            name="personalizationConsent"
            defaultChecked={defaults.personalizationConsent}
            className="accent-jade-800 mt-0.5 size-4 shrink-0"
          />
          <span>
            {t('guest.consentPersonalization')}
            <span className="text-sand-500 block text-xs">
              Optional. Without it you still get a full itinerary — it just will not be ranked
              around what you told us.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            name="marketingConsent"
            defaultChecked={defaults.marketingConsent}
            className="accent-jade-800 mt-0.5 size-4 shrink-0"
          />
          <span>
            {t('guest.consentMarketing')}
            <span className="text-sand-500 block text-xs">
              Optional. Nothing is sent in this demonstration environment regardless.
            </span>
          </span>
        </label>
      </fieldset>

      <SubmitButton size="lg" block pendingLabel={t('common.saving')}>
        {t('guest.buildItinerary')}
      </SubmitButton>
    </form>
  )
}

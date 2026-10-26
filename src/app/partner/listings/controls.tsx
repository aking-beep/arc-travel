'use client'

import { useActionState } from 'react'
import { Field, Input, Textarea } from '@/components/ui/field'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import { pauseOwnExperienceAction, setOwnPriceAction, submitForReviewAction } from '../actions'

/**
 * A new price.
 *
 * Allowed while the listing is live, unlike the rest of the details: a price
 * change is what the *next* guest is quoted, and a basket keeps the price it
 * captured. The old row is deactivated rather than edited, so an order that
 * already points at it still says what was charged.
 */
export function PriceForm({
  experienceId,
  currentPesos,
}: {
  experienceId: string
  currentPesos: string
}) {
  const [state, formAction] = useActionState(setOwnPriceAction, emptyFormState)
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-4">
      <FormFeedback state={state} />
      <input type="hidden" name="experienceId" value={experienceId} />

      <Field
        label="Price per person (pesos)"
        htmlFor="price"
        hint="Anyone who has already booked keeps the price they paid."
        error={errors.price ?? errors.amountMinor}
      >
        <Input id="price" name="price" inputMode="decimal" required defaultValue={currentPesos} />
      </Field>

      <Field
        label="Why"
        htmlFor="note"
        hint="For your own record and the hotel’s. Guests do not see it."
        error={errors.note}
      >
        <Textarea id="note" name="note" rows={2} />
      </Field>

      <SubmitButton>Set the new price</SubmitButton>
    </form>
  )
}

/** Hand the draft to the hotel. The hotel publishes; the partner cannot. */
export function SubmitForReviewForm({ experienceId }: { experienceId: string }) {
  const [state, formAction] = useActionState(submitForReviewAction, emptyFormState)

  return (
    <form action={formAction} className="space-y-3">
      <FormFeedback state={state} />
      <input type="hidden" name="experienceId" value={experienceId} />
      <SubmitButton>Send to the hotel</SubmitButton>
    </form>
  )
}

/** Stop taking new bookings. Nothing already booked is touched. */
export function PauseForm({ experienceId }: { experienceId: string }) {
  const [state, formAction] = useActionState(pauseOwnExperienceAction, emptyFormState)

  return (
    <form action={formAction} className="space-y-3">
      <FormFeedback state={state} />
      <input type="hidden" name="experienceId" value={experienceId} />
      <SubmitButton variant="outline">Pause this listing</SubmitButton>
    </form>
  )
}

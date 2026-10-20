'use client'

import { useActionState } from 'react'
import { Field, Input } from '@/components/ui/field'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import { addSlotAction, setStatusAction } from '../actions'

/** Publish / pause controls. Publishing is blocked until the checks pass. */
export function PublishControls({
  experienceId,
  status,
  canPublish,
}: {
  experienceId: string
  status: string
  canPublish: boolean
}) {
  const [state, formAction] = useActionState(setStatusAction, emptyFormState)
  const isPublished = status === 'PUBLISHED'

  return (
    <div className="space-y-3 pt-1">
      <FormFeedback state={state} />
      <form action={formAction} className="flex flex-wrap gap-2">
        <input type="hidden" name="experienceId" value={experienceId} />
        <input type="hidden" name="status" value={isPublished ? 'PAUSED' : 'PUBLISHED'} />
        <SubmitButton
          variant={isPublished ? 'outline' : 'primary'}
          size="sm"
          disabled={!isPublished && !canPublish}
          pendingLabel={isPublished ? 'Pausing…' : 'Publishing…'}
        >
          {isPublished ? 'Pause' : 'Publish'}
        </SubmitButton>
      </form>
      {!isPublished && !canPublish ? (
        <p className="text-sand-500 text-xs">Clear the items above to enable publishing.</p>
      ) : null}
    </div>
  )
}

/** Adds a single departure. Bulk scheduling lives on the partner surface. */
export function SlotComposer({
  experienceId,
  defaultCapacity,
  earliestStart,
}: {
  experienceId: string
  defaultCapacity: number
  earliestStart: string
}) {
  const [state, formAction] = useActionState(addSlotAction, emptyFormState)

  return (
    <form action={formAction} className="border-sand-200 space-y-3 border-t pt-4">
      <input type="hidden" name="experienceId" value={experienceId} />
      <p className="text-sand-700 text-sm font-medium">Add a departure</p>
      <FormFeedback state={state} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" htmlFor="slot-date">
          <Input id="slot-date" name="date" type="date" required />
        </Field>
        <Field label="Start" htmlFor="slot-time">
          <Input id="slot-time" name="startTime" type="time" required defaultValue={earliestStart} />
        </Field>
        <Field label="Capacity" htmlFor="slot-capacity">
          <Input
            id="slot-capacity"
            name="capacity"
            type="number"
            min={1}
            max={60}
            required
            defaultValue={defaultCapacity}
          />
        </Field>
        <Field label="Price override" htmlFor="slot-price" hint="MXN. Blank to use the normal price.">
          <Input id="slot-price" name="priceOverride" type="number" min={0} />
        </Field>
      </div>
      <SubmitButton variant="outline" size="sm" block pendingLabel="Adding…">
        Add departure
      </SubmitButton>
    </form>
  )
}

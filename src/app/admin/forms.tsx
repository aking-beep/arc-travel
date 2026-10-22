'use client'

import { useActionState } from 'react'
import { Textarea } from '@/components/ui/field'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import {
  refreshTravelAdviceAction,
  reviewSourceChangeAction,
  verifyPropertyAction,
  verifySupplierAction,
} from './actions'

/**
 * Verification form.
 *
 * The note is required to approve, not optional. A "verified" badge with no
 * record of what was checked is worse than no badge at all.
 */
export function VerifySupplierForm({
  supplierId,
  insuranceOnFile,
}: {
  supplierId: string
  insuranceOnFile: boolean
}) {
  const [state, formAction] = useActionState(verifySupplierAction, emptyFormState)

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="supplierId" value={supplierId} />
      <FormFeedback state={state} />

      <Textarea
        name="note"
        rows={2}
        maxLength={400}
        placeholder="What did you actually check? Required to approve — at least ten characters."
        className="text-sm"
      />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="insuranceOnFile"
          defaultChecked={insuranceOnFile}
          className="accent-jade-800 size-4"
        />
        Insurance document seen and on file
      </label>

      <div className="flex flex-wrap gap-2">
        <SubmitButton name="decision" value="VERIFIED" size="sm" pendingLabel="Recording…">
          Verify
        </SubmitButton>
        <SubmitButton name="decision" value="PENDING" variant="outline" size="sm">
          Awaiting documents
        </SubmitButton>
        <SubmitButton name="decision" value="REJECTED" variant="danger" size="sm">
          Reject
        </SubmitButton>
      </div>
    </form>
  )
}

export function VerifyPropertyForm({ propertyId }: { propertyId: string }) {
  const [state, formAction] = useActionState(verifyPropertyAction, emptyFormState)

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="propertyId" value={propertyId} />
      <FormFeedback state={state} />
      <Textarea
        name="note"
        rows={2}
        maxLength={400}
        placeholder="What was checked. Required to approve."
        className="text-sm"
      />
      <div className="flex gap-2">
        <SubmitButton name="decision" value="VERIFIED" size="sm">
          Verify
        </SubmitButton>
        <SubmitButton name="decision" value="PENDING" variant="outline" size="sm">
          Pending
        </SubmitButton>
      </div>
    </form>
  )
}

/** A culture-source change review. The note is required to verify. */
export function ReviewSourceChangeForm({ changeId }: { changeId: string }) {
  const [state, formAction] = useActionState(reviewSourceChangeAction, emptyFormState)

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="changeId" value={changeId} />
      <FormFeedback state={state} />
      <Textarea
        name="note"
        rows={2}
        maxLength={400}
        placeholder="What did you compare, and what changed? Required to verify."
        className="text-sm"
        aria-label="Review note"
      />
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="decision" value="VERIFIED" size="sm" pendingLabel="Recording…">
          Verify change
        </SubmitButton>
        <SubmitButton name="decision" value="REJECTED" variant="danger" size="sm">
          Not a real change
        </SubmitButton>
        <SubmitButton name="decision" value="PENDING" variant="outline" size="sm">
          Leave pending
        </SubmitButton>
      </div>
    </form>
  )
}

export function RefreshTravelAdviceForm({ destination }: { destination: string }) {
  const [state, formAction] = useActionState(refreshTravelAdviceAction, emptyFormState)

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="destination" value={destination} />
      <FormFeedback state={state} />
      <SubmitButton variant="outline" size="sm" pendingLabel="Checking…">
        Check source now
      </SubmitButton>
    </form>
  )
}

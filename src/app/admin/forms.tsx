'use client'

import { useActionState } from 'react'
import { Textarea } from '@/components/ui/field'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import { VERIFICATION_CHECKS } from '@/modules/admin/verification'
import {
  refreshTravelAdviceAction,
  reviewSourceChangeAction,
  verifyPropertyAction,
  verifySupplierAction,
} from './actions'

/**
 * Verification form.
 *
 * The note is required to approve, not optional, and is no longer the whole
 * evidential basis: the checklist is. A "verified" badge backed by ten
 * characters of free text is worse than no badge at all, because it reads as an
 * assurance. See `src/modules/admin/verification.ts` and ADR-036.
 */
export function VerifySupplierForm({
  supplierId,
  verifiedChecks,
  insuranceExpiresOn,
}: {
  supplierId: string
  /** Keys already recorded, so a re-check starts from what is known. */
  verifiedChecks: readonly string[]
  /** `YYYY-MM-DD`, computed on the server — a client component must not read the clock. */
  insuranceExpiresOn: string | null
}) {
  const [state, formAction] = useActionState(verifySupplierAction, emptyFormState)

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="supplierId" value={supplierId} />
      <FormFeedback state={state} />

      <fieldset className="space-y-2">
        <legend className="text-sand-700 text-sm font-medium">
          What was checked
        </legend>
        <p className="text-sand-500 text-xs">
          Every required check must be recorded before this partner can be verified. The service
          refuses otherwise — leave them unverified rather than verifying what has not been seen.
        </p>
        {VERIFICATION_CHECKS.map((check) => (
          <label key={check.key} className="flex gap-2 text-sm">
            <input
              type="checkbox"
              name={`check:${check.key}`}
              defaultChecked={verifiedChecks.includes(check.key)}
              className="accent-jade-800 mt-0.5 size-4 shrink-0"
            />
            <span>
              <span className="font-medium">{check.label}</span>
              {check.required ? null : <span className="text-sand-500"> (if it applies)</span>}
              <span className="text-sand-500 block text-xs leading-snug">{check.detail}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <label className="block text-sm">
        <span className="text-sand-700 font-medium">Insurance expires</span>
        <span className="text-sand-500 block text-xs">
          From the certificate. Required with the insurance check: the verification lapses on this
          date rather than standing for ever.
        </span>
        <input
          type="date"
          name="insuranceExpiresOn"
          defaultValue={insuranceExpiresOn ?? ''}
          className="border-sand-300 mt-1 rounded-lg border px-2 py-1 text-sm"
        />
      </label>

      <Textarea
        name="note"
        rows={2}
        maxLength={400}
        placeholder="Policy number, insurer, who you spoke to. Required to approve — at least ten characters."
        className="text-sm"
      />

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

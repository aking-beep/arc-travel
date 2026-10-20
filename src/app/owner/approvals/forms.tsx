'use client'

import { useActionState } from 'react'
import { Textarea } from '@/components/ui/field'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import { decideProposalAction } from './actions'

/**
 * Approve / reject controls.
 *
 * Both buttons submit the same form so the owner's note is captured either way
 * — a rejection reason is more useful to ARC than an approval.
 */
export function DecisionForm({ proposalId }: { proposalId: string }) {
  const [state, formAction] = useActionState(decideProposalAction, emptyFormState)

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="proposalId" value={proposalId} />
      <FormFeedback state={state} />

      <Textarea
        name="note"
        rows={2}
        maxLength={400}
        placeholder="Optional note — why you decided this way."
        className="text-sm"
      />

      <div className="flex flex-wrap gap-2">
        <SubmitButton name="decision" value="APPROVED" size="sm" pendingLabel="Approving…">
          Approve
        </SubmitButton>
        <SubmitButton
          name="decision"
          value="REJECTED"
          variant="outline"
          size="sm"
          pendingLabel="Rejecting…"
        >
          Reject
        </SubmitButton>
      </div>
    </form>
  )
}

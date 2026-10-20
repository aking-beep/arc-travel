'use server'

import { revalidatePath } from 'next/cache'
import { toFormState, type FormState } from '@/lib/form-state'
import { ApprovalDecision } from '@/lib/prisma-types'
import { requireActor } from '@/modules/auth/service'
import { decideProposal } from '@/modules/workflows/proposals'

/**
 * Approve or reject a drafted action.
 *
 * The decision and its execution happen in one transaction inside
 * `decideProposal`; this action only translates the form and reports back.
 */
export async function decideProposalAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor()
    const decision =
      String(formData.get('decision') ?? '') === 'APPROVED'
        ? ApprovalDecision.APPROVED
        : ApprovalDecision.REJECTED

    const result = await decideProposal(actor, {
      proposalId: String(formData.get('proposalId') ?? ''),
      decision,
      note: String(formData.get('note') ?? '') || undefined,
    })

    revalidatePath('/owner/approvals')
    revalidatePath('/owner/briefing')
    revalidatePath('/owner')

    if (decision === ApprovalDecision.REJECTED) {
      return { ok: true, message: 'Rejected. Nothing was changed.' }
    }

    return {
      ok: true,
      message: result.execution?.summary ?? 'Approved.',
      notes: result.execution?.executed
        ? undefined
        : ['Approved, but it needs a step from you before anything changes.'],
    }
  } catch (error) {
    return toFormState(error)
  }
}

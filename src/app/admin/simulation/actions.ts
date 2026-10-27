'use server'

import { revalidatePath } from 'next/cache'

import { toFormState, type FormState } from '@/lib/form-state'
import { requireActor } from '@/modules/auth/service'
import { assertPlatformAdmin } from '@/modules/tenancy/context'
import { decideProposal, stopRun } from '@/modules/simulation/service'

/**
 * Stop the run.
 *
 * It does not kill the runner — nothing here can reach a process on somebody
 * else's machine. It closes the run, and the runner's next batch is told to
 * stop, which it does. The distinction matters when reading the feed: a run
 * marked stopped with a few more events after it is the runner finishing the
 * step it was in, not a stop that failed.
 */
export async function stopRunAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await requireActor()
    assertPlatformAdmin(actor)

    await stopRun(String(formData.get('runId') ?? ''), 'Stopped from the dashboard.')
    revalidatePath('/admin/simulation')

    return { ok: true, message: 'Stopping. The runner finishes the step it is in.' }
  } catch (error) {
    return toFormState(error)
  }
}

/**
 * An operator's verdict on a proposed amendment.
 *
 * Accepting records that it should happen. It does not happen: nothing in this
 * product writes `.claude/`, and the amendment becomes a pull request a person
 * opens. That is the harness rule, and the point of it is that the thing a
 * guardrail refused never gets to edit the guardrail.
 */
export async function decideProposalAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor()
    assertPlatformAdmin(actor)

    const decision = String(formData.get('decision') ?? '')
    if (decision !== 'ACCEPTED' && decision !== 'DISMISSED') {
      throw new Error('Unknown decision.')
    }

    await decideProposal(String(formData.get('proposalId') ?? ''), decision)
    revalidatePath('/admin/simulation')

    return {
      ok: true,
      message:
        decision === 'ACCEPTED'
          ? 'Marked for a pull request. Nothing has been written to .claude/.'
          : 'Dismissed.',
    }
  } catch (error) {
    return toFormState(error)
  }
}

'use server'

import { revalidatePath } from 'next/cache'
import { toFormState, type FormState } from '@/lib/form-state'
import { requireActor } from '@/modules/auth/service'
import { resolveOperatingProperty } from '@/modules/hotels/service'
import { acceptJoinRequest, declineJoinRequest } from '@/modules/suppliers/self-service'

/**
 * Deciding on a business that asked to work with this hotel.
 *
 * Accepting is the thing that creates the relationship, and it goes through the
 * same `invitePartner` path as an owner typing the address in themselves — so
 * the refusal on an email that already has an account, the agreement, the
 * membership and the invitation email are all the ones that path already has.
 */
export async function acceptJoinRequestAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor()
    const { propertyId } = await resolveOperatingProperty(actor)

    const result = await acceptJoinRequest(actor, propertyId, {
      requestId: String(formData.get('requestId') ?? ''),
      hotelCommissionBps: Math.round(Number(formData.get('hotelCommissionPct') ?? 15) * 100),
      decisionNote: String(formData.get('decisionNote') ?? '') || null,
    })

    revalidatePath('/owner/partners')
    revalidatePath('/owner')

    const notes = [
      'They are unverified and payouts are off. ARC verification is a separate step.',
    ]
    if (result.invitationToken) {
      notes.push(
        `If the email does not reach them, send this link so they can set a password: /invite/${result.invitationToken}`,
      )
    } else {
      notes.push('They already had an ARC account, so they sign in with their existing password.')
    }
    if (result.emailStatus === 'logged' || result.emailStatus === 'unconfigured') {
      notes.push(
        'No email left this deployment. You can read what it said under Messages and pass the link on yourself.',
      )
    } else if (result.emailStatus === 'failed') {
      notes.push('The invitation email could not be delivered — the reason is under Messages.')
    }

    return { ok: true, message: 'Accepted. They are now one of your partners.', notes }
  } catch (error) {
    return toFormState(error)
  }
}

export async function declineJoinRequestAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor()
    const { propertyId } = await resolveOperatingProperty(actor)

    await declineJoinRequest(actor, propertyId, {
      requestId: String(formData.get('requestId') ?? ''),
      decisionNote: String(formData.get('decisionNote') ?? '') || null,
    })

    revalidatePath('/owner/partners')
    return {
      ok: true,
      message:
        'Declined, and nothing was sent to them. If you want to reply, their address is on the request.',
    }
  } catch (error) {
    return toFormState(error)
  }
}

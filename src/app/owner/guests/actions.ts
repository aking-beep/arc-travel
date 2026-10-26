'use server'

import { revalidatePath } from 'next/cache'
import { requireActor } from '@/modules/auth/service'
import { pesosToMinor, toFormState, type FormState } from '@/lib/form-state'
import { resolveOperatingProperty } from '@/modules/hotels/service'
import { createStay, reissuePortalToken, setStayStatus } from '@/modules/stays/service'
import { sendGuestPortalLink } from '@/modules/notifications/senders'

/**
 * Front-desk actions.
 *
 * Each turns `FormData` into a plain object and calls one service. The portal
 * link comes back in the form's notes, because the person at the desk is often
 * the person handing it over.
 *
 * It can also now be emailed, by `sendPortalLinkAction` below — but only when
 * an owner presses that button, and never as a consequence of creating the
 * stay. The note on that action says why.
 */
export async function createStayAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireActor()
  const { propertyId } = await resolveOperatingProperty(actor)

  try {
    const stay = await createStay(actor, propertyId, {
      firstName: String(formData.get('firstName') ?? ''),
      lastName: String(formData.get('lastName') ?? ''),
      email: String(formData.get('email') ?? ''),
      phone: String(formData.get('phone') ?? '') || null,
      locale: String(formData.get('locale') ?? 'EN'),
      countryCode: String(formData.get('countryCode') ?? '') || null,
      checkIn: String(formData.get('checkIn') ?? ''),
      checkOut: String(formData.get('checkOut') ?? ''),
      adults: formData.get('adults'),
      children: formData.get('children') ?? 0,
      roomTypeId: String(formData.get('roomTypeId') ?? '') || null,
      // Pesos become centavos exactly once, here at the form edge.
      roomRevenueMinor: pesosToMinor(formData.get('roomRevenue')),
      arrivalNotes: String(formData.get('arrivalNotes') ?? '') || null,
    })

    revalidatePath('/owner/guests')
    revalidatePath('/owner/arrivals')
    revalidatePath('/owner')

    return {
      ok: true,
      message: `Stay ${stay.reference} created.`,
      notes: [
        `Their portal link: /g/${stay.portalToken}`,
        `It works until ${stay.portalExpiresOn}, which is ${stay.checkOut} plus the grace window.`,
        'Print the arrival card from the list below, or copy the link. No email was sent — outbound messaging is disabled in this build.',
      ],
    }
  } catch (error) {
    return toFormState(error)
  }
}

export async function reissueTokenAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireActor()

  try {
    const result = await reissuePortalToken(actor, String(formData.get('stayId') ?? ''))
    revalidatePath('/owner/guests')
    return {
      ok: true,
      message: `New link issued for ${result.reference}.`,
      notes: [
        `Their portal link: /g/${result.portalToken}`,
        'The previous link stopped working the moment this was issued.',
      ],
    }
  } catch (error) {
    return toFormState(error)
  }
}

/**
 * Emails the guest their own portal link, because somebody pressed a button.
 *
 * The one mail path in this product that is not a reply to something the
 * recipient themselves did, and it is gated accordingly. A portal token is a
 * bearer credential for one stay (ADR-035): mailing it automatically on stay
 * creation would put a working credential in an inbox nobody asked to receive
 * it in, and an address a front desk mistyped would send it to a stranger.
 *
 * So it is an owner looking at a stay and choosing to send it. The service
 * records who pressed it, and `assertPropertyAccess` inside the service's
 * `where` clause is what stops a button press reaching another hotel's guest.
 */
export async function sendPortalLinkAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor()

  try {
    const stayId = String(formData.get('stayId') ?? '')
    const { organizationId } = await resolveOperatingProperty(actor)

    const outcome = await sendGuestPortalLink({
      stayId,
      organizationId,
      byUserId: actor.userId,
    })
    revalidatePath('/owner/guests')

    switch (outcome) {
      case 'sent':
        return { ok: true, message: 'Their link is on its way.' }
      case 'logged':
        return {
          ok: true,
          message: 'Recorded, not sent — this deployment delivers no mail.',
          notes: ['The exact message, link included, is under Messages.'],
        }
      case 'queued':
        return {
          ok: true,
          message: 'Queued. It goes out within a few minutes.',
        }
      case 'unconfigured':
        return {
          ok: false,
          message: 'This deployment has no email configured, so nothing was sent.',
          notes: ['Hand them the arrival card instead, or ask your administrator to set up mail.'],
        }
      case 'skipped':
        return {
          ok: false,
          message: 'That stay has no guest email on file, so there is nowhere to send it.',
        }
      case 'failed':
        return {
          ok: false,
          message: 'The message could not be delivered. It is under Messages with the reason.',
        }
    }
  } catch (error) {
    return toFormState(error)
  }
}

export async function setStayStatusAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor()

  try {
    await setStayStatus(actor, {
      stayId: String(formData.get('stayId') ?? ''),
      status: String(formData.get('status') ?? ''),
    })
    revalidatePath('/owner/guests')
    revalidatePath('/owner/arrivals')
    return { ok: true, message: 'Stay updated.' }
  } catch (error) {
    return toFormState(error)
  }
}

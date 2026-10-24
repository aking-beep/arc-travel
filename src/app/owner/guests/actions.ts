'use server'

import { revalidatePath } from 'next/cache'
import { requireActor } from '@/modules/auth/service'
import { pesosToMinor, toFormState, type FormState } from '@/lib/form-state'
import { resolveOperatingProperty } from '@/modules/hotels/service'
import { createStay, reissuePortalToken, setStayStatus } from '@/modules/stays/service'

/**
 * Front-desk actions.
 *
 * Each turns `FormData` into a plain object and calls one service. The portal
 * link comes back in the form's notes, because the person at the desk is the
 * person handing it over — no message leaves this system without an approval,
 * so "we have emailed your guest" would be false.
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

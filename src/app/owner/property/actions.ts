'use server'

import { revalidatePath } from 'next/cache'
import { requireActor } from '@/modules/auth/service'
import {
  addAmenity,
  invitePartner,
  resolveOperatingProperty,
  updatePropertyProfile,
  upsertRoomType,
} from '@/modules/hotels/service'
import { pesosToMinor, toFormState, type FormState } from '@/lib/form-state'

export async function updateProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireActor()
  const { propertyId } = await resolveOperatingProperty(actor)

  try {
    await updatePropertyProfile(actor, propertyId, {
      name: String(formData.get('name') ?? ''),
      tagline: String(formData.get('tagline') ?? '') || null,
      description: String(formData.get('description') ?? '') || null,
      houseNotes: String(formData.get('houseNotes') ?? '') || null,
      checkInTime: String(formData.get('checkInTime') ?? '15:00'),
      checkOutTime: String(formData.get('checkOutTime') ?? '11:00'),
      defaultLocale: String(formData.get('defaultLocale') ?? 'EN'),
      brandPrimary: String(formData.get('brandPrimary') ?? '#1F3A34'),
      brandAccent: String(formData.get('brandAccent') ?? '#C97B4A'),
      placeId: String(formData.get('placeId') ?? '') || null,
      contactEmail: String(formData.get('contactEmail') ?? ''),
      contactPhone: String(formData.get('contactPhone') ?? '') || null,
    })
    revalidatePath('/owner/property')
    revalidatePath('/owner')
    return { ok: true, message: 'Property profile saved.' }
  } catch (error) {
    return toFormState(error)
  }
}

export async function upsertRoomTypeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireActor()
  const { propertyId } = await resolveOperatingProperty(actor)

  try {
    await upsertRoomType(actor, propertyId, {
      code: String(formData.get('code') ?? '').toUpperCase(),
      name: String(formData.get('name') ?? ''),
      description: String(formData.get('description') ?? '') || null,
      maxOccupancy: formData.get('maxOccupancy'),
      roomCount: formData.get('roomCount'),
      baseRateMinor: pesosToMinor(formData.get('baseRate')),
    })
    revalidatePath('/owner/property')
    return { ok: true, message: 'Room type saved.' }
  } catch (error) {
    return toFormState(error)
  }
}

export async function addAmenityAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireActor()
  const { propertyId } = await resolveOperatingProperty(actor)

  try {
    await addAmenity(actor, propertyId, {
      name: String(formData.get('name') ?? ''),
      category: String(formData.get('category') ?? 'WELLNESS'),
      description: String(formData.get('description') ?? '') || null,
      isIncluded: formData.get('isIncluded') === 'on',
    })
    revalidatePath('/owner/property')
    revalidatePath('/owner/catalog')
    return { ok: true, message: 'Amenity added.' }
  } catch (error) {
    return toFormState(error)
  }
}

export async function invitePartnerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireActor()
  const { propertyId } = await resolveOperatingProperty(actor)

  try {
    const result = await invitePartner(actor, propertyId, {
      name: String(formData.get('name') ?? ''),
      contactName: String(formData.get('contactName') ?? ''),
      contactEmail: String(formData.get('contactEmail') ?? ''),
      contactPhone: String(formData.get('contactPhone') ?? '') || null,
      categories: formData.getAll('categories').map(String),
      placeId: String(formData.get('placeId') ?? '') || null,
      description: String(formData.get('description') ?? '') || null,
      hotelCommissionBps: Math.round(Number(formData.get('hotelCommissionPct') ?? 15) * 100),
      contactLocale: String(formData.get('contactLocale') ?? 'EN'),
    })
    revalidatePath('/owner/partners')
    revalidatePath('/owner')

    /*
     * The link is shown to the owner whether or not it was also emailed.
     *
     * Mail is the convenience (ADR-040); the link in the owner's hands is what
     * works when a small operator's free mailbox silently drops it, and the
     * owner is usually standing next to them anyway. What must not happen is
     * the page claiming a send that did not occur, so the note is written from
     * `emailStatus` rather than from an assumption.
     */
    const notes = [
      'They are unverified and payouts are off. ARC verification is a separate step on the admin surface.',
    ]
    if (result.invitation) {
      notes.push(
        `Send them this link so they can set their own password: /invite/${result.invitation.token}`,
        `It works once and expires on ${result.invitation.expiresAt.toISOString().slice(0, 10)}.`,
      )
    } else {
      notes.push('They already have an ARC account, so they sign in with their existing password.')
    }

    switch (result.emailStatus) {
      case 'sent':
        notes.push('We have emailed them the invitation as well.')
        break
      case 'logged':
        notes.push(
          'The invitation email was recorded but not delivered — this deployment sends no mail. You can read it under Messages.',
        )
        break
      case 'queued':
        notes.push('The invitation email is queued and goes out within a few minutes.')
        break
      case 'failed':
        notes.push(
          'We could not deliver the invitation email. The reason is under Messages — pass the link on yourself.',
        )
        break
      case 'unconfigured':
        notes.push('No email was sent: this deployment has no email configured.')
        break
      case null:
        break
    }

    return { ok: true, message: 'Partner added and an agreement created.', notes }
  } catch (error) {
    return toFormState(error)
  }
}

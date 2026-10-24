'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { randomUUID } from 'node:crypto'
import { pesosToMinor, toFormState, type FormState } from '@/lib/form-state'
import { ConsentType } from '@/lib/prisma-types'
import { resolvePortalForRequest } from './resolve'
import { saveIntake, revokeConsent } from '@/modules/preferences/service'
import { buildItinerary } from '@/modules/itinerary/service'
import { addToCart, clearCart, getOrCreateCart, removeFromCart } from '@/modules/commerce/cart'
import { cancelOrderItem, checkout } from '@/modules/commerce/checkout'
import { itineraryRequestSchema } from '@/modules/preferences/schemas'

/**
 * Guest portal server actions.
 *
 * Every one of them starts by resolving the portal token, which is both the
 * authentication and the authorisation step: the token identifies exactly one
 * stay, and no action accepts a guest id from the client. A form that tried to
 * post someone else's guest id would be ignored.
 */
async function contextFor(formData: FormData) {
  const token = String(formData.get('token') ?? '')
  return { token, context: await resolvePortalForRequest(token) }
}

export async function saveIntakeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let token: string
  try {
    const resolved = await contextFor(formData)
    token = resolved.token
    await saveIntake(resolved.context.guestId, {
      interests: formData.getAll('interests').map(String),
      surfAbility: String(formData.get('surfAbility') ?? '') || null,
      pace: String(formData.get('pace') ?? '') || null,
      partySize: formData.get('partySize'),
      budgetPerDayMinor: formData.get('budget') ? pesosToMinor(formData.get('budget')) : null,
      preferredTransport: formData.getAll('preferredTransport').map(String),
      dietaryNotes: String(formData.get('dietaryNotes') ?? '') || null,
      mobilityNotes: String(formData.get('mobilityNotes') ?? '') || null,
      dataProcessingConsent: formData.get('dataProcessingConsent') === 'on',
      personalizationConsent: formData.get('personalizationConsent') === 'on',
      marketingConsent: formData.get('marketingConsent') === 'on',
    })
  } catch (error) {
    return toFormState(error)
  }

  revalidatePath(`/g/${token}`)
  redirect(`/g/${token}?intake=done`)
}

export async function buildItineraryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  let token: string
  try {
    const resolved = await contextFor(formData)
    token = resolved.token
    const { context } = resolved

    const request = itineraryRequestSchema.parse({
      startDate: String(formData.get('startDate') ?? context.planningStart),
      endDate: String(formData.get('endDate') ?? context.planningEnd),
      pace: String(formData.get('pace') ?? '') || null,
      budgetPerDayMinor: formData.get('budget') ? pesosToMinor(formData.get('budget')) : null,
      partySize: formData.get('partySize') || null,
    })

    await buildItinerary({
      guestId: context.guestId,
      stayId: context.stayId,
      startDate: request.startDate,
      endDate: request.endDate,
      overrides: {
        ...(request.pace ? { pace: request.pace } : {}),
        ...(request.budgetPerDayMinor !== null && request.budgetPerDayMinor !== undefined
          ? { budgetPerDayMinor: request.budgetPerDayMinor }
          : {}),
        ...(request.partySize ? { partySize: request.partySize } : {}),
      },
    })
  } catch (error) {
    return toFormState(error)
  }

  revalidatePath(`/g/${token}`)
  redirect(`/g/${token}`)
}

export async function addToBasketAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { token, context } = await contextFor(formData)
    const cartId = await getOrCreateCart({
      organizationId: context.organizationId,
      propertyId: context.propertyId,
      guestId: context.guestId,
      stayId: context.stayId,
      currency: context.property.currency,
    })

    const { holdExpiresAt } = await addToCart({
      cartId,
      slotId: String(formData.get('slotId') ?? ''),
      quantity: Number(formData.get('quantity') ?? context.partySize),
      participantNotes: String(formData.get('participantNotes') ?? '') || null,
    })

    revalidatePath(`/g/${token}`)
    revalidatePath(`/g/${token}/basket`)
    revalidatePath(`/g/${token}/explore`)

    return {
      ok: true,
      message: 'Added to your basket.',
      notes: [
        `We are holding your places until ${holdExpiresAt.toISOString().slice(11, 16)} UTC.`,
      ],
    }
  } catch (error) {
    return toFormState(error)
  }
}

export async function removeFromBasketAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { token, context } = await contextFor(formData)
    const cartId = await getOrCreateCart({
      organizationId: context.organizationId,
      propertyId: context.propertyId,
      guestId: context.guestId,
      stayId: context.stayId,
      currency: context.property.currency,
    })
    await removeFromCart({ cartId, slotId: String(formData.get('slotId') ?? '') })
    revalidatePath(`/g/${token}/basket`)
    return { ok: true, message: 'Removed.' }
  } catch (error) {
    return toFormState(error)
  }
}

export async function clearBasketAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { token, context } = await contextFor(formData)
    const cartId = await getOrCreateCart({
      organizationId: context.organizationId,
      propertyId: context.propertyId,
      guestId: context.guestId,
      stayId: context.stayId,
      currency: context.property.currency,
    })
    await clearCart(cartId)
    revalidatePath(`/g/${token}/basket`)
    return { ok: true, message: 'Basket emptied.' }
  } catch (error) {
    return toFormState(error)
  }
}

export async function checkoutAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let token: string
  let reference: string
  try {
    const resolved = await contextFor(formData)
    token = resolved.token
    const { context } = resolved

    const cartId = await getOrCreateCart({
      organizationId: context.organizationId,
      propertyId: context.propertyId,
      guestId: context.guestId,
      stayId: context.stayId,
      currency: context.property.currency,
    })

    // The key comes from the rendered form, so a resubmission of the same page
    // replays rather than duplicating. A fresh basket gets a fresh key.
    const idempotencyKey = String(formData.get('idempotencyKey') ?? '') || randomUUID()

    const result = await checkout({ cartId, guestId: context.guestId, idempotencyKey })
    reference = result.reference
  } catch (error) {
    return toFormState(error)
  }

  revalidatePath(`/g/${token}/basket`)
  redirect(`/g/${token}/order/${reference}`)
}

export async function cancelBookingAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { token, context } = await contextFor(formData)
    // The guest id comes from the portal token, never from the form. The
    // order-item id is client-supplied and is scoped by that guest id inside
    // the service, so a guest cannot cancel someone else's booking.
    const result = await cancelOrderItem({
      orderItemId: String(formData.get('orderItemId') ?? ''),
      reason: 'Cancelled by the guest in the portal.',
      authority: { kind: 'guest', guestId: context.guestId },
    })

    revalidatePath(`/g/${token}`)
    return {
      ok: true,
      message:
        result.refundMinor > 0
          ? 'Cancelled, and a simulated refund has been recorded.'
          : 'Cancelled. It was outside the free-cancellation window, so no refund was recorded.',
    }
  } catch (error) {
    return toFormState(error)
  }
}

export async function revokePersonalizationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { token, context } = await contextFor(formData)
    await revokeConsent(context.guestId, ConsentType.PERSONALIZATION)
    revalidatePath(`/g/${token}`)
    return {
      ok: true,
      message: 'Personalisation turned off. Your answers are kept but no longer used to rank anything.',
    }
  } catch (error) {
    return toFormState(error)
  }
}

'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { pesosToMinor, toFormState, type FormState } from '@/lib/form-state'
import { requireActor } from '@/modules/auth/service'
import { confirmOrderItemBySupplier } from '@/modules/commerce/checkout'
import { closeSlot, resolveOperatingSupplier, scheduleAvailability } from '@/modules/suppliers/service'
import {
  createOwnExperience,
  pauseOwnExperience,
  setOwnPrice,
  submitOwnExperienceForReview,
  submitVerificationEvidence,
  updateOwnExperience,
  updateOwnProfile,
} from '@/modules/suppliers/self-service'

/** Partner portal server actions. Each re-resolves the acting supplier. */
export async function scheduleAvailabilityAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor()
    const { supplierId } = await resolveOperatingSupplier(actor)

    const result = await scheduleAvailability(actor, supplierId, {
      experienceId: String(formData.get('experienceId') ?? ''),
      fromDate: String(formData.get('fromDate') ?? ''),
      toDate: String(formData.get('toDate') ?? ''),
      startTimes: String(formData.get('startTimes') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      capacity: formData.get('capacity'),
      weekdays: formData.getAll('weekdays').map((v) => Number(v)),
    })

    revalidatePath('/partner/availability')
    revalidatePath('/partner')

    return {
      ok: true,
      message:
        result.created === 0
          ? 'Nothing to add — those departures already exist, or the dates are in the past.'
          : `${result.created} departures added.`,
      notes:
        result.skipped > 0
          ? [`${result.skipped} were skipped because a departure already existed at that time.`]
          : undefined,
    }
  } catch (error) {
    return toFormState(error)
  }
}

export async function closeSlotAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await requireActor()
    const { supplierId } = await resolveOperatingSupplier(actor)
    await closeSlot(
      actor,
      supplierId,
      String(formData.get('slotId') ?? ''),
      String(formData.get('reason') ?? 'Closed by the partner.'),
    )
    revalidatePath('/partner/availability')
    return { ok: true, message: 'Departure closed. Existing bookings are unaffected.' }
  } catch (error) {
    return toFormState(error)
  }
}

export async function confirmBookingAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor()
    const { supplierId } = await resolveOperatingSupplier(actor)
    await confirmOrderItemBySupplier({
      orderItemId: String(formData.get('orderItemId') ?? ''),
      supplierId,
    })
    revalidatePath('/partner/bookings')
    revalidatePath('/partner')
    return { ok: true, message: 'Confirmed. The hotel can see it.' }
  } catch (error) {
    return toFormState(error)
  }
}

// === Self-service (ADR-041) ==================================================

/**
 * The partner's own actions.
 *
 * Each one re-resolves the acting supplier from the session rather than taking
 * a `supplierId` from the form. There is no hidden field here that names a
 * business, because a hidden field that names a business is a field somebody
 * will eventually set to a different business.
 */
export async function updateOwnProfileAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor()
    const { supplierId } = await resolveOperatingSupplier(actor)

    await updateOwnProfile(actor, supplierId, {
      name: String(formData.get('name') ?? ''),
      legalName: String(formData.get('legalName') ?? '') || null,
      description: String(formData.get('description') ?? '') || null,
      categories: formData.getAll('categories').map((v) => String(v)),
      contactEmail: String(formData.get('contactEmail') ?? ''),
      contactPhone: String(formData.get('contactPhone') ?? '') || null,
      placeId: String(formData.get('placeId') ?? '') || null,
    })

    revalidatePath('/partner/profile')
    revalidatePath('/partner')
    return { ok: true, message: 'Saved. The hotel sees this on their partner list.' }
  } catch (error) {
    return toFormState(error)
  }
}

export async function submitEvidenceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor()
    const { supplierId } = await resolveOperatingSupplier(actor)

    const outcome = await submitVerificationEvidence(actor, supplierId, {
      claimedCertifications: String(formData.get('claimedCertifications') ?? '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      claimedInsurer: String(formData.get('claimedInsurer') ?? '') || null,
      claimedInsurancePolicyRef: String(formData.get('claimedInsurancePolicyRef') ?? '') || null,
      claimedInsuranceExpiresOn: String(formData.get('claimedInsuranceExpiresOn') ?? '') || null,
      evidenceNotes: String(formData.get('evidenceNotes') ?? '') || null,
    })

    revalidatePath('/partner/profile')
    revalidatePath('/partner')
    return {
      ok: true,
      message:
        outcome.verification === 'VERIFIED'
          ? 'Sent. Your existing verification stands while ARC looks at the new documents.'
          : 'Sent. ARC will check these and come back to you.',
      notes: outcome.outstanding.length > 0 ? outcome.outstanding : undefined,
    }
  } catch (error) {
    return toFormState(error)
  }
}

/**
 * Everything `partnerExperienceUpdateSchema` takes, read off the form.
 *
 * No price: an update has no business carrying one, the schema is `.strict()`
 * and omits it, and the edit form does not offer the field. Sending it anyway
 * failed validation with nothing to point at, so no partner could save an
 * edit at all.
 */
function ownExperienceFields(formData: FormData) {
  return {
    propertyId: String(formData.get('propertyId') ?? ''),
    activityId: String(formData.get('activityId') ?? ''),
    placeId: String(formData.get('placeId') ?? '') || null,
    titleEn: String(formData.get('titleEn') ?? ''),
    titleEs: String(formData.get('titleEs') ?? '') || null,
    summaryEn: String(formData.get('summaryEn') ?? '') || null,
    summaryEs: String(formData.get('summaryEs') ?? '') || null,
    descriptionEn: String(formData.get('descriptionEn') ?? '') || null,
    descriptionEs: String(formData.get('descriptionEs') ?? '') || null,
    durationMinutes: formData.get('durationMinutes'),
    minParty: formData.get('minParty'),
    maxParty: formData.get('maxParty'),
    defaultCapacity: formData.get('defaultCapacity'),
    minAgeYears: formData.get('minAgeYears') ? formData.get('minAgeYears') : null,
    includesTransfer: formData.get('includesTransfer') === 'on',
    guideIncluded: formData.get('guideIncluded') === 'on',
    meetingPoint: String(formData.get('meetingPoint') ?? '') || null,
    whatToBringEn: String(formData.get('whatToBringEn') ?? '') || null,
    whatToBringEs: String(formData.get('whatToBringEs') ?? '') || null,
    cancellationPolicyHours: formData.get('cancellationPolicyHours'),
  }
}

/** The same fields plus the opening price, which only a new listing carries. */
function newExperiencePayload(formData: FormData) {
  return {
    ...ownExperienceFields(formData),
    priceMinor: pesosToMinor(formData.get('price')),
  }
}

export async function createOwnExperienceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor()
  const { supplierId } = await resolveOperatingSupplier(actor)

  let created: { id: string; slug: string; adjustments: string[] }
  try {
    created = await createOwnExperience(actor, supplierId, newExperiencePayload(formData))
  } catch (error) {
    return toFormState(error)
  }

  revalidatePath('/partner/listings')
  redirect(`/partner/listings/${created.id}?created=1`)
}

export async function updateOwnExperienceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor()
    const { supplierId } = await resolveOperatingSupplier(actor)
    const experienceId = String(formData.get('experienceId') ?? '')

    const { adjustments } = await updateOwnExperience(
      actor,
      supplierId,
      experienceId,
      ownExperienceFields(formData),
    )

    revalidatePath(`/partner/listings/${experienceId}`)
    revalidatePath('/partner/listings')
    return {
      ok: true,
      message: 'Saved.',
      notes: adjustments.length > 0 ? adjustments : undefined,
    }
  } catch (error) {
    return toFormState(error)
  }
}

export async function setOwnPriceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await requireActor()
    const { supplierId } = await resolveOperatingSupplier(actor)
    const experienceId = String(formData.get('experienceId') ?? '')

    await setOwnPrice(actor, supplierId, {
      experienceId,
      amountMinor: pesosToMinor(formData.get('price')),
      minParty: formData.get('minParty') ?? 1,
      note: String(formData.get('note') ?? '') || null,
    })

    revalidatePath(`/partner/listings/${experienceId}`)
    revalidatePath('/partner/listings')
    return {
      ok: true,
      message: 'New price saved. It applies to the next guest who books, not to anyone who already has.',
    }
  } catch (error) {
    return toFormState(error)
  }
}

export async function submitForReviewAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor()
    const { supplierId } = await resolveOperatingSupplier(actor)
    const experienceId = String(formData.get('experienceId') ?? '')

    const outcome = await submitOwnExperienceForReview(actor, supplierId, experienceId)

    revalidatePath(`/partner/listings/${experienceId}`)
    revalidatePath('/partner/listings')

    const notes = [...outcome.blockers, ...outcome.warnings]
    return {
      ok: true,
      message:
        outcome.blockers.length > 0
          ? 'Sent to the hotel. They cannot publish it until the points below are sorted.'
          : 'Sent to the hotel to publish.',
      notes: notes.length > 0 ? notes : undefined,
    }
  } catch (error) {
    return toFormState(error)
  }
}

export async function pauseOwnExperienceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor()
    const { supplierId } = await resolveOperatingSupplier(actor)
    const experienceId = String(formData.get('experienceId') ?? '')

    await pauseOwnExperience(actor, supplierId, experienceId)

    revalidatePath(`/partner/listings/${experienceId}`)
    revalidatePath('/partner/listings')
    return {
      ok: true,
      message:
        'Paused. No new bookings; anything already booked stands, and you still owe those guests the departure.',
    }
  } catch (error) {
    return toFormState(error)
  }
}

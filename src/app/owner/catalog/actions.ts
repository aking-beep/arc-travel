'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { ExperienceStatus } from '@/lib/prisma-types'
import { pesosToMinor, toFormState, type FormState } from '@/lib/form-state'
import { requireActor } from '@/modules/auth/service'
import {
  addPrice,
  addSlot,
  createExperience,
  setExperienceStatus,
  updateExperience,
} from '@/modules/catalog/service'
import { resolveOperatingProperty } from '@/modules/hotels/service'

/**
 * Server actions for the catalog.
 *
 * Each one converts the HTML form into a plain object, hands it to the domain
 * service, and turns thrown errors into a `FormState` the page can render. No
 * validation or money arithmetic happens here — the edge translates, the
 * service decides.
 */
function experiencePayload(formData: FormData) {
  return {
    supplierId: String(formData.get('supplierId') ?? ''),
    activityId: String(formData.get('activityId') ?? ''),
    placeId: String(formData.get('placeId') ?? '') || null,
    titleEn: String(formData.get('titleEn') ?? ''),
    titleEs: String(formData.get('titleEs') ?? '') || null,
    summaryEn: String(formData.get('summaryEn') ?? '') || null,
    summaryEs: String(formData.get('summaryEs') ?? '') || null,
    descriptionEn: String(formData.get('descriptionEn') ?? '') || null,
    descriptionEs: String(formData.get('descriptionEs') ?? '') || null,
    category: String(formData.get('category') ?? 'SURF'),
    durationMinutes: formData.get('durationMinutes'),
    minAbility: String(formData.get('minAbility') ?? 'BEGINNER'),
    maxAbility: String(formData.get('maxAbility') ?? 'EXPERT'),
    minParty: formData.get('minParty'),
    maxParty: formData.get('maxParty'),
    minAgeYears: formData.get('minAgeYears') ? formData.get('minAgeYears') : null,
    defaultCapacity: formData.get('defaultCapacity'),
    includesTransfer: formData.get('includesTransfer') === 'on',
    guideIncluded: formData.get('guideIncluded') === 'on',
    meetingPoint: String(formData.get('meetingPoint') ?? '') || null,
    whatToBringEn: String(formData.get('whatToBringEn') ?? '') || null,
    whatToBringEs: String(formData.get('whatToBringEs') ?? '') || null,
    cancellationPolicyHours: formData.get('cancellationPolicyHours'),
    priceMinor: pesosToMinor(formData.get('price')),
    bookingFeeMinor: pesosToMinor(formData.get('bookingFee')),
  }
}

export async function createExperienceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor()
  const { propertyId } = await resolveOperatingProperty(actor)

  let created: { id: string; adjustments: string[] }
  try {
    created = await createExperience(actor, propertyId, experiencePayload(formData))
  } catch (error) {
    return toFormState(error)
  }

  revalidatePath('/owner/catalog')
  redirect(`/owner/catalog/${created.id}?created=1`)
}

export async function updateExperienceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor()
  const experienceId = String(formData.get('experienceId') ?? '')

  try {
    const { adjustments } = await updateExperience(actor, experienceId, experiencePayload(formData))
    revalidatePath(`/owner/catalog/${experienceId}`)
    revalidatePath('/owner/catalog')
    return {
      ok: true,
      message: 'Saved.',
      notes: adjustments.length > 0 ? adjustments : undefined,
    }
  } catch (error) {
    return toFormState(error)
  }
}

export async function setStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireActor()
  const experienceId = String(formData.get('experienceId') ?? '')
  const status = String(formData.get('status') ?? '') as ExperienceStatus

  try {
    const readiness = await setExperienceStatus(actor, experienceId, status)
    revalidatePath('/owner/catalog')
    revalidatePath(`/owner/catalog/${experienceId}`)
    return {
      ok: true,
      message:
        status === ExperienceStatus.PUBLISHED
          ? 'Published. Guests can see it now.'
          : `Status set to ${status.toLowerCase()}.`,
      notes: readiness.warnings.length > 0 ? readiness.warnings : undefined,
    }
  } catch (error) {
    return toFormState(error)
  }
}

export async function addSlotAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireActor()
  const experienceId = String(formData.get('experienceId') ?? '')

  try {
    await addSlot(actor, {
      experienceId,
      date: String(formData.get('date') ?? ''),
      startTime: String(formData.get('startTime') ?? ''),
      capacity: formData.get('capacity'),
      priceOverrideMinor: formData.get('priceOverride')
        ? pesosToMinor(formData.get('priceOverride'))
        : null,
      note: String(formData.get('note') ?? '') || null,
    })
    revalidatePath(`/owner/catalog/${experienceId}`)
    return { ok: true, message: 'Departure added.' }
  } catch (error) {
    return toFormState(error)
  }
}

export async function addPriceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireActor()
  const experienceId = String(formData.get('experienceId') ?? '')

  try {
    await addPrice(actor, {
      experienceId,
      amountMinor: pesosToMinor(formData.get('amount')),
      bookingFeeMinor: pesosToMinor(formData.get('bookingFee')),
      minParty: formData.get('minParty'),
      kind: String(formData.get('kind') ?? 'BASE'),
      note: String(formData.get('note') ?? '') || null,
    })
    revalidatePath(`/owner/catalog/${experienceId}`)
    return { ok: true, message: 'Price added.' }
  } catch (error) {
    return toFormState(error)
  }
}

'use server'

import { revalidatePath } from 'next/cache'
import { requireActor } from '@/modules/auth/service'
import { toFormState, type FormState } from '@/lib/form-state'
import { pesosToMinor } from '@/lib/form-state'
import { resolveOperatingProperty } from '@/modules/hotels/service'
import {
  setCommissionRuleActive,
  updateCommissionDefaults,
  upsertCommissionRule,
} from '@/modules/commerce/commission-admin'

/**
 * Commission administration actions.
 *
 * Percentages are typed as percentages and stored as basis points; a fixed
 * amount is typed in pesos and stored in centavos. Both conversions happen
 * exactly once, here at the form edge.
 */
const bps = (value: FormDataEntryValue | null): number =>
  Math.round(Number(String(value ?? '0').replace(/[^0-9.]/g, '')) * 100)

export async function saveCommissionRuleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor()
  const { propertyId } = await resolveOperatingProperty(actor)
  const basis = String(formData.get('basis') ?? 'PERCENT_OF_GROSS')
  const fixed = basis === 'FIXED_PER_UNIT'

  try {
    await upsertCommissionRule(actor, propertyId, {
      id: String(formData.get('id') ?? '') || undefined,
      // Scope: an experience implies the property; a bare category or nothing
      // is organization-wide unless the form says otherwise.
      propertyId: formData.get('scopeProperty') === 'on' ? propertyId : null,
      experienceId: String(formData.get('experienceId') ?? '') || null,
      category: String(formData.get('category') ?? '') || null,
      basis,
      hotelShare: fixed ? pesosToMinor(formData.get('hotelShare')) : bps(formData.get('hotelShare')),
      platformShare: fixed
        ? pesosToMinor(formData.get('platformShare'))
        : bps(formData.get('platformShare')),
      priority: formData.get('priority') ?? 0,
      note: String(formData.get('note') ?? '') || null,
      isActive: true,
    })

    revalidatePath('/owner/revenue/commission')
    revalidatePath('/owner/revenue')
    return { ok: true, message: 'Rule saved. New bookings resolve against it immediately.' }
  } catch (error) {
    return toFormState(error)
  }
}

export async function toggleCommissionRuleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor()

  try {
    await setCommissionRuleActive(
      actor,
      String(formData.get('ruleId') ?? ''),
      formData.get('isActive') === 'true',
    )
    revalidatePath('/owner/revenue/commission')
    return { ok: true, message: 'Rule updated.' }
  } catch (error) {
    return toFormState(error)
  }
}

export async function saveCommissionDefaultsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor()
  const { organizationId } = await resolveOperatingProperty(actor)

  try {
    await updateCommissionDefaults(actor, organizationId, {
      hotelBps: bps(formData.get('hotelPct')),
      platformBps: bps(formData.get('platformPct')),
    })
    revalidatePath('/owner/revenue/commission')
    return { ok: true, message: 'Defaults saved.' }
  } catch (error) {
    return toFormState(error)
  }
}

'use server'

import { revalidatePath } from 'next/cache'
import { toFormState, type FormState } from '@/lib/form-state'
import { requireActor } from '@/modules/auth/service'
import { confirmOrderItemBySupplier } from '@/modules/commerce/checkout'
import { closeSlot, resolveOperatingSupplier, scheduleAvailability } from '@/modules/suppliers/service'

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

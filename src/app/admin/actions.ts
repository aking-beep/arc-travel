'use server'

import { revalidatePath } from 'next/cache'
import { toFormState, type FormState } from '@/lib/form-state'
import { VerificationStatus } from '@/lib/prisma-types'
import { requireActor } from '@/modules/auth/service'
import { verifyProperty, verifySupplier } from '@/modules/admin/service'

/** Verification decisions. The only path to a VERIFIED status in the product. */
export async function verifySupplierAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor()
    const decision = String(formData.get('decision') ?? '') as VerificationStatus

    await verifySupplier(actor, {
      supplierId: String(formData.get('supplierId') ?? ''),
      decision,
      note: String(formData.get('note') ?? ''),
      insuranceOnFile: formData.get('insuranceOnFile') === 'on',
    })

    revalidatePath('/admin')
    revalidatePath('/owner/partners')

    return {
      ok: true,
      message:
        decision === VerificationStatus.VERIFIED
          ? 'Verified. Guests now see a verified badge on this partner.'
          : `Recorded as ${decision.toLowerCase()}.`,
    }
  } catch (error) {
    return toFormState(error)
  }
}

export async function verifyPropertyAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor()
    await verifyProperty(actor, {
      propertyId: String(formData.get('propertyId') ?? ''),
      decision: String(formData.get('decision') ?? '') as VerificationStatus,
      note: String(formData.get('note') ?? ''),
    })
    revalidatePath('/admin')
    return { ok: true, message: 'Recorded.' }
  } catch (error) {
    return toFormState(error)
  }
}

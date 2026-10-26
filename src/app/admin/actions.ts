'use server'

import { revalidatePath } from 'next/cache'
import { toFormState, type FormState } from '@/lib/form-state'
import { VerificationStatus } from '@/lib/prisma-types'
import { requireActor } from '@/modules/auth/service'
import { verifyProperty, verifySupplier } from '@/modules/admin/service'
import { CHECK_KEYS } from '@/modules/admin/verification'
import { refreshTravelAdvice, reviewSourceChange } from '@/modules/culture-context/snapshots'

/** Verification decisions. The only path to a VERIFIED status in the product. */
export async function verifySupplierAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor()
    const decision = String(formData.get('decision') ?? '') as VerificationStatus

    /*
     * One checkbox per check, named `check:<key>`. Translated here and
     * validated by the service, which is the thing entitled to be trusted to
     * have validated its input (`CLAUDE.md`, validation).
     */
    const checks = CHECK_KEYS.filter((key) => formData.get(`check:${key}`) === 'on')
    const expiry = String(formData.get('insuranceExpiresOn') ?? '').trim()

    await verifySupplier(actor, {
      supplierId: String(formData.get('supplierId') ?? ''),
      decision,
      note: String(formData.get('note') ?? ''),
      checks,
      insuranceExpiresOn: expiry.length > 0 ? expiry : null,
    })

    revalidatePath('/admin')
    revalidatePath('/owner/partners')

    return {
      ok: true,
      message:
        decision === VerificationStatus.VERIFIED
          ? 'Verified. Guests now see a verified badge on this partner, until the insurance on ' +
            'file expires.'
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

/**
 * A culture-source change review. VERIFIED is the only thing that lets a guest
 * be told the advice changed; see docs/culture-context.md.
 */
export async function reviewSourceChangeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor()
    const decision = String(formData.get('decision') ?? '') as VerificationStatus
    await reviewSourceChange(actor, {
      changeId: String(formData.get('changeId') ?? ''),
      decision,
      note: String(formData.get('note') ?? ''),
    })
    revalidatePath('/admin')
    revalidatePath('/admin/health')
    return {
      ok: true,
      message:
        decision === VerificationStatus.VERIFIED
          ? 'Verified. Guests now see that this advice was updated.'
          : `Recorded as ${decision.toLowerCase()}. Guests see no change notice.`,
    }
  } catch (error) {
    return toFormState(error)
  }
}

/** Checks a travel-advice source now and records the snapshot. */
export async function refreshTravelAdviceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor()
    const result = await refreshTravelAdvice(actor, {
      destination: String(formData.get('destination') ?? ''),
    })
    revalidatePath('/admin')
    revalidatePath('/admin/health')
    const messages = {
      baseline: 'First snapshot recorded.',
      unchanged: 'Checked. The content is unchanged.',
      changed: 'The content changed. A review item is waiting on the verification page.',
      unavailable: `The source could not be read (${result.failureReason}). Recorded as a failed check.`,
    } as const
    return { ok: result.outcome !== 'unavailable', message: messages[result.outcome] }
  } catch (error) {
    return toFormState(error)
  }
}

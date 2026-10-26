'use server'

import { revalidatePath } from 'next/cache'
import { toFormState, type FormState } from '@/lib/form-state'
import { formatMoney } from '@/lib/money'
import { requireActor } from '@/modules/auth/service'
import { resolveOperatingProperty } from '@/modules/hotels/service'
import { cancelPayout, runPayouts, settlePayout } from '@/modules/commerce/payouts'
import type { DateKey } from '@/lib/dates'

/**
 * Three actions, and the shape of each one says what it is allowed to do.
 *
 * Each translates a form, calls one service and turns a thrown error into a
 * `FormState`. None of them computes money: the period arrives as two date
 * strings, and everything about what is owed is derived inside
 * `modules/commerce/payouts` from ledger rows.
 */

/** Computes payouts for a period. Claims ledger entries; moves no money. */
export async function runPayoutsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor()
    const { propertyId } = await resolveOperatingProperty(actor)

    const result = await runPayouts(actor, {
      propertyId,
      from: String(formData.get('from') ?? '') as DateKey,
      to: String(formData.get('to') ?? '') as DateKey,
      note: String(formData.get('note') ?? '') || undefined,
    })

    revalidatePath('/owner/payouts')
    revalidatePath('/owner/approvals')

    if (result.created.length === 0) {
      return {
        ok: true,
        message: 'Nothing to pay out for that period.',
        notes: result.skipped.map((entry) => entry.reason),
      }
    }

    return {
      ok: true,
      message:
        `${result.created.length} ${result.created.length === 1 ? 'payout' : 'payouts'} computed. ` +
        'Each one is waiting for your approval before it can be paid.',
      notes: [
        ...result.created.map(
          (entry) => `${entry.reference} — ${formatMoney(entry.netMinor)}`,
        ),
        ...result.skipped.map((entry) => entry.reason),
      ],
    }
  } catch (error) {
    return toFormState(error)
  }
}

/**
 * Records that an approved payout was actually paid.
 *
 * The reference is what the owner typed in after making the transfer. ARC
 * cannot verify it and this action does not pretend to — what it enforces is
 * that the payout was approved first, and that the record names who said so.
 */
export async function settlePayoutAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor()

    const result = await settlePayout(actor, {
      payoutId: String(formData.get('payoutId') ?? ''),
      settlementReference: String(formData.get('settlementReference') ?? ''),
      settlementMethod: String(formData.get('settlementMethod') ?? ''),
    })

    revalidatePath('/owner/payouts')
    revalidatePath(`/owner/payouts/${result.payoutId}`)

    return {
      ok: true,
      message: `${result.reference} recorded as paid — ${formatMoney(result.netMinor)}.`,
      notes: [
        'ARC did not send this money and has no way to confirm it arrived. This is your record that you sent it.',
      ],
    }
  } catch (error) {
    return toFormState(error)
  }
}

/** Abandons a payout and releases its ledger entries to the next run. */
export async function cancelPayoutAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor()

    const result = await cancelPayout(actor, {
      payoutId: String(formData.get('payoutId') ?? ''),
      reason: String(formData.get('reason') ?? '') || 'Cancelled by the owner.',
    })

    revalidatePath('/owner/payouts')
    revalidatePath('/owner/approvals')

    return {
      ok: true,
      message:
        `Cancelled. ${result.releasedLines} ${result.releasedLines === 1 ? 'entry is' : 'entries are'} ` +
        'open again and will appear in the next run.',
    }
  } catch (error) {
    return toFormState(error)
  }
}

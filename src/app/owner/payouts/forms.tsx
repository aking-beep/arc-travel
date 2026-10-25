'use client'

import { useActionState } from 'react'
import { Field, Input, Textarea } from '@/components/ui/field'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import { cancelPayoutAction, runPayoutsAction, settlePayoutAction } from './actions'

/**
 * The period comes in as server-computed defaults.
 *
 * A client component must not read the clock during render, and "the month so
 * far" is a clock read. `monthToDate()` runs on the server and the two dates
 * arrive as props — the linter enforces this and has already caught one real
 * instance.
 */
export function RunPayoutsForm({ from, to }: { from: string; to: string }) {
  const [state, formAction] = useActionState(runPayoutsAction, emptyFormState)

  return (
    <form action={formAction} className="space-y-4">
      <FormFeedback state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From" htmlFor="payout-from">
          <Input id="payout-from" type="date" name="from" defaultValue={from} required />
        </Field>
        <Field label="To" htmlFor="payout-to">
          <Input id="payout-to" type="date" name="to" defaultValue={to} required />
        </Field>
      </div>

      <Field
        label="Note"
        hint="Carried onto each remittance advice. Optional."
        htmlFor="payout-note"
      >
        <Textarea id="payout-note" name="note" rows={2} maxLength={400} />
      </Field>

      <SubmitButton pendingLabel="Working out what is owed…">Compute payouts</SubmitButton>
    </form>
  )
}

/**
 * Records a payment that has already happened outside ARC.
 *
 * Both fields are required, and the service refuses a blank either way: a
 * payout marked paid with no reference is a claim about money with nothing
 * behind it, and a database CHECK refuses that row too.
 */
export function SettlePayoutForm({ payoutId }: { payoutId: string }) {
  const [state, formAction] = useActionState(settlePayoutAction, emptyFormState)

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="payoutId" value={payoutId} />
      <FormFeedback state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="How you paid it"
          hint="Bank transfer, cash, SPEI…"
          htmlFor="settlement-method"
        >
          <Input
            id="settlement-method"
            name="settlementMethod"
            required
            maxLength={60}
            placeholder="Bank transfer"
          />
        </Field>
        <Field
          label="Payment reference"
          hint="The reference your bank gave the transfer."
          htmlFor="settlement-reference"
        >
          <Input id="settlement-reference" name="settlementReference" required maxLength={120} />
        </Field>
      </div>

      <SubmitButton pendingLabel="Recording…">Record this as paid</SubmitButton>
    </form>
  )
}

/** Abandons a payout. Its ledger entries go back into the next run. */
export function CancelPayoutForm({ payoutId }: { payoutId: string }) {
  const [state, formAction] = useActionState(cancelPayoutAction, emptyFormState)

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="payoutId" value={payoutId} />
      <FormFeedback state={state} />
      <Field label="Why" htmlFor="cancel-reason">
        <Input id="cancel-reason" name="reason" maxLength={200} required />
      </Field>
      <SubmitButton variant="outline" size="sm" pendingLabel="Cancelling…">
        Cancel this payout
      </SubmitButton>
    </form>
  )
}

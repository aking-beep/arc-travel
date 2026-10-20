'use client'

import { useActionState } from 'react'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import { createTranslator, type AppLocale } from '@/lib/i18n'
import { checkoutAction, clearBasketAction, removeFromBasketAction } from '../actions'

export function BasketActions({
  token,
  slotId,
  locale,
}: {
  token: string
  slotId: string
  locale: AppLocale
}) {
  const [state, formAction] = useActionState(removeFromBasketAction, emptyFormState)
  const t = createTranslator(locale)

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="slotId" value={slotId} />
      <SubmitButton variant="ghost" size="sm" pendingLabel="Removing…">
        {t('common.cancel')}
      </SubmitButton>
      <FormFeedback state={state} />
    </form>
  )
}

/**
 * Simulated checkout.
 *
 * The idempotency key is rendered into the form by the server, so a double-tap
 * or a resubmitted page replays the first order rather than creating a second.
 */
export function CheckoutForm({
  token,
  idempotencyKey,
  disabled,
  locale,
}: {
  token: string
  idempotencyKey: string
  disabled: boolean
  locale: AppLocale
}) {
  const [state, formAction] = useActionState(checkoutAction, emptyFormState)
  const t = createTranslator(locale)

  return (
    <form action={formAction} className="space-y-3 pt-2">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <FormFeedback state={state} />
      <SubmitButton
        size="lg"
        block
        variant="accent"
        disabled={disabled}
        pendingLabel="Reserving your places…"
      >
        {t('guest.checkoutSimulated')}
      </SubmitButton>
    </form>
  )
}

export function ClearBasketButton({ token, locale }: { token: string; locale: AppLocale }) {
  const [state, formAction] = useActionState(clearBasketAction, emptyFormState)
  const t = createTranslator(locale)

  return (
    <form action={formAction}>
      <input type="hidden" name="token" value={token} />
      <FormFeedback state={state} />
      <SubmitButton variant="ghost" size="sm">
        {t('common.cancel')}
      </SubmitButton>
    </form>
  )
}

'use client'

import { useActionState } from 'react'
import { FormFeedback, SubmitButton } from '@/components/ui/form-feedback'
import { emptyFormState } from '@/lib/form-state'
import { createTranslator, type AppLocale } from '@/lib/i18n'
import { cancelBookingAction } from '../../actions'

export function CancelBookingForm({
  token,
  orderItemId,
  cancellationHours,
  locale,
}: {
  token: string
  orderItemId: string
  cancellationHours: number
  locale: AppLocale
}) {
  const [state, formAction] = useActionState(cancelBookingAction, emptyFormState)
  const t = createTranslator(locale)

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="orderItemId" value={orderItemId} />
      <SubmitButton variant="ghost" size="sm" pendingLabel="Cancelling…">
        {t('common.cancel')}
      </SubmitButton>
      <span className="text-sand-400 text-[0.6875rem]">
        Free up to {cancellationHours}h before
      </span>
      <FormFeedback state={state} />
    </form>
  )
}

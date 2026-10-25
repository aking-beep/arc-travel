'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { loadStripe, type Stripe, type StripeElements } from '@stripe/stripe-js'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FormFeedback } from '@/components/ui/form-feedback'
import { Money } from '@/components/money'
import { emptyFormState } from '@/lib/form-state'
import { createTranslator, type AppLocale } from '@/lib/i18n'
import { checkoutAction } from '@/app/g/[token]/actions'

/**
 * The card form. The only place in ARC where a guest can actually pay.
 *
 * ## Why this is built against Stripe.js directly
 *
 * The card number is typed into an iframe Stripe serves from its own origin.
 * ARC's JavaScript cannot read it, ARC's server never receives it, and ARC's
 * logs cannot contain it — which is the whole of why this component exists
 * rather than a form of our own with a `name="card_number"` in it. There is no
 * version of collecting a PAN ourselves that is worth the scope it drags in.
 *
 * `@stripe/react-stripe-js` would wrap this in a provider and three hooks. It
 * is not taken, for the reason `modules/integrations/stripe.ts` does not take
 * the server SDK: the imperative API is two calls, and a dependency whose
 * transitive tree has to be pinned and audited is not justified by saving
 * them. `@stripe/stripe-js` itself *is* taken, because it is the loader that
 * fetches the script from `js.stripe.com` — the script has to come from Stripe
 * for PCI scope to stay where it is, so loading it by hand would be
 * reimplementing the one part that must not be reimplemented.
 *
 * ## The order of operations, and why it is this one
 *
 *   1. The guest confirms the payment with Stripe. ARC is not involved.
 *   2. Stripe tells this component the intent succeeded.
 *   3. The reference is put into a form and the checkout action runs.
 *   4. The server reads the amount and status back *from Stripe* and writes the
 *      order, or refuses.
 *
 * Step 4 reading from the provider rather than trusting step 3 is ADR-026. It
 * means a guest who tampers with the hidden field gets a refusal, and a
 * payment that succeeded against a basket that has since changed gets a
 * refusal with an audit row, rather than a booking ARC cannot deliver.
 *
 * The window between 2 and 4 is real: a guest who closes the tab there has
 * paid for an order that does not exist. That is deliberate — ADR-026 chose it
 * over the alternative, which needs an automatic refund, which needs an
 * `Approval` row naming a person (non-negotiable 6). It is a reconciliation
 * item, and `docs/operations.md` says how to find it.
 *
 * ## Clock and locale
 *
 * Nothing here reads the clock or any other impure source during render; the
 * amount, the currency, the locale and the keys all arrive as props, computed
 * on the server. Stripe.js is loaded in an effect, which is after render.
 */

type Status =
  | { kind: 'loading' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'ready' }
  | { kind: 'confirming' }
  | { kind: 'failed'; message: string }

export function PaymentForm({
  clientSecret,
  publishableKey,
  amountMinor,
  currency,
  locale,
  token,
  idempotencyKey,
}: {
  clientSecret: string
  publishableKey: string
  amountMinor: number
  currency: string
  locale: AppLocale
  token: string
  idempotencyKey: string
}) {
  const t = createTranslator(locale)
  const [checkoutState, checkoutFormAction] = useActionState(checkoutAction, emptyFormState)
  const mountRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const stripeRef = useRef<Stripe | null>(null)
  const elementsRef = useRef<StripeElements | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  const [paymentReference, setPaymentReference] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      /*
       * `loadStripe` can reject: the script is a third-party fetch and the CSP,
       * an extension or a captive network can stop it. Unhandled, this
       * component renders an empty box for ever — which the guest reads as the
       * site being broken rather than as "you cannot pay right now".
       */
      let stripe: Stripe | null = null
      try {
        stripe = await loadStripe(publishableKey)
      } catch {
        stripe = null
      }
      if (cancelled) return
      if (!stripe) {
        setStatus({
          kind: 'unavailable',
          message: t('guest.paymentUnavailable'),
        })
        return
      }

      const elements = stripe.elements({
        clientSecret,
        // Stripe's own locale list, which is wider than ARC's two. Passing
        // ARC's locale through keeps the card form in the language the rest of
        // the page is in.
        locale,
        appearance: { theme: 'flat', variables: { borderRadius: '12px' } },
      })
      const element = elements.create('payment')
      if (!mountRef.current) return
      element.mount(mountRef.current)

      stripeRef.current = stripe
      elementsRef.current = elements
      setStatus({ kind: 'ready' })
    })()

    return () => {
      cancelled = true
      elementsRef.current?.getElement('payment')?.unmount()
    }
    // `t` is derived from `locale`, and re-mounting the element on every render
    // would discard what the guest has typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientSecret, publishableKey, locale])

  async function confirm(): Promise<void> {
    const stripe = stripeRef.current
    const elements = elementsRef.current
    if (!stripe || !elements) return

    setStatus({ kind: 'confirming' })

    const result = await stripe.confirmPayment({
      elements,
      /*
       * `if_required` keeps the guest on this page unless their bank insists
       * on a redirect. A redirect would land back on a URL carrying the portal
       * token in its path, which is a bearer credential, and would put it in
       * the browser history of whatever device finished the 3-D Secure step.
       * `return_url` is still required by Stripe for the cases where a
       * redirect genuinely cannot be avoided.
       */
      confirmParams: { return_url: `${window.location.origin}/g/${token}/basket` },
      redirect: 'if_required',
    })

    if (result.error) {
      /*
       * Stripe's own message, shown as-is.
       *
       * It is written for the cardholder, is localised, and knows things we do
       * not — "your card was declined" versus "your card does not support this
       * currency". Substituting our own sentence would be less accurate and no
       * safer. The error object is never logged: it can carry the last four
       * digits and the issuing bank.
       */
      setStatus({
        kind: 'failed',
        message: result.error.message ?? t('guest.paymentDeclined'),
      })
      return
    }

    const intent = result.paymentIntent
    if (!intent || intent.status !== 'succeeded') {
      // Not an error and not a success — `processing`, or a status Stripe added
      // after this was written. The webhook is what resolves it, so the honest
      // thing is to say the money has not arrived and book nothing.
      setStatus({ kind: 'failed', message: t('guest.paymentPending') })
      return
    }

    /*
     * Hand the reference to the server action.
     *
     * Set into state and submitted from the effect below rather than written
     * into the DOM and submitted here, so React — not this function — owns the
     * hidden field's value at the moment the form is submitted.
     */
    setPaymentReference(intent.id)
  }

  useEffect(() => {
    if (paymentReference) formRef.current?.requestSubmit()
  }, [paymentReference])

  const disabled = status.kind !== 'ready'

  return (
    <div className="space-y-3 pt-2">
      {/*
        * The form is not what the guest interacts with: it carries the
        * reference to the server action once Stripe has confirmed, and is
        * submitted programmatically. It has no submit control of its own,
        * because a guest pressing one before confirming would ask the server
        * to book an order with no payment — which `checkout()` refuses, after
        * a round trip, with a message that reads like a fault.
        */}
      <form ref={formRef} action={checkoutFormAction} className="hidden">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <input type="hidden" name="paymentIntentId" value={paymentReference ?? ''} />
      </form>

      {/*
        * A failure here is the worst message in the product: the guest has
        * paid and has no booking. It is shown with the payment reference,
        * because that is the one string that lets somebody find the money.
        */}
      {checkoutState.message && !checkoutState.ok ? (
        <div className="space-y-2">
          <FormFeedback state={checkoutState} />
          <p className="text-sand-600 text-xs">
            {t('guest.paymentTakenNoBooking')}{' '}
            <span className="font-mono">{paymentReference}</span>
          </p>
        </div>
      ) : null}

      <div ref={mountRef} className="min-h-[220px]" />

      {status.kind === 'loading' ? (
        <p className="text-sand-500 text-sm" role="status">
          {t('guest.paymentLoading')}
        </p>
      ) : null}

      {status.kind === 'unavailable' || status.kind === 'failed' ? (
        <p
          className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {status.message}
        </p>
      ) : null}

      <Button
        type="button"
        size="lg"
        block
        variant="accent"
        disabled={disabled}
        aria-busy={status.kind === 'confirming'}
        onClick={() => void confirm()}
      >
        {status.kind === 'confirming' ? (
          t('guest.paymentConfirming')
        ) : (
          <>
            {t('guest.payNow')} <Money amountMinor={amountMinor} currency={currency} intent="neutral" />
          </>
        )}
      </Button>

      <p className="text-sand-500 text-xs">{t('guest.paymentCardNote')}</p>
    </div>
  )
}

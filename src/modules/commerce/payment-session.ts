import { createHash } from 'node:crypto'

import { prisma } from '@/lib/db'
import { AppError, invalid, notFound } from '@/lib/errors'
import { getEnv } from '@/lib/env'
import { assertWithinRateLimit } from '@/lib/rate-limit'
import { money } from '@/lib/money'
import { getIntegrations } from '@/modules/integrations/defaults'
import { computeCartTotals } from './pricing'

/**
 * The half of checkout that happens in the guest's browser.
 *
 * Until this existed, ARC had a Stripe adapter, a signature-verified webhook,
 * a FAILED order state and no way for a guest to pay: `checkout()` requires a
 * confirmed payment intent when the provider is live (ADR-026), and nothing
 * ever produced one. The build could take an order and could not take money.
 *
 * What this module does is small on purpose. It creates — or re-uses — the
 * payment intent for one basket and returns what the browser needs to confirm
 * it: a client secret and a publishable key. It does not confirm, does not
 * book, and does not write an order. The guest's browser confirms with Stripe,
 * hands the reference back, and `checkout()` reads the authoritative amount and
 * status from Stripe rather than believing the client. No card number passes
 * through an ARC origin, server or log, because the card is typed into an
 * iframe Stripe serves.
 *
 * ## Why the idempotency key is derived rather than random
 *
 * The basket page is a Server Component and re-renders whenever the basket
 * changes — every `revalidatePath` after an add or a remove. A random key per
 * render would create a fresh intent on each one, leaving a trail of abandoned
 * intents at Stripe and, worse, letting a guest hold two confirmable secrets
 * for the same basket at once.
 *
 * So the key is a hash of `(cartId, totalMinor, currency)`. Re-rendering an
 * unchanged basket returns Stripe's own memoised response — the same intent,
 * the same secret. Changing the basket changes the key, which is what we want:
 * the amount is part of what the guest is confirming, so a different amount is
 * a different payment. Stripe honours an idempotency key for 24 hours, which is
 * far longer than a basket lives (`InventoryHold` is a 15-minute promise).
 *
 * ## What happens when the basket changes after the guest has paid
 *
 * Nothing new, and that is the point. `checkout()` re-reads the lines inside
 * its transaction and refuses to commit when the provider's amount and the
 * basket's total disagree, writing a `commerce.checkout.payment_mismatch`
 * audit row that survives the rollback. That refusal is the backstop this
 * module is allowed to rely on. It deliberately does *not* try to be clever
 * about updating an intent's amount in place: that race is exactly the one
 * ADR-026 closed by reading the amount from the provider at commit time.
 */

/** Payment sessions one guest may open in a minute. */
export const PAYMENT_SESSIONS_PER_MINUTE = 30

export interface PaymentSession {
  /**
   * Null when this build takes no real payments.
   *
   * The caller renders the simulated checkout button in that case rather than
   * a payment form. It is a separate field from an error because "no payment
   * is needed" is a correct, expected answer in demo mode, not a failure.
   */
  clientSecret: string | null
  /** Null for the same reason. Safe to render; see `src/lib/env.ts`. */
  publishableKey: string | null
  /** The provider's reference, so the client can submit it with the checkout. */
  paymentReference: string | null
  /** What the guest is being asked to confirm, as the server computed it. */
  amountMinor: number
  currency: string
  /** False only when a real provider is answering. */
  isSimulated: boolean
}

/**
 * Stripe's own idempotency key for this basket at this total.
 *
 * Hashed rather than concatenated because the key is sent to Stripe in a
 * header: a cart id is an internal identifier and there is no reason to put it
 * in a third party's logs when a digest of it does the same job.
 */
export function paymentIntentKey(input: {
  cartId: string
  totalMinor: number
  currency: string
}): string {
  const digest = createHash('sha256')
    .update(`${input.cartId}:${input.totalMinor}:${input.currency}`)
    .digest('hex')
  return `arc-cart-${digest.slice(0, 32)}`
}

/**
 * Opens the payment for one basket.
 *
 * `guestId` comes from the portal token, never from the client — the cart is
 * loaded and then its owner is checked, and a mismatch is a `notFound` rather
 * than a `forbidden` so a caller cannot use the difference to discover whether
 * a cart id exists.
 */
export async function startPaymentSession(input: {
  cartId: string
  guestId: string
  now?: Date
}): Promise<PaymentSession> {
  const now = input.now ?? new Date()
  const env = getEnv()
  const payments = getIntegrations().payments

  const cart = await prisma.cart.findUnique({
    where: { id: input.cartId },
    select: { id: true, guestId: true, currency: true, status: true },
  })
  if (!cart) throw notFound('Basket')
  if (cart.guestId !== input.guestId) throw notFound('Basket')

  const lines = await prisma.cartItem.findMany({
    where: { cartId: cart.id },
    select: { unitPriceMinor: true, quantity: true, bookingFeeMinor: true },
  })
  if (lines.length === 0) throw invalid('Your basket is empty.')

  const totals = computeCartTotals(lines, cart.currency)

  if (!payments.isLive) {
    /*
     * No provider call, and no fabricated secret.
     *
     * The simulated provider's `createIntent` succeeds unconditionally, so
     * calling it here would work and would mean the payment form rendered in
     * demo mode with a null secret and failed in the browser. Answering with
     * `isSimulated` lets the caller choose a different control instead.
     */
    return {
      clientSecret: null,
      publishableKey: null,
      paymentReference: null,
      amountMinor: totals.totalMinor,
      currency: totals.currency,
      isSimulated: true,
    }
  }

  if (env.ARC_DATA_MODE === 'demo') {
    // Fourth refusal of the same combination, for the same reason the other
    // three exist: "demo mode moves no money" is a product commitment, and
    // this is now a path that can produce a chargeable credential.
    throw new AppError(
      'DEMO_MODE_BLOCKED',
      'Live payments cannot be used while this build is in demo mode.',
    )
  }

  /*
   * A ceiling on sessions per guest.
   *
   * Each one is an HTTP call to Stripe on ARC's account. Unbounded, a portal
   * token — which is a QR code — is a way to spend someone else's API quota
   * and fill their dashboard with abandoned intents. Generous enough that a
   * guest editing a basket never meets it.
   */
  await assertWithinRateLimit({
    bucket: `payment-session:guest:${input.guestId}`,
    limit: PAYMENT_SESSIONS_PER_MINUTE,
    windowSeconds: 60,
    message: 'Too many payment attempts. Wait a minute and try again.',
    now,
  })

  const created = await payments.createIntent({
    idempotencyKey: paymentIntentKey({
      cartId: cart.id,
      totalMinor: totals.totalMinor,
      currency: totals.currency,
    }),
    amount: money(totals.totalMinor, totals.currency),
    // The order reference does not exist yet — the order is written only once
    // the payment has succeeded. The cart id is what this payment is *for*,
    // and it is what reconciliation needs to find an intent with no order.
    orderReference: `cart:${cart.id}`,
    description: `ARC Stay basket ${cart.id}`,
  })

  if (!created.ok || !created.data) {
    throw new AppError(
      'PAYMENT_UNAVAILABLE',
      'We could not start the payment. Nothing has been charged or booked.',
      { reason: created.reason },
    )
  }

  const intent = created.data

  if (!intent.clientSecret) {
    // The provider is live and returned no secret. The browser cannot confirm,
    // so there is no honest way forward; failing here beats a form that looks
    // ready and does nothing.
    throw new AppError('PAYMENT_UNAVAILABLE', 'We could not start the payment.')
  }

  if (intent.isSimulated) {
    // A live provider reporting a simulated intent is a wiring error, and the
    // wrong place to find out is a guest's card.
    throw new AppError('INTERNAL', 'The payment provider returned a simulated payment.')
  }

  /*
   * Stripe is the authority on what it was asked to charge.
   *
   * The amount in the response is its value, not ours. If they disagree the
   * guest is being shown one number and asked to confirm another, and the only
   * safe answer is to refuse — `checkout()` would refuse the resulting order
   * anyway, but by then the money has moved.
   */
  if (
    intent.amount.amountMinor !== totals.totalMinor ||
    intent.amount.currency !== totals.currency
  ) {
    throw new AppError(
      'PAYMENT_UNAVAILABLE',
      'We could not start the payment. Nothing has been charged or booked.',
      { reason: 'amount_disagreement' },
    )
  }

  if (intent.status === 'failed') {
    throw new AppError(
      'PAYMENT_NOT_COMPLETED',
      'That payment can no longer be completed. Nothing has been booked.',
      { status: intent.status },
    )
  }

  return {
    clientSecret: intent.clientSecret,
    publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null,
    paymentReference: intent.reference,
    amountMinor: intent.amount.amountMinor,
    currency: intent.amount.currency,
    isSimulated: false,
  }
}

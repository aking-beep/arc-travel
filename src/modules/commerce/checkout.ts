import { prisma, type Prisma } from '@/lib/db'
import { AppError, conflict, invalid, notFound } from '@/lib/errors'
import { getEnv } from '@/lib/env'
import { assertWithinRateLimit } from '@/lib/rate-limit'
import { money } from '@/lib/money'
import { orderReference } from '@/lib/ids'
import {
  CartStatus,
  OrderItemStatus,
  OrderStatus,
  Role,
  type ExperienceCategory,
} from '@/lib/prisma-types'
import { assertPropertyAccess, type ActorContext } from '@/modules/tenancy/context'
import { VERIFICATION_STANDING_SELECT } from '@/modules/admin/verification'
import { getIntegrations } from '@/modules/integrations/defaults'
import type { PaymentIntent, PaymentsProvider } from '@/modules/integrations/types'
import { consumeHold, inSerializableTransaction, returnCapacity } from '@/modules/inventory/service'
import { recordAudit } from '@/modules/workflows/audit'
import { track } from '@/modules/analytics/track'
import { resolveCommission, splitEarnings, type CommissionRuleInput } from './commission'
import { computeCartTotals, computeRefund } from './pricing'
import { validateCart } from './cart'

/**
 * Checkout, cancellation and refunds.
 *
 * Properties this code is built to guarantee:
 *
 *   * **Simulated.** While ARC_DATA_MODE=demo no payment provider is called and
 *     every order is flagged `isSimulated`. The state machine is real; the money
 *     is not.
 *   * **Idempotent.** A checkout carries a client-supplied key. A retry — a
 *     double-tap, a flaky connection, a resubmitted form — replays the first
 *     result instead of creating a second order.
 *   * **Atomic.** Consuming holds, creating the order and writing the ledger all
 *     happen in one Serializable transaction. A failure anywhere returns every
 *     place to its departure.
 *   * **Balanced.** Ledger entries are written from the same split that set the
 *     order's earnings fields, and the three shares always re-sum to gross.
 */
export interface CheckoutInput {
  cartId: string
  guestId: string
  /** Supplied by the client; the same key must produce the same order. */
  idempotencyKey: string
  /**
   * The provider-side intent the client already confirmed.
   *
   * Required when the payments provider is live, forbidden when it is not.
   * ARC never confirms a payment on the guest's behalf: the browser confirms
   * with the provider, hands back the reference, and the server reads the
   * authoritative amount and status from the provider rather than from the
   * client. See ADR-026.
   */
  paymentIntentId?: string | null
  now?: Date
}

export interface CheckoutResult {
  orderId: string
  reference: string
  status: OrderStatus
  totalMinor: number
  currency: string
  isSimulated: boolean
  /** How many lines the order holds. Taken from the committed transaction. */
  itemCount: number
  /** True when this response was replayed from a previous identical request. */
  replayed: boolean
}

const CHECKOUT_SCOPE = 'commerce.checkout'

/** Checkout attempts one guest may make in a minute. */
export const CHECKOUTS_PER_MINUTE = 12

export async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
  const now = input.now ?? new Date()
  const env = getEnv()

  const payments = getIntegrations().payments

  if (payments.isLive && env.ARC_DATA_MODE === 'demo') {
    /*
     * Defence in depth, three deep.
     *
     * `getEnv()` refuses the combination, `getIntegrations()` refuses it
     * again, and it is refused a third time here — because a checkout path is
     * the last place to rely on validation elsewhere, and "demo mode moves no
     * money" is a product commitment rather than a configuration detail.
     */
    throw new AppError(
      'DEMO_MODE_BLOCKED',
      'Live payments cannot be used while this build is in demo mode.',
    )
  }

  const cart = await prisma.cart.findUnique({
    where: { id: input.cartId },
    select: {
      id: true,
      organizationId: true,
      propertyId: true,
      guestId: true,
      stayId: true,
      status: true,
      currency: true,
    },
  })
  if (!cart) throw notFound('Basket')
  if (cart.guestId !== input.guestId) throw notFound('Basket')

  /*
   * A ceiling on checkout attempts per guest.
   *
   * Idempotency already makes a duplicate submission of the *same* key safe,
   * and the serializable transaction makes concurrent distinct ones correct.
   * Neither bounds how many a caller may make: each one opens a transaction,
   * writes ledger rows and can take holds, so an unbounded loop is a
   * database-level denial of service against the tenant from a credential that
   * is a QR code. Generous enough that a guest retrying a flaky connection
   * never sees it.
   */
  await assertWithinRateLimit({
    bucket: `checkout:guest:${cart.guestId}`,
    limit: CHECKOUTS_PER_MINUTE,
    windowSeconds: 60,
    message: 'Too many checkout attempts. Wait a minute and try again.',
    now,
  })

  // --- Idempotency ---------------------------------------------------------
  // Claim the key first. The unique constraint on (organizationId, scope, key)
  // is what makes concurrent duplicate submissions safe, not a prior read.
  const existing = await prisma.idempotencyKey.findUnique({
    where: {
      organizationId_scope_key: {
        organizationId: cart.organizationId,
        scope: CHECKOUT_SCOPE,
        key: input.idempotencyKey,
      },
    },
    select: { completedAt: true, responseJson: true },
  })

  if (existing?.completedAt && existing.responseJson) {
    return { ...(existing.responseJson as unknown as CheckoutResult), replayed: true }
  }
  if (existing && !existing.completedAt) {
    throw conflict('This checkout is already in progress.')
  }

  try {
    await prisma.idempotencyKey.create({
      data: {
        organizationId: cart.organizationId,
        scope: CHECKOUT_SCOPE,
        key: input.idempotencyKey,
      },
    })
  } catch (error) {
    // Lost the race to claim the key: the winner is creating the order.
    if ((error as { code?: string }).code === 'P2002') {
      throw conflict('This checkout is already in progress.')
    }
    throw error
  }

  let result: CheckoutResult
  try {
    if (cart.status !== CartStatus.OPEN) {
      throw conflict('This basket has already been checked out.')
    }

    // Friendly, user-facing validation first, outside the transaction. The
    // transaction then re-checks the same things as hard assertions — this
    // pass exists to give the guest a sentence they can act on, not to be the
    // guarantee.
    const validation = await validateCart(cart.id, now)
    if (!validation.ok) {
      throw invalid('Your basket needs attention before checkout.', {
        problems: validation.problems,
      })
    }

    /*
     * The payment, resolved before the transaction opens.
     *
     * A network call inside a Serializable transaction holds locks for the
     * provider's latency and would be re-issued by every retry, so the money
     * question is settled first and the transaction only records the answer.
     *
     * Two shapes, and the provider decides which:
     *
     *   * **Live.** The client has already confirmed the intent with the
     *     provider. ARC reads it back and requires `succeeded`. It never
     *     confirms on the guest's behalf, so there is no path on which ARC
     *     takes money and then discovers it cannot deliver the basket.
     *   * **Simulated.** No client-side step exists, so the intent is created
     *     here and comes back `succeeded` and marked simulated. A
     *     `paymentIntentId` on this path is a client confusing itself about
     *     which build it is talking to, and is refused rather than ignored.
     */
    const reference = orderReference()
    const intent = await resolvePayment(payments, {
      cartId: cart.id,
      currency: cart.currency,
      idempotencyKey: input.idempotencyKey,
      paymentIntentId: input.paymentIntentId ?? null,
      orderReference: reference,
    })

    const [commissionRules, organization] = await Promise.all([
      prisma.commissionRule.findMany({
        where: { organizationId: cart.organizationId, isActive: true },
      }),
      prisma.organization.findUnique({
        where: { id: cart.organizationId },
        select: { defaultCommissionBps: true, defaultPlatformCommissionBps: true },
      }),
    ])

    result = await inSerializableTransaction(async (tx) => {
      /**
       * Cart, lines and holds are read **inside** the transaction.
       *
       * Reading them outside was a real defect. `placeHold` resizes an
       * existing hold in place rather than stacking (ADR-014), so a concurrent
       * add-to-basket from a second tab mutated the very hold this checkout was
       * about to consume. The order was then written from the stale line
       * quantity while `consumeHold` moved the live hold quantity — booking
       * four seats on a boat while charging for two, or charging for four while
       * booking two. Either way `booked + held <= capacity` still held
       * numerically while the boat was oversold, so nothing fired.
       */
      const liveCart = await tx.cart.findUnique({
        where: { id: cart.id },
        select: { id: true, status: true, currency: true },
      })
      if (!liveCart) throw notFound('Basket')
      if (liveCart.status !== CartStatus.OPEN) {
        throw conflict('This basket has already been checked out.')
      }

      const items = await tx.cartItem.findMany({
        where: { cartId: cart.id },
        include: {
          experience: {
            select: {
              id: true,
              titleEn: true,
              category: true,
              supplierId: true,
              cancellationPolicyHours: true,
            },
          },
          slot: { select: { id: true, startsAt: true } },
        },
      })
      if (items.length === 0) {
        throw invalid('Your basket is empty.')
      }

      const holds = await tx.inventoryHold.findMany({
        where: { cartId: cart.id, status: 'ACTIVE' },
        select: { id: true, slotId: true, quantity: true },
      })
      const holdBySlot = new Map(holds.map((h) => [h.slotId, h]))

      // Every line must be backed by a hold for exactly its quantity. A
      // mismatch means the basket changed under us, and the right answer is to
      // fail rather than to pick one of the two numbers.
      for (const item of items) {
        const hold = holdBySlot.get(item.slotId)
        if (!hold) {
          throw new AppError(
            'HOLD_EXPIRED',
            'Your reservation lapsed during checkout. Nothing has been charged.',
          )
        }
        if (hold.quantity !== item.quantity) {
          throw conflict(
            'Your basket changed while checkout was running. Review it and try again.',
          )
        }
      }

      const totals = computeCartTotals(items, liveCart.currency)

      /*
       * One order per payment, re-read inside the transaction.
       *
       * The idempotency key stops a repeated *request*; it says nothing about
       * the same payment arriving under a fresh key, which is what a client
       * retrying after a timeout does. The unique index on
       * `(paymentProvider, paymentReference)` is the guarantee — this read is
       * here so the guest gets a sentence rather than a constraint violation,
       * and it is inside the transaction because `inSerializableTransaction`
       * re-runs the whole body on a serialization failure.
       *
       * It comes *before* the amount check deliberately. The other way round,
       * a reused payment against a basket that had since changed was recorded
       * as a `payment_mismatch` — which tells an operator that ARC holds money
       * it never delivered, and sends them to reconcile a payment that in fact
       * already confirmed an order. Reuse is the more specific answer, so it
       * is the one given.
       */
      const alreadyPaid = await tx.order.findFirst({
        where: { paymentProvider: payments.name, paymentReference: intent.reference },
        select: { reference: true },
      })
      if (alreadyPaid) {
        throw conflict(
          'That payment has already been used for a booking. Nothing further has been charged.',
          { paymentReference: intent.reference, orderReference: alreadyPaid.reference },
        )
      }

      /**
       * The payment must be for this basket, as the basket is *now*.
       *
       * The intent was resolved from a read outside the transaction. If a
       * second tab changed the basket in between, the amount the provider holds
       * is not the amount this order is for — and the lines are re-read inside
       * here precisely so that mismatch is caught rather than committed.
       *
       * No automatic refund is attempted. Moving money back is a consequential
       * action and needs an `Approval` row naming who decided (non-negotiable
       * 6), so the honest outcome is a refused checkout, an audit row, and a
       * reconciliation an operator performs. The intent is left as the
       * provider holds it.
       */
      if (
        intent.amount.amountMinor !== totals.totalMinor ||
        intent.amount.currency !== totals.currency
      ) {
        /*
         * The record of this is written *after* the rollback, not on `tx`.
         *
         * Writing it here was wrong in exactly the way that matters: the
         * transaction this throw unwinds takes the audit row with it, so the
         * one surviving trace of a payment ARC holds and cannot deliver would
         * have been rolled back with the refusal. The payload travels on the
         * error and the `catch` below persists it outside any transaction.
         */
        throw conflict(
          'Your basket changed after the payment was authorised. Nothing has been booked; ' +
            'contact the property so the payment can be reconciled.',
          {
            paymentReference: intent.reference,
            paymentMismatch: {
              paymentReference: intent.reference,
              paymentProvider: payments.name,
              paidMinor: intent.amount.amountMinor,
              paidCurrency: intent.amount.currency,
              basketMinor: totals.totalMinor,
              basketCurrency: totals.currency,
              simulated: intent.isSimulated,
            },
          },
        )
      }

      // A real ledger line must not read as a simulated one, and a simulated
      // line must never read as real.
      const memoPrefix = intent.isSimulated ? 'Simulated ' : ''

      /*
       * The read above can lose a race; the index cannot.
       *
       * Two overlapping checkouts sharing one payment under different
       * idempotency keys both pass that read, and the loser violates the
       * unique index here. `inSerializableTransaction` retries only
       * serialization failures and `toFormState` re-throws anything that is
       * not an `AppError`, so left unmapped this reached the guest as a 500 —
       * for the one case where the honest answer is specific and reassuring.
       */
      const order = await tx.order
        .create({
          data: {
            organizationId: cart.organizationId,
            propertyId: cart.propertyId,
            guestId: cart.guestId,
            stayId: cart.stayId,
            reference,
            status: OrderStatus.PENDING,
            currency: cart.currency,
            subtotalMinor: totals.subtotalMinor,
            feesMinor: totals.feesMinor,
            totalMinor: totals.totalMinor,
            // From the provider, never from the environment: the simulated
            // provider marks every intent simulated and prefixes its reference
            // `SIMULATED-`, so a fake payment can never be reconciled against
            // a real processor by accident.
            isSimulated: intent.isSimulated,
            paymentProvider: payments.name,
            paymentReference: intent.reference,
          },
          select: { id: true, reference: true },
        })
        .catch((error: unknown) => {
          const prismaError = error as { code?: string; meta?: { target?: string[] } }
          if (
            prismaError.code === 'P2002' &&
            prismaError.meta?.target?.includes('paymentReference')
          ) {
            throw conflict(
              'That payment has already been used for a booking. Nothing further has been charged.',
              { paymentReference: intent.reference },
            )
          }
          throw error
        })

      let hotelTotal = 0
      let platformTotal = 0
      let supplierTotal = 0

      for (const item of items) {
        const commission = resolveCommission(
          commissionRules as CommissionRuleInput[],
          {
            propertyId: cart.propertyId,
            experienceId: item.experienceId,
            category: item.experience.category as ExperienceCategory,
          },
          {
            hotelBps: organization?.defaultCommissionBps ?? 1500,
            platformBps: organization?.defaultPlatformCommissionBps ?? 500,
          },
        )

        const split = splitEarnings(
          money(item.lineTotalMinor, cart.currency),
          commission,
          item.quantity,
        )

        const orderItem = await tx.orderItem.create({
          data: {
            organizationId: cart.organizationId,
            orderId: order.id,
            experienceId: item.experienceId,
            slotId: item.slotId,
            supplierId: item.experience.supplierId,
            quantity: item.quantity,
            unitPriceMinor: item.unitPriceMinor,
            bookingFeeMinor: item.bookingFeeMinor,
            lineTotalMinor: item.lineTotalMinor,
            currency: item.currency,
            status: OrderItemStatus.PENDING,
            hotelEarningsMinor: split.hotel.amountMinor,
            platformEarningsMinor: split.platform.amountMinor,
            supplierPayableMinor: split.supplier.amountMinor,
            participantNotes: item.participantNotes,
          },
          select: { id: true },
        })

        // Present and correctly sized: asserted for every line above.
        const hold = holdBySlot.get(item.slotId)
        if (!hold) {
          throw new AppError('HOLD_EXPIRED', 'Your reservation lapsed during checkout.')
        }

        // This is where capacity actually moves from held to booked.
        await consumeHold(tx, { holdId: hold.id, orderItemId: orderItem.id, now })

        hotelTotal += split.hotel.amountMinor
        platformTotal += split.platform.amountMinor
        supplierTotal += split.supplier.amountMinor

        await tx.ledgerEntry.createMany({
          data: [
            {
              organizationId: cart.organizationId,
              orderId: order.id,
              orderItemId: orderItem.id,
              account: 'hotel_earnings',
              amountMinor: split.hotel.amountMinor,
              currency: cart.currency,
              memo: `${memoPrefix}hotel share · ${item.experience.titleEn}`,
            },
            {
              organizationId: cart.organizationId,
              orderId: order.id,
              orderItemId: orderItem.id,
              account: 'platform_commission',
              amountMinor: split.platform.amountMinor,
              currency: cart.currency,
              memo: `${memoPrefix}ARC commission · ${item.experience.titleEn}`,
            },
            {
              organizationId: cart.organizationId,
              orderId: order.id,
              orderItemId: orderItem.id,
              account: 'supplier_payable',
              amountMinor: split.supplier.amountMinor,
              currency: cart.currency,
              memo: `${memoPrefix}supplier payable · ${item.experience.titleEn}`,
            },
          ],
        })
      }

      // The ledger must balance against the order total, or the split logic has
      // a bug and we fail the checkout rather than record nonsense.
      if (hotelTotal + platformTotal + supplierTotal !== totals.totalMinor) {
        throw new AppError(
          'INTERNAL',
          'Earnings split did not reconcile with the order total.',
        )
      }

      // Confirmed on creation because the POC does not call a payment provider.
      // Supplier-side confirmation remains manual and is tracked per item.
      const confirmed = await tx.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.CONFIRMED,
          confirmedAt: now,
          hotelEarningsMinor: hotelTotal,
          platformEarningsMinor: platformTotal,
          supplierPayableMinor: supplierTotal,
        },
        select: { id: true, reference: true, status: true, totalMinor: true, currency: true },
      })

      await tx.orderItem.updateMany({
        where: { orderId: order.id },
        data: { status: OrderItemStatus.CONFIRMED },
      })

      await tx.cart.update({
        where: { id: cart.id },
        data: { status: CartStatus.CONVERTED, convertedOrderId: order.id },
      })

      await recordAudit(
        {
          organizationId: cart.organizationId,
          actorKind: 'guest',
          action: 'commerce.checkout.completed',
          entityType: 'Order',
          entityId: order.id,
          metadata: {
            reference: confirmed.reference,
            itemCount: items.length,
            totalMinor: confirmed.totalMinor,
            simulated: intent.isSimulated,
            paymentProvider: payments.name,
            paymentReference: intent.reference,
            idempotencyKey: input.idempotencyKey,
          },
        },
        tx,
      )

      const response: CheckoutResult = {
        orderId: confirmed.id,
        reference: confirmed.reference,
        status: confirmed.status,
        totalMinor: confirmed.totalMinor,
        currency: confirmed.currency,
        isSimulated: intent.isSimulated,
        itemCount: items.length,
        replayed: false,
      }

      /**
       * The completion record commits with the order.
       *
       * Writing it afterwards meant a crash in the gap left a confirmed, paid,
       * ledger-written order whose key was stuck "in progress" — so the
       * guest's retry could never retrieve the response, which is the one case
       * idempotency exists for.
       */
      await tx.idempotencyKey.update({
        where: {
          organizationId_scope_key: {
            organizationId: cart.organizationId,
            scope: CHECKOUT_SCOPE,
            key: input.idempotencyKey,
          },
        },
        data: {
          completedAt: new Date(),
          responseJson: response as unknown as Prisma.InputJsonValue,
        },
      })

      return response
    })
  } catch (error) {
    // Free the key so the guest can fix the problem and try again. The holds
    // survive — the transaction rolled back, so capacity was never consumed.
    // Every throw between the claim and the commit is inside this try, so no
    // path can orphan the key.
    await releaseIdempotencyKey(cart.organizationId, input.idempotencyKey)

    /*
     * A payment ARC holds and did not deliver is the one failure that must
     * outlive the rollback.
     *
     * No automatic refund is attempted: moving money back is a consequential
     * action and needs an `Approval` row naming who decided (non-negotiable
     * 6). So the honest outcome is a refused checkout, a durable record, and a
     * reconciliation an operator performs — and `recordAudit` is called with
     * no `tx` precisely so it commits on its own.
     */
    const mismatch = paymentMismatchDetails(error)
    if (mismatch) {
      await recordAudit({
        organizationId: cart.organizationId,
        actorKind: 'system',
        action: 'commerce.checkout.payment_mismatch',
        entityType: 'Cart',
        entityId: cart.id,
        metadata: mismatch,
      })
    }

    throw error
  }

  await track({
    organizationId: cart.organizationId,
    propertyId: cart.propertyId,
    name: 'checkout_completed',
    surface: 'guest',
    subject: cart.guestId ?? cart.id,
    properties: {
      orderId: result.orderId,
      itemCount: result.itemCount,
      totalMinor: result.totalMinor,
      currency: result.currency,
      simulated: result.isSimulated,
    },
  })

  return result
}

/**
 * Settles the money question before the transaction opens.
 *
 * Returns the intent the order will be written against, or throws. It never
 * returns an intent that is not `succeeded`: an order exists only once its
 * payment does, which is what makes `OrderStatus.CONFIRMED` mean something and
 * why the webhook in `payment-events.ts` only has to handle a payment that
 * stopped standing *later*.
 */
/** Audit metadata for a payment that no longer matches its basket, if that is what this is. */
type PaymentMismatch = Record<string, string | number | boolean>

function paymentMismatchDetails(error: unknown): PaymentMismatch | null {
  if (!(error instanceof AppError)) return null
  const details = error.details
  if (details === null || typeof details !== 'object') return null
  const payload = (details as { paymentMismatch?: unknown }).paymentMismatch
  if (payload === null || typeof payload !== 'object') return null
  return payload as PaymentMismatch
}

async function resolvePayment(
  payments: PaymentsProvider,
  input: {
    cartId: string
    currency: string
    idempotencyKey: string
    paymentIntentId: string | null
    orderReference: string
  },
): Promise<PaymentIntent> {
  if (payments.isLive) {
    if (!input.paymentIntentId) {
      throw invalid('This checkout needs a confirmed payment before it can be completed.')
    }

    const read = await payments.retrieveIntent({ reference: input.paymentIntentId })
    if (!read.ok || !read.data) {
      // The provider's own reason, not an invented one. A provider that could
      // not answer must not be read as a provider that said no.
      throw new AppError(
        'PAYMENT_UNAVAILABLE',
        'We could not confirm your payment with the payment provider. Nothing has been booked.',
        { reason: read.reason },
      )
    }

    if (read.data.status !== 'succeeded') {
      throw new AppError(
        'PAYMENT_NOT_COMPLETED',
        'Your payment has not completed. Nothing has been booked.',
        { status: read.data.status },
      )
    }
    if (read.data.isSimulated) {
      // A live provider reporting a simulated intent is a wiring error, and
      // the wrong way to discover it is a booking nobody paid for.
      throw new AppError('INTERNAL', 'The payment provider returned a simulated payment.')
    }

    return read.data
  }

  if (input.paymentIntentId) {
    throw invalid(
      'This build takes no real payments, so a payment reference cannot be accepted.',
    )
  }

  /*
   * The amount is read from the basket outside the transaction purely so the
   * provider can be asked for it. The transaction re-reads the lines and
   * refuses to commit if the two disagree — these numbers are the question,
   * not the answer.
   */
  const lines = await prisma.cartItem.findMany({
    where: { cartId: input.cartId },
    select: { unitPriceMinor: true, quantity: true, bookingFeeMinor: true },
  })
  if (lines.length === 0) throw invalid('Your basket is empty.')
  const provisional = computeCartTotals(lines, input.currency)

  const created = await payments.createIntent({
    idempotencyKey: input.idempotencyKey,
    amount: money(provisional.totalMinor, provisional.currency),
    orderReference: input.orderReference,
    description: `ARC Stay order ${input.orderReference}`,
  })
  if (!created.ok || !created.data) {
    throw new AppError(
      'PAYMENT_UNAVAILABLE',
      'We could not start the payment. Nothing has been booked.',
      { reason: created.reason },
    )
  }
  if (created.data.status !== 'succeeded') {
    throw new AppError(
      'PAYMENT_NOT_COMPLETED',
      'Your payment has not completed. Nothing has been booked.',
      { status: created.data.status },
    )
  }

  return created.data
}

async function releaseIdempotencyKey(organizationId: string, key: string): Promise<void> {
  await prisma.idempotencyKey
    .delete({
      where: { organizationId_scope_key: { organizationId, scope: CHECKOUT_SCOPE, key } },
    })
    .catch(() => undefined)
}

export interface CancelResult {
  orderItemId: string
  refundMinor: number
  withinWindow: boolean
  orderStatus: OrderStatus
}

/**
 * Cancels one line of an order and returns its capacity.
 *
 * Per line rather than per order: a guest who cancels tomorrow's boat should
 * keep Friday's cooking class. The order's status is then derived from what
 * remains.
 *
 * Ownership is proved here, not assumed from the caller. An earlier version
 * loaded the item by id alone, so any holder of any portal token could cancel
 * any other guest's booking — freeing their place and writing a refund against
 * a different hotel's ledger. The caller must now say *who* is cancelling:
 * `guestId` for the guest surface, or an `ActorContext` for staff and owners,
 * and the lookup is scoped by it.
 */
export type CancelAuthority =
  | { kind: 'guest'; guestId: string }
  | { kind: 'operator'; actor: ActorContext }

export async function cancelOrderItem(options: {
  orderItemId: string
  reason: string
  /** Who is cancelling. Required: there is no unauthenticated cancellation. */
  authority: CancelAuthority
  now?: Date
}): Promise<CancelResult> {
  const now = options.now ?? new Date()

  // The scope is part of the query, so a mismatched owner is a miss rather
  // than a row we then have to remember to check.
  const scope =
    options.authority.kind === 'guest'
      ? { order: { guestId: options.authority.guestId } }
      : {}

  const item = await prisma.orderItem.findFirst({
    where: { id: options.orderItemId, ...scope },
    select: {
      id: true,
      organizationId: true,
      orderId: true,
      slotId: true,
      quantity: true,
      lineTotalMinor: true,
      // The split as it was stored at checkout, which is what a reversal has
      // to undo — not what the current commission rules would produce.
      hotelEarningsMinor: true,
      platformEarningsMinor: true,
      supplierPayableMinor: true,
      currency: true,
      status: true,
      experience: { select: { titleEn: true, cancellationPolicyHours: true } },
      slot: { select: { startsAt: true } },
      order: { select: { propertyId: true, guestId: true } },
    },
  })
  if (!item) throw notFound('Booking')

  // An operator must additionally hold a role on the owning property. The
  // guest branch is already scoped by the query above.
  if (options.authority.kind === 'operator') {
    await assertPropertyAccess(
      options.authority.actor,
      item.order.propertyId,
      Role.OWNER,
      Role.STAFF,
      Role.ADMIN,
    )
  }

  if (item.status === OrderItemStatus.CANCELLED || item.status === OrderItemStatus.REFUNDED) {
    throw conflict('That booking has already been cancelled.')
  }

  const refund = computeRefund({
    lineTotalMinor: item.lineTotalMinor,
    currency: item.currency,
    startsAt: item.slot.startsAt,
    cancellationPolicyHours: item.experience.cancellationPolicyHours,
    now,
  })

  return inSerializableTransaction(async (tx) => {
    /**
     * Re-read the status inside the transaction.
     *
     * The guard above is outside it, so two concurrent cancellations — a
     * double-tapped button, or a guest and the front desk at once — both
     * passed it. Under Serializable the loser gets a 40001, and
     * `inSerializableTransaction` retries by re-running this function: without
     * this re-read it applied everything a second time, decrementing `booked`
     * twice and writing a second refund entry. The counter then sat below the
     * real number of bookings and `placeHold` sold seats that were gone.
     */
    const current = await tx.orderItem.findUnique({
      where: { id: item.id },
      select: { status: true },
    })
    if (!current) throw notFound('Booking')
    if (
      current.status === OrderItemStatus.CANCELLED ||
      current.status === OrderItemStatus.REFUNDED
    ) {
      throw conflict('That booking has already been cancelled.')
    }

    await tx.orderItem.update({
      where: { id: item.id },
      data: {
        status: refund.refundMinor > 0 ? OrderItemStatus.REFUNDED : OrderItemStatus.CANCELLED,
        cancelledAt: now,
        refundedMinor: refund.refundMinor,
      },
    })

    await returnCapacity(tx, { slotId: item.slotId, quantity: item.quantity })

    if (refund.refundMinor > 0) {
      /*
       * Reversed per account, not as one `refund` line.
       *
       * It used to be a single entry on a `refund` account for the whole
       * refunded amount. The ledger still balanced — the total moved by the
       * same number — and each individual account was wrong: a cancelled
       * line's `supplier_payable` stayed at its full positive value for ever,
       * so "what this account sums to" was not what anybody was owed.
       *
       * That was survivable while nothing read the account. `modules/commerce/
       * payouts` reads it to decide what to pay a partner, and the case it
       * cannot survive is ordinary: the hotel pays the partner, and then the
       * guest cancels inside the window. With one `refund` line there is no
       * negative entry on the partner's account, so nothing nets the overpaid
       * amount off their next payment and ARC has no record of being owed it.
       *
       * These are the same three reversals `modules/commerce/payment-events`
       * writes when a payment stops standing, which is the other way a
       * confirmed sale comes undone. Two paths that undo the same thing now
       * write the same rows.
       */
      const reversals = [
        { account: 'hotel_earnings', amountMinor: -item.hotelEarningsMinor },
        { account: 'platform_commission', amountMinor: -item.platformEarningsMinor },
        { account: 'supplier_payable', amountMinor: -item.supplierPayableMinor },
      ].filter((entry) => entry.amountMinor !== 0)

      /*
       * The three shares sum to the line total, and a refund inside the
       * window is the whole line (`computeRefund` is a cliff, not a scale), so
       * the reversals sum to exactly what the single entry used to carry. If
       * that ever stops being true the ledger stops balancing, and
       * `/owner/revenue` says so rather than hiding it — but it is worth
       * asserting here, where the fix is cheap, rather than discovering it on
       * a page.
       */
      const reversedMinor = reversals.reduce((n, entry) => n + entry.amountMinor, 0)
      if (reversedMinor !== -refund.refundMinor) {
        throw new AppError(
          'INTERNAL',
          `Refund of ${refund.refundMinor} does not match the stored split, which sums to ${-reversedMinor}.`,
        )
      }

      await tx.ledgerEntry.createMany({
        data: reversals.map((entry) => ({
          organizationId: item.organizationId,
          orderId: item.orderId,
          orderItemId: item.id,
          account: entry.account,
          // Negative so each account sums to what is actually owed.
          amountMinor: entry.amountMinor,
          currency: item.currency,
          memo: `Refund · reversing ${item.experience.titleEn}`,
        })),
      })
    }

    // Recompute the order's state and earnings from its surviving lines rather
    // than adjusting the stored totals in place.
    const siblings = await tx.orderItem.findMany({
      where: { orderId: item.orderId },
      select: {
        status: true,
        hotelEarningsMinor: true,
        platformEarningsMinor: true,
        supplierPayableMinor: true,
        refundedMinor: true,
      },
    })

    const live = siblings.filter(
      (s) => s.status !== OrderItemStatus.CANCELLED && s.status !== OrderItemStatus.REFUNDED,
    )
    const allGone = live.length === 0
    const anyRefunded = siblings.some((s) => s.status === OrderItemStatus.REFUNDED)

    const orderStatus = allGone
      ? anyRefunded
        ? OrderStatus.REFUNDED
        : OrderStatus.CANCELLED
      : OrderStatus.PARTIALLY_CANCELLED

    await tx.order.update({
      where: { id: item.orderId },
      data: {
        status: orderStatus,
        cancelledAt: allGone ? now : undefined,
        refundedAt: anyRefunded ? now : undefined,
        cancellationReason: options.reason,
        refundedMinor: siblings.reduce((n, s) => n + s.refundedMinor, 0),
        hotelEarningsMinor: live.reduce((n, s) => n + s.hotelEarningsMinor, 0),
        platformEarningsMinor: live.reduce((n, s) => n + s.platformEarningsMinor, 0),
        supplierPayableMinor: live.reduce((n, s) => n + s.supplierPayableMinor, 0),
      },
    })

    await recordAudit(
      {
        organizationId: item.organizationId,
        actor: options.authority.kind === 'operator' ? options.authority.actor : null,
        actorKind: options.authority.kind === 'operator' ? undefined : 'guest',
        action: 'commerce.orderItem.cancelled',
        entityType: 'OrderItem',
        entityId: item.id,
        metadata: {
          reason: options.reason,
          refundMinor: refund.refundMinor,
          withinWindow: refund.withinWindow,
          hoursUntilStart: refund.hoursUntilStart,
          orderStatus,
        },
      },
      tx,
    )

    return {
      orderItemId: item.id,
      refundMinor: refund.refundMinor,
      withinWindow: refund.withinWindow,
      orderStatus,
    }
  })
}

/** Supplier-side manual confirmation. Required on every line in the POC. */
export async function confirmOrderItemBySupplier(options: {
  orderItemId: string
  supplierId: string
  now?: Date
}): Promise<void> {
  const item = await prisma.orderItem.findUnique({
    where: { id: options.orderItemId },
    select: { id: true, organizationId: true, supplierId: true, status: true },
  })
  if (!item) throw notFound('Booking')
  if (item.supplierId !== options.supplierId) throw notFound('Booking')
  if (item.status === OrderItemStatus.CANCELLED || item.status === OrderItemStatus.REFUNDED) {
    throw conflict('That booking has been cancelled.')
  }

  await prisma.$transaction(async (tx) => {
    await tx.orderItem.update({
      where: { id: item.id },
      data: { supplierConfirmedAt: options.now ?? new Date() },
    })
    await recordAudit(
      {
        organizationId: item.organizationId,
        actorKind: 'supplier',
        action: 'commerce.orderItem.supplierConfirmed',
        entityType: 'OrderItem',
        entityId: item.id,
      },
      tx,
    )
  })
}

export async function getOrderForGuest(reference: string, guestId: string) {
  const order = await prisma.order.findUnique({
    where: { reference },
    include: {
      items: {
        orderBy: { createdAt: 'asc' },
        include: {
          experience: {
            select: {
              id: true,
              titleEn: true,
              titleEs: true,
              category: true,
              meetingPoint: true,
              durationMinutes: true,
              cancellationPolicyHours: true,
              supplier: {
                select: { name: true, contactPhone: true, ...VERIFICATION_STANDING_SELECT },
              },
            },
          },
          slot: { select: { startsAt: true, endsAt: true } },
        },
      },
      property: { select: { name: true, contactPhone: true } },
    },
  })

  if (!order || order.guestId !== guestId) return null
  return order
}

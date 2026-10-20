import { prisma, type Prisma } from '@/lib/db'
import { AppError, conflict, invalid, notFound } from '@/lib/errors'
import { getEnv } from '@/lib/env'
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

export async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
  const now = input.now ?? new Date()
  const env = getEnv()

  if (env.PAYMENTS_PROVIDER !== 'simulated') {
    // Defence in depth. getEnv() already refuses this combination, but a
    // checkout path is not the place to rely on validation elsewhere.
    throw new AppError(
      'DEMO_MODE_BLOCKED',
      'Live payments are not enabled in this build.',
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

    const [commissionRules, organization] = await Promise.all([
      prisma.commissionRule.findMany({
        where: { organizationId: cart.organizationId, isActive: true },
      }),
      prisma.organization.findUnique({
        where: { id: cart.organizationId },
        select: { defaultCommissionBps: true },
      }),
    ])

    result = await inSerializableTransaction(async (tx) => {
      const reference = orderReference()

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

      const order = await tx.order.create({
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
          isSimulated: true,
          paymentProvider: 'simulated',
          // Marked unmistakably as fake so it can never be reconciled against
          // a real payment processor by accident.
          paymentReference: `SIMULATED-${reference}`,
        },
        select: { id: true, reference: true },
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
          organization?.defaultCommissionBps ?? 1500,
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
              memo: `Simulated hotel share · ${item.experience.titleEn}`,
            },
            {
              organizationId: cart.organizationId,
              orderId: order.id,
              orderItemId: orderItem.id,
              account: 'platform_commission',
              amountMinor: split.platform.amountMinor,
              currency: cart.currency,
              memo: `Simulated ARC commission · ${item.experience.titleEn}`,
            },
            {
              organizationId: cart.organizationId,
              orderId: order.id,
              orderItemId: orderItem.id,
              account: 'supplier_payable',
              amountMinor: split.supplier.amountMinor,
              currency: cart.currency,
              memo: `Simulated supplier payable · ${item.experience.titleEn}`,
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
            simulated: true,
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
        isSimulated: true,
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
      simulated: true,
    },
  })

  return result
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
      await tx.ledgerEntry.create({
        data: {
          organizationId: item.organizationId,
          orderId: item.orderId,
          orderItemId: item.id,
          account: 'refund',
          // Negative so the ledger sums to what is actually owed.
          amountMinor: -refund.refundMinor,
          currency: item.currency,
          memo: `Simulated refund · ${item.experience.titleEn}`,
        },
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
              supplier: { select: { name: true, verification: true, contactPhone: true } },
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

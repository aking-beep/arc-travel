import { prisma, type Prisma } from '@/lib/db'
import { AppError, conflict, invalid, notFound } from '@/lib/errors'
import { getEnv } from '@/lib/env'
import { money } from '@/lib/money'
import { orderReference } from '@/lib/ids'
import {
  CartStatus,
  OrderItemStatus,
  OrderStatus,
  type ExperienceCategory,
} from '@/lib/prisma-types'
import { consumeHold, inSerializableTransaction, returnCapacity } from '@/modules/inventory/service'
import { recordAudit } from '@/modules/workflows/audit'
import { track } from '@/modules/analytics/track'
import { resolveCommission, splitEarnings, type CommissionRuleInput } from './commission'
import { computeRefund } from './pricing'
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

  if (cart.status !== CartStatus.OPEN) {
    throw conflict('This basket has already been checked out.')
  }

  const validation = await validateCart(cart.id, now)
  if (!validation.ok) {
    await releaseIdempotencyKey(cart.organizationId, input.idempotencyKey)
    throw invalid('Your basket needs attention before checkout.', {
      problems: validation.problems,
    })
  }

  const [items, commissionRules] = await Promise.all([
    prisma.cartItem.findMany({
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
    }),
    prisma.commissionRule.findMany({
      where: { organizationId: cart.organizationId, isActive: true },
    }),
  ])

  const organization = await prisma.organization.findUnique({
    where: { id: cart.organizationId },
    select: { defaultCommissionBps: true },
  })

  const holds = await prisma.inventoryHold.findMany({
    where: { cartId: cart.id, status: 'ACTIVE' },
    select: { id: true, slotId: true, quantity: true },
  })
  const holdBySlot = new Map(holds.map((h) => [h.slotId, h]))

  let result: CheckoutResult
  try {
    result = await inSerializableTransaction(async (tx) => {
      const reference = orderReference()

      const order = await tx.order.create({
        data: {
          organizationId: cart.organizationId,
          propertyId: cart.propertyId,
          guestId: cart.guestId,
          stayId: cart.stayId,
          reference,
          status: OrderStatus.PENDING,
          currency: cart.currency,
          subtotalMinor: validation.totals.subtotalMinor,
          feesMinor: validation.totals.feesMinor,
          totalMinor: validation.totals.totalMinor,
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

        const hold = holdBySlot.get(item.slotId)
        if (!hold) {
          throw new AppError(
            'HOLD_EXPIRED',
            'Your reservation lapsed during checkout. Nothing has been charged.',
          )
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
      if (hotelTotal + platformTotal + supplierTotal !== validation.totals.totalMinor) {
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

      return {
        orderId: confirmed.id,
        reference: confirmed.reference,
        status: confirmed.status,
        totalMinor: confirmed.totalMinor,
        currency: confirmed.currency,
        isSimulated: true,
        replayed: false,
      }
    })
  } catch (error) {
    // Free the key so the guest can fix the problem and try again. The holds
    // survive — the transaction rolled back, so capacity was never consumed.
    await releaseIdempotencyKey(cart.organizationId, input.idempotencyKey)
    throw error
  }

  await prisma.idempotencyKey.update({
    where: {
      organizationId_scope_key: {
        organizationId: cart.organizationId,
        scope: CHECKOUT_SCOPE,
        key: input.idempotencyKey,
      },
    },
    data: { completedAt: new Date(), responseJson: result as unknown as Prisma.InputJsonValue },
  })

  await track({
    organizationId: cart.organizationId,
    propertyId: cart.propertyId,
    name: 'checkout_completed',
    surface: 'guest',
    subject: cart.guestId ?? cart.id,
    properties: {
      orderId: result.orderId,
      itemCount: items.length,
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
 */
export async function cancelOrderItem(options: {
  orderItemId: string
  reason: string
  actorKind?: 'guest' | 'owner' | 'staff' | 'supplier' | 'admin'
  now?: Date
}): Promise<CancelResult> {
  const now = options.now ?? new Date()

  const item = await prisma.orderItem.findUnique({
    where: { id: options.orderItemId },
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
    },
  })
  if (!item) throw notFound('Booking')

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
        actorKind: options.actorKind ?? 'guest',
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

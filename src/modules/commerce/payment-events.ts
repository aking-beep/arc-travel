import { prisma } from '@/lib/db'
import { notFound } from '@/lib/errors'
import { OrderItemStatus, OrderStatus } from '@/lib/prisma-types'
import { inSerializableTransaction, returnCapacity } from '@/modules/inventory/service'
import { recordAudit } from '@/modules/workflows/audit'
import type { StripePaymentEvent } from '@/modules/integrations/stripe-webhook'

/**
 * What ARC does when a payment provider says, after the fact, that a payment
 * did not stand.
 *
 * `checkout()` only writes an order when the provider has already reported
 * `succeeded`, so the happy path needs no webhook. What a webhook is for is
 * the case the happy path cannot see: a payment that succeeded at checkout and
 * later failed, was cancelled, or was reversed. Until this existed, such an
 * order stayed CONFIRMED for ever — a boat seat held against money that had
 * gone back to the guest, and a supplier payable ARC would have paid.
 *
 * Three properties:
 *
 *   * **Idempotent.** Stripe redelivers. The event id is claimed in
 *     `IdempotencyKey` inside the same transaction as the effect, so a
 *     redelivery returns `replayed` and changes nothing. Claiming it before,
 *     in its own transaction, meant a crash in the gap made the event
 *     permanently unprocessable.
 *   * **Capacity-returning.** A failed payment frees every place the order
 *     booked, through `returnCapacity` — which throws rather than clamping, so
 *     a double application is loud.
 *   * **Balanced.** The earnings lines are reversed with offsetting negative
 *     entries rather than deleted, so each account still sums to what is
 *     actually owed and the history of the attempt survives.
 */
export const PAYMENT_EVENT_SCOPE = 'commerce.payment_event'

/** Event types that mean the money is not there. */
const FAILURE_TYPES = new Set([
  'payment_intent.payment_failed',
  'payment_intent.canceled',
])

export type PaymentEventOutcome =
  /** Applied: the order was failed and its capacity returned. */
  | { kind: 'order_failed'; orderId: string; itemsCancelled: number; reversedMinor: number }
  /** The event was a redelivery of one already applied. */
  | { kind: 'replayed'; orderId: string }
  /** Verified and understood, but it asks for nothing. */
  | { kind: 'ignored'; reason: string }

export async function applyPaymentEvent(
  event: StripePaymentEvent,
  options: { now?: Date } = {},
): Promise<PaymentEventOutcome> {
  const now = options.now ?? new Date()

  if (!FAILURE_TYPES.has(event.type)) {
    // `payment_intent.succeeded` included: checkout already confirmed the
    // order against the same intent, and re-confirming from an event would
    // mean a replay could resurrect an order the guest has since cancelled.
    return { kind: 'ignored', reason: `unhandled_type:${event.type}` }
  }

  const order = await prisma.order.findFirst({
    // Scoped by the provider as well as the reference: a reference is only
    // unique within the provider that issued it, and a simulated order must
    // never be mutated by a live webhook.
    where: { paymentReference: event.paymentIntentId, paymentProvider: 'stripe' },
    select: { id: true, organizationId: true, status: true },
  })
  if (!order) throw notFound('Order')

  return inSerializableTransaction(async (tx) => {
    const claimed = await tx.idempotencyKey.findUnique({
      where: {
        organizationId_scope_key: {
          organizationId: order.organizationId,
          scope: PAYMENT_EVENT_SCOPE,
          key: event.id,
        },
      },
      select: { id: true },
    })
    if (claimed) return { kind: 'replayed', orderId: order.id } as const

    /*
     * Re-read the order's status inside the transaction.
     *
     * `inSerializableTransaction` retries the whole body on a serialization
     * failure, and two deliveries of the same intent's failure can arrive
     * together. Without this, the retry returned capacity a second time —
     * which `returnCapacity` now throws on, but the right answer is not to ask
     * it to.
     */
    const current = await tx.order.findUnique({
      where: { id: order.id },
      select: { id: true, status: true },
    })
    if (!current) throw notFound('Order')

    if (current.status === OrderStatus.FAILED) {
      // Already failed by an earlier, differently-identified event. Claim this
      // id too so the pair cannot ping-pong.
      await claim(tx, order.organizationId, event.id)
      return { kind: 'replayed', orderId: order.id } as const
    }

    const items = await tx.orderItem.findMany({
      where: { orderId: order.id },
      select: {
        id: true,
        slotId: true,
        quantity: true,
        status: true,
        currency: true,
        hotelEarningsMinor: true,
        platformEarningsMinor: true,
        supplierPayableMinor: true,
        experience: { select: { titleEn: true } },
      },
    })

    let reversedMinor = 0
    let itemsCancelled = 0

    for (const item of items) {
      if (
        item.status === OrderItemStatus.CANCELLED ||
        item.status === OrderItemStatus.REFUNDED
      ) {
        // Already cancelled by the guest or the desk: its capacity went back
        // then, and returning it again would under-count `booked`.
        continue
      }

      await tx.orderItem.update({
        where: { id: item.id },
        data: { status: OrderItemStatus.CANCELLED, cancelledAt: now },
      })
      await returnCapacity(tx, { slotId: item.slotId, quantity: item.quantity })
      itemsCancelled += 1

      const reversals: Array<{ account: string; amountMinor: number }> = [
        { account: 'hotel_earnings', amountMinor: -item.hotelEarningsMinor },
        { account: 'platform_commission', amountMinor: -item.platformEarningsMinor },
        { account: 'supplier_payable', amountMinor: -item.supplierPayableMinor },
      ].filter((entry) => entry.amountMinor !== 0)

      if (reversals.length > 0) {
        await tx.ledgerEntry.createMany({
          data: reversals.map((entry) => ({
            organizationId: order.organizationId,
            orderId: order.id,
            orderItemId: item.id,
            account: entry.account,
            amountMinor: entry.amountMinor,
            currency: item.currency,
            memo: `Payment failed · reversing ${item.experience.titleEn}`,
          })),
        })
        reversedMinor += reversals.reduce((n, entry) => n + entry.amountMinor, 0)
      }
    }

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.FAILED,
        cancelledAt: now,
        cancellationReason: `payment_failed:${event.failureCode ?? event.type}`,
        hotelEarningsMinor: 0,
        platformEarningsMinor: 0,
        supplierPayableMinor: 0,
      },
    })

    await claim(tx, order.organizationId, event.id)

    await recordAudit(
      {
        organizationId: order.organizationId,
        // Not a person. Nobody at ARC decided this; the provider reported it.
        actorKind: 'system',
        action: 'commerce.payment.failed',
        entityType: 'Order',
        entityId: order.id,
        metadata: {
          provider: 'stripe',
          eventId: event.id,
          eventType: event.type,
          failureCode: event.failureCode,
          itemsCancelled,
          previousStatus: current.status,
        },
      },
      tx,
    )

    return { kind: 'order_failed', orderId: order.id, itemsCancelled, reversedMinor } as const
  })
}

type Tx = Parameters<Parameters<typeof inSerializableTransaction>[0]>[0]

async function claim(tx: Tx, organizationId: string, eventId: string): Promise<void> {
  await tx.idempotencyKey.create({
    data: {
      organizationId,
      scope: PAYMENT_EVENT_SCOPE,
      key: eventId,
      completedAt: new Date(),
    },
  })
}

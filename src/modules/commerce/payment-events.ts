import { prisma, type Prisma } from '@/lib/db'
import { notFound } from '@/lib/errors'
import {
  OrderItemStatus,
  OrderStatus,
  PaymentReversalCause,
  ProposalKind,
  ProposalStatus,
} from '@/lib/prisma-types'
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

/** Event types that mean the money was never taken. */
const FAILURE_TYPES = new Set([
  'payment_intent.payment_failed',
  'payment_intent.canceled',
])

/**
 * Event types that mean money ARC *did* take has gone back.
 *
 * These are categorically different from the failures above, and the
 * difference is who is harmed by getting it wrong. A failed payment was never
 * money; releasing its capacity takes nothing from anybody, so the handler
 * does it. A refund or a chargeback means a guest has a seat on a boat and
 * their money back — and the fix, cancelling their booking, is something taken
 * away from a person who may be entirely in the right. Perhaps they were
 * refunded by agreement. Perhaps the dispute will be resolved in ARC's favour
 * and the charge reinstated.
 *
 * So these open an approval and cancel nothing. See ADR-033.
 */
const REVERSAL_TYPES: Record<string, PaymentReversalCause> = {
  'charge.refunded': PaymentReversalCause.REFUND,
  'charge.dispute.created': PaymentReversalCause.DISPUTE,
  'charge.dispute.funds_withdrawn': PaymentReversalCause.DISPUTE,
}

export type PaymentEventOutcome =
  /** Applied: the order was failed and its capacity returned. */
  | { kind: 'order_failed'; orderId: string; itemsCancelled: number; reversedMinor: number }
  /**
   * Recorded, and a decision put in front of the owner.
   *
   * Nothing was cancelled, no capacity was returned and no ledger line was
   * written. The order carries `reversalReportedAt`, which is what excludes it
   * from a supplier payout in the meantime.
   */
  | {
      kind: 'reversal_reported'
      orderId: string
      proposalId: string
      cause: PaymentReversalCause
      reversedMinor: number
    }
  /** The event was a redelivery of one already applied. */
  | { kind: 'replayed'; orderId: string }
  /** Verified and understood, but it asks for nothing. */
  | { kind: 'ignored'; reason: string }

export async function applyPaymentEvent(
  event: StripePaymentEvent,
  options: { now?: Date } = {},
): Promise<PaymentEventOutcome> {
  const now = options.now ?? new Date()

  const reversalCause = REVERSAL_TYPES[event.type]

  if (!FAILURE_TYPES.has(event.type) && !reversalCause) {
    // `payment_intent.succeeded` included: checkout already confirmed the
    // order against the same intent, and re-confirming from an event would
    // mean a replay could resurrect an order the guest has since cancelled.
    // `charge.dispute.closed` too — it can close either way, and a dispute won
    // asks for nothing while a dispute lost has already arrived as
    // `funds_withdrawn`.
    return { kind: 'ignored', reason: `unhandled_type:${event.type}` }
  }

  const order = await prisma.order.findFirst({
    // Scoped by the provider as well as the reference: a reference is only
    // unique within the provider that issued it, and a simulated order must
    // never be mutated by a live webhook.
    where: { paymentReference: event.paymentIntentId, paymentProvider: 'stripe' },
    select: { id: true, organizationId: true, propertyId: true, status: true, reference: true },
  })
  if (!order) throw notFound('Order')

  if (reversalCause) {
    return reportReversal({ event, order, cause: reversalCause, now })
  }

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

/**
 * Records that a payment has been reversed at the provider, and asks a person
 * what to do about the bookings it paid for.
 *
 * The whole value of this function is in what it does *not* do. It does not
 * cancel an order item, does not return capacity, and writes no ledger line.
 * A guest whose card was refunded still has their booking, and a supplier
 * still has the slot committed, until somebody at the hotel decides otherwise
 * — because a refund can be an agreement and a dispute can be resolved in
 * ARC's favour, and a webhook cannot tell which.
 *
 * What it does do is three things:
 *
 *   1. **Stamps the order.** `reversalReportedAt` is what stops the order
 *      being treated as good money while the decision is pending: a supplier
 *      payout excludes it (`modules/commerce/payouts`), so ARC cannot pay out
 *      on a charge that has gone back.
 *   2. **Opens an approval.** A `PAYMENT_REVERSAL` proposal whose stored
 *      action is `reverse_order_items`, with the live order items enumerated.
 *      Approving it runs the closed-union branch in `workflows/proposals`,
 *      which is the one code path allowed to take a booking away — and it
 *      writes the `Approval` row naming the user, which is non-negotiable 6.
 *   3. **Stays idempotent.** Stripe redelivers, and a partial refund followed
 *      by another produces two events. The event id is claimed in
 *      `IdempotencyKey` in the same transaction as the effect, so a
 *      redelivery is a no-op; a *genuinely new* reversal event on an order
 *      already reported updates the amount and leaves the open proposal
 *      alone, rather than stacking a second decision in the queue.
 */
async function reportReversal(input: {
  event: StripePaymentEvent
  order: {
    id: string
    organizationId: string
    propertyId: string
    status: OrderStatus
    reference: string
  }
  cause: PaymentReversalCause
  now: Date
}): Promise<PaymentEventOutcome> {
  const { event, order, cause, now } = input

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
     * Re-read inside the transaction. The body re-runs on a serialization
     * failure, and two deliveries about the same charge arrive together often
     * enough that this is the ordinary case.
     */
    const current = await tx.order.findUnique({
      where: { id: order.id },
      select: {
        id: true,
        status: true,
        reversalReportedAt: true,
        reversedMinor: true,
      },
    })
    if (!current) throw notFound('Order')

    const reversedMinor = event.reversedMinor ?? 0

    /*
     * The live lines, enumerated now and stored in the action.
     *
     * Stored rather than resolved at execution time because the proposal is a
     * description of a specific decision: the owner is agreeing to reverse
     * *these* bookings. If the set were recomputed on approval, a line added
     * in between — the guest books something else on the same order — would be
     * cancelled by an approval nobody gave for it.
     */
    const live = await tx.orderItem.findMany({
      where: {
        orderId: order.id,
        status: { in: [OrderItemStatus.PENDING, OrderItemStatus.CONFIRMED] },
      },
      select: { id: true, lineTotalMinor: true, experience: { select: { titleEn: true } } },
    })

    await tx.order.update({
      where: { id: order.id },
      data: {
        reversalReportedAt: current.reversalReportedAt ?? now,
        reversalCause: cause,
        reversalEventId: event.id,
        // The provider's cumulative figure, not an increment: `charge.refunded`
        // carries the total refunded so far, so a second partial refund's
        // event already describes the whole.
        reversedMinor: Math.max(current.reversedMinor, reversedMinor),
      },
    })

    /*
     * One open decision per order.
     *
     * A second reversal event on the same order — the other half of a partial
     * refund, or a dispute following a refund — updates the amount above and
     * finds the proposal already open. Stacking a second one would ask the
     * owner the same question twice and let them approve it twice, reversing
     * the same lines on the second pass.
     */
    const existing = await tx.proposal.findFirst({
      where: {
        propertyId: order.propertyId,
        kind: ProposalKind.PAYMENT_REVERSAL,
        status: ProposalStatus.PENDING_APPROVAL,
        actionJson: { path: ['orderId'], equals: order.id },
      },
      select: { id: true },
    })

    const proposalId =
      existing?.id ??
      (
        await tx.proposal.create({
          data: {
            organizationId: order.organizationId,
            propertyId: order.propertyId,
            kind: ProposalKind.PAYMENT_REVERSAL,
            status: ProposalStatus.PENDING_APPROVAL,
            title:
              cause === PaymentReversalCause.DISPUTE
                ? `Chargeback on ${order.reference}`
                : `Refund issued on ${order.reference}`,
            summary:
              cause === PaymentReversalCause.DISPUTE
                ? `The cardholder's bank has reversed the payment for ${order.reference}. ` +
                  `${live.length} ${live.length === 1 ? 'booking is' : 'bookings are'} still live ` +
                  `against it. Approving cancels them and puts the places back on sale; rejecting ` +
                  `keeps them, which is the right answer if you expect to win the dispute or have ` +
                  `agreed to honour the booking anyway. ARC has not cancelled anything.`
                : `A refund was issued at the payment provider for ${order.reference}, outside ARC. ` +
                  `${live.length} ${live.length === 1 ? 'booking is' : 'bookings are'} still live ` +
                  `against it. Approving cancels them and puts the places back on sale; rejecting ` +
                  `keeps them, which is the right answer if the refund was a goodwill gesture you ` +
                  `intended to honour the booking through. ARC has not cancelled anything.`,
            actionJson: {
              type: 'reverse_order_items',
              orderId: order.id,
              orderItemIds: live.map((item) => item.id),
              cause,
              providerEventId: event.id,
            } as unknown as Prisma.InputJsonValue,
            evidenceJson: {
              provider: 'stripe',
              eventType: event.type,
              reversedMinor,
              reversedCurrency: event.reversedCurrency,
              liveItemCount: live.length,
              liveItemValueMinor: live.reduce((n, item) => n + item.lineTotalMinor, 0),
              // The titles, not the guest. A proposal is rendered on the owner
              // surface and an owner needs to know which boat; they do not
              // need the guest's details repeated into a JSON column.
              experiences: live.map((item) => item.experience.titleEn),
            } as Prisma.InputJsonValue,
            /*
             * Zero. Money going back is not potential value, and putting it
             * here would make it sum with upside on `/owner/approvals` — the
             * addition ADR-007 exists to prevent.
             */
            potentialValueMinor: 0,
          },
          select: { id: true },
        })
      ).id

    await claim(tx, order.organizationId, event.id)

    await recordAudit(
      {
        organizationId: order.organizationId,
        // Not a person. Nobody at ARC decided this; the provider reported it,
        // and the decision it asks for has not been made yet.
        actorKind: 'system',
        action: 'commerce.payment.reversal_reported',
        entityType: 'Order',
        entityId: order.id,
        metadata: {
          provider: 'stripe',
          eventId: event.id,
          eventType: event.type,
          cause,
          reversedMinor,
          liveItemCount: live.length,
          proposalId,
          proposalWasAlreadyOpen: existing !== null,
          // Explicit, because the absence of a cancellation is the point of
          // this code path and an auditor reading the row should see it stated.
          itemsCancelled: 0,
        },
      },
      tx,
    )

    return {
      kind: 'reversal_reported',
      orderId: order.id,
      proposalId,
      cause,
      reversedMinor,
    } as const
  })
}

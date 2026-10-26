import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { isAppError } from '@/lib/errors'
import { ApprovalDecision, OrderItemStatus, OrderStatus } from '@/lib/prisma-types'
import { toDateKey } from '@/lib/dates'
import { addToCart, getOrCreateCart } from '@/modules/commerce/cart'
import { cancelOrderItem, checkout } from '@/modules/commerce/checkout'
import { applyPaymentEvent, PAYMENT_EVENT_SCOPE } from '@/modules/commerce/payment-events'
import { summarisePayables } from '@/modules/commerce/payouts'
import { decideProposal } from '@/modules/workflows/proposals'
import type { StripePaymentEvent } from '@/modules/integrations/stripe-webhook'
import { actorFor, createTenant, resetDatabase, slotState, type TenantFixture } from '../helpers/factory'

let tenant: TenantFixture

/**
 * A booked order that a live provider is the authority for.
 *
 * The suite runs in demo mode, so `checkout()` can only produce a *simulated*
 * order — and `applyPaymentEvent` deliberately refuses to touch one, because a
 * live webhook must never be able to mutate a simulated booking. The order's
 * provider columns are therefore restamped here, which is the one thing a
 * fixture may do that a service may not: it builds the state a pilot
 * deployment would be in, without pretending a payment happened.
 */
async function bookedStripeOrder(
  options: { quantity?: number; intentId?: string } = {},
): Promise<{ orderId: string; intentId: string }> {
  const cartId = await getOrCreateCart({
    organizationId: tenant.organizationId,
    propertyId: tenant.propertyId,
    guestId: tenant.guestId,
    stayId: tenant.stayId,
    currency: 'MXN',
  })
  await addToCart({ cartId, slotId: tenant.slotId, quantity: options.quantity ?? 2 })

  const result = await checkout({
    cartId,
    guestId: tenant.guestId,
    idempotencyKey: randomUUID(),
  })

  const intentId = options.intentId ?? `pi_${randomUUID().replace(/-/g, '')}`
  await prisma.order.update({
    where: { id: result.orderId },
    data: { paymentProvider: 'stripe', paymentReference: intentId, isSimulated: false },
  })

  return { orderId: result.orderId, intentId }
}

function failureEvent(intentId: string, overrides: Partial<StripePaymentEvent> = {}) {
  return {
    id: `evt_${randomUUID()}`,
    type: 'payment_intent.payment_failed',
    paymentIntentId: intentId,
    failureCode: 'card_declined',
    // A failed payment reverses nothing, because nothing was taken.
    reversedMinor: null,
    reversedCurrency: null,
    ...overrides,
  }
}

beforeEach(async () => {
  await resetDatabase()
  tenant = await createTenant({ capacity: 6, priceMinor: 95_000 })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('applyPaymentEvent', () => {
  it('fails the order and returns its capacity when the payment does not stand', async () => {
    const { orderId, intentId } = await bookedStripeOrder({ quantity: 2 })
    expect((await slotState(tenant.slotId)).booked).toBe(2)

    const outcome = await applyPaymentEvent(failureEvent(intentId))

    expect(outcome).toMatchObject({ kind: 'order_failed', orderId, itemsCancelled: 1 })
    // The one thing this exists for: the seat goes back on the boat.
    expect((await slotState(tenant.slotId)).booked).toBe(0)

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } })
    expect(order.status).toBe(OrderStatus.FAILED)
    expect(order.cancellationReason).toBe('payment_failed:card_declined')
    expect(order.hotelEarningsMinor).toBe(0)
    expect(order.platformEarningsMinor).toBe(0)
    expect(order.supplierPayableMinor).toBe(0)

    const items = await prisma.orderItem.findMany({ where: { orderId } })
    expect(items.every((i) => i.status === OrderItemStatus.CANCELLED)).toBe(true)
  })

  it('reverses the earnings lines so every ledger account sums to zero', async () => {
    const { orderId, intentId } = await bookedStripeOrder({ quantity: 3 })
    await applyPaymentEvent(failureEvent(intentId))

    const entries = await prisma.ledgerEntry.findMany({ where: { orderId } })
    const byAccount = new Map<string, number>()
    for (const entry of entries) {
      byAccount.set(entry.account, (byAccount.get(entry.account) ?? 0) + entry.amountMinor)
    }

    expect(byAccount.size).toBe(3)
    for (const [account, sum] of byAccount) {
      expect(sum, account).toBe(0)
    }
    // Reversed, not deleted: the attempt is still in the history.
    expect(entries.length).toBe(6)
  })

  it('is idempotent: a redelivery of the same event changes nothing', async () => {
    const { orderId, intentId } = await bookedStripeOrder({ quantity: 2 })
    const event = failureEvent(intentId)

    const first = await applyPaymentEvent(event)
    expect(first.kind).toBe('order_failed')

    const second = await applyPaymentEvent(event)
    expect(second).toEqual({ kind: 'replayed', orderId })

    // `returnCapacity` throws rather than clamping, so a double application
    // would have been loud — but the counter is the thing that matters.
    expect((await slotState(tenant.slotId)).booked).toBe(0)
    expect(await prisma.ledgerEntry.count({ where: { orderId } })).toBe(6)
  })

  it('treats a second, differently-identified failure for the same order as a replay', async () => {
    const { orderId, intentId } = await bookedStripeOrder({ quantity: 2 })
    await applyPaymentEvent(failureEvent(intentId))

    // Stripe can send payment_failed and then canceled for one intent.
    const outcome = await applyPaymentEvent(
      failureEvent(intentId, { type: 'payment_intent.canceled', failureCode: null }),
    )
    expect(outcome).toEqual({ kind: 'replayed', orderId })
    expect((await slotState(tenant.slotId)).booked).toBe(0)
  })

  it('claims the event id in the same transaction as the effect', async () => {
    const { intentId } = await bookedStripeOrder()
    const event = failureEvent(intentId)
    await applyPaymentEvent(event)

    const claim = await prisma.idempotencyKey.findFirst({
      where: { scope: PAYMENT_EVENT_SCOPE, key: event.id },
    })
    expect(claim?.completedAt).toBeInstanceOf(Date)
  })

  it('leaves a line the guest already cancelled alone', async () => {
    const { orderId, intentId } = await bookedStripeOrder({ quantity: 2 })
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId } })

    await cancelOrderItem({
      orderItemId: item.id,
      reason: 'guest changed plans',
      authority: { kind: 'guest', guestId: tenant.guestId },
    })
    expect((await slotState(tenant.slotId)).booked).toBe(0)

    // Its capacity went back then. Returning it again would push `booked`
    // below the real number of bookings, and `placeHold` would sell places
    // that do not exist.
    const outcome = await applyPaymentEvent(failureEvent(intentId))
    expect(outcome).toMatchObject({ kind: 'order_failed', itemsCancelled: 0 })
    expect((await slotState(tenant.slotId)).booked).toBe(0)
  })

  it('refuses to touch a simulated order', async () => {
    const cartId = await getOrCreateCart({
      organizationId: tenant.organizationId,
      propertyId: tenant.propertyId,
      guestId: tenant.guestId,
      stayId: tenant.stayId,
      currency: 'MXN',
    })
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 1 })
    const order = await checkout({ cartId, guestId: tenant.guestId, idempotencyKey: randomUUID() })

    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } })
    expect(stored.paymentProvider).toBe('simulated')

    // A live webhook must not be able to cancel a demo booking, even if it
    // somehow names its reference.
    await expect(
      applyPaymentEvent(failureEvent(stored.paymentReference ?? 'pi_x')),
    ).rejects.toSatisfy((error) => isAppError(error) && error.code === 'NOT_FOUND')
    expect((await slotState(tenant.slotId)).booked).toBe(1)
  })

  it('does nothing for an event type it does not handle', async () => {
    const { intentId } = await bookedStripeOrder({ quantity: 2 })

    // Including succeeded: checkout already confirmed the order against this
    // intent, and re-confirming from an event would let a replay resurrect an
    // order the guest has since cancelled.
    const outcome = await applyPaymentEvent(
      failureEvent(intentId, { type: 'payment_intent.succeeded', failureCode: null }),
    )
    expect(outcome).toEqual({ kind: 'ignored', reason: 'unhandled_type:payment_intent.succeeded' })
    expect((await slotState(tenant.slotId)).booked).toBe(2)
  })

  it('reports an unknown payment reference as not found', async () => {
    await expect(applyPaymentEvent(failureEvent('pi_nothing_here'))).rejects.toSatisfy(
      (error) => isAppError(error) && error.code === 'NOT_FOUND',
    )
  })

  it('records one audit row naming the provider and the event, not a person', async () => {
    const { orderId, intentId } = await bookedStripeOrder()
    const event = failureEvent(intentId)
    await applyPaymentEvent(event)

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: 'commerce.payment.failed', entityId: orderId },
    })
    expect(audit.actorKind).toBe('system')
    expect(audit.actorUserId).toBeNull()
    expect(audit.metadataJson).toMatchObject({
      provider: 'stripe',
      eventId: event.id,
      failureCode: 'card_declined',
      previousStatus: OrderStatus.CONFIRMED,
    })
  })
})

/**
 * A refund or a chargeback raised at the provider.
 *
 * Every test here is about the same restraint: ARC records the report and asks
 * a person. It does not cancel the guest's booking, does not return the
 * capacity and writes no ledger line — because a refund can be an agreement
 * and a dispute can be resolved in ARC's favour, and a webhook cannot tell
 * which. The product's position on autonomy is not a preference about tone; it
 * is the reason a guest who was refunded by arrangement still has their boat
 * seat the next morning.
 */
function reversalEvent(
  intentId: string,
  type: 'charge.refunded' | 'charge.dispute.created' | 'charge.dispute.funds_withdrawn',
  overrides: Partial<StripePaymentEvent> = {},
) {
  return {
    id: `evt_${randomUUID()}`,
    type,
    paymentIntentId: intentId,
    failureCode: null,
    reversedMinor: 190_000,
    reversedCurrency: 'MXN',
    ...overrides,
  }
}

describe('a reversal reported by the provider', () => {
  it('cancels nothing and takes no capacity back', async () => {
    const { orderId, intentId } = await bookedStripeOrder({ quantity: 2 })
    expect((await slotState(tenant.slotId)).booked).toBe(2)

    const outcome = await applyPaymentEvent(reversalEvent(intentId, 'charge.refunded'))

    expect(outcome.kind).toBe('reversal_reported')

    // The guest still has their booking, and the supplier still has the slot
    // committed, until somebody at the hotel decides otherwise.
    expect((await slotState(tenant.slotId)).booked).toBe(2)
    const items = await prisma.orderItem.findMany({ where: { orderId } })
    expect(items.every((item) => item.status === OrderItemStatus.CONFIRMED)).toBe(true)

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } })
    expect(order.status).toBe(OrderStatus.CONFIRMED)
    expect(order.reversalReportedAt).not.toBeNull()
    expect(order.reversalCause).toBe('REFUND')
    expect(order.reversedMinor).toBe(190_000)

    // And no ledger line. The sale has not been undone; it has been queried.
    expect(await prisma.ledgerEntry.count({ where: { amountMinor: { lt: 0 } } })).toBe(0)
  })

  it('opens exactly one approval, however many events arrive', async () => {
    const { orderId, intentId } = await bookedStripeOrder({ quantity: 2 })

    const first = await applyPaymentEvent(reversalEvent(intentId, 'charge.refunded'))
    const second = await applyPaymentEvent(
      // A genuinely different event: the second half of a partial refund.
      reversalEvent(intentId, 'charge.refunded', { reversedMinor: 285_000 }),
    )

    /*
     * Stacking a second proposal would ask the owner the same question twice
     * and let them approve it twice — reversing the same lines on the second
     * pass, which `returnCapacity` throws on rather than clamping (ADR-020).
     */
    expect(first.kind).toBe('reversal_reported')
    expect(second.kind).toBe('reversal_reported')
    expect(await prisma.proposal.count({ where: { kind: 'PAYMENT_REVERSAL' } })).toBe(1)

    // The amount is the provider's cumulative figure, so the larger one wins.
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } })
    expect(order.reversedMinor).toBe(285_000)
  })

  it('is idempotent on a redelivery of the same event', async () => {
    const { intentId } = await bookedStripeOrder({ quantity: 1 })
    const event = reversalEvent(intentId, 'charge.dispute.created')

    const first = await applyPaymentEvent(event)
    const second = await applyPaymentEvent(event)

    expect(first.kind).toBe('reversal_reported')
    expect(second.kind).toBe('replayed')
    expect(await prisma.proposal.count({ where: { kind: 'PAYMENT_REVERSAL' } })).toBe(1)
  })

  it('records the report as a system action with no cancellation in it', async () => {
    const { intentId } = await bookedStripeOrder({ quantity: 1 })
    await applyPaymentEvent(reversalEvent(intentId, 'charge.dispute.funds_withdrawn'))

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: 'commerce.payment.reversal_reported' },
    })
    // Nobody at ARC decided this, and the decision it asks for has not been
    // made. `actorKind: 'system'` is the honest attribution.
    expect(audit.actorKind).toBe('system')
    expect(audit.actorUserId).toBeNull()
    expect(audit.metadataJson).toMatchObject({ itemsCancelled: 0, cause: 'DISPUTE' })
  })

  it('ignores a dispute that closed, because closing can go either way', async () => {
    const { intentId } = await bookedStripeOrder({ quantity: 1 })

    const outcome = await applyPaymentEvent(reversalEvent(intentId, 'charge.refunded', {
      type: 'charge.dispute.closed',
    }) as StripePaymentEvent)

    // A dispute won asks for nothing; a dispute lost already arrived as
    // `funds_withdrawn`. Acting on `closed` would reverse a booking for a
    // charge ARC still holds.
    expect(outcome).toMatchObject({ kind: 'ignored' })
  })

  it('reverses the bookings only once an owner approves', async () => {
    const { orderId, intentId } = await bookedStripeOrder({ quantity: 2 })
    const reported = await applyPaymentEvent(reversalEvent(intentId, 'charge.refunded'))
    if (reported.kind !== 'reversal_reported') throw new Error('expected a report')

    const actor = await actorFor(tenant.ownerUserId)
    const result = await decideProposal(actor, {
      proposalId: reported.proposalId,
      decision: ApprovalDecision.APPROVED,
      note: 'Guest agreed to cancel.',
    })

    expect(result.execution?.executed).toBe(true)

    // Now the places go back, because somebody else can use them.
    expect((await slotState(tenant.slotId)).booked).toBe(0)

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } })
    expect(order.status).toBe(OrderStatus.REFUNDED)

    /*
     * The order's own split is recomputed from its surviving lines, not left at
     * what was charged. It used to keep the full sale while the ledger said the
     * money had gone back; every current reader filters to CONFIRMED, which is
     * the only reason nobody saw a refunded order still presenting earnings.
     * `cancelOrderItem` has always recomputed these, so a reversal that did not
     * was two answers to one question.
     */
    expect(order.hotelEarningsMinor).toBe(0)
    expect(order.platformEarningsMinor).toBe(0)
    expect(order.supplierPayableMinor).toBe(0)
    expect(order.refundedMinor).toBe(order.totalMinor)

    // Reversed per account, so each one sums to what is actually owed — and
    // every account back to zero, because the whole order went.
    const entries = await prisma.ledgerEntry.findMany({ where: { orderId } })
    const byAccount = new Map<string, number>()
    for (const entry of entries) {
      byAccount.set(entry.account, (byAccount.get(entry.account) ?? 0) + entry.amountMinor)
    }
    for (const total of byAccount.values()) expect(total).toBe(0)

    // And the Approval row naming who decided, which is non-negotiable 6.
    const approval = await prisma.approval.findFirstOrThrow({
      where: { proposalId: reported.proposalId },
    })
    expect(approval.decidedById).toBe(tenant.ownerUserId)
  })

  it('keeps the bookings when the owner rejects, which is a real answer', async () => {
    const { orderId, intentId } = await bookedStripeOrder({ quantity: 2 })
    const reported = await applyPaymentEvent(
      reversalEvent(intentId, 'charge.dispute.created'),
    )
    if (reported.kind !== 'reversal_reported') throw new Error('expected a report')

    const actor = await actorFor(tenant.ownerUserId)
    await decideProposal(actor, {
      proposalId: reported.proposalId,
      decision: ApprovalDecision.REJECTED,
      note: 'We expect to win this dispute.',
    })

    // Rejecting is not inaction: it is the hotel saying it will honour the
    // booking. Nothing moves.
    expect((await slotState(tenant.slotId)).booked).toBe(2)
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } })
    expect(order.status).toBe(OrderStatus.CONFIRMED)
    // The report stands, though — the order is still excluded from a payout.
    expect(order.reversalReportedAt).not.toBeNull()
  })

  it('does not reverse a line the guest cancelled in between', async () => {
    const { orderId, intentId } = await bookedStripeOrder({ quantity: 2 })
    const reported = await applyPaymentEvent(reversalEvent(intentId, 'charge.refunded'))
    if (reported.kind !== 'reversal_reported') throw new Error('expected a report')

    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId } })
    const actor = await actorFor(tenant.ownerUserId)
    await cancelOrderItem({
      orderItemId: item.id,
      reason: 'Guest cancelled while the refund was being decided.',
      authority: { kind: 'operator', actor },
    })

    /*
     * The capacity went back on the cancellation. Returning it again on the
     * approval would under-count `booked`, and `returnCapacity` throws rather
     * than clamping — so without the status guard in the execution branch this
     * approval would fail with a constraint error rather than doing nothing.
     */
    await expect(
      decideProposal(actor, {
        proposalId: reported.proposalId,
        decision: ApprovalDecision.APPROVED,
      }),
    ).resolves.toMatchObject({ execution: { executed: true } })

    expect((await slotState(tenant.slotId)).booked).toBe(0)
  })

  it('excludes the order from a supplier payout while the decision is pending', async () => {
    const { orderId, intentId } = await bookedStripeOrder({ quantity: 2 })
    await prisma.orderItem.updateMany({
      where: { orderId },
      data: { supplierConfirmedAt: new Date() },
    })

    const actor = await actorFor(tenant.ownerUserId)
    const before = await summarisePayables(actor, {
      propertyId: tenant.propertyId,
      from: '2000-01-01',
      to: toDateKey(new Date()),
    })
    expect(before[0]?.lines.length).toBeGreaterThan(0)

    await applyPaymentEvent(reversalEvent(intentId, 'charge.refunded'))

    const after = await summarisePayables(actor, {
      propertyId: tenant.propertyId,
      from: '2000-01-01',
      to: toDateKey(new Date()),
    })

    /*
     * This is what `reversalReportedAt` is for. The booking still stands and
     * the decision is still open — and in the meantime ARC must not pay a
     * partner out of money that has gone back to a cardholder.
     */
    expect(after[0]?.lines).toHaveLength(0)
    expect(after[0]?.withheld[0]?.reason).toMatch(/refunded or disputed/i)
  })
})

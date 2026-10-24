import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { isAppError } from '@/lib/errors'
import { OrderItemStatus, OrderStatus } from '@/lib/prisma-types'
import { addToCart, getOrCreateCart } from '@/modules/commerce/cart'
import { cancelOrderItem, checkout } from '@/modules/commerce/checkout'
import { applyPaymentEvent, PAYMENT_EVENT_SCOPE } from '@/modules/commerce/payment-events'
import type { StripePaymentEvent } from '@/modules/integrations/stripe-webhook'
import { createTenant, resetDatabase, slotState, type TenantFixture } from '../helpers/factory'

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

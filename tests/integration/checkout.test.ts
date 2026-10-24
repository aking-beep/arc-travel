import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { localInstant, toDateKey } from '@/lib/dates'
import { isAppError } from '@/lib/errors'
import { CartStatus, OrderItemStatus, OrderStatus } from '@/lib/prisma-types'
import { addToCart, getOrCreateCart, removeFromCart, validateCart } from '@/modules/commerce/cart'
import { cancelOrderItem, checkout, confirmOrderItemBySupplier } from '@/modules/commerce/checkout'
import { actorFor, createTenant, resetDatabase, slotState, type TenantFixture } from '../helpers/factory'

let tenant: TenantFixture

async function cartFor(t: TenantFixture): Promise<string> {
  return getOrCreateCart({
    organizationId: t.organizationId,
    propertyId: t.propertyId,
    guestId: t.guestId,
    stayId: t.stayId,
    currency: 'MXN',
  })
}

beforeEach(async () => {
  await resetDatabase()
  tenant = await createTenant({ capacity: 6, priceMinor: 95_000 })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('cart', () => {
  it('computes totals server-side from stored prices', async () => {
    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 3 })

    const cart = await prisma.cart.findUniqueOrThrow({ where: { id: cartId } })
    expect(cart.subtotalMinor).toBe(285_000)
    expect(cart.feesMinor).toBe(0)
    expect(cart.totalMinor).toBe(285_000)
  })

  it('adds the booking fee once, not per person', async () => {
    const withFee = await createTenant({ capacity: 8, priceMinor: 125_000, bookingFeeMinor: 15_000 })
    const cartId = await cartFor(withFee)
    await addToCart({ cartId, slotId: withFee.slotId, quantity: 4 })

    const cart = await prisma.cart.findUniqueOrThrow({ where: { id: cartId } })
    expect(cart.subtotalMinor).toBe(500_000)
    expect(cart.feesMinor).toBe(15_000)
    expect(cart.totalMinor).toBe(515_000)
  })

  it('holds capacity as soon as something is added', async () => {
    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 2 })
    expect((await slotState(tenant.slotId)).held).toBe(2)
  })

  it('returns capacity when a line is removed', async () => {
    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 2 })
    await removeFromCart({ cartId, slotId: tenant.slotId })

    expect((await slotState(tenant.slotId)).held).toBe(0)
    expect(await prisma.cartItem.count({ where: { cartId } })).toBe(0)
  })

  it('refuses a departure belonging to another property', async () => {
    const other = await createTenant({ capacity: 4 })
    const cartId = await cartFor(tenant)

    await expect(addToCart({ cartId, slotId: other.slotId, quantity: 1 })).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === 'NOT_FOUND',
    )
  })

  it('refuses a party larger than the experience accepts', async () => {
    const small = await createTenant({ capacity: 2 })
    const cartId = await cartFor(small)
    await expect(addToCart({ cartId, slotId: small.slotId, quantity: 5 })).rejects.toThrow(
      /at most 2 people/,
    )
  })

  it('flags a price that changed while the item sat in the basket', async () => {
    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 2 })

    await prisma.price.updateMany({
      where: { experienceId: tenant.experienceId },
      data: { amountMinor: 120_000 },
    })

    const validation = await validateCart(cartId)
    expect(validation.ok).toBe(false)
    expect(validation.problems.map((p) => p.code)).toContain('price_changed')
  })

  it('flags an experience that was unpublished after being added', async () => {
    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 1 })
    await prisma.experience.update({
      where: { id: tenant.experienceId },
      data: { status: 'PAUSED' },
    })

    const validation = await validateCart(cartId)
    expect(validation.problems.map((p) => p.code)).toContain('unpublished')
  })

  it('flags a lapsed hold', async () => {
    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 1 })
    await prisma.inventoryHold.updateMany({
      where: { cartId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    })

    const validation = await validateCart(cartId)
    expect(validation.problems.map((p) => p.code)).toContain('hold_expired')
  })
})

describe('checkout', () => {
  it('books capacity, balances the ledger and converts the cart', async () => {
    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 2 })

    const result = await checkout({
      cartId,
      guestId: tenant.guestId,
      idempotencyKey: randomUUID(),
    })

    expect(result.status).toBe(OrderStatus.CONFIRMED)
    expect(result.isSimulated).toBe(true)
    expect(result.totalMinor).toBe(190_000)
    expect(result.replayed).toBe(false)

    // Capacity moved from held to booked, not duplicated.
    const slot = await slotState(tenant.slotId)
    expect(slot).toMatchObject({ booked: 2, held: 0 })

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: result.orderId },
      include: { items: true, ledgerEntries: true },
    })

    // 15% hotel, 5% ARC, remainder to the supplier.
    expect(order.hotelEarningsMinor).toBe(28_500)
    expect(order.platformEarningsMinor).toBe(9_500)
    expect(order.supplierPayableMinor).toBe(152_000)
    expect(
      order.hotelEarningsMinor + order.platformEarningsMinor + order.supplierPayableMinor,
    ).toBe(order.totalMinor)

    expect(order.items).toHaveLength(1)
    expect(order.items[0]?.status).toBe(OrderItemStatus.CONFIRMED)
    expect(order.items[0]?.supplierConfirmedAt).toBeNull()

    const ledgerSum = order.ledgerEntries.reduce((n, e) => n + e.amountMinor, 0)
    expect(ledgerSum).toBe(order.totalMinor)

    const cart = await prisma.cart.findUniqueOrThrow({ where: { id: cartId } })
    expect(cart.status).toBe(CartStatus.CONVERTED)
    expect(cart.convertedOrderId).toBe(result.orderId)
  })

  it('never charges real money while the build is in demo mode', async () => {
    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 1 })
    const result = await checkout({ cartId, guestId: tenant.guestId, idempotencyKey: randomUUID() })

    const order = await prisma.order.findUniqueOrThrow({ where: { id: result.orderId } })
    expect(order.isSimulated).toBe(true)
    expect(order.paymentProvider).toBe('simulated')
    expect(order.paymentReference).toMatch(/^SIMULATED-/)
  })

  it('replays the first result for a repeated idempotency key', async () => {
    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 2 })
    const key = randomUUID()

    const first = await checkout({ cartId, guestId: tenant.guestId, idempotencyKey: key })
    const second = await checkout({ cartId, guestId: tenant.guestId, idempotencyKey: key })

    expect(second.orderId).toBe(first.orderId)
    expect(second.replayed).toBe(true)

    expect(await prisma.order.count({ where: { propertyId: tenant.propertyId } })).toBe(1)
    expect((await slotState(tenant.slotId)).booked).toBe(2)
  })

  it('creates exactly one order when the same key is submitted concurrently', async () => {
    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 2 })
    const key = randomUUID()

    const results = await Promise.allSettled([
      checkout({ cartId, guestId: tenant.guestId, idempotencyKey: key }),
      checkout({ cartId, guestId: tenant.guestId, idempotencyKey: key }),
    ])

    const succeeded = results.filter((r) => r.status === 'fulfilled')
    expect(succeeded.length).toBeGreaterThanOrEqual(1)
    expect(await prisma.order.count({ where: { propertyId: tenant.propertyId } })).toBe(1)
    expect((await slotState(tenant.slotId)).booked).toBe(2)
  })

  it('refuses another guest’s basket', async () => {
    const other = await createTenant({ capacity: 2 })
    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 1 })

    await expect(
      checkout({ cartId, guestId: other.guestId, idempotencyKey: randomUUID() }),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === 'NOT_FOUND')
  })

  it('rolls back completely when a line cannot be fulfilled', async () => {
    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 2 })

    // Simulate the hold vanishing between validation and the transaction.
    await prisma.inventoryHold.updateMany({ where: { cartId }, data: { status: 'RELEASED' } })

    await expect(
      checkout({ cartId, guestId: tenant.guestId, idempotencyKey: randomUUID() }),
    ).rejects.toThrow()

    expect(await prisma.order.count({ where: { propertyId: tenant.propertyId } })).toBe(0)
    expect(await prisma.orderItem.count()).toBe(0)
    expect(await prisma.ledgerEntry.count()).toBe(0)

    const cart = await prisma.cart.findUniqueOrThrow({ where: { id: cartId } })
    expect(cart.status).toBe(CartStatus.OPEN)
  })

  it('frees the idempotency key after a failure so the guest can retry', async () => {
    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 1 })
    await prisma.price.updateMany({
      where: { experienceId: tenant.experienceId },
      data: { amountMinor: 111_111 },
    })

    const key = randomUUID()
    await expect(checkout({ cartId, guestId: tenant.guestId, idempotencyKey: key })).rejects.toThrow()

    expect(
      await prisma.idempotencyKey.count({ where: { organizationId: tenant.organizationId, key } }),
    ).toBe(0)
  })

  it('refuses an empty basket', async () => {
    const cartId = await cartFor(tenant)
    await expect(
      checkout({ cartId, guestId: tenant.guestId, idempotencyKey: randomUUID() }),
    ).rejects.toThrow(/needs attention/)
  })

  it('cannot double-book the last place across two baskets', async () => {
    const tight = await createTenant({ capacity: 1 })
    const firstCart = await getOrCreateCart({
      organizationId: tight.organizationId,
      propertyId: tight.propertyId,
      guestId: tight.guestId,
      currency: 'MXN',
    })
    await addToCart({ cartId: firstCart, slotId: tight.slotId, quantity: 1 })

    const otherGuest = await prisma.guest.create({
      data: {
        organizationId: tight.organizationId,
        propertyId: tight.propertyId,
        firstName: 'Second',
        lastName: 'Guest',
        email: `second-${Date.now()}@example.com`,
        partySize: 1,
        currency: 'MXN',
      },
      select: { id: true },
    })
    const secondCart = await getOrCreateCart({
      organizationId: tight.organizationId,
      propertyId: tight.propertyId,
      guestId: otherGuest.id,
      currency: 'MXN',
    })

    // The second basket cannot even hold the place, let alone check out.
    await expect(addToCart({ cartId: secondCart, slotId: tight.slotId, quantity: 1 })).rejects.toThrow()

    await checkout({ cartId: firstCart, guestId: tight.guestId, idempotencyKey: randomUUID() })
    expect((await slotState(tight.slotId)).booked).toBe(1)
  })
})

describe('cancellation and refunds', () => {
  it('refunds in full inside the window and returns capacity', async () => {
    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 2 })
    const order = await checkout({
      cartId,
      guestId: tenant.guestId,
      idempotencyKey: randomUUID(),
    })

    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.orderId } })
    const result = await cancelOrderItem({
      orderItemId: item.id,
      reason: 'test',
      authority: { kind: 'guest', guestId: tenant.guestId },
    })

    expect(result.withinWindow).toBe(true)
    expect(result.refundMinor).toBe(190_000)
    expect(result.orderStatus).toBe(OrderStatus.REFUNDED)

    expect((await slotState(tenant.slotId)).booked).toBe(0)

    const refreshed = await prisma.order.findUniqueOrThrow({
      where: { id: order.orderId },
      include: { ledgerEntries: true },
    })
    expect(refreshed.refundedMinor).toBe(190_000)
    // Earnings are recomputed from surviving lines, not patched in place.
    expect(refreshed.hotelEarningsMinor).toBe(0)
    expect(refreshed.ledgerEntries.reduce((n, e) => n + e.amountMinor, 0)).toBe(0)
  })

  it('refunds nothing outside the window but still returns the place', async () => {
    const soon = await createTenant({
      capacity: 4,
      departureDate: new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 10),
      departureTime: new Date(Date.now() + 2 * 3_600_000).toISOString().slice(11, 16),
      cancellationPolicyHours: 24,
    })
    const cartId = await cartFor(soon)
    await addToCart({ cartId, slotId: soon.slotId, quantity: 1 })
    const order = await checkout({ cartId, guestId: soon.guestId, idempotencyKey: randomUUID() })

    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.orderId } })
    const result = await cancelOrderItem({
      orderItemId: item.id,
      reason: 'late',
      authority: { kind: 'guest', guestId: soon.guestId },
    })

    expect(result.withinWindow).toBe(false)
    expect(result.refundMinor).toBe(0)
    expect(result.orderStatus).toBe(OrderStatus.CANCELLED)
    expect((await slotState(soon.slotId)).booked).toBe(0)
  })

  it('marks an order partially cancelled while other lines survive', async () => {
    // A stated local departure hour rather than "now, twelve days on": the
    // activity's operating window is enforced at the point of sale, so a
    // fixture built from the wall clock became unbookable whenever the suite
    // ran outside 06:00–18:00 local.
    const secondStartsAt = localInstant(
      toDateKey(new Date(Date.now() + 12 * 86_400_000)),
      '09:00',
    )
    const second = await prisma.availabilitySlot.create({
      data: {
        organizationId: tenant.organizationId,
        experienceId: tenant.experienceId,
        startsAt: secondStartsAt,
        endsAt: new Date(secondStartsAt.getTime() + 7_200_000),
        capacity: 4,
        currency: 'MXN',
      },
      select: { id: true },
    })

    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 1 })
    await addToCart({ cartId, slotId: second.id, quantity: 1 })
    const order = await checkout({ cartId, guestId: tenant.guestId, idempotencyKey: randomUUID() })

    const items = await prisma.orderItem.findMany({ where: { orderId: order.orderId } })
    expect(items).toHaveLength(2)

    const result = await cancelOrderItem({
      orderItemId: items[0]!.id,
      reason: 'one only',
      authority: { kind: 'guest', guestId: tenant.guestId },
    })
    expect(result.orderStatus).toBe(OrderStatus.PARTIALLY_CANCELLED)

    const refreshed = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } })
    expect(refreshed.hotelEarningsMinor).toBeGreaterThan(0)
  })

  it('refuses to cancel another guest’s booking', async () => {
    // Regression: cancelOrderItem loaded the item by id alone, so anyone
    // holding any portal token could cancel any other guest's booking —
    // freeing their place and writing a refund against a different hotel's
    // ledger. Ownership is now part of the query.
    const other = await createTenant({ capacity: 2 })

    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 1 })
    const order = await checkout({
      cartId,
      guestId: tenant.guestId,
      idempotencyKey: randomUUID(),
    })
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.orderId } })

    await expect(
      cancelOrderItem({
        orderItemId: item.id,
        reason: 'not mine to cancel',
        authority: { kind: 'guest', guestId: other.guestId },
      }),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === 'NOT_FOUND')

    // Nothing moved: the booking stands and the capacity is still committed.
    const untouched = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(untouched.status).toBe(OrderItemStatus.CONFIRMED)
    expect((await slotState(tenant.slotId)).booked).toBe(1)
    expect(await prisma.ledgerEntry.count({ where: { account: 'refund' } })).toBe(0)
  })

  it('refuses an operator from another tenant', async () => {
    const other = await createTenant({ capacity: 2 })

    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 1 })
    const order = await checkout({
      cartId,
      guestId: tenant.guestId,
      idempotencyKey: randomUUID(),
    })
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.orderId } })

    const foreignOwner = await actorFor(other.ownerUserId)
    await expect(
      cancelOrderItem({
        orderItemId: item.id,
        reason: 'not my property',
        authority: { kind: 'operator', actor: foreignOwner },
      }),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === 'FORBIDDEN')
  })

  it('lets the owning hotel cancel on a guest’s behalf', async () => {
    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 1 })
    const order = await checkout({
      cartId,
      guestId: tenant.guestId,
      idempotencyKey: randomUUID(),
    })
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.orderId } })

    const owner = await actorFor(tenant.ownerUserId)
    const result = await cancelOrderItem({
      orderItemId: item.id,
      reason: 'guest called the front desk',
      authority: { kind: 'operator', actor: owner },
    })

    expect(result.refundMinor).toBeGreaterThan(0)
    expect((await slotState(tenant.slotId)).booked).toBe(0)

    // The audit trail names the person, not an anonymous "guest".
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: 'commerce.orderItem.cancelled' },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit.actorUserId).toBe(tenant.ownerUserId)
  })

  it('applies a concurrent double-cancellation exactly once', async () => {
    // Regression: the "already cancelled" guard was read outside the
    // transaction and the body never re-read the status. Two concurrent
    // cancellations both passed the guard; the loser hit a serialization
    // failure, and the retry re-ran the whole body — decrementing `booked`
    // twice and writing a second refund entry, so `booked` sat below the real
    // number of bookings and placeHold would sell seats that were gone.
    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 2 })
    const order = await checkout({
      cartId,
      guestId: tenant.guestId,
      idempotencyKey: randomUUID(),
    })
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.orderId } })

    expect((await slotState(tenant.slotId)).booked).toBe(2)

    const authority = { kind: 'guest' as const, guestId: tenant.guestId }
    const results = await Promise.allSettled([
      cancelOrderItem({ orderItemId: item.id, reason: 'double tap A', authority }),
      cancelOrderItem({ orderItemId: item.id, reason: 'double tap B', authority }),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)

    // Capacity returned once, not twice.
    expect((await slotState(tenant.slotId)).booked).toBe(0)

    // And exactly one refund entry.
    const refunds = await prisma.ledgerEntry.findMany({
      where: { orderItemId: item.id, account: 'refund' },
    })
    expect(refunds).toHaveLength(1)
    expect(refunds[0]?.amountMinor).toBe(-190_000)

    const refreshed = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } })
    expect(refreshed.refundedMinor).toBe(190_000)
  })

  it('refuses to cancel the same line twice', async () => {
    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 1 })
    const order = await checkout({ cartId, guestId: tenant.guestId, idempotencyKey: randomUUID() })
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.orderId } })

    const authority = { kind: 'guest' as const, guestId: tenant.guestId }
    await cancelOrderItem({ orderItemId: item.id, reason: 'first', authority })
    await expect(
      cancelOrderItem({ orderItemId: item.id, reason: 'second', authority }),
    ).rejects.toThrow(/already been cancelled/)
  })
})

describe('supplier confirmation', () => {
  it('records the partner’s manual confirmation', async () => {
    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 1 })
    const order = await checkout({ cartId, guestId: tenant.guestId, idempotencyKey: randomUUID() })
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.orderId } })

    await confirmOrderItemBySupplier({ orderItemId: item.id, supplierId: tenant.supplierId })

    const confirmed = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(confirmed.supplierConfirmedAt).toBeInstanceOf(Date)
  })

  it('refuses another partner’s booking', async () => {
    const other = await createTenant({ capacity: 2 })
    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 1 })
    const order = await checkout({ cartId, guestId: tenant.guestId, idempotencyKey: randomUUID() })
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.orderId } })

    await expect(
      confirmOrderItemBySupplier({ orderItemId: item.id, supplierId: other.supplierId }),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === 'NOT_FOUND')
  })
})

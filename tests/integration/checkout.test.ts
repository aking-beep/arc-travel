import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { isAppError } from '@/lib/errors'
import { CartStatus, OrderItemStatus, OrderStatus } from '@/lib/prisma-types'
import { addToCart, getOrCreateCart, removeFromCart, validateCart } from '@/modules/commerce/cart'
import { cancelOrderItem, checkout, confirmOrderItemBySupplier } from '@/modules/commerce/checkout'
import { createTenant, resetDatabase, slotState, type TenantFixture } from '../helpers/factory'

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
    const result = await cancelOrderItem({ orderItemId: item.id, reason: 'test' })

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
    const result = await cancelOrderItem({ orderItemId: item.id, reason: 'late' })

    expect(result.withinWindow).toBe(false)
    expect(result.refundMinor).toBe(0)
    expect(result.orderStatus).toBe(OrderStatus.CANCELLED)
    expect((await slotState(soon.slotId)).booked).toBe(0)
  })

  it('marks an order partially cancelled while other lines survive', async () => {
    const second = await prisma.availabilitySlot.create({
      data: {
        organizationId: tenant.organizationId,
        experienceId: tenant.experienceId,
        startsAt: new Date(Date.now() + 12 * 86_400_000),
        endsAt: new Date(Date.now() + 12 * 86_400_000 + 7_200_000),
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

    const result = await cancelOrderItem({ orderItemId: items[0]!.id, reason: 'one only' })
    expect(result.orderStatus).toBe(OrderStatus.PARTIALLY_CANCELLED)

    const refreshed = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } })
    expect(refreshed.hotelEarningsMinor).toBeGreaterThan(0)
  })

  it('refuses to cancel the same line twice', async () => {
    const cartId = await cartFor(tenant)
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 1 })
    const order = await checkout({ cartId, guestId: tenant.guestId, idempotencyKey: randomUUID() })
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.orderId } })

    await cancelOrderItem({ orderItemId: item.id, reason: 'first' })
    await expect(cancelOrderItem({ orderItemId: item.id, reason: 'second' })).rejects.toThrow(
      /already been cancelled/,
    )
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

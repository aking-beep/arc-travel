import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { isAppError } from '@/lib/errors'
import { HoldStatus, SlotStatus } from '@/lib/prisma-types'
import {
  consumeHold,
  getAvailability,
  HOLD_TTL_MINUTES,
  placeHold,
  releaseHold,
  releaseHoldsForCart,
  sweepExpiredHolds,
} from '@/modules/inventory/service'
import { createTenant, resetDatabase, slotState, type TenantFixture } from '../helpers/factory'

/**
 * Inventory holds against a real database.
 *
 * These are the tests that justify Serializable isolation: every one of them
 * describes a way two guests could end up on the same seat.
 */
let tenant: TenantFixture

async function makeCart(t: TenantFixture, label = 'cart'): Promise<string> {
  const cart = await prisma.cart.create({
    data: {
      organizationId: t.organizationId,
      propertyId: t.propertyId,
      guestId: t.guestId,
      currency: 'MXN',
      expiresAt: new Date(Date.now() + 1_800_000),
    },
    select: { id: true },
  })
  void label
  return cart.id
}

beforeEach(async () => {
  await resetDatabase()
  tenant = await createTenant({ capacity: 4 })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('placeHold', () => {
  it('reserves capacity without booking it', async () => {
    const cartId = await makeCart(tenant)
    const hold = await placeHold({
      organizationId: tenant.organizationId,
      slotId: tenant.slotId,
      cartId,
      quantity: 2,
    })

    expect(hold.quantity).toBe(2)
    const slot = await slotState(tenant.slotId)
    expect(slot).toMatchObject({ capacity: 4, booked: 0, held: 2, status: SlotStatus.OPEN })
  })

  it('marks the slot full when capacity is exhausted by holds alone', async () => {
    const cartId = await makeCart(tenant)
    await placeHold({
      organizationId: tenant.organizationId,
      slotId: tenant.slotId,
      cartId,
      quantity: 4,
    })

    const slot = await slotState(tenant.slotId)
    expect(slot.status).toBe(SlotStatus.FULL)
  })

  it('refuses to oversell', async () => {
    const first = await makeCart(tenant)
    const second = await makeCart(tenant)

    await placeHold({
      organizationId: tenant.organizationId,
      slotId: tenant.slotId,
      cartId: first,
      quantity: 3,
    })

    await expect(
      placeHold({
        organizationId: tenant.organizationId,
        slotId: tenant.slotId,
        cartId: second,
        quantity: 2,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === 'CAPACITY_UNAVAILABLE',
    )

    const slot = await slotState(tenant.slotId)
    expect(slot.held).toBe(3)
  })

  it('tells the guest how many places are genuinely left', async () => {
    const first = await makeCart(tenant)
    const second = await makeCart(tenant)
    await placeHold({
      organizationId: tenant.organizationId,
      slotId: tenant.slotId,
      cartId: first,
      quantity: 3,
    })

    await expect(
      placeHold({
        organizationId: tenant.organizationId,
        slotId: tenant.slotId,
        cartId: second,
        quantity: 4,
      }),
    ).rejects.toThrow(/Only 1 place is left/)
  })

  it('resizes rather than stacking a second hold for the same cart and slot', async () => {
    const cartId = await makeCart(tenant)

    await placeHold({ organizationId: tenant.organizationId, slotId: tenant.slotId, cartId, quantity: 1 })
    await placeHold({ organizationId: tenant.organizationId, slotId: tenant.slotId, cartId, quantity: 3 })

    const holds = await prisma.inventoryHold.findMany({
      where: { cartId, status: HoldStatus.ACTIVE },
    })
    expect(holds).toHaveLength(1)
    expect(holds[0]?.quantity).toBe(3)

    const slot = await slotState(tenant.slotId)
    expect(slot.held).toBe(3)
  })

  it('lets a cart grow into capacity it already holds', async () => {
    const cartId = await makeCart(tenant)
    await placeHold({ organizationId: tenant.organizationId, slotId: tenant.slotId, cartId, quantity: 4 })
    // Shrinking then growing again must not trip the capacity check against
    // the cart's own held places.
    await placeHold({ organizationId: tenant.organizationId, slotId: tenant.slotId, cartId, quantity: 2 })
    await placeHold({ organizationId: tenant.organizationId, slotId: tenant.slotId, cartId, quantity: 4 })

    expect((await slotState(tenant.slotId)).held).toBe(4)
  })

  it('rejects a departure that has already started', async () => {
    const past = await createTenant({
      capacity: 4,
      departureDate: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10),
    })
    const cartId = await makeCart(past)

    await expect(
      placeHold({
        organizationId: past.organizationId,
        slotId: past.slotId,
        cartId,
        quantity: 1,
      }),
    ).rejects.toThrow(/already started/)
  })

  it('rejects a cancelled departure', async () => {
    await prisma.availabilitySlot.update({
      where: { id: tenant.slotId },
      data: { status: SlotStatus.CANCELLED },
    })
    const cartId = await makeCart(tenant)

    await expect(
      placeHold({ organizationId: tenant.organizationId, slotId: tenant.slotId, cartId, quantity: 1 }),
    ).rejects.toThrow(/no longer open/)
  })

  it('rejects a non-positive quantity', async () => {
    const cartId = await makeCart(tenant)
    await expect(
      placeHold({ organizationId: tenant.organizationId, slotId: tenant.slotId, cartId, quantity: 0 }),
    ).rejects.toThrow(/positive whole number/)
  })
})

describe('concurrency', () => {
  it('lets exactly one of two simultaneous holds take the last place', async () => {
    const tight = await createTenant({ capacity: 1 })
    const first = await makeCart(tight)
    const second = await makeCart(tight)

    const results = await Promise.allSettled([
      placeHold({
        organizationId: tight.organizationId,
        slotId: tight.slotId,
        cartId: first,
        quantity: 1,
      }),
      placeHold({
        organizationId: tight.organizationId,
        slotId: tight.slotId,
        cartId: second,
        quantity: 1,
      }),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    expect(fulfilled).toHaveLength(1)

    const slot = await slotState(tight.slotId)
    expect(slot.held).toBe(1)
    expect(slot.held + slot.booked).toBeLessThanOrEqual(slot.capacity)
  })

  it('never exceeds capacity under a burst of concurrent holds', async () => {
    const popular = await createTenant({ capacity: 5 })
    const carts = await Promise.all(
      Array.from({ length: 10 }, (_, i) => makeCart(popular, `cart-${i}`)),
    )

    const results = await Promise.allSettled(
      carts.map((cartId) =>
        placeHold({
          organizationId: popular.organizationId,
          slotId: popular.slotId,
          cartId,
          quantity: 1,
        }),
      ),
    )

    const granted = results.filter((r) => r.status === 'fulfilled').length
    const slot = await slotState(popular.slotId)

    expect(granted).toBe(5)
    expect(slot.held).toBe(5)
    expect(slot.booked + slot.held).toBeLessThanOrEqual(slot.capacity)
    expect(slot.status).toBe(SlotStatus.FULL)
  })
})

describe('expiry', () => {
  it('returns capacity when a hold expires', async () => {
    const cartId = await makeCart(tenant)
    await placeHold({
      organizationId: tenant.organizationId,
      slotId: tenant.slotId,
      cartId,
      quantity: 3,
      ttlMinutes: -1,
    })

    expect((await slotState(tenant.slotId)).held).toBe(3)

    const swept = await sweepExpiredHolds({ slotIds: [tenant.slotId] })
    expect(swept).toBe(1)

    const slot = await slotState(tenant.slotId)
    expect(slot.held).toBe(0)
    expect(slot.status).toBe(SlotStatus.OPEN)

    const hold = await prisma.inventoryHold.findFirstOrThrow({ where: { cartId } })
    expect(hold.status).toBe(HoldStatus.EXPIRED)
  })

  it('sweeps lazily on the read path, so nothing depends on a cron job', async () => {
    const cartId = await makeCart(tenant)
    await placeHold({
      organizationId: tenant.organizationId,
      slotId: tenant.slotId,
      cartId,
      quantity: 2,
      ttlMinutes: -1,
    })

    const availability = await getAvailability([tenant.slotId])
    expect(availability.get(tenant.slotId)?.remaining).toBe(4)
    expect(availability.get(tenant.slotId)?.held).toBe(0)
  })

  it('leaves an unexpired hold alone', async () => {
    const cartId = await makeCart(tenant)
    await placeHold({
      organizationId: tenant.organizationId,
      slotId: tenant.slotId,
      cartId,
      quantity: 2,
      ttlMinutes: HOLD_TTL_MINUTES,
    })

    expect(await sweepExpiredHolds({ slotIds: [tenant.slotId] })).toBe(0)
    expect((await slotState(tenant.slotId)).held).toBe(2)
  })
})

describe('release', () => {
  it('returns capacity and is idempotent', async () => {
    const cartId = await makeCart(tenant)
    const hold = await placeHold({
      organizationId: tenant.organizationId,
      slotId: tenant.slotId,
      cartId,
      quantity: 2,
    })

    await releaseHold({ holdId: hold.holdId, reason: 'test' })
    expect((await slotState(tenant.slotId)).held).toBe(0)

    // Releasing twice must not drive the counter negative.
    await releaseHold({ holdId: hold.holdId, reason: 'test-again' })
    expect((await slotState(tenant.slotId)).held).toBe(0)
  })

  it('releases every hold belonging to a cart', async () => {
    const cartId = await makeCart(tenant)
    const other = await createTenant({ capacity: 3 })

    await placeHold({ organizationId: tenant.organizationId, slotId: tenant.slotId, cartId, quantity: 1 })
    await placeHold({ organizationId: other.organizationId, slotId: other.slotId, cartId, quantity: 1 })

    expect(await releaseHoldsForCart(cartId)).toBe(2)
    expect((await slotState(tenant.slotId)).held).toBe(0)
    expect((await slotState(other.slotId)).held).toBe(0)
  })
})

describe('consumeHold', () => {
  it('moves capacity from held to booked', async () => {
    const cartId = await makeCart(tenant)
    const hold = await placeHold({
      organizationId: tenant.organizationId,
      slotId: tenant.slotId,
      cartId,
      quantity: 2,
    })

    const order = await prisma.order.create({
      data: {
        organizationId: tenant.organizationId,
        propertyId: tenant.propertyId,
        guestId: tenant.guestId,
        reference: `REF-${Date.now()}`,
        currency: 'MXN',
      },
      select: { id: true },
    })
    const orderItem = await prisma.orderItem.create({
      data: {
        organizationId: tenant.organizationId,
        orderId: order.id,
        experienceId: tenant.experienceId,
        slotId: tenant.slotId,
        supplierId: tenant.supplierId,
        quantity: 2,
        unitPriceMinor: 95_000,
        lineTotalMinor: 190_000,
        currency: 'MXN',
      },
      select: { id: true },
    })

    await prisma.$transaction(
      (tx) => consumeHold(tx, { holdId: hold.holdId, orderItemId: orderItem.id }),
      { isolationLevel: 'Serializable' },
    )

    const slot = await slotState(tenant.slotId)
    expect(slot).toMatchObject({ booked: 2, held: 0 })

    const consumed = await prisma.inventoryHold.findUniqueOrThrow({ where: { id: hold.holdId } })
    expect(consumed.status).toBe(HoldStatus.CONSUMED)
    expect(consumed.orderItemId).toBe(orderItem.id)
  })

  it('refuses an expired hold rather than booking anyway', async () => {
    const cartId = await makeCart(tenant)
    const hold = await placeHold({
      organizationId: tenant.organizationId,
      slotId: tenant.slotId,
      cartId,
      quantity: 1,
      ttlMinutes: -1,
    })

    await expect(
      prisma.$transaction(
        (tx) => consumeHold(tx, { holdId: hold.holdId, orderItemId: 'irrelevant' }),
        { isolationLevel: 'Serializable' },
      ),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === 'HOLD_EXPIRED')

    expect((await slotState(tenant.slotId)).booked).toBe(0)
  })

  it('refuses a hold that was already consumed', async () => {
    const cartId = await makeCart(tenant)
    const hold = await placeHold({
      organizationId: tenant.organizationId,
      slotId: tenant.slotId,
      cartId,
      quantity: 1,
    })
    await prisma.inventoryHold.update({
      where: { id: hold.holdId },
      data: { status: HoldStatus.CONSUMED },
    })

    await expect(
      prisma.$transaction((tx) => consumeHold(tx, { holdId: hold.holdId, orderItemId: 'x' }), {
        isolationLevel: 'Serializable',
      }),
    ).rejects.toThrow(/already been used/)
  })
})

describe('database-level invariants', () => {
  it('refuses a write that would oversell, even bypassing the service layer', async () => {
    // The application enforces `booked + held <= capacity` in every
    // transaction, but a bug in that code used to corrupt the counters
    // silently. The CHECK constraint makes the same rule true of any writer.
    await expect(
      prisma.availabilitySlot.update({
        where: { id: tenant.slotId },
        data: { booked: 99 },
      }),
    ).rejects.toThrow(/slot_capacity_invariant|constraint/i)

    expect((await slotState(tenant.slotId)).booked).toBe(0)
  })

  it('refuses a negative counter', async () => {
    await expect(
      prisma.availabilitySlot.update({ where: { id: tenant.slotId }, data: { held: -1 } }),
    ).rejects.toThrow(/slot_capacity_invariant|constraint/i)
  })

  it('refuses a confirmed order whose split does not account for its total', async () => {
    await expect(
      prisma.order.create({
        data: {
          organizationId: tenant.organizationId,
          propertyId: tenant.propertyId,
          guestId: tenant.guestId,
          reference: `BAD-${Date.now()}`,
          status: 'CONFIRMED',
          currency: 'MXN',
          totalMinor: 100_000,
          hotelEarningsMinor: 1,
          platformEarningsMinor: 1,
          supplierPayableMinor: 1,
        },
      }),
    ).rejects.toThrow(/order_split_reconciles|constraint/i)
  })

  it('refuses a refund larger than the line it refunds', async () => {
    const order = await prisma.order.create({
      data: {
        organizationId: tenant.organizationId,
        propertyId: tenant.propertyId,
        guestId: tenant.guestId,
        reference: `REF-${Date.now()}`,
        currency: 'MXN',
        totalMinor: 95_000,
      },
      select: { id: true },
    })

    await expect(
      prisma.orderItem.create({
        data: {
          organizationId: tenant.organizationId,
          orderId: order.id,
          experienceId: tenant.experienceId,
          slotId: tenant.slotId,
          supplierId: tenant.supplierId,
          quantity: 1,
          unitPriceMinor: 95_000,
          lineTotalMinor: 95_000,
          refundedMinor: 200_000,
          currency: 'MXN',
        },
      }),
    ).rejects.toThrow(/order_item_money_sane|constraint/i)
  })

  it('refuses a conditions reading whose maximum is below its minimum', async () => {
    await expect(
      prisma.conditionReport.create({
        data: {
          placeId: tenant.placeId,
          forDate: new Date('2026-12-01T00:00:00.000Z'),
          waveHeightMinM: 2.5,
          waveHeightMaxM: 0.5,
          risk: 'LOW',
          minAbilityRequired: 'BEGINNER',
        },
      }),
    ).rejects.toThrow(/conditions_wave_range|constraint/i)
  })
})

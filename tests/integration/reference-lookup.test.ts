import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { isAppError } from '@/lib/errors'
import { StayStatus } from '@/lib/prisma-types'
import { addToCart, getOrCreateCart } from '@/modules/commerce/cart'
import { checkout } from '@/modules/commerce/checkout'
import { listArrivals, lookupReference } from '@/modules/hotels/service'
import { actorFor, createTenant, resetDatabase, type TenantFixture } from '../helpers/factory'

/**
 * The hotel's answer to a reference read down the phone.
 *
 * Every operator screen was an aggregate, and the only place an order
 * reference appeared anywhere was the *partner's* bookings page — so a guest
 * ringing the desk with `ARC-…` could not be looked up at all. These tests are
 * that gap closed, plus the tenancy boundary it must not open.
 */
let tenant: TenantFixture

async function buy(t: TenantFixture, quantity = 2) {
  const cartId = await getOrCreateCart({
    organizationId: t.organizationId,
    propertyId: t.propertyId,
    guestId: t.guestId,
    stayId: t.stayId,
    currency: 'MXN',
  })
  await addToCart({ cartId, slotId: t.slotId, quantity })
  return checkout({ cartId, guestId: t.guestId, idempotencyKey: randomUUID() })
}

beforeEach(async () => {
  await resetDatabase()
  tenant = await createTenant({ capacity: 6, priceMinor: 95_000 })
})
afterAll(() => prisma.$disconnect())

describe('lookupReference', () => {
  it('finds the stay and the order behind an order reference', async () => {
    const order = await buy(tenant)
    const actor = await actorFor(tenant.ownerUserId)

    const found = await lookupReference(actor, tenant.propertyId, { reference: order.reference })

    expect(found.stays).toHaveLength(1)
    expect(found.stays[0]?.id).toBe(tenant.stayId)
    expect(found.stays[0]?.orders.map((o) => o.reference)).toEqual([order.reference])
    expect(found.stays[0]?.orders[0]?.items).not.toHaveLength(0)
  })

  it('accepts the reference in whatever case the desk typed it', async () => {
    const order = await buy(tenant)
    const actor = await actorFor(tenant.ownerUserId)

    const found = await lookupReference(actor, tenant.propertyId, {
      reference: `  ${order.reference.toLowerCase()}  `,
    })

    expect(found.stays[0]?.orders[0]?.reference).toBe(order.reference)
  })

  it('finds a stay by its own reference and shows everything on it', async () => {
    const order = await buy(tenant)
    const stay = await prisma.stay.findUniqueOrThrow({
      where: { id: tenant.stayId },
      select: { reference: true },
    })
    const actor = await actorFor(tenant.ownerUserId)

    const found = await lookupReference(actor, tenant.propertyId, { reference: stay.reference })

    expect(found.stays).toHaveLength(1)
    expect(found.stays[0]?.orders.map((o) => o.reference)).toContain(order.reference)
  })

  it('refuses half a reference rather than scanning for it', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    await expect(lookupReference(actor, tenant.propertyId, { reference: 'ARC' })).rejects.toThrow()
  })

  it('does not find another property’s order', async () => {
    const other = await createTenant({ name: 'other' })
    const order = await buy(other)
    const actor = await actorFor(tenant.ownerUserId)

    // The reference exists. It is simply not this property's to see, and the
    // scoping is in the `where` clause rather than a check afterwards.
    const found = await lookupReference(actor, tenant.propertyId, { reference: order.reference })
    expect(found.stays).toHaveLength(0)
  })

  it('refuses an operator with no access to the property at all', async () => {
    const other = await createTenant({ name: 'stranger' })
    const actor = await actorFor(other.ownerUserId)

    await expect(
      lookupReference(actor, tenant.propertyId, { reference: 'ARC-0000-0000' }),
    ).rejects.toSatisfy((error) => isAppError(error) && error.status === 403)
  })
})

describe('listArrivals', () => {
  it('includes a guest who is already in the building, and their bookings', async () => {
    /*
     * The real case: checked in three days ago, booked this morning. The
     * window used to be `checkIn >= today`, so neither the guest nor what they
     * had bought appeared on any operator screen.
     */
    const checkedInOn = new Date(Date.now() - 3 * 86_400_000)
    await prisma.stay.update({
      where: { id: tenant.stayId },
      data: { checkIn: checkedInOn, status: StayStatus.IN_HOUSE },
    })
    const order = await buy(tenant)
    const actor = await actorFor(tenant.ownerUserId)

    const arrivals = await listArrivals(actor, tenant.propertyId, {
      fromDate: new Date(),
      days: 14,
    })

    const stay = arrivals.find((candidate) => candidate.id === tenant.stayId)
    expect(stay).toBeDefined()
    expect(stay?.orders.map((o) => o.reference)).toContain(order.reference)
  })

  it('still leaves out a stay that ended before the window', async () => {
    await prisma.stay.update({
      where: { id: tenant.stayId },
      data: {
        checkIn: new Date(Date.now() - 30 * 86_400_000),
        status: StayStatus.CHECKED_OUT,
      },
    })
    const actor = await actorFor(tenant.ownerUserId)

    const arrivals = await listArrivals(actor, tenant.propertyId, {
      fromDate: new Date(),
      days: 14,
    })

    expect(arrivals.map((s) => s.id)).not.toContain(tenant.stayId)
  })
})

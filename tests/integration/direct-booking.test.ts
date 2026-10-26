import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { isAppError, type AppError } from '@/lib/errors'
import { hashPassword } from '@/lib/password'
import { resetRateLimitCounters } from '@/lib/rate-limit'
import { addDays, toDateKey } from '@/lib/dates'
import { EntityStatus, StayKind, StayStatus } from '@/lib/prisma-types'
import {
  addDirectTripToAccount,
  listDirectStorefronts,
  MAX_DIRECT_TRIP_DAYS,
  registerDirectTrip,
} from '@/modules/guest/direct'
import { getGuestAccount } from '@/modules/guest/account'
import { resolvePortalContext } from '@/modules/guest/portal'
import { addToCart, getOrCreateCart } from '@/modules/commerce/cart'
import { checkout } from '@/modules/commerce/checkout'
import { getRevenueAnalytics } from '@/modules/analytics/reports'
import { listArrivals } from '@/modules/hotels/service'
import { actorFor, createTenant, resetDatabase } from '../helpers/factory'

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await resetDatabase()
  resetRateLimitCounters()
})

function codeOf(error: unknown): string {
  if (!isAppError(error)) throw error
  return (error as AppError).code
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise.catch((e: unknown) => Promise.reject(new Error(codeOf(e))))).rejects.toThrow(
    code,
  )
}

const today = () => toDateKey(new Date())

async function slugOf(propertyId: string): Promise<string> {
  const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })
  return property.slug
}

const signUp = (slug: string, overrides: Record<string, unknown> = {}) => ({
  name: 'Sam Okafor',
  email: 'sam@example.com',
  propertySlug: slug,
  fromDate: today(),
  toDate: addDays(today(), 2),
  partySize: 2,
  password: 'an entirely ordinary passphrase',
  confirmPassword: 'an entirely ordinary passphrase',
  acceptedTerms: true,
  ...overrides,
})

describe('the storefronts a direct customer may book through', () => {
  it('lists active properties and only what is public about them', async () => {
    const t = await createTenant()
    const open = await listDirectStorefronts()

    expect(open.map((p) => p.slug)).toContain(await slugOf(t.propertyId))
    expect(Object.keys(open[0] ?? {}).sort()).toEqual([
      'currency',
      'name',
      'placeName',
      'slug',
      'tagline',
    ])
  })

  it('leaves out a property that is not active', async () => {
    const t = await createTenant()
    await prisma.property.update({
      where: { id: t.propertyId },
      data: { status: EntityStatus.DRAFT },
    })
    expect((await listDirectStorefronts()).map((p) => p.slug)).not.toContain(
      await slugOf(t.propertyId),
    )
  })
})

describe('somebody signing up with no hotel booking', () => {
  it('creates an account, a guest record and a trip that is not a room booking', async () => {
    const t = await createTenant()
    const result = await registerDirectTrip(signUp(await slugOf(t.propertyId)))

    const stay = await prisma.stay.findUniqueOrThrow({ where: { id: result.stayId } })
    expect(stay.kind).toBe(StayKind.DIRECT)
    expect(stay.status).toBe(StayStatus.BOOKED)
    expect(stay.roomTypeId).toBeNull()
    expect(stay.roomRevenueMinor).toBe(0)

    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } })
    expect(user.passwordHash).not.toBeNull()

    const guest = await prisma.guest.findUniqueOrThrow({ where: { id: result.guestId } })
    expect(guest.userId).toBe(result.userId)
    expect(guest.propertyId).toBe(t.propertyId)
    expect(guest.partySize).toBe(2)
  })

  it('hands back a portal token that the guest surface accepts', async () => {
    const t = await createTenant()
    const result = await registerDirectTrip(signUp(await slugOf(t.propertyId)))

    const context = await resolvePortalContext(result.portalToken)
    expect(context.stayId).toBe(result.stayId)
    expect(context.propertyId).toBe(t.propertyId)
  })

  it('lets them buy an experience through the path a room guest uses', async () => {
    const t = await createTenant()
    const result = await registerDirectTrip(signUp(await slugOf(t.propertyId)))

    const cartId = await getOrCreateCart({
      organizationId: t.organizationId,
      propertyId: t.propertyId,
      guestId: result.guestId,
      stayId: result.stayId,
      currency: 'MXN',
    })
    await addToCart({ cartId, slotId: t.slotId, quantity: 2 })

    const order = await checkout({
      cartId,
      guestId: result.guestId,
      idempotencyKey: 'direct-trip-1',
    })

    const written = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } })
    expect(written.stayId).toBe(result.stayId)
    expect(written.propertyId).toBe(t.propertyId)
    // The hotel earns on it: the listing, the price and the agreement are
    // theirs, and the storefront is what was bought from (ADR-042).
    expect(written.hotelEarningsMinor).toBeGreaterThan(0)
  })

  it('shows up on the person’s own account as a trip, not a stay', async () => {
    const t = await createTenant()
    const result = await registerDirectTrip(signUp(await slugOf(t.propertyId)))

    const account = await getGuestAccount(result.userId)
    expect(account?.stays).toHaveLength(1)
    expect(account?.stays[0]?.kind).toBe(StayKind.DIRECT)
    expect(account?.stays[0]?.portalPath).toBe(`/g/${result.portalToken}`)
  })

  it('refuses a first day that has already gone', async () => {
    const t = await createTenant()
    await expectCode(
      registerDirectTrip(signUp(await slugOf(t.propertyId), { fromDate: addDays(today(), -1) })),
      'VALIDATION_FAILED',
    )
  })

  it('refuses a window longer than the planner can reason about', async () => {
    const t = await createTenant()
    await expectCode(
      registerDirectTrip(
        signUp(await slugOf(t.propertyId), {
          toDate: addDays(today(), MAX_DIRECT_TRIP_DAYS + 1),
        }),
      ),
      'VALIDATION_FAILED',
    )
  })

  it('refuses a trip more than a year out', async () => {
    const t = await createTenant()
    await expectCode(
      registerDirectTrip(
        signUp(await slugOf(t.propertyId), {
          fromDate: addDays(today(), 400),
          toDate: addDays(today(), 402),
        }),
      ),
      'VALIDATION_FAILED',
    )
  })

  it('refuses a last day before the first', async () => {
    const t = await createTenant()
    // A schema `refine`, so a `ZodError` — which `toFormState` turns into a
    // field error at the app edge rather than an `AppError`.
    await expect(
      registerDirectTrip(
        signUp(await slugOf(t.propertyId), {
          fromDate: addDays(today(), 5),
          toDate: addDays(today(), 2),
        }),
      ),
    ).rejects.toThrow(/cannot be before the first/)
  })

  it('refuses a property that is not taking bookings', async () => {
    await createTenant()
    await expectCode(registerDirectTrip(signUp('not-a-property')), 'NOT_FOUND')
  })

  it('refuses an address that already has an account somebody holds', async () => {
    const t = await createTenant()
    const slug = await slugOf(t.propertyId)
    await prisma.user.create({
      data: {
        email: 'sam@example.com',
        name: 'Someone Else',
        passwordHash: await hashPassword('a completely different passphrase'),
      },
    })

    await expectCode(registerDirectTrip(signUp(slug)), 'CONFLICT')
  })

  it('takes over the passwordless placeholder a front desk once made', async () => {
    const t = await createTenant()
    const slug = await slugOf(t.propertyId)
    const placeholder = await prisma.user.create({
      data: { email: 'sam@example.com', name: 'Sam O' },
      select: { id: true },
    })

    const result = await registerDirectTrip(signUp(slug))

    expect(result.userId).toBe(placeholder.id)
    const user = await prisma.user.findUniqueOrThrow({ where: { id: placeholder.id } })
    expect(user.passwordHash).not.toBeNull()
  })

  it('bounds sign-ups per caller', async () => {
    const t = await createTenant()
    const slug = await slugOf(t.propertyId)

    for (let i = 0; i < 5; i += 1) {
      await registerDirectTrip(signUp(slug, { email: `sam+${String(i)}@example.com` }), {
        clientKey: '198.51.100.9',
      })
    }

    await expectCode(
      registerDirectTrip(signUp(slug, { email: 'sam+last@example.com' }), {
        clientKey: '198.51.100.9',
      }),
      'RATE_LIMITED',
    )
  })

  it('records the trip in the audit trail without the person’s dates', async () => {
    const t = await createTenant()
    const result = await registerDirectTrip(signUp(await slugOf(t.propertyId)))

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { entityType: 'Stay', entityId: result.stayId, action: 'guest.trip.created' },
    })
    expect(JSON.stringify(audit.metadataJson ?? {})).not.toContain(result.fromDate)
  })
})

describe('the database’s own guard', () => {
  it('refuses a direct trip that carries room revenue', async () => {
    const t = await createTenant()
    const result = await registerDirectTrip(signUp(await slugOf(t.propertyId)))

    await expect(
      prisma.stay.update({
        where: { id: result.stayId },
        data: { roomRevenueMinor: 1 },
      }),
    ).rejects.toThrow(/direct_stay_has_no_room/)
  })

  it('refuses a direct trip that carries a room type', async () => {
    const t = await createTenant()
    const result = await registerDirectTrip(signUp(await slugOf(t.propertyId)))
    const roomType = await prisma.roomType.findFirst({ where: { propertyId: t.propertyId } })

    if (roomType) {
      await expect(
        prisma.stay.update({ where: { id: result.stayId }, data: { roomTypeId: roomType.id } }),
      ).rejects.toThrow(/direct_stay_has_no_room/)
    }
  })
})

describe('what the hotel sees', () => {
  it('does not list a direct trip as an arrival', async () => {
    const t = await createTenant()
    await registerDirectTrip(signUp(await slugOf(t.propertyId)))

    const arrivals = await listArrivals(await actorFor(t.ownerUserId), t.propertyId, {
      fromDate: new Date(`${today()}T00:00:00.000Z`),
      days: 7,
    })
    const kinds = await prisma.stay.findMany({
      where: { id: { in: arrivals.map((a) => a.id) } },
      select: { kind: true },
    })
    expect(kinds.every((k) => k.kind === StayKind.HOTEL_RESERVATION)).toBe(true)
  })

  it('counts direct bookings beside the per-stay figure and never inside it', async () => {
    const t = await createTenant()
    const result = await registerDirectTrip(signUp(await slugOf(t.propertyId)))

    const cartId = await getOrCreateCart({
      organizationId: t.organizationId,
      propertyId: t.propertyId,
      guestId: result.guestId,
      stayId: result.stayId,
      currency: 'MXN',
    })
    await addToCart({ cartId, slotId: t.slotId, quantity: 1 })
    await checkout({ cartId, guestId: result.guestId, idempotencyKey: 'direct-revenue-1' })

    const report = await getRevenueAnalytics(await actorFor(t.ownerUserId), t.propertyId)

    expect(report.direct.tripCount).toBe(1)
    expect(report.direct.orderCount).toBe(1)
    expect(report.direct.hotelMinor).toBeGreaterThan(0)
    // The money is in the totals, because the hotel earned it...
    expect(report.totals.hotelMinor).toBeGreaterThanOrEqual(report.direct.hotelMinor)
    // ...and out of the per-stay figure, because nobody booked a room.
    expect(report.headline.perStayMinor).toBe(0)
    expect(report.headline.totalStays).toBe(0)
    expect(report.headline.derivation).toMatch(/nothing to divide by/i)
  })
})

describe('adding a second trip from an account', () => {
  it('adds one and leaves the first alone', async () => {
    const t = await createTenant()
    const first = await registerDirectTrip(signUp(await slugOf(t.propertyId)))

    const second = await addDirectTripToAccount(first.userId, {
      propertySlug: await slugOf(t.propertyId),
      fromDate: addDays(today(), 10),
      toDate: addDays(today(), 12),
      partySize: 1,
    })

    expect(second.stayId).not.toBe(first.stayId)
    const account = await getGuestAccount(first.userId)
    expect(account?.stays).toHaveLength(2)
    expect(account?.stays.every((s) => s.kind === StayKind.DIRECT)).toBe(true)
  })

  it('works across two hotels, which is why a guest may have two records', async () => {
    const a = await createTenant()
    const b = await createTenant()
    const first = await registerDirectTrip(signUp(await slugOf(a.propertyId)))

    await addDirectTripToAccount(first.userId, {
      propertySlug: await slugOf(b.propertyId),
      fromDate: addDays(today(), 3),
      toDate: addDays(today(), 4),
      partySize: 2,
    })

    const guests = await prisma.guest.findMany({ where: { userId: first.userId } })
    expect(guests).toHaveLength(2)
    expect(new Set(guests.map((g) => g.propertyId))).toEqual(
      new Set([a.propertyId, b.propertyId]),
    )
  })

  it('refuses an account nobody holds', async () => {
    const t = await createTenant()
    const placeholder = await prisma.user.create({
      data: { email: 'placeholder@example.com', name: 'Placeholder' },
      select: { id: true },
    })

    await expectCode(
      addDirectTripToAccount(placeholder.id, {
        propertySlug: await slugOf(t.propertyId),
        fromDate: today(),
        toDate: addDays(today(), 1),
        partySize: 2,
      }),
      'NOT_FOUND',
    )
  })

  it('refuses when this property’s guest record for the address is somebody else’s', async () => {
    const t = await createTenant()
    const slug = await slugOf(t.propertyId)
    const mine = await registerDirectTrip(signUp(slug))

    // Another account takes the guest row over behind our back.
    const stranger = await prisma.user.create({
      data: {
        email: 'stranger@example.com',
        name: 'Stranger',
        passwordHash: await hashPassword('yet another ordinary passphrase'),
      },
      select: { id: true },
    })
    await prisma.guest.update({ where: { id: mine.guestId }, data: { userId: stranger.id } })

    await expectCode(
      addDirectTripToAccount(mine.userId, {
        propertySlug: slug,
        fromDate: addDays(today(), 5),
        toDate: addDays(today(), 6),
        partySize: 2,
      }),
      'CONFLICT',
    )
  })

  it('refuses a window the planner cannot reason about, like the open form', async () => {
    const t = await createTenant()
    const first = await registerDirectTrip(signUp(await slugOf(t.propertyId)))

    await expectCode(
      addDirectTripToAccount(first.userId, {
        propertySlug: await slugOf(t.propertyId),
        fromDate: today(),
        toDate: addDays(today(), MAX_DIRECT_TRIP_DAYS + 5),
        partySize: 2,
      }),
      'VALIDATION_FAILED',
    )
  })
})

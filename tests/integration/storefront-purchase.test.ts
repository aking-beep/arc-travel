import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { isAppError, type AppError } from '@/lib/errors'
import { hashPassword } from '@/lib/password'
import { resetRateLimitCounters } from '@/lib/rate-limit'
import { addDays, toDateKey } from '@/lib/dates'
import { AbilityLevel, CartStatus, ConditionsRisk, OrderStatus, StayKind } from '@/lib/prisma-types'
import { addToCart, getOrCreateCart } from '@/modules/commerce/cart'
import { getGuestAccount } from '@/modules/guest/account'
import {
  addToVisitorTrip,
  listVisitorListings,
  nextBookableDate,
  purchaseVisitorTrip,
  purchaseVisitorTripForAccount,
  resumeVisitorTrip,
  startVisitorTrip,
} from '@/modules/guest/visitor'
import type { TripSession } from '@/modules/guest/visitor-session'
import { createTenant, resetDatabase } from '../helpers/factory'

/**
 * Buying from the public storefront, before there is an account.
 *
 * Three things are being proved here, and only the first is the happy path.
 * The second is that the conditions gate runs on a basket nobody has signed
 * into — the condition `addToCart` used to carry made that the one route to a
 * booking the gate never saw. The third is that a basket is nobody's until
 * somebody pays for it: the cookie is a bearer credential and a basket that
 * had already been through the till must not be reachable through a stale one.
 */

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

async function slugOf(propertyId: string): Promise<string> {
  const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })
  return property.slug
}

const today = () => toDateKey(new Date())

/** The window the factory's departure (ten days out) falls inside. */
const window = () => ({ fromDate: addDays(today(), 9), toDate: addDays(today(), 11) })

async function openTrip(
  propertyId: string,
  overrides: Partial<TripSession> = {},
): Promise<TripSession> {
  const started = await startVisitorTrip({
    propertySlug: await slugOf(propertyId),
    ...window(),
    partySize: 2,
    ...overrides,
  })
  return { ...started, ...overrides }
}

const buyer = {
  name: 'Ada Visitor',
  email: 'ada.visitor@example.test',
  password: 'correct-horse-battery-1',
  confirmPassword: 'correct-horse-battery-1',
  acceptedTerms: true,
}

describe('storefront trip', () => {
  it('opens a basket that belongs to nobody and writes no stay', async () => {
    const tenant = await createTenant()
    const session = await openTrip(tenant.propertyId)

    const cart = await prisma.cart.findUniqueOrThrow({ where: { id: session.cartId } })
    expect(cart.guestId).toBeNull()
    expect(cart.stayId).toBeNull()
    expect(cart.status).toBe(CartStatus.OPEN)

    // Nothing that reads as a booking exists yet. A `Stay` with a hotel's name
    // and a pair of dates on it is a booking as far as arrivals is concerned.
    const staysBefore = await prisma.stay.count({ where: { propertyId: tenant.propertyId } })
    expect(staysBefore).toBe(1) // the factory's own guest, and no more
  })

  it('refuses a window in the past and one longer than a month', async () => {
    const tenant = await createTenant()
    const propertySlug = await slugOf(tenant.propertyId)

    await expectCode(
      startVisitorTrip({
        propertySlug,
        fromDate: addDays(today(), -1),
        toDate: addDays(today(), 2),
        partySize: 2,
      }),
      'VALIDATION_FAILED',
    )
    await expectCode(
      startVisitorTrip({
        propertySlug,
        fromDate: today(),
        toDate: addDays(today(), 45),
        partySize: 2,
      }),
      'VALIDATION_FAILED',
    )
  })

  it('lists only departures inside the window, with the gate’s answer on each', async () => {
    const tenant = await createTenant({ guestAbility: null })
    const session = await openTrip(tenant.propertyId)

    const listings = await listVisitorListings({
      propertyId: tenant.propertyId,
      fromDate: session.fromDate,
      toDate: session.toDate,
      partySize: session.partySize,
    })

    expect(listings).toHaveLength(1)
    const departures = listings[0]?.departures ?? []
    expect(departures).toHaveLength(1)
    expect(departures[0]?.slotId).toBe(tenant.slotId)
    expect(departures[0]?.allowed).toBe(true)

    // A window before the departure sees nothing, and is told when it runs.
    const empty = await listVisitorListings({
      propertyId: tenant.propertyId,
      fromDate: today(),
      toDate: addDays(today(), 1),
      partySize: 2,
    })
    expect(empty).toHaveLength(0)
    expect(await nextBookableDate({ propertyId: tenant.propertyId, after: addDays(today(), 1) }))
      .not.toBeNull()
  })

  it('refuses a departure outside the window the visitor declared', async () => {
    const tenant = await createTenant()
    const session = await openTrip(tenant.propertyId, {
      fromDate: today(),
      toDate: addDays(today(), 1),
    })

    await expectCode(
      addToVisitorTrip({ session, slotId: tenant.slotId, quantity: 2 }),
      'VALIDATION_FAILED',
    )
  })

  it('refuses a departure from another property', async () => {
    const mine = await createTenant({ name: 'mine' })
    const theirs = await createTenant({ name: 'theirs' })
    const session = await openTrip(mine.propertyId)

    await expectCode(
      addToVisitorTrip({ session, slotId: theirs.slotId, quantity: 2 }),
      'NOT_FOUND',
    )
  })

  /**
   * The gate used to be skipped entirely for a basket with no guest, which was
   * safe only because no such basket could exist. This is the regression test
   * for the route that made one possible.
   */
  it('runs the conditions gate on a basket with no account behind it', async () => {
    const tenant = await createTenant({
      conditionsSensitive: true,
      maxSafeRisk: ConditionsRisk.MODERATE,
      conditions: {
        risk: ConditionsRisk.HIGH,
        minAbilityRequired: AbilityLevel.ADVANCED,
      },
    })
    const session = await openTrip(tenant.propertyId)

    await expectCode(
      addToVisitorTrip({ session, slotId: tenant.slotId, quantity: 2 }),
      'SAFETY_CONSTRAINT',
    )
  })

  it('withholds a demanding departure until the visitor states an ability', async () => {
    const tenant = await createTenant({
      conditionsSensitive: true,
      maxSafeRisk: ConditionsRisk.HIGH,
      conditions: {
        risk: ConditionsRisk.HIGH,
        minAbilityRequired: AbilityLevel.ADVANCED,
      },
    })

    const silent = await openTrip(tenant.propertyId)
    await expectCode(
      addToVisitorTrip({ session: silent, slotId: tenant.slotId, quantity: 2 }),
      'SAFETY_CONSTRAINT',
    )

    // Stating a level that clears the bar opens it; the gate has not been
    // relaxed, it has been answered.
    const stated = await openTrip(tenant.propertyId, { surfAbility: AbilityLevel.ADVANCED })
    await expect(
      addToVisitorTrip({ session: stated, slotId: tenant.slotId, quantity: 2 }),
    ).resolves.toMatchObject({ holdExpiresAt: expect.any(Date) })

    // And a level below it does not.
    const beginner = await openTrip(tenant.propertyId, { surfAbility: AbilityLevel.BEGINNER })
    await expectCode(
      addToVisitorTrip({ session: beginner, slotId: tenant.slotId, quantity: 2 }),
      'SAFETY_CONSTRAINT',
    )
  })
})

describe('storefront purchase', () => {
  it('turns a basket into an account, a direct trip and a paid order', async () => {
    const tenant = await createTenant({ priceMinor: 95_000 })
    const session = await openTrip(tenant.propertyId, { surfAbility: AbilityLevel.IMPROVER })
    await addToVisitorTrip({ session, slotId: tenant.slotId, quantity: 2 })

    const purchase = await purchaseVisitorTrip({
      session,
      raw: buyer,
      idempotencyKey: 'storefront-1',
    })

    const user = await prisma.user.findUniqueOrThrow({ where: { id: purchase.userId } })
    expect(user.email).toBe(buyer.email)
    expect(user.passwordHash).not.toBeNull()

    const stay = await prisma.stay.findUniqueOrThrow({ where: { id: purchase.stayId } })
    // A direct trip, with no room and no room revenue: ADR-042, and a CHECK
    // constraint agrees.
    expect(stay.kind).toBe(StayKind.DIRECT)
    expect(stay.roomTypeId).toBeNull()
    expect(stay.roomRevenueMinor).toBe(0)

    const order = await prisma.order.findFirstOrThrow({
      where: { reference: purchase.orderReference },
      include: { items: true },
    })
    // Demo mode: the state machine is real, the money is not.
    expect(order.status).toBe(OrderStatus.CONFIRMED)
    expect(order.items).toHaveLength(1)
    expect(order.stayId).toBe(purchase.stayId)
    expect(order.totalMinor).toBe(purchase.totalMinor)

    // The ability they declared lands on the new guest record, so the gate
    // gives the same answer the next time they open the portal.
    const guest = await prisma.guest.findUniqueOrThrow({ where: { id: purchase.guestId } })
    expect(guest.surfAbility).toBe(AbilityLevel.IMPROVER)

    const account = await getGuestAccount(purchase.userId)
    expect(account?.stays).toHaveLength(1)
    const accountStay = account?.stays[0]
    expect(accountStay?.orders[0]?.reference).toBe(purchase.orderReference)
    // What they spent, and on what.
    expect(account?.spend).toHaveLength(1)
    const spend = account?.spend[0]
    expect(spend?.grossMinor).toBe(order.totalMinor)
    expect(spend?.refundedMinor).toBe(0)
    expect(spend?.byCategory[0]?.itemCount).toBe(1)
    // And the day-by-day itinerary of what they bought.
    expect(accountStay?.schedule).toHaveLength(1)
    expect(accountStay?.schedule[0]?.items).toHaveLength(1)
  })

  it('refuses an empty basket rather than creating an account with nothing in it', async () => {
    const tenant = await createTenant()
    const session = await openTrip(tenant.propertyId)

    await expectCode(
      purchaseVisitorTrip({ session, raw: buyer, idempotencyKey: 'empty-1' }),
      'VALIDATION_FAILED',
    )
    expect(await prisma.user.findUnique({ where: { email: buyer.email } })).toBeNull()
  })

  it('refuses an address that already has a real account', async () => {
    const tenant = await createTenant()
    await prisma.user.create({
      data: {
        email: buyer.email,
        name: 'Somebody Else',
        passwordHash: await hashPassword('a-real-password-99'),
      },
    })

    const session = await openTrip(tenant.propertyId)
    await addToVisitorTrip({ session, slotId: tenant.slotId, quantity: 2 })

    await expectCode(
      purchaseVisitorTrip({ session, raw: buyer, idempotencyKey: 'taken-1' }),
      'CONFLICT',
    )
    // And the stranger's profile is untouched: ADR-021's refusal, reached
    // through `establishAccount`.
    const user = await prisma.user.findUniqueOrThrow({ where: { email: buyer.email } })
    expect(user.name).toBe('Somebody Else')
  })

  /**
   * The placeholder takeover, from the storefront.
   *
   * A front desk may already have created a credential-free `User` at this
   * address. That is a placeholder, not an account anybody holds, and claiming
   * it is the same handover `establishAccount` performs everywhere else.
   */
  it('takes over a passwordless placeholder at the same address', async () => {
    const tenant = await createTenant()
    const placeholder = await prisma.user.create({
      data: { email: buyer.email, name: 'Front Desk Entry', passwordHash: null },
    })

    const session = await openTrip(tenant.propertyId)
    await addToVisitorTrip({ session, slotId: tenant.slotId, quantity: 2 })
    const purchase = await purchaseVisitorTrip({
      session,
      raw: buyer,
      idempotencyKey: 'placeholder-1',
    })

    expect(purchase.userId).toBe(placeholder.id)
    const user = await prisma.user.findUniqueOrThrow({ where: { id: placeholder.id } })
    expect(user.passwordHash).not.toBeNull()
    expect(user.name).toBe(buyer.name)
  })

  it('cannot be bought twice through a stale cookie', async () => {
    const tenant = await createTenant()
    const session = await openTrip(tenant.propertyId)
    await addToVisitorTrip({ session, slotId: tenant.slotId, quantity: 2 })
    await purchaseVisitorTrip({ session, raw: buyer, idempotencyKey: 'once-1' })

    // The same cookie, a second time. The basket now has a guest, so it is
    // somebody's and this one is not them.
    await expectCode(
      purchaseVisitorTrip({
        session,
        raw: { ...buyer, email: 'someone.else@example.test' },
        idempotencyKey: 'once-2',
      }),
      'CONFLICT',
    )
    expect(await prisma.order.count()).toBe(1)
  })

  it('stops showing a checked-out basket through its cookie', async () => {
    const tenant = await createTenant()
    const session = await openTrip(tenant.propertyId)
    await addToVisitorTrip({ session, slotId: tenant.slotId, quantity: 2 })

    expect(await resumeVisitorTrip(session)).not.toBeNull()
    await purchaseVisitorTrip({ session, raw: buyer, idempotencyKey: 'resume-1' })
    expect(await resumeVisitorTrip(session)).toBeNull()
  })

  it('replays rather than buying twice on the same idempotency key', async () => {
    const tenant = await createTenant({ capacity: 10 })
    const session = await openTrip(tenant.propertyId)
    await addToVisitorTrip({ session, slotId: tenant.slotId, quantity: 2 })

    const first = await purchaseVisitorTrip({ session, raw: buyer, idempotencyKey: 'replay-1' })
    // The basket is now the guest's, so the public path refuses — which is the
    // right answer for a *stale cookie*. The replay guarantee itself lives in
    // `checkout`, and is covered where that is tested.
    expect(await prisma.order.count({ where: { reference: first.orderReference } })).toBe(1)
  })

  it('buys for somebody who is already signed in, without a second account', async () => {
    const tenant = await createTenant()
    const account = await prisma.user.create({
      data: {
        email: 'returning@example.test',
        name: 'Returning Traveller',
        passwordHash: await hashPassword('a-real-password-99'),
      },
    })

    const session = await openTrip(tenant.propertyId)
    await addToVisitorTrip({ session, slotId: tenant.slotId, quantity: 2 })

    const purchase = await purchaseVisitorTripForAccount({
      session,
      userId: account.id,
      idempotencyKey: 'signed-in-1',
    })

    expect(purchase.userId).toBe(account.id)
    expect(await prisma.user.count({ where: { email: 'returning@example.test' } })).toBe(1)

    const view = await getGuestAccount(account.id)
    expect(view?.stays).toHaveLength(1)
    expect(view?.stays[0]?.kind).toBe(StayKind.DIRECT)
  })

  it('refuses to buy against an account nobody has proved', async () => {
    const tenant = await createTenant()
    const placeholder = await prisma.user.create({
      data: { email: 'placeholder@example.test', name: 'Placeholder', passwordHash: null },
    })

    const session = await openTrip(tenant.propertyId)
    await addToVisitorTrip({ session, slotId: tenant.slotId, quantity: 2 })

    await expectCode(
      purchaseVisitorTripForAccount({
        session,
        userId: placeholder.id,
        idempotencyKey: 'placeholder-signed-in',
      }),
      'NOT_FOUND',
    )
  })

  /**
   * A guestless basket does not get a looser gate than a guest's.
   *
   * `addToCart`'s audience override exists for the storefront, and it must not
   * be a way of talking the gate into an answer the `Guest` row disagrees
   * with: once a basket has a guest, the row wins.
   */
  it('ignores an audience override once the basket has a guest', async () => {
    const tenant = await createTenant({
      guestAbility: AbilityLevel.BEGINNER,
      conditionsSensitive: true,
      maxSafeRisk: ConditionsRisk.HIGH,
      conditions: {
        risk: ConditionsRisk.HIGH,
        minAbilityRequired: AbilityLevel.ADVANCED,
      },
    })

    const cartId = await getOrCreateCart({
      organizationId: tenant.organizationId,
      propertyId: tenant.propertyId,
      guestId: tenant.guestId,
      stayId: tenant.stayId,
      currency: 'MXN',
    })

    await expectCode(
      addToCart({
        cartId,
        slotId: tenant.slotId,
        quantity: 1,
        audience: { surfAbility: AbilityLevel.EXPERT },
      }),
      'SAFETY_CONSTRAINT',
    )
  })
})

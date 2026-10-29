import { prisma } from '@/lib/db'
import { conflict, invalid, notFound } from '@/lib/errors'
import { hashPassword } from '@/lib/password'
import { toDateKey, toLocalDateKey, type DateKey } from '@/lib/dates'
import {
  type AbilityLevel,
  CartStatus,
  ExperienceStatus,
  Locale,
  SlotStatus,
} from '@/lib/prisma-types'
import { portalToken } from '@/lib/ids'
import { VERIFICATION_STANDING_SELECT, isCurrentlyVerified } from '@/modules/admin/verification'
import {
  assertSlotSuitableForGuest,
  evaluateSlotsForAudience,
} from '@/modules/destination/suitability'
import { addToCart, getCartView, removeFromCart, type CartView } from '@/modules/commerce/cart'
import { checkout } from '@/modules/commerce/checkout'
import { recordAudit } from '@/modules/workflows/audit'
import { track } from '@/modules/analytics/track'
import {
  assertWindowIsSensible,
  findDirectProperty,
  guardDirectTrip,
  writeDirectStay,
  type TripWindow,
} from './direct'
import { establishAccount, isSpokenFor, PLACEHOLDER_SELECT, type ClaimableStay } from './account'
import { visitorPurchaseSchema, visitorTripSchema } from './schemas'
import type { TripSession } from './visitor-session'

/**
 * Buying from the public storefront, before there is an account.
 *
 * The property page used to end at a link into a demo portal, which meant the
 * one surface a stranger arrives on could not sell anything: every route into
 * the guest surface started either at a front desk or at a sign-up form. A
 * person who has just read about a hotel and wants to book a surf lesson was
 * asked to create an account first and shop second, which is the wrong way
 * round for somebody who has not yet decided to buy anything.
 *
 * **What this is not.** It is not a second commerce engine, for the reason
 * `./direct.ts` gives about itself. The basket is a `Cart`, the holds are the
 * inventory module's, the gate is the conditions gate and the purchase is
 * `checkout()`. What is new is only that the basket is filled before the
 * person is known, and that the account, the trip and the order are written in
 * that order at the till.
 *
 * **Three things it must get right.**
 *
 *   1. **The gate still runs.** `addToCart` gated only when the basket had a
 *      guest behind it, which was true of every basket that could then exist.
 *      A guestless basket is gated as somebody who has stated no ability, and
 *      every line is gated again at the till once the person is known — a
 *      returning guest may have an ability on file that the anonymous basket
 *      could not know about.
 *   2. **Nothing is written until the person commits.** A half-filled basket
 *      is a `Cart` and a signed cookie, not a `Stay`. A `Stay` with a hotel's
 *      name and a pair of dates on it is a booking as far as the arrivals
 *      board is concerned.
 *   3. **The account is the one that already exists.** The address may belong
 *      to a placeholder a front desk created, which is theirs to take over, or
 *      to a real account, which is not. `establishAccount` is where that
 *      judgement lives and this path hands over to it rather than deciding
 *      again.
 */

export interface VisitorProperty {
  id: string
  organizationId: string
  slug: string
  name: string
  currency: string
}

export interface VisitorTripStart extends TripSession {
  property: VisitorProperty
}

/**
 * Opens a basket for a declared trip window.
 *
 * The window is checked by the same function the direct sign-up uses, so a
 * date in the past or a trip longer than a month is refused here rather than
 * at the till, where the person has already filled a basket.
 */
export async function startVisitorTrip(
  raw: unknown,
  options: { now?: Date } = {},
): Promise<VisitorTripStart> {
  const input = visitorTripSchema.parse(raw)
  const now = options.now ?? new Date()

  const property = await findDirectProperty(input.propertySlug)
  assertWindowIsSensible(
    { fromDate: input.fromDate, toDate: input.toDate, partySize: input.partySize },
    now,
  )

  const cart = await prisma.cart.create({
    data: {
      organizationId: property.organizationId,
      propertyId: property.id,
      // No guest and no stay: nobody has said who they are yet, and a trip
      // they may abandon is not a booking.
      guestId: null,
      stayId: null,
      status: CartStatus.OPEN,
      currency: property.currency,
    },
    select: { id: true },
  })

  return {
    cartId: cart.id,
    propertySlug: input.propertySlug,
    fromDate: input.fromDate,
    toDate: input.toDate,
    partySize: input.partySize,
    surfAbility: input.surfAbility,
    property: { ...property, slug: input.propertySlug },
  }
}

export interface VisitorTrip {
  session: TripSession
  property: VisitorProperty & { placeName: string | null; checkInTime: string }
  cart: CartView
  nights: number
}

/**
 * The basket behind a cookie, or null when it no longer stands.
 *
 * Null rather than a throw for every way it can stop standing — checked out,
 * expired, or a cart id that does not exist — because the caller's answer to
 * all three is the same: start again. The property is re-read from the slug
 * rather than trusted from the cookie, and the basket has to belong to it.
 */
export async function resumeVisitorTrip(
  session: TripSession | null,
  options: { now?: Date } = {},
): Promise<VisitorTrip | null> {
  if (!session) return null
  const now = options.now ?? new Date()

  const property = await prisma.property.findFirst({
    where: { slug: session.propertySlug, status: 'ACTIVE' },
    select: {
      id: true,
      organizationId: true,
      slug: true,
      name: true,
      currency: true,
      checkInTime: true,
      place: { select: { name: true } },
    },
  })
  if (!property) return null

  const cart = await prisma.cart.findUnique({
    where: { id: session.cartId },
    select: { id: true, status: true, propertyId: true, guestId: true },
  })
  if (!cart) return null
  if (cart.status !== CartStatus.OPEN) return null
  if (cart.propertyId !== property.id) return null
  // A basket that has acquired a guest has been through the till. Whoever is
  // holding this cookie is not necessarily that guest.
  if (cart.guestId !== null) return null

  const view = await getCartView(cart.id, now)
  if (!view) return null

  return {
    session,
    property: {
      id: property.id,
      organizationId: property.organizationId,
      slug: property.slug,
      name: property.name,
      currency: property.currency,
      placeName: property.place?.name ?? null,
      checkInTime: property.checkInTime,
    },
    cart: view,
    nights: Math.max(0, daysApart(session.fromDate, session.toDate)),
  }
}

function daysApart(from: DateKey, to: DateKey): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

export interface VisitorDeparture {
  slotId: string
  startsAt: Date
  dateKey: DateKey
  capacityRemaining: number
  /** False when the conditions gate refuses it; the reason travels with it. */
  allowed: boolean
  /** Caveats, true of an allowed departure as well. */
  notes: string[]
  /** Why it was refused. Empty when it was not. */
  blockers: string[]
}

export interface VisitorListing {
  experienceId: string
  slug: string
  title: string
  summary: string | null
  category: string
  durationMinutes: number
  minParty: number
  maxParty: number
  meetingPoint: string | null
  imageUrl: string | null
  supplierName: string
  /** The live answer, never the stored column. See ADR-036. */
  supplierVerified: boolean
  unitPriceMinor: number
  bookingFeeMinor: number
  currency: string
  departures: VisitorDeparture[]
}

/**
 * What a visitor may actually book inside their own trip window.
 *
 * Every departure carries the gate's answer rather than being filtered out by
 * it. A beginner who can see the advanced-only session listed and is told why
 * it is closed to them has been given a reason; the same session silently
 * absent reads as a bug, and the next thing they do is ring the hotel.
 */
export async function listVisitorListings(options: {
  propertyId: string
  fromDate: DateKey
  toDate: DateKey
  partySize: number
  /** What they told us about themselves, or null if they declined to. */
  surfAbility?: AbilityLevel | null
  now?: Date
}): Promise<VisitorListing[]> {
  const now = options.now ?? new Date()
  // Never offer a departure that has already started, even on today's date.
  const from = new Date(`${options.fromDate}T00:00:00`)
  const windowStart = from.getTime() > now.getTime() ? from : now
  const to = new Date(`${options.toDate}T23:59:59`)
  if (to.getTime() <= windowStart.getTime()) return []

  const experiences = await prisma.experience.findMany({
    where: { propertyId: options.propertyId, status: ExperienceStatus.PUBLISHED },
    orderBy: [{ category: 'asc' }, { titleEn: 'asc' }],
    select: {
      id: true,
      slug: true,
      titleEn: true,
      summaryEn: true,
      category: true,
      durationMinutes: true,
      minParty: true,
      maxParty: true,
      meetingPoint: true,
      imageUrl: true,
      supplier: { select: { name: true, ...VERIFICATION_STANDING_SELECT } },
      prices: {
        where: { isActive: true },
        orderBy: [{ minParty: 'asc' }],
        select: { amountMinor: true, bookingFeeMinor: true, currency: true, minParty: true },
      },
      slots: {
        where: {
          startsAt: { gte: windowStart, lte: to },
          status: { in: [SlotStatus.OPEN, SlotStatus.FULL] },
        },
        orderBy: { startsAt: 'asc' },
        take: 40,
        select: { id: true, startsAt: true, capacity: true, booked: true, held: true },
      },
    },
  })

  const slotIds = experiences.flatMap((e) => e.slots.map((s) => s.id))
  const suitability = await evaluateSlotsForAudience({
    // Their own declaration, or null — which is the gate's strict case, not a
    // relaxation of it (ADR-017).
    audience: { propertyId: options.propertyId, surfAbility: options.surfAbility ?? null },
    slotIds,
    now,
  })

  const listings: VisitorListing[] = []
  for (const experience of experiences) {
    // An unpriced listing is not a listing, for the reason `discovery/live.ts`
    // gives: "price on request" from a product holding the price list is a
    // worse answer than absence.
    const price = experience.prices.find((p) => p.minParty <= options.partySize)
    if (!price) continue
    if (experience.slots.length === 0) continue

    listings.push({
      experienceId: experience.id,
      slug: experience.slug,
      title: experience.titleEn,
      summary: experience.summaryEn,
      category: experience.category,
      durationMinutes: experience.durationMinutes,
      minParty: experience.minParty,
      maxParty: experience.maxParty,
      meetingPoint: experience.meetingPoint,
      imageUrl: experience.imageUrl,
      supplierName: experience.supplier.name,
      supplierVerified: isCurrentlyVerified(experience.supplier, now),
      unitPriceMinor: price.amountMinor,
      bookingFeeMinor: price.bookingFeeMinor,
      currency: price.currency,
      departures: experience.slots.map((slot) => {
        const verdict = suitability.get(slot.id)
        return {
          slotId: slot.id,
          startsAt: slot.startsAt,
          dateKey: toLocalDateKey(slot.startsAt),
          capacityRemaining: Math.max(0, slot.capacity - slot.booked - slot.held),
          allowed: verdict?.allowed ?? false,
          notes: verdict?.notes ?? [],
          blockers: verdict?.blockers ?? [],
        }
      }),
    })
  }

  return listings
}

/**
 * The next day this property has anything running, after a given day.
 *
 * Only asked when the chosen window came back empty. "Nothing runs on those
 * days" on its own leaves somebody guessing which days do, and the catalogue
 * is the only thing that knows — the seeded horizon is three weeks, a real one
 * would be whatever the partners have published.
 */
export async function nextBookableDate(options: {
  propertyId: string
  after: DateKey
  now?: Date
}): Promise<DateKey | null> {
  const now = options.now ?? new Date()
  const from = new Date(`${options.after}T23:59:59`)
  const slot = await prisma.availabilitySlot.findFirst({
    where: {
      status: SlotStatus.OPEN,
      startsAt: { gt: from.getTime() > now.getTime() ? from : now },
      experience: {
        propertyId: options.propertyId,
        status: ExperienceStatus.PUBLISHED,
      },
    },
    orderBy: { startsAt: 'asc' },
    select: { startsAt: true },
  })
  return slot ? toLocalDateKey(slot.startsAt) : null
}

/**
 * Adds a departure to a basket nobody has signed into yet.
 *
 * The basket is re-read and re-checked rather than trusted from the cookie:
 * the cookie proves which basket, and this proves the basket is still open,
 * still this property's and still nobody's.
 */
export async function addToVisitorTrip(options: {
  session: TripSession
  slotId: string
  quantity: number
  now?: Date
}): Promise<{ holdExpiresAt: Date }> {
  const trip = await assertOpenVisitorCart(options.session)

  const slot = await prisma.availabilitySlot.findUnique({
    where: { id: options.slotId },
    select: { startsAt: true },
  })
  if (!slot) throw notFound('Departure')

  /*
   * Inside the window the person declared.
   *
   * Not a safety rule — the conditions gate is — but a correctness one: the
   * trip window becomes the `Stay`'s dates at the till, and a booking outside
   * its own stay would put a departure on an itinerary that has no day for it,
   * and on an arrivals board for a trip that had ended.
   */
  const day = toLocalDateKey(slot.startsAt)
  if (day < options.session.fromDate || day > options.session.toDate) {
    throw invalid('That departure is outside the dates you gave. Change your dates to book it.')
  }

  return addToCart({
    cartId: trip.cartId,
    slotId: options.slotId,
    quantity: options.quantity,
    audience: { surfAbility: options.session.surfAbility },
    now: options.now,
  })
}

export async function removeFromVisitorTrip(options: {
  session: TripSession
  slotId: string
}): Promise<void> {
  const trip = await assertOpenVisitorCart(options.session)
  await removeFromCart({ cartId: trip.cartId, slotId: options.slotId })
}

async function assertOpenVisitorCart(
  session: TripSession,
): Promise<{ cartId: string; propertyId: string; organizationId: string }> {
  const cart = await prisma.cart.findUnique({
    where: { id: session.cartId },
    select: { id: true, status: true, guestId: true, propertyId: true, organizationId: true },
  })
  if (!cart) throw notFound('Basket')
  if (cart.status !== CartStatus.OPEN) throw conflict('This basket has already been checked out.')
  if (cart.guestId !== null) throw conflict('This basket already belongs to an account.')
  return { cartId: cart.id, propertyId: cart.propertyId, organizationId: cart.organizationId }
}

export interface VisitorPurchase {
  userId: string
  guestId: string
  stayId: string
  stayReference: string
  orderReference: string
  totalMinor: number
  currency: string
  portalToken: string
  portalExpiresOn: DateKey
  propertyName: string
}

/**
 * The till: an account, a trip and a paid order, in that order.
 *
 * The account and the trip are one transaction because an account with nothing
 * to look at is a dead end the person cannot fix themselves — the reason both
 * sign-up paths give. The order is deliberately *outside* it: `checkout()`
 * opens its own Serializable transaction, takes holds and writes a ledger, and
 * nesting that inside a longer one would hold it open across a password hash
 * and widen every serialization conflict in the inventory module.
 *
 * If the gate refuses a line here, the person keeps the account and the trip
 * and is told which departure was refused. That is recoverable by them; a
 * refusal that also threw away the account they just created would not be.
 */
export async function purchaseVisitorTrip(options: {
  session: TripSession
  raw: unknown
  idempotencyKey: string
  clientKey?: string | null
  now?: Date
}): Promise<VisitorPurchase> {
  const input = visitorPurchaseSchema.parse(options.raw)
  const now = options.now ?? new Date()

  const property = await findDirectProperty(options.session.propertySlug)
  const window: TripWindow = {
    fromDate: options.session.fromDate,
    toDate: options.session.toDate,
    partySize: options.session.partySize,
  }
  assertWindowIsSensible(window, now)
  await guardDirectTrip({ clientKey: options.clientKey, propertyId: property.id, now })

  const cart = await prisma.cart.findUnique({
    where: { id: options.session.cartId },
    select: {
      id: true,
      status: true,
      guestId: true,
      propertyId: true,
      items: { select: { slotId: true } },
    },
  })
  if (!cart) throw notFound('Basket')
  if (cart.propertyId !== property.id) throw notFound('Basket')
  if (cart.status !== CartStatus.OPEN) throw conflict('This basket has already been checked out.')
  if (cart.guestId !== null) throw conflict('This basket already belongs to an account.')
  if (cart.items.length === 0) {
    throw invalid('Your trip is empty. Add something to it before you pay.')
  }

  /*
   * Read for a readable message, and again inside the transaction, which is
   * what makes it safe. A placeholder at this address is theirs to take over;
   * a real account is not.
   */
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: PLACEHOLDER_SELECT,
  })
  if (existing && isSpokenFor(existing)) {
    throw conflict(
      'That email already has an ARC account. Sign in first, and your trip comes with you.',
    )
  }

  const passwordHash = await hashPassword(input.password)
  const token = portalToken()

  const created = await prisma.$transaction(async (tx) => {
    const trip = await writeDirectStay(
      tx,
      property,
      {
        name: input.name,
        email: input.email,
        locale: Locale.EN,
        surfAbility: options.session.surfAbility,
      },
      window,
      token,
    )

    const claimable: ClaimableStay = {
      id: trip.stayId,
      guestId: trip.guestId,
      organizationId: trip.organizationId,
      guestEmail: input.email,
      guestUser: null,
    }
    const userId = await establishAccount(
      tx,
      claimable,
      { name: input.name, email: input.email, passwordHash },
      ['storefrontPurchase'],
      true,
    )

    /*
     * The basket becomes theirs.
     *
     * Conditional on it still being nobody's: two tabs at the same till would
     * otherwise each create an account and the second would take over a basket
     * the first is already checking out. `updateMany` with the predicate in
     * the `where` clause rather than a check above it, for the reason
     * `CLAUDE.md` gives about re-reading inside the transaction.
     */
    const claimed = await tx.cart.updateMany({
      where: { id: cart.id, status: CartStatus.OPEN, guestId: null },
      data: { guestId: trip.guestId, stayId: trip.stayId },
    })
    if (claimed.count !== 1) {
      throw conflict('This basket has already been checked out.')
    }

    await recordAudit(
      {
        organizationId: property.organizationId,
        actor: {
          userId,
          email: input.email,
          name: input.name,
          isPlatformAdmin: false,
          memberships: [],
        },
        actorKind: 'guest',
        action: 'guest.storefront.purchase_started',
        entityType: 'Stay',
        entityId: trip.stayId,
        // Field names over values: the dates and the party size are this
        // person's data, and the trail needs that a storefront trip was made.
        metadata: { fields: ['fromDate', 'toDate', 'partySize'], cartId: cart.id },
      },
      tx,
    )

    return { ...trip, userId }
  })

  /*
   * The gate, again, now that we know who is asking.
   *
   * The basket was gated as somebody who had stated no ability, which is the
   * conservative answer. A *returning* person — one who stayed here before and
   * told a front desk they are a beginner — has an ability on file that the
   * anonymous basket could not read, and the whole point of the gate is that
   * the stricter answer wins. Before the money moves, not after.
   */
  for (const item of cart.items) {
    await assertSlotSuitableForGuest({ guestId: created.guestId, slotId: item.slotId, now })
  }

  const order = await checkout({
    cartId: cart.id,
    guestId: created.guestId,
    idempotencyKey: options.idempotencyKey,
    now,
  })

  await track({
    organizationId: property.organizationId,
    propertyId: property.id,
    name: 'guest.storefront.purchased',
    surface: 'guest',
    subject: created.userId,
    properties: { items: order.itemCount },
  })

  return {
    userId: created.userId,
    guestId: created.guestId,
    stayId: created.stayId,
    stayReference: created.reference,
    orderReference: order.reference,
    totalMinor: order.totalMinor,
    currency: order.currency,
    portalToken: token,
    portalExpiresOn: created.portalExpiresOn,
    propertyName: property.name,
  }
}

/**
 * The same purchase for somebody who is already signed in.
 *
 * A person with an account who fills a storefront basket must not be asked to
 * make a second one, and must not have their basket silently dropped at the
 * till. This writes the trip against their existing account instead.
 */
export async function purchaseVisitorTripForAccount(options: {
  session: TripSession
  userId: string
  idempotencyKey: string
  now?: Date
}): Promise<VisitorPurchase> {
  const now = options.now ?? new Date()

  const account = await prisma.user.findUnique({
    where: { id: options.userId },
    select: { id: true, email: true, name: true, passwordHash: true },
  })
  if (!account) throw notFound('Account')
  /*
   * A passwordless row is a placeholder, not an account anybody holds — the
   * same refusal `addDirectTripToAccount` makes. Nobody should be able to buy
   * against an identity they have not proved.
   */
  if (!account.passwordHash) throw notFound('Account')

  const property = await findDirectProperty(options.session.propertySlug)
  const window: TripWindow = {
    fromDate: options.session.fromDate,
    toDate: options.session.toDate,
    partySize: options.session.partySize,
  }
  assertWindowIsSensible(window, now)

  const cart = await prisma.cart.findUnique({
    where: { id: options.session.cartId },
    select: {
      id: true,
      status: true,
      guestId: true,
      propertyId: true,
      items: { select: { slotId: true } },
    },
  })
  if (!cart) throw notFound('Basket')
  if (cart.propertyId !== property.id) throw notFound('Basket')
  if (cart.status !== CartStatus.OPEN) throw conflict('This basket has already been checked out.')
  if (cart.guestId !== null) throw conflict('This basket already belongs to an account.')
  if (cart.items.length === 0) {
    throw invalid('Your trip is empty. Add something to it before you pay.')
  }

  const token = portalToken()

  const created = await prisma.$transaction(async (tx) => {
    const trip = await writeDirectStay(
      tx,
      property,
      {
        name: account.name,
        email: account.email,
        locale: Locale.EN,
        surfAbility: options.session.surfAbility,
      },
      window,
      token,
    )

    // The guest row at this property may predate the account; link it so the
    // trip shows up under `/me`. ADR-039: a `Guest` is a person at one
    // property, the account is the person.
    await tx.guest.update({ where: { id: trip.guestId }, data: { userId: account.id } })

    const claimed = await tx.cart.updateMany({
      where: { id: cart.id, status: CartStatus.OPEN, guestId: null },
      data: { guestId: trip.guestId, stayId: trip.stayId },
    })
    if (claimed.count !== 1) {
      throw conflict('This basket has already been checked out.')
    }

    await recordAudit(
      {
        organizationId: property.organizationId,
        actor: {
          userId: account.id,
          email: account.email,
          name: account.name,
          isPlatformAdmin: false,
          memberships: [],
        },
        actorKind: 'guest',
        action: 'guest.storefront.purchase_started',
        entityType: 'Stay',
        entityId: trip.stayId,
        metadata: { fields: ['fromDate', 'toDate', 'partySize'], cartId: cart.id },
      },
      tx,
    )

    return trip
  })

  for (const item of cart.items) {
    await assertSlotSuitableForGuest({ guestId: created.guestId, slotId: item.slotId, now })
  }

  const order = await checkout({
    cartId: cart.id,
    guestId: created.guestId,
    idempotencyKey: options.idempotencyKey,
    now,
  })

  await track({
    organizationId: property.organizationId,
    propertyId: property.id,
    name: 'guest.storefront.purchased',
    surface: 'guest',
    subject: account.id,
    properties: { items: order.itemCount },
  })

  return {
    userId: account.id,
    guestId: created.guestId,
    stayId: created.stayId,
    stayReference: created.reference,
    orderReference: order.reference,
    totalMinor: order.totalMinor,
    currency: order.currency,
    portalToken: token,
    portalExpiresOn: created.portalExpiresOn,
    propertyName: property.name,
  }
}

/** Today in the destination's own days, for a server-computed form default. */
export const todayKey = (now = new Date()): DateKey => toDateKey(now)

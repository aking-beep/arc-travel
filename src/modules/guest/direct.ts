import { prisma, type Prisma } from '@/lib/db'
import { conflict, invalid, notFound } from '@/lib/errors'
import { hashPassword } from '@/lib/password'
import { assertWithinRateLimit, rateLimitSubject } from '@/lib/rate-limit'
import { addDays, daysBetween, fromDateKey, toDateKey, type DateKey } from '@/lib/dates'
import { type AbilityLevel, EntityStatus, Locale, StayKind, StayStatus } from '@/lib/prisma-types'
import { portalToken, stayReference } from '@/lib/ids'
import { recordAudit } from '@/modules/workflows/audit'
import { track } from '@/modules/analytics/track'
import {
  establishAccount,
  isSpokenFor,
  PLACEHOLDER_SELECT,
  type ClaimableStay,
} from './account'
import { PORTAL_GRACE_DAYS } from './portal'
import { additionalTripSchema, directTripSchema } from './schemas'

/**
 * The direct consumer: somebody who wants to book experiences and is not a
 * hotel's guest.
 *
 * Until this existed, every route into the guest surface started at a front
 * desk. A `Stay` was the only thing that carried a portal token, and a `Stay`
 * was created by a hotel for a room it had sold — so a resident of Puerto
 * Escondido, a day visitor off a bus, or somebody staying in an apartment
 * could not buy a surf lesson through ARC Stay at all. That is most of the
 * people in the town on any given day.
 *
 * **What this is not.** It is not a second commerce engine. A direct trip is a
 * `Stay` with `kind = DIRECT`: the same dates, the same party size, the same
 * portal token, so the itinerary generator, the conditions gate, the basket,
 * the holds and checkout are the ones that already exist and are already
 * tested. The alternative — making `Cart.stayId` and `Order.stayId` optional —
 * would have put a second code path through every one of those, and the first
 * one to diverge would have been the safety gate.
 *
 * **What it must never do** is read as a room booking. `direct_stay_has_no_room`
 * forbids a room type or room revenue on one, and the surfaces that mean "a
 * person arriving at this hotel" — arrivals, the morning briefing, occupancy,
 * room revenue — filter on `kind`. A front desk acting on a room nobody booked
 * is the failure this is shaped to prevent. See ADR-042.
 *
 * **The hotel still earns.** The listing, the price and the agreement are the
 * hotel's, and the storefront is what the person bought from, so commission
 * flows exactly as it does for a room guest. No money code changes here.
 */

/** Bounded per caller: a sign-up writes rows into a hotel's data. */
const DIRECT_TRIPS_PER_CALLER = 5
/** And per hotel, so one caller rotating addresses cannot fill a hotel's list. */
const DIRECT_TRIPS_PER_PROPERTY = 60
const DIRECT_TRIP_WINDOW_SECONDS = 3_600

/**
 * The longest trip somebody may declare in one go.
 *
 * Not a commercial rule. The window is what the itinerary and the conditions
 * gate reason over, and a year-long "trip" would ask the generator to plan
 * three hundred days of weather it has no reading for. Somebody who is here
 * longer adds another one.
 */
export const MAX_DIRECT_TRIP_DAYS = 30

export interface DirectStorefront {
  slug: string
  name: string
  tagline: string | null
  placeName: string | null
  currency: string
}

/**
 * The storefronts a person may book through, and nothing else about them.
 *
 * Unauthenticated, so the shape is the whole security argument: a name, a
 * tagline and a place. A hotel's contact details, room count, guest numbers
 * and revenue are not public and are not selected here.
 */
export async function listDirectStorefronts(): Promise<DirectStorefront[]> {
  const properties = await prisma.property.findMany({
    where: { status: EntityStatus.ACTIVE },
    orderBy: { name: 'asc' },
    select: {
      slug: true,
      name: true,
      tagline: true,
      currency: true,
      place: { select: { name: true } },
    },
  })

  return properties.map((p) => ({
    slug: p.slug,
    name: p.name,
    tagline: p.tagline,
    placeName: p.place?.name ?? null,
    currency: p.currency,
  }))
}

export interface TripWindow {
  fromDate: DateKey
  toDate: DateKey
  partySize: number
}

/**
 * Checks the trip window against today, in the destination's own days.
 *
 * `DateKey` comparison rather than `Date` arithmetic: these are calendar days
 * in Puerto Escondido, and a traveller whose phone is on a European clock must
 * not be told their own first day is in the past.
 */
export function assertWindowIsSensible(window: TripWindow, now: Date): void {
  const today = toDateKey(now)

  if (window.fromDate < today) {
    throw invalid('That first day has already passed. Pick today or later.', {
      fromDate: 'This date is in the past.',
    })
  }

  const span = daysBetween(window.fromDate, window.toDate) + 1
  if (span > MAX_DIRECT_TRIP_DAYS) {
    throw invalid(
      `A trip can be up to ${String(MAX_DIRECT_TRIP_DAYS)} days. Add another one for a longer stay.`,
      { toDate: 'That window is too long.' },
    )
  }

  // Far enough ahead that nothing in the catalogue can be planned against it.
  if (window.fromDate > addDays(today, 365)) {
    throw invalid('That is more than a year away. Come back nearer the time.', {
      fromDate: 'Too far ahead.',
    })
  }
}

export async function findDirectProperty(
  slug: string,
): Promise<{ id: string; organizationId: string; name: string; currency: string }> {
  const property = await prisma.property.findFirst({
    where: { slug, status: EntityStatus.ACTIVE },
    select: { id: true, organizationId: true, name: true, currency: true },
  })
  /*
   * A slug that is not an active property is `notFound`, which is what an
   * inactive one gets too. The form offers a fixed list, so a miss here is a
   * stale page or somebody poking at it, and neither needs the difference.
   */
  if (!property) throw notFound('Property')
  return property
}

export async function guardDirectTrip(options: {
  clientKey?: string | null
  propertyId: string
  now: Date
}): Promise<void> {
  if (options.clientKey) {
    await assertWithinRateLimit({
      bucket: `direct-trip:caller:${rateLimitSubject(options.clientKey)}`,
      limit: DIRECT_TRIPS_PER_CALLER,
      windowSeconds: DIRECT_TRIP_WINDOW_SECONDS,
      message: 'Too many sign-ups from here. Try again later.',
      now: options.now,
    })
  }

  await assertWithinRateLimit({
    bucket: `direct-trip:property:${options.propertyId}`,
    limit: DIRECT_TRIPS_PER_PROPERTY,
    windowSeconds: DIRECT_TRIP_WINDOW_SECONDS,
    message: 'This hotel has had a lot of sign-ups in the last hour. Try again shortly.',
    now: options.now,
  })
}

export interface CreatedTrip {
  guestId: string
  stayId: string
  reference: string
  /** Returned once, to the person who just created it. */
  portalToken: string
  organizationId: string
  propertyName: string
  fromDate: DateKey
  toDate: DateKey
  /** Last day the portal link works. */
  portalExpiresOn: DateKey
}

/**
 * Creates the guest record and the direct stay, inside a caller's transaction.
 *
 * The guest is upserted on `(propertyId, email)` exactly as `createStay` does,
 * because a `Guest` is a person *at one property* (ADR-039) and somebody who
 * stayed here in March and is back for a day should keep their preferences and
 * their intake.
 */
export async function writeDirectStay(
  tx: Prisma.TransactionClient,
  property: { id: string; organizationId: string; name: string },
  person: { name: string; email: string; locale: Locale; surfAbility?: AbilityLevel | null },
  window: TripWindow,
  token: string,
): Promise<CreatedTrip> {
  const [firstName, ...rest] = person.name.split(/\s+/)
  const lastName = rest.join(' ')

  const guest = await tx.guest.upsert({
    where: { propertyId_email: { propertyId: property.id, email: person.email } },
    create: {
      organizationId: property.organizationId,
      propertyId: property.id,
      firstName: firstName ?? person.name,
      lastName: lastName || '—',
      email: person.email,
      locale: person.locale,
      partySize: window.partySize,
      surfAbility: person.surfAbility ?? null,
    },
    /*
     * A returning person keeps their intake. Only the party size is this
     * trip's, and only because the basket and the itinerary read it.
     *
     * `surfAbility` is deliberately absent here. A recorded ability is what a
     * front desk or an intake wrote down; a storefront declaration is what
     * somebody typed to unlock a departure, and letting the second overwrite
     * the first would make the safety gate negotiable by whoever is being
     * gated. On a new row there is nothing to overwrite, so it is taken.
     */
    update: { partySize: window.partySize },
    select: { id: true, userId: true, email: true },
  })

  const stay = await tx.stay.create({
    data: {
      organizationId: property.organizationId,
      propertyId: property.id,
      guestId: guest.id,
      kind: StayKind.DIRECT,
      reference: stayReference(),
      checkIn: fromDateKey(window.fromDate),
      checkOut: fromDateKey(window.toDate),
      adults: window.partySize,
      children: 0,
      status: StayStatus.BOOKED,
      // Neither is this trip's to carry, and a CHECK constraint agrees.
      roomTypeId: null,
      roomRevenueMinor: 0,
      portalToken: token,
    },
    select: { id: true, reference: true },
  })

  return {
    guestId: guest.id,
    stayId: stay.id,
    reference: stay.reference,
    portalToken: token,
    organizationId: property.organizationId,
    propertyName: property.name,
    fromDate: window.fromDate,
    toDate: window.toDate,
    portalExpiresOn: addDays(window.toDate, PORTAL_GRACE_DAYS),
  }
}

export interface DirectRegistrationResult extends CreatedTrip {
  userId: string
}

/**
 * Open sign-up: an account and a first trip, in one submission.
 *
 * The account and the trip are one transaction, for the reason the booking
 * sign-up gives: an account with nothing to look at is a dead end the person
 * cannot fix themselves.
 *
 * Nothing here is claimed against a booking, because there is no booking to
 * claim — which is exactly why the address has to be free. A placeholder a
 * front desk once created for this person at this address is theirs to take
 * over, and `establishAccount` is the one place that judgement lives, so this
 * path hands over to it rather than deciding again.
 *
 * No session is established: a domain module that set a cookie could not be
 * called from a test or a script.
 */
export async function registerDirectTrip(
  raw: unknown,
  options: { clientKey?: string | null; now?: Date } = {},
): Promise<DirectRegistrationResult> {
  const input = directTripSchema.parse(raw)
  const now = options.now ?? new Date()

  const property = await findDirectProperty(input.propertySlug)
  await guardDirectTrip({ clientKey: options.clientKey, propertyId: property.id, now })

  assertWindowIsSensible(
    { fromDate: input.fromDate, toDate: input.toDate, partySize: input.partySize },
    now,
  )

  /*
   * Checked here for a readable message, and again inside the transaction,
   * which is what actually makes it safe.
   */
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: PLACEHOLDER_SELECT,
  })
  if (existing && isSpokenFor(existing)) {
    throw conflict(
      'That email already has an ARC account. Sign in instead, and add this trip from your account.',
    )
  }

  const passwordHash = await hashPassword(input.password)
  const token = portalToken()

  const result = await prisma.$transaction(async (tx) => {
    const trip = await writeDirectStay(
      tx,
      property,
      { name: input.name, email: input.email, locale: Locale.EN },
      { fromDate: input.fromDate, toDate: input.toDate, partySize: input.partySize },
      token,
    )

    // The same handover the booking sign-up performs, including the races it
    // already handles: a password set between the read above and here, and a
    // guest row a concurrent claim won.
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
      ['directTrip'],
      true,
    )

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
        action: 'guest.trip.created',
        entityType: 'Stay',
        entityId: trip.stayId,
        // Field names over values: the dates and party size are this person's
        // data, and what the trail needs is that a direct trip was created.
        metadata: { kind: StayKind.DIRECT, fields: ['fromDate', 'toDate', 'partySize'] },
      },
      tx,
    )

    return { ...trip, userId }
  })

  await track({
    organizationId: property.organizationId,
    propertyId: property.id,
    name: 'guest.direct_trip.created',
    surface: 'guest',
    subject: result.userId,
    properties: { nights: daysBetween(input.fromDate, input.toDate) },
  })

  return result
}

/**
 * A further trip, for somebody who already has an account.
 *
 * The signed-in equivalent of the form above, and the reason `Guest.userId` is
 * not unique (ADR-039): a person who books through two hotels has two guest
 * records, and an account that could hold one of them would show them half
 * their travel.
 */
export async function addDirectTripToAccount(
  userId: string,
  raw: unknown,
  options: { clientKey?: string | null; now?: Date } = {},
): Promise<CreatedTrip> {
  const input = additionalTripSchema.parse(raw)
  const now = options.now ?? new Date()

  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, locale: true, passwordHash: true },
  })
  if (!account) throw notFound('Account')
  /*
   * A passwordless row is a placeholder, not an account anybody holds, and a
   * session on one only exists in demo mode. Letting it write trips would let
   * the demo switcher create rows in a real hotel's data.
   */
  if (!account.passwordHash) throw notFound('Account')

  const property = await findDirectProperty(input.propertySlug)
  await guardDirectTrip({ clientKey: options.clientKey, propertyId: property.id, now })

  assertWindowIsSensible(
    { fromDate: input.fromDate, toDate: input.toDate, partySize: input.partySize },
    now,
  )

  const token = portalToken()

  const trip = await prisma.$transaction(async (tx) => {
    const created = await writeDirectStay(
      tx,
      property,
      { name: account.name, email: account.email, locale: account.locale },
      { fromDate: input.fromDate, toDate: input.toDate, partySize: input.partySize },
      token,
    )

    /*
     * Link the guest record to this account, and only if nobody else holds it.
     *
     * The predicate is in the `where` clause: an upsert above may have found a
     * guest row this property already had for this address, and if that row
     * belongs to somebody else then this trip does not get to take it over —
     * it would hand one person another's intake and bookings.
     */
    const linked = await tx.guest.updateMany({
      where: { id: created.guestId, OR: [{ userId: null }, { userId }] },
      data: { userId },
    })
    if (linked.count !== 1) {
      throw conflict(
        'This property already has a guest record for your email under another account. Ask them to look, or sign in as that account.',
      )
    }

    await recordAudit(
      {
        organizationId: property.organizationId,
        actor: {
          userId,
          email: account.email,
          name: account.name,
          isPlatformAdmin: false,
          memberships: [],
        },
        actorKind: 'guest',
        action: 'guest.trip.created',
        entityType: 'Stay',
        entityId: created.stayId,
        metadata: { kind: StayKind.DIRECT, fields: ['fromDate', 'toDate', 'partySize'] },
      },
      tx,
    )

    return created
  })

  await track({
    organizationId: property.organizationId,
    propertyId: property.id,
    name: 'guest.direct_trip.created',
    surface: 'guest',
    subject: userId,
    properties: { nights: daysBetween(input.fromDate, input.toDate) },
  })

  return trip
}

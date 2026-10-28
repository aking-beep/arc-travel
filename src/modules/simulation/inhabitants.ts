import { prisma } from '@/lib/db'
import { addDays, toDateKey, toLocalDateKey, toLocalTimeString } from '@/lib/dates'
import { getEnv } from '@/lib/env'
import { forbidden, isAppError } from '@/lib/errors'
import type { Prisma } from '@/lib/prisma-types'
import {
  AbilityLevel,
  CartStatus,
  EntityStatus,
  ExperienceCategory,
  ExperienceStatus,
  OrderItemStatus,
  Role,
  Pace,
  SimulatedActivityKind,
  SlotStatus,
  StayKind,
  StayStatus,
} from '@/lib/prisma-types'
import { addToCart, getOrCreateCart } from '@/modules/commerce/cart'
import { cancelOrderItem, checkout } from '@/modules/commerce/checkout'
import { registerDirectTrip } from '@/modules/guest/direct'
import { createStay } from '@/modules/stays/service'
import { saveIntake } from '@/modules/preferences/service'
import { setStayStatus } from '@/modules/stays/service'
import { scheduleAvailability } from '@/modules/suppliers/service'
import { requestToJoinProperty } from '@/modules/suppliers/self-service'
import type { ActorContext } from '@/modules/tenancy/context'

/**
 * The inhabitants.
 *
 * `/admin/simulation` shows what simulated people are doing; this is what
 * makes them *there*. While the demo is being used, travellers arrive, baskets
 * fill, seats are bought and given back, businesses ask to work with the
 * hotel, and the front desk checks people in — so an owner opening the
 * briefing sees a morning's worth of a working marketplace rather than a seed.
 *
 * ## Everything goes through the product's own services
 *
 * Not one row is written directly. An arrival is `registerDirectTrip`, a seat
 * is `addToCart` and `checkout`, a cancellation is `cancelOrderItem`. That is
 * the whole point: data inserted behind the services would show an operator
 * something the product itself would never produce — an order whose ledger
 * does not balance, a seat held with no hold, a booking the conditions gate
 * would have refused. It would be a very convincing lie.
 *
 * It is also why this is cheap. Nothing here calls a model; the simulated
 * people have no judgement, they have appetites. The LLM personas next door
 * are the scrutiny layer, and they cost money; this is the population, and it
 * costs nothing.
 *
 * ## What bounds it
 *
 * - **Demo only.** `tick` refuses outside `ARC_DATA_MODE=demo`, and the routes
 *   that call it 404 there.
 * - **Headroom.** Simulated demand never takes the last `RESERVED_SEATS` of a
 *   departure. A demo somebody cannot book anything in is worse than a quiet
 *   one.
 * - **A ceiling on the population.** Past `MAX_SIMULATED_STAYS` the town stops
 *   growing: the existing people carry on buying and cancelling, and nobody
 *   new arrives.
 * - **An address that says what they are.** Every simulated person's email is
 *   at `SIMULATED_DOMAIN`, so they can be told apart from anything a real
 *   person did in the demo, and swept without touching it.
 *
 * See ADR-044.
 */

/** Everything simulated is reachable from this. Never a deliverable address. */
export const SIMULATED_DOMAIN = 'sim.arcstay.demo'

/** Seats a simulated person will never take. The last ones are for a visitor. */
export const RESERVED_SEATS = 2

/** How many simulated trips may exist before the town stops growing. */
export const MAX_SIMULATED_STAYS = 48

/** Days of availability below which the horizon keeper extends it. */
export const MIN_HORIZON_DAYS = 10

export interface TickOptions {
  /** `cron` for the scheduled baseline, `heartbeat` for somebody's open page. */
  source: 'cron' | 'heartbeat'
  /** How many things to attempt. One or two is a town; ten is a stampede. */
  actions?: number
  /**
   * Do this one thing rather than something weighted.
   *
   * For tests, which need a rule exercised rather than a town observed. No
   * caller in the product passes it: a demo whose next event is chosen from
   * outside is a script, and the point of the weights is that it is not one.
   */
  only?: AttemptName
  now?: Date
}

export interface TickAction {
  kind: SimulatedActivityKind
  actor: string
  summary: string
  detail?: string
  path?: string
}

export interface TickResult {
  actions: TickAction[]
  /** Simulated trips alive right now, against the ceiling. */
  population: number
}

/**
 * Do a few things.
 *
 * Weighted rather than round-robin, and the weights are a guess at what a
 * small town does in a minute: mostly people shopping, occasionally somebody
 * arriving or changing their mind. Each action asserts its own preconditions
 * and returns `null` when it has nothing to do, so a quiet tick is quiet
 * rather than an error.
 */
export async function tick(options: TickOptions): Promise<TickResult> {
  const env = getEnv()
  if (env.ARC_DATA_MODE !== 'demo') {
    throw forbidden('The inhabitants only ever live in a demo.')
  }

  const now = options.now ?? new Date()
  const wanted = Math.min(Math.max(options.actions ?? 2, 1), 5)
  const population = await simulatedPopulation()

  const done: TickAction[] = []
  for (let i = 0; i < wanted; i += 1) {
    const name = options.only ?? pick(population)
    const action = await attempt(ATTEMPTS[name], now, options.source)
    if (action) done.push(action)
  }

  /*
   * A cold start has nobody to shop, so the first few ticks of a fresh seed
   * would all be quiet — and a demo whose first impression is "nothing to do
   * this minute" is the demo this engine exists to fix. One arrival, then.
   */
  if (done.length === 0 && population < MAX_SIMULATED_STAYS && !options.only) {
    const arrival = await attempt(ATTEMPTS.someoneArrives, now, options.source)
    if (arrival) done.push(arrival)
  }

  if (done.length === 0) {
    done.push(
      await record(
        {
          kind: SimulatedActivityKind.QUIET,
          actor: 'the town',
          summary: 'Nothing to do this minute',
          detail:
            'Every simulated person is settled, nothing is left to buy within the headroom, and ' +
            'nobody new is due. A quiet tick is not a failed one.',
        },
        options.source,
        now,
      ),
    )
  }

  return { actions: done, population }
}

/** What an attempt returns: the activity, plus whatever it touched. */
export interface TickOutcome extends TickAction {
  stayId?: string
  orderId?: string
  orderItemId?: string
}

type Attempt = (now: Date) => Promise<TickOutcome | null>

export type AttemptName =
  | 'fillABasket'
  | 'somebodyFillsInTheirIntake'
  | 'buyWhatIsInABasket'
  | 'someoneArrives'
  | 'theHotelTakesAReservation'
  | 'someoneChangesTheirMind'
  | 'aBusinessAsksToJoin'
  | 'theFrontDeskChecksSomeoneIn'
  | 'keepTheHorizon'

/**
 * What the town might do next.
 *
 * Buying is the common case because it is the thing an operator is most often
 * looking at — the briefing, the arrivals list, the revenue card. Arrivals
 * stop entirely once the population is at its ceiling.
 */
export function pick(population: number): AttemptName {
  const table: Array<{ weight: number; name: AttemptName }> = [
    { weight: 4, name: 'fillABasket' },
    { weight: 2, name: 'somebodyFillsInTheirIntake' },
    { weight: 4, name: 'buyWhatIsInABasket' },
    { weight: population < MAX_SIMULATED_STAYS ? 3 : 0, name: 'someoneArrives' },
    { weight: population < MAX_SIMULATED_STAYS ? 3 : 0, name: 'theHotelTakesAReservation' },
    { weight: 2, name: 'someoneChangesTheirMind' },
    { weight: 1, name: 'aBusinessAsksToJoin' },
    { weight: 1, name: 'theFrontDeskChecksSomeoneIn' },
    { weight: 1, name: 'keepTheHorizon' },
  ]

  const total = table.reduce((sum, row) => sum + row.weight, 0)
  let roll = Math.random() * total
  for (const row of table) {
    if (row.weight === 0) continue
    roll -= row.weight
    if (roll <= 0) return row.name
  }
  return 'fillABasket'
}

async function attempt(
  action: Attempt,
  now: Date,
  source: TickOptions['source'],
): Promise<TickAction | null> {
  try {
    const outcome = await action(now)
    if (!outcome) return null
    return await record(outcome, source, now)
  } catch (error) {
    /*
     * A refusal is the product working, and it is worth seeing.
     *
     * The conditions gate declining a departure, a hold that expired, a seat
     * taken between the read and the write: every one of those is the demo
     * behaving, and swallowing it would make the engine look idle when it was
     * being told no. Anything that is not a domain error is a bug and is
     * rethrown.
     */
    if (!isAppError(error)) throw error
    return await record(
      {
        kind: SimulatedActivityKind.QUIET,
        actor: 'the town',
        summary: 'The product said no',
        detail: `${error.code}: ${error.message}`.slice(0, 600),
      },
      source,
      now,
    )
  }
}

/* ---------------------------------------------------------------- arrivals */

const FIRST_NAMES = [
  'Rosa', 'Mateo', 'Ines', 'Tomás', 'Carmen', 'Diego', 'Lucía', 'Pablo',
  'Marta', 'Nuria', 'Javier', 'Paula', 'Hugo', 'Alba', 'Sofía', 'Bruno',
]
const LAST_NAMES = [
  'Vidal', 'Carrasco', 'Noguera', 'Peralta', 'Iglesias', 'Mendoza', 'Rivas',
  'Castaño', 'Herrera', 'Prieto', 'Montero', 'Salas',
]

/** A traveller books a trip through a hotel's storefront. */
const someoneArrives: Attempt = async (now) => {
  const property = await aHotel()
  if (!property) return null

  const name = `${sample(FIRST_NAMES)} ${sample(LAST_NAMES)}`
  const email = simulatedAddress(name)
  const from = addDays(toDateKey(now), 1 + Math.floor(Math.random() * 7))
  const to = addDays(from, 1 + Math.floor(Math.random() * 4))

  // Not a credential anybody holds: the address is undeliverable, and the
  // account exists so the trip has an owner, as a real one would.
  const password = `sim-${cryptoWord()}-${cryptoWord()}`

  const result = await registerDirectTrip(
    {
      name,
      email,
      propertySlug: property.slug,
      fromDate: from,
      toDate: to,
      partySize: 1 + Math.floor(Math.random() * 3),
      password,
      confirmPassword: password,
      acceptedTerms: true,
    },
    { clientKey: `sim:${cryptoWord()}`, now },
  )

  return {
    kind: SimulatedActivityKind.ARRIVAL,
    actor: name,
    summary: `${name} booked a trip through ${property.name}`,
    detail: `${from} to ${to}`,
    path: '/owner/guests',
    stayId: result.stayId,
  }
}

/**
 * The front desk books a room.
 *
 * The other half of an arrival, and it needs its own action because the two
 * are genuinely different things: `someoneArrives` is a traveller booking
 * through the storefront, which is a `DIRECT` trip with no room (ADR-042), so
 * it never reaches the arrivals board, the briefing or occupancy. A hotel
 * guest is a reservation the property entered, and it is the one that moves
 * those three. A demo where the arrivals list never changes is the demo this
 * engine exists to fix, so both exist.
 */
const theHotelTakesAReservation: Attempt = async (now) => {
  const property = await aHotel()
  if (!property) return null

  const actor = await theOwnerOf(property.id)
  if (!actor) return null

  const firstName = sample(FIRST_NAMES)
  const lastName = sample(LAST_NAMES)
  const checkIn = addDays(toDateKey(now), Math.floor(Math.random() * 5))
  const roomType = await prisma.roomType.findFirst({
    where: { propertyId: property.id },
    select: { id: true },
  })

  const stay = await createStay(actor, property.id, {
    firstName,
    lastName,
    email: simulatedAddress(`${firstName}.${lastName}`),
    locale: 'EN',
    checkIn,
    checkOut: addDays(checkIn, 2 + Math.floor(Math.random() * 5)),
    adults: 1 + Math.floor(Math.random() * 2),
    children: 0,
    roomTypeId: roomType?.id ?? null,
    roomRevenueMinor: 180_000 + Math.floor(Math.random() * 20) * 10_000,
  })

  const name = `${firstName} ${lastName}`
  return {
    kind: SimulatedActivityKind.RESERVATION,
    actor: name,
    summary: `${property.name} took a reservation for ${name}`,
    detail: `Arriving ${checkIn}. A room booking, so it is on the arrivals board and in occupancy — unlike a storefront trip, which has no room.`,
    path: '/owner/arrivals',
    stayId: stay.stayId,
  }
}

/* ----------------------------------------------------------------- buying */

/** Somebody puts a seat in their basket, which takes a hold. */
const fillABasket: Attempt = async (now) => {
  const guest = await aSimulatedGuest()
  if (!guest) return null

  const slot = await aSlotWithHeadroom(guest.organizationId, now)
  if (!slot) return null

  const cartId = await getOrCreateCart({
    organizationId: guest.organizationId,
    propertyId: guest.propertyId,
    guestId: guest.id,
    stayId: guest.stayId,
    currency: slot.currency,
  })

  await addToCart({ cartId, slotId: slot.id, quantity: 1, now })

  return {
    kind: SimulatedActivityKind.BASKET,
    actor: guest.name,
    summary: `${guest.name} put ${slot.title} in their basket`,
    detail: 'A hold is taken at this point, so the seat is off the shelf while they decide.',
    path: '/owner',
  }
}

/** A basket becomes an order. */
const buyWhatIsInABasket: Attempt = async (now) => {
  const cart = await prisma.cart.findFirst({
    where: {
      status: CartStatus.OPEN,
      items: { some: {} },
      guest: { user: { email: { endsWith: `@${SIMULATED_DOMAIN}` } } },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, guestId: true, guest: { select: { firstName: true, lastName: true } } },
  })
  if (!cart?.guestId) return null

  const name = `${cart.guest?.firstName ?? 'Somebody'} ${cart.guest?.lastName ?? ''}`.trim()
  const result = await checkout({
    cartId: cart.id,
    guestId: cart.guestId,
    idempotencyKey: `sim-${cart.id}`,
    now,
  })

  return {
    kind: SimulatedActivityKind.PURCHASE,
    actor: name,
    summary: `${name} paid for ${result.itemCount === 1 ? 'a seat' : `${result.itemCount} seats`}`,
    detail: `Order ${result.reference}. The commission split and the ledger entries are the real ones.`,
    path: '/owner/revenue',
    orderId: result.orderId,
  }
}

/** Somebody gives a seat back. */
const someoneChangesTheirMind: Attempt = async (now) => {
  const item = await prisma.orderItem.findFirst({
    where: {
      status: OrderItemStatus.CONFIRMED,
      order: { guest: { user: { email: { endsWith: `@${SIMULATED_DOMAIN}` } } } },
      slot: { startsAt: { gt: now } },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      experience: { select: { titleEn: true } },
      order: { select: { guestId: true, guest: { select: { firstName: true, lastName: true } } } },
    },
  })
  if (!item?.order?.guestId) return null

  const name = `${item.order.guest?.firstName ?? 'Somebody'} ${item.order.guest?.lastName ?? ''}`.trim()
  await cancelOrderItem({
    orderItemId: item.id,
    reason: 'Plans changed.',
    authority: { kind: 'guest', guestId: item.order.guestId },
    now,
  })

  return {
    kind: SimulatedActivityKind.CANCELLATION,
    actor: name,
    summary: `${name} cancelled ${item.experience.titleEn}`,
    detail: 'The seat went back to the departure and the refund is in the ledger.',
    path: '/owner/revenue',
    orderItemId: item.id,
  }
}

/**
 * Somebody answers the questions the hotel asked them.
 *
 * Worth having as an action of its own rather than as part of an arrival,
 * because the gate's behaviour turns on it: a guest who has stated no surf
 * level is refused a demanding day outright (ADR-017), and watching that
 * refusal turn into an offer once they answer is the clearest demonstration
 * the conditions gate has. A quarter of them never answer, which is also true
 * of real people and keeps the refusal on screen.
 */
const somebodyFillsInTheirIntake: Attempt = async () => {
  const guest = await prisma.guest.findFirst({
    where: {
      surfAbility: null,
      user: { email: { endsWith: `@${SIMULATED_DOMAIN}` } },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, firstName: true, lastName: true, partySize: true },
  })
  if (!guest) return null

  const stated = Math.random() > 0.25
  const ability = stated ? sample(ABILITIES) : null

  await saveIntake(guest.id, {
    interests: [sample(INTERESTS), sample(INTERESTS)],
    surfAbility: ability,
    pace: sample([Pace.RELAXED, Pace.BALANCED, Pace.PACKED]),
    partySize: guest.partySize ?? 1,
    preferredTransport: [],
    dataProcessingConsent: true,
    personalizationConsent: Math.random() > 0.5,
    marketingConsent: false,
  })

  const name = `${guest.firstName} ${guest.lastName ?? ''}`.trim()
  return {
    kind: SimulatedActivityKind.INTAKE,
    actor: name,
    summary: ability
      ? `${name} said they surf at ${ability.toLowerCase()} level`
      : `${name} filled in their preferences and left their surf level blank`,
    detail: ability
      ? 'The conditions gate can now answer for a demanding day instead of refusing to guess.'
      : 'Nothing is inferred from that: an unanswered question stays unanswered, and the gate stays conservative.',
    path: '/owner/guests',
  }
}

/* ------------------------------------------------------------- the hotel */

const TRADES = [
  {
    name: 'Taller Marea',
    categories: [ExperienceCategory.ADVENTURE],
    pitch: 'Half-day boat trips with a local skipper.',
  },
  {
    name: 'Cocina Raíz',
    categories: [ExperienceCategory.DINING],
    pitch: 'A kitchen table and four courses.',
  },
  {
    name: 'Bici Costa',
    categories: [ExperienceCategory.ADVENTURE, ExperienceCategory.CULTURE],
    pitch: 'Coastal rides for people who have not ridden in years.',
  },
  {
    name: 'Estudio Sal',
    categories: [ExperienceCategory.WELLNESS],
    pitch: 'Breathwork and stretching before the heat.',
  },
]

/** A business asks a hotel to work with it. */
const aBusinessAsksToJoin: Attempt = async (now) => {
  const property = await aHotel()
  if (!property) return null

  const trade = sample(TRADES)
  const suffix = cryptoWord()
  const businessName = `${trade.name} ${suffix.toUpperCase()}`

  await requestToJoinProperty(
    {
      propertySlug: property.slug,
      businessName,
      contactName: `${sample(FIRST_NAMES)} ${sample(LAST_NAMES)}`,
      contactEmail: `hola.${suffix}@${SIMULATED_DOMAIN}`,
      categories: trade.categories,
      pitch: trade.pitch,
      claimedCertifications: [],
      locale: 'ES',
    },
    { requesterKey: `sim:${suffix}`, now },
  )

  return {
    kind: SimulatedActivityKind.JOIN_REQUEST,
    actor: businessName,
    summary: `${businessName} asked to work with ${property.name}`,
    detail: 'It is a request and nothing else: no supplier, no agreement, no login until somebody accepts.',
    path: '/owner/partners',
  }
}

/** The front desk checks somebody in. */
/**
 * The front desk checks today's arrival in.
 *
 * Room bookings only, which is what `StayKind.HOTEL_RESERVATION` here means:
 * a storefront trip is `DIRECT`, has no room, and therefore has no check-in at
 * all (ADR-042). Most of what it moves is the engine's own reservations; it
 * will also check in a seeded demo guest whose day is today, which is the
 * front desk doing its job to demo data that `db:seed` puts back.
 */
const theFrontDeskChecksSomeoneIn: Attempt = async (now) => {
  const today = toDateKey(now)
  const stay = await prisma.stay.findFirst({
    where: {
      kind: StayKind.HOTEL_RESERVATION,
      status: StayStatus.BOOKED,
      checkIn: { lte: new Date(`${today}T23:59:59.000Z`) },
    },
    orderBy: { checkIn: 'asc' },
    select: {
      id: true,
      propertyId: true,
      guest: { select: { firstName: true, lastName: true } },
    },
  })
  if (!stay) return null

  const actor = await theOwnerOf(stay.propertyId)
  if (!actor) return null

  await setStayStatus(actor, { stayId: stay.id, status: StayStatus.IN_HOUSE })

  const name = `${stay.guest?.firstName ?? 'A guest'} ${stay.guest?.lastName ?? ''}`.trim()
  return {
    kind: SimulatedActivityKind.CHECK_IN,
    actor: name,
    summary: `${name} checked in`,
    detail: 'Done as the hotel, because checking somebody in is something the hotel does.',
    path: '/owner/guests',
    stayId: stay.id,
  }
}

/* --------------------------------------------------------------- horizon */

/**
 * Keeps the town from running out of days.
 *
 * The seed dates everything from the day it runs, so a demo left alone walks
 * off the end of its own availability — and a demo being *used* walks off it
 * faster, because the inhabitants are buying the seats. This copies the last
 * day's pattern forward, which keeps whatever shape each experience's week
 * has rather than inventing a timetable.
 */
const keepTheHorizon: Attempt = async (now) => {
  // The experience whose own horizon is shortest is the one worth extending:
  // a destination where one departure has run out is already broken for the
  // guest who wanted that one.
  const horizons = await prisma.availabilitySlot.groupBy({
    by: ['experienceId'],
    where: { experience: { status: ExperienceStatus.PUBLISHED } },
    _max: { startsAt: true },
  })
  if (horizons.length === 0) return null

  const nearest = horizons.reduce((worst, row) =>
    (row._max.startsAt?.getTime() ?? 0) < (worst._max.startsAt?.getTime() ?? 0) ? row : worst,
  )
  const furthest = nearest._max.startsAt
  if (!furthest) return null

  const daysLeft = Math.floor((furthest.getTime() - now.getTime()) / 86_400_000)
  if (daysLeft >= MIN_HORIZON_DAYS) return null

  const experience = await prisma.experience.findUnique({
    where: { id: nearest.experienceId },
    select: { id: true, titleEn: true, supplierId: true, organizationId: true },
  })
  if (!experience) return null

  // The shape of the week comes from the departures that already exist, so a
  // dawn-only session stays a dawn-only session and `scheduleAvailability`'s
  // own hours and season checks still have the last word.
  const recent = await prisma.availabilitySlot.findMany({
    where: { experienceId: experience.id },
    orderBy: { startsAt: 'desc' },
    take: 24,
    select: { startsAt: true, capacity: true },
  })
  if (recent.length === 0) return null

  const startTimes = [...new Set(recent.map((slot) => toLocalTimeString(slot.startsAt)))].slice(0, 12)
  const capacity = recent[0]?.capacity ?? 6

  const actor = await anOwnerOf(experience.organizationId)
  if (!actor) return null

  const from = addDays(toLocalDateKey(furthest), 1)
  const { created } = await scheduleAvailability(actor, experience.supplierId, {
    experienceId: experience.id,
    fromDate: from,
    toDate: addDays(from, 6),
    startTimes,
    capacity,
    weekdays: [],
  })
  if (created === 0) return null

  return {
    kind: SimulatedActivityKind.HORIZON,
    actor: 'the destination',
    summary: `${experience.titleEn} opened ${created} more departures`,
    detail:
      `Its furthest was ${daysLeft} days out, below the ${MIN_HORIZON_DAYS} the demo keeps. ` +
      'Scheduled through the partner\'s own availability service, so the activity\'s hours and ' +
      'season still decide which days exist.',
    path: '/experiences',
  }
}

/* ----------------------------------------------------------------- shared */

interface SimulatedGuest {
  id: string
  name: string
  organizationId: string
  propertyId: string
  stayId: string | null
}

async function aSimulatedGuest(): Promise<SimulatedGuest | null> {
  const stays = await prisma.stay.findMany({
    where: {
      status: { in: [StayStatus.BOOKED, StayStatus.IN_HOUSE] },
      guest: { user: { email: { endsWith: `@${SIMULATED_DOMAIN}` } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      organizationId: true,
      propertyId: true,
      guestId: true,
      guest: { select: { firstName: true, lastName: true } },
    },
  })
  if (stays.length === 0) return null

  const stay = sample(stays)
  return {
    id: stay.guestId,
    name: `${stay.guest?.firstName ?? 'Somebody'} ${stay.guest?.lastName ?? ''}`.trim(),
    organizationId: stay.organizationId,
    propertyId: stay.propertyId,
    stayId: stay.id,
  }
}

/**
 * A departure with room to spare.
 *
 * `capacity - booked - held > RESERVED_SEATS`, so the simulated population can
 * never sell out the town. Somebody looking at the demo has to be able to book
 * something, and "everything is full" is the one way a busy demo is worse than
 * an empty one.
 */
async function aSlotWithHeadroom(organizationId: string, now: Date) {
  const slots = await prisma.availabilitySlot.findMany({
    where: {
      organizationId,
      status: SlotStatus.OPEN,
      startsAt: { gt: new Date(now.getTime() + 86_400_000) },
      experience: { status: 'PUBLISHED' },
    },
    orderBy: { startsAt: 'asc' },
    take: 60,
    select: {
      id: true,
      capacity: true,
      booked: true,
      held: true,
      currency: true,
      experience: { select: { titleEn: true } },
    },
  })

  const roomy = slots.filter((slot) => slot.capacity - slot.booked - slot.held > RESERVED_SEATS)
  if (roomy.length === 0) return null

  const slot = sample(roomy)
  return { id: slot.id, currency: slot.currency, title: slot.experience.titleEn }
}

/**
 * The hotel, as an actor.
 *
 * Built here rather than imported from `modules/auth`, which imports
 * `server-only` and would therefore refuse to load in the scheduled route's
 * graph and in the tests. Same `select`, same shape.
 */
async function theOwnerOf(propertyId: string): Promise<ActorContext | null> {
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { organizationId: true },
  })
  if (!property) return null

  return findActor({
    organizationId: property.organizationId,
    role: { in: [Role.OWNER, Role.STAFF] },
    OR: [{ propertyId }, { propertyId: null }],
  })
}

/** An owner of an organization, for a write the organization itself does. */
async function anOwnerOf(organizationId: string): Promise<ActorContext | null> {
  return findActor({ organizationId, role: Role.OWNER })
}

async function findActor(where: Prisma.MembershipWhereInput): Promise<ActorContext | null> {
  const membership = await prisma.membership.findFirst({
    where,
    orderBy: { createdAt: 'asc' },
    select: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          isPlatformAdmin: true,
          memberships: {
            select: {
              id: true,
              organizationId: true,
              role: true,
              propertyId: true,
              supplierId: true,
            },
          },
        },
      },
    },
  })
  if (!membership?.user) return null

  return {
    userId: membership.user.id,
    email: membership.user.email,
    name: membership.user.name,
    isPlatformAdmin: membership.user.isPlatformAdmin,
    memberships: membership.user.memberships,
  }
}

/**
 * One of the demo's hotels, chosen at random.
 *
 * Not the first by `createdAt`: every arrival and every join request landing
 * at the same property is how a multi-tenant demo comes to look like a
 * single-tenant one, and tenancy is half of what there is to show.
 */
async function aHotel(): Promise<{ id: string; slug: string; name: string } | null> {
  const properties = await prisma.property.findMany({
    where: { status: EntityStatus.ACTIVE },
    select: { id: true, slug: true, name: true },
  })
  return properties.length === 0 ? null : sample(properties)
}

/** Everything the town might do, by name. Declared after the attempts. */
const ATTEMPTS: Record<AttemptName, Attempt> = {
  fillABasket,
  somebodyFillsInTheirIntake,
  buyWhatIsInABasket,
  someoneArrives,
  theHotelTakesAReservation,
  someoneChangesTheirMind,
  aBusinessAsksToJoin,
  theFrontDeskChecksSomeoneIn,
  keepTheHorizon,
}

export async function simulatedPopulation(): Promise<number> {
  return prisma.stay.count({
    where: {
      status: { in: [StayStatus.BOOKED, StayStatus.IN_HOUSE] },
      guest: { user: { email: { endsWith: `@${SIMULATED_DOMAIN}` } } },
    },
  })
}

async function record(
  action: TickOutcome,
  source: TickOptions['source'],
  now: Date,
): Promise<TickAction> {
  await prisma.simulatedActivity.create({
    data: {
      kind: action.kind,
      source,
      actor: action.actor.slice(0, 120),
      summary: action.summary.slice(0, 300),
      detail: action.detail?.slice(0, 600) ?? null,
      path: action.path ?? null,
      stayId: action.stayId ?? null,
      orderId: action.orderId ?? null,
      orderItemId: action.orderItemId ?? null,
      occurredAt: now,
    },
  })
  return action
}

/** The last few things the town did, for the dashboard. */
export async function recentActivity(limit = 40) {
  return prisma.simulatedActivity.findMany({
    orderBy: { occurredAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 200),
  })
}

/** An undeliverable address that says what the person is. */
const simulatedAddress = (name: string): string =>
  `${name.toLowerCase().replace(/[^a-z]+/g, '.')}.${Date.now().toString(36)}@${SIMULATED_DOMAIN}`

const ABILITIES = [AbilityLevel.BEGINNER, AbilityLevel.INTERMEDIATE, AbilityLevel.ADVANCED]

const INTERESTS = [
  ExperienceCategory.SURF,
  ExperienceCategory.WELLNESS,
  ExperienceCategory.DINING,
  ExperienceCategory.CULTURE,
  ExperienceCategory.ADVENTURE,
]

const sample = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)] as T

const cryptoWord = (): string => Math.random().toString(36).slice(2, 8)


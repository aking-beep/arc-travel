import { type Money, money, multiply, sum, zero } from '@/lib/money'
import { daysBetween, type DateKey } from '@/lib/dates'
import { invalid } from '@/lib/errors'

/**
 * Nightly estimates for the public destination surface.
 *
 * This is an *estimate*, and the distinction matters enough to be in the type
 * name. The public surface has no cart, no hold and no availability lookup, so
 * nothing here may be read as "these nights are free at this price". It
 * multiplies a published nightly rate by a number of nights so a visitor can
 * see the order of magnitude before they enquire.
 *
 * All arithmetic is integer minor units. A nightly rate arrives from
 * `RoomType.baseRateMinor` already in centavos, so there is no conversion here
 * at all — the only place pesos become centavos is `pesosToMinor` at the form
 * edge, and this is not a form edge.
 */
export interface StayEstimate {
  nights: number
  /** How many rooms of this type the party needs at its stated occupancy. */
  roomsNeeded: number
  nightlyRate: Money
  /** `nightlyRate × nights × roomsNeeded`. */
  total: Money
  /** True when the party cannot be housed in this room type at all. */
  exceedsOccupancy: boolean
}

export interface EstimateInput {
  arrive: DateKey
  depart: DateKey
  partySize: number
  nightlyRateMinor: number
  currency: string
  maxOccupancy: number
  /** How many rooms of this type the property actually has. */
  roomCount: number
}

/**
 * Pure, so it is unit-testable without a database and gives the same answer on
 * the server and in a test. Throws rather than clamping on nonsense input: a
 * silent clamp is how a zero-night estimate becomes a plausible-looking total.
 */
export function estimateStay(input: EstimateInput): StayEstimate {
  if (!Number.isInteger(input.partySize) || input.partySize < 1) {
    throw invalid('Party size must be a positive whole number.')
  }
  if (!Number.isInteger(input.maxOccupancy) || input.maxOccupancy < 1) {
    throw invalid('Room occupancy must be a positive whole number.')
  }
  if (!Number.isInteger(input.nightlyRateMinor) || input.nightlyRateMinor < 0) {
    throw invalid('A nightly rate must be a non-negative integer in minor units.')
  }

  const nights = daysBetween(input.arrive, input.depart)
  if (nights < 0) throw invalid('Departure cannot fall before arrival.')

  const nightlyRate = money(input.nightlyRateMinor, input.currency)
  const roomsNeeded = Math.ceil(input.partySize / input.maxOccupancy)
  const exceedsOccupancy = roomsNeeded > input.roomCount

  // No nights selected and no rooms available both mean "nothing to total", and
  // both must read as zero rather than as a bargain.
  const total =
    nights === 0 || exceedsOccupancy
      ? zero(input.currency)
      : multiply(nightlyRate, nights * roomsNeeded)

  return { nights, roomsNeeded, nightlyRate, total, exceedsOccupancy }
}

/**
 * The cheapest and dearest published nightly rate across a property's room
 * types, for the "from X" line on a card.
 *
 * Returns null for a property with no room types rather than zero, because a
 * card reading "from $0" is worse than a card with no price on it.
 */
export function nightlyRateRange(
  roomTypes: Array<{ baseRateMinor: number; currency: string }>,
): { min: Money; max: Money } | null {
  const priced = roomTypes.filter((r) => r.baseRateMinor > 0)
  if (priced.length === 0) return null

  const currency = priced[0]!.currency
  const amounts = priced.map((r) => r.baseRateMinor)
  return {
    min: money(Math.min(...amounts), currency),
    max: money(Math.max(...amounts), currency),
  }
}

/**
 * Per-person experience price plus any per-booking fee, for a given party.
 *
 * Kept here beside the stay estimate so both public-surface totals are derived
 * the same way and neither is computed in a component.
 */
export function estimateExperience(input: {
  amountMinor: number
  bookingFeeMinor: number
  currency: string
  partySize: number
}): Money {
  if (!Number.isInteger(input.partySize) || input.partySize < 1) {
    throw invalid('Party size must be a positive whole number.')
  }
  const perPerson = money(input.amountMinor, input.currency)
  const fee = money(input.bookingFeeMinor, input.currency)
  return sum([multiply(perPerson, input.partySize), fee], input.currency)
}

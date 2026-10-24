import { describe, expect, it } from 'vitest'
import {
  AbilityLevel,
  ConditionsRisk,
  ExperienceCategory,
  ItineraryItemKind,
  Pace,
  TransportMode,
} from '@/lib/prisma-types'
import type { ConditionsGate } from '@/modules/destination/conditions'
import type { TravelEstimate, TravelMatrix } from '@/modules/destination/travel'
import { generateItinerary } from '@/modules/itinerary/generator'
import { scoreCandidate, type Candidate, type GuestPreferences } from '@/modules/itinerary/scoring'

/**
 * AUDIT-1 — the guest-facing trip estimate must count a transfer leg once.
 *
 * `generateItinerary` adds `travel.costMinor` to the experience item's
 * `estimatedCostMinor`, and then — whenever the leg is 15 minutes or longer —
 * emits a separate TRANSFER block carrying the same `travel.costMinor` again.
 * `estimatedTotalMinor` sums every item, so the leg is counted twice in the
 * figure rendered at `/g/[token]`, while the generator's own daily budget guard
 * counts it once. The two numbers therefore disagree about the same day.
 *
 * The existing suite only asserts that the total equals the sum of the items,
 * which is true by construction and cannot catch this.
 */
const BASE = 'place-hotel'
const COVE = 'place-cove'
const TRAVEL_MINUTES = 25
const TRAVEL_COST_MINOR = 30_000

const matrix: TravelMatrix = {
  get: (from, to): TravelEstimate => ({
    fromPlaceId: from,
    toPlaceId: to,
    mode: TransportMode.TAXI,
    minutes: from === to ? 0 : TRAVEL_MINUTES,
    costMinor: from === to ? 0 : TRAVEL_COST_MINOR,
    currency: 'MXN',
    isFallback: false,
  }),
  all: (f, t) => [matrix.get(f, t)],
}

const allowed: ConditionsGate = {
  allowed: true,
  exclusions: [],
  notes: [],
  snapshot: null,
  usedBaseline: false,
}

const guest: GuestPreferences = {
  ability: AbilityLevel.BEGINNER,
  interests: [ExperienceCategory.SURF],
  pace: Pace.BALANCED,
  partySize: 2,
  budgetPerDayMinor: null,
  mobilityNotes: null,
  personalizationAllowed: true,
}

const candidate: Candidate = {
  experienceId: 'exp-1',
  slotId: 'slot-1',
  title: 'Cove session',
  category: ExperienceCategory.SURF,
  placeId: COVE,
  unitPriceMinor: 95_000,
  bookingFeeMinor: 0,
  currency: 'MXN',
  durationMinutes: 120,
  startsAt: new Date('2026-11-02T09:00:00Z'),
  startTime: '09:00',
  capacityRemaining: 6,
  minParty: 1,
  maxParty: 6,
  minAgeYears: null,
  experienceMinAbility: AbilityLevel.BEGINNER,
  experienceMaxAbility: AbilityLevel.EXPERT,
  activityMinAbility: AbilityLevel.BEGINNER,
  activityMaxAbility: AbilityLevel.EXPERT,
  activityMaxSafeRisk: ConditionsRisk.MODERATE,
  activityGuideRequired: false,
  activityPhysicalIntensity: 2,
  activitySeasonMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  activityEarliestStart: '06:00',
  activityLatestStart: '18:00',
  experienceGuideIncluded: true,
  supplierVerified: false,
  conditionsSensitive: true,
  placeBaselineRisk: ConditionsRisk.LOW,
  travelMinutesFromBase: TRAVEL_MINUTES,
  travelCostMinor: TRAVEL_COST_MINOR,
}

describe('itinerary estimated total', () => {
  const generate = () =>
    generateItinerary({
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      guest,
      candidatesByDate: new Map([
        ['2026-11-02', [scoreCandidate(candidate, guest, allowed, '2026-11-02')]],
      ]),
      basePlaceId: BASE,
      travel: matrix,
      currency: 'MXN',
    })

  it('emits one visible transfer block for a leg of 15 minutes or more', () => {
    const transfers = generate().items.filter((i) => i.kind === ItineraryItemKind.TRANSFER)
    expect(transfers).toHaveLength(1)
    expect(transfers[0]!.estimatedCostMinor).toBe(TRAVEL_COST_MINOR)
  })

  it('counts that leg once in the trip total, not once per block', () => {
    const result = generate()
    const expected = candidate.unitPriceMinor * guest.partySize + TRAVEL_COST_MINOR
    expect(result.estimatedTotalMinor).toBe(expected)
  })

  it('agrees with the per-day figure the budget guard uses', () => {
    const result = generate()
    const day = result.dayStats[0]!
    const perPersonTravel = Math.round(TRAVEL_COST_MINOR / guest.partySize)
    const budgetView = candidate.unitPriceMinor + perPersonTravel
    expect(day.estimatedCostMinor).toBe(budgetView * guest.partySize)
  })
})

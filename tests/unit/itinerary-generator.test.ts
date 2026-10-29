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
import {
  INTENSE_RECOVERY_MINUTES,
  MAX_TRAVEL_MINUTES_PER_HOP,
  PACE_LIMITS,
  scoreCandidate,
  type Candidate,
  type GuestPreferences,
} from '@/modules/itinerary/scoring'

/**
 * Itinerary feasibility.
 *
 * The generator is a pure function, so these tests describe the plan rules
 * directly: pace limits, travel feasibility, recovery after demanding sessions,
 * the daily budget, and the promise that anything it could not fit is reported
 * rather than quietly dropped.
 */
const BASE_PLACE = 'place-hotel'
const COVE = 'place-cove'
const FAR = 'place-far'

function travelMatrix(overrides: Record<string, { minutes: number; costMinor: number }> = {}): TravelMatrix {
  const estimate = (from: string, to: string): TravelEstimate => {
    const key = `${from}:${to}`
    const override = overrides[key] ?? overrides[`${to}:${from}`]
    return {
      fromPlaceId: from,
      toPlaceId: to,
      mode: TransportMode.TAXI,
      minutes: from === to ? 0 : (override?.minutes ?? 10),
      costMinor: from === to ? 0 : (override?.costMinor ?? 7_000),
      currency: 'MXN',
      isFallback: false,
    }
  }
  return { get: estimate, all: (f, t) => [estimate(f, t)] }
}

const allowedGate: ConditionsGate = {
  allowed: true,
  exclusions: [],
  notes: [],
  blockers: [],
  snapshot: null,
  usedBaseline: false,
}

function guest(partial: Partial<GuestPreferences> = {}): GuestPreferences {
  return {
    ability: AbilityLevel.BEGINNER,
    interests: [ExperienceCategory.SURF],
    pace: Pace.BALANCED,
    partySize: 2,
    budgetPerDayMinor: null,
    mobilityNotes: null,
    personalizationAllowed: true,
    ...partial,
  }
}

function candidate(partial: Partial<Candidate> = {}): Candidate {
  const startTime = partial.startTime ?? '09:00'
  return {
    experienceId: partial.slotId ? `exp-${partial.slotId}` : 'exp-1',
    slotId: 'slot-1',
    title: 'Test experience',
    category: ExperienceCategory.SURF,
    placeId: COVE,
    unitPriceMinor: 95_000,
    bookingFeeMinor: 0,
    currency: 'MXN',
    durationMinutes: 120,
    startsAt: new Date(`2026-11-02T${startTime}:00Z`),
    startTime,
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
    travelMinutesFromBase: 10,
    travelCostMinor: 14_000,
    ...partial,
  }
}

const scored = (c: Candidate, g = guest()) => scoreCandidate(c, g, allowedGate, '2026-11-02')

const experienceItems = <T extends { kind: ItineraryItemKind }>(items: T[]): T[] =>
  items.filter((i) => i.kind === ItineraryItemKind.EXPERIENCE)

describe('pace limits', () => {
  it('caps a relaxed day at one experience', () => {
    const candidates = [
      candidate({ slotId: 'a', startTime: '08:00' }),
      candidate({ slotId: 'b', startTime: '12:00' }),
      candidate({ slotId: 'c', startTime: '16:00' }),
    ].map((c) => scored(c, guest({ pace: Pace.RELAXED })))

    const result = generateItinerary({
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      guest: guest({ pace: Pace.RELAXED }),
      candidatesByDate: new Map([['2026-11-02', candidates]]),
      basePlaceId: BASE_PLACE,
      travel: travelMatrix(),
    })

    expect(experienceItems(result.items)).toHaveLength(PACE_LIMITS[Pace.RELAXED].maxPerDay)
  })

  it('allows three on a packed day when the timing works', () => {
    const candidates = [
      candidate({ slotId: 'a', startTime: '07:00' }),
      candidate({ slotId: 'b', startTime: '11:00' }),
      candidate({ slotId: 'c', startTime: '15:00' }),
    ].map((c) => scored(c, guest({ pace: Pace.PACKED })))

    const result = generateItinerary({
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      guest: guest({ pace: Pace.PACKED }),
      candidatesByDate: new Map([['2026-11-02', candidates]]),
      basePlaceId: BASE_PLACE,
      travel: travelMatrix(),
    })

    expect(experienceItems(result.items)).toHaveLength(3)
  })

  it('respects the daily active-minute ceiling', () => {
    const candidates = [
      candidate({ slotId: 'a', startTime: '07:00', durationMinutes: 240 }),
      candidate({ slotId: 'b', startTime: '13:00', durationMinutes: 240 }),
    ].map((c) => scored(c, guest({ pace: Pace.BALANCED })))

    const result = generateItinerary({
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      guest: guest({ pace: Pace.BALANCED }),
      candidatesByDate: new Map([['2026-11-02', candidates]]),
      basePlaceId: BASE_PLACE,
      travel: travelMatrix(),
    })

    const minutes = experienceItems(result.items).length * 240
    expect(minutes).toBeLessThanOrEqual(PACE_LIMITS[Pace.BALANCED].maxActiveMinutes)
  })
})

describe('time and travel feasibility', () => {
  it('never schedules two experiences that overlap', () => {
    const candidates = [
      candidate({ slotId: 'a', startTime: '09:00', durationMinutes: 180 }),
      candidate({ slotId: 'b', startTime: '10:00', durationMinutes: 120 }),
    ].map((c) => scored(c))

    const result = generateItinerary({
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      guest: guest(),
      candidatesByDate: new Map([['2026-11-02', candidates]]),
      basePlaceId: BASE_PLACE,
      travel: travelMatrix(),
    })

    expect(experienceItems(result.items)).toHaveLength(1)
  })

  it('leaves room for travel between consecutive stops', () => {
    // 09:00–11:00 at the cove, then a 40-minute hop. A 11:15 start cannot work.
    const candidates = [
      candidate({ slotId: 'a', startTime: '09:00', placeId: COVE }),
      candidate({ slotId: 'b', startTime: '11:15', placeId: FAR }),
    ].map((c) => scored(c))

    const result = generateItinerary({
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      guest: guest(),
      candidatesByDate: new Map([['2026-11-02', candidates]]),
      basePlaceId: BASE_PLACE,
      travel: travelMatrix({ [`${COVE}:${FAR}`]: { minutes: 40, costMinor: 20_000 } }),
    })

    expect(experienceItems(result.items)).toHaveLength(1)
  })

  it('accepts a second stop once there is genuinely time for the journey', () => {
    const candidates = [
      candidate({ slotId: 'a', startTime: '08:00', placeId: COVE }),
      candidate({ slotId: 'b', startTime: '13:00', placeId: FAR }),
    ].map((c) => scored(c))

    const result = generateItinerary({
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      guest: guest(),
      candidatesByDate: new Map([['2026-11-02', candidates]]),
      basePlaceId: BASE_PLACE,
      travel: travelMatrix({ [`${COVE}:${FAR}`]: { minutes: 40, costMinor: 20_000 } }),
    })

    expect(experienceItems(result.items)).toHaveLength(2)
    // The journey is shown as its own block rather than hidden in a gap.
    expect(result.items.some((i) => i.kind === ItineraryItemKind.TRANSFER)).toBe(true)
  })

  it('refuses a hop longer than a day trip can absorb', () => {
    expect(MAX_TRAVEL_MINUTES_PER_HOP).toBeLessThan(95)
    const candidates = [
      candidate({ slotId: 'a', startTime: '08:00', placeId: COVE }),
      candidate({ slotId: 'b', startTime: '16:00', placeId: FAR }),
    ].map((c) => scored(c))

    const result = generateItinerary({
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      guest: guest(),
      candidatesByDate: new Map([['2026-11-02', candidates]]),
      basePlaceId: BASE_PLACE,
      travel: travelMatrix({ [`${COVE}:${FAR}`]: { minutes: 95, costMinor: 60_000 } }),
    })

    expect(experienceItems(result.items)).toHaveLength(1)
  })

  it('schedules nothing outside the day’s bounds', () => {
    const candidates = [scored(candidate({ slotId: 'a', startTime: '05:00' }))]

    const result = generateItinerary({
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      guest: guest(),
      candidatesByDate: new Map([['2026-11-02', candidates]]),
      basePlaceId: BASE_PLACE,
      travel: travelMatrix(),
    })

    expect(experienceItems(result.items)).toHaveLength(0)
  })
})

describe('recovery and rest', () => {
  it('requires a longer gap after a physically demanding session', () => {
    // Demanding 08:00–10:00, 10 minutes of travel. MIN_GAP would allow 10:55;
    // INTENSE_RECOVERY must push the next start past 11:40.
    const candidates = [
      candidate({ slotId: 'a', startTime: '08:00', activityPhysicalIntensity: 5 }),
      candidate({ slotId: 'b', startTime: '11:00' }),
    ].map((c) => scored(c))

    const result = generateItinerary({
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      guest: guest(),
      candidatesByDate: new Map([['2026-11-02', candidates]]),
      basePlaceId: BASE_PLACE,
      travel: travelMatrix(),
    })

    expect(experienceItems(result.items)).toHaveLength(1)
    expect(INTENSE_RECOVERY_MINUTES).toBeGreaterThan(45)
  })

  it('blocks out explicit rest after a demanding session', () => {
    const candidates = [scored(candidate({ slotId: 'a', startTime: '08:00', activityPhysicalIntensity: 5 }))]

    const result = generateItinerary({
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      guest: guest(),
      candidatesByDate: new Map([['2026-11-02', candidates]]),
      basePlaceId: BASE_PLACE,
      travel: travelMatrix(),
    })

    expect(result.items.some((i) => i.kind === ItineraryItemKind.REST)).toBe(true)
  })

  it('marks an empty day as open rather than leaving a hole', () => {
    const result = generateItinerary({
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      guest: guest(),
      candidatesByDate: new Map(),
      basePlaceId: BASE_PLACE,
      travel: travelMatrix(),
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.kind).toBe(ItineraryItemKind.FREE_TIME)
    expect(result.unmetConstraints.map((u) => u.code)).toContain('no_eligible_experiences')
  })
})

describe('budget', () => {
  it('stops adding once the daily budget is reached, and says so', () => {
    const tight = guest({ budgetPerDayMinor: 110_000, pace: Pace.PACKED })
    const candidates = [
      candidate({ slotId: 'a', startTime: '08:00', unitPriceMinor: 95_000 }),
      candidate({ slotId: 'b', startTime: '13:00', unitPriceMinor: 95_000 }),
    ].map((c) => scored(c, tight))

    const result = generateItinerary({
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      guest: tight,
      candidatesByDate: new Map([['2026-11-02', candidates]]),
      basePlaceId: BASE_PLACE,
      travel: travelMatrix(),
    })

    expect(experienceItems(result.items)).toHaveLength(1)
    expect(result.unmetConstraints.map((u) => u.code)).toContain('budget_exceeded')
  })

  it('ignores price entirely when no budget was given', () => {
    const open = guest({ budgetPerDayMinor: null, pace: Pace.PACKED })
    const candidates = [
      candidate({ slotId: 'a', startTime: '08:00', unitPriceMinor: 500_000 }),
      candidate({ slotId: 'b', startTime: '13:00', unitPriceMinor: 500_000 }),
    ].map((c) => scored(c, open))

    const result = generateItinerary({
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      guest: open,
      candidatesByDate: new Map([['2026-11-02', candidates]]),
      basePlaceId: BASE_PLACE,
      travel: travelMatrix(),
    })

    expect(experienceItems(result.items)).toHaveLength(2)
  })
})

describe('trip-level rules', () => {
  it('does not offer the same experience twice across a trip', () => {
    const day1 = [scored(candidate({ slotId: 'a', startTime: '09:00' }))]
    const day2 = [
      scored({ ...candidate({ slotId: 'b', startTime: '09:00' }), experienceId: 'exp-slot-a' }),
    ]

    const result = generateItinerary({
      startDate: '2026-11-02',
      endDate: '2026-11-03',
      guest: guest(),
      candidatesByDate: new Map([
        ['2026-11-02', day1],
        ['2026-11-03', day2],
      ]),
      basePlaceId: BASE_PLACE,
      travel: travelMatrix(),
    })

    const ids = experienceItems(result.items).map((i) => i.experienceId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('allows a transport product more than once, because a return leg is real', () => {
    const transport = (slotId: string, startTime: string) =>
      scored({
        ...candidate({ slotId, startTime, durationMinutes: 30 }),
        experienceId: 'exp-transfer',
        category: ExperienceCategory.TRANSPORT,
      })

    const result = generateItinerary({
      startDate: '2026-11-02',
      endDate: '2026-11-03',
      guest: guest({ interests: [ExperienceCategory.TRANSPORT] }),
      candidatesByDate: new Map([
        ['2026-11-02', [transport('a', '10:00')]],
        ['2026-11-03', [transport('b', '10:00')]],
      ]),
      basePlaceId: BASE_PLACE,
      travel: travelMatrix(),
    })

    expect(experienceItems(result.items)).toHaveLength(2)
  })

  it('reports an interest it could not schedule at all', () => {
    const wellnessSeeker = guest({
      interests: [ExperienceCategory.SURF, ExperienceCategory.WELLNESS],
    })
    const candidates = [scored(candidate({ slotId: 'a', startTime: '09:00' }), wellnessSeeker)]

    const result = generateItinerary({
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      guest: wellnessSeeker,
      candidatesByDate: new Map([['2026-11-02', candidates]]),
      basePlaceId: BASE_PLACE,
      travel: travelMatrix(),
    })

    const codes = result.unmetConstraints.map((u) => u.code)
    expect(codes).toContain('interest_not_scheduled')
  })

  it('does not report interests when personalization was not consented to', () => {
    const noConsent = guest({
      interests: [],
      personalizationAllowed: false,
    })
    const candidates = [scored(candidate({ slotId: 'a', startTime: '09:00' }), noConsent)]

    const result = generateItinerary({
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      guest: noConsent,
      candidatesByDate: new Map([['2026-11-02', candidates]]),
      basePlaceId: BASE_PLACE,
      travel: travelMatrix(),
    })

    expect(result.unmetConstraints.map((u) => u.code)).not.toContain('interest_not_scheduled')
  })

  it('flags a trip it could not fill at all as a catalog gap', () => {
    const result = generateItinerary({
      startDate: '2026-11-02',
      endDate: '2026-11-04',
      guest: guest(),
      candidatesByDate: new Map(),
      basePlaceId: BASE_PLACE,
      travel: travelMatrix(),
    })

    const empty = result.unmetConstraints.find((u) => u.code === 'empty_itinerary')
    expect(empty?.message).toMatch(/catalog gap on our side/)
  })

  it('covers every day of the window and totals the estimate', () => {
    const result = generateItinerary({
      startDate: '2026-11-02',
      endDate: '2026-11-05',
      guest: guest(),
      candidatesByDate: new Map([
        ['2026-11-02', [scored(candidate({ slotId: 'a', startTime: '09:00' }))]],
        ['2026-11-04', [scored(candidate({ slotId: 'b', startTime: '09:00' }))]],
      ]),
      basePlaceId: BASE_PLACE,
      travel: travelMatrix(),
    })

    expect(result.dayStats).toHaveLength(4)
    expect(result.dayStats.map((d) => d.dayIndex)).toEqual([0, 1, 2, 3])
    expect(result.estimatedTotalMinor).toBe(
      result.items.reduce((n, i) => n + i.estimatedCostMinor, 0),
    )
  })

  it('is deterministic: identical input produces an identical plan', () => {
    const build = () =>
      generateItinerary({
        startDate: '2026-11-02',
        endDate: '2026-11-03',
        guest: guest(),
        candidatesByDate: new Map([
          [
            '2026-11-02',
            [
              scored(candidate({ slotId: 'a', startTime: '09:00' })),
              scored(candidate({ slotId: 'b', startTime: '14:00' })),
            ],
          ],
        ]),
        basePlaceId: BASE_PLACE,
        travel: travelMatrix(),
      })

    expect(JSON.stringify(build())).toBe(JSON.stringify(build()))
  })

  it('excludes a candidate the safety gate refused', () => {
    const refused = {
      ...scored(candidate({ slotId: 'a', startTime: '09:00' })),
      included: false,
      exclusions: ['conditions_risk_above_activity_limit'],
    }

    const result = generateItinerary({
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      guest: guest(),
      candidatesByDate: new Map([['2026-11-02', [refused]]]),
      basePlaceId: BASE_PLACE,
      travel: travelMatrix(),
    })

    expect(experienceItems(result.items)).toHaveLength(0)
  })
})

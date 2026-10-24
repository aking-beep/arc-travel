import { ItineraryItemKind, type TransportMode } from '@/lib/prisma-types'
import { addDays, daysBetween, formatTime, parseTime, type DateKey } from '@/lib/dates'
import type { TravelMatrix } from '@/modules/destination/travel'
import {
  INTENSE_RECOVERY_MINUTES,
  INTENSITY_THRESHOLD,
  MAX_TRAVEL_MINUTES_PER_HOP,
  MIN_GAP_MINUTES,
  PACE_LIMITS,
  rankCandidates,
  type GuestPreferences,
  type ScoredCandidate,
} from './scoring'

/**
 * Day-by-day itinerary assembly.
 *
 * A pure function over already-scored candidates. It holds no database access
 * and no clock of its own, so the same inputs always produce the same plan —
 * which is what makes the feasibility rules testable and the output
 * reproducible for a guest who reloads the page.
 *
 * The greedy approach is deliberate. An optimal solver would produce a slightly
 * denser plan and a much worse explanation; a guest asking "why is this here?"
 * deserves an answer like "it was the best fit left that fit in the morning",
 * not a dual value from a solver.
 *
 * Every constraint it cannot satisfy is recorded in `unmetConstraints` and
 * shown to the guest, rather than quietly producing a thinner plan.
 */
export const GENERATOR_VERSION = 'v1'

/** Local day boundaries. Nothing is scheduled outside these. */
export const DAY_START = '06:00'
export const DAY_END = '22:30'

export interface PlannedItem {
  kind: ItineraryItemKind
  dayIndex: number
  date: DateKey
  startTime: string
  endTime: string
  experienceId: string | null
  slotId: string | null
  placeId: string | null
  title: string
  score: number
  rationale: string[]
  estimatedCostMinor: number
  currency: string
  travelMinutesFromPrev: number
  travelModeFromPrev: TransportMode | null
}

export interface UnmetConstraint {
  /** Machine-readable so analytics can count them. */
  code: string
  /** Guest-facing sentence. */
  message: string
  date?: DateKey
}

export interface GeneratedItinerary {
  generatorVersion: string
  items: PlannedItem[]
  unmetConstraints: UnmetConstraint[]
  estimatedTotalMinor: number
  currency: string
  /** Per-day diagnostics, used by the owner-facing analytics. */
  dayStats: Array<{
    date: DateKey
    dayIndex: number
    experienceCount: number
    activeMinutes: number
    estimatedCostMinor: number
    budgetExceeded: boolean
  }>
}

export interface GenerateInput {
  startDate: DateKey
  endDate: DateKey
  guest: GuestPreferences
  /** Scored candidates keyed by the calendar day they belong to. */
  candidatesByDate: Map<DateKey, ScoredCandidate[]>
  /** The property's place, the origin and destination of every day. */
  basePlaceId: string | null
  travel: TravelMatrix
  currency?: string
}

interface Placed {
  item: PlannedItem
  endMinutes: number
  intensity: number
  placeId: string | null
}

export function generateItinerary(input: GenerateInput): GeneratedItinerary {
  const currency = input.currency ?? 'MXN'
  const { guest } = input
  const limits = PACE_LIMITS[guest.pace]

  const span = daysBetween(input.startDate, input.endDate)
  const dates: DateKey[] = []
  for (let i = 0; i <= span; i += 1) dates.push(addDays(input.startDate, i))

  const items: PlannedItem[] = []
  const unmet: UnmetConstraint[] = []
  const dayStats: GeneratedItinerary['dayStats'] = []

  // An experience is offered once per trip. Transport is the exception: an
  // airport transfer in and out is two legitimate bookings of one product.
  const usedExperienceIds = new Set<string>()

  for (const [dayIndex, date] of dates.entries()) {
    const pool = rankCandidates(input.candidatesByDate.get(date) ?? []).filter((c) => c.included)
    const placed: Placed[] = []
    let activeMinutes = 0
    let dayCostPerPerson = 0

    if (pool.length === 0) {
      unmet.push({
        code: 'no_eligible_experiences',
        message:
          'Nothing in the catalog cleared the safety and suitability checks for this date.',
        date,
      })
    }

    for (const scored of pool) {
      if (placed.length >= limits.maxPerDay) break

      const candidate = scored.candidate
      const isTransport = candidate.category === 'TRANSPORT'

      if (!isTransport && usedExperienceIds.has(candidate.experienceId)) continue

      const startMinutes = parseTime(candidate.startTime)
      const endMinutes = startMinutes + candidate.durationMinutes

      if (startMinutes < parseTime(DAY_START) || endMinutes > parseTime(DAY_END)) continue

      // --- Travel feasibility from whatever precedes it today ---------------
      const previous = placed.length > 0 ? placed[placed.length - 1] : null
      const fromPlaceId = previous?.placeId ?? input.basePlaceId
      const travel =
        fromPlaceId && candidate.placeId
          ? input.travel.get(fromPlaceId, candidate.placeId)
          : { minutes: 0, mode: null as TransportMode | null, costMinor: 0 }

      if (travel.minutes > MAX_TRAVEL_MINUTES_PER_HOP && previous) {
        continue
      }

      // --- Overlap, travel and recovery -------------------------------------
      if (previous) {
        const recovery =
          previous.intensity >= INTENSITY_THRESHOLD ? INTENSE_RECOVERY_MINUTES : MIN_GAP_MINUTES
        const earliestFeasibleStart = previous.endMinutes + travel.minutes + recovery
        if (startMinutes < earliestFeasibleStart) continue
      } else if (travel.minutes > 0 && startMinutes - travel.minutes < parseTime(DAY_START)) {
        continue
      }

      // --- Daily load --------------------------------------------------------
      if (activeMinutes + candidate.durationMinutes > limits.maxActiveMinutes) continue

      // --- Daily budget, per person -----------------------------------------
      const perPersonCost =
        candidate.unitPriceMinor +
        Math.round(candidate.bookingFeeMinor / Math.max(1, guest.partySize)) +
        Math.round(travel.costMinor / Math.max(1, guest.partySize))

      if (
        guest.budgetPerDayMinor !== null &&
        dayCostPerPerson + perPersonCost > guest.budgetPerDayMinor
      ) {
        unmet.push({
          code: 'budget_exceeded',
          message: `${candidate.title} would have pushed this day past your daily budget, so it was left out.`,
          date,
        })
        continue
      }

      const rationale = [...scored.reasons]
      if (travel.minutes > 0 && travel.mode) {
        rationale.push(
          `${travel.minutes} minutes by ${travel.mode.toLowerCase()} from ${previous ? 'your previous stop' : 'the hotel'}.`,
        )
      }
      if (previous && previous.intensity >= INTENSITY_THRESHOLD) {
        rationale.push('Scheduled after a recovery gap, because the previous activity was demanding.')
      }
      rationale.push(...scored.notes)

      /**
       * Whether the leg gets a block of its own.
       *
       * Decided before the experience item is built, because it decides which
       * of the two carries the fare. Counting it on both overstated the trip
       * total by the fare of every transfer long enough to be shown — and
       * disagreed with `dayCostPerPerson` above, which has always counted it
       * once. A guest could be shown a plan over the budget they set.
       */
      const showsTransferBlock = travel.minutes >= 15 && travel.mode !== null

      const item: PlannedItem = {
        kind: ItineraryItemKind.EXPERIENCE,
        dayIndex,
        date,
        startTime: formatTime(startMinutes),
        endTime: formatTime(endMinutes),
        experienceId: candidate.experienceId,
        slotId: candidate.slotId,
        placeId: candidate.placeId,
        title: candidate.title,
        score: scored.score,
        rationale,
        // The fare belongs to whichever block represents the journey.
        estimatedCostMinor:
          candidate.unitPriceMinor * guest.partySize +
          candidate.bookingFeeMinor +
          (showsTransferBlock ? 0 : travel.costMinor),
        currency,
        travelMinutesFromPrev: travel.minutes,
        travelModeFromPrev: travel.mode,
      }

      // A transfer with real travel time gets its own visible block, so the
      // guest sees the 40-minute shuttle rather than wondering where it went.
      if (showsTransferBlock && travel.mode) {
        placed.push({
          item: {
            kind: ItineraryItemKind.TRANSFER,
            dayIndex,
            date,
            startTime: formatTime(startMinutes - travel.minutes),
            endTime: candidate.startTime,
            experienceId: null,
            slotId: null,
            placeId: candidate.placeId,
            title: `Travel to ${candidate.title}`,
            score: 0,
            rationale: [`${travel.minutes} minutes by ${travel.mode.toLowerCase()}.`],
            estimatedCostMinor: travel.costMinor,
            currency,
            travelMinutesFromPrev: travel.minutes,
            travelModeFromPrev: travel.mode,
          },
          endMinutes: startMinutes,
          intensity: 0,
          placeId: candidate.placeId,
        })
      }

      placed.push({
        item,
        endMinutes,
        intensity: candidate.activityPhysicalIntensity,
        placeId: candidate.placeId,
      })

      activeMinutes += candidate.durationMinutes
      dayCostPerPerson += perPersonCost
      if (!isTransport) usedExperienceIds.add(candidate.experienceId)
    }

    const experienceItems = placed.filter((p) => p.item.kind === ItineraryItemKind.EXPERIENCE)

    if (experienceItems.length === 0 && pool.length > 0) {
      unmet.push({
        code: 'nothing_fit_the_day',
        message:
          'Eligible experiences existed for this date but none fitted alongside your pace, budget and travel time.',
        date,
      })
    }

    // --- Fill the gaps so a day reads as a day, not a list of bookings ------
    const filled = [...placed.map((p) => p.item)]

    if (experienceItems.length > 0) {
      const lastEnd = Math.max(...experienceItems.map((p) => p.endMinutes))
      const firstStart = Math.min(...experienceItems.map((p) => parseTime(p.item.startTime)))

      // A midday meal, if there is actually room for one.
      const lunchStart = 13 * 60 + 30
      const lunchClear = placed.every(
        (p) => p.endMinutes <= lunchStart || parseTime(p.item.startTime) >= lunchStart + 75,
      )
      if (lunchClear && firstStart <= lunchStart && lastEnd >= lunchStart) {
        filled.push({
          kind: ItineraryItemKind.MEAL,
          dayIndex,
          date,
          startTime: formatTime(lunchStart),
          endTime: formatTime(lunchStart + 75),
          experienceId: null,
          slotId: null,
          placeId: null,
          title: 'Lunch',
          score: 0,
          rationale: ['Left open deliberately — eat wherever you end up.'],
          estimatedCostMinor: 0,
          currency,
          travelMinutesFromPrev: 0,
          travelModeFromPrev: null,
        })
      }

      // Explicit recovery after anything demanding.
      const demanding = experienceItems.find((p) => p.intensity >= INTENSITY_THRESHOLD)
      if (demanding && demanding.endMinutes + 120 < parseTime(DAY_END)) {
        filled.push({
          kind: ItineraryItemKind.REST,
          dayIndex,
          date,
          startTime: formatTime(demanding.endMinutes + 15),
          endTime: formatTime(demanding.endMinutes + 120),
          experienceId: null,
          slotId: null,
          placeId: input.basePlaceId,
          title: 'Rest',
          score: 0,
          rationale: ['Blocked out on purpose after a physically demanding session.'],
          estimatedCostMinor: 0,
          currency,
          travelMinutesFromPrev: 0,
          travelModeFromPrev: null,
        })
      }
    } else {
      filled.push({
        kind: ItineraryItemKind.FREE_TIME,
        dayIndex,
        date,
        startTime: '09:00',
        endTime: '18:00',
        experienceId: null,
        slotId: null,
        placeId: input.basePlaceId,
        title: 'Open day',
        score: 0,
        rationale: ['Nothing booked. The local guide has ideas that need no reservation.'],
        estimatedCostMinor: 0,
        currency,
        travelMinutesFromPrev: 0,
        travelModeFromPrev: null,
      })
    }

    filled.sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime))
    items.push(...filled)

    dayStats.push({
      date,
      dayIndex,
      experienceCount: experienceItems.length,
      activeMinutes,
      estimatedCostMinor: filled.reduce((n, i) => n + i.estimatedCostMinor, 0),
      budgetExceeded:
        guest.budgetPerDayMinor !== null && dayCostPerPerson > guest.budgetPerDayMinor,
    })
  }

  // --- Trip-level observations ---------------------------------------------
  if (guest.personalizationAllowed) {
    const scheduledCategories = new Set(
      items
        .filter((i) => i.kind === ItineraryItemKind.EXPERIENCE)
        .map((i) => input.candidatesByDate.get(i.date)?.find((c) => c.candidate.slotId === i.slotId))
        .map((c) => c?.candidate.category)
        .filter((c): c is NonNullable<typeof c> => Boolean(c)),
    )
    for (const interest of guest.interests) {
      if (!scheduledCategories.has(interest)) {
        unmet.push({
          code: 'interest_not_scheduled',
          message: `We could not fit anything in ${interest.toLowerCase()} into these dates.`,
        })
      }
    }
  }

  const totalExperiences = items.filter((i) => i.kind === ItineraryItemKind.EXPERIENCE).length
  if (totalExperiences === 0) {
    unmet.push({
      code: 'empty_itinerary',
      message:
        'We could not build a single bookable day from these dates. That is a catalog gap on our side, not a problem with your preferences.',
    })
  }

  return {
    generatorVersion: GENERATOR_VERSION,
    items,
    // Duplicate codes on the same date add nothing for a guest reading them.
    unmetConstraints: dedupeConstraints(unmet),
    estimatedTotalMinor: items.reduce((n, i) => n + i.estimatedCostMinor, 0),
    currency,
    dayStats,
  }
}

function dedupeConstraints(constraints: UnmetConstraint[]): UnmetConstraint[] {
  const seen = new Set<string>()
  const out: UnmetConstraint[] = []
  for (const constraint of constraints) {
    const key = `${constraint.code}:${constraint.date ?? ''}:${constraint.message}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(constraint)
  }
  return out
}

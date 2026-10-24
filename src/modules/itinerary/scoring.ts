import { AbilityLevel, ConditionsRisk, ExperienceCategory, Pace } from '@/lib/prisma-types'
import { abilityRank, riskRank, type ConditionsGate } from '@/modules/destination/conditions'
import { type DateKey } from '@/lib/dates'
import { gateByOperatingWindow } from '@/modules/destination/operating-window'

/**
 * Deterministic matching and scoring.
 *
 * This runs before any language model is involved and is the only thing that
 * decides what a guest is offered. The AI layer may later rephrase a `reason`
 * string produced here; it cannot add a candidate, remove an exclusion or
 * change a score. That separation is the whole point: an explanation that turns
 * out to be wrong is embarrassing, whereas a recommendation that turns out to
 * be wrong can put someone in the water on the wrong day.
 *
 * Scoring is a weighted sum out of 100. The weights encode a product opinion —
 * what someone came here for matters more than saving them a taxi fare — and
 * are stated as named constants so they can be argued about explicitly.
 */
export const WEIGHTS = {
  interest: 30,
  abilityFit: 25,
  budgetFit: 20,
  conditionsQuality: 12,
  proximity: 8,
  verifiedSupplier: 5,
} as const

export const PACE_LIMITS: Record<Pace, { maxPerDay: number; maxActiveMinutes: number }> = {
  [Pace.RELAXED]: { maxPerDay: 1, maxActiveMinutes: 240 },
  [Pace.BALANCED]: { maxPerDay: 2, maxActiveMinutes: 390 },
  [Pace.PACKED]: { maxPerDay: 3, maxActiveMinutes: 540 },
}

/** Minimum gap between items, so a plan is livable rather than merely legal. */
export const MIN_GAP_MINUTES = 45
/** Extra recovery required after something physically demanding. */
export const INTENSE_RECOVERY_MINUTES = 90
export const INTENSITY_THRESHOLD = 4
/** Beyond this, a hop stops being worth it inside a single day. */
export const MAX_TRAVEL_MINUTES_PER_HOP = 50

export interface GuestPreferences {
  ability: AbilityLevel | null
  interests: ExperienceCategory[]
  pace: Pace
  partySize: number
  /** Per person, per day, in minor units. Null means unstated. */
  budgetPerDayMinor: number | null
  mobilityNotes: string | null
  /** True only when the guest granted PERSONALIZATION consent. */
  personalizationAllowed: boolean
}

export interface Candidate {
  experienceId: string
  slotId: string
  title: string
  category: ExperienceCategory
  placeId: string | null
  /** Per-person price in minor units, already resolved server-side. */
  unitPriceMinor: number
  bookingFeeMinor: number
  currency: string
  durationMinutes: number
  startsAt: Date
  /** Local wall-clock start, "HH:MM". */
  startTime: string
  capacityRemaining: number
  minParty: number
  maxParty: number
  minAgeYears: number | null
  experienceMinAbility: AbilityLevel
  experienceMaxAbility: AbilityLevel
  activityMinAbility: AbilityLevel
  activityMaxAbility: AbilityLevel
  activityMaxSafeRisk: ConditionsRisk
  activityGuideRequired: boolean
  activityPhysicalIntensity: number
  activitySeasonMonths: number[]
  activityEarliestStart: string
  activityLatestStart: string
  experienceGuideIncluded: boolean
  supplierVerified: boolean
  conditionsSensitive: boolean
  placeBaselineRisk: ConditionsRisk | null
  /** Minutes from the property to this candidate's place. */
  travelMinutesFromBase: number
  /** Round-trip travel cost from the property, in minor units. */
  travelCostMinor: number
}

export interface ScoredCandidate {
  candidate: Candidate
  score: number
  /** Why it scored as it did. Deterministic, guest-facing sentences. */
  reasons: string[]
  /** Machine-readable codes for every hard filter it failed. */
  exclusions: string[]
  /** Advisory notes, including conditions caveats. Shown even when included. */
  notes: string[]
  included: boolean
}

/**
 * Hard filters. Every one of these disqualifies a candidate outright; none of
 * them is a scoring penalty, because "slightly too dangerous" is not a thing.
 */
export function applyHardFilters(
  candidate: Candidate,
  guest: GuestPreferences,
  gate: ConditionsGate,
  forDate: DateKey,
): { exclusions: string[]; notes: string[] } {
  const exclusions = [...gate.exclusions]
  const notes = [...gate.notes]

  if (guest.ability) {
    if (abilityRank(guest.ability) < abilityRank(candidate.experienceMinAbility)) {
      exclusions.push('ability_below_experience_minimum')
    }
    if (abilityRank(guest.ability) > abilityRank(candidate.experienceMaxAbility)) {
      // Not a safety exclusion — being too good for a beginner lesson just
      // makes it a poor use of a morning.
      exclusions.push('ability_above_experience_maximum')
      notes.push('Pitched below your level — you would likely be bored.')
    }
  }

  if (guest.partySize > candidate.maxParty) {
    exclusions.push('party_too_large')
    notes.push(`Takes at most ${candidate.maxParty} people; there are ${guest.partySize} of you.`)
  }
  if (guest.partySize < candidate.minParty) {
    exclusions.push('party_too_small')
    notes.push(`Needs at least ${candidate.minParty} people to run.`)
  }

  if (candidate.capacityRemaining < guest.partySize) {
    exclusions.push('insufficient_capacity')
    notes.push(
      candidate.capacityRemaining <= 0
        ? 'This departure is full.'
        : `Only ${candidate.capacityRemaining} ${candidate.capacityRemaining === 1 ? 'place' : 'places'} left on this departure.`,
    )
  }

  // The same pure gate `evaluateSlotForGuest` runs, so a departure the planner
  // refuses to recommend is a departure the basket refuses to take.
  const window = gateByOperatingWindow({
    window: {
      earliestStart: candidate.activityEarliestStart,
      latestStart: candidate.activityLatestStart,
      seasonMonths: candidate.activitySeasonMonths,
    },
    startTime: candidate.startTime,
    forDate,
  })
  exclusions.push(...window.exclusions)
  notes.push(...window.notes)

  // Mobility is a free-text note, so this is a heuristic and labelled as one
  // rather than silently filtering. Carrizalillo's ~160 steps are the specific
  // thing guests tell us about.
  if (guest.mobilityNotes && /stair|step|knee|hip|walk|mobility|wheelchair/i.test(guest.mobilityNotes)) {
    if (candidate.activityPhysicalIntensity >= INTENSITY_THRESHOLD) {
      exclusions.push('mobility_note_conflicts_with_intensity')
      notes.push('Physically demanding, and you mentioned a mobility constraint.')
    }
  }

  return { exclusions: [...new Set(exclusions)], notes: [...new Set(notes)] }
}

/** Where in the experience's ability band the guest sits, as 0..1 fit quality. */
function abilityFit(guest: AbilityLevel | null, min: AbilityLevel, max: AbilityLevel): number {
  if (!guest) return 0.5
  const g = abilityRank(guest)
  const lo = abilityRank(min)
  const hi = abilityRank(max)
  if (g < lo || g > hi) return 0

  // A band of one level is a perfect fit by definition. Otherwise reward being
  // in the middle of the band over scraping its edge.
  if (hi === lo) return 1
  const position = (g - lo) / (hi - lo)
  return 1 - Math.abs(position - 0.5) * 0.6
}

function budgetFit(perPersonCostMinor: number, budgetMinor: number | null): number {
  if (budgetMinor === null || budgetMinor <= 0) return 0.6
  if (perPersonCostMinor <= budgetMinor * 0.6) return 1
  if (perPersonCostMinor <= budgetMinor) return 0.85
  if (perPersonCostMinor <= budgetMinor * 1.25) return 0.4
  return 0
}

function conditionsQuality(gate: ConditionsGate): number {
  if (!gate.snapshot) return 0.5
  const byRisk = [1, 0.8, 0.45, 0.15][riskRank(gate.snapshot.risk)] ?? 0.5
  return gate.snapshot.isStale ? byRisk * 0.7 : byRisk
}

function proximity(travelMinutes: number): number {
  if (travelMinutes <= 10) return 1
  if (travelMinutes <= 20) return 0.8
  if (travelMinutes <= 35) return 0.55
  if (travelMinutes <= 50) return 0.3
  return 0.1
}

/**
 * Scores one candidate for one guest on one date.
 *
 * Interest matching is gated on consent: without PERSONALIZATION the stated
 * interests are not used at all and every category is treated alike, which is
 * why an unconsented guest sees a fair catalog rather than a worse one.
 */
export function scoreCandidate(
  candidate: Candidate,
  guest: GuestPreferences,
  gate: ConditionsGate,
  forDate: DateKey,
): ScoredCandidate {
  const { exclusions, notes } = applyHardFilters(candidate, guest, gate, forDate)

  const perPersonCost =
    candidate.unitPriceMinor +
    Math.round(candidate.bookingFeeMinor / Math.max(1, guest.partySize)) +
    Math.round(candidate.travelCostMinor / Math.max(1, guest.partySize))

  const reasons: string[] = []
  let score = 0

  const interestMatched =
    guest.personalizationAllowed && guest.interests.includes(candidate.category)
  if (interestMatched) {
    score += WEIGHTS.interest
    reasons.push(`You said you were here for ${candidate.category.toLowerCase()}.`)
  } else if (!guest.personalizationAllowed) {
    // Neutral baseline: no consent, no interest signal, no penalty either.
    score += WEIGHTS.interest * 0.5
  }

  const fit = abilityFit(guest.ability, candidate.experienceMinAbility, candidate.experienceMaxAbility)
  score += WEIGHTS.abilityFit * fit
  if (guest.ability && fit >= 0.85) {
    reasons.push(`Pitched at ${guest.ability.toLowerCase()} level, which is where you put yourself.`)
  }

  const budget = budgetFit(perPersonCost, guest.budgetPerDayMinor)
  score += WEIGHTS.budgetFit * budget
  if (guest.budgetPerDayMinor && budget >= 0.85) {
    reasons.push('Comfortably inside your daily budget.')
  } else if (guest.budgetPerDayMinor && budget === 0) {
    notes.push('Above the daily budget you gave us.')
  }

  const quality = conditionsQuality(gate)
  score += WEIGHTS.conditionsQuality * quality
  if (gate.snapshot && gate.snapshot.risk === ConditionsRisk.LOW) {
    reasons.push(
      `Conditions were rated low risk when read at ${gate.snapshot.observedAt.toISOString().slice(11, 16)} UTC.`,
    )
  }

  const near = proximity(candidate.travelMinutesFromBase)
  score += WEIGHTS.proximity * near
  if (candidate.travelMinutesFromBase <= 15) {
    reasons.push(`${candidate.travelMinutesFromBase} minutes from the hotel.`)
  }

  if (candidate.supplierVerified) {
    score += WEIGHTS.verifiedSupplier
    reasons.push('Partner documents have been checked by ARC.')
  } else {
    notes.push('ARC has not verified this partner’s documents.')
  }

  return {
    candidate,
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons,
    exclusions,
    notes: [...new Set(notes)],
    included: exclusions.length === 0,
  }
}

export function rankCandidates(scored: ScoredCandidate[]): ScoredCandidate[] {
  return [...scored].sort((a, b) => {
    if (a.included !== b.included) return a.included ? -1 : 1
    if (b.score !== a.score) return b.score - a.score
    // Stable tiebreak so the same inputs always produce the same plan.
    return a.candidate.slotId.localeCompare(b.candidate.slotId)
  })
}

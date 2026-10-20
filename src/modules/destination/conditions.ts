import { prisma } from '@/lib/db'
import { AbilityLevel, ConditionsRisk } from '@/lib/prisma-types'
import { fromDateKey, type DateKey } from '@/lib/dates'

/**
 * Ocean and terrain conditions.
 *
 * Three rules govern everything in this file, and they are the reason it is a
 * module of its own rather than a query inline in the itinerary code:
 *
 *   1. A reading is never presented without its age and its source. Callers get
 *      `observedAt`, `ageHours` and `isStale` and the UI is built to show them.
 *   2. ARC states conditions; it never asserts safety. There is no function here
 *      that returns "safe" — only `risk`, `minAbilityRequired` and whether a
 *      given activity may be *recommended* at all.
 *   3. Absence of a reading is not permission. When no report exists for a
 *      place and date, `gateByConditions` falls back to the place's baseline
 *      character and says it is doing so.
 */
export const RISK_ORDER = [
  ConditionsRisk.LOW,
  ConditionsRisk.MODERATE,
  ConditionsRisk.HIGH,
  ConditionsRisk.EXTREME,
] as const

export const ABILITY_ORDER = [
  AbilityLevel.BEGINNER,
  AbilityLevel.IMPROVER,
  AbilityLevel.INTERMEDIATE,
  AbilityLevel.ADVANCED,
  AbilityLevel.EXPERT,
] as const

export const riskRank = (risk: ConditionsRisk): number => RISK_ORDER.indexOf(risk)
export const abilityRank = (level: AbilityLevel): number => ABILITY_ORDER.indexOf(level)

/** A reading older than this is shown as history, not as current information. */
export const STALE_AFTER_HOURS = 12

export interface ConditionsSnapshot {
  placeId: string
  forDate: DateKey
  risk: ConditionsRisk
  minAbilityRequired: AbilityLevel
  guideRecommended: boolean
  waveHeightMinM: number
  waveHeightMaxM: number
  windKph: number | null
  windDirection: string | null
  waterTempC: number | null
  highTideLocal: string | null
  lowTideLocal: string | null
  currentNotesEn: string | null
  currentNotesEs: string | null
  source: string
  observedAt: Date
  ageHours: number
  isStale: boolean
}

function toSnapshot(
  row: {
    placeId: string
    forDate: Date
    risk: ConditionsRisk
    minAbilityRequired: AbilityLevel
    guideRecommended: boolean
    waveHeightMinM: number
    waveHeightMaxM: number
    windKph: number | null
    windDirection: string | null
    waterTempC: number | null
    highTideLocal: string | null
    lowTideLocal: string | null
    currentNotesEn: string | null
    currentNotesEs: string | null
    source: string
    observedAt: Date
  },
  now: Date,
): ConditionsSnapshot {
  const ageHours = (now.getTime() - row.observedAt.getTime()) / 3_600_000
  return {
    placeId: row.placeId,
    forDate: row.forDate.toISOString().slice(0, 10),
    risk: row.risk,
    minAbilityRequired: row.minAbilityRequired,
    guideRecommended: row.guideRecommended,
    waveHeightMinM: row.waveHeightMinM,
    waveHeightMaxM: row.waveHeightMaxM,
    windKph: row.windKph,
    windDirection: row.windDirection,
    waterTempC: row.waterTempC,
    highTideLocal: row.highTideLocal,
    lowTideLocal: row.lowTideLocal,
    currentNotesEn: row.currentNotesEn,
    currentNotesEs: row.currentNotesEs,
    source: row.source,
    observedAt: row.observedAt,
    ageHours: Math.round(ageHours * 10) / 10,
    isStale: ageHours > STALE_AFTER_HOURS,
  }
}

export async function getConditions(
  placeIds: string[],
  dates: DateKey[],
  now = new Date(),
): Promise<Map<string, ConditionsSnapshot>> {
  if (placeIds.length === 0 || dates.length === 0) return new Map()

  const rows = await prisma.conditionReport.findMany({
    where: { placeId: { in: placeIds }, forDate: { in: dates.map(fromDateKey) } },
  })

  const out = new Map<string, ConditionsSnapshot>()
  for (const row of rows) {
    const snapshot = toSnapshot(row, now)
    out.set(`${snapshot.placeId}:${snapshot.forDate}`, snapshot)
  }
  return out
}

export async function getConditionsForDestination(
  destination = 'puerto-escondido',
  dates: DateKey[] = [],
  now = new Date(),
) {
  const places = await prisma.place.findMany({
    where: { destination, conditionReports: { some: {} } },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      slug: true,
      name: true,
      kind: true,
      typicalRisk: true,
      safetyNotesEn: true,
      safetyNotesEs: true,
      latitude: true,
      longitude: true,
      conditionReports: {
        where: dates.length > 0 ? { forDate: { in: dates.map(fromDateKey) } } : {},
        orderBy: { forDate: 'asc' },
      },
    },
  })

  return places.map((place) => ({
    ...place,
    reports: place.conditionReports.map((r) => toSnapshot(r, now)),
  }))
}

/** Why a candidate was, or was not, allowed through the conditions gate. */
export interface ConditionsGate {
  allowed: boolean
  /** Machine-readable exclusion codes for the recommendation record. */
  exclusions: string[]
  /** Human-readable, deterministic sentences shown to the guest. */
  notes: string[]
  snapshot: ConditionsSnapshot | null
  /** True when no reading existed and the place's baseline was used instead. */
  usedBaseline: boolean
}

/**
 * The hard safety gate.
 *
 * Runs before any scoring and before any AI involvement. Three independent
 * checks, each of which alone disqualifies a candidate:
 *
 *   * The day's risk exceeds the highest risk the activity may run in at all.
 *   * The day demands more ability than the guest has.
 *   * The activity demands more ability than the guest has.
 *
 * It returns "allowed", never "safe". Allowed means ARC is willing to show it;
 * whether to enter the water remains a decision for the guest, their guide and
 * the lifeguards, and the UI says so.
 */
export function gateByConditions(input: {
  guestAbility: AbilityLevel | null
  activityMaxSafeRisk: ConditionsRisk
  activityMinAbility: AbilityLevel
  activityGuideRequired: boolean
  experienceGuideIncluded: boolean
  /** Null for anything that does not depend on the water or the weather. */
  snapshot: ConditionsSnapshot | null
  placeBaselineRisk?: ConditionsRisk | null
  /** False for land-based activities, which skip the conditions checks. */
  conditionsSensitive: boolean
}): ConditionsGate {
  const exclusions: string[] = []
  const notes: string[] = []

  // A guide-required activity sold without a guide is never recommendable,
  // conditions or not.
  if (input.activityGuideRequired && !input.experienceGuideIncluded) {
    exclusions.push('guide_required_but_not_included')
    notes.push('This activity requires a certified guide and this version does not include one.')
  }

  // Ability floor from the activity itself applies on land and water alike.
  if (input.guestAbility && abilityRank(input.guestAbility) < abilityRank(input.activityMinAbility)) {
    exclusions.push('ability_below_activity_minimum')
    notes.push(
      `Needs ${input.activityMinAbility.toLowerCase()} experience or above; you told us ${input.guestAbility.toLowerCase()}.`,
    )
  }

  if (!input.conditionsSensitive) {
    return {
      allowed: exclusions.length === 0,
      exclusions,
      notes,
      snapshot: null,
      usedBaseline: false,
    }
  }

  const snapshot = input.snapshot
  const usedBaseline = snapshot === null

  // No reading is not a green light. Fall back to the place's baseline
  // character and say that is what we did.
  const effectiveRisk = snapshot?.risk ?? input.placeBaselineRisk ?? ConditionsRisk.HIGH
  if (usedBaseline) {
    notes.push(
      'No conditions reading for this date. Judged against this spot’s typical character instead — treat it as a guess, not a forecast.',
    )
  }

  if (riskRank(effectiveRisk) > riskRank(input.activityMaxSafeRisk)) {
    exclusions.push('conditions_risk_above_activity_limit')
    notes.push(
      `Conditions are rated ${effectiveRisk.toLowerCase()} and this activity does not run above ${input.activityMaxSafeRisk.toLowerCase()}.`,
    )
  }

  if (
    snapshot &&
    input.guestAbility &&
    abilityRank(input.guestAbility) < abilityRank(snapshot.minAbilityRequired)
  ) {
    exclusions.push('conditions_demand_higher_ability')
    notes.push(
      `On this date the water demands ${snapshot.minAbilityRequired.toLowerCase()} ability or above.`,
    )
  }

  // An unknown ability is not treated as expert. Anything the day pushes past
  // improver level is withheld until the guest tells us where they stand.
  if (
    snapshot &&
    !input.guestAbility &&
    abilityRank(snapshot.minAbilityRequired) > abilityRank(AbilityLevel.IMPROVER)
  ) {
    exclusions.push('ability_unknown_and_conditions_demanding')
    notes.push(
      'Tell us your experience level and we can say whether this date suits you. We will not guess on a demanding day.',
    )
  }

  if (snapshot?.isStale) {
    notes.push(
      `This reading is ${Math.round(snapshot.ageHours)} hours old. Check with your guide before you commit.`,
    )
  }

  if (snapshot?.guideRecommended) {
    notes.push('A guide is recommended in these conditions.')
  }

  return { allowed: exclusions.length === 0, exclusions, notes, snapshot, usedBaseline }
}

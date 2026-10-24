import { addDays, daysBetween, toDateKey, type DateKey } from '@/lib/dates'
import { invalid } from '@/lib/errors'
import { MAX_PLANNABLE_NIGHTS, plannerIssues } from './schemas'
import { destinations, getDestination } from './content/destinations'
import { experiences } from './content/experiences'
import { stays } from './content/stays'
import {
  CONTENT_CURRENCY,
  type Budget,
  type Itinerary,
  type ItineraryActivity,
  type ItineraryDayPlan,
  type Pace,
  type PlannerPreferences,
  type Property,
} from './content/types'

/**
 * The illustrative trip planner, ported from the Magic Patterns export.
 *
 * Four things changed on the way in, all of them commitments rather than taste.
 *
 * **It is not AI, and it may not say it is.** The export's `Itinerary['source']`
 * union included `'ai'`, which this function could have emitted while doing
 * arithmetic. The union is now `'sample' | 'rules-engine'`: a deterministic
 * planner cannot label its own output as a model's. The real engine lives in
 * `modules/itinerary` and the same rule governs it — the AI may rephrase the
 * reasons the engine produced and may not add a candidate, remove an exclusion
 * or change a score (non-negotiable 5).
 *
 * **Money is integer minor units.** The original multiplied float dollars by a
 * budget coefficient and rounded at the end. Every amount here is centavos of
 * `CONTENT_CURRENCY`, every coefficient is applied with `Math.round` to land
 * back on a whole minor unit, and no float leaves this file.
 *
 * **It reads no clock.** `buildItinerary` took `new Date()` for `createdAt` and
 * `alternativesFor` used `Date.now()` in an element key, so the same inputs gave
 * different output and a client component rendering either was reading an impure
 * source during render. Both now take the instant as a parameter.
 *
 * **It is illustrative, and gates nothing.** This planner has no conditions
 * gate, because the content it plans over is editorial rather than a real
 * catalogue with dated readings behind it. That is exactly why it may not be
 * the path to a booking: anything that commits a guest goes through
 * `modules/itinerary` and `modules/destination/conditions`, which do gate.
 */
export interface ItineraryGenerator {
  id: string
  label: string
  /** Whether a live model produced this. Always false here, and load-bearing. */
  isLive: boolean
  generate(prefs: PlannerPreferences, now: Date): Itinerary
}

/** Budget coefficients in basis points, so the arithmetic stays integral. */
const BUDGET_BPS: Record<Budget, number> = {
  Considered: 7_500,
  Comfort: 10_000,
  Luxury: 18_000,
}

const SLOTS_PER_PACE: Record<Pace, ItineraryActivity['time'][]> = {
  Slow: ['Morning', 'Evening'],
  Balanced: ['Morning', 'Afternoon', 'Evening'],
  Full: ['Morning', 'Afternoon', 'Afternoon', 'Evening'],
}

/** A basis-point share of a minor-unit amount, rounded half-up to the unit. */
const applyBps = (amountMinor: number, bps: number): number =>
  Math.floor((amountMinor * bps) / 10_000 + 0.5)

type PoolItem = Omit<ItineraryActivity, 'id' | 'time'> & { slot: ItineraryActivity['time'] | 'Any' }

/** Every candidate activity for a destination, in a stable order. */
export function activityPool(prefs: PlannerPreferences): PoolItem[] {
  // The brief is refused rather than quietly repaired. A reversed range used
  // to become a one-day trip and a party of zero priced the lodging at zero —
  // on the first screen a prospective hotel sees. The form shows the same
  // reasons and disables drafting, so this throw is a backstop for any other
  // caller.
  const issues = plannerIssues(prefs)
  if (issues.length > 0) {
    throw invalid('This brief cannot be planned as stated.', { issues })
  }

  const dest = getDestination(prefs.destination) ?? destinations[0]!
  const bps = BUDGET_BPS[prefs.budget]

  const exp = experiences
    .filter((e) => e.destination === dest.slug)
    .sort(
      (a, b) =>
        Number(prefs.activities.includes(b.category)) -
        Number(prefs.activities.includes(a.category)),
    )

  const fromExperiences: PoolItem[] = exp.map((e) => ({
    title: e.title,
    detail: `${e.duration} · ${e.difficulty} · hosted by ${e.host.name}`,
    costMinor: e.priceMinor,
    category: e.category,
    experienceSlug: e.slug,
    slot: e.durationHours > 5 ? 'Morning' : 'Any',
  }))

  const fromPreview: PoolItem[] = dest.itinerary.flatMap((d) => [
    {
      title: d.morning,
      detail: `Self-guided · ${d.title}`,
      costMinor: applyBps(1_500, bps),
      category: 'Free' as const,
      slot: 'Morning' as const,
    },
    {
      title: d.afternoon,
      detail: `Self-guided · ${d.title}`,
      costMinor: applyBps(2_000, bps),
      category: 'Free' as const,
      slot: 'Afternoon' as const,
    },
    {
      title: d.evening,
      detail: 'Dinner and evening',
      costMinor: applyBps(applyBps(dest.dailyFromMinor, 3_000), bps),
      category: 'Dining' as const,
      slot: 'Evening' as const,
    },
  ])

  const neighborhoods: PoolItem[] = dest.neighborhoods.map((n) => ({
    title: `Wander ${n.name}`,
    detail: n.vibe,
    costMinor: 0,
    category: 'Free',
    slot: 'Afternoon',
  }))

  return [...fromExperiences, ...fromPreview, ...neighborhoods]
}

/**
 * The stay a given budget points at: cheapest, median or dearest of the local
 * set. Not a recommendation — a deterministic pick over editorial content.
 */
export function pickStay(prefs: PlannerPreferences): Property | undefined {
  const local = stays.filter((s) => s.destination === prefs.destination)
  if (local.length === 0) return undefined

  const byType =
    prefs.accommodation === 'Any' ? local : local.filter((s) => s.type === prefs.accommodation)
  const list = byType.length > 0 ? byType : local
  const sorted = [...list].sort((a, b) => a.pricePerNightMinor - b.pricePerNightMinor)

  if (prefs.budget === 'Considered') return sorted[0]
  if (prefs.budget === 'Luxury') return sorted[sorted.length - 1]
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

/**
 * Nights between the stated dates.
 *
 * Still clamped, but the clamp no longer hides anything: `buildItinerary`
 * refuses a brief `plannerIssues` rejects, so by the time this runs the span is
 * known to be between one night and `MAX_PLANNABLE_NIGHTS`. The clamp remains
 * for the form, which calls this while a visitor is mid-edit.
 */
export function tripLength(prefs: PlannerPreferences): number {
  const nights = daysBetween(prefs.startDate, prefs.endDate)
  if (!Number.isFinite(nights)) return 5
  return Math.min(MAX_PLANNABLE_NIGHTS, Math.max(1, nights))
}

/**
 * Pure, synchronous and deterministic: the same preferences and the same
 * instant always give the same plan. `now` is a parameter precisely so a
 * component never has to read the clock to call this.
 */
export function buildItinerary(
  prefs: PlannerPreferences,
  now: Date,
  source: Itinerary['source'] = 'rules-engine',
  id?: string,
): Itinerary {
  // The brief is refused rather than quietly repaired. A reversed range used
  // to become a one-day trip and a party of zero priced the lodging at zero —
  // on the first screen a prospective hotel sees. The form shows the same
  // reasons and disables drafting, so this throw is a backstop for any other
  // caller.
  const issues = plannerIssues(prefs)
  if (issues.length > 0) {
    throw invalid('This brief cannot be planned as stated.', { issues })
  }

  const dest = getDestination(prefs.destination) ?? destinations[0]!
  const pool = activityPool(prefs)
  const stay = pickStay(prefs)
  const nights = tripLength(prefs)
  const rooms = Math.ceil(prefs.travelers / 2)

  const lodgingMinor = stay
    ? stay.pricePerNightMinor * rooms
    : applyBps(dest.dailyFromMinor, BUDGET_BPS[prefs.budget])

  const start: DateKey = /^\d{4}-\d{2}-\d{2}$/.test(prefs.startDate)
    ? prefs.startDate
    : toDateKey(now)

  const used = new Set<number>()
  const slots = SLOTS_PER_PACE[prefs.pace]

  const take = (slot: ItineraryActivity['time']): PoolItem | null => {
    let idx = pool.findIndex((p, i) => !used.has(i) && (p.slot === slot || p.slot === 'Any'))
    if (idx === -1) idx = pool.findIndex((_, i) => !used.has(i))
    if (idx === -1) return null
    used.add(idx)
    return pool[idx] ?? null
  }

  const days: ItineraryDayPlan[] = Array.from({ length: nights }, (_, d) => {
    const acts: ItineraryActivity[] = []

    if (d === 0) {
      acts.push({
        id: 'd1-arrive',
        time: 'Morning',
        title: `Arrive via ${dest.airport.split('(')[0]!.trim()}`,
        detail: 'Private transfer to your stay',
        costMinor: 3_500 * rooms,
        category: 'Logistics',
      })
    }

    slots.forEach((slot, si) => {
      if (d === 0 && si === 0) return
      const item = take(slot)
      if (item) {
        const { slot: _slot, ...rest } = item
        acts.push({ ...rest, id: `d${d + 1}-${si}`, time: slot })
      } else {
        acts.push({
          id: `d${d + 1}-${si}`,
          time: slot,
          title: 'Unscheduled time',
          detail: 'Rest, read, or follow a local tip',
          costMinor: 0,
          category: 'Free',
        })
      }
    })

    return {
      day: d + 1,
      date: addDays(start, d),
      theme: dest.itinerary[d % dest.itinerary.length]!.title,
      activities: acts,
      lodgingMinor,
    }
  })

  return {
    id: id ?? `itn-${dest.slug}-${prefs.startDate}-${prefs.pace}-${prefs.budget}`,
    title: `${nights} days in ${dest.name}`,
    createdAt: now.toISOString(),
    source,
    preferences: prefs,
    stay: stay?.slug,
    days,
    logistics: [
      `Fly into ${dest.airport}.`,
      dest.travelInfo[0]
        ? `${dest.travelInfo[0].label}: ${dest.travelInfo[0].value}`
        : 'Arrange airport transfer with your stay.',
      dest.travelInfo[1]
        ? `${dest.travelInfo[1].label}: ${dest.travelInfo[1].value}`
        : 'Local transport is easy to arrange on arrival.',
      `Local currency: ${dest.currency}. Time zone: ${dest.timezone}.`,
      `${rooms} room${rooms > 1 ? 's' : ''} for ${prefs.travelers} traveller${prefs.travelers > 1 ? 's' : ''}.`,
    ],
    recommendations: experiences.filter((e) => e.destination === dest.slug).map((e) => e.slug),
  }
}

/**
 * Alternatives for a given slot, used by "swap activity".
 *
 * Keys are positional rather than clock-derived, so a re-render does not
 * remount the list and the function stays pure.
 */
export function alternativesFor(
  itinerary: Itinerary,
  time: ItineraryActivity['time'],
): ItineraryActivity[] {
  const usedTitles = new Set(itinerary.days.flatMap((d) => d.activities.map((a) => a.title)))
  return activityPool(itinerary.preferences)
    .filter((p) => !usedTitles.has(p.title) && (p.slot === time || p.slot === 'Any'))
    .map((p, i) => {
      const { slot: _slot, ...rest } = p
      return { ...rest, id: `alt-${time}-${i}`, time }
    })
}

/**
 * What a day costs, in minor units.
 *
 * Per-person items are multiplied by the party; logistics and lodging are
 * per-booking and are not. Returned as three separate figures rather than one,
 * because a reader checking the arithmetic by hand needs the parts.
 */
export function dayCost(
  day: ItineraryDayPlan,
  travelers: number,
): { activitiesMinor: number; lodgingMinor: number; totalMinor: number; currency: string } {
  const perPersonMinor = day.activities
    .filter((a) => a.category !== 'Logistics')
    .reduce((sum, a) => sum + a.costMinor, 0)
  const logisticsMinor = day.activities
    .filter((a) => a.category === 'Logistics')
    .reduce((sum, a) => sum + a.costMinor, 0)

  const activitiesMinor = perPersonMinor * travelers + logisticsMinor
  return {
    activitiesMinor,
    lodgingMinor: day.lodgingMinor,
    totalMinor: activitiesMinor + day.lodgingMinor,
    currency: CONTENT_CURRENCY,
  }
}

export function itineraryTotalMinor(it: Itinerary): number {
  return it.days.reduce((sum, d) => sum + dayCost(d, it.preferences.travelers).totalMinor, 0)
}

export const rulesGenerator: ItineraryGenerator = {
  id: 'arc-illustrative-v1',
  label: 'Illustrative planner — deterministic rules, not a live model',
  isLive: false,
  generate: (prefs, now) => buildItinerary(prefs, now),
}

/** The only generator. A live one would have to earn the `isLive` flag. */
export const activeGenerator: ItineraryGenerator = rulesGenerator

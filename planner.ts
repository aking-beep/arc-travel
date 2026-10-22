import { differenceInCalendarDays, addDays, format, parseISO, isValid } from 'date-fns'
import { destinations, getDestination } from '../data/destinations'
import { experiences } from '../data/experiences'
import { stays } from '../data/stays'
import { Budget, Itinerary, ItineraryActivity, ItineraryDayPlan, Pace, PlannerPreferences, Property } from '../data/types'

/**
 * The planner talks to an ItineraryGenerator. Today the only implementation is a
 * deterministic, rules-based mock. A live model can be added later by implementing
 * the same interface (e.g. calling a server route) and swapping `activeGenerator`.
 */
export interface ItineraryGenerator {
  id: string
  label: string
  isLive: boolean
  generate(prefs: PlannerPreferences): Promise<Itinerary>
}

const BUDGET_MULT: Record<Budget, number> = { Considered: 0.75, Comfort: 1, Luxury: 1.8 }
const SLOTS_PER_PACE: Record<Pace, ItineraryActivity['time'][]> = {
  Slow: ['Morning', 'Evening'],
  Balanced: ['Morning', 'Afternoon', 'Evening'],
  Full: ['Morning', 'Afternoon', 'Afternoon', 'Evening'],
}

type PoolItem = Omit<ItineraryActivity, 'id' | 'time'> & { slot: ItineraryActivity['time'] | 'Any' }

/** Every candidate activity for a destination, in a stable order. */
export function activityPool(prefs: PlannerPreferences): PoolItem[] {
  const dest = getDestination(prefs.destination) ?? destinations[0]
  const mult = BUDGET_MULT[prefs.budget]
  const exp = experiences
    .filter((e) => e.destination === dest.slug)
    .sort((a, b) => Number(prefs.activities.includes(b.category)) - Number(prefs.activities.includes(a.category)))
  const fromExperiences: PoolItem[] = exp.map((e) => ({
    title: e.title,
    detail: `${e.duration} · ${e.difficulty} · hosted by ${e.host.name}`,
    cost: e.price,
    category: e.category,
    experienceSlug: e.slug,
    slot: e.durationHours > 5 ? 'Morning' : 'Any',
  }))
  const fromPreview: PoolItem[] = dest.itinerary.flatMap((d) => [
    { title: d.morning, detail: `Self-guided · ${d.title}`, cost: Math.round(15 * mult), category: 'Free' as const, slot: 'Morning' as const },
    { title: d.afternoon, detail: `Self-guided · ${d.title}`, cost: Math.round(20 * mult), category: 'Free' as const, slot: 'Afternoon' as const },
    { title: d.evening, detail: 'Dinner and evening', cost: Math.round(dest.dailyFrom * 0.3 * mult), category: 'Dining' as const, slot: 'Evening' as const },
  ])
  const neighborhoods: PoolItem[] = dest.neighborhoods.map((n) => ({
    title: `Wander ${n.name}`,
    detail: n.vibe,
    cost: 0,
    category: 'Free',
    slot: 'Afternoon',
  }))
  return [...fromExperiences, ...fromPreview, ...neighborhoods]
}

export function pickStay(prefs: PlannerPreferences): Property | undefined {
  const local = stays.filter((s) => s.destination === prefs.destination)
  if (!local.length) return undefined
  const byType = prefs.accommodation === 'Any' ? local : local.filter((s) => s.type === prefs.accommodation)
  const list = byType.length ? byType : local
  const sorted = [...list].sort((a, b) => a.pricePerNight - b.pricePerNight)
  if (prefs.budget === 'Considered') return sorted[0]
  if (prefs.budget === 'Luxury') return sorted[sorted.length - 1]
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

export function tripLength(prefs: PlannerPreferences) {
  const s = parseISO(prefs.startDate)
  const e = parseISO(prefs.endDate)
  if (!isValid(s) || !isValid(e)) return 5
  return Math.min(10, Math.max(1, differenceInCalendarDays(e, s)))
}

/** Pure, synchronous and deterministic: the same preferences always give the same plan. */
export function buildItinerary(prefs: PlannerPreferences, source: Itinerary['source'] = 'mock-generator', id?: string): Itinerary {
  const dest = getDestination(prefs.destination) ?? destinations[0]
  const pool = activityPool(prefs)
  const stay = pickStay(prefs)
  const nights = tripLength(prefs)
  const rooms = Math.ceil(prefs.travelers / 2)
  const lodging = stay ? stay.pricePerNight * rooms : Math.round(dest.dailyFrom * BUDGET_MULT[prefs.budget])
  const start = isValid(parseISO(prefs.startDate)) ? parseISO(prefs.startDate) : new Date(2025, 10, 10)
  const used = new Set<number>()
  const slots = SLOTS_PER_PACE[prefs.pace]

  const take = (slot: ItineraryActivity['time']) => {
    let idx = pool.findIndex((p, i) => !used.has(i) && (p.slot === slot || p.slot === 'Any'))
    if (idx === -1) idx = pool.findIndex((_, i) => !used.has(i))
    if (idx === -1) return null
    used.add(idx)
    return pool[idx]
  }

  const days: ItineraryDayPlan[] = Array.from({ length: nights }, (_, d) => {
    const acts: ItineraryActivity[] = []
    if (d === 0) {
      acts.push({ id: `d1-arrive`, time: 'Morning', title: `Arrive via ${dest.airport.split('(')[0].trim()}`, detail: 'Private transfer to your stay', cost: 35 * rooms, category: 'Logistics' })
    }
    slots.forEach((slot, si) => {
      if (d === 0 && si === 0) return
      const item = take(slot)
      if (item) {
        const { slot: _s, ...rest } = item
        acts.push({ ...rest, id: `d${d + 1}-${si}`, time: slot })
      } else {
        acts.push({ id: `d${d + 1}-${si}`, time: slot, title: 'Unscheduled time', detail: 'Rest, read, or follow a local tip', cost: 0, category: 'Free' })
      }
    })
    return {
      day: d + 1,
      date: format(addDays(start, d), 'yyyy-MM-dd'),
      theme: dest.itinerary[d % dest.itinerary.length].title,
      activities: acts,
      lodging,
    }
  })

  return {
    id: id ?? `itn-${dest.slug}-${prefs.startDate}-${prefs.pace}-${prefs.budget}`,
    title: `${nights} days in ${dest.name}`,
    createdAt: new Date().toISOString(),
    source,
    preferences: prefs,
    stay: stay?.slug,
    days,
    logistics: [
      `Fly into ${dest.airport}.`,
      dest.travelInfo[0] ? `${dest.travelInfo[0].label}: ${dest.travelInfo[0].value}` : 'Arrange airport transfer with your stay.',
      dest.travelInfo[1] ? `${dest.travelInfo[1].label}: ${dest.travelInfo[1].value}` : 'Local transport is easy to arrange on arrival.',
      `Local currency: ${dest.currency}. Time zone: ${dest.timezone}.`,
      `${rooms} room${rooms > 1 ? 's' : ''} for ${prefs.travelers} traveller${prefs.travelers > 1 ? 's' : ''}.`,
    ],
    recommendations: experiences.filter((e) => e.destination === dest.slug).map((e) => e.slug),
  }
}

/** Alternatives for a given slot, used by "swap activity". */
export function alternativesFor(itinerary: Itinerary, time: ItineraryActivity['time']): ItineraryActivity[] {
  const usedTitles = new Set(itinerary.days.flatMap((d) => d.activities.map((a) => a.title)))
  return activityPool(itinerary.preferences)
    .filter((p) => !usedTitles.has(p.title) && (p.slot === time || p.slot === 'Any'))
    .map((p, i) => {
      const { slot: _s, ...rest } = p
      return { ...rest, id: `alt-${time}-${i}-${Date.now()}`, time }
    })
}

export function dayCost(day: ItineraryDayPlan, travelers: number) {
  const perPerson = day.activities.filter((a) => a.category !== 'Logistics').reduce((s, a) => s + a.cost, 0)
  const logistics = day.activities.filter((a) => a.category === 'Logistics').reduce((s, a) => s + a.cost, 0)
  return { activities: perPerson * travelers + logistics, lodging: day.lodging, total: perPerson * travelers + logistics + day.lodging }
}

export function itineraryTotal(it: Itinerary) {
  return it.days.reduce((s, d) => s + dayCost(d, it.preferences.travelers).total, 0)
}

export const mockGenerator: ItineraryGenerator = {
  id: 'arc-rules-v1',
  label: 'ARC sample planner (rules-based, not live AI)',
  isLive: false,
  generate: (prefs) => new Promise((resolve) => setTimeout(() => resolve(buildItinerary(prefs)), 450)),
}

/** Swap this for a live implementation when an API is available. */
export const activeGenerator: ItineraryGenerator = mockGenerator

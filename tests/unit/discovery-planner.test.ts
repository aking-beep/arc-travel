import { describe, expect, it } from 'vitest'
import { destinations } from '@/modules/discovery/content/destinations'
import { experiences } from '@/modules/discovery/content/experiences'
import { sampleItineraries } from '@/modules/discovery/content/itineraries'
import { stays } from '@/modules/discovery/content/stays'
import { CONTENT_CURRENCY, type PlannerPreferences } from '@/modules/discovery/content/types'
import {
  activeGenerator,
  alternativesFor,
  buildItinerary,
  dayCost,
  itineraryTotalMinor,
  pickStay,
  tripLength,
} from '@/modules/discovery/planner'

const prefs: PlannerPreferences = {
  destination: 'puerto-escondido',
  startDate: '2026-11-14',
  endDate: '2026-11-19',
  travelers: 2,
  budget: 'Comfort',
  style: 'Surf & Ocean',
  accommodation: 'Any',
  activities: ['Adventure', 'Food'],
  pace: 'Balanced',
}

const NOW = new Date('2026-10-22T12:00:00.000Z')

describe('the illustrative planner', () => {
  it('is deterministic for the same brief and the same instant', () => {
    const a = buildItinerary(prefs, NOW)
    const b = buildItinerary(prefs, NOW)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('reads no clock: the instant is a parameter', () => {
    const earlier = buildItinerary(prefs, new Date('2026-01-01T00:00:00.000Z'))
    const later = buildItinerary(prefs, NOW)
    expect(earlier.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(later.createdAt).toBe('2026-10-22T12:00:00.000Z')
    // Only the stamp moves. The plan itself comes from the stated dates.
    expect(earlier.days.map((d) => d.date)).toEqual(later.days.map((d) => d.date))
  })

  it('never labels its own output as a model', () => {
    // CLAUDE.md non-negotiable 5: the AI explains, it never decides. A
    // deterministic engine may not claim a model produced its plan.
    expect(activeGenerator.isLive).toBe(false)
    expect(buildItinerary(prefs, NOW).source).toBe('rules-engine')
    for (const sample of sampleItineraries) expect(sample.source).toBe('sample')
  })

  it('plans one day per night, within the plannable range', () => {
    expect(tripLength(prefs)).toBe(5)
    expect(buildItinerary(prefs, NOW).days).toHaveLength(5)
    expect(tripLength({ ...prefs, endDate: prefs.startDate })).toBe(1)
    expect(tripLength({ ...prefs, endDate: '2027-11-14' })).toBe(10)
    expect(tripLength({ ...prefs, startDate: 'not a date', endDate: 'nor this' })).toBe(5)
  })

  it('starts the first day with arrival and honours the stated start date', () => {
    const itinerary = buildItinerary(prefs, NOW)
    expect(itinerary.days[0]?.date).toBe('2026-11-14')
    expect(itinerary.days[0]?.activities[0]?.category).toBe('Logistics')
  })

  it('gives a slower pace fewer slots than a fuller one', () => {
    const slots = (pace: PlannerPreferences['pace']) =>
      buildItinerary({ ...prefs, pace }, NOW).days[1]?.activities.length ?? 0
    expect(slots('Slow')).toBeLessThan(slots('Balanced'))
    expect(slots('Balanced')).toBeLessThan(slots('Full'))
  })
})

describe('planner money', () => {
  it('keeps every amount an integer in minor units', () => {
    // CLAUDE.md non-negotiable 3. A float anywhere here would surface as a
    // fractional centavo in a total a visitor reads.
    for (const pace of ['Slow', 'Balanced', 'Full'] as const) {
      for (const budget of ['Considered', 'Comfort', 'Luxury'] as const) {
        const itinerary = buildItinerary({ ...prefs, pace, budget }, NOW)
        for (const day of itinerary.days) {
          expect(Number.isInteger(day.lodgingMinor)).toBe(true)
          for (const activity of day.activities) {
            expect(Number.isInteger(activity.costMinor)).toBe(true)
          }
          const cost = dayCost(day, itinerary.preferences.travelers)
          expect(Number.isInteger(cost.activitiesMinor)).toBe(true)
          expect(Number.isInteger(cost.totalMinor)).toBe(true)
          expect(cost.currency).toBe(CONTENT_CURRENCY)
        }
        expect(Number.isInteger(itineraryTotalMinor(itinerary))).toBe(true)
      }
    }
  })

  it('charges per-person items per head and logistics once', () => {
    const day = {
      day: 1,
      date: '2026-11-14',
      theme: 'Arrive',
      lodgingMinor: 50_000,
      activities: [
        {
          id: 'a',
          time: 'Morning' as const,
          title: 'Transfer',
          detail: '',
          costMinor: 7_000,
          category: 'Logistics' as const,
        },
        {
          id: 'b',
          time: 'Afternoon' as const,
          title: 'Lesson',
          detail: '',
          costMinor: 9_000,
          category: 'Adventure' as const,
        },
      ],
    }
    const cost = dayCost(day, 3)
    expect(cost.activitiesMinor).toBe(9_000 * 3 + 7_000)
    expect(cost.totalMinor).toBe(9_000 * 3 + 7_000 + 50_000)
  })

  it('totals the whole plan as the sum of its days', () => {
    const itinerary = buildItinerary(prefs, NOW)
    const byHand = itinerary.days.reduce(
      (total, day) => total + dayCost(day, itinerary.preferences.travelers).totalMinor,
      0,
    )
    expect(itineraryTotalMinor(itinerary)).toBe(byHand)
  })

  it('points a bigger budget at a dearer stay', () => {
    const cheap = pickStay({ ...prefs, budget: 'Considered' })
    const dear = pickStay({ ...prefs, budget: 'Luxury' })
    expect(cheap).toBeDefined()
    expect(dear).toBeDefined()
    expect(cheap!.pricePerNightMinor).toBeLessThanOrEqual(dear!.pricePerNightMinor)
  })
})

describe('alternatives', () => {
  it('offers nothing already in the plan, and keys them positionally', () => {
    const itinerary = buildItinerary(prefs, NOW)
    const planned = new Set(itinerary.days.flatMap((d) => d.activities.map((a) => a.title)))
    const alternatives = alternativesFor(itinerary, 'Afternoon')

    for (const alternative of alternatives) {
      expect(planned.has(alternative.title)).toBe(false)
      expect(alternative.time).toBe('Afternoon')
      // A clock-derived key would remount the list on every render.
      expect(alternative.id).toMatch(/^alt-Afternoon-\d+$/)
    }
    expect(JSON.stringify(alternativesFor(itinerary, 'Afternoon'))).toBe(
      JSON.stringify(alternatives),
    )
  })
})

describe('the sample itineraries', () => {
  it('are built from a fixed instant, so a hydration cannot disagree with a render', () => {
    for (const sample of sampleItineraries) {
      expect(sample.createdAt).toBe('2026-10-22T12:00:00.000Z')
    }
  })

  it('each name a destination this content set actually has', () => {
    const slugs = new Set(destinations.map((d) => d.slug))
    for (const sample of sampleItineraries) {
      expect(slugs.has(sample.preferences.destination)).toBe(true)
    }
  })
})

describe('the content set makes no claim it is not entitled to', () => {
  it('marks every listing illustrative', () => {
    // CLAUDE.md non-negotiable 2: /admin is the only route to a VERIFIED
    // status, and fixture partners stay unverified.
    for (const stay of stays) expect(stay.verification).toBe('illustrative')
    for (const experience of experiences) expect(experience.verification).toBe('illustrative')
  })

  it('calls a host claim a host claim', () => {
    for (const experience of experiences) {
      expect(Array.isArray(experience.hostClaims)).toBe(true)
      expect(experience).not.toHaveProperty('safety')
    }
  })

  it('never calls anything safe', () => {
    // Non-negotiable 1. The conditions gate returns `allowed`; editorial copy
    // on this surface may not quietly promise what the gate refuses to.
    const copy = JSON.stringify([destinations, stays, experiences, sampleItineraries])
    expect(copy).not.toMatch(/\bis safe\b|\bsafe today\b|\bsafe to swim\b|\btotally safe\b/i)
  })
})

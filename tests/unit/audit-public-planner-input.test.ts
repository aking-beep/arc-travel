import { describe, expect, it } from 'vitest'
import { buildItinerary, tripLength } from '@/modules/discovery/planner'
import type { PlannerPreferences } from '@/modules/discovery/content/types'

/**
 * AUDIT-3 — the public planner accepts input it should refuse.
 *
 * `modules/itinerary/service.buildItinerary` (the engine that can lead to a
 * booking) rejects a reversed date range outright. The public illustrative
 * planner at `/plan` does not: `tripLength` runs the span through
 * `Math.min(10, Math.max(1, nights))`, so a departure date before the arrival
 * date silently becomes a one-day trip starting on the departure date, and a
 * traveller count of zero produces "0 rooms for 0 travellers" with the lodging
 * line priced at zero.
 *
 * Nothing here can be booked, so this is a credibility defect rather than a
 * commercial one — but it is the screen a prospective hotel is shown first.
 */
const NOW = new Date('2026-10-24T12:00:00Z')

const prefs = (over: Partial<PlannerPreferences> = {}): PlannerPreferences => ({
  destination: 'puerto-escondido',
  startDate: '2026-12-01',
  endDate: '2026-12-06',
  travelers: 2,
  budget: 'Comfort',
  style: 'Surf & Ocean',
  accommodation: 'Any',
  activities: ['Adventure', 'Food'],
  pace: 'Balanced',
  ...over,
})

describe('public planner input validation', () => {
  it('plans the stated span when the dates are in order', () => {
    expect(tripLength(prefs())).toBe(5)
    expect(buildItinerary(prefs(), NOW).days).toHaveLength(5)
  })

  it('does not turn a reversed date range into a one-day trip', () => {
    const reversed = prefs({ startDate: '2026-12-06', endDate: '2026-12-01' })
    // Either refuse it or report it — silently planning it is the defect.
    expect(() => buildItinerary(reversed, NOW)).toThrow()
  })

  it('does not plan for zero travellers', () => {
    expect(() => buildItinerary(prefs({ travelers: 0 }), NOW)).toThrow()
  })

  it('does not plan for a negative traveller count', () => {
    expect(() => buildItinerary(prefs({ travelers: -3 }), NOW)).toThrow()
  })
})

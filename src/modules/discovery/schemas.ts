import { z } from 'zod'
import { ExperienceCategory } from '@/lib/prisma-types'

/**
 * Filter input for the public experience browse surface.
 *
 * Parsed by the service, not by the route, so the service is the thing that may
 * be trusted to have validated its input. Everything is optional and everything
 * has a safe default: a visitor arriving with a hand-edited query string gets
 * the unfiltered list, never an error page.
 */
export const experienceFilterSchema = z.object({
  category: z.nativeEnum(ExperienceCategory).optional(),
  /** Free-text match against title and summary. */
  q: z.string().trim().min(1).max(120).optional(),
  /** Longest acceptable duration in minutes. */
  maxDurationMinutes: z.coerce.number().int().positive().max(1440).optional(),
  /** Only experiences whose price is at or below this, in minor units. */
  maxPriceMinor: z.coerce.number().int().nonnegative().optional(),
})

export type ExperienceFilter = z.infer<typeof experienceFilterSchema>

/**
 * Tolerant parse for a query string. Drops anything that does not validate
 * rather than throwing, because a bad `?category=` is a visitor following a
 * stale link, not an attack worth a 400.
 */
export function parseExperienceFilter(input: Record<string, string | undefined>): ExperienceFilter {
  const result = experienceFilterSchema.safeParse(input)
  if (result.success) return result.data

  // Keep the fields that did parse, so one bad parameter does not clear the
  // visitor's other choices.
  const shape = experienceFilterSchema.shape
  const out: ExperienceFilter = {}
  for (const key of Object.keys(shape) as Array<keyof typeof shape>) {
    const raw = input[key]
    if (raw === undefined) continue
    const field = shape[key].safeParse(raw)
    if (field.success) Object.assign(out, { [key]: field.data })
  }
  return out
}

export const stayEstimateSchema = z.object({
  arrive: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  depart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  partySize: z.coerce.number().int().min(1).max(12),
  roomTypeCode: z.string().trim().min(1).max(32),
})

export type StayEstimateInput = z.infer<typeof stayEstimateSchema>

/**
 * The public planner's brief.
 *
 * The gated engine (`modules/itinerary/service.buildItinerary`) refuses a
 * reversed date range outright. The illustrative planner used to run its span
 * through `Math.min(10, Math.max(1, nights))`, so a departure before the
 * arrival silently became a one-day trip starting on the departure date, and a
 * party of zero produced "0 rooms for 0 travellers" priced at zero. Nothing
 * here can be booked, so that was a credibility defect rather than a
 * commercial one — but it is the screen a prospective hotel is shown first.
 *
 * `MAX_PLANNABLE_NIGHTS` is now a stated limit rather than a silent clamp: a
 * visitor who asks for three weeks is told the planner drafts ten nights, not
 * handed ten nights labelled as three weeks.
 */
export const MAX_PLANNABLE_NIGHTS = 10

/** Machine-readable reasons a brief cannot be planned. */
export type PlannerIssue =
  | 'invalid_date'
  | 'reversed_dates'
  | 'trip_too_long'
  | 'travelers_out_of_range'

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Pure validation, returning every reason rather than the first. The form
 * renders them all at once and disables drafting; `buildItinerary` throws on
 * them so no caller can plan an impossible brief by skipping the form.
 */
export function plannerIssues(prefs: {
  startDate: string
  endDate: string
  travelers: number
}): PlannerIssue[] {
  const issues: PlannerIssue[] = []

  const datesWellFormed =
    DATE_KEY.test(prefs.startDate) &&
    DATE_KEY.test(prefs.endDate) &&
    !Number.isNaN(Date.parse(`${prefs.startDate}T00:00:00.000Z`)) &&
    !Number.isNaN(Date.parse(`${prefs.endDate}T00:00:00.000Z`))

  if (!datesWellFormed) {
    issues.push('invalid_date')
  } else {
    const nights = Math.round(
      (Date.parse(`${prefs.endDate}T00:00:00.000Z`) -
        Date.parse(`${prefs.startDate}T00:00:00.000Z`)) /
        86_400_000,
    )
    if (nights < 1) issues.push('reversed_dates')
    else if (nights > MAX_PLANNABLE_NIGHTS) issues.push('trip_too_long')
  }

  if (!Number.isInteger(prefs.travelers) || prefs.travelers < 1 || prefs.travelers > 12) {
    issues.push('travelers_out_of_range')
  }

  return issues
}

/** The i18n key each issue is rendered through, so no message is hard-coded. */
export const PLANNER_ISSUE_KEYS = {
  invalid_date: 'explore.planner.issue.invalidDate',
  reversed_dates: 'explore.planner.issue.reversedDates',
  trip_too_long: 'explore.planner.issue.tripTooLong',
  travelers_out_of_range: 'explore.planner.issue.travelers',
} as const

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

import { z } from 'zod'
import { AbilityLevel, ExperienceCategory, ExperienceStatus } from '@/lib/prisma-types'

/**
 * Input contracts for the catalog.
 *
 * Every mutation validates through one of these before it reaches a service.
 * Money fields accept integer minor units only — an owner types "950" pesos in
 * the form and the action multiplies by 100 once, at the edge, so the domain
 * never sees a decimal.
 */
const ABILITY_ORDER = [
  AbilityLevel.BEGINNER,
  AbilityLevel.IMPROVER,
  AbilityLevel.INTERMEDIATE,
  AbilityLevel.ADVANCED,
  AbilityLevel.EXPERT,
] as const

export const abilityRank = (level: AbilityLevel): number => ABILITY_ORDER.indexOf(level)

const timeString = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour HH:MM time.')

export const experienceInputSchema = z
  .object({
    supplierId: z.string().uuid('Choose a partner.'),
    activityId: z.string().uuid('Choose an activity type.'),
    placeId: z.string().uuid().nullish(),
    titleEn: z.string().trim().min(3, 'Give it a title.').max(120),
    titleEs: z.string().trim().max(120).nullish(),
    summaryEn: z.string().trim().max(240).nullish(),
    summaryEs: z.string().trim().max(240).nullish(),
    descriptionEn: z.string().trim().max(4000).nullish(),
    descriptionEs: z.string().trim().max(4000).nullish(),
    category: z.enum(ExperienceCategory),
    durationMinutes: z.coerce.number().int().min(15).max(720),
    minAbility: z.enum(AbilityLevel),
    maxAbility: z.enum(AbilityLevel),
    minParty: z.coerce.number().int().min(1).max(40),
    maxParty: z.coerce.number().int().min(1).max(40),
    minAgeYears: z.coerce.number().int().min(0).max(99).nullish(),
    defaultCapacity: z.coerce.number().int().min(1).max(60),
    includesTransfer: z.coerce.boolean().default(false),
    guideIncluded: z.coerce.boolean().default(true),
    meetingPoint: z.string().trim().max(240).nullish(),
    whatToBringEn: z.string().trim().max(600).nullish(),
    whatToBringEs: z.string().trim().max(600).nullish(),
    cancellationPolicyHours: z.coerce.number().int().min(0).max(336),
    /** Per-person price in minor units. */
    priceMinor: z.coerce.number().int().min(0).max(100_000_000),
    bookingFeeMinor: z.coerce.number().int().min(0).max(100_000_000).default(0),
  })
  .refine((v) => abilityRank(v.minAbility) <= abilityRank(v.maxAbility), {
    message: 'The minimum ability cannot be higher than the maximum.',
    path: ['minAbility'],
  })
  .refine((v) => v.minParty <= v.maxParty, {
    message: 'The minimum party size cannot exceed the maximum.',
    path: ['minParty'],
  })
  .refine((v) => v.maxParty <= v.defaultCapacity || v.defaultCapacity >= v.minParty, {
    message: 'Capacity must be at least the minimum party size.',
    path: ['defaultCapacity'],
  })

export type ExperienceInput = z.infer<typeof experienceInputSchema>

export const experienceStatusSchema = z.object({
  experienceId: z.string().uuid(),
  status: z.enum(ExperienceStatus),
})

export const priceInputSchema = z.object({
  experienceId: z.string().uuid(),
  amountMinor: z.coerce.number().int().min(0).max(100_000_000),
  bookingFeeMinor: z.coerce.number().int().min(0).max(100_000_000).default(0),
  minParty: z.coerce.number().int().min(1).max(40).default(1),
  kind: z.enum(['BASE', 'SEASONAL', 'PROMO', 'GROUP']).default('BASE'),
  note: z.string().trim().max(240).nullish(),
})

export const slotInputSchema = z
  .object({
    experienceId: z.string().uuid(),
    /** Local calendar day, YYYY-MM-DD. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.'),
    startTime: timeString,
    capacity: z.coerce.number().int().min(1).max(60),
    priceOverrideMinor: z.coerce.number().int().min(0).max(100_000_000).nullish(),
    note: z.string().trim().max(240).nullish(),
  })
  .strict()

export const slotRangeSchema = z.object({
  experienceId: z.string().uuid(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTimes: z.array(timeString).min(1).max(12),
  capacity: z.coerce.number().int().min(1).max(60),
  /** 0 = Sunday. Empty means every day. */
  weekdays: z.array(z.coerce.number().int().min(0).max(6)).max(7).default([]),
})

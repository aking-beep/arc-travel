import { z } from 'zod'
import { AbilityLevel, ExperienceCategory, Pace, TransportMode } from '@/lib/prisma-types'

/**
 * Guest intake.
 *
 * Two things are deliberate. First, `dataProcessingConsent` is required —
 * refusing it means we do not store the answers at all, rather than storing
 * them and not using them. Second, ability is nullable and stays nullable: an
 * unanswered question is recorded as unanswered, never defaulted to a level,
 * because the conditions gate treats "unknown" much more conservatively than
 * it would treat a guessed "intermediate".
 */
export const intakeSchema = z.object({
  interests: z.array(z.enum(ExperienceCategory)).max(6).default([]),
  surfAbility: z.enum(AbilityLevel).nullish(),
  pace: z.enum(Pace).nullish(),
  partySize: z.coerce.number().int().min(1).max(12),
  /** Per person per day, in minor units. Null means "did not say". */
  budgetPerDayMinor: z.coerce.number().int().min(0).max(100_000_000).nullish(),
  preferredTransport: z.array(z.enum(TransportMode)).max(5).default([]),
  dietaryNotes: z.string().trim().max(500).nullish(),
  mobilityNotes: z.string().trim().max(500).nullish(),

  dataProcessingConsent: z.literal(true, {
    message: 'We cannot store these answers without your agreement.',
  }),
  personalizationConsent: z.coerce.boolean().default(false),
  marketingConsent: z.coerce.boolean().default(false),
})

export type IntakeInput = z.infer<typeof intakeSchema>

export const itineraryRequestSchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.'),
    pace: z.enum(Pace).nullish(),
    budgetPerDayMinor: z.coerce.number().int().min(0).max(100_000_000).nullish(),
    partySize: z.coerce.number().int().min(1).max(12).nullish(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'The end date cannot be before the start date.',
    path: ['endDate'],
  })

export const guideQuestionSchema = z.object({
  question: z.string().trim().min(3, 'Ask a question.').max(400),
})

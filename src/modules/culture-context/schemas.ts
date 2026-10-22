import { z } from 'zod'
import { SourceClass, VerificationStatus } from '@/lib/prisma-types'

/**
 * Culture-context types.
 *
 * Ported from culture-context's Pydantic models and Zod mirror, renamed to this
 * codebase's casing (camelCase fields, UPPER_CASE enum values). Two things are
 * new and both are load-bearing:
 *
 *   1. `ruleRecordSchema` enforces "an advisory is never law". A `LAW` record
 *      must cite a primary-law or regulator source *and* be VERIFIED. The
 *      original relied on the adapter happening to emit `advisory`; here the
 *      type refuses the promotion, so a future adapter cannot make it either.
 *   2. Tags are split in two. `activityTags` *scope* a record ("applies only to
 *      travellers who drive") and can exclude it. `topicTags` say what a record
 *      *mentions* and can only raise its rank. Conflating the two is how the
 *      whole "Local laws and customs" section used to vanish from a brief.
 *
 * `SourceClass` is the Prisma enum, kept separate from `Provenance` on purpose:
 * provenance is who supplied a fact, source class is what authority backs it.
 */

export const sourceClassSchema = z.enum(SourceClass)

/** Source classes that can back a legal claim about the destination. */
export const LAW_GRADE_SOURCE_CLASSES: readonly SourceClass[] = [
  SourceClass.PRIMARY_LAW,
  SourceClass.REGULATOR_GUIDANCE,
]

/** Source classes that can never, on their own, establish a requirement. */
export const CONTEXT_ONLY_SOURCE_CLASSES: readonly SourceClass[] = [
  SourceClass.REFERENCE_DATA,
  SourceClass.COMMUNITY_CONTEXT,
]

export const RULE_KINDS = [
  'LAW',
  'RESTRICTION',
  'ADVISORY',
  'CULTURAL_NORM',
  'LOCAL_IMPACT',
  'CONTEXT',
] as const
export const ruleKindSchema = z.enum(RULE_KINDS)
export type RuleKind = z.infer<typeof ruleKindSchema>

export const TRAVEL_PURPOSES = ['TOURISM', 'REMOTE_WORK', 'BUSINESS', 'STUDY', 'OTHER'] as const
export const travelPurposeSchema = z.enum(TRAVEL_PURPOSES)
export type TravelPurpose = z.infer<typeof travelPurposeSchema>

/**
 * Brief sections, in the order a guest reads them. Entry first because it is
 * the one with consequences before arrival.
 */
export const BRIEF_CATEGORIES = ['entry', 'laws-customs', 'safety', 'activity', 'culture'] as const
export const briefCategorySchema = z.enum(BRIEF_CATEGORIES)
export type BriefCategory = z.infer<typeof briefCategorySchema>

const iso2 = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, 'Use a two-letter ISO country code.')
  .transform((v) => v.toUpperCase())

/** A rule's jurisdiction: an ISO country, or `GLOBAL` for rules that apply anywhere. */
const jurisdiction = z.union([z.literal('GLOBAL'), iso2])

const tag = z.string().trim().toLowerCase().min(1).max(40)

/**
 * Who is travelling, as far as applicability needs to know.
 *
 * On the guest surface this is derived from the portal context, never from a
 * new form. `nationality` is nullable because ARC does not ask for it:
 * `Guest.countryCode` says where a guest is from, which is not necessarily the
 * passport they travel on. An unknown nationality is recorded as unknown, never
 * defaulted, and rules that depend on it are shown as uncertain rather than
 * dropped.
 */
export const travelerProfileSchema = z.object({
  nationality: iso2.nullable(),
  residenceCountry: iso2.nullish(),
  destinationCountry: iso2,
  /** The source-specific slug, e.g. GOV.UK's `mexico`. */
  destinationSlug: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/),
  city: z.string().trim().max(120).nullish(),
  purpose: travelPurposeSchema.default('TOURISM'),
  activities: z.array(tag).max(30).default([]),
})
export type TravelerProfile = z.infer<typeof travelerProfileSchema>
export type TravelerProfileInput = z.input<typeof travelerProfileSchema>

const sha256 = z.string().regex(/^[a-f0-9]{64}$/, 'Expected a SHA-256 hex digest.')

/**
 * Everything a card must be able to show about where a statement came from.
 * See docs/culture-context.md, "What every card shows".
 */
export const sourceRefSchema = z.object({
  id: z.string().min(1),
  authority: z.string().min(1),
  url: z.url(),
  jurisdiction,
  sourceClass: sourceClassSchema,
  retrievedAt: z.date(),
  contentHash: sha256.nullable().default(null),
  /** The licence the source publishes under, when it states one. */
  licence: z.string().nullable().default(null),
  licenceUrl: z.url().nullable().default(null),
  /** Attribution text the licence requires, rendered with the item. */
  attribution: z.string().nullable().default(null),
  /** True when this came from the repository fixture, not the live source. */
  isFixture: z.boolean().default(false),
})
export type SourceRef = z.infer<typeof sourceRefSchema>
export type SourceRefInput = z.input<typeof sourceRefSchema>

export const ruleRecordSchema = z
  .object({
    id: z.string().min(1),
    jurisdiction,
    category: briefCategorySchema,
    kind: ruleKindSchema,
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(2000),
    /** Scoping: the record applies only to travellers doing one of these. */
    activityTags: z.array(tag).default([]),
    /** Ranking only: what the record mentions. Never excludes. */
    topicTags: z.array(tag).default([]),
    purposeTags: z.array(travelPurposeSchema).default([]),
    nationalityTags: z.array(iso2).default([]),
    verification: z.enum(VerificationStatus).default(VerificationStatus.UNVERIFIED),
    sources: z.array(sourceRefSchema).min(1),
  })
  .superRefine((rule, ctx) => {
    const classes = rule.sources.map((s) => s.sourceClass)

    if (rule.kind === 'LAW') {
      if (!classes.some((c) => LAW_GRADE_SOURCE_CLASSES.includes(c))) {
        ctx.addIssue({
          code: 'custom',
          path: ['kind'],
          message:
            'A LAW record needs a primary-law or regulator source. A government advisory stays ADVISORY.',
        })
      }
      if (rule.verification !== VerificationStatus.VERIFIED) {
        ctx.addIssue({
          code: 'custom',
          path: ['verification'],
          message: 'A LAW record must be verified by an admin before it exists.',
        })
      }
    }

    if (
      (rule.kind === 'LAW' || rule.kind === 'RESTRICTION') &&
      classes.every((c) => CONTEXT_ONLY_SOURCE_CLASSES.includes(c))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['kind'],
        message: 'Reference data and community context cannot establish a legal requirement.',
      })
    }
  })
export type RuleRecord = z.infer<typeof ruleRecordSchema>
export type RuleRecordInput = z.input<typeof ruleRecordSchema>

export const briefItemSchema = z.object({
  id: z.string(),
  category: briefCategorySchema,
  kind: ruleKindSchema,
  title: z.string(),
  summary: z.string(),
  /** Machine-readable reasons, e.g. `destination`, `activity:drone`, `topic:driving`. */
  relevance: z.array(z.string()).min(1),
  /** Higher sorts first within a category. Derived from `relevance`, never from a model. */
  rank: z.number().int().min(0),
  /** True when applicability depends on something we do not know about the traveller. */
  applicabilityUncertain: z.boolean(),
  verification: z.enum(VerificationStatus),
  sources: z.array(sourceRefSchema).min(1),
})
export type BriefItem = z.infer<typeof briefItemSchema>

/**
 * Warnings are codes, not sentences, so the UI renders them in the guest's
 * language and a test can assert on them without matching prose.
 */
export const BRIEF_WARNING_CODES = [
  'COVERAGE_PARTIAL',
  'ADVISORY_NOT_LAW',
  'SOURCE_UNAVAILABLE',
  'SOURCE_UNPARSEABLE',
  'NATIONALITY_UNKNOWN',
  'DESTINATION_UNSUPPORTED',
  'FIXTURE_DATA',
] as const
export const briefWarningSchema = z.object({
  code: z.enum(BRIEF_WARNING_CODES),
  /** The source the warning is about, when it is about one. */
  sourceKey: z.string().nullable().default(null),
  /** The provider's machine-readable failure reason, for the admin view. */
  reason: z.string().nullable().default(null),
})
export type BriefWarning = z.infer<typeof briefWarningSchema>
export type BriefWarningCode = (typeof BRIEF_WARNING_CODES)[number]

export const sourceStatusSchema = z.object({
  sourceKey: z.string(),
  authority: z.string(),
  sourceClass: sourceClassSchema,
  url: z.url(),
  provider: z.string(),
  ok: z.boolean(),
  reason: z.string().nullable(),
  retrievedAt: z.date().nullable(),
  contentHash: sha256.nullable(),
  isFixture: z.boolean(),
})
export type SourceStatus = z.infer<typeof sourceStatusSchema>

export const briefSchema = z.object({
  destinationCountry: z.string(),
  generatedAt: z.date(),
  /** Always PARTIAL in this build: absence of a card is not absence of a rule. */
  coverage: z.enum(['PARTIAL', 'EXPANDED']),
  warnings: z.array(briefWarningSchema),
  items: z.array(briefItemSchema),
  sources: z.array(sourceStatusSchema),
})
export type Brief = z.infer<typeof briefSchema>

/** An admin's decision on a detected source change. */
export const reviewSourceChangeSchema = z.object({
  changeId: z.uuid(),
  decision: z.enum([
    VerificationStatus.VERIFIED,
    VerificationStatus.REJECTED,
    VerificationStatus.PENDING,
  ]),
  note: z.string().trim().max(400).default(''),
})
/** Untrusted input: the service parses it, so the decision arrives as a string. */
export interface ReviewSourceChangeInput {
  changeId: string
  decision: string
  note?: string
}

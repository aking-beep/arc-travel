import { z } from 'zod'
import { ExperienceCategory } from '@/lib/prisma-types'

/**
 * What a partner may say about themselves.
 *
 * The shape of these schemas *is* the permission boundary, and the thing they
 * are shaped around is the distinction in ADR-041: a partner edits their
 * **claims**, and never their **standing**. So there is no field here for
 * `verification`, `verifiedChecks`, `insuranceOnFile`, `insuranceExpiresOn`,
 * `status` or `payoutsEnabled` — not "the service ignores them", not present,
 * because a `.strict()` object that cannot name a column cannot be made to
 * write it by a future caller passing extra form fields.
 */
const category = z.enum(ExperienceCategory)

/** YYYY-MM-DD, the repo's `DateKey`. */
const dateKey = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')

export const supplierProfileSchema = z
  .object({
    name: z.string().trim().min(2, 'Give your business a name.').max(120),
    legalName: z.string().trim().max(160).nullish(),
    description: z.string().trim().max(1200).nullish(),
    categories: z.array(category).min(1, 'Pick at least one category.').max(6),
    contactEmail: z.string().trim().toLowerCase().email('Enter a valid email.'),
    contactPhone: z.string().trim().max(40).nullish(),
    placeId: z.string().uuid().nullish(),
  })
  .strict()

export type SupplierProfileInput = z.infer<typeof supplierProfileSchema>

/**
 * Evidence a partner submits for ARC to check.
 *
 * Every field is a claim, and the names say so. Submitting this moves the
 * partner's verification to `PENDING` — "somebody has asked us to look" — and
 * never to `VERIFIED`, which `/admin` remains the only route to
 * (non-negotiable 2).
 */
export const verificationEvidenceSchema = z
  .object({
    claimedCertifications: z
      .array(z.string().trim().min(2).max(120))
      .max(12, 'Twelve is plenty; list the ones that matter.')
      .default([]),
    claimedInsurer: z.string().trim().max(160).nullish(),
    claimedInsurancePolicyRef: z.string().trim().max(120).nullish(),
    claimedInsuranceExpiresOn: dateKey.nullish(),
    evidenceNotes: z.string().trim().max(2000).nullish(),
  })
  .strict()
  .refine(
    (v) => !v.claimedInsurancePolicyRef || Boolean(v.claimedInsurer),
    {
      message: 'Name the insurer the policy is with.',
      path: ['claimedInsurer'],
    },
  )
  .refine((v) => !v.claimedInsuranceExpiresOn || Boolean(v.claimedInsurer), {
    message: 'Name the insurer the expiry belongs to.',
    path: ['claimedInsurer'],
  })

export type VerificationEvidenceInput = z.infer<typeof verificationEvidenceSchema>

/**
 * An experience a partner drafts for themselves.
 *
 * Deliberately not `experienceInputSchema`: that one takes a `supplierId`,
 * because an owner choosing which partner an experience belongs to is the
 * whole point of the owner's form. A partner has no such choice — the supplier
 * is whoever they are signed in as — and a field they could set is a field
 * somebody will eventually set to somebody else's id.
 *
 * `propertyId` is named, because a partner may have agreements with more than
 * one hotel and an experience sells through exactly one storefront. The service
 * checks the agreement exists.
 */
/*
 * The listing's fields, before the cross-field rules.
 *
 * Split out so the update schema can drop `priceMinor` and still carry the
 * same two refinements — `.omit()` refuses to work on a refined schema, and a
 * second hand-written copy of the fields would drift from this one.
 */
const partnerExperienceFields = z
  .object({
    propertyId: z.string().uuid('Choose which hotel this is for.'),
    activityId: z.string().uuid('Choose an activity type.'),
    placeId: z.string().uuid().nullish(),
    titleEn: z.string().trim().min(3, 'Give it a title.').max(120),
    titleEs: z.string().trim().max(120).nullish(),
    summaryEn: z.string().trim().max(240).nullish(),
    summaryEs: z.string().trim().max(240).nullish(),
    descriptionEn: z.string().trim().max(4000).nullish(),
    descriptionEs: z.string().trim().max(4000).nullish(),
    durationMinutes: z.coerce.number().int().min(15).max(720),
    minParty: z.coerce.number().int().min(1).max(40),
    maxParty: z.coerce.number().int().min(1).max(40),
    defaultCapacity: z.coerce.number().int().min(1).max(60),
    minAgeYears: z.coerce.number().int().min(0).max(99).nullish(),
    includesTransfer: z.coerce.boolean().default(false),
    guideIncluded: z.coerce.boolean().default(true),
    meetingPoint: z.string().trim().max(240).nullish(),
    whatToBringEn: z.string().trim().max(600).nullish(),
    whatToBringEs: z.string().trim().max(600).nullish(),
    cancellationPolicyHours: z.coerce.number().int().min(0).max(336),
    /** Per-person price in minor units. The partner's number to set. */
    priceMinor: z.coerce.number().int().min(0).max(100_000_000),
  })
  .strict()

interface PartySizeFields {
  minParty: number
  maxParty: number
  defaultCapacity: number
}

/** The cross-field rules, applied to whichever set of fields is being parsed. */
function withPartySizeRules<T extends z.ZodType<PartySizeFields>>(schema: T) {
  return schema
    .refine((v) => v.minParty <= v.maxParty, {
      message: 'The minimum party size cannot exceed the maximum.',
      path: ['minParty'],
    })
    .refine((v) => v.defaultCapacity >= v.minParty, {
      message: 'Capacity must be at least the minimum party size.',
      path: ['defaultCapacity'],
    })
}

export const partnerExperienceSchema = withPartySizeRules(partnerExperienceFields)

/**
 * The same listing, without a price.
 *
 * A price is a new `Price` row, never a column on the experience, so an update
 * has no business carrying one — and when it did, the service dropped it
 * silently and the partner was told their change had been saved. `setOwnPrice`
 * is the only path that moves a price.
 */
export const partnerExperienceUpdateSchema = withPartySizeRules(
  partnerExperienceFields.omit({ priceMinor: true }),
)

export type PartnerExperienceInput = z.infer<typeof partnerExperienceSchema>

/**
 * The partner's own price change on an experience they own.
 *
 * No `bookingFeeMinor`: the booking fee is the platform's, not the partner's,
 * and a form that let a partner set it would let them set ARC's revenue.
 */
export const partnerPriceSchema = z
  .object({
    experienceId: z.string().uuid(),
    amountMinor: z.coerce.number().int().min(0).max(100_000_000),
    minParty: z.coerce.number().int().min(1).max(40).default(1),
    note: z.string().trim().max(240).nullish(),
  })
  .strict()

/**
 * A business asking a hotel to take them on.
 *
 * No session, so this is the one partner-side schema reachable by anybody. It
 * asks for nothing it does not need, and in particular it does not ask for a
 * password: an account is created when the hotel accepts, by the same
 * invitation handover `invitePartner` uses, so nothing here can create a
 * credential or a commercial relationship.
 */
export const joinRequestSchema = z
  .object({
    propertySlug: z.string().trim().min(1, 'Choose the hotel you want to work with.').max(120),
    businessName: z.string().trim().min(2, 'Give your business a name.').max(120),
    contactName: z.string().trim().min(2, 'Tell them your name.').max(120),
    contactEmail: z.string().trim().toLowerCase().email('Enter a valid email.'),
    contactPhone: z.string().trim().max(40).nullish(),
    categories: z.array(category).min(1, 'Pick at least one category.').max(6),
    pitch: z.string().trim().max(1200).nullish(),
    claimedCertifications: z.array(z.string().trim().min(2).max(120)).max(12).default([]),
    locale: z.enum(['EN', 'ES']).default('ES'),
  })
  .strict()

export type JoinRequestInput = z.infer<typeof joinRequestSchema>

export const joinDecisionSchema = z
  .object({
    requestId: z.string().uuid(),
    /** Hotel's share of gross on this partner's experiences, in basis points. */
    hotelCommissionBps: z.coerce.number().int().min(0).max(5000),
    decisionNote: z.string().trim().max(600).nullish(),
  })
  .strict()

export const joinDeclineSchema = z
  .object({
    requestId: z.string().uuid(),
    decisionNote: z.string().trim().max(600).nullish(),
  })
  .strict()

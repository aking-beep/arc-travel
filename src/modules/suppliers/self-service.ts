import { prisma } from '@/lib/db'
import { conflict, forbidden, invalid, notFound } from '@/lib/errors'
import { fromDateKey } from '@/lib/dates'
import { slugify } from '@/lib/slug'
import { assertWithinRateLimit, rateLimitSubject } from '@/lib/rate-limit'
import {
  EntityStatus,
  ExperienceStatus,
  JoinRequestStatus,
  PriceKind,
  Role,
  VerificationStatus,
} from '@/lib/prisma-types'
import {
  assertPropertyAccess,
  assertSupplierAccess,
  type ActorContext,
} from '@/modules/tenancy/context'
import { clampAbilityRange } from '@/modules/catalog/service'
import { recordAudit } from '@/modules/workflows/audit'
import { track } from '@/modules/analytics/track'
import {
  joinDeclineSchema,
  joinDecisionSchema,
  joinRequestSchema,
  partnerExperienceSchema,
  partnerPriceSchema,
  supplierProfileSchema,
  verificationEvidenceSchema,
} from './schemas'

/**
 * A partner running their own business on ARC. See ADR-041.
 *
 * Until now a partner could be invited and could then read their bookings and
 * schedule departures — and nothing else. Their profile, their experiences and
 * their prices were all the hotel's to write, which meant a boutique hotel
 * taking on six local operators had to enter and maintain six businesses'
 * descriptions, six sets of certifications and six price lists, and a partner
 * who changed their price had to ask.
 *
 * **The one rule everything here is shaped around: a partner edits their
 * claims, never their standing.**
 *
 * They may change what their business is called, what it does, who to contact,
 * what certifications they say they hold, who insures them and when that policy
 * expires. They may not change whether ARC has *verified* any of it. Those are
 * different columns (`claimedInsurer` vs `insuranceOnFile`), the schemas here
 * cannot name the second set, and `/admin` remains the only route to a
 * `VERIFIED` status — non-negotiable 2, and the reason a guest-facing badge
 * means anything at all.
 *
 * **And a partner drafts; the hotel publishes.** An experience sells through
 * one property's storefront, under that property's agreement, at that
 * property's commission. A partner who could publish would be putting something
 * on a hotel's shelf that the hotel never agreed to sell. So a partner's
 * experience goes `DRAFT` → `PENDING_REVIEW`, and `setExperienceStatus` stays
 * OWNER-and-ADMIN only.
 */

/**
 * Loads a supplier the actor may act *as a partner for*, and refuses otherwise.
 *
 * `assertSupplierAccess` already answers "may this actor see this supplier",
 * which includes an owner inspecting their partner's view. That is right for
 * reading and wrong for writing: an owner editing a partner's own profile copy
 * through the partner surface would be a hotel writing a business's description
 * in that business's name. Writes here need the `SUPPLIER` membership, or
 * platform admin.
 */
async function assertActingAsSupplier(
  actor: ActorContext,
  supplierId: string,
): Promise<{ organizationId: string }> {
  const { organizationId } = await assertSupplierAccess(actor, supplierId)

  const isThePartner = actor.memberships.some(
    (m) => m.role === Role.SUPPLIER && m.supplierId === supplierId,
  )
  if (!isThePartner && !actor.isPlatformAdmin) {
    throw forbidden(
      'Only the partner themselves can change their own profile. You can see it, and you can ' +
        'change your agreement with them.',
    )
  }

  return { organizationId }
}

// === Profile =================================================================

export async function updateOwnProfile(
  actor: ActorContext,
  supplierId: string,
  raw: unknown,
): Promise<void> {
  const { organizationId } = await assertActingAsSupplier(actor, supplierId)
  const input = supplierProfileSchema.parse(raw)

  /*
   * A place has to be one of the destination's, not any uuid.
   *
   * `placeId` arrives from a select, and a select is a client-supplied id. The
   * predicate belongs in the query rather than in a check afterwards, which is
   * what `CLAUDE.md` asks of anything taking an id from a client.
   */
  if (input.placeId) {
    const place = await prisma.place.findUnique({
      where: { id: input.placeId },
      select: { id: true },
    })
    if (!place) throw notFound('Place')
  }

  await prisma.$transaction(async (tx) => {
    const before = await tx.supplier.findUniqueOrThrow({
      where: { id: supplierId },
      select: { name: true, contactEmail: true },
    })

    await tx.supplier.update({
      where: { id: supplierId },
      data: {
        name: input.name,
        legalName: input.legalName ?? null,
        description: input.description ?? null,
        categories: input.categories,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone ?? null,
        placeId: input.placeId ?? null,
      },
    })

    await recordAudit(
      {
        organizationId,
        actor,
        action: 'partner.profile.updated',
        entityType: 'Supplier',
        entityId: supplierId,
        /*
         * Field names, not values. The partner's contact email is a person's
         * address, and `recordAudit` redacts on the way in — but the honest
         * form is to record *that* the contact changed, which is the thing a
         * later reviewer needs, rather than what it changed to.
         */
        metadata: {
          nameChanged: before.name !== input.name,
          contactEmailChanged: before.contactEmail !== input.contactEmail,
          categories: input.categories,
        },
      },
      tx,
    )
  })
}

// === Verification evidence ===================================================

export interface EvidenceOutcome {
  /** The standing after submitting. Never `VERIFIED`. */
  verification: VerificationStatus
  /** What ARC still needs, in the partner's own terms. */
  outstanding: string[]
}

/**
 * Records what a partner says about their own credentials, and asks for a check.
 *
 * Moves `verification` to `PENDING` from `UNVERIFIED` or `REJECTED`, which means
 * "somebody has asked us to look" and nothing more. A partner who is already
 * `VERIFIED` keeps that status: re-submitting evidence must not un-verify a
 * business mid-season, and the admin surface shows the new claims against the
 * existing decision so a reviewer can see what changed.
 *
 * It does not touch `insuranceOnFile`, `insuranceExpiresOn`, `verifiedChecks`
 * or `verifiedAt`. A database CHECK (ADR-041) also forbids `insuranceOnFile`
 * without a recorded check, so even a future bug here cannot turn a claim into
 * a verified fact.
 */
export async function submitVerificationEvidence(
  actor: ActorContext,
  supplierId: string,
  raw: unknown,
): Promise<EvidenceOutcome> {
  const { organizationId } = await assertActingAsSupplier(actor, supplierId)
  const input = verificationEvidenceSchema.parse(raw)

  const current = await prisma.supplier.findUniqueOrThrow({
    where: { id: supplierId },
    select: { verification: true, status: true },
  })

  // An expiry already in the past is a certificate that has run out, and
  // submitting it would waste a reviewer's time and the partner's.
  if (input.claimedInsuranceExpiresOn) {
    const expires = fromDateKey(input.claimedInsuranceExpiresOn)
    if (expires.getTime() <= Date.now()) {
      throw invalid('That policy has already expired. Send the current certificate instead.', {
        claimedInsuranceExpiresOn: 'This date is in the past.',
      })
    }
  }

  const nextVerification =
    current.verification === VerificationStatus.VERIFIED
      ? VerificationStatus.VERIFIED
      : VerificationStatus.PENDING

  await prisma.$transaction(async (tx) => {
    await tx.supplier.update({
      where: { id: supplierId },
      data: {
        claimedCertifications: input.claimedCertifications,
        claimedInsurer: input.claimedInsurer ?? null,
        claimedInsurancePolicyRef: input.claimedInsurancePolicyRef ?? null,
        claimedInsuranceExpiresOn: input.claimedInsuranceExpiresOn
          ? fromDateKey(input.claimedInsuranceExpiresOn)
          : null,
        evidenceNotes: input.evidenceNotes ?? null,
        evidenceSubmittedAt: new Date(),
        verification: nextVerification,
        // A partner who has submitted evidence is no longer a bare draft, but
        // ACTIVE is a decision about them that only a check can make.
        status:
          current.status === EntityStatus.DRAFT
            ? EntityStatus.PENDING_VERIFICATION
            : current.status,
      },
    })

    await recordAudit(
      {
        organizationId,
        actor,
        action: 'partner.evidence.submitted',
        entityType: 'Supplier',
        entityId: supplierId,
        metadata: {
          certificationCount: input.claimedCertifications.length,
          insurerClaimed: Boolean(input.claimedInsurer),
          expiryClaimed: Boolean(input.claimedInsuranceExpiresOn),
          verificationBefore: current.verification,
          verificationAfter: nextVerification,
        },
      },
      tx,
    )
  })

  const outstanding: string[] = []
  if (!input.claimedInsurer) {
    outstanding.push('Public liability insurance: name the insurer and the expiry date.')
  } else if (!input.claimedInsuranceExpiresOn) {
    outstanding.push('The expiry date of that policy.')
  }
  if (input.claimedCertifications.length === 0) {
    outstanding.push('Any certifications your guides or crew hold.')
  }
  outstanding.push(
    'ARC checks these against the documents themselves. Until that is done your listings ' +
      'show guests that you are not yet verified.',
  )

  return { verification: nextVerification, outstanding }
}

// === Experiences =============================================================

/** The properties this partner has an agreement with, for the form's select. */
export async function listOwnStorefronts(
  actor: ActorContext,
  supplierId: string,
): Promise<Array<{ propertyId: string; name: string; hotelCommissionBps: number }>> {
  await assertSupplierAccess(actor, supplierId)

  const agreements = await prisma.supplierAgreement.findMany({
    where: { supplierId },
    select: {
      hotelCommissionBps: true,
      property: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  return agreements.map((a) => ({
    propertyId: a.property.id,
    name: a.property.name,
    hotelCommissionBps: a.hotelCommissionBps,
  }))
}

/**
 * Drafts an experience the partner will offer through one hotel's storefront.
 *
 * Always `DRAFT`, whatever is asked for. The hotel publishes.
 */
export async function createOwnExperience(
  actor: ActorContext,
  supplierId: string,
  raw: unknown,
): Promise<{ id: string; slug: string; adjustments: string[] }> {
  const { organizationId } = await assertActingAsSupplier(actor, supplierId)
  const input = partnerExperienceSchema.parse(raw)

  /*
   * The agreement is the authorisation.
   *
   * Scoped by `supplierId` in the `where` clause, so a partner cannot name a
   * property they have no relationship with — which would put a listing on a
   * stranger's storefront. Both ids come from the client; only one of them is
   * the actor's own.
   */
  const agreement = await prisma.supplierAgreement.findFirst({
    where: { supplierId, propertyId: input.propertyId },
    select: { id: true, property: { select: { id: true, organizationId: true } } },
  })
  if (!agreement) {
    throw forbidden('You do not have an agreement with that hotel, so you cannot list there.')
  }
  if (agreement.property.organizationId !== organizationId) {
    // Defence in depth: a supplier and its agreement's property must be in the
    // same tenant, and a mismatch is a bug rather than a user error.
    throw forbidden('That hotel is not in the same account as your partner record.')
  }

  const activity = await prisma.activity.findUnique({
    where: { id: input.activityId },
    select: {
      id: true,
      category: true,
      minAbility: true,
      maxAbility: true,
      guideRequired: true,
      minAgeYears: true,
    },
  })
  if (!activity) throw notFound('Activity')

  /*
   * The ability range comes from the activity, not from the partner.
   *
   * An owner's form asks for a range and `clampAbilityRange` narrows it; here
   * there is nothing to ask, because the activity's own range is the only
   * honest answer and a partner widening it is a partner switching off a
   * safety rule (ADR-017, ADR-018). Passing the activity's own values through
   * the clamp keeps one code path rather than two.
   */
  const clamped = clampAbilityRange(
    { minAbility: activity.minAbility, maxAbility: activity.maxAbility },
    activity,
  )

  const slug = await uniqueExperienceSlug(input.propertyId, input.titleEn)

  const created = await prisma.$transaction(async (tx) => {
    const experience = await tx.experience.create({
      data: {
        organizationId,
        propertyId: input.propertyId,
        supplierId,
        activityId: activity.id,
        placeId: input.placeId ?? null,
        slug,
        titleEn: input.titleEn,
        titleEs: input.titleEs ?? null,
        summaryEn: input.summaryEn ?? null,
        summaryEs: input.summaryEs ?? null,
        descriptionEn: input.descriptionEn ?? null,
        descriptionEs: input.descriptionEs ?? null,
        // The activity's category is authoritative: a surf lesson cannot be
        // filed under DINING to dodge a safety rule.
        category: activity.category,
        durationMinutes: input.durationMinutes,
        minAbility: clamped.minAbility as typeof activity.minAbility,
        maxAbility: clamped.maxAbility as typeof activity.maxAbility,
        minParty: input.minParty,
        maxParty: input.maxParty,
        minAgeYears: input.minAgeYears ?? activity.minAgeYears,
        defaultCapacity: input.defaultCapacity,
        includesTransfer: input.includesTransfer,
        // An activity that requires a guide includes one, whatever the form
        // said: `checkPublishReadiness` blocks publication otherwise, and
        // letting the draft disagree with the activity only defers the refusal.
        guideIncluded: activity.guideRequired ? true : input.guideIncluded,
        meetingPoint: input.meetingPoint ?? null,
        whatToBringEn: input.whatToBringEn ?? null,
        whatToBringEs: input.whatToBringEs ?? null,
        cancellationPolicyHours: input.cancellationPolicyHours,
        // Always a draft. The hotel publishes.
        status: ExperienceStatus.DRAFT,
      },
      select: { id: true, slug: true },
    })

    await tx.price.create({
      data: {
        organizationId,
        experienceId: experience.id,
        kind: PriceKind.BASE,
        amountMinor: input.priceMinor,
        // The booking fee is ARC's, not the partner's, so it is not on their
        // form and is not set here.
        bookingFeeMinor: 0,
        minParty: 1,
        isActive: true,
      },
    })

    await recordAudit(
      {
        organizationId,
        actor,
        action: 'partner.experience.drafted',
        entityType: 'Experience',
        entityId: experience.id,
        metadata: {
          propertyId: input.propertyId,
          category: activity.category,
          priceMinor: input.priceMinor,
          adjustments: clamped.adjustments,
        },
      },
      tx,
    )

    return experience
  })

  await track({
    organizationId,
    propertyId: input.propertyId,
    name: 'partner_experience_drafted',
    surface: 'partner',
    subject: actor.userId,
    properties: { experienceId: created.id, category: activity.category },
  })

  return { ...created, adjustments: clamped.adjustments }
}

/**
 * Edits an experience the partner owns.
 *
 * Refuses while the listing is `PUBLISHED`. A published experience is on a
 * hotel's storefront and may already be in somebody's basket at a stated
 * duration, meeting point and party size; silently rewriting it would change
 * what a guest agreed to buy after they agreed. The partner pauses it, or asks
 * the hotel to — which is a conversation the hotel should be in anyway.
 *
 * A **price** is the exception and has its own function, because a new price is
 * a new row rather than an edit, and a basket holds the price it captured.
 */
export async function updateOwnExperience(
  actor: ActorContext,
  supplierId: string,
  experienceId: string,
  raw: unknown,
): Promise<{ adjustments: string[] }> {
  const { organizationId } = await assertActingAsSupplier(actor, supplierId)
  const input = partnerExperienceSchema.parse(raw)

  // Ownership in the `where` clause, not a check afterwards.
  const existing = await prisma.experience.findFirst({
    where: { id: experienceId, supplierId },
    select: {
      id: true,
      propertyId: true,
      status: true,
      activity: {
        select: { id: true, category: true, minAbility: true, maxAbility: true, guideRequired: true },
      },
    },
  })
  if (!existing) throw notFound('Experience')

  if (existing.status === ExperienceStatus.PUBLISHED) {
    throw conflict(
      'This listing is live on the hotel’s storefront, so it cannot be edited in place. Pause ' +
        'it first, or ask the hotel to — a guest may have it in their basket at the current terms.',
    )
  }

  if (input.propertyId !== existing.propertyId) {
    throw invalid(
      'An experience belongs to one hotel’s storefront. Create a separate listing for the other hotel.',
    )
  }

  const clamped = clampAbilityRange(
    { minAbility: existing.activity.minAbility, maxAbility: existing.activity.maxAbility },
    existing.activity,
  )

  await prisma.$transaction(async (tx) => {
    await tx.experience.update({
      where: { id: experienceId },
      data: {
        titleEn: input.titleEn,
        titleEs: input.titleEs ?? null,
        summaryEn: input.summaryEn ?? null,
        summaryEs: input.summaryEs ?? null,
        descriptionEn: input.descriptionEn ?? null,
        descriptionEs: input.descriptionEs ?? null,
        placeId: input.placeId ?? null,
        durationMinutes: input.durationMinutes,
        minParty: input.minParty,
        maxParty: input.maxParty,
        minAgeYears: input.minAgeYears ?? null,
        defaultCapacity: input.defaultCapacity,
        includesTransfer: input.includesTransfer,
        guideIncluded: existing.activity.guideRequired ? true : input.guideIncluded,
        meetingPoint: input.meetingPoint ?? null,
        whatToBringEn: input.whatToBringEn ?? null,
        whatToBringEs: input.whatToBringEs ?? null,
        cancellationPolicyHours: input.cancellationPolicyHours,
        minAbility: clamped.minAbility as typeof existing.activity.minAbility,
        maxAbility: clamped.maxAbility as typeof existing.activity.maxAbility,
      },
    })

    await recordAudit(
      {
        organizationId,
        actor,
        action: 'partner.experience.updated',
        entityType: 'Experience',
        entityId: experienceId,
        metadata: { status: existing.status },
      },
      tx,
    )
  })

  return { adjustments: clamped.adjustments }
}

/**
 * Sets a new base price on the partner's own experience.
 *
 * Deactivates the old active base price and writes a new row rather than
 * editing in place, because a basket and an order each captured the price they
 * were quoted and a historical figure must stay recoverable — the ledger is
 * reconciled against it.
 *
 * Allowed while published: a price change affects what the *next* guest is
 * quoted, which is the partner's to decide, and existing baskets re-validate
 * their captured price at checkout.
 */
export async function setOwnPrice(
  actor: ActorContext,
  supplierId: string,
  raw: unknown,
): Promise<void> {
  const { organizationId } = await assertActingAsSupplier(actor, supplierId)
  const input = partnerPriceSchema.parse(raw)

  const experience = await prisma.experience.findFirst({
    where: { id: input.experienceId, supplierId },
    select: {
      id: true,
      propertyId: true,
      /*
       * The currency comes from the property, not from the partner.
       *
       * `Experience` carries none — money lives on `Price`, and the storefront
       * decides the currency it sells in. A partner choosing it would let one
       * listing on a peso storefront be priced in something else, and
       * `computeCartTotals` refuses a basket with mixed currencies.
       */
      property: { select: { currency: true } },
    },
  })
  if (!experience) throw notFound('Experience')

  await prisma.$transaction(async (tx) => {
    await tx.price.updateMany({
      where: {
        experienceId: experience.id,
        kind: PriceKind.BASE,
        minParty: input.minParty,
        isActive: true,
      },
      data: { isActive: false },
    })

    await tx.price.create({
      data: {
        organizationId,
        experienceId: experience.id,
        kind: PriceKind.BASE,
        amountMinor: input.amountMinor,
        bookingFeeMinor: 0,
        minParty: input.minParty,
        currency: experience.property.currency,
        note: input.note ?? null,
        isActive: true,
      },
    })

    await recordAudit(
      {
        organizationId,
        actor,
        action: 'partner.price.set',
        entityType: 'Experience',
        entityId: experience.id,
        metadata: { amountMinor: input.amountMinor, minParty: input.minParty },
      },
      tx,
    )
  })
}

export interface SubmitOutcome {
  /** What the hotel will be asked to fix before it can publish. */
  blockers: string[]
  warnings: string[]
  submitted: boolean
}

/**
 * Hands a draft to the hotel to publish.
 *
 * `DRAFT` or `PAUSED` → `PENDING_REVIEW`. The partner cannot go further, and
 * the readiness check runs here so they find out what is missing while they
 * are still the person who can fix it — rather than the hotel discovering it
 * and having to ask.
 *
 * The blockers do not stop the submission. A hotel that can see an incomplete
 * submission can tell the partner what is missing; a submission that silently
 * refuses leaves the partner thinking they are waiting on the hotel.
 */
export async function submitOwnExperienceForReview(
  actor: ActorContext,
  supplierId: string,
  experienceId: string,
): Promise<SubmitOutcome> {
  const { organizationId } = await assertActingAsSupplier(actor, supplierId)

  const experience = await prisma.experience.findFirst({
    where: { id: experienceId, supplierId },
    select: { id: true, status: true, propertyId: true },
  })
  if (!experience) throw notFound('Experience')

  if (experience.status === ExperienceStatus.PUBLISHED) {
    throw conflict('This is already live on the hotel’s storefront.')
  }
  if (experience.status === ExperienceStatus.PENDING_REVIEW) {
    throw conflict('The hotel already has this one to review.')
  }
  if (experience.status === ExperienceStatus.ARCHIVED) {
    throw conflict('This listing is archived. Create a new one.')
  }

  // Imported here rather than at the top: `checkPublishReadiness` lives in the
  // catalog module, which imports nothing from this one, so the dependency
  // points one way and stays that way.
  const { checkPublishReadiness } = await import('@/modules/catalog/service')
  const readiness = await checkPublishReadiness(experienceId)

  await prisma.$transaction(async (tx) => {
    await tx.experience.update({
      where: { id: experienceId },
      data: { status: ExperienceStatus.PENDING_REVIEW },
    })

    await recordAudit(
      {
        organizationId,
        actor,
        action: 'partner.experience.submitted',
        entityType: 'Experience',
        entityId: experienceId,
        metadata: {
          from: experience.status,
          blockerCount: readiness.blockers.length,
        },
      },
      tx,
    )
  })

  await track({
    organizationId,
    propertyId: experience.propertyId,
    name: 'partner_experience_submitted',
    surface: 'partner',
    subject: actor.userId,
    properties: { experienceId, ready: readiness.ready },
  })

  return { blockers: readiness.blockers, warnings: readiness.warnings, submitted: true }
}

/** Takes a partner's own listing off sale. Publishing back is the hotel's. */
export async function pauseOwnExperience(
  actor: ActorContext,
  supplierId: string,
  experienceId: string,
): Promise<void> {
  const { organizationId } = await assertActingAsSupplier(actor, supplierId)

  const experience = await prisma.experience.findFirst({
    where: { id: experienceId, supplierId },
    select: { id: true, status: true },
  })
  if (!experience) throw notFound('Experience')

  if (
    experience.status !== ExperienceStatus.PUBLISHED &&
    experience.status !== ExperienceStatus.PENDING_REVIEW
  ) {
    throw conflict('This listing is not on sale, so there is nothing to pause.')
  }

  /*
   * Pausing stops new bookings and touches nothing already booked.
   *
   * A partner who cannot deliver next Tuesday closes that departure
   * (`closeSlot`); pausing the listing is about not taking more. Cancelling
   * what is booked is a consequential action with a guest and a refund at the
   * other end of it, and needs the cancellation path and its approval — not a
   * status change (non-negotiable 6).
   */
  await prisma.$transaction(async (tx) => {
    await tx.experience.update({
      where: { id: experienceId },
      data: { status: ExperienceStatus.PAUSED },
    })

    await recordAudit(
      {
        organizationId,
        actor,
        action: 'partner.experience.paused',
        entityType: 'Experience',
        entityId: experienceId,
        metadata: { from: experience.status },
      },
      tx,
    )
  })
}

/** One of the partner's own listings, loaded for their edit form. */
export async function getOwnExperienceForEdit(
  actor: ActorContext,
  supplierId: string,
  experienceId: string,
) {
  await assertSupplierAccess(actor, supplierId)

  const experience = await prisma.experience.findFirst({
    where: { id: experienceId, supplierId },
    include: {
      activity: { select: { id: true, name: true, category: true, guideRequired: true } },
      property: { select: { id: true, name: true } },
      place: { select: { id: true, name: true } },
      prices: {
        where: { isActive: true },
        select: { id: true, kind: true, amountMinor: true, minParty: true, currency: true },
        orderBy: { minParty: 'asc' },
      },
    },
  })
  if (!experience) throw notFound('Experience')
  return experience
}

/** The activity types a partner may build a listing on. */
export async function listActivityOptions(
  actor: ActorContext,
  supplierId: string,
): Promise<Array<{ id: string; name: string; category: string; guideRequired: boolean }>> {
  await assertSupplierAccess(actor, supplierId)

  return prisma.activity.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, category: true, guideRequired: true },
  })
}

/** The places a partner may say they operate from. */
export async function listPlaceOptions(
  actor: ActorContext,
  supplierId: string,
): Promise<Array<{ id: string; name: string }>> {
  await assertSupplierAccess(actor, supplierId)
  return prisma.place.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } })
}

async function uniqueExperienceSlug(propertyId: string, base: string): Promise<string> {
  const root = slugify(base) || 'experience'
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`
    const existing = await prisma.experience.findUnique({
      where: { propertyId_slug: { propertyId, slug: candidate } },
      select: { id: true },
    })
    if (!existing) return candidate
  }
  throw conflict('Could not generate a unique slug for that title.')
}

// === The cold route in =======================================================

/**
 * A hotel a business can ask to work with.
 *
 * `ACTIVE` only. A hotel that is still a draft has not finished onboarding and
 * has no agreement terms to offer; listing it would invite requests nobody is
 * watching for. Returns the name and the slug and nothing else — this list is
 * public, and a hotel's contact details, room count and guest numbers are not.
 */
export async function listOpenStorefronts(): Promise<
  Array<{ slug: string; name: string; placeName: string | null }>
> {
  const properties = await prisma.property.findMany({
    where: { status: EntityStatus.ACTIVE },
    orderBy: { name: 'asc' },
    select: { slug: true, name: true, place: { select: { name: true } } },
  })

  return properties.map((p) => ({
    slug: p.slug,
    name: p.name,
    placeName: p.place?.name ?? null,
  }))
}

export interface JoinRequestOutcome {
  /** Always true. Whether a request already existed is not the caller's to know. */
  received: true
  /** The hotel's display name, so the page can say who will see it. */
  propertyName: string
}

/**
 * Records a business asking a hotel to take them on.
 *
 * **This creates no commercial relationship.** No `Supplier`, no
 * `SupplierAgreement`, no `Membership`, no account and no credential. It
 * creates a row a hotel owner can read and act on, and nothing else, because
 * inventing the relationship from the asking side is exactly what
 * non-negotiable 2 forbids — and because otherwise anybody with this form could
 * put their business in a real hotel's partner list.
 *
 * Unauthenticated, so bounded per caller and per hotel. A duplicate is
 * swallowed rather than reported: telling the sender "you already asked" would
 * let the form answer "is this address already working with this hotel", and
 * somebody who sends it twice is usually somebody who was not sure it went
 * through the first time.
 */
export async function requestToJoinProperty(
  raw: unknown,
  options: { requesterKey?: string | null; now?: Date } = {},
): Promise<JoinRequestOutcome> {
  const input = joinRequestSchema.parse(raw)
  const now = options.now ?? new Date()

  if (options.requesterKey) {
    await assertWithinRateLimit({
      bucket: `partner-join:from:${rateLimitSubject(options.requesterKey)}`,
      limit: 5,
      windowSeconds: 3_600,
      message: 'Too many requests from here. Try again later.',
      now,
    })
  }

  const property = await prisma.property.findFirst({
    where: { slug: input.propertySlug, status: EntityStatus.ACTIVE },
    select: { id: true, name: true, organizationId: true },
  })
  /*
   * A slug that is not an active hotel is `notFound`, which is also what an
   * inactive one gets. The form offers a fixed list, so a miss here is either
   * a stale page or somebody poking at it, and neither needs the difference.
   */
  if (!property) throw notFound('Hotel')

  // Per hotel as well as per caller, so one property cannot be buried under
  // requests from a rotating set of addresses.
  await assertWithinRateLimit({
    bucket: `partner-join:to:${property.id}`,
    limit: 40,
    windowSeconds: 3_600,
    message: 'That hotel has had a lot of requests today. Try again tomorrow.',
    now,
  })

  await prisma.$transaction(async (tx) => {
    const existing = await tx.supplierJoinRequest.findUnique({
      where: {
        propertyId_contactEmail: {
          propertyId: property.id,
          contactEmail: input.contactEmail,
        },
      },
      select: { id: true, status: true },
    })

    if (existing) {
      /*
       * A second ask replaces a pending or withdrawn one and leaves a decided
       * one alone.
       *
       * Replacing a pending request is right: the sender is correcting or
       * re-sending, and two rows for one business would make the owner choose
       * between them. Leaving an ACCEPTED one alone is right because they are
       * already a partner, and leaving a DECLINED one alone is right because
       * re-opening a hotel's commercial decision is not this form's to do.
       */
      if (existing.status === 'PENDING' || existing.status === 'WITHDRAWN') {
        await tx.supplierJoinRequest.update({
          where: { id: existing.id },
          data: {
            businessName: input.businessName,
            contactName: input.contactName,
            contactPhone: input.contactPhone ?? null,
            categories: input.categories,
            pitch: input.pitch ?? null,
            claimedCertifications: input.claimedCertifications,
            locale: input.locale,
            status: 'PENDING',
            decidedAt: null,
            decidedById: null,
            decisionNote: null,
            requestedFromHash: options.requesterKey
              ? rateLimitSubject(options.requesterKey)
              : null,
          },
        })
      }
      return
    }

    await tx.supplierJoinRequest.create({
      data: {
        propertyId: property.id,
        organizationId: property.organizationId,
        businessName: input.businessName,
        contactName: input.contactName,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone ?? null,
        categories: input.categories,
        pitch: input.pitch ?? null,
        claimedCertifications: input.claimedCertifications,
        locale: input.locale,
        requestedFromHash: options.requesterKey
          ? rateLimitSubject(options.requesterKey)
          : null,
      },
    })

    /*
     * Audited with no actor: nobody is signed in, and `actorKind: 'system'`
     * would claim ARC did it. The business name is in the metadata because it
     * is a business's own public name rather than a person's data, and an
     * owner investigating a wave of requests needs to see what they were.
     */
    await recordAudit(
      {
        organizationId: property.organizationId,
        actorKind: 'system',
        action: 'partner.join.requested',
        entityType: 'Property',
        entityId: property.id,
        metadata: {
          businessName: input.businessName,
          categories: input.categories,
          certificationCount: input.claimedCertifications.length,
        },
      },
      tx,
    )
  })

  return { received: true, propertyName: property.name }
}

export interface JoinRequestRow {
  id: string
  businessName: string
  contactName: string
  contactEmail: string
  contactPhone: string | null
  categories: string[]
  pitch: string | null
  claimedCertifications: string[]
  status: JoinRequestStatus
  createdAt: Date
  decidedAt: Date | null
  decisionNote: string | null
  createdSupplierId: string | null
}

/** The requests one hotel has had. Scoped in the `where` clause. */
export async function listJoinRequests(
  actor: ActorContext,
  propertyId: string,
  options?: { status?: JoinRequestStatus },
): Promise<JoinRequestRow[]> {
  await assertPropertyAccess(actor, propertyId, Role.OWNER, Role.STAFF, Role.ADMIN)

  return prisma.supplierJoinRequest.findMany({
    where: { propertyId, ...(options?.status ? { status: options.status } : {}) },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      businessName: true,
      contactName: true,
      contactEmail: true,
      contactPhone: true,
      categories: true,
      pitch: true,
      claimedCertifications: true,
      status: true,
      createdAt: true,
      decidedAt: true,
      decisionNote: true,
      createdSupplierId: true,
    },
  })
}

/**
 * Accepts a request: this is where the commercial relationship is created.
 *
 * Deliberately routed through `invitePartner` rather than reimplementing it.
 * That function already refuses an email that already has an account (ADR-021),
 * creates the supplier, the membership and the agreement in one transaction,
 * mints the invitation and now emails it (ADR-040) — and every one of those
 * behaviours is one this path must have too. A second implementation would
 * drift from it, and the first thing to drift would be the refusal.
 *
 * The owner sets the commission here, because that is the term being agreed and
 * the request did not propose one. Nothing the business typed sets it.
 */
export async function acceptJoinRequest(
  actor: ActorContext,
  propertyId: string,
  raw: unknown,
): Promise<{ supplierId: string; invitationToken: string | null; emailStatus: string | null }> {
  const { organizationId } = await assertPropertyAccess(actor, propertyId, Role.OWNER, Role.ADMIN)
  const input = joinDecisionSchema.parse(raw)

  // Both ids from the client; the predicate pairs them in the query.
  const request = await prisma.supplierJoinRequest.findFirst({
    where: { id: input.requestId, propertyId },
    select: {
      id: true,
      status: true,
      businessName: true,
      contactName: true,
      contactEmail: true,
      contactPhone: true,
      categories: true,
      pitch: true,
      claimedCertifications: true,
      locale: true,
    },
  })
  if (!request) throw notFound('Request')
  if (request.status !== 'PENDING') {
    throw conflict('That request has already been decided.')
  }

  const { invitePartner } = await import('@/modules/hotels/service')

  const created = await invitePartner(actor, propertyId, {
    name: request.businessName,
    contactName: request.contactName,
    contactEmail: request.contactEmail,
    contactPhone: request.contactPhone,
    categories: request.categories,
    description: request.pitch,
    hotelCommissionBps: input.hotelCommissionBps,
    contactLocale: request.locale,
  })

  await prisma.$transaction(async (tx) => {
    /*
     * The claims come across, as claims.
     *
     * `invitePartner` has no field for them, and they are the one thing in the
     * request that is worth keeping: a business that listed its certifications
     * should not have to type them again, and ARC's reviewer should see what
     * was claimed at the point of asking. Written to the `claimed*` columns,
     * which is where a claim lives (ADR-041), and `evidenceSubmittedAt` is
     * left null because the business has not submitted anything to *ARC* yet.
     */
    if (request.claimedCertifications.length > 0) {
      await tx.supplier.update({
        where: { id: created.supplierId },
        data: { claimedCertifications: request.claimedCertifications },
      })
    }

    // Single-decision, enforced by the `where` clause rather than by the read
    // above: two owners pressing Accept must not create two suppliers.
    const claimed = await tx.supplierJoinRequest.updateMany({
      where: { id: request.id, status: 'PENDING' },
      data: {
        status: 'ACCEPTED',
        decidedAt: new Date(),
        decidedById: actor.userId,
        decisionNote: input.decisionNote ?? null,
        createdSupplierId: created.supplierId,
      },
    })
    if (claimed.count !== 1) throw conflict('That request has already been decided.')

    await recordAudit(
      {
        organizationId,
        actor,
        action: 'partner.join.accepted',
        entityType: 'Supplier',
        entityId: created.supplierId,
        metadata: {
          requestId: request.id,
          hotelCommissionBps: input.hotelCommissionBps,
          certificationCount: request.claimedCertifications.length,
        },
      },
      tx,
    )
  })

  return {
    supplierId: created.supplierId,
    invitationToken: created.invitation?.token ?? null,
    emailStatus: created.emailStatus,
  }
}

/**
 * Declines a request.
 *
 * Nothing is emailed. A hotel choosing not to work with a business is a
 * commercial decision, and ARC writing to tell them so in the hotel's name —
 * with wording the hotel did not see — is not ARC's to send. The note is for
 * the owner's own record. An owner who wants to reply has the address.
 */
export async function declineJoinRequest(
  actor: ActorContext,
  propertyId: string,
  raw: unknown,
): Promise<void> {
  const { organizationId } = await assertPropertyAccess(actor, propertyId, Role.OWNER, Role.ADMIN)
  const input = joinDeclineSchema.parse(raw)

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.supplierJoinRequest.updateMany({
      where: { id: input.requestId, propertyId, status: 'PENDING' },
      data: {
        status: 'DECLINED',
        decidedAt: new Date(),
        decidedById: actor.userId,
        decisionNote: input.decisionNote ?? null,
      },
    })
    if (claimed.count !== 1) throw notFound('Request')

    await recordAudit(
      {
        organizationId,
        actor,
        action: 'partner.join.declined',
        entityType: 'Property',
        entityId: propertyId,
        metadata: { requestId: input.requestId },
      },
      tx,
    )
  })
}

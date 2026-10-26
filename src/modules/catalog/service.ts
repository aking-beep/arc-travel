import { prisma } from '@/lib/db'
import { verificationStanding } from '@/modules/admin/verification'
import { conflict, invalid, notFound } from '@/lib/errors'
import { fromDateKey, localInstant } from '@/lib/dates'
import {
  ExperienceStatus,
  PriceKind,
  Provenance,
  Role,
  SlotStatus,
  VerificationStatus,
} from '@/lib/prisma-types'
import { assertWithinOperatingWindow } from '@/modules/destination/operating-window'
import { assertPropertyAccess, type ActorContext } from '@/modules/tenancy/context'
import { recordAudit } from '@/modules/workflows/audit'
import { track } from '@/modules/analytics/track'
import {
  experienceInputSchema,
  priceInputSchema,
  slotInputSchema,
  type ExperienceInput,
} from './schemas'

/**
 * Catalog service: the owner's and partner's write path into sellable product.
 *
 * Two rules run through everything here:
 *   1. An experience inherits its safety envelope from its Activity. An owner
 *      can set a *narrower* ability range than the activity allows but never a
 *      wider one, so no amount of catalog editing can make Zicatela a beginner
 *      product.
 *   2. Publishing is a state transition with preconditions, not a boolean flip.
 */
function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

async function uniqueSlug(propertyId: string, base: string): Promise<string> {
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

const ABILITY_ORDER = ['BEGINNER', 'IMPROVER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'] as const
const rank = (level: string): number => ABILITY_ORDER.indexOf(level as (typeof ABILITY_ORDER)[number])

/**
 * Clamps a requested ability range into the activity's envelope.
 *
 * Returns the clamped range plus any adjustments, which the caller surfaces to
 * the owner. Silently widening would be a safety bug; silently narrowing
 * without telling them would be confusing, so we do neither.
 */
export function clampAbilityRange(
  requested: { minAbility: string; maxAbility: string },
  activity: { minAbility: string; maxAbility: string },
): { minAbility: string; maxAbility: string; adjustments: string[] } {
  const adjustments: string[] = []
  let min = requested.minAbility
  let max = requested.maxAbility

  if (rank(min) < rank(activity.minAbility)) {
    adjustments.push(
      `Minimum ability raised to ${activity.minAbility}: the underlying activity is not suitable below that level.`,
    )
    min = activity.minAbility
  }
  if (rank(max) > rank(activity.maxAbility)) {
    adjustments.push(
      `Maximum ability lowered to ${activity.maxAbility} to match the underlying activity.`,
    )
    max = activity.maxAbility
  }

  // The two ends are clamped independently, so a narrow request outside the
  // envelope could cross them over — asking for BEGINNER–BEGINNER against an
  // ADVANCED–EXPERT activity used to store ADVANCED–BEGINNER. It failed closed
  // (every guest was then excluded by both filters) but it was stored silently
  // and shown to guests as "Suitable for Advanced–Beginner".
  if (rank(min) > rank(max)) {
    adjustments.push(
      `Maximum ability raised to ${min}: the requested range sat entirely outside what the activity allows.`,
    )
    max = min
  }

  return { minAbility: min, maxAbility: max, adjustments }
}

export async function createExperience(
  actor: ActorContext,
  propertyId: string,
  raw: unknown,
): Promise<{ id: string; slug: string; adjustments: string[] }> {
  const { organizationId } = await assertPropertyAccess(actor, propertyId, Role.OWNER, Role.STAFF, Role.ADMIN)
  const input: ExperienceInput = experienceInputSchema.parse(raw)

  const [supplier, activity] = await Promise.all([
    prisma.supplier.findFirst({
      where: { id: input.supplierId, organizationId },
      select: { id: true, name: true },
    }),
    prisma.activity.findUnique({
      where: { id: input.activityId },
      select: { id: true, category: true, minAbility: true, maxAbility: true, guideRequired: true, minAgeYears: true },
    }),
  ])

  if (!supplier) throw notFound('Partner')
  if (!activity) throw notFound('Activity')

  const clamped = clampAbilityRange(input, activity)
  const slug = await uniqueSlug(propertyId, input.titleEn)

  const created = await prisma.$transaction(async (tx) => {
    const experience = await tx.experience.create({
      data: {
        organizationId,
        propertyId,
        supplierId: supplier.id,
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
        status: ExperienceStatus.DRAFT,
        durationMinutes: input.durationMinutes,
        minAbility: clamped.minAbility as ExperienceInput['minAbility'],
        maxAbility: clamped.maxAbility as ExperienceInput['maxAbility'],
        minParty: input.minParty,
        maxParty: input.maxParty,
        minAgeYears: input.minAgeYears ?? activity.minAgeYears ?? null,
        defaultCapacity: input.defaultCapacity,
        includesTransfer: input.includesTransfer,
        // A guide-required activity always ships with a guide, whatever the
        // form said.
        guideIncluded: activity.guideRequired ? true : input.guideIncluded,
        meetingPoint: input.meetingPoint ?? null,
        whatToBringEn: input.whatToBringEn ?? null,
        whatToBringEs: input.whatToBringEs ?? null,
        cancellationPolicyHours: input.cancellationPolicyHours,
        verification: VerificationStatus.UNVERIFIED,
        provenance: Provenance.HOTEL_SUBMITTED,
      },
      select: { id: true, slug: true },
    })

    await tx.price.create({
      data: {
        organizationId,
        experienceId: experience.id,
        kind: PriceKind.BASE,
        amountMinor: input.priceMinor,
        bookingFeeMinor: input.bookingFeeMinor,
        currency: 'MXN',
        minParty: 1,
        isActive: true,
      },
    })

    await recordAudit(
      {
        organizationId,
        actor,
        action: 'catalog.experience.created',
        entityType: 'Experience',
        entityId: experience.id,
        metadata: {
          supplierId: supplier.id,
          activityId: activity.id,
          priceMinor: input.priceMinor,
          abilityAdjustments: clamped.adjustments,
        },
      },
      tx,
    )

    return experience
  })

  await track({
    organizationId,
    propertyId,
    name: 'experience_created',
    surface: 'owner',
    subject: actor.userId,
    properties: { category: activity.category, supplierId: supplier.id },
  })

  return { ...created, adjustments: clamped.adjustments }
}

export async function updateExperience(
  actor: ActorContext,
  experienceId: string,
  raw: unknown,
): Promise<{ adjustments: string[] }> {
  const experience = await prisma.experience.findUnique({
    where: { id: experienceId },
    select: { id: true, propertyId: true, organizationId: true, activityId: true },
  })
  if (!experience) throw notFound('Experience')

  const { organizationId } = await assertPropertyAccess(
    actor, experience.propertyId, Role.OWNER, Role.STAFF, Role.ADMIN,
  )
  const input = experienceInputSchema.parse(raw)

  const activity = await prisma.activity.findUnique({
    where: { id: input.activityId },
    select: { id: true, category: true, minAbility: true, maxAbility: true, guideRequired: true },
  })
  if (!activity) throw notFound('Activity')

  const clamped = clampAbilityRange(input, activity)

  await prisma.$transaction(async (tx) => {
    await tx.experience.update({
      where: { id: experienceId },
      data: {
        supplierId: input.supplierId,
        activityId: activity.id,
        placeId: input.placeId ?? null,
        titleEn: input.titleEn,
        titleEs: input.titleEs ?? null,
        summaryEn: input.summaryEn ?? null,
        summaryEs: input.summaryEs ?? null,
        descriptionEn: input.descriptionEn ?? null,
        descriptionEs: input.descriptionEs ?? null,
        category: activity.category,
        durationMinutes: input.durationMinutes,
        minAbility: clamped.minAbility as ExperienceInput['minAbility'],
        maxAbility: clamped.maxAbility as ExperienceInput['maxAbility'],
        minParty: input.minParty,
        maxParty: input.maxParty,
        minAgeYears: input.minAgeYears ?? null,
        defaultCapacity: input.defaultCapacity,
        includesTransfer: input.includesTransfer,
        guideIncluded: activity.guideRequired ? true : input.guideIncluded,
        meetingPoint: input.meetingPoint ?? null,
        whatToBringEn: input.whatToBringEn ?? null,
        whatToBringEs: input.whatToBringEs ?? null,
        cancellationPolicyHours: input.cancellationPolicyHours,
      },
    })

    // Prices are versioned, never edited: supersede the active BASE row so a
    // historical order can still explain what it charged.
    const currentBase = await tx.price.findFirst({
      where: { experienceId, kind: PriceKind.BASE, isActive: true },
      orderBy: { validFrom: 'desc' },
      select: { id: true, amountMinor: true, bookingFeeMinor: true },
    })

    const priceChanged =
      !currentBase ||
      currentBase.amountMinor !== input.priceMinor ||
      currentBase.bookingFeeMinor !== input.bookingFeeMinor

    if (priceChanged) {
      if (currentBase) {
        await tx.price.update({
          where: { id: currentBase.id },
          data: { isActive: false, validTo: new Date() },
        })
      }
      await tx.price.create({
        data: {
          organizationId,
          experienceId,
          kind: PriceKind.BASE,
          amountMinor: input.priceMinor,
          bookingFeeMinor: input.bookingFeeMinor,
          currency: 'MXN',
          minParty: 1,
          isActive: true,
          note: currentBase ? `Supersedes ${currentBase.id}` : null,
        },
      })
    }

    await recordAudit(
      {
        organizationId,
        actor,
        action: 'catalog.experience.updated',
        entityType: 'Experience',
        entityId: experienceId,
        metadata: {
          priceChanged,
          priceMinor: input.priceMinor,
          abilityAdjustments: clamped.adjustments,
        },
      },
      tx,
    )
  })

  return { adjustments: clamped.adjustments }
}

/** Preconditions a draft must satisfy before guests can see it. */
export interface PublishReadiness {
  ready: boolean
  blockers: string[]
  warnings: string[]
}

export async function checkPublishReadiness(experienceId: string): Promise<PublishReadiness> {
  const experience = await prisma.experience.findUnique({
    where: { id: experienceId },
    select: {
      id: true,
      titleEn: true,
      summaryEn: true,
      descriptionEn: true,
      titleEs: true,
      meetingPoint: true,
      guideIncluded: true,
      activity: { select: { guideRequired: true, name: true } },
      supplier: {
        select: {
          name: true,
          verification: true,
          verifiedChecks: true,
          insuranceExpiresOn: true,
          insuranceOnFile: true,
          status: true,
        },
      },
      prices: { where: { isActive: true }, select: { id: true, amountMinor: true } },
      _count: { select: { slots: true } },
    },
  })
  if (!experience) throw notFound('Experience')

  const blockers: string[] = []
  const warnings: string[] = []

  if (experience.prices.length === 0) blockers.push('Set a price.')
  if (!experience.summaryEn) blockers.push('Add a one-line summary.')
  if (!experience.descriptionEn) blockers.push('Add a description.')
  if (!experience.meetingPoint) blockers.push('Add a meeting point.')
  if (experience._count.slots === 0) {
    blockers.push('Add at least one departure, or the partner must add availability.')
  }
  if (experience.activity.guideRequired && !experience.guideIncluded) {
    blockers.push(
      `${experience.activity.name} requires a certified guide, so the experience must include one.`,
    )
  }

  /*
   * The standing today, not the stored column — a verification that has lapsed
   * is reported as what it is rather than as a pass. ADR-036.
   */
  const standing = verificationStanding(experience.supplier)
  if (standing.standing === 'lapsed') {
    warnings.push(
      `${experience.supplier.name}'s verification has lapsed. ${standing.reason ?? ''} ` +
        'Guests see an "unverified partner" notice until it is re-checked.',
    )
  } else if (standing.standing !== 'verified') {
    warnings.push(
      `${experience.supplier.name} is not verified. Guests will see an "unverified partner" notice until ARC completes a check.`,
    )
  }
  if (!experience.supplier.insuranceOnFile) {
    warnings.push(`No insurance document on file for ${experience.supplier.name}.`)
  }
  if (!experience.titleEs) {
    warnings.push('No Spanish title. Spanish-speaking guests will see the English one.')
  }

  return { ready: blockers.length === 0, blockers, warnings }
}

/**
 * Moves an experience between lifecycle states.
 *
 * OWNER and ADMIN only. Creating and editing a draft is reasonable front-desk
 * work, but publishing makes something guest-visible, bookable and
 * money-earning — the same class of commitment that `decideProposal` restricts
 * to an owner — and archiving removes it from sale.
 */
export async function setExperienceStatus(
  actor: ActorContext,
  experienceId: string,
  status: ExperienceStatus,
): Promise<PublishReadiness> {
  const experience = await prisma.experience.findUnique({
    where: { id: experienceId },
    select: { id: true, propertyId: true, status: true },
  })
  if (!experience) throw notFound('Experience')

  const { organizationId } = await assertPropertyAccess(
    actor, experience.propertyId, Role.OWNER, Role.ADMIN,
  )

  const readiness =
    status === ExperienceStatus.PUBLISHED
      ? await checkPublishReadiness(experienceId)
      : { ready: true, blockers: [], warnings: [] }

  if (status === ExperienceStatus.PUBLISHED && !readiness.ready) {
    throw invalid('This experience is not ready to publish.', { blockers: readiness.blockers })
  }

  await prisma.$transaction(async (tx) => {
    await tx.experience.update({
      where: { id: experienceId },
      data: {
        status,
        publishedAt: status === ExperienceStatus.PUBLISHED ? new Date() : undefined,
      },
    })
    await recordAudit(
      {
        organizationId,
        actor,
        action: `catalog.experience.${status.toLowerCase()}`,
        entityType: 'Experience',
        entityId: experienceId,
        metadata: { from: experience.status, to: status, warnings: readiness.warnings },
      },
      tx,
    )
  })

  await track({
    organizationId,
    propertyId: experience.propertyId,
    name: 'experience_status_changed',
    surface: 'owner',
    subject: actor.userId,
    properties: { from: experience.status, to: status },
  })

  return readiness
}

export async function addPrice(actor: ActorContext, raw: unknown): Promise<void> {
  const input = priceInputSchema.parse(raw)
  const experience = await prisma.experience.findUnique({
    where: { id: input.experienceId },
    select: { id: true, propertyId: true },
  })
  if (!experience) throw notFound('Experience')

  const { organizationId } = await assertPropertyAccess(
    actor, experience.propertyId, Role.OWNER, Role.STAFF, Role.ADMIN,
  )

  await prisma.$transaction(async (tx) => {
    await tx.price.create({
      data: {
        organizationId,
        experienceId: input.experienceId,
        kind: input.kind as PriceKind,
        amountMinor: input.amountMinor,
        bookingFeeMinor: input.bookingFeeMinor,
        currency: 'MXN',
        minParty: input.minParty,
        isActive: true,
        note: input.note ?? null,
      },
    })
    await recordAudit(
      {
        organizationId,
        actor,
        action: 'catalog.price.created',
        entityType: 'Experience',
        entityId: input.experienceId,
        metadata: { kind: input.kind, amountMinor: input.amountMinor, minParty: input.minParty },
      },
      tx,
    )
  })
}

export async function addSlot(actor: ActorContext, raw: unknown): Promise<{ id: string }> {
  const input = slotInputSchema.parse(raw)
  const experience = await prisma.experience.findUnique({
    where: { id: input.experienceId },
    select: {
      id: true,
      propertyId: true,
      durationMinutes: true,
      activity: { select: { earliestStart: true, latestStart: true, seasonMonths: true } },
    },
  })
  if (!experience) throw notFound('Experience')

  const { organizationId } = await assertPropertyAccess(
    actor, experience.propertyId, Role.OWNER, Role.STAFF, Role.SUPPLIER, Role.ADMIN,
  )

  // A departure outside the activity's hours or season is refused at creation,
  // not merely hidden from the planner later. See `operating-window.ts`.
  assertWithinOperatingWindow({
    window: experience.activity,
    startTime: input.startTime,
    forDate: input.date,
  })

  const startsAt = localInstant(input.date, input.startTime)
  const endsAt = new Date(startsAt.getTime() + experience.durationMinutes * 60_000)

  const existing = await prisma.availabilitySlot.findUnique({
    where: { experienceId_startsAt: { experienceId: input.experienceId, startsAt } },
    select: { id: true },
  })
  if (existing) {
    throw conflict('A departure already exists at that time.')
  }

  const slot = await prisma.$transaction(async (tx) => {
    const created = await tx.availabilitySlot.create({
      data: {
        organizationId,
        experienceId: input.experienceId,
        startsAt,
        endsAt,
        capacity: input.capacity,
        booked: 0,
        held: 0,
        status: SlotStatus.OPEN,
        priceOverrideMinor: input.priceOverrideMinor ?? null,
        currency: 'MXN',
        note: input.note ?? null,
      },
      select: { id: true },
    })
    await recordAudit(
      {
        organizationId,
        actor,
        action: 'inventory.slot.created',
        entityType: 'AvailabilitySlot',
        entityId: created.id,
        metadata: { experienceId: input.experienceId, startsAt, capacity: input.capacity },
      },
      tx,
    )
    return created
  })

  return slot
}

/** Catalog listing for the owner's management table. */
export async function listCatalog(actor: ActorContext, propertyId: string) {
  await assertPropertyAccess(actor, propertyId, Role.OWNER, Role.STAFF, Role.ADMIN)

  return prisma.experience.findMany({
    where: { propertyId },
    orderBy: [{ status: 'asc' }, { category: 'asc' }, { titleEn: 'asc' }],
    select: {
      id: true,
      slug: true,
      titleEn: true,
      titleEs: true,
      summaryEn: true,
      category: true,
      status: true,
      durationMinutes: true,
      minAbility: true,
      maxAbility: true,
      defaultCapacity: true,
      verification: true,
      supplier: { select: { id: true, name: true, verification: true } },
      place: { select: { name: true } },
      activity: { select: { name: true, guideRequired: true } },
      prices: {
        where: { isActive: true },
        orderBy: [{ kind: 'asc' }, { minParty: 'asc' }],
        select: { id: true, kind: true, amountMinor: true, bookingFeeMinor: true, minParty: true, currency: true },
      },
      _count: { select: { slots: true, orderItems: true } },
    },
  })
}

export async function getExperienceForEdit(actor: ActorContext, experienceId: string) {
  const experience = await prisma.experience.findUnique({
    where: { id: experienceId },
    include: {
      prices: { where: { isActive: true }, orderBy: { validFrom: 'desc' } },
      supplier: { select: { id: true, name: true, verification: true } },
      activity: true,
      place: { select: { id: true, name: true } },
      slots: {
        where: { startsAt: { gte: new Date() } },
        orderBy: { startsAt: 'asc' },
        take: 40,
      },
    },
  })
  if (!experience) throw notFound('Experience')
  await assertPropertyAccess(actor, experience.propertyId, Role.OWNER, Role.STAFF, Role.ADMIN)
  return experience
}

/** Reference data the catalog editor needs. */
export async function getCatalogFormOptions(actor: ActorContext, propertyId: string) {
  const { organizationId } = await assertPropertyAccess(
    actor, propertyId, Role.OWNER, Role.STAFF, Role.ADMIN,
  )

  const [suppliers, activities, places] = await Promise.all([
    prisma.supplier.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, categories: true, verification: true },
    }),
    prisma.activity.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: {
        id: true, name: true, category: true, minAbility: true, maxAbility: true,
        guideRequired: true, maxSafeRisk: true, typicalDurationMinutes: true,
        earliestStart: true, latestStart: true, minAgeYears: true,
        place: { select: { id: true, name: true } },
      },
    }),
    prisma.place.findMany({
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, kind: true },
    }),
  ])

  return { suppliers, activities, places }
}

/** Amenities with no experience attached — the owner's catalog gaps. */
export async function listAmenityGaps(actor: ActorContext, propertyId: string) {
  await assertPropertyAccess(actor, propertyId, Role.OWNER, Role.STAFF, Role.ADMIN)
  return prisma.amenity.findMany({
    where: { propertyId, experienceId: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, category: true, description: true, isIncluded: true },
  })
}

export { fromDateKey }

import { prisma } from '@/lib/db'
import { invalid, notFound } from '@/lib/errors'
import { EntityStatus, VerificationStatus } from '@/lib/prisma-types'
import { fromDateKey, toDateKey, type DateKey } from '@/lib/dates'
import {
  CHECK_KEYS,
  daysUntilInsuranceExpiry,
  INSURANCE_CHECK_KEY,
  REQUIRED_CHECK_KEYS,
  VERIFICATION_CHECKS,
  verificationStanding,
  type VerificationStanding,
} from './verification'
import { assertPlatformAdmin, type ActorContext } from '@/modules/tenancy/context'
import { recordAudit } from '@/modules/workflows/audit'

/**
 * Platform administration.
 *
 * Verification is the only way a `VerificationStatus` becomes VERIFIED anywhere
 * in ARC. It is an explicit admin action with a recorded reviewer, a note and an
 * audit event — never a seed value, never a side effect of an owner adding a
 * partner, and never inferred from a partner's own claims.
 *
 * That is the whole reason this module exists: the product's credibility with a
 * hotel rests on "verified" meaning a person checked something.
 */
export interface VerificationQueue {
  suppliers: Array<{
    id: string
    name: string
    organizationName: string
    verification: VerificationStatus
    insuranceOnFile: boolean
    verifiedChecks: string[]
    /** `YYYY-MM-DD`, or null. Resolved here so no client component reads the clock. */
    insuranceExpiresOn: DateKey | null
    /** Whether the stored decision still holds today. See `./verification`. */
    standing: VerificationStanding
    daysUntilInsuranceExpiry: number | null
    claimedCertifications: string[]
    experienceCount: number
    publishedCount: number
    contactEmail: string | null
    createdAt: Date
  }>
  properties: Array<{
    id: string
    name: string
    organizationName: string
    verification: VerificationStatus
    roomCount: number
    experienceCount: number
    createdAt: Date
  }>
}

export async function getVerificationQueue(actor: ActorContext): Promise<VerificationQueue> {
  assertPlatformAdmin(actor)

  const [suppliers, properties] = await Promise.all([
    prisma.supplier.findMany({
      orderBy: [{ verification: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        verification: true,
        insuranceOnFile: true,
        verifiedChecks: true,
        insuranceExpiresOn: true,
        claimedCertifications: true,
        contactEmail: true,
        createdAt: true,
        organization: { select: { name: true } },
        experiences: { select: { status: true } },
      },
    }),
    prisma.property.findMany({
      orderBy: [{ verification: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        verification: true,
        roomCount: true,
        createdAt: true,
        organization: { select: { name: true } },
        _count: { select: { experiences: true } },
      },
    }),
  ])

  /*
   * One clock reading for the whole queue, so two rows cannot disagree about
   * what "today" is, and so nothing downstream reads it again.
   */
  const now = new Date()

  return {
    suppliers: suppliers.map((supplier) => ({
      id: supplier.id,
      name: supplier.name,
      organizationName: supplier.organization.name,
      verification: supplier.verification,
      insuranceOnFile: supplier.insuranceOnFile,
      verifiedChecks: supplier.verifiedChecks,
      insuranceExpiresOn: supplier.insuranceExpiresOn
        ? toDateKey(supplier.insuranceExpiresOn)
        : null,
      standing: verificationStanding(supplier, now),
      daysUntilInsuranceExpiry: daysUntilInsuranceExpiry(supplier, now),
      claimedCertifications: supplier.claimedCertifications,
      experienceCount: supplier.experiences.length,
      publishedCount: supplier.experiences.filter((e) => e.status === 'PUBLISHED').length,
      contactEmail: supplier.contactEmail,
      createdAt: supplier.createdAt,
    })),
    properties: properties.map((property) => ({
      id: property.id,
      name: property.name,
      organizationName: property.organization.name,
      verification: property.verification,
      roomCount: property.roomCount,
      experienceCount: property._count.experiences,
      createdAt: property.createdAt,
    })),
  }
}

/**
 * Records a supplier verification decision.
 *
 * A note is mandatory on approval: "verified" without a record of what was
 * checked is a liability, not an assurance.
 */
export async function verifySupplier(
  actor: ActorContext,
  options: {
    supplierId: string
    decision: VerificationStatus
    note: string
    /** Keys from `VERIFICATION_CHECKS`. Every required one is needed for VERIFIED. */
    checks?: readonly string[]
    /** `YYYY-MM-DD`. Required when the insurance check is recorded. */
    insuranceExpiresOn?: DateKey | null
  },
): Promise<void> {
  assertPlatformAdmin(actor)

  const supplier = await prisma.supplier.findUnique({
    where: { id: options.supplierId },
    select: { id: true, organizationId: true, verification: true, name: true },
  })
  if (!supplier) throw notFound('Partner')

  const checks = [...new Set(options.checks ?? [])]
  const unknown = checks.filter((key) => !CHECK_KEYS.includes(key))
  if (unknown.length > 0) {
    throw invalid(`Unknown verification check: ${unknown.join(', ')}.`)
  }

  if (options.decision === VerificationStatus.VERIFIED) {
    if (options.note.trim().length < 10) {
      throw invalid('Record what you actually checked before marking a partner verified.')
    }

    /*
     * The checklist, not the note, is what makes VERIFIED mean something.
     *
     * The note used to be the whole evidential basis, with a ten-character
     * minimum — so "looks fine" cleared the bar and a year later nobody could
     * tell whether the RFC had ever been seen. See
     * `src/modules/admin/verification.ts`.
     */
    const missing = REQUIRED_CHECK_KEYS.filter((key) => !checks.includes(key))
    if (missing.length > 0) {
      const labels = missing.map(
        (key) => VERIFICATION_CHECKS.find((c) => c.key === key)?.label ?? key,
      )
      throw invalid(
        `Cannot verify ${supplier.name} with checks outstanding: ${labels.join('; ')}. ` +
          'Record a rejection, or leave them unverified, rather than verifying what has not ' +
          'been checked.',
      )
    }

    /*
     * Insurance is the one piece of evidence that stops being true on a date
     * known in advance, so the date is mandatory rather than nice to have.
     * Without it the standing is permanently "lapsed", which is correct but
     * useless; better to refuse the decision than to record one that cannot
     * hold.
     */
    if (checks.includes(INSURANCE_CHECK_KEY)) {
      if (!options.insuranceExpiresOn) {
        throw invalid(
          'Record the expiry date from the insurance certificate. A policy nobody has an expiry ' +
            'for cannot be presented as in force.',
        )
      }
      if (options.insuranceExpiresOn < toDateKey(new Date())) {
        throw invalid(
          `That insurance certificate expired on ${options.insuranceExpiresOn}. Ask for a ` +
            'current one; an expired policy is not cover.',
        )
      }
    }
  }

  const verified = options.decision === VerificationStatus.VERIFIED

  await prisma.$transaction(async (tx) => {
    await tx.supplier.update({
      where: { id: supplier.id },
      data: {
        verification: options.decision,
        verifiedAt: verified ? new Date() : null,
        verifiedById: verified ? actor.userId : null,
        verificationNotes: options.note,
        verifiedChecks: checks,
        insuranceOnFile: checks.includes(INSURANCE_CHECK_KEY),
        insuranceExpiresOn:
          checks.includes(INSURANCE_CHECK_KEY) && options.insuranceExpiresOn
            ? fromDateKey(options.insuranceExpiresOn)
            : null,
        status:
          options.decision === VerificationStatus.REJECTED
            ? EntityStatus.SUSPENDED
            : EntityStatus.ACTIVE,
      },
    })

    await recordAudit(
      {
        organizationId: supplier.organizationId,
        actor,
        actorKind: 'admin',
        action: 'admin.supplier.verification',
        entityType: 'Supplier',
        entityId: supplier.id,
        metadata: {
          from: supplier.verification,
          to: options.decision,
          note: options.note,
          checks,
          insuranceExpiresOn: options.insuranceExpiresOn ?? null,
        },
      },
      tx,
    )
  })
}

export async function verifyProperty(
  actor: ActorContext,
  options: { propertyId: string; decision: VerificationStatus; note: string },
): Promise<void> {
  assertPlatformAdmin(actor)

  const property = await prisma.property.findUnique({
    where: { id: options.propertyId },
    select: { id: true, organizationId: true, verification: true },
  })
  if (!property) throw notFound('Property')

  if (options.decision === VerificationStatus.VERIFIED && options.note.trim().length < 10) {
    throw invalid('Record what you actually checked before marking a property verified.')
  }

  await prisma.$transaction(async (tx) => {
    await tx.property.update({
      where: { id: property.id },
      data: { verification: options.decision },
    })
    await recordAudit(
      {
        organizationId: property.organizationId,
        actor,
        actorKind: 'admin',
        action: 'admin.property.verification',
        entityType: 'Property',
        entityId: property.id,
        metadata: { from: property.verification, to: options.decision, note: options.note },
      },
      tx,
    )
  })
}

/** The destination graph with its provenance, for data-quality review. */
export async function getDestinationGraph(actor: ActorContext, destination = 'puerto-escondido') {
  assertPlatformAdmin(actor)

  const [places, activities, staleReports] = await Promise.all([
    prisma.place.findMany({
      where: { destination },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        slug: true,
        name: true,
        kind: true,
        typicalRisk: true,
        provenance: true,
        verification: true,
        sourceUrl: true,
        factsUpdatedAt: true,
        safetyNotesEn: true,
        _count: { select: { experiences: true, conditionReports: true, travelFrom: true } },
        parent: { select: { name: true } },
      },
    }),
    prisma.activity.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        category: true,
        minAbility: true,
        maxAbility: true,
        maxSafeRisk: true,
        guideRequired: true,
        provenance: true,
        safetyNotesEn: true,
        _count: { select: { experiences: true } },
        place: { select: { name: true } },
      },
    }),
    // Conditions are only as good as their freshness, so the admin surface
    // reports the oldest reading per place rather than an average.
    prisma.conditionReport.groupBy({
      by: ['placeId'],
      _max: { observedAt: true },
      _count: true,
    }),
  ])

  const freshnessByPlace = new Map(
    staleReports.map((row) => [row.placeId, { latest: row._max.observedAt, count: row._count }]),
  )

  return {
    places: places.map((place) => ({
      ...place,
      conditionsLatestAt: freshnessByPlace.get(place.id)?.latest ?? null,
      conditionsCount: freshnessByPlace.get(place.id)?.count ?? 0,
    })),
    activities,
  }
}

/**
 * Data-quality checks.
 *
 * Each one is a concrete, checkable claim about the data rather than a score.
 * An admin should be able to read a failure and know exactly what to fix.
 */
export interface QualityCheck {
  key: string
  label: string
  /** "ok" | "warn" | "fail" */
  level: 'ok' | 'warn' | 'fail'
  detail: string
  count: number
}

export async function runQualityChecks(actor: ActorContext): Promise<QualityCheck[]> {
  assertPlatformAdmin(actor)

  const [
    publishedWithoutPrice,
    publishedWithoutSlots,
    publishedWithUnverifiedSupplier,
    guideRequiredWithoutGuide,
    placesWithoutConditions,
    oversoldSlots,
    unbalancedOrders,
    staleConditions,
  ] = await Promise.all([
    prisma.experience.count({
      where: { status: 'PUBLISHED', prices: { none: { isActive: true } } },
    }),
    prisma.experience.count({
      where: { status: 'PUBLISHED', slots: { none: { startsAt: { gte: new Date() } } } },
    }),
    prisma.experience.count({
      where: { status: 'PUBLISHED', supplier: { verification: { not: 'VERIFIED' } } },
    }),
    prisma.experience.count({
      where: { activity: { guideRequired: true }, guideIncluded: false },
    }),
    prisma.place.count({
      where: {
        kind: { in: ['BEACH', 'SURF_BREAK', 'LAGOON'] },
        conditionReports: { none: {} },
      },
    }),
    // The invariant that would hurt a real guest: more committed than capacity.
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "AvailabilitySlot"
      WHERE "booked" + "held" > "capacity"
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "Order"
      WHERE "status" = 'CONFIRMED'
        AND "hotelEarningsMinor" + "platformEarningsMinor" + "supplierPayableMinor" <> "totalMinor"
    `,
    prisma.conditionReport.count({
      where: { observedAt: { lt: new Date(Date.now() - 36 * 3_600_000) } },
    }),
  ])

  const oversoldCount = Number(oversoldSlots[0]?.count ?? 0)
  const unbalancedCount = Number(unbalancedOrders[0]?.count ?? 0)

  return [
    {
      key: 'oversold_slots',
      label: 'No departure is oversold',
      level: oversoldCount === 0 ? 'ok' : 'fail',
      detail:
        oversoldCount === 0
          ? 'Every departure has booked + held within capacity.'
          : `${oversoldCount} departures have more committed places than capacity. This is a correctness bug in the inventory path.`,
      count: oversoldCount,
    },
    {
      key: 'ledger_balance',
      label: 'Every confirmed order’s split reconciles',
      level: unbalancedCount === 0 ? 'ok' : 'fail',
      detail:
        unbalancedCount === 0
          ? 'Hotel + ARC + supplier equals the order total on every confirmed order.'
          : `${unbalancedCount} confirmed orders do not reconcile. Money reporting cannot be trusted until this is zero.`,
      count: unbalancedCount,
    },
    {
      key: 'guide_required',
      label: 'Guide-required activities always include a guide',
      level: guideRequiredWithoutGuide === 0 ? 'ok' : 'fail',
      detail:
        guideRequiredWithoutGuide === 0
          ? 'No experience sells a guide-required activity without one.'
          : `${guideRequiredWithoutGuide} experiences sell a guide-required activity without a guide.`,
      count: guideRequiredWithoutGuide,
    },
    {
      key: 'published_without_price',
      label: 'Published experiences have a price',
      level: publishedWithoutPrice === 0 ? 'ok' : 'fail',
      detail:
        publishedWithoutPrice === 0
          ? 'Every published experience has an active price.'
          : `${publishedWithoutPrice} published experiences have no active price and cannot be bought.`,
      count: publishedWithoutPrice,
    },
    {
      key: 'published_without_slots',
      label: 'Published experiences have forward availability',
      level: publishedWithoutSlots === 0 ? 'ok' : 'warn',
      detail:
        publishedWithoutSlots === 0
          ? 'Every published experience has at least one future departure.'
          : `${publishedWithoutSlots} published experiences have no future departure, so they appear but cannot be booked.`,
      count: publishedWithoutSlots,
    },
    {
      key: 'unverified_suppliers_live',
      label: 'Published experiences come from verified partners',
      level: publishedWithUnverifiedSupplier === 0 ? 'ok' : 'warn',
      detail:
        publishedWithUnverifiedSupplier === 0
          ? 'Every live experience is from a verified partner.'
          : `${publishedWithUnverifiedSupplier} live experiences come from an unverified partner. Guests see a notice, but this must be zero before a real pilot.`,
      count: publishedWithUnverifiedSupplier,
    },
    {
      key: 'places_without_conditions',
      label: 'Water places have conditions data',
      level: placesWithoutConditions === 0 ? 'ok' : 'warn',
      detail:
        placesWithoutConditions === 0
          ? 'Every beach, break and lagoon has condition reports.'
          : `${placesWithoutConditions} water places have no conditions data, so candidates there are judged against a baseline instead.`,
      count: placesWithoutConditions,
    },
    {
      key: 'stale_conditions',
      label: 'Conditions readings are fresh',
      level: staleConditions === 0 ? 'ok' : 'warn',
      detail:
        staleConditions === 0
          ? 'No reading is older than 36 hours.'
          : `${staleConditions} readings are over 36 hours old. They are shown as stale, but a real deployment needs a live feed.`,
      count: staleConditions,
    },
  ]
}

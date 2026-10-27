import { prisma } from '@/lib/db'
import { notFound } from '@/lib/errors'
import {
  EntityStatus,
  ExperienceStatus,
  PriceKind,
  type ExperienceCategory,
} from '@/lib/prisma-types'
import { addDays, dateRange, toDateKey, type DateKey } from '@/lib/dates'
import { isCurrentlyVerified, VERIFICATION_STANDING_SELECT } from '@/modules/admin/verification'
import { getConditionsForDestination } from '@/modules/destination/conditions'
import { nightlyRateRange } from './estimate'
import { parseExperienceFilter } from './schemas'

/**
 * Read model for the public destination surface.
 *
 * Two things make this module different from every other read service in the
 * codebase, and both are deliberate.
 *
 * First, it is **not tenant-scoped**, because there is no tenant on the way in:
 * a visitor is nobody. So instead of starting from `tenancy/context.ts`, every
 * query here is pinned to the published catalogue — `ExperienceStatus.PUBLISHED`
 * and `EntityStatus.ACTIVE` — and no caller may pass an `organizationId`,
 * `propertyId` or any other identifier that would widen what is returned. The
 * destination is a constant, not a parameter from the client. Anything in a
 * draft, paused or archived state is invisible here, which is the only
 * authorisation question a public catalogue has.
 *
 * Second, it returns **no availability and no commercial claim**. There is no
 * slot lookup, no hold, no "rooms left". A published nightly rate and a
 * published per-person price are facts about a price list; they are not an offer
 * on a date. A verification claim is derived from the row through
 * `isCurrentlyVerified`, never from the stored column alone (ADR-036), so a
 * fixture supplier reaches the page as `UNVERIFIED` and a partner whose
 * certificate has expired stops reading as verified on the day it expires.
 */

/** The POC covers one destination. Not a parameter — a fact about the build. */
export const PUBLIC_DESTINATION = 'puerto-escondido'

/** The published-catalogue predicate, in one place so no query forgets it. */
const PUBLISHED_EXPERIENCE = {
  status: ExperienceStatus.PUBLISHED,
  publishedAt: { not: null },
  property: { status: EntityStatus.ACTIVE },
} as const

const EXPERIENCE_CARD_SELECT = {
  id: true,
  slug: true,
  titleEn: true,
  titleEs: true,
  summaryEn: true,
  summaryEs: true,
  category: true,
  durationMinutes: true,
  minAbility: true,
  maxAbility: true,
  minParty: true,
  maxParty: true,
  minAgeYears: true,
  guideIncluded: true,
  includesTransfer: true,
  verification: true,
  provenance: true,
  supplier: {
    select: {
      slug: true,
      name: true,
      /*
       * The three columns a standing is derived from, not `verification`
       * alone. A public card is a guest-facing verification claim, and ADR-036
       * is explicit that such a claim asks `isCurrentlyVerified` rather than
       * the stored column — which a query selecting only the column cannot do.
       */
      ...VERIFICATION_STANDING_SELECT,
      claimedCertifications: true,
      insuranceOnFile: true,
    },
  },
  activity: {
    select: {
      slug: true,
      name: true,
      conditionsSensitive: true,
      guideRequired: true,
      maxSafeRisk: true,
      minAbility: true,
      physicalIntensity: true,
    },
  },
  place: {
    select: { id: true, slug: true, name: true, kind: true, typicalRisk: true },
  },
  prices: {
    where: { isActive: true, kind: PriceKind.BASE },
    orderBy: { amountMinor: 'asc' },
    take: 1,
    select: { amountMinor: true, bookingFeeMinor: true, currency: true, minParty: true },
  },
} as const

export type ExperienceCard = Awaited<ReturnType<typeof listPublicExperiences>>['items'][number]

/**
 * The published experience catalogue, filtered.
 *
 * Text search and price ceiling are applied in the query rather than in the
 * page so the shape of the list does not depend on which component renders it.
 */
export async function listPublicExperiences(query: Record<string, string | undefined> = {}) {
  const filter = parseExperienceFilter(query)

  // The chips must offer every category the catalogue has, not only the one
  // already selected, so this deliberately ignores the filter. A chip list
  // derived from the filtered rows collapses to one chip on the first click
  // and the visitor cannot get back.
  const categoryRows = await prisma.experience.findMany({
    where: PUBLISHED_EXPERIENCE,
    distinct: ['category'],
    select: { category: true },
  })

  const rows = await prisma.experience.findMany({
    where: {
      ...PUBLISHED_EXPERIENCE,
      ...(filter.category ? { category: filter.category } : {}),
      ...(filter.maxDurationMinutes ? { durationMinutes: { lte: filter.maxDurationMinutes } } : {}),
      ...(filter.q
        ? {
            OR: [
              { titleEn: { contains: filter.q, mode: 'insensitive' as const } },
              { titleEs: { contains: filter.q, mode: 'insensitive' as const } },
              { summaryEn: { contains: filter.q, mode: 'insensitive' as const } },
              { summaryEs: { contains: filter.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ category: 'asc' }, { titleEn: 'asc' }],
    select: EXPERIENCE_CARD_SELECT,
  })

  // The price ceiling is applied here rather than in the `where` clause: an
  // experience with no active BASE price must not be silently dropped by a
  // price filter it has no price to be judged against.
  const items = rows.filter((row) => {
    if (filter.maxPriceMinor === undefined) return true
    const price = row.prices[0]
    return price ? price.amountMinor <= filter.maxPriceMinor : false
  })

  return {
    items,
    filter,
    /** Categories present in the unfiltered catalogue, for the filter chips. */
    // Sorted here rather than in the query: Postgres orders an enum by its
    // declaration order, which is not the order a reader scans a chip row in.
    categories: categoryRows.map((r) => r.category).sort() as ExperienceCategory[],
    /** How many matched everything but the price ceiling. */
    totalBeforePriceFilter: rows.length,
  }
}

/** One published experience by slug, or `notFound`. */
export async function getPublicExperience(slug: string) {
  const experience = await prisma.experience.findFirst({
    where: { slug, ...PUBLISHED_EXPERIENCE },
    select: {
      ...EXPERIENCE_CARD_SELECT,
      descriptionEn: true,
      descriptionEs: true,
      meetingPoint: true,
      whatToBringEn: true,
      whatToBringEs: true,
      cancellationPolicyHours: true,
      defaultCapacity: true,
      supplier: {
        select: {
          slug: true,
          name: true,
          description: true,
          ...VERIFICATION_STANDING_SELECT,
          claimedCertifications: true,
          insuranceOnFile: true,
        },
      },
      place: {
        select: {
          id: true,
          slug: true,
          name: true,
          kind: true,
          typicalRisk: true,
          summaryEn: true,
          summaryEs: true,
          safetyNotesEn: true,
          safetyNotesEs: true,
          factsUpdatedAt: true,
          provenance: true,
          sourceUrl: true,
        },
      },
      activity: {
        select: {
          slug: true,
          name: true,
          descriptionEn: true,
          descriptionEs: true,
          conditionsSensitive: true,
          guideRequired: true,
          maxSafeRisk: true,
          minAbility: true,
          maxAbility: true,
          physicalIntensity: true,
          safetyNotesEn: true,
          safetyNotesEs: true,
        },
      },
    },
  })

  if (!experience) throw notFound('Experience')
  return experience
}

/**
 * The destination's published property.
 *
 * The POC is one boutique hotel, so this returns the single active property
 * rather than a list. When a second one is onboarded this becomes a list and
 * the route gains a slug; until then, pretending to browse a portfolio of one
 * would be a lie about the product.
 */
export async function getPublicProperty() {
  const property = await prisma.property.findFirst({
    where: { status: EntityStatus.ACTIVE },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      slug: true,
      name: true,
      tagline: true,
      description: true,
      houseNotes: true,
      roomCount: true,
      checkInTime: true,
      checkOutTime: true,
      currency: true,
      verification: true,
      latitude: true,
      longitude: true,
      place: {
        select: {
          id: true,
          slug: true,
          name: true,
          kind: true,
          summaryEn: true,
          summaryEs: true,
          factsUpdatedAt: true,
          provenance: true,
        },
      },
      roomTypes: {
        orderBy: { baseRateMinor: 'asc' },
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          maxOccupancy: true,
          roomCount: true,
          baseRateMinor: true,
          currency: true,
        },
      },
      amenities: {
        where: { isIncluded: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, category: true, description: true },
      },
    },
  })

  if (!property) throw notFound('Property')
  return { ...property, rateRange: nightlyRateRange(property.roomTypes) }
}

/**
 * The destination's reference geography, with provenance attached.
 *
 * Places are facts about a coastline, not inventory, so everything here carries
 * `factsUpdatedAt` and its `provenance` so the page can say where it came from
 * and when it was last looked at.
 */
export async function listPublicPlaces() {
  return prisma.place.findMany({
    where: { destination: PUBLIC_DESTINATION },
    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      slug: true,
      name: true,
      kind: true,
      summaryEn: true,
      summaryEs: true,
      safetyNotesEn: true,
      safetyNotesEs: true,
      typicalRisk: true,
      provenance: true,
      verification: true,
      sourceUrl: true,
      factsUpdatedAt: true,
      parent: { select: { name: true } },
    },
  })
}

/**
 * Today's ocean readings for the destination, by place.
 *
 * Delegates to `modules/destination/conditions` rather than reading
 * `ConditionReport` directly, so the public surface gets the same staleness
 * calculation and the same vocabulary as the guest portal — including the fact
 * that a reading is reported with its timestamp and source and never as a
 * verdict about whether to enter the water.
 */
export async function getPublicConditions(today: DateKey = toDateKey(new Date())) {
  return getConditionsForDestination(PUBLIC_DESTINATION, dateRange(today, addDays(today, 2)))
}

/**
 * Everything the public home page needs, in one round of queries.
 *
 * `featuredExperiences` is the first few of the published catalogue in its
 * stable order — not a ranking, and deliberately not personalised. A public
 * page has no guest, no stated ability and no dates, so it has nothing to rank
 * honestly by and no business running the conditions gate, which needs all
 * three. Gating happens where a recommendation or a booking is actually made.
 */
export async function getDestinationOverview() {
  const [property, places, experiences, conditions] = await Promise.all([
    getPublicProperty(),
    listPublicPlaces(),
    listPublicExperiences(),
    getPublicConditions(),
  ])

  return {
    property,
    places,
    featuredExperiences: experiences.items.slice(0, 6),
    experienceCount: experiences.items.length,
    categories: experiences.categories,
    conditions,
    /**
     * True when nothing in the catalogue is verified *today*.
     *
     * The live question, not the stored column: a partner whose insurance
     * certificate expired last month is not currently verified, and a banner
     * saying some of the catalogue is verified on the strength of that is the
     * claim ADR-036 exists to prevent.
     */
    allUnverified: experiences.items.every((e) => !isCurrentlyVerified(e.supplier)),
  }
}

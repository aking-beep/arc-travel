import { prisma } from '@/lib/db'
import { localInstant, type DateKey } from '@/lib/dates'
import {
  AbilityLevel,
  CommissionBasis,
  ConditionsRisk,
  ConsentType,
  EntityStatus,
  ExperienceCategory,
  ExperienceStatus,
  Pace,
  PlaceKind,
  PriceKind,
  Provenance,
  Role,
  SlotStatus,
  StayStatus,
  TransportMode,
  VerificationStatus,
} from '@/lib/prisma-types'
import { REQUIRED_CHECK_KEYS } from '@/modules/admin/verification'

/**
 * Integration-test fixtures.
 *
 * Builds a minimal but real tenant: two organizations (so isolation can be
 * proven rather than assumed), a property, a place, an activity, a supplier, a
 * published experience with a price, and a departure.
 *
 * Deliberately not the demo seed. The seed's job is to look like a product;
 * this builds the smallest graph that exercises a rule, so a failing test points
 * at one thing.
 */
export const TABLES_IN_DELETE_ORDER = [
  'CultureSourceChange', 'CultureSourceSnapshot',
  'AnalyticsEvent', 'AuditEvent', 'Approval', 'Proposal', 'Recommendation', 'AgentRun',
  'ItineraryItem', 'Itinerary',
  // Before LedgerEntry: a PayoutLine restricts the entry it claimed, so the
  // truncate order has to release the claim first.
  'PayoutLine', 'Payout',
  'LedgerEntry', 'OrderItem', 'Order', 'CartItem', 'Cart',
  'InventoryHold', 'AvailabilitySlot', 'Price', 'Amenity', 'Experience', 'Activity',
  'IdempotencyKey', 'CommissionRule', 'SupplierAgreement', 'Supplier', 'Consent', 'Stay',
  'Guest', 'RoomType', 'Membership', 'Property', 'User', 'Organization',
  'ConditionReport', 'TravelEdge', 'Place',
  // Not tenant data, but a counter left over from one test will refuse the
  // next one's requests.
  'RateLimitCounter',
] as const

export async function resetDatabase(): Promise<void> {
  const quoted = TABLES_IN_DELETE_ORDER.map((t) => `"${t}"`).join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE;`)
}

let counter = 0
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(counter += 1)}`

export interface TenantFixture {
  organizationId: string
  propertyId: string
  ownerUserId: string
  supplierId: string
  supplierUserId: string
  guestId: string
  guestUserId: string
  stayId: string
  placeId: string
  activityId: string
  experienceId: string
  slotId: string
}

export interface TenantOptions {
  name?: string
  /** Capacity of the created departure. */
  capacity?: number
  /** Per-person price in minor units. */
  priceMinor?: number
  bookingFeeMinor?: number
  /** Local day for the departure, YYYY-MM-DD. Defaults to 10 days out. */
  departureDate?: DateKey
  departureTime?: string
  hotelCommissionBps?: number
  platformCommissionBps?: number
  guestAbility?: AbilityLevel | null
  /** Highest conditions risk the activity may run in. */
  maxSafeRisk?: ConditionsRisk
  activityMinAbility?: AbilityLevel
  guideRequired?: boolean
  /**
   * Whether ocean or weather conditions govern the activity. Defaults to true,
   * matching the schema: a new activity is gated until someone decides
   * otherwise.
   */
  conditionsSensitive?: boolean
  /** Writes a ConditionReport for the departure date. */
  conditions?: { risk: ConditionsRisk; minAbilityRequired: AbilityLevel; observedAt?: Date } | null
  placeKind?: PlaceKind
  grantPersonalization?: boolean
  cancellationPolicyHours?: number
  /** Revenue and attach-rate rules only count CHECKED_OUT and IN_HOUSE stays. */
  stayStatus?: StayStatus
}

function dateKeyDaysFromNow(days: number): DateKey {
  const d = new Date(Date.now() + days * 86_400_000)
  return d.toISOString().slice(0, 10)
}

export async function createTenant(options: TenantOptions = {}): Promise<TenantFixture> {
  const label = options.name ?? unique('tenant')
  const departureDate = options.departureDate ?? dateKeyDaysFromNow(10)
  const departureTime = options.departureTime ?? '09:00'
  const capacity = options.capacity ?? 6
  const priceMinor = options.priceMinor ?? 95_000

  const organization = await prisma.organization.create({
    data: {
      slug: unique('org'),
      name: `${label} Group`,
      status: EntityStatus.ACTIVE,
      defaultCommissionBps: 1500,
    },
  })

  const place = await prisma.place.create({
    data: {
      slug: unique('place'),
      name: `${label} Cove`,
      kind: options.placeKind ?? PlaceKind.BEACH,
      latitude: 15.8617,
      longitude: -97.0797,
      typicalRisk: ConditionsRisk.LOW,
      provenance: Provenance.SEED_FIXTURE,
      verification: VerificationStatus.UNVERIFIED,
    },
  })

  const property = await prisma.property.create({
    data: {
      organizationId: organization.id,
      slug: unique('property'),
      name: `${label} Hotel`,
      status: EntityStatus.ACTIVE,
      placeId: place.id,
      currency: 'MXN',
      roomCount: 10,
    },
  })

  const ownerUser = await prisma.user.create({
    data: { email: `${unique('owner')}@example.com`, name: 'Owner' },
  })
  await prisma.membership.create({
    data: { organizationId: organization.id, userId: ownerUser.id, role: Role.OWNER },
  })

  const supplierUser = await prisma.user.create({
    data: { email: `${unique('supplier')}@example.com`, name: 'Partner' },
  })
  const supplier = await prisma.supplier.create({
    data: {
      organizationId: organization.id,
      slug: unique('supplier'),
      name: `${label} Partner`,
      categories: [ExperienceCategory.SURF],
      contactUserId: supplierUser.id,
      status: EntityStatus.ACTIVE,
      verification: VerificationStatus.UNVERIFIED,
      placeId: place.id,
    },
  })
  await prisma.membership.create({
    data: {
      organizationId: organization.id,
      userId: supplierUser.id,
      supplierId: supplier.id,
      role: Role.SUPPLIER,
    },
  })
  await prisma.supplierAgreement.create({
    data: {
      organizationId: organization.id,
      propertyId: property.id,
      supplierId: supplier.id,
      hotelCommissionBps: options.hotelCommissionBps ?? 1500,
      platformCommissionBps: options.platformCommissionBps ?? 500,
      status: EntityStatus.ACTIVE,
    },
  })

  await prisma.commissionRule.create({
    data: {
      organizationId: organization.id,
      propertyId: property.id,
      basis: CommissionBasis.PERCENT_OF_GROSS,
      hotelShare: options.hotelCommissionBps ?? 1500,
      platformShare: options.platformCommissionBps ?? 500,
      priority: 0,
      isActive: true,
    },
  })

  const activity = await prisma.activity.create({
    data: {
      slug: unique('activity'),
      name: `${label} Lesson`,
      category: ExperienceCategory.SURF,
      placeId: place.id,
      minAbility: options.activityMinAbility ?? AbilityLevel.BEGINNER,
      maxAbility: AbilityLevel.EXPERT,
      guideRequired: options.guideRequired ?? false,
      conditionsSensitive: options.conditionsSensitive ?? true,
      maxSafeRisk: options.maxSafeRisk ?? ConditionsRisk.MODERATE,
      typicalDurationMinutes: 120,
      earliestStart: '06:00',
      latestStart: '18:00',
      physicalIntensity: 2,
      provenance: Provenance.SEED_FIXTURE,
    },
  })

  const experience = await prisma.experience.create({
    data: {
      organizationId: organization.id,
      propertyId: property.id,
      supplierId: supplier.id,
      activityId: activity.id,
      placeId: place.id,
      slug: unique('experience'),
      titleEn: `${label} Experience`,
      summaryEn: 'A test experience.',
      descriptionEn: 'A test experience, described.',
      meetingPoint: 'The test meeting point',
      category: ExperienceCategory.SURF,
      status: ExperienceStatus.PUBLISHED,
      durationMinutes: 120,
      minAbility: options.activityMinAbility ?? AbilityLevel.BEGINNER,
      maxAbility: AbilityLevel.EXPERT,
      minParty: 1,
      maxParty: capacity,
      defaultCapacity: capacity,
      guideIncluded: options.guideRequired ?? false,
      cancellationPolicyHours: options.cancellationPolicyHours ?? 24,
      publishedAt: new Date(),
    },
  })

  await prisma.price.create({
    data: {
      organizationId: organization.id,
      experienceId: experience.id,
      kind: PriceKind.BASE,
      amountMinor: priceMinor,
      bookingFeeMinor: options.bookingFeeMinor ?? 0,
      currency: 'MXN',
      minParty: 1,
      isActive: true,
      validFrom: new Date(Date.now() - 86_400_000),
    },
  })

  const slot = await prisma.availabilitySlot.create({
    data: {
      organizationId: organization.id,
      experienceId: experience.id,
      startsAt: localInstant(departureDate, departureTime),
      endsAt: new Date(localInstant(departureDate, departureTime).getTime() + 120 * 60_000),
      capacity,
      booked: 0,
      held: 0,
      status: SlotStatus.OPEN,
      currency: 'MXN',
    },
  })

  if (options.conditions) {
    await prisma.conditionReport.create({
      data: {
        placeId: place.id,
        forDate: new Date(`${departureDate}T00:00:00.000Z`),
        waveHeightMinM: 0.5,
        waveHeightMaxM: 1.2,
        risk: options.conditions.risk,
        minAbilityRequired: options.conditions.minAbilityRequired,
        guideRecommended: options.conditions.risk !== ConditionsRisk.LOW,
        provenance: Provenance.SEED_FIXTURE,
        source: 'test fixture',
        observedAt: options.conditions.observedAt ?? new Date(),
      },
    })
  }

  await prisma.travelEdge.create({
    data: {
      fromPlaceId: place.id,
      toPlaceId: place.id,
      mode: TransportMode.WALK,
      minutes: 0,
      typicalCostMinor: 0,
      currency: 'MXN',
    },
  })

  const guestUser = await prisma.user.create({
    data: { email: `${unique('guest')}@example.com`, name: 'Guest Person' },
  })
  const guest = await prisma.guest.create({
    data: {
      organizationId: organization.id,
      propertyId: property.id,
      userId: guestUser.id,
      firstName: 'Guest',
      lastName: 'Person',
      email: `${unique('guest-contact')}@example.com`,
      partySize: 2,
      surfAbility: options.guestAbility === undefined ? AbilityLevel.BEGINNER : options.guestAbility,
      pace: Pace.BALANCED,
      interests: [ExperienceCategory.SURF],
      currency: 'MXN',
      intakeCompletedAt: new Date(),
    },
  })
  await prisma.membership.create({
    data: { organizationId: organization.id, userId: guestUser.id, role: Role.GUEST },
  })

  if (options.grantPersonalization !== false) {
    await prisma.consent.createMany({
      data: [
        {
          guestId: guest.id,
          type: ConsentType.DATA_PROCESSING,
          granted: true,
          source: 'test',
          grantedAt: new Date(),
        },
        {
          guestId: guest.id,
          type: ConsentType.PERSONALIZATION,
          granted: true,
          source: 'test',
          grantedAt: new Date(),
        },
      ],
    })
  }

  const stay = await prisma.stay.create({
    data: {
      organizationId: organization.id,
      propertyId: property.id,
      guestId: guest.id,
      reference: unique('STAY').toUpperCase(),
      checkIn: new Date(`${dateKeyDaysFromNow(8)}T00:00:00.000Z`),
      checkOut: new Date(`${dateKeyDaysFromNow(14)}T00:00:00.000Z`),
      adults: 2,
      status: options.stayStatus ?? StayStatus.BOOKED,
      portalToken: unique('token').replace(/[^a-z0-9-]/g, ''),
      currency: 'MXN',
    },
  })

  return {
    organizationId: organization.id,
    propertyId: property.id,
    ownerUserId: ownerUser.id,
    supplierId: supplier.id,
    supplierUserId: supplierUser.id,
    guestId: guest.id,
    guestUserId: guestUser.id,
    stayId: stay.id,
    placeId: place.id,
    activityId: activity.id,
    experienceId: experience.id,
    slotId: slot.id,
  }
}

/**
 * Marks a supplier verified, with the evidence a real verification carries.
 *
 * Tests used to do `prisma.supplier.update({ data: { verification: 'VERIFIED' } })`,
 * which a CHECK constraint now rejects: ADR-036 made VERIFIED unreachable
 * without a recorded checklist. Two tests failed on it, which is the constraint
 * doing exactly its job — a verified row with no evidence behind it is the
 * thing it exists to prevent, and a fixture is not an exception.
 *
 * Writes directly rather than calling `verifySupplier`, because most callers
 * want a verified partner as a precondition and not a platform admin, an actor
 * context and an audit row. Tests of the verification *rules* go through the
 * service: see `tests/integration/supplier-verification.test.ts`.
 */
export async function markVerified(
  supplierId: string,
  options: { insuranceExpiresOn?: Date } = {},
): Promise<void> {
  const expires =
    options.insuranceExpiresOn ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)

  await prisma.supplier.update({
    where: { id: supplierId },
    data: {
      verification: VerificationStatus.VERIFIED,
      verifiedAt: new Date(),
      verificationNotes: 'Fixture verification. Every required check recorded.',
      verifiedChecks: [...REQUIRED_CHECK_KEYS],
      insuranceOnFile: true,
      insuranceExpiresOn: expires,
      status: EntityStatus.ACTIVE,
    },
  })
}

/** Loads an actor context the way modules/auth would, without the cookie. */
export async function actorFor(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      isPlatformAdmin: true,
      memberships: {
        select: { id: true, organizationId: true, role: true, propertyId: true, supplierId: true },
      },
    },
  })
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    isPlatformAdmin: user.isPlatformAdmin,
    memberships: user.memberships,
  }
}

export const slotState = (slotId: string) =>
  prisma.availabilitySlot.findUniqueOrThrow({
    where: { id: slotId },
    select: { capacity: true, booked: true, held: true, status: true },
  })

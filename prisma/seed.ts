/**
 * ARC Stay seed.
 *
 * Produces the complete synthetic Casa Olas demo: one organization, one
 * property, twenty rooms, six fictional suppliers, ten published experiences,
 * twenty guest profiles, fifty historical stays with simulated orders, two
 * weeks of forward availability and seven days of ocean conditions.
 *
 * Properties of this script that matter:
 *   * Deterministic. A fixed PRNG seed means two runs produce identical data,
 *     so Playwright specs and demo screenshots stay valid.
 *   * Idempotent. It truncates the tenant tables first, so `npm run db:seed`
 *     can be re-run at any time.
 *   * Honest. Nothing is written as verified, every money figure is demo data,
 *     and no fixture claims a real commercial relationship.
 *
 * Run with: npm run db:seed
 */
import 'dotenv/config'
import { applyDatabaseUrl } from '../src/lib/database-url'

applyDatabaseUrl()
import {
  AbilityLevel,
  CommissionBasis,
  ConditionsRisk,
  ConsentType,
  EntityStatus,
  ExperienceCategory,
  ExperienceStatus,
  Locale,
  OrderItemStatus,
  OrderStatus,
  Pace,
  PlaceKind,
  PriceKind,
  Provenance,
  ProposalKind,
  ProposalStatus,
  Role,
  SlotStatus,
  StayStatus,
  TransportMode,
  VerificationStatus,
} from '@prisma/client'
import { ACTIVITIES, EXPERIENCES, SUPPLIERS } from './seed/catalog'
import { generateConditions } from './seed/conditions'
import { PLACES, TRAVEL_EDGES } from './seed/destination'
import { AMENITIES, GUESTS, ROOM_TYPES, STAFF } from './seed/people'
import { createRng, seededReference, seededToken, type Rng } from './seed/rng'
import {
  DEMO_PORTAL_COUNT,
  demoPortalToken,
  seededPortalToken,
} from '../src/lib/demo-portals'
import { addDays, dateRange, fromDateKey, localInstant, toDateKey, type DateKey } from '../src/lib/dates'
import { money } from '../src/lib/money'
import { resolveCommission, splitEarnings, type CommissionRuleInput } from '../src/modules/commerce/commission'
import { checkTravelAdviceSource } from '../src/modules/culture-context/snapshots'
import { FixtureTravelAdviceProvider } from '../src/modules/integrations/defaults'
/*
 * The application's client, not a second one of this script's own.
 *
 * There used to be a `new PrismaClient()` here as well as this import, which
 * meant two pools and two connections for one script. Prisma 7 turned that from
 * untidy into broken: a client needs a driver adapter now, and the one place
 * that knows how to build it — including the prefixed-`*_DATABASE_URL` fallback
 * a managed host writes — is `src/lib/db.ts`. One client, one place that
 * resolves the URL. See ADR-034.
 */
import { prisma } from '../src/lib/db'

const SEED = 20_251_020
const ORG_SLUG = 'casa-olas-group'
const PROPERTY_SLUG = 'casa-olas'
const CURRENCY = 'MXN'

/** "Today" for the fixtures. Derived from the real clock so the demo never
 *  shows a stale week, but every offset from it is deterministic. */
const TODAY: DateKey = toDateKey(new Date())

/** Forward availability window and backward history window, in days. */
const AVAILABILITY_DAYS = 21
const CONDITION_DAYS = 7
const HISTORY_DAYS = 180

async function truncateAll(): Promise<void> {
  // Ordered child-to-parent. `TRUNCATE ... CASCADE` in one statement is faster
  // and avoids any ordering mistake surviving a schema change.
  const tables = [
    'CultureSourceChange', 'CultureSourceSnapshot',
    'AnalyticsEvent', 'AuditEvent', 'Approval', 'Proposal', 'Recommendation', 'AgentRun',
    'ItineraryItem', 'Itinerary', 'LedgerEntry', 'OrderItem', 'Order', 'CartItem', 'Cart',
    'InventoryHold', 'AvailabilitySlot', 'Price', 'Amenity', 'Experience', 'Activity',
    'IdempotencyKey', 'CommissionRule', 'SupplierAgreement', 'Supplier', 'Consent', 'Stay',
    'Guest', 'RoomType', 'Membership', 'Property', 'User', 'Organization',
    'ConditionReport', 'TravelEdge', 'Place',
  ]
  const quoted = tables.map((t) => `"${t}"`).join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE;`)
}

async function seedDestination(rng: Rng) {
  const placeIdBySlug = new Map<string, string>()

  // Two passes so a child can reference a parent regardless of array order.
  for (const place of PLACES) {
    const created = await prisma.place.create({
      data: {
        slug: place.slug,
        name: place.name,
        kind: place.kind as PlaceKind,
        latitude: place.latitude,
        longitude: place.longitude,
        summaryEn: place.summaryEn,
        summaryEs: place.summaryEs,
        typicalRisk: place.typicalRisk as ConditionsRisk,
        safetyNotesEn: place.safetyNotesEn ?? null,
        safetyNotesEs: place.safetyNotesEs ?? null,
        provenance: Provenance.SEED_FIXTURE,
        verification: VerificationStatus.UNVERIFIED,
        factsUpdatedAt: fromDateKey(TODAY),
      },
    })
    placeIdBySlug.set(place.slug, created.id)
  }

  for (const place of PLACES) {
    if (!place.parentSlug) continue
    const id = placeIdBySlug.get(place.slug)
    const parentId = placeIdBySlug.get(place.parentSlug)
    if (!id || !parentId) continue
    await prisma.place.update({ where: { id }, data: { parentId } })
  }

  // Travel edges are declared one way and mirrored, because a 9-minute walk
  // down to the cove is a 9-minute walk back up as far as planning is concerned.
  const edgeRows = TRAVEL_EDGES.flatMap((edge) => {
    const fromId = placeIdBySlug.get(edge.from)
    const toId = placeIdBySlug.get(edge.to)
    if (!fromId || !toId) return []
    const base = {
      mode: edge.mode as TransportMode,
      minutes: edge.minutes,
      distanceKm: edge.distanceKm,
      typicalCostMinor: edge.costMinor,
      currency: CURRENCY,
      provenance: Provenance.SEED_FIXTURE,
      observedAt: fromDateKey(TODAY),
    }
    return [
      { ...base, fromPlaceId: fromId, toPlaceId: toId },
      { ...base, fromPlaceId: toId, toPlaceId: fromId },
    ]
  })
  await prisma.travelEdge.createMany({ data: edgeRows, skipDuplicates: true })

  const oceanSlugs = PLACES.filter((p) => p.oceanConditions).map((p) => p.slug)
  const conditionDates = dateRange(TODAY, addDays(TODAY, CONDITION_DAYS - 1))
  const generated = generateConditions(rng, oceanSlugs, conditionDates)

  await prisma.conditionReport.createMany({
    data: generated.flatMap((c) => {
      const placeId = placeIdBySlug.get(c.placeSlug)
      if (!placeId) return []
      return [{
        placeId,
        forDate: fromDateKey(c.forDate),
        waveHeightMinM: c.waveHeightMinM,
        waveHeightMaxM: c.waveHeightMaxM,
        swellPeriodS: c.swellPeriodS,
        windKph: c.windKph,
        windDirection: c.windDirection,
        waterTempC: c.waterTempC,
        airTempC: c.airTempC,
        currentNotesEn: c.currentNotesEn,
        currentNotesEs: c.currentNotesEs,
        highTideLocal: c.highTideLocal,
        lowTideLocal: c.lowTideLocal,
        risk: c.risk as ConditionsRisk,
        minAbilityRequired: c.minAbilityRequired as AbilityLevel,
        guideRecommended: c.guideRecommended,
        provenance: Provenance.SEED_FIXTURE,
        source: 'ARC demo fixture',
        // Readings are a few hours old, which is what the UI will display.
        observedAt: localInstant(c.forDate, '05:30'),
      }]
    }),
    skipDuplicates: true,
  })

  const activityIdBySlug = new Map<string, string>()
  for (const activity of ACTIVITIES) {
    const created = await prisma.activity.create({
      data: {
        slug: activity.slug,
        name: activity.name,
        category: activity.category as ExperienceCategory,
        placeId: placeIdBySlug.get(activity.placeSlug) ?? null,
        descriptionEn: activity.descriptionEn,
        descriptionEs: activity.descriptionEs,
        minAbility: activity.minAbility as AbilityLevel,
        maxAbility: activity.maxAbility as AbilityLevel,
        guideRequired: activity.guideRequired,
        conditionsSensitive: activity.conditionsSensitive ?? true,
        maxSafeRisk: activity.maxSafeRisk as ConditionsRisk,
        minAgeYears: activity.minAgeYears ?? null,
        typicalDurationMinutes: activity.durationMinutes,
        seasonMonths: activity.seasonMonths ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        earliestStart: activity.earliestStart,
        latestStart: activity.latestStart,
        physicalIntensity: activity.physicalIntensity,
        safetyNotesEn: activity.safetyNotesEn ?? null,
        safetyNotesEs: activity.safetyNotesEs ?? null,
        provenance: Provenance.SEED_FIXTURE,
      },
    })
    activityIdBySlug.set(activity.slug, created.id)
  }

  return { placeIdBySlug, activityIdBySlug }
}

async function seedTenant(placeIdBySlug: Map<string, string>) {
  const organization = await prisma.organization.create({
    data: {
      slug: ORG_SLUG,
      name: 'Casa Olas Group',
      legalName: 'Casa Olas Hospitalidad S. de R.L. de C.V. (fictional)',
      countryCode: 'MX',
      status: EntityStatus.ACTIVE,
      defaultCommissionBps: 1500,
    },
  })

  const property = await prisma.property.create({
    data: {
      organizationId: organization.id,
      slug: PROPERTY_SLUG,
      name: 'Casa Olas',
      tagline: 'Twenty rooms above the western coves',
      description:
        'A fictional twenty-room boutique hotel on the hillside in La Rinconada, five minutes above Playa Carrizalillo. Built around a courtyard, a plunge pool and a roof terrace that catches the sunset. Used here as the demo property for ARC Stay.',
      houseNotes:
        'Breakfast on the patio 07:30–10:30. Board storage and rinse by the side gate — ask Tomás for the code. The Carrizalillo stairway is roughly 160 steps; the taxi turnaround at the top is the pickup point for everything at the cove.',
      roomCount: ROOM_TYPES.reduce((n, r) => n + r.roomCount, 0),
      checkInTime: '15:00',
      checkOutTime: '11:00',
      timezone: 'America/Mexico_City',
      currency: CURRENCY,
      defaultLocale: Locale.EN,
      brandPrimary: '#1F3A34',
      brandAccent: '#C97B4A',
      status: EntityStatus.ACTIVE,
      /*
       * UNVERIFIED, like every seeded supplier.
       *
       * This was `VERIFIED`, and it was the only thing anywhere in the product
       * claiming a verification nobody performed. `/admin` says in as many
       * words that "Nothing is verified by a seed", and non-negotiable 2 says
       * `/admin` is the only route to a verified status — while the public home
       * page printed a shield and "Verified by ARC" beside Casa Olas to any
       * stranger, because `discovery/live.ts` passes this column into the card.
       *
       * A demo hotel is a fixture exactly as the six partners are. Verifying
       * it means an admin recording what they checked, through the page the
       * product insists on.
       */
      verification: VerificationStatus.UNVERIFIED,
      onboardingStep: 5,
      placeId: placeIdBySlug.get('la-rinconada') ?? null,
      latitude: 15.8655,
      longitude: -97.0825,
      contactEmail: 'hola@casaolas.demo',
      contactPhone: '+52 954 000 0000',
    },
  })

  const staffUsers = new Map<string, string>()
  for (const person of STAFF) {
    const user = await prisma.user.create({
      data: {
        email: person.email,
        name: person.name,
        phone: person.phone ?? null,
        locale: person.locale as Locale,
        isPlatformAdmin: person.role === 'ADMIN',
      },
    })
    staffUsers.set(person.email, user.id)

    if (person.role === 'ADMIN') continue
    await prisma.membership.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        // Owners act across the organization; staff are pinned to one property.
        propertyId: person.role === 'STAFF' ? property.id : null,
        role: person.role as Role,
      },
    })
  }

  const roomTypeIds = new Map<string, string>()
  for (const rt of ROOM_TYPES) {
    const created = await prisma.roomType.create({
      data: {
        organizationId: organization.id,
        propertyId: property.id,
        code: rt.code,
        name: rt.name,
        description: rt.description,
        maxOccupancy: rt.maxOccupancy,
        roomCount: rt.roomCount,
        baseRateMinor: rt.baseRateMinor,
        currency: CURRENCY,
      },
    })
    roomTypeIds.set(rt.code, created.id)
  }

  return { organization, property, staffUsers, roomTypeIds }
}

async function seedSuppliers(organizationId: string, propertyId: string, placeIdBySlug: Map<string, string>) {
  const supplierIds = new Map<string, string>()

  for (const fixture of SUPPLIERS) {
    const contact = await prisma.user.create({
      data: {
        email: fixture.contactEmail,
        name: fixture.contactName,
        phone: fixture.contactPhone,
        locale: Locale.ES,
      },
    })

    const supplier = await prisma.supplier.create({
      data: {
        organizationId,
        slug: fixture.slug,
        name: fixture.name,
        legalName: fixture.legalName,
        description: fixture.description,
        categories: fixture.categories as ExperienceCategory[],
        contactUserId: contact.id,
        contactEmail: fixture.contactEmail,
        contactPhone: fixture.contactPhone,
        placeId: placeIdBySlug.get(fixture.placeSlug) ?? null,
        // Fixture suppliers are explicitly NOT verified. Verification is an
        // admin action with an audit trail, never a seed value.
        status: EntityStatus.ACTIVE,
        verification: VerificationStatus.UNVERIFIED,
        claimedCertifications: fixture.claimedCertifications,
        /*
         * The claim, not the check.
         *
         * `insuranceOnFile` means ARC has seen a certificate, and nobody has:
         * these are fictional, unverified partners. Writing what they say into
         * the claim columns keeps the demo honest and keeps the row on the
         * right side of `supplier_insurance_on_file_is_checked` (ADR-041).
         */
        insuranceOnFile: false,
        claimedInsurer: fixture.claimsInsurance ? 'Seguros del Pacífico (fictional)' : null,
        claimedInsuranceExpiresOn: fixture.claimsInsurance
          ? fromDateKey(toDateKey(new Date(Date.now() + 280 * 86_400_000)))
          : null,
        payoutsEnabled: false,
      },
    })
    supplierIds.set(fixture.slug, supplier.id)

    await prisma.membership.create({
      data: {
        organizationId,
        userId: contact.id,
        supplierId: supplier.id,
        role: Role.SUPPLIER,
      },
    })

    await prisma.supplierAgreement.create({
      data: {
        organizationId,
        propertyId,
        supplierId: supplier.id,
        hotelCommissionBps: fixture.hotelCommissionBps,
        platformCommissionBps: fixture.platformCommissionBps,
        cancellationWindowHours: 24,
        requiresManualConfirmation: true,
        status: EntityStatus.ACTIVE,
        signedAt: fromDateKey(addDays(TODAY, -120)),
        notes: 'Demo agreement. Not a real commercial relationship.',
      },
    })
  }

  return supplierIds
}

async function seedCatalog(
  organizationId: string,
  propertyId: string,
  supplierIds: Map<string, string>,
  activityIdBySlug: Map<string, string>,
  placeIdBySlug: Map<string, string>,
) {
  const experienceIds = new Map<string, string>()

  for (const fixture of EXPERIENCES) {
    const supplierId = supplierIds.get(fixture.supplierSlug)
    const activityId = activityIdBySlug.get(fixture.activitySlug)
    if (!supplierId || !activityId) {
      throw new Error(`Experience ${fixture.slug} references a missing supplier or activity.`)
    }
    const activity = ACTIVITIES.find((a) => a.slug === fixture.activitySlug)
    if (!activity) throw new Error(`Missing activity fixture ${fixture.activitySlug}`)

    const experience = await prisma.experience.create({
      data: {
        organizationId,
        propertyId,
        supplierId,
        activityId,
        placeId: placeIdBySlug.get(fixture.placeSlug) ?? null,
        slug: fixture.slug,
        titleEn: fixture.titleEn,
        titleEs: fixture.titleEs,
        summaryEn: fixture.summaryEn,
        summaryEs: fixture.summaryEs,
        descriptionEn: fixture.descriptionEn,
        descriptionEs: fixture.descriptionEs,
        category: activity.category as ExperienceCategory,
        status: fixture.status as ExperienceStatus,
        durationMinutes: fixture.durationMinutes,
        // Suitability is inherited from the activity so one safety rule governs
        // every supplier's version of the same thing.
        minAbility: activity.minAbility as AbilityLevel,
        maxAbility: activity.maxAbility as AbilityLevel,
        minParty: fixture.minParty,
        maxParty: fixture.maxParty,
        minAgeYears: activity.minAgeYears ?? null,
        defaultCapacity: fixture.defaultCapacity,
        includesTransfer: fixture.includesTransfer,
        guideIncluded: activity.guideRequired,
        meetingPoint: fixture.meetingPoint,
        whatToBringEn: fixture.whatToBringEn,
        whatToBringEs: fixture.whatToBringEs,
        cancellationPolicyHours: 24,
        imageUrl: null,
        imageCredit: null,
        verification: VerificationStatus.UNVERIFIED,
        provenance: Provenance.PARTNER_SUBMITTED,
        publishedAt: fixture.status === 'PUBLISHED' ? fromDateKey(addDays(TODAY, -90)) : null,
      },
    })
    experienceIds.set(fixture.slug, experience.id)

    await prisma.price.create({
      data: {
        organizationId,
        experienceId: experience.id,
        kind: PriceKind.BASE,
        amountMinor: fixture.priceMinor,
        bookingFeeMinor: fixture.bookingFeeMinor,
        currency: CURRENCY,
        minParty: 1,
        validFrom: fromDateKey(addDays(TODAY, -90)),
        isActive: true,
        note: 'Demo base price.',
      },
    })

    // Group tier on the larger experiences, so the price selector has something
    // real to choose between in tests and demos.
    if (fixture.maxParty >= 6) {
      await prisma.price.create({
        data: {
          organizationId,
          experienceId: experience.id,
          kind: PriceKind.GROUP,
          amountMinor: Math.round(fixture.priceMinor * 0.88),
          bookingFeeMinor: fixture.bookingFeeMinor,
          currency: CURRENCY,
          minParty: 4,
          validFrom: fromDateKey(addDays(TODAY, -90)),
          isActive: true,
          note: 'Demo group rate, four or more people.',
        },
      })
    }
  }

  for (const amenity of AMENITIES) {
    const linkedId = amenity.productisedAs ? experienceIds.get(amenity.productisedAs) ?? null : null
    await prisma.amenity.create({
      data: {
        organizationId,
        propertyId,
        name: amenity.name,
        category: amenity.category as ExperienceCategory,
        description: amenity.description,
        isIncluded: amenity.isIncluded,
        experienceId: linkedId,
      },
    })
  }

  return experienceIds
}

async function seedCommissionRules(
  organizationId: string,
  propertyId: string,
  experienceIds: Map<string, string>,
) {
  // Property-wide default, one category override and one experience override:
  // enough to exercise every branch of resolveCommission().
  await prisma.commissionRule.create({
    data: {
      organizationId,
      propertyId,
      basis: CommissionBasis.PERCENT_OF_GROSS,
      hotelShare: 1500,
      platformShare: 500,
      priority: 0,
      isActive: true,
      note: 'Casa Olas standard split: 15% hotel, 5% ARC.',
    },
  })

  await prisma.commissionRule.create({
    data: {
      organizationId,
      propertyId,
      category: ExperienceCategory.TRANSPORT,
      basis: CommissionBasis.PERCENT_OF_GROSS,
      hotelShare: 1000,
      platformShare: 500,
      priority: 10,
      isActive: true,
      note: 'Transport runs on thinner margin.',
    },
  })

  const yogaId = experienceIds.get('casa-olas-sunrise-yoga')
  if (yogaId) {
    await prisma.commissionRule.create({
      data: {
        organizationId,
        propertyId,
        experienceId: yogaId,
        basis: CommissionBasis.PERCENT_OF_GROSS,
        hotelShare: 3000,
        platformShare: 500,
        priority: 20,
        isActive: true,
        note: 'Runs on hotel premises using the hotel roof, so the hotel takes more.',
      },
    })
  }

  return prisma.commissionRule.findMany({ where: { organizationId } })
}

async function seedAvailability(
  organizationId: string,
  experienceIds: Map<string, string>,
  rng: Rng,
) {
  const rows: Array<{
    organizationId: string
    experienceId: string
    startsAt: Date
    endsAt: Date
    capacity: number
    booked: number
    status: SlotStatus
    currency: string
  }> = []

  const days = dateRange(TODAY, addDays(TODAY, AVAILABILITY_DAYS - 1))

  for (const fixture of EXPERIENCES) {
    const experienceId = experienceIds.get(fixture.slug)
    if (!experienceId || fixture.status !== 'PUBLISHED') continue

    for (const day of days) {
      // The yoga class runs four mornings a week, not daily — a real operator's
      // schedule has holes in it, and the briefing should be able to spot them.
      if (fixture.slug === 'casa-olas-sunrise-yoga') {
        const dow = fromDateKey(day).getUTCDay()
        if (![1, 3, 5, 6].includes(dow)) continue
      }
      // The advanced Zicatela session is dawn-only and not offered every day.
      if (fixture.slug === 'zicatela-guided-advanced-session' && rng.bool(0.35)) continue

      for (const startTime of fixture.startTimes) {
        const startsAt = localInstant(day, startTime)
        const endsAt = new Date(startsAt.getTime() + fixture.durationMinutes * 60_000)
        const capacity = fixture.defaultCapacity

        // Pre-existing bookings, heavier in the next few days than later on.
        const daysOut = dateRange(TODAY, day).length - 1
        const fillBias = daysOut <= 3 ? 0.55 : daysOut <= 7 ? 0.35 : 0.15
        const booked = rng.bool(fillBias) ? rng.int(1, Math.max(1, capacity - 1)) : 0

        rows.push({
          organizationId,
          experienceId,
          startsAt,
          endsAt,
          capacity,
          booked,
          status: booked >= capacity ? SlotStatus.FULL : SlotStatus.OPEN,
          currency: CURRENCY,
        })
      }
    }
  }

  await prisma.availabilitySlot.createMany({ data: rows, skipDuplicates: true })
  return rows.length
}

async function seedGuestsAndStays(
  organizationId: string,
  propertyId: string,
  roomTypeIds: Map<string, string>,
  rng: Rng,
) {
  const guestIds: string[] = []
  const roomTypeCodes = [...roomTypeIds.keys()]

  for (const fixture of GUESTS) {
    const user = await prisma.user.create({
      data: {
        email: fixture.email,
        name: `${fixture.firstName} ${fixture.lastName}`,
        phone: fixture.phone,
        locale: fixture.locale as Locale,
      },
    })

    const guest = await prisma.guest.create({
      data: {
        organizationId,
        propertyId,
        userId: user.id,
        firstName: fixture.firstName,
        lastName: fixture.lastName,
        email: fixture.email,
        phone: fixture.phone,
        locale: fixture.locale as Locale,
        countryCode: fixture.countryCode,
        partySize: fixture.partySize,
        surfAbility: (fixture.surfAbility as AbilityLevel | null) ?? null,
        pace: (fixture.pace as Pace | null) ?? null,
        budgetPerDayMinor: fixture.budgetPerDayMinor,
        currency: CURRENCY,
        interests: fixture.interests as ExperienceCategory[],
        dietaryNotes: fixture.dietaryNotes ?? null,
        mobilityNotes: fixture.mobilityNotes ?? null,
        preferredTransport: fixture.preferredTransport as TransportMode[],
        intakeCompletedAt: fixture.intakeCompleted ? fromDateKey(addDays(TODAY, -2)) : null,
      },
    })
    guestIds.push(guest.id)

    await prisma.membership.create({
      data: { organizationId, userId: user.id, role: Role.GUEST },
    })

    // Consent is only recorded where the guest actually completed intake.
    // The four who have not are left with no consent rows at all, which is what
    // gates personalization for them.
    if (fixture.intakeCompleted) {
      await prisma.consent.createMany({
        data: [
          {
            guestId: guest.id,
            type: ConsentType.DATA_PROCESSING,
            granted: true,
            source: 'guest-portal-intake',
            grantedAt: fromDateKey(addDays(TODAY, -2)),
          },
          {
            guestId: guest.id,
            type: ConsentType.PERSONALIZATION,
            granted: true,
            source: 'guest-portal-intake',
            grantedAt: fromDateKey(addDays(TODAY, -2)),
          },
          {
            guestId: guest.id,
            type: ConsentType.MARKETING_EMAIL,
            granted: rng.bool(0.4),
            source: 'guest-portal-intake',
            grantedAt: fromDateKey(addDays(TODAY, -2)),
          },
        ],
      })
    }
  }

  const stays: Array<{ id: string; guestId: string; checkIn: DateKey; checkOut: DateKey; status: StayStatus }> = []

  // --- Fifty historical stays, spread back over six months -------------------
  for (let i = 0; i < 50; i += 1) {
    const guestId = guestIds[rng.int(0, guestIds.length - 1)]
    if (!guestId) continue
    const nights = rng.int(3, 10)
    const checkIn = addDays(TODAY, -rng.int(nights + 2, HISTORY_DAYS))
    const checkOut = addDays(checkIn, nights)
    const code = roomTypeCodes[rng.int(0, roomTypeCodes.length - 1)] ?? 'JARDIN'
    const roomType = ROOM_TYPES.find((r) => r.code === code)

    const stay = await prisma.stay.create({
      data: {
        organizationId,
        propertyId,
        guestId,
        roomTypeId: roomTypeIds.get(code) ?? null,
        reference: `${seededReference(rng, 'STAY')}-${String(i).padStart(2, '0')}`,
        checkIn: fromDateKey(checkIn),
        checkOut: fromDateKey(checkOut),
        adults: rng.int(1, 2),
        children: rng.bool(0.2) ? rng.int(1, 2) : 0,
        status: rng.bool(0.04) ? StayStatus.CANCELLED : StayStatus.CHECKED_OUT,
        roomRevenueMinor: (roomType?.baseRateMinor ?? 300000) * nights,
        currency: CURRENCY,
        portalToken: seededPortalToken(`history-${String(i)}`),
      },
    })
    stays.push({ id: stay.id, guestId, checkIn, checkOut, status: stay.status })
  }

  // --- Current and upcoming reservations -------------------------------------
  // Deliberately shaped so the owner's morning briefing has real work in it:
  // guests in-house now, arrivals today and tomorrow, and four guests who have
  // not completed intake.
  const upcoming: Array<{ guestIndex: number; offsetIn: number; nights: number; status: StayStatus }> = [
    { guestIndex: 0, offsetIn: -2, nights: 7, status: StayStatus.IN_HOUSE },
    { guestIndex: 1, offsetIn: -1, nights: 5, status: StayStatus.IN_HOUSE },
    { guestIndex: 2, offsetIn: -3, nights: 9, status: StayStatus.IN_HOUSE },
    { guestIndex: 4, offsetIn: -1, nights: 4, status: StayStatus.IN_HOUSE },
    { guestIndex: 13, offsetIn: 0, nights: 6, status: StayStatus.BOOKED },
    { guestIndex: 14, offsetIn: 0, nights: 3, status: StayStatus.BOOKED },
    { guestIndex: 5, offsetIn: 1, nights: 8, status: StayStatus.BOOKED },
    { guestIndex: 18, offsetIn: 1, nights: 5, status: StayStatus.BOOKED },
    { guestIndex: 7, offsetIn: 3, nights: 6, status: StayStatus.BOOKED },
    { guestIndex: 8, offsetIn: 4, nights: 4, status: StayStatus.BOOKED },
    { guestIndex: 19, offsetIn: 5, nights: 7, status: StayStatus.BOOKED },
    { guestIndex: 16, offsetIn: 6, nights: 5, status: StayStatus.BOOKED },
  ]

  for (const [i, plan] of upcoming.entries()) {
    const guestId = guestIds[plan.guestIndex]
    if (!guestId) continue
    const checkIn = addDays(TODAY, plan.offsetIn)
    const checkOut = addDays(checkIn, plan.nights)
    const fixture = GUESTS[plan.guestIndex]
    const code = (fixture?.partySize ?? 2) >= 4 ? 'FAMILIA' : roomTypeCodes[i % roomTypeCodes.length] ?? 'JARDIN'
    const roomType = ROOM_TYPES.find((r) => r.code === code)

    const stay = await prisma.stay.create({
      data: {
        organizationId,
        propertyId,
        guestId,
        roomTypeId: roomTypeIds.get(code) ?? null,
        reference: `STAY-NOW-${String(i + 1).padStart(2, '0')}`,
        checkIn: fromDateKey(checkIn),
        checkOut: fromDateKey(checkOut),
        adults: Math.min(fixture?.partySize ?? 2, 2),
        children: (fixture?.partySize ?? 2) > 2 ? (fixture?.partySize ?? 2) - 2 : 0,
        status: plan.status,
        roomRevenueMinor: (roomType?.baseRateMinor ?? 300000) * plan.nights,
        currency: CURRENCY,
        /*
         * Stable tokens so demo QR links do not move between seeds — but
         * derived from ARC_SEED_TOKEN_SECRET, not written here. These used to
         * be the literals `demo-portal-01`..`06`, which meant anyone who had
         * read this file could open a hosted demo's guest portals and act as
         * those guests. See src/lib/demo-portals.ts.
         */
        portalToken:
          i < DEMO_PORTAL_COUNT
            ? demoPortalToken(i + 1)
            : seededPortalToken(`current-${String(i)}`),
        arrivalNotes:
          plan.offsetIn === 0 ? 'Arriving today. No transport booked yet.' : null,
      },
    })
    stays.push({ id: stay.id, guestId, checkIn, checkOut, status: plan.status })
  }

  return { guestIds, stays }
}

async function seedHistoricalOrders(
  organizationId: string,
  propertyId: string,
  experienceIds: Map<string, string>,
  commissionRules: CommissionRuleInput[],
  stays: Array<{ id: string; guestId: string; checkIn: DateKey; checkOut: DateKey; status: StayStatus }>,
  rng: Rng,
) {
  const historical = stays.filter((s) => s.status === StayStatus.CHECKED_OUT)
  const experiences = await prisma.experience.findMany({
    where: { organizationId, status: ExperienceStatus.PUBLISHED },
    select: {
      id: true, slug: true, category: true, supplierId: true, durationMinutes: true,
      defaultCapacity: true, prices: { where: { isActive: true, kind: PriceKind.BASE }, select: { amountMinor: true, bookingFeeMinor: true } },
    },
  })

  let orderCount = 0
  let itemCount = 0

  // Roughly two thirds of past stays bought something. That attach rate is the
  // single number the pilot is designed to measure, so the demo should not show
  // a fantasy 100%.
  for (const stay of historical) {
    if (!rng.bool(0.66)) continue

    const picks = rng.sample(experiences, rng.int(1, 3))
    if (picks.length === 0) continue

    // Historical slots sit in the past, outside the forward availability window,
    // so they are created here rather than reused.
    const lines: Array<{
      experienceId: string
      supplierId: string
      slotId: string
      quantity: number
      unitPriceMinor: number
      bookingFeeMinor: number
      lineTotalMinor: number
      category: ExperienceCategory
    }> = []

    for (const [index, pick] of picks.entries()) {
      const price = pick.prices[0]
      if (!price) continue
      const dayOffset = rng.int(0, Math.max(0, dateRange(stay.checkIn, stay.checkOut).length - 2))
      const day = addDays(stay.checkIn, dayOffset)
      const startsAt = localInstant(day, ['07:30', '09:30', '16:00', '19:30'][index % 4] ?? '09:30')

      const slot = await prisma.availabilitySlot.upsert({
        where: { experienceId_startsAt: { experienceId: pick.id, startsAt } },
        update: {},
        create: {
          organizationId,
          experienceId: pick.id,
          startsAt,
          endsAt: new Date(startsAt.getTime() + pick.durationMinutes * 60_000),
          capacity: pick.defaultCapacity,
          booked: 0,
          status: SlotStatus.CLOSED,
          currency: CURRENCY,
          note: 'Historical departure, retained for reporting.',
        },
      })

      const quantity = rng.int(1, 2)
      const lineTotal = price.amountMinor * quantity + price.bookingFeeMinor
      lines.push({
        experienceId: pick.id,
        supplierId: pick.supplierId,
        slotId: slot.id,
        quantity,
        unitPriceMinor: price.amountMinor,
        bookingFeeMinor: price.bookingFeeMinor,
        lineTotalMinor: lineTotal,
        category: pick.category,
      })

      await prisma.availabilitySlot.update({
        where: { id: slot.id },
        data: { booked: { increment: quantity } },
      })
    }

    if (lines.length === 0) continue

    const subtotal = lines.reduce((n, l) => n + l.unitPriceMinor * l.quantity, 0)
    const fees = lines.reduce((n, l) => n + l.bookingFeeMinor, 0)
    const confirmedAt = localInstant(addDays(stay.checkIn, -1), '14:00')

    // Earnings use the same resolver the live checkout uses — one source of
    // truth for money, so analytics and the ledger cannot drift apart.
    const splits = lines.map((line) => {
      const commission = resolveCommission(commissionRules, {
        propertyId,
        experienceId: line.experienceId,
        category: line.category,
      }, { hotelBps: 1500, platformBps: 500 })
      return splitEarnings(money(line.lineTotalMinor, CURRENCY), commission, line.quantity)
    })

    const refunded = rng.bool(0.08)

    const order = await prisma.order.create({
      data: {
        organizationId,
        propertyId,
        guestId: stay.guestId,
        stayId: stay.id,
        reference: `${seededReference(rng, 'ARC')}-${String(orderCount).padStart(3, '0')}`,
        status: refunded ? OrderStatus.REFUNDED : OrderStatus.CONFIRMED,
        currency: CURRENCY,
        subtotalMinor: subtotal,
        feesMinor: fees,
        totalMinor: subtotal + fees,
        refundedMinor: refunded ? subtotal + fees : 0,
        hotelEarningsMinor: refunded ? 0 : splits.reduce((n, s) => n + s.hotel.amountMinor, 0),
        platformEarningsMinor: refunded ? 0 : splits.reduce((n, s) => n + s.platform.amountMinor, 0),
        supplierPayableMinor: refunded ? 0 : splits.reduce((n, s) => n + s.supplier.amountMinor, 0),
        isSimulated: true,
        paymentProvider: 'simulated',
        paymentReference: `sim_${seededToken(rng, 16)}`,
        confirmedAt,
        refundedAt: refunded ? localInstant(stay.checkIn, '09:00') : null,
        cancellationReason: refunded ? 'Demo refund: conditions cancelled the departure.' : null,
        createdAt: confirmedAt,
      },
    })
    orderCount += 1

    for (const [i, line] of lines.entries()) {
      const split = splits[i]
      if (!split) continue
      const item = await prisma.orderItem.create({
        data: {
          organizationId,
          orderId: order.id,
          experienceId: line.experienceId,
          slotId: line.slotId,
          supplierId: line.supplierId,
          quantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor,
          bookingFeeMinor: line.bookingFeeMinor,
          lineTotalMinor: line.lineTotalMinor,
          currency: CURRENCY,
          status: refunded ? OrderItemStatus.REFUNDED : OrderItemStatus.CONFIRMED,
          hotelEarningsMinor: refunded ? 0 : split.hotel.amountMinor,
          platformEarningsMinor: refunded ? 0 : split.platform.amountMinor,
          supplierPayableMinor: refunded ? 0 : split.supplier.amountMinor,
          supplierConfirmedAt: refunded ? null : confirmedAt,
          refundedMinor: refunded ? line.lineTotalMinor : 0,
          createdAt: confirmedAt,
        },
      })
      itemCount += 1

      // Written exactly as a real checkout does, including for refunded
      // orders: the three earnings entries are what the sale produced, and the
      // refund is a later, negative entry against them. Writing only the refund
      // would leave the ledger short by the order total.
      await prisma.ledgerEntry.createMany({
        data: [
          { organizationId, orderId: order.id, orderItemId: item.id, account: 'hotel_earnings', amountMinor: split.hotel.amountMinor, currency: CURRENCY, memo: 'Simulated hotel share', createdAt: confirmedAt },
          { organizationId, orderId: order.id, orderItemId: item.id, account: 'platform_commission', amountMinor: split.platform.amountMinor, currency: CURRENCY, memo: 'Simulated ARC commission', createdAt: confirmedAt },
          { organizationId, orderId: order.id, orderItemId: item.id, account: 'supplier_payable', amountMinor: split.supplier.amountMinor, currency: CURRENCY, memo: 'Simulated supplier payable', createdAt: confirmedAt },
        ],
      })

      if (refunded) {
        // Reversed per account, exactly as `cancelOrderItem` does. It used to
        // be one entry on a `refund` account: the ledger balanced and each
        // individual account was wrong, which stopped being survivable once
        // `supplier_payable` became the basis for paying a partner.
        await prisma.ledgerEntry.createMany({
          data: [
            { organizationId, orderId: order.id, orderItemId: item.id, account: 'hotel_earnings', amountMinor: -split.hotel.amountMinor, currency: CURRENCY, memo: 'Simulated refund · reversing hotel share', createdAt: confirmedAt },
            { organizationId, orderId: order.id, orderItemId: item.id, account: 'platform_commission', amountMinor: -split.platform.amountMinor, currency: CURRENCY, memo: 'Simulated refund · reversing ARC commission', createdAt: confirmedAt },
            { organizationId, orderId: order.id, orderItemId: item.id, account: 'supplier_payable', amountMinor: -split.supplier.amountMinor, currency: CURRENCY, memo: 'Simulated refund · reversing supplier payable', createdAt: confirmedAt },
          ],
        })
      }
    }

    await prisma.analyticsEvent.create({
      data: {
        organizationId,
        propertyId,
        name: 'checkout_completed',
        surface: 'guest',
        subjectKey: `stay:${stay.id.slice(0, 8)}`,
        propertiesJson: { itemCount: lines.length, totalMinor: subtotal + fees, currency: CURRENCY, simulated: true },
        occurredAt: confirmedAt,
      },
    })
  }

  return { orderCount, itemCount }
}

async function seedProposals(organizationId: string, propertyId: string, experienceIds: Map<string, string>) {
  const transferId = experienceIds.get('pxm-airport-private-transfer')

  await prisma.proposal.create({
    data: {
      organizationId,
      propertyId,
      kind: ProposalKind.TRANSPORT_ARRANGEMENT,
      status: ProposalStatus.PENDING_APPROVAL,
      title: 'Two arrivals today have no transport booked',
      summary:
        'Yuki Tanaka and Fiona Gallagher both check in today and neither has an airport transfer on their order. Offering the private PXM transfer at the standard rate would cover both arrivals.',
      actionJson: {
        type: 'offer_experience_to_stays',
        experienceId: transferId ?? null,
        reason: 'arrival_without_transport',
      },
      evidenceJson: {
        source: 'database',
        arrivalsToday: 2,
        arrivalsWithoutTransport: 2,
        note: 'Counted from Stay rows checking in today with no TRANSPORT order item.',
      },
      potentialValueMinor: 90000,
      currency: CURRENCY,
    },
  })

  await prisma.proposal.create({
    data: {
      organizationId,
      propertyId,
      kind: ProposalKind.CATALOG_GAP,
      status: ProposalStatus.PENDING_APPROVAL,
      title: 'Three amenities are not yet sellable',
      summary:
        'Loaner soft-top boards, the bicycles and the plunge pool are recorded as amenities but have no experience attached, so they cannot appear in a guest itinerary. Board rental is the obvious first candidate.',
      actionJson: { type: 'draft_experience_from_amenity', amenityNames: ['Loaner soft-top boards', 'Bicycles'] },
      evidenceJson: {
        source: 'database',
        amenitiesWithoutExperience: 5,
        note: 'Counted from Amenity rows where experienceId is null.',
      },
      potentialValueMinor: 0,
      currency: CURRENCY,
    },
  })

  await prisma.proposal.create({
    data: {
      organizationId,
      propertyId,
      kind: ProposalKind.SUPPLIER_OUTREACH,
      status: ProposalStatus.PENDING_APPROVAL,
      title: 'Six partners are unverified',
      summary:
        'Every partner in the catalog is still unverified, and two have no insurance on file. ARC recommends collecting documents before the pilot opens to real guests.',
      actionJson: { type: 'request_supplier_documents', scope: 'all_unverified' },
      evidenceJson: {
        source: 'database',
        unverifiedSuppliers: 6,
        withoutInsurance: 2,
        note: 'Counted from Supplier rows where verification = UNVERIFIED.',
      },
      potentialValueMinor: 0,
      currency: CURRENCY,
    },
  })
}

/**
 * The seed is a demo-mode tool, and refusing to run outside demo mode is the
 * point.
 *
 * Everything it writes is deterministic by design — including six literal
 * portal tokens and the rest from a fixed-seed PRNG — so anyone who can run
 * this script from the public repository can derive every portal token in the
 * database it wrote. That is the correct trade for a synthetic demo and
 * catastrophic for a pilot: a stay's portal token is the guest surface's only
 * credential.
 *
 * `vercel-build` calls `db:ensure-seed`, which seeds any empty database it
 * finds, so this guard is what stands between a mis-set `ARC_DATA_MODE` and a
 * pilot database full of guessable credentials. `ARC_ALLOW_SEED=1` is the
 * deliberate, documented override for restoring a staging environment.
 */
function assertSeedAllowed(): void {
  const mode = process.env.ARC_DATA_MODE ?? 'demo'
  if (mode === 'demo' || process.env.ARC_ALLOW_SEED === '1') return

  throw new Error(
    `The demo seed refuses to run while ARC_DATA_MODE=${mode}. Every token it writes is ` +
      'derivable from the public repository, and a portal token is a credential. Set ' +
      'ARC_ALLOW_SEED=1 only for a throwaway environment.',
  )
}

async function main(): Promise<void> {
  const started = Date.now()
  assertSeedAllowed()
  const rng = createRng(SEED)

  console.log('▸ Clearing existing data…')
  await truncateAll()

  console.log('▸ Destination graph (places, travel, conditions, activities)…')
  const { placeIdBySlug, activityIdBySlug } = await seedDestination(rng)

  // A baseline only. It is a snapshot, not a verification: no change exists
  // until a later check's hash differs, and none is ever seeded as VERIFIED.
  console.log('▸ Travel-advice baseline snapshot (fixture)…')
  await checkTravelAdviceSource({
    destination: 'puerto-escondido',
    provider: new FixtureTravelAdviceProvider(),
  })

  console.log('▸ Organization, property, staff, rooms…')
  const { organization, property, roomTypeIds } = await seedTenant(placeIdBySlug)

  console.log('▸ Suppliers and agreements…')
  const supplierIds = await seedSuppliers(organization.id, property.id, placeIdBySlug)

  console.log('▸ Catalog (experiences, prices, amenities)…')
  const experienceIds = await seedCatalog(
    organization.id, property.id, supplierIds, activityIdBySlug, placeIdBySlug,
  )

  console.log('▸ Commission rules…')
  const commissionRules = await seedCommissionRules(organization.id, property.id, experienceIds)

  console.log('▸ Forward availability…')
  const slotCount = await seedAvailability(organization.id, experienceIds, rng)

  console.log('▸ Guests, consents, stays…')
  const { guestIds, stays } = await seedGuestsAndStays(
    organization.id, property.id, roomTypeIds, rng,
  )

  console.log('▸ Historical simulated orders…')
  const { orderCount, itemCount } = await seedHistoricalOrders(
    organization.id, property.id, experienceIds, commissionRules, stays, rng,
  )

  console.log('▸ Pending owner proposals…')
  await seedProposals(organization.id, property.id, experienceIds)

  await prisma.auditEvent.create({
    data: {
      organizationId: organization.id,
      actorKind: 'system',
      action: 'database.seeded',
      entityType: 'Organization',
      entityId: organization.id,
      metadataJson: { seed: SEED, today: TODAY, mode: 'demo' },
    },
  })

  const portalTokens = await prisma.stay.findMany({
    where: { propertyId: property.id, status: { in: [StayStatus.IN_HOUSE, StayStatus.BOOKED] } },
    orderBy: { checkIn: 'asc' },
    take: 3,
    select: { portalToken: true, guest: { select: { firstName: true, lastName: true } } },
  })

  console.log('')
  console.log('✔ Seed complete in %dms', Date.now() - started)
  console.log('  organization      %s', organization.name)
  console.log('  property          %s (%d rooms)', property.name, property.roomCount)
  console.log('  suppliers         %d (all UNVERIFIED by design)', supplierIds.size)
  console.log('  experiences       %d published', experienceIds.size)
  console.log('  availability      %d forward slots over %d days', slotCount, AVAILABILITY_DAYS)
  console.log('  guests            %d profiles', guestIds.length)
  console.log('  stays             %d total', stays.length)
  console.log('  orders            %d simulated (%d line items)', orderCount, itemCount)
  console.log('')
  console.log('  Sign in at /sign-in — owner: elena@casaolas.demo')

  /*
   * The portal links are printed on a developer machine and withheld in
   * production.
   *
   * `npm run db:ensure-seed` runs this script in the hosted build, so anything
   * printed here lands in a build log that outlives the deployment and is
   * visible to anyone who can see the project. A portal token is a bearer
   * credential; there is no point deriving it from a secret and then printing
   * it next to the guest's name.
   *
   * An operator who needs one can read it from the database, or from the stay's
   * page in the product, both of which require being someone.
   */
  if (process.env.NODE_ENV === 'production') {
    console.log(
      '  Guest portal links: %d minted, not printed. A build log is not the place for a ' +
        'bearer credential — read them from the stay pages in /owner/arrivals.',
      portalTokens.length,
    )
  } else {
    console.log('  Guest portal links (QR targets):')
    for (const t of portalTokens) {
      console.log('    /g/%s  → %s %s', t.portalToken, t.guest.firstName, t.guest.lastName)
    }
  }
  console.log('')
  console.log('  All money and metrics above are DEMO DATA. No real bookings exist.')
}

main()
  .catch((error) => {
    console.error('Seed failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

import { prisma } from '@/lib/db'
import { addDays, fromDateKey, toDateKey, toLocalTimeString, type DateKey } from '@/lib/dates'
import { money } from '@/lib/money'
import {
  ExperienceStatus,
  OrderItemStatus,
  OrderStatus,
  ProposalStatus,
  Role,
  SlotStatus,
  StayStatus,
  VerificationStatus,
} from '@/lib/prisma-types'
import { assertPropertyAccess, type ActorContext } from '@/modules/tenancy/context'
import { resolveCommission, potentialHotelEarnings, type CommissionRuleInput } from '@/modules/commerce/commission'
import { narrativeSchema, runAI } from '@/modules/ai/service'

/**
 * The owner's morning briefing.
 *
 * Every number in here is counted from stored rows, and the function returns the
 * query that produced it alongside the figure. That is the difference between an
 * operator report and a chatbot: an owner who disagrees with a number can be
 * shown where it came from.
 *
 * The hardest-held rule is the separation of **earned** from **potential**.
 * Earned is money from confirmed orders — the metric the pilot will be judged
 * on. Potential is an estimate of what a drafted action might be worth. They are
 * never summed, never shown in the same column, and `potential` is labelled as
 * not earned everywhere it appears.
 */
export interface BriefingFact {
  /** How this number was derived, in one sentence a sceptic can check. */
  derivation: string
  value: number
}

export interface BriefingSection {
  key: string
  title: string
  /** Guest-of-honour sentence for the section. */
  summary: string
  items: Array<{
    id: string
    label: string
    detail?: string
    /** Potential value only; never earned revenue. */
    potentialValueMinor?: number
    href?: string
  }>
}

export interface MorningBriefing {
  propertyId: string
  propertyName: string
  generatedAt: Date
  forDate: DateKey
  currency: string

  /** Money that actually came in. Confirmed orders only. */
  earned: {
    yesterdayMinor: BriefingFact
    last7DaysMinor: BriefingFact
    allTimeMinor: BriefingFact
    attachRatePct: BriefingFact
  }

  /** Estimates. Explicitly not earned, and never added to the figures above. */
  potential: {
    totalMinor: number
    note: string
  }

  arrivals: BriefingSection
  gaps: BriefingSection
  opportunities: BriefingSection
  approvals: BriefingSection
  departuresToday: BriefingSection

  /** Optional prose over the facts above. Absent if the model failed. */
  narrative: string[]
  agentRunId: string | null
}

export async function buildMorningBriefing(
  actor: ActorContext,
  propertyId: string,
  options: { now?: Date; withNarrative?: boolean } = {},
): Promise<MorningBriefing> {
  const { organizationId } = await assertPropertyAccess(
    actor, propertyId, Role.OWNER, Role.STAFF, Role.ADMIN,
  )

  const now = options.now ?? new Date()
  const today = toDateKey(now)
  const yesterday = addDays(today, -1)
  const sevenDaysAgo = addDays(today, -7)

  const property = await prisma.property.findUniqueOrThrow({
    where: { id: propertyId },
    select: { name: true, currency: true },
  })

  const [
    earnedYesterday,
    earnedWeek,
    earnedAllTime,
    staysAllTime,
    staysWithOrders,
    arrivingToday,
    inHouse,
    amenityGaps,
    unverifiedPartners,
    pendingProposals,
    draftExperiences,
    emptySlotsSoon,
    departuresToday,
    commissionRules,
    organization,
  ] = await Promise.all([
    prisma.order.aggregate({
      where: {
        propertyId,
        status: { in: [OrderStatus.CONFIRMED, OrderStatus.PARTIALLY_CANCELLED] },
        confirmedAt: { gte: fromDateKey(yesterday), lt: fromDateKey(today) },
      },
      _sum: { hotelEarningsMinor: true },
      _count: true,
    }),
    prisma.order.aggregate({
      where: {
        propertyId,
        status: { in: [OrderStatus.CONFIRMED, OrderStatus.PARTIALLY_CANCELLED] },
        confirmedAt: { gte: fromDateKey(sevenDaysAgo) },
      },
      _sum: { hotelEarningsMinor: true },
      _count: true,
    }),
    prisma.order.aggregate({
      where: {
        propertyId,
        status: { in: [OrderStatus.CONFIRMED, OrderStatus.PARTIALLY_CANCELLED] },
      },
      _sum: { hotelEarningsMinor: true },
      _count: true,
    }),
    prisma.stay.count({
      where: { propertyId, status: { in: [StayStatus.CHECKED_OUT, StayStatus.IN_HOUSE] } },
    }),
    prisma.stay.count({
      where: {
        propertyId,
        status: { in: [StayStatus.CHECKED_OUT, StayStatus.IN_HOUSE] },
        orders: { some: { status: { in: [OrderStatus.CONFIRMED, OrderStatus.PARTIALLY_CANCELLED] } } },
      },
    }),
    prisma.stay.findMany({
      where: {
        propertyId,
        status: StayStatus.BOOKED,
        checkIn: { gte: fromDateKey(today), lt: fromDateKey(addDays(today, 1)) },
      },
      select: {
        id: true,
        reference: true,
        adults: true,
        children: true,
        guest: {
          select: { id: true, firstName: true, lastName: true, intakeCompletedAt: true, locale: true },
        },
        orders: {
          where: { status: { in: [OrderStatus.CONFIRMED, OrderStatus.PENDING] } },
          select: { items: { select: { experience: { select: { category: true } } } } },
        },
      },
    }),
    prisma.stay.count({ where: { propertyId, status: StayStatus.IN_HOUSE } }),
    prisma.amenity.findMany({
      where: { propertyId, experienceId: null },
      select: { id: true, name: true, category: true, isIncluded: true },
    }),
    prisma.supplier.findMany({
      where: {
        organizationId,
        verification: { not: VerificationStatus.VERIFIED },
        agreements: { some: { propertyId } },
      },
      select: { id: true, name: true, insuranceOnFile: true },
    }),
    prisma.proposal.findMany({
      where: { propertyId, status: ProposalStatus.PENDING_APPROVAL },
      orderBy: { potentialValueMinor: 'desc' },
      select: {
        id: true,
        kind: true,
        title: true,
        summary: true,
        potentialValueMinor: true,
        currency: true,
      },
    }),
    prisma.experience.findMany({
      where: { propertyId, status: { in: [ExperienceStatus.DRAFT, ExperienceStatus.PENDING_REVIEW] } },
      select: { id: true, titleEn: true, status: true },
    }),
    prisma.availabilitySlot.findMany({
      where: {
        experience: { propertyId, status: ExperienceStatus.PUBLISHED },
        status: SlotStatus.OPEN,
        booked: 0,
        startsAt: { gte: now, lt: new Date(now.getTime() + 3 * 86_400_000) },
      },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        startsAt: true,
        capacity: true,
        experience: {
          select: {
            id: true,
            titleEn: true,
            category: true,
            prices: {
              where: { isActive: true, kind: 'BASE' },
              select: { amountMinor: true, currency: true },
            },
          },
        },
      },
    }),
    prisma.orderItem.findMany({
      where: {
        organizationId,
        status: OrderItemStatus.CONFIRMED,
        slot: {
          startsAt: { gte: fromDateKey(today), lt: fromDateKey(addDays(today, 1)) },
          experience: { propertyId },
        },
      },
      orderBy: { slot: { startsAt: 'asc' } },
      select: {
        id: true,
        quantity: true,
        supplierConfirmedAt: true,
        experience: { select: { titleEn: true, meetingPoint: true } },
        slot: { select: { startsAt: true } },
        order: { select: { guest: { select: { firstName: true } } } },
      },
    }),
    prisma.commissionRule.findMany({ where: { organizationId, isActive: true } }),
    prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { defaultCommissionBps: true },
    }),
  ])

  const currency = property.currency

  // --- Earned ---------------------------------------------------------------
  const attachRate =
    staysAllTime === 0 ? 0 : Math.round((staysWithOrders / staysAllTime) * 1000) / 10

  const earned: MorningBriefing['earned'] = {
    yesterdayMinor: {
      value: earnedYesterday._sum.hotelEarningsMinor ?? 0,
      derivation: `Your share of ${earnedYesterday._count} orders confirmed on ${yesterday}.`,
    },
    last7DaysMinor: {
      value: earnedWeek._sum.hotelEarningsMinor ?? 0,
      derivation: `Your share of ${earnedWeek._count} orders confirmed since ${sevenDaysAgo}.`,
    },
    allTimeMinor: {
      value: earnedAllTime._sum.hotelEarningsMinor ?? 0,
      derivation: `Your share of all ${earnedAllTime._count} confirmed orders, net of refunded lines.`,
    },
    attachRatePct: {
      value: attachRate,
      derivation: `${staysWithOrders} of ${staysAllTime} completed or in-house stays bought at least one experience.`,
    },
  }

  // --- Arrivals -------------------------------------------------------------
  const arrivalsWithoutTransport = arrivingToday.filter(
    (stay) => !stay.orders.some((o) => o.items.some((i) => i.experience.category === 'TRANSPORT')),
  )
  const arrivalsWithoutIntake = arrivingToday.filter((stay) => !stay.guest.intakeCompletedAt)

  const arrivals: BriefingSection = {
    key: 'arrivals',
    title: 'Arrivals today',
    summary:
      arrivingToday.length === 0
        ? `No arrivals today. ${inHouse} ${inHouse === 1 ? 'stay' : 'stays'} in house.`
        : `${arrivingToday.length} arriving, ${inHouse} already in house. ${arrivalsWithoutTransport.length} without transport booked, ${arrivalsWithoutIntake.length} without preferences.`,
    items: arrivingToday.map((stay) => {
      const flags: string[] = []
      if (!stay.guest.intakeCompletedAt) flags.push('no preferences on file')
      if (!stay.orders.some((o) => o.items.some((i) => i.experience.category === 'TRANSPORT'))) {
        flags.push('no transport booked')
      }
      return {
        id: stay.id,
        label: `${stay.guest.firstName} ${stay.guest.lastName}`,
        detail: `${stay.reference} · ${stay.adults + stay.children} guests${flags.length > 0 ? ` · ${flags.join(', ')}` : ''}`,
        href: '/owner/arrivals',
      }
    }),
  }

  // --- Departures running today --------------------------------------------
  const departures: BriefingSection = {
    key: 'departures',
    title: 'Experiences running today',
    summary:
      departuresToday.length === 0
        ? 'Nothing booked for today.'
        : `${departuresToday.length} ${departuresToday.length === 1 ? 'booking' : 'bookings'} today. ${departuresToday.filter((d) => !d.supplierConfirmedAt).length} not yet confirmed by the partner.`,
    items: departuresToday.map((item) => ({
      id: item.id,
      label: `${toLocalTimeString(item.slot.startsAt)} ${item.experience.titleEn}`,
      detail: `${item.order.guest?.firstName ?? 'Guest'} ×${item.quantity}${item.supplierConfirmedAt ? '' : ' · partner has not confirmed'}${item.experience.meetingPoint ? ` · ${item.experience.meetingPoint}` : ''}`,
    })),
  }

  // --- Catalog gaps ---------------------------------------------------------
  const gaps: BriefingSection = {
    key: 'gaps',
    title: 'Gaps in what you can sell',
    summary: [
      amenityGaps.length > 0
        ? `${amenityGaps.length} ${amenityGaps.length === 1 ? 'amenity' : 'amenities'} cannot be sold.`
        : null,
      draftExperiences.length > 0
        ? `${draftExperiences.length} ${draftExperiences.length === 1 ? 'experience is' : 'experiences are'} unpublished.`
        : null,
      unverifiedPartners.length > 0
        ? `${unverifiedPartners.length} ${unverifiedPartners.length === 1 ? 'partner is' : 'partners are'} unverified.`
        : null,
    ]
      .filter(Boolean)
      .join(' ') || 'Nothing outstanding.',
    items: [
      ...amenityGaps.map((amenity) => ({
        id: amenity.id,
        label: amenity.name,
        detail: `${amenity.category.toLowerCase()} amenity with no experience attached`,
        href: `/owner/catalog/new?amenity=${encodeURIComponent(amenity.name)}&category=${amenity.category}`,
      })),
      ...draftExperiences.map((experience) => ({
        id: experience.id,
        label: experience.titleEn,
        detail: `${experience.status.toLowerCase()} — not visible to guests`,
        href: `/owner/catalog/${experience.id}`,
      })),
      ...unverifiedPartners.map((partner) => ({
        id: partner.id,
        label: partner.name,
        detail: partner.insuranceOnFile
          ? 'unverified by ARC'
          : 'unverified by ARC, and no insurance on file',
        href: '/owner/partners',
      })),
    ],
  }

  // --- Opportunities (potential only) --------------------------------------
  // Empty departures in the next three days: an unsold seat on a boat leaving
  // tomorrow is the most perishable inventory the hotel has.
  const opportunityItems = emptySlotsSoon.slice(0, 12).map((slot) => {
    const price = slot.experience.prices[0]
    const gross = money((price?.amountMinor ?? 0) * slot.capacity, currency)
    const commission = resolveCommission(
      commissionRules as CommissionRuleInput[],
      {
        propertyId,
        experienceId: slot.experience.id,
        category: slot.experience.category,
      },
      organization.defaultCommissionBps,
    )
    const upside = potentialHotelEarnings(gross, commission, slot.capacity)

    return {
      id: slot.id,
      label: `${slot.experience.titleEn} · ${toDateKey(slot.startsAt)} ${toLocalTimeString(slot.startsAt)}`,
      detail: `${slot.capacity} places unsold`,
      potentialValueMinor: upside.amountMinor,
      href: `/owner/catalog/${slot.experience.id}`,
    }
  })

  const potentialTotal = opportunityItems.reduce((n, i) => n + (i.potentialValueMinor ?? 0), 0)

  const opportunities: BriefingSection = {
    key: 'opportunities',
    title: 'Unsold departures in the next three days',
    summary:
      opportunityItems.length === 0
        ? 'Every departure in the next three days has at least one guest on it.'
        : `${emptySlotsSoon.length} departures have nobody booked. If every place sold at the published rate your share would be the figure below — that is an estimate of what is possible, not money you have.`,
    items: opportunityItems,
  }

  // --- Approvals ------------------------------------------------------------
  const approvals: BriefingSection = {
    key: 'approvals',
    title: 'Waiting on your decision',
    summary:
      pendingProposals.length === 0
        ? 'Nothing waiting.'
        : `${pendingProposals.length} drafted ${pendingProposals.length === 1 ? 'action' : 'actions'}. Nothing has been sent or changed.`,
    items: pendingProposals.map((proposal) => ({
      id: proposal.id,
      label: proposal.title,
      detail: proposal.summary,
      potentialValueMinor: proposal.potentialValueMinor,
      href: '/owner/approvals',
    })),
  }

  // --- Optional narrative ---------------------------------------------------
  let narrative: string[] = []
  let agentRunId: string | null = null

  if (options.withNarrative !== false) {
    const run = await runAI({
      organizationId,
      task: 'briefing.compose',
      system:
        'Introduce a hotel operator briefing whose numbers are already computed. Keep earned revenue and potential revenue clearly apart. Add no figures of your own.',
      facts: {
        arrivalsToday: arrivingToday.length,
        inHouse,
        catalogGaps: gaps.items.length,
        pendingApprovals: pendingProposals.length,
        earnedTodayMinor: earned.yesterdayMinor.value,
        unsoldDepartures: emptySlotsSoon.length,
        attachRatePct: attachRate,
      },
      schema: narrativeSchema,
      requestedByUserId: actor.userId,
    })
    narrative = run.data?.paragraphs ?? []
    agentRunId = run.agentRunId
  }

  return {
    propertyId,
    propertyName: property.name,
    generatedAt: now,
    forDate: today,
    currency,
    earned,
    potential: {
      totalMinor: potentialTotal,
      note: 'An estimate of your share if every unsold place in the next three days sold at the published rate. It is not revenue, it has not been earned, and it is never added to the figures above.',
    },
    arrivals,
    gaps,
    opportunities,
    approvals,
    departuresToday: departures,
    narrative,
    agentRunId,
  }
}

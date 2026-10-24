import { prisma } from '@/lib/db'
import { forbidden, invalid, notFound } from '@/lib/errors'
import { localInstant, toDateKey, type DateKey } from '@/lib/dates'
import {
  ExperienceStatus,
  OrderItemStatus,
  Role,
  SlotStatus,
  type Prisma,
} from '@/lib/prisma-types'
import { isInSeason, isWithinHours } from '@/modules/destination/operating-window'
import { assertSupplierAccess, type ActorContext } from '@/modules/tenancy/context'
import { recordAudit } from '@/modules/workflows/audit'
import { slotRangeSchema } from '@/modules/catalog/schemas'
import { sweepExpiredHolds } from '@/modules/inventory/service'

/**
 * Partner (supplier) portal service.
 *
 * A partner sees exactly their own experiences, their own departures and the
 * bookings against them. They never see the hotel's other partners, its guests'
 * contact details, or the hotel's earnings across the catalog — only what they
 * themselves are owed, plus the commission terms of their own agreement.
 *
 * That last part is deliberate and worth stating, because it is derivable
 * either way: a partner who knows their own split and their own payable can
 * compute the hotel's take on their own bookings. Showing the agreed
 * percentages openly is better than pretending they are secret, and a partner
 * who cannot see the terms they signed has a reason to distrust the numbers.
 * What they still cannot see is any figure from a *different* partner's
 * bookings, or the property's aggregate revenue.
 *
 * The boundary is enforced here rather than by what the UI happens to render.
 */

/** Resolves which supplier account the signed-in partner is acting as. */
export async function resolveOperatingSupplier(
  actor: ActorContext,
  requestedSupplierId?: string,
): Promise<{ organizationId: string; supplierId: string }> {
  if (requestedSupplierId) {
    const { organizationId, supplierId } = await assertSupplierAccess(actor, requestedSupplierId)
    return { organizationId, supplierId }
  }

  const bound = actor.memberships.find((m) => m.role === Role.SUPPLIER && m.supplierId)
  if (bound?.supplierId) {
    return { organizationId: bound.organizationId, supplierId: bound.supplierId }
  }

  // Owners and admins may inspect a partner's view; pick their first partner.
  const organizationIds = actor.memberships
    .filter((m) => m.role === Role.OWNER || m.role === Role.ADMIN)
    .map((m) => m.organizationId)

  const supplier = await prisma.supplier.findFirst({
    where: actor.isPlatformAdmin ? {} : { organizationId: { in: organizationIds } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, organizationId: true },
  })

  if (!supplier) throw forbidden('You are not linked to a partner account.')
  return { organizationId: supplier.organizationId, supplierId: supplier.id }
}

export async function getSupplierProfile(actor: ActorContext, supplierId: string) {
  await assertSupplierAccess(actor, supplierId)

  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    include: {
      place: { select: { id: true, name: true } },
      agreements: {
        select: {
          id: true,
          hotelCommissionBps: true,
          platformCommissionBps: true,
          cancellationWindowHours: true,
          requiresManualConfirmation: true,
          status: true,
          signedAt: true,
          property: { select: { id: true, name: true } },
        },
      },
      _count: { select: { experiences: true } },
    },
  })
  if (!supplier) throw notFound('Partner')
  return supplier
}

export async function listSupplierExperiences(actor: ActorContext, supplierId: string) {
  await assertSupplierAccess(actor, supplierId)

  return prisma.experience.findMany({
    where: { supplierId },
    orderBy: [{ status: 'asc' }, { titleEn: 'asc' }],
    select: {
      id: true,
      slug: true,
      titleEn: true,
      category: true,
      status: true,
      durationMinutes: true,
      defaultCapacity: true,
      minParty: true,
      maxParty: true,
      property: { select: { id: true, name: true } },
      activity: { select: { name: true, earliestStart: true, latestStart: true } },
      prices: {
        where: { isActive: true },
        select: { kind: true, amountMinor: true, bookingFeeMinor: true, currency: true, minParty: true },
      },
      _count: { select: { slots: true } },
    },
  })
}

export interface SupplierSlotRow {
  id: string
  experienceId: string
  experienceTitle: string
  startsAt: Date
  endsAt: Date
  capacity: number
  booked: number
  held: number
  remaining: number
  status: SlotStatus
  priceOverrideMinor: number | null
  currency: string
}

export async function listSupplierAvailability(
  actor: ActorContext,
  supplierId: string,
  options: { fromDate?: Date; days?: number } = {},
): Promise<SupplierSlotRow[]> {
  await assertSupplierAccess(actor, supplierId)

  const from = options.fromDate ?? new Date()
  const to = new Date(from.getTime() + (options.days ?? 21) * 86_400_000)

  // Sweep first so the numbers a partner sees are the real ones.
  const slotIds = (
    await prisma.availabilitySlot.findMany({
      where: { experience: { supplierId }, startsAt: { gte: from, lt: to } },
      select: { id: true },
    })
  ).map((s) => s.id)
  await sweepExpiredHolds({ slotIds })

  const slots = await prisma.availabilitySlot.findMany({
    where: { experience: { supplierId }, startsAt: { gte: from, lt: to } },
    orderBy: { startsAt: 'asc' },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      capacity: true,
      booked: true,
      held: true,
      status: true,
      priceOverrideMinor: true,
      currency: true,
      experience: { select: { id: true, titleEn: true } },
    },
  })

  return slots.map((slot) => ({
    id: slot.id,
    experienceId: slot.experience.id,
    experienceTitle: slot.experience.titleEn,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    capacity: slot.capacity,
    booked: slot.booked,
    held: slot.held,
    remaining: Math.max(0, slot.capacity - slot.booked - slot.held),
    status: slot.status,
    priceOverrideMinor: slot.priceOverrideMinor,
    currency: slot.currency,
  }))
}

/**
 * Bulk-schedules departures across a date range.
 *
 * The one write a partner most needs: an operator who runs 07:30 and 10:00
 * every day except Sunday should say that once, not forty times.
 */
export async function scheduleAvailability(
  actor: ActorContext,
  supplierId: string,
  raw: unknown,
): Promise<{ created: number; skipped: number }> {
  const { organizationId } = await assertSupplierAccess(actor, supplierId)
  const input = slotRangeSchema.parse(raw)

  const experience = await prisma.experience.findFirst({
    where: { id: input.experienceId, supplierId },
    select: {
      id: true,
      durationMinutes: true,
      defaultCapacity: true,
      status: true,
      activity: { select: { earliestStart: true, latestStart: true, seasonMonths: true } },
    },
  })
  if (!experience) throw notFound('Experience')

  // Every requested start time must fall inside the activity's hours. This is
  // bad input rather than an unlucky day, so it is refused outright: a partner
  // who asks for 23:00 on a dawn-only session has made a mistake, and silently
  // dropping it would hide it from them. Out-of-season *days* inside an
  // otherwise valid range are skipped below instead, like past days are.
  for (const startTime of input.startTimes) {
    if (!isWithinHours(experience.activity, startTime)) {
      throw invalid(
        `This activity departs between ${experience.activity.earliestStart} and ${experience.activity.latestStart}; ${startTime} is outside that.`,
        { startTime },
      )
    }
  }

  const from = new Date(`${input.fromDate}T00:00:00.000Z`)
  const to = new Date(`${input.toDate}T00:00:00.000Z`)
  if (to.getTime() < from.getTime()) {
    throw invalid('The end date cannot be before the start date.')
  }

  const spanDays = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1
  if (spanDays > 90) throw invalid('Schedule at most 90 days at a time.')

  const rows: Prisma.AvailabilitySlotCreateManyInput[] = []
  for (let i = 0; i < spanDays; i += 1) {
    const day = new Date(from.getTime() + i * 86_400_000)
    const dateKey: DateKey = toDateKey(day)

    if (input.weekdays.length > 0 && !input.weekdays.includes(day.getUTCDay())) continue
    // The activity does not run this month; no departure may exist on this day.
    if (!isInSeason(experience.activity, dateKey)) continue

    for (const startTime of input.startTimes) {
      const startsAt = localInstant(dateKey, startTime)
      // Never schedule into the past, however wide the range.
      if (startsAt.getTime() <= Date.now()) continue

      rows.push({
        organizationId,
        experienceId: experience.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + experience.durationMinutes * 60_000),
        capacity: input.capacity,
        booked: 0,
        held: 0,
        status: SlotStatus.OPEN,
        currency: 'MXN',
      })
    }
  }

  if (rows.length === 0) {
    return { created: 0, skipped: 0 }
  }

  // skipDuplicates relies on the (experienceId, startsAt) unique constraint, so
  // re-running the same schedule is harmless rather than an error.
  const result = await prisma.availabilitySlot.createMany({ data: rows, skipDuplicates: true })

  await recordAudit({
    organizationId,
    actor,
    actorKind: 'supplier',
    action: 'inventory.availability.scheduled',
    entityType: 'Experience',
    entityId: experience.id,
    metadata: {
      fromDate: input.fromDate,
      toDate: input.toDate,
      startTimes: input.startTimes,
      capacity: input.capacity,
      weekdays: input.weekdays,
      created: result.count,
      requested: rows.length,
    },
  })

  return { created: result.count, skipped: rows.length - result.count }
}

/** Closes a departure so nothing further can be booked onto it. */
export async function closeSlot(
  actor: ActorContext,
  supplierId: string,
  slotId: string,
  reason: string,
): Promise<void> {
  const { organizationId } = await assertSupplierAccess(actor, supplierId)

  const slot = await prisma.availabilitySlot.findFirst({
    where: { id: slotId, experience: { supplierId } },
    select: { id: true, booked: true },
  })
  if (!slot) throw notFound('Departure')

  await prisma.$transaction(async (tx) => {
    await tx.availabilitySlot.update({
      where: { id: slotId },
      data: { status: SlotStatus.CLOSED, note: reason },
    })
    await recordAudit(
      {
        organizationId,
        actor,
        actorKind: 'supplier',
        action: 'inventory.slot.closed',
        entityType: 'AvailabilitySlot',
        entityId: slotId,
        metadata: { reason, alreadyBooked: slot.booked },
      },
      tx,
    )
  })
}

/**
 * Booking requests for a partner.
 *
 * Guests appear by first name and party size only. A partner needs to know who
 * to expect and how many; they do not need the guest's email, and so they do
 * not get it.
 */
export async function listSupplierBookings(
  actor: ActorContext,
  supplierId: string,
  options: { includePast?: boolean } = {},
) {
  await assertSupplierAccess(actor, supplierId)

  return prisma.orderItem.findMany({
    where: {
      supplierId,
      status: { in: [OrderItemStatus.PENDING, OrderItemStatus.CONFIRMED] },
      ...(options.includePast ? {} : { slot: { startsAt: { gte: new Date() } } }),
    },
    orderBy: { slot: { startsAt: 'asc' } },
    take: 100,
    select: {
      id: true,
      quantity: true,
      status: true,
      supplierConfirmedAt: true,
      supplierPayableMinor: true,
      currency: true,
      participantNotes: true,
      createdAt: true,
      experience: { select: { id: true, titleEn: true, meetingPoint: true } },
      slot: { select: { id: true, startsAt: true, endsAt: true, capacity: true, booked: true } },
      order: {
        select: {
          reference: true,
          isSimulated: true,
          confirmedAt: true,
          guest: { select: { firstName: true, partySize: true, locale: true } },
        },
      },
    },
  })
}

/**
 * Partner earnings.
 *
 * Reports only `supplierPayableMinor` — what this partner is owed. The hotel's
 * share and ARC's commission are not theirs to see, and are not selected.
 */
export async function getSupplierEarnings(actor: ActorContext, supplierId: string) {
  await assertSupplierAccess(actor, supplierId)

  const [confirmed, pendingConfirmation, byExperience, refunded] = await Promise.all([
    prisma.orderItem.aggregate({
      where: { supplierId, status: OrderItemStatus.CONFIRMED },
      _sum: { supplierPayableMinor: true, quantity: true },
      _count: true,
    }),
    prisma.orderItem.count({
      where: { supplierId, status: OrderItemStatus.CONFIRMED, supplierConfirmedAt: null },
    }),
    prisma.orderItem.groupBy({
      by: ['experienceId'],
      where: { supplierId, status: OrderItemStatus.CONFIRMED },
      _sum: { supplierPayableMinor: true, quantity: true },
      _count: true,
    }),
    prisma.orderItem.aggregate({
      where: { supplierId, status: OrderItemStatus.REFUNDED },
      _sum: { refundedMinor: true },
      _count: true,
    }),
  ])

  const experiences = await prisma.experience.findMany({
    where: { id: { in: byExperience.map((b) => b.experienceId) } },
    select: { id: true, titleEn: true },
  })
  const titleById = new Map(experiences.map((e) => [e.id, e.titleEn]))

  return {
    payableMinor: confirmed._sum.supplierPayableMinor ?? 0,
    guestsServed: confirmed._sum.quantity ?? 0,
    bookingCount: confirmed._count,
    awaitingConfirmation: pendingConfirmation,
    refundedMinor: refunded._sum.refundedMinor ?? 0,
    refundedCount: refunded._count,
    currency: 'MXN',
    byExperience: byExperience
      .map((row) => ({
        experienceId: row.experienceId,
        title: titleById.get(row.experienceId) ?? 'Unknown',
        payableMinor: row._sum.supplierPayableMinor ?? 0,
        guests: row._sum.quantity ?? 0,
        bookings: row._count,
      }))
      .sort((a, b) => b.payableMinor - a.payableMinor),
  }
}

export { ExperienceStatus }

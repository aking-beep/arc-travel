import { prisma } from '@/lib/db'
import { OrderItemStatus, OrderStatus, Role, StayStatus } from '@/lib/prisma-types'
import { assertPropertyAccess, type ActorContext } from '@/modules/tenancy/context'

/**
 * Revenue reporting.
 *
 * Built around the one metric the pilot is gated on: incremental
 * destination-commerce contribution per stay, net of supplier payments and
 * refunds. Everything else here exists so that number can be checked.
 *
 * Two rules: only CONFIRMED and PARTIALLY_CANCELLED orders count toward earned
 * revenue, and the hotel's share is read from the stored `hotelEarningsMinor`
 * rather than recomputed — recomputing would hide a drift between what was
 * recorded at checkout and what the rules say today.
 */
export interface RevenueReport {
  currency: string
  headline: {
    perStayMinor: number
    derivation: string
    attachRatePct: number
    staysWithOrders: number
    totalStays: number
    averageOrderMinor: number
    effectiveTakeRatePct: number
  }
  totals: {
    grossMinor: number
    hotelMinor: number
    supplierMinor: number
    platformMinor: number
    refundedMinor: number
    refundedCount: number
    orderCount: number
  }
  byCategory: Array<{
    category: string
    grossMinor: number
    hotelMinor: number
    bookings: number
    guests: number
  }>
  topExperiences: Array<{
    experienceId: string
    title: string
    supplierName: string
    hotelMinor: number
    grossMinor: number
    bookings: number
  }>
  ledger: Array<{ account: string; amountMinor: number; entries: number }>
  ledgerBalanceMinor: number
  ledgerReconciles: boolean
}

const EARNED_STATUSES = [OrderStatus.CONFIRMED, OrderStatus.PARTIALLY_CANCELLED]

export async function getRevenueAnalytics(
  actor: ActorContext,
  propertyId: string,
): Promise<RevenueReport> {
  const { organizationId } = await assertPropertyAccess(
    actor, propertyId, Role.OWNER, Role.STAFF, Role.ADMIN,
  )

  const property = await prisma.property.findUniqueOrThrow({
    where: { id: propertyId },
    select: { currency: true },
  })

  const [orders, liveItems, refunded, totalStays, staysWithOrders, ledgerGroups] = await Promise.all([
    prisma.order.aggregate({
      where: { propertyId, status: { in: EARNED_STATUSES } },
      _sum: {
        totalMinor: true,
        hotelEarningsMinor: true,
        platformEarningsMinor: true,
        supplierPayableMinor: true,
        refundedMinor: true,
      },
      _count: true,
    }),
    prisma.orderItem.findMany({
      where: {
        organizationId,
        status: OrderItemStatus.CONFIRMED,
        order: { propertyId, status: { in: EARNED_STATUSES } },
      },
      select: {
        experienceId: true,
        quantity: true,
        lineTotalMinor: true,
        hotelEarningsMinor: true,
        experience: {
          select: { titleEn: true, category: true, supplier: { select: { name: true } } },
        },
      },
    }),
    prisma.orderItem.aggregate({
      where: { organizationId, status: OrderItemStatus.REFUNDED, order: { propertyId } },
      _sum: { refundedMinor: true },
      _count: true,
    }),
    prisma.stay.count({
      where: { propertyId, status: { in: [StayStatus.CHECKED_OUT, StayStatus.IN_HOUSE] } },
    }),
    prisma.stay.count({
      where: {
        propertyId,
        status: { in: [StayStatus.CHECKED_OUT, StayStatus.IN_HOUSE] },
        orders: { some: { status: { in: EARNED_STATUSES } } },
      },
    }),
    prisma.ledgerEntry.groupBy({
      by: ['account'],
      where: { organizationId, order: { propertyId } },
      _sum: { amountMinor: true },
      _count: true,
    }),
  ])

  const grossMinor = orders._sum.totalMinor ?? 0
  const hotelMinor = orders._sum.hotelEarningsMinor ?? 0
  const platformMinor = orders._sum.platformEarningsMinor ?? 0
  const supplierMinor = orders._sum.supplierPayableMinor ?? 0
  const refundedMinor = refunded._sum.refundedMinor ?? 0

  // --- By category ---------------------------------------------------------
  const categoryMap = new Map<
    string,
    { grossMinor: number; hotelMinor: number; bookings: number; guests: number }
  >()
  for (const item of liveItems) {
    const key = item.experience.category
    const row = categoryMap.get(key) ?? { grossMinor: 0, hotelMinor: 0, bookings: 0, guests: 0 }
    row.grossMinor += item.lineTotalMinor
    row.hotelMinor += item.hotelEarningsMinor
    row.bookings += 1
    row.guests += item.quantity
    categoryMap.set(key, row)
  }

  // --- By experience -------------------------------------------------------
  const experienceMap = new Map<
    string,
    { title: string; supplierName: string; hotelMinor: number; grossMinor: number; bookings: number }
  >()
  for (const item of liveItems) {
    const row =
      experienceMap.get(item.experienceId) ?? {
        title: item.experience.titleEn,
        supplierName: item.experience.supplier.name,
        hotelMinor: 0,
        grossMinor: 0,
        bookings: 0,
      }
    row.hotelMinor += item.hotelEarningsMinor
    row.grossMinor += item.lineTotalMinor
    row.bookings += 1
    experienceMap.set(item.experienceId, row)
  }

  const ledger = ledgerGroups.map((group) => ({
    account: group.account,
    amountMinor: group._sum.amountMinor ?? 0,
    entries: group._count,
  }))
  const ledgerBalanceMinor = ledger.reduce((n, row) => n + row.amountMinor, 0)

  // The ledger's non-refund accounts must sum to the gross on earned orders.
  const ledgerEarnedMinor = ledger
    .filter((row) => row.account !== 'refund')
    .reduce((n, row) => n + row.amountMinor, 0)

  const perStayMinor = totalStays === 0 ? 0 : Math.round(hotelMinor / totalStays)
  const averageOrderMinor = orders._count === 0 ? 0 : Math.round(grossMinor / orders._count)

  return {
    currency: property.currency,
    headline: {
      perStayMinor,
      derivation:
        totalStays === 0
          ? 'No completed or in-house stays yet, so there is nothing to divide by.'
          : `Your share of confirmed orders (net of refunded lines) divided by all ${totalStays} completed or in-house stays — including the ${totalStays - staysWithOrders} that bought nothing.`,
      attachRatePct:
        totalStays === 0 ? 0 : Math.round((staysWithOrders / totalStays) * 1000) / 10,
      staysWithOrders,
      totalStays,
      averageOrderMinor,
      effectiveTakeRatePct:
        grossMinor === 0 ? 0 : Math.round((hotelMinor / grossMinor) * 1000) / 10,
    },
    totals: {
      grossMinor,
      hotelMinor,
      supplierMinor,
      platformMinor,
      refundedMinor,
      refundedCount: refunded._count,
      orderCount: orders._count,
    },
    byCategory: [...categoryMap.entries()]
      .map(([category, row]) => ({ category, ...row }))
      .sort((a, b) => b.hotelMinor - a.hotelMinor),
    topExperiences: [...experienceMap.entries()]
      .map(([experienceId, row]) => ({ experienceId, ...row }))
      .sort((a, b) => b.hotelMinor - a.hotelMinor)
      .slice(0, 10),
    ledger,
    ledgerBalanceMinor,
    // Compared against gross on earned orders, which is what the non-refund
    // accounts were written from.
    ledgerReconciles: ledgerEarnedMinor === grossMinor + refundedMinor,
  }
}

/** Event counts for the admin surface's system health panel. */
export async function getEventSummary(organizationId: string, days = 7) {
  const since = new Date(Date.now() - days * 86_400_000)

  const [events, agentRuns] = await Promise.all([
    prisma.analyticsEvent.groupBy({
      by: ['name', 'surface'],
      where: { organizationId, occurredAt: { gte: since } },
      _count: true,
      orderBy: { _count: { name: 'desc' } },
    }),
    prisma.agentRun.groupBy({
      by: ['task', 'status'],
      where: { organizationId, createdAt: { gte: since } },
      _count: true,
      _sum: { inputTokens: true, outputTokens: true, costMicroUsd: true },
    }),
  ])

  return {
    since,
    events: events.map((row) => ({ name: row.name, surface: row.surface, count: row._count })),
    agentRuns: agentRuns.map((row) => ({
      task: row.task,
      status: row.status,
      count: row._count,
      inputTokens: row._sum.inputTokens ?? 0,
      outputTokens: row._sum.outputTokens ?? 0,
      costMicroUsd: row._sum.costMicroUsd ?? 0,
    })),
  }
}

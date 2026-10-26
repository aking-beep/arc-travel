import { beforeEach, describe, expect, it } from 'vitest'

import { prisma } from '@/lib/db'
import { OrderStatus, PaymentReversalCause } from '@/lib/prisma-types'
import { checkInvariants, hasCritical } from '@/modules/observability/invariants'
import { actorFor, createTenant, markVerified, resetDatabase, type TenantFixture } from '../helpers/factory'

/**
 * The invariant monitor.
 *
 * Every check here watches for something that cannot happen through the
 * application — a CHECK constraint or a unique index forbids it — which is
 * exactly why they are worth watching: if one ever fires, something wrote to
 * the database directly or a restore came back without its constraints.
 *
 * That makes them awkward to test. The constraints are real on this database,
 * so a test cannot simply write a bad row. Each check is therefore proved
 * against the state it is *for*, which means dropping the constraint for the
 * length of one test — the same thing a bad restore does, and the scenario the
 * check exists to catch.
 */
const SLOT_CONSTRAINT =
  '"booked" >= 0 AND "held" >= 0 AND "booked" + "held" <= "capacity"'
const ORDER_CONSTRAINT =
  '"status" <> \'CONFIRMED\' OR "hotelEarningsMinor" + "platformEarningsMinor" + ' +
  '"supplierPayableMinor" = "totalMinor"'

/**
 * Runs `body` with one CHECK constraint dropped, then restores it.
 *
 * `restore` runs first in the cleanup and must put the offending rows back
 * within the invariant: re-adding a CHECK constraint that existing rows violate
 * fails, which would leave this database without it for every later test in the
 * run. That happened while writing these, and it is worth stating because the
 * failure is silent — the tests that follow simply stop being able to prove
 * anything.
 */
async function withoutConstraint<T>(
  table: string,
  name: string,
  definition: string,
  restore: () => Promise<unknown>,
  body: () => Promise<T>,
): Promise<T> {
  await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" DROP CONSTRAINT "${name}"`)
  try {
    return await body()
  } finally {
    await restore()
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK (${definition})`,
    )
  }
}

describe('checkInvariants', () => {
  let tenant: TenantFixture

  beforeEach(async () => {
    await resetDatabase()
    tenant = await createTenant()
  })

  it('reports nothing on a healthy database', async () => {
    const report = await checkInvariants()
    expect(report.findings).toEqual([])
    expect(report.healthy).toBe(true)
    expect(report.checksRun).toBeGreaterThan(0)
    expect(hasCritical(report)).toBe(false)
  })

  it('catches an oversold slot', async () => {
    await withoutConstraint(
      'AvailabilitySlot',
      'slot_capacity_invariant',
      SLOT_CONSTRAINT,
      () => prisma.availabilitySlot.updateMany({ data: { booked: 0, held: 0 } }),
      async () => {
      await prisma.availabilitySlot.update({
        where: { id: tenant.slotId },
        data: { booked: 999 },
      })

      const report = await checkInvariants()
      const finding = report.findings.find((f) => f.key === 'inventory.oversold')
      expect(finding).toBeDefined()
      expect(finding?.severity).toBe('critical')
      expect(finding?.sample).toContain(tenant.slotId)
      expect(hasCritical(report)).toBe(true)
      // The message has to tell an on-call person what to do about it.
      expect(finding?.summary).toMatch(/constraint/i)
      },
    )
  })

  it('catches a negative counter', async () => {
    await withoutConstraint(
      'AvailabilitySlot',
      'slot_capacity_invariant',
      SLOT_CONSTRAINT,
      () => prisma.availabilitySlot.updateMany({ data: { booked: 0, held: 0 } }),
      async () => {
        await prisma.availabilitySlot.update({
          where: { id: tenant.slotId },
          data: { booked: -1 },
        })

        const report = await checkInvariants()
        expect(report.findings.map((f) => f.key)).toContain('inventory.negative_counter')
      },
    )
  })

  it('catches an order whose split does not reconcile', async () => {
    await withoutConstraint(
      'Order',
      'order_split_reconciles',
      ORDER_CONSTRAINT,
      () => prisma.order.deleteMany({ where: { reference: 'ORD-BROKEN' } }),
      async () => {
        const order = await prisma.order.create({
          data: {
            organizationId: tenant.organizationId,
            propertyId: tenant.propertyId,
            stayId: tenant.stayId,
            guestId: tenant.guestId,
            reference: 'ORD-BROKEN',
            status: OrderStatus.CONFIRMED,
            currency: 'MXN',
            totalMinor: 100_000,
            // 1 centavo short. The kind of difference nobody spots by eye,
            // and the kind somebody is owed.
            hotelEarningsMinor: 15_000,
            platformEarningsMinor: 5_000,
            supplierPayableMinor: 79_999,
          },
          select: { id: true },
        })

        const report = await checkInvariants()
        const finding = report.findings.find((f) => f.key === 'money.order_split_unreconciled')
        expect(finding?.sample).toContain(order.id)
        expect(finding?.severity).toBe('critical')
        // Explicitly tells the operator not to make the numbers agree.
        expect(finding?.summary).toMatch(/do not adjust/i)
      },
    )
  })

  it('catches an order left PENDING, which ADR-026 says cannot happen', async () => {
    await prisma.order.create({
      data: {
        organizationId: tenant.organizationId,
        propertyId: tenant.propertyId,
        stayId: tenant.stayId,
        guestId: tenant.guestId,
        reference: 'ORD-PENDING',
        status: OrderStatus.PENDING,
        currency: 'MXN',
        totalMinor: 0,
        hotelEarningsMinor: 0,
        platformEarningsMinor: 0,
        supplierPayableMinor: 0,
      },
    })

    const report = await checkInvariants()
    const finding = report.findings.find((f) => f.key === 'commerce.order_pending')
    expect(finding).toBeDefined()
    // A warning: it is capacity held against an unaccountable payment, not
    // corrupted money.
    expect(finding?.severity).toBe('warning')
  })

  it('catches a reversal nobody has decided about, but not a fresh one', async () => {
    const base = {
      organizationId: tenant.organizationId,
      propertyId: tenant.propertyId,
      stayId: tenant.stayId,
      guestId: tenant.guestId,
      status: OrderStatus.CONFIRMED,
      currency: 'MXN',
      totalMinor: 0,
      hotelEarningsMinor: 0,
      platformEarningsMinor: 0,
      supplierPayableMinor: 0,
      reversalCause: PaymentReversalCause.REFUND,
      reversalEventId: 'evt_test',
    }

    await prisma.order.create({
      data: { ...base, reference: 'ORD-FRESH', reversalReportedAt: new Date() },
    })

    let report = await checkInvariants()
    expect(report.findings.map((f) => f.key)).not.toContain('commerce.reversal_undecided')

    await prisma.order.create({
      data: {
        ...base,
        reference: 'ORD-STALE',
        reversalEventId: 'evt_test_2',
        reversalReportedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      },
    })

    report = await checkInvariants()
    const finding = report.findings.find((f) => f.key === 'commerce.reversal_undecided')
    expect(finding?.count).toBe(1)
  })

  it('catches a lapsed partner verification', async () => {
    // Verified on a certificate that expired a week ago.
    await markVerified(tenant.supplierId, {
      insuranceExpiresOn: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    })

    const report = await checkInvariants()
    const finding = report.findings.find((f) => f.key === 'partners.verification_lapsed')
    expect(finding?.sample).toContain(tenant.supplierId)
    // Nothing is broken; a claim stopped being current. ARC does not unpublish
    // over it (non-negotiable 6), so it must not page anyone either.
    expect(finding?.severity).toBe('warning')
    expect(hasCritical(report)).toBe(false)
  })

  it('does not report a verification whose insurance is still in force', async () => {
    await markVerified(tenant.supplierId)
    const report = await checkInvariants()
    expect(report.findings.map((f) => f.key)).not.toContain('partners.verification_lapsed')
  })

  it('samples at most five ids, however many rows are affected', async () => {
    const orders = Array.from({ length: 8 }, (_, i) => ({
      organizationId: tenant.organizationId,
      propertyId: tenant.propertyId,
      stayId: tenant.stayId,
      guestId: tenant.guestId,
      reference: `ORD-P${String(i)}`,
      status: OrderStatus.PENDING,
      currency: 'MXN',
      totalMinor: 0,
      hotelEarningsMinor: 0,
      platformEarningsMinor: 0,
      supplierPayableMinor: 0,
    }))
    await prisma.order.createMany({ data: orders })

    const report = await checkInvariants()
    const finding = report.findings.find((f) => f.key === 'commerce.order_pending')
    // A report that pastes ten thousand ids into a log is not a report.
    expect(finding?.sample.length).toBeLessThanOrEqual(5)
  })

  it('carries ids only, never guest data', async () => {
    await markVerified(tenant.supplierId, {
      insuranceExpiresOn: new Date(Date.now() - 1000),
    })

    const guest = await prisma.guest.findUniqueOrThrow({
      where: { id: tenant.guestId },
      select: { email: true, firstName: true },
    })

    const report = await checkInvariants()
    const serialised = JSON.stringify(report)
    // This report goes to a log and possibly to Sentry. An error report is a
    // copy of your database in somebody else's SaaS.
    if (guest.email) expect(serialised).not.toContain(guest.email)
    expect(serialised).not.toContain(guest.firstName)
  })

  it('is read-only, so it is safe to run as often as you like', async () => {
    const before = await prisma.availabilitySlot.findUniqueOrThrow({
      where: { id: tenant.slotId },
      select: { booked: true, held: true, status: true },
    })
    const audits = await prisma.auditEvent.count()

    await checkInvariants()
    await checkInvariants()

    const after = await prisma.availabilitySlot.findUniqueOrThrow({
      where: { id: tenant.slotId },
      select: { booked: true, held: true, status: true },
    })
    expect(after).toEqual(before)
    expect(await prisma.auditEvent.count()).toBe(audits)
  })

  it('uses the actor helper the rest of the suite does, without needing one', async () => {
    // The monitor takes no actor on purpose: it is not a tenant-scoped read and
    // there is nobody to scope it to. Asserted so a future change that adds an
    // actor parameter has to think about what that would mean.
    const owner = await actorFor(tenant.ownerUserId)
    expect(owner.memberships.length).toBeGreaterThan(0)
    expect(checkInvariants.length).toBeLessThanOrEqual(1)
  })
})

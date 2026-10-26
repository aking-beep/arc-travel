/**
 * Does the application actually work against this database?
 *
 * Part of `./scripts/restore-drill.sh`, and runnable on its own against any
 * database you have just restored or migrated:
 *
 *   DATABASE_URL="postgresql://…" npx tsx scripts/restore-smoke.ts
 *
 * ## Why this is not the integration suite
 *
 * The restore runbook used to say to point `TEST_DATABASE_URL` at the restored
 * database and run `npm run test:integration`. That advice stopped being true
 * the moment the test harness started building its schema from the migrations
 * (ADR-034): `tests/global-setup.ts` now drops the public schema before the
 * first test runs. Pointed at a restore, the suite destroys the thing it was
 * supposed to be checking and then proves, at length, that the migrations work
 * — which was never in doubt. It also refuses outright, because the harness
 * will not drop a database whose name does not contain "test".
 *
 * So this reads the restored rows through the real module code instead, and
 * takes a real serializable transaction against the restored constraints. It is
 * read-only in effect: the one write it makes is rolled back deliberately.
 */
import 'dotenv/config'
import { applyDatabaseUrl } from '../src/lib/database-url'

applyDatabaseUrl()

import { prisma } from '../src/lib/db'
import { Role } from '../src/lib/prisma-types'
import type { ActorContext } from '../src/modules/tenancy/context'
import { getRevenueAnalytics } from '../src/modules/analytics/reports'
import { getAvailability, inSerializableTransaction } from '../src/modules/inventory/service'
import { summarisePayables } from '../src/modules/commerce/payouts'
import { monthToDate } from '../src/modules/commerce/payouts'

let failures = 0

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
    failures += 1
  }
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirst({
    where: { memberships: { some: { role: Role.OWNER } } },
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

  if (!owner) {
    // Not a failure in itself: a restore of an empty database has no owner. But
    // it means nothing below can run, and saying so beats a row of green ticks.
    console.log('  SKIP  no OWNER user in this database — nothing to read')
    return
  }

  const actor: ActorContext = {
    userId: owner.id,
    email: owner.email,
    name: owner.name,
    isPlatformAdmin: owner.isPlatformAdmin,
    memberships: owner.memberships,
  }

  const propertyId = owner.memberships.find((m) => m.propertyId)?.propertyId
    ?? (await prisma.property.findFirstOrThrow({ select: { id: true } })).id

  /*
   * The revenue report. Chosen because it is the widest read in the product —
   * orders, line items, ledger entries, stays and commission rules in one call
   * — so a table the restore dropped surfaces here rather than in front of an
   * owner.
   */
  const revenue = await getRevenueAnalytics(actor, propertyId)
  check(
    'revenue report reads',
    typeof revenue.totals.grossMinor === 'number',
    `gross ${revenue.totals.grossMinor} ${revenue.currency} minor units across ` +
      `${revenue.totals.orderCount} order(s)`,
  )

  /*
   * The split must reconcile against gross. `order_split_reconciles` enforces
   * this per order in the database; this is the same arithmetic over the whole
   * restored property, which catches a restore that dropped some order rows but
   * not their ledger entries.
   */
  const split =
    revenue.totals.hotelMinor + revenue.totals.supplierMinor + revenue.totals.platformMinor
  check(
    'hotel + supplier + platform reconciles against gross',
    split === revenue.totals.grossMinor,
    `${split} vs ${revenue.totals.grossMinor}`,
  )

  const slots = await prisma.availabilitySlot.findMany({ take: 25, select: { id: true } })
  const availability = await getAvailability(slots.map((s) => s.id))
  check(
    'availability reads',
    availability.size === slots.length,
    `${availability.size} of ${slots.length} slots`,
  )

  const { from, to } = monthToDate()
  const payables = await summarisePayables(actor, { propertyId, from, to })
  check(
    'payables summarise',
    Array.isArray(payables),
    `${payables.length} supplier(s) with activity this month`,
  )

  /*
   * A real serializable transaction against the restored constraints. The
   * capacity invariant lives in a CHECK constraint the restore had to carry
   * (ADR-020), so the only way to know it is enforced is to violate it.
   */
  if (slots.length > 0) {
    const slot = await prisma.availabilitySlot.findFirstOrThrow({
      where: { id: slots[0]!.id },
      select: { id: true, capacity: true, booked: true, held: true },
    })

    console.log(
      '  ....  deliberately oversells one slot; the Prisma error below is the ' +
        'constraint doing its job',
    )

    let rejected = false
    try {
      await inSerializableTransaction(async (tx) => {
        await tx.availabilitySlot.update({
          where: { id: slot.id },
          data: { booked: slot.capacity + 1, held: 0 },
        })
      })
    } catch {
      rejected = true
    }
    check(
      'the capacity CHECK constraint rejects an oversell',
      rejected,
      rejected ? '' : 'THE CONSTRAINT IS MISSING — do not take traffic on this database',
    )

    const after = await prisma.availabilitySlot.findUniqueOrThrow({
      where: { id: slot.id },
      select: { booked: true, held: true },
    })
    check(
      'the rejected write left no trace',
      after.booked === slot.booked && after.held === slot.held,
      `booked ${after.booked}, held ${after.held}`,
    )
  }
}

main()
  .catch((error) => {
    console.error('  FAIL  smoke check threw:', error)
    failures += 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    process.exitCode = failures === 0 ? 0 : 1
  })

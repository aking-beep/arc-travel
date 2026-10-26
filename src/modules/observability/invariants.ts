import { prisma } from '@/lib/db'
import { OrderStatus, PayoutStatus, VerificationStatus } from '@/lib/prisma-types'
import { toDateKey } from '@/lib/dates'
import { verificationStanding } from '@/modules/admin/verification'

/**
 * The invariant monitor.
 *
 * ## What this is for, and what it is not
 *
 * `src/lib/observability.ts` reports *faults* — a request that threw. That is
 * the whole of ARC's monitoring, and it only sees failures loud enough to
 * produce an exception. Everything this product can get wrong in a way that
 * matters is quieter than that:
 *
 *   * A slot whose `booked + held` exceeds `capacity`. A CHECK constraint makes
 *     this unreachable through the application, which is exactly why it must be
 *     watched: if it ever appears, something wrote to the database directly, or
 *     a restore came back without the constraints (ADR-020).
 *   * A counter gone negative. `returnCapacity` throws rather than clamping
 *     (ADR-020) precisely so this surfaces, and nothing was watching for it.
 *   * An order whose three-account split does not reconcile against its gross.
 *     Enforced per order by `order_split_reconciles`; checked here across the
 *     whole table, because the failure a per-row constraint cannot see is rows
 *     that are each individually fine and collectively wrong.
 *   * A payout that does not equal the sum of its lines. A deferred constraint
 *     trigger enforces it; a direct write or a bad restore would not.
 *   * An order sitting in a state nothing should leave it in — `PENDING` after
 *     ADR-026, or `CONFIRMED` with a reported reversal and nobody deciding.
 *   * A partner verification that has lapsed (ADR-036). Not corruption: a
 *     document that expired while nobody was looking, which is the same shape
 *     of problem.
 *
 * None of these throws. None produces a 500. A guest does not notice, an owner
 * does not notice, and the first symptom is a partner asking why their payout
 * is short — which is how the ledger bug in `cancelOrderItem` was found.
 *
 * ## Why it reports rather than repairs
 *
 * Every finding here is either impossible-through-the-application or a decision
 * for a person. Repairing one automatically would mean ARC writing to money or
 * inventory with nobody having decided to, which non-negotiable 6 forbids, and
 * would destroy the evidence of how it happened. `returnCapacity` throwing
 * instead of clamping is the same judgement: the clamp kept the counter tidy
 * while hiding the double-cancellation that caused it.
 */

export type Severity = 'critical' | 'warning'

export interface InvariantFinding {
  /** Stable identifier, suitable for an alert rule. */
  key: string
  severity: Severity
  /** One sentence an on-call person can act on. */
  summary: string
  /** How many rows are affected. */
  count: number
  /**
   * Up to five affected ids, so the finding is investigable without a query.
   *
   * Ids only — never guest names, emails or notes. This report goes into a log
   * and possibly into Sentry, and the rule `recordAudit` follows applies:
   * prefer a reference over the data behind it.
   */
  sample: string[]
}

export interface InvariantReport {
  checkedAt: Date
  findings: InvariantFinding[]
  /** Checks that ran, so a report of nothing is distinguishable from no report. */
  checksRun: number
  healthy: boolean
}

const SAMPLE = 5

/**
 * Runs every invariant check.
 *
 * Read-only, by construction: nothing here writes. Safe to run as often as you
 * like, though each call is a dozen aggregate queries, so every few minutes is
 * the intent rather than every request.
 */
export async function checkInvariants(now = new Date()): Promise<InvariantReport> {
  const findings: InvariantFinding[] = []

  const [
    oversold,
    negativeCounters,
    unreconciledOrders,
    unbalancedPayouts,
    pendingOrders,
    undecidedReversals,
    orphanedLedger,
    doubleClaimedEntries,
  ] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "AvailabilitySlot"
      WHERE booked + held > capacity
      LIMIT ${SAMPLE + 1}
    `,
    prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "AvailabilitySlot"
      WHERE booked < 0 OR held < 0
      LIMIT ${SAMPLE + 1}
    `,
    /*
     * The split must add up to the total. `order_split_reconciles` says so per
     * row; this asks it of every row at once, which is what catches a restore
     * that brought back orders without their corrections.
     *
     * Scoped to CONFIRMED, exactly as the constraint is: an order in another
     * state has not had its split computed, and flagging those would make this
     * check fire on normal data and therefore get ignored.
     */
    prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Order"
      WHERE "status" = ${OrderStatus.CONFIRMED}::"OrderStatus"
        AND "hotelEarningsMinor" + "platformEarningsMinor" + "supplierPayableMinor"
            <> "totalMinor"
      LIMIT ${SAMPLE + 1}
    `,
    prisma.$queryRaw<Array<{ id: string }>>`
      SELECT p.id FROM "Payout" p
      JOIN "PayoutLine" l ON l."payoutId" = p.id
      WHERE p.status <> ${PayoutStatus.CANCELLED}::"PayoutStatus"
      GROUP BY p.id, p."netMinor"
      HAVING sum(l."amountMinor") <> p."netMinor"
      LIMIT ${SAMPLE + 1}
    `,
    /*
     * ADR-026: `checkout()` writes an order only once its payment has
     * succeeded, so there is no window in which one is PENDING. A PENDING order
     * means either a code path that predates that decision or a direct write.
     */
    prisma.order.findMany({
      where: { status: OrderStatus.PENDING },
      select: { id: true },
      take: SAMPLE + 1,
    }),
    /*
     * A reversal was reported at the provider and nobody has decided what to do
     * about it (ADR-033). Not corruption — a queue with nobody looking at it.
     * The money has already gone back; the guest may still be holding a seat.
     */
    prisma.order.findMany({
      where: {
        reversalReportedAt: { not: null, lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
        status: { in: [OrderStatus.CONFIRMED, OrderStatus.PARTIALLY_CANCELLED] },
      },
      select: { id: true },
      take: SAMPLE + 1,
    }),
    prisma.$queryRaw<Array<{ id: string }>>`
      SELECT le.id FROM "LedgerEntry" le
      LEFT JOIN "Order" o ON o.id = le."orderId"
      WHERE le."orderId" IS NOT NULL AND o.id IS NULL
      LIMIT ${SAMPLE + 1}
    `,
    /*
     * `PayoutLine.ledgerEntryId` is unique, so "paid twice" is unreachable
     * through the database. Watched anyway: that uniqueness is the single thing
     * standing between a partner and a double payment, and a restore that
     * dropped the index would not announce itself.
     */
    prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "ledgerEntryId" AS id FROM "PayoutLine"
      GROUP BY "ledgerEntryId"
      HAVING count(*) > 1
      LIMIT ${SAMPLE + 1}
    `,
  ])

  const add = (
    key: string,
    severity: Severity,
    rows: Array<{ id: string }>,
    summary: (count: number) => string,
  ): void => {
    if (rows.length === 0) return
    findings.push({
      key,
      severity,
      count: rows.length,
      summary: summary(rows.length),
      sample: rows.slice(0, SAMPLE).map((r) => r.id),
    })
  }

  add(
    'inventory.oversold',
    'critical',
    oversold,
    (n) =>
      `${String(n)} availability slot(s) have booked + held above capacity. A CHECK constraint ` +
      'makes this unreachable through the application, so either something wrote to the ' +
      'database directly or this database is missing its constraints — see ADR-020 and ' +
      '`npm run db:constraints`.',
  )

  add(
    'inventory.negative_counter',
    'critical',
    negativeCounters,
    (n) =>
      `${String(n)} slot(s) have a negative booked or held counter. Capacity was returned more ` +
      'times than it was taken; `returnCapacity` throws rather than clamping precisely so this ' +
      'is visible (ADR-020). Find the double cancellation before correcting the number.',
  )

  add(
    'money.order_split_unreconciled',
    'critical',
    unreconciledOrders,
    (n) =>
      `${String(n)} confirmed order(s) have a hotel/platform/supplier split that does not add ` +
      'up to their total. Somebody is owed the difference. Do not adjust the split to match — ' +
      'find which of the four numbers is wrong.',
  )

  add(
    'money.payout_unbalanced',
    'critical',
    unbalancedPayouts,
    (n) =>
      `${String(n)} payout(s) do not equal the sum of their lines. Do not pay them. A deferred ` +
      'constraint trigger enforces this, so its absence means a direct write or a restore ' +
      'without the constraints.',
  )

  add(
    'money.entry_claimed_twice',
    'critical',
    doubleClaimedEntries,
    (n) =>
      `${String(n)} ledger entr(y/ies) appear on more than one payout — a partner may be paid ` +
      'twice. `PayoutLine.ledgerEntryId` is unique, so this requires that index to be missing.',
  )

  add(
    'money.orphaned_ledger_entry',
    'warning',
    orphanedLedger,
    (n) =>
      `${String(n)} ledger entr(y/ies) reference an order that no longer exists. Most likely a ` +
      'partial restore. The ledger no longer reconstructs from the orders.',
  )

  add(
    'commerce.order_pending',
    'warning',
    pendingOrders,
    (n) =>
      `${String(n)} order(s) are PENDING. There should be none: checkout writes an order only ` +
      'after its payment succeeded (ADR-026). Each one is capacity held against a payment ' +
      'nobody can account for.',
  )

  add(
    'commerce.reversal_undecided',
    'warning',
    undecidedReversals,
    (n) =>
      `${String(n)} order(s) have had a refund or chargeback reported at the provider more than ` +
      'a day ago and still await a decision on /owner/approvals (ADR-033). The money has gone ' +
      'back; the guest may still hold the seat.',
  )

  /*
   * Lapsed verifications. Done in code rather than SQL because
   * `verificationStanding` is the one definition of "lapsed" and duplicating it
   * as a WHERE clause is how the two would come to disagree.
   *
   * A warning, not critical: nothing is broken, a claim has merely stopped
   * being current, and ARC deliberately does not unpublish anything over it
   * (non-negotiable 6).
   */
  const verifiedSuppliers = await prisma.supplier.findMany({
    where: { verification: VerificationStatus.VERIFIED },
    select: { id: true, verification: true, verifiedChecks: true, insuranceExpiresOn: true },
  })
  const lapsed = verifiedSuppliers.filter(
    (s) => verificationStanding(s, now).standing === 'lapsed',
  )
  add(
    'partners.verification_lapsed',
    'warning',
    lapsed,
    (n) =>
      `${String(n)} verified partner(s) have a lapsed verification — in most cases the insurance ` +
      'certificate on file has expired. Guests no longer see a verified badge. Get the renewal ' +
      `(see docs/supplier-verification.md). Checked against ${toDateKey(now)}.`,
  )

  const checksRun = 9

  return {
    checkedAt: now,
    findings,
    checksRun,
    healthy: findings.length === 0,
  }
}

/** True when any finding would wake somebody. */
export const hasCritical = (report: InvariantReport): boolean =>
  report.findings.some((f) => f.severity === 'critical')

import { prisma, type Prisma } from '@/lib/db'
import { conflict, invalid, notFound } from '@/lib/errors'
import { toDateKey, fromDateKey, type DateKey } from '@/lib/dates'
import { reference as readableReference } from '@/lib/ids'
import {
  OrderItemStatus,
  PayoutStatus,
  ProposalKind,
  ProposalStatus,
  Role,
} from '@/lib/prisma-types'
import { assertPropertyAccess, assertSupplierAccess, type ActorContext } from '@/modules/tenancy/context'
import { recordAudit } from '@/modules/workflows/audit'

/**
 * Paying suppliers.
 *
 * The gap this closes: ARC recorded, down to the centavo, what each supplier
 * was owed — `LedgerEntry` rows on the `supplier_payable` account, written in
 * the same transaction as the order — and had no mechanism for discharging any
 * of it. A ledger of obligations with no settlement path is a list of people
 * who have not been paid.
 *
 * ## ARC does not move the money, and this is not a limitation to route around
 *
 * There is no provider transfer here. Paying a supplier automatically means
 * each one is a connected account at a payment provider, which means KYC on
 * every small Oaxacan operator before they can be paid at all — a commercial
 * and legal process, not code. For a pilot with six suppliers in one town, the
 * money moves by bank transfer or in cash, and what ARC owes the hotel is an
 * accurate number, a remittance advice, and a record of who authorised it.
 *
 * So what this module guarantees is narrower than "payouts work" and is stated
 * exactly:
 *
 *   1. **The amount is derived, not recomputed.** A run reads `LedgerEntry`
 *      rows. `/partner/earnings` reads the same rows. The two cannot disagree,
 *      which they would if a payout recomputed the split from orders.
 *   2. **Nothing is paid twice.** Each line claims one ledger entry, and
 *      `PayoutLine.ledgerEntryId` is unique. Two concurrent runs cannot both
 *      claim an entry: the second violates the index and loses. The guarantee
 *      is the database's, as ADR-020 argues it must be.
 *   3. **A person authorised it.** `SETTLED` requires an approved `Proposal` of
 *      kind `SUPPLIER_PAYOUT`, which carries an `Approval` row naming the user
 *      (non-negotiable 6). There is no path from "computed" to "paid" that does
 *      not pass through a named decision.
 *   4. **A reversal reduces the next payout.** Refunds and failed payments
 *      write negative `supplier_payable` entries. They are included as the
 *      negative lines they are. A period whose net is zero or less produces no
 *      payout and leaves its entries unclaimed, so they offset the run after —
 *      rather than being written off, which is what omitting them would do.
 *
 * ## What is excluded, and why
 *
 * An entry is not payable while any of these is true of the order item behind
 * it:
 *
 *   * **The supplier has not confirmed it.** `requiresManualConfirmation` is
 *     true on every agreement in this build; an unconfirmed line is one the
 *     supplier has not agreed to deliver.
 *   * **The order's payment has been reported reversed.** A refund or
 *     chargeback at the provider means ARC may not be holding the money it is
 *     about to pay out. The order is not cancelled by that report — that needs
 *     an approval (ADR-033) — but it is certainly not paid out on.
 *   * **The order is not CONFIRMED or PARTIALLY_CANCELLED.** A `FAILED` order's
 *     entries are already reversed; paying out on the pair would net to zero
 *     by luck rather than by rule.
 *
 * See ADR-032.
 */

/** The ledger account a payout discharges. */
export const SUPPLIER_PAYABLE = 'supplier_payable'

export interface PayableLine {
  ledgerEntryId: string
  orderId: string
  orderItemId: string | null
  amountMinor: number
  currency: string
  description: string
  createdAt: Date
}

export interface PayableSummary {
  supplierId: string
  supplierName: string
  currency: string
  netMinor: number
  lines: PayableLine[]
  /**
   * Entries excluded from this run, with the reason.
   *
   * Surfaced rather than silently dropped: "we owe you 40,000 and are paying
   * you 31,000" needs the other 9,000 accounted for, or the supplier assumes
   * ARC has lost it.
   */
  withheld: Array<{ ledgerEntryId: string; amountMinor: number; reason: string }>
}

/**
 * What is owed to each supplier for a window, and what is being held back.
 *
 * Read-only. Claims nothing, so it is safe to render on a page and safe to run
 * repeatedly.
 */
export async function summarisePayables(
  actor: ActorContext,
  options: { propertyId: string; from: DateKey; to: DateKey },
): Promise<PayableSummary[]> {
  const { organizationId } = await assertPropertyAccess(
    actor,
    options.propertyId,
    Role.OWNER,
    Role.ADMIN,
  )

  if (options.from > options.to) {
    throw invalid('The period ends before it starts.')
  }

  /*
   * One query for the whole window, then partitioned in memory.
   *
   * The alternative — a query per supplier — gets the same answer and makes
   * the "is this entry already claimed" check racy per supplier rather than
   * per run. The volume here is a pilot hotel's quarter, not a warehouse.
   */
  const entries = await prisma.ledgerEntry.findMany({
    where: {
      organizationId,
      account: SUPPLIER_PAYABLE,
      createdAt: {
        gte: fromDateKey(options.from),
        // Exclusive upper bound on the day *after* `to`, because `createdAt`
        // is an instant and `to` is a calendar day. `lte: fromDateKey(to)`
        // would silently exclude everything written after midnight on the
        // last day of the period.
        lt: dayAfter(options.to),
      },
      // Never a second time. This is belt to the unique index's braces: the
      // index is what makes it correct under concurrency, and this is what
      // makes the common case not have to find out.
      payoutLine: null,
      order: { propertyId: options.propertyId },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      orderId: true,
      orderItemId: true,
      amountMinor: true,
      currency: true,
      memo: true,
      createdAt: true,
      order: {
        select: {
          status: true,
          reversalReportedAt: true,
          reference: true,
        },
      },
    },
  })

  const itemIds = entries.map((entry) => entry.orderItemId).filter((id): id is string => id !== null)
  const items = await prisma.orderItem.findMany({
    where: { id: { in: itemIds } },
    select: {
      id: true,
      supplierId: true,
      status: true,
      supplierConfirmedAt: true,
      experience: { select: { titleEn: true } },
    },
  })
  const itemsById = new Map(items.map((item) => [item.id, item]))

  // `OrderItem` carries `supplierId` but no relation to it, so the names come
  // in one query rather than a join.
  const suppliers = await prisma.supplier.findMany({
    where: { id: { in: [...new Set(items.map((item) => item.supplierId))] } },
    select: { id: true, name: true },
  })
  const supplierNames = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]))

  const bySupplier = new Map<string, PayableSummary>()
  const summaryFor = (supplierId: string, supplierName: string, currency: string) => {
    const existing = bySupplier.get(supplierId)
    if (existing) return existing
    const created: PayableSummary = {
      supplierId,
      supplierName,
      currency,
      netMinor: 0,
      lines: [],
      withheld: [],
    }
    bySupplier.set(supplierId, created)
    return created
  }

  for (const entry of entries) {
    const item = entry.orderItemId ? itemsById.get(entry.orderItemId) : undefined

    if (!item) {
      /*
       * An entry with no order item cannot be attributed to a supplier.
       *
       * There are none today — every `supplier_payable` row is written per
       * line — but the column is nullable, and guessing a supplier for an
       * unattributed amount is how somebody else's money gets paid to the
       * wrong person.
       */
      continue
    }

    const summary = summaryFor(
      item.supplierId,
      supplierNames.get(item.supplierId) ?? item.supplierId,
      entry.currency,
    )
    const reason = withholdReason({
      orderStatus: entry.order.status,
      reversalReportedAt: entry.order.reversalReportedAt,
      itemStatus: item.status,
      supplierConfirmedAt: item.supplierConfirmedAt,
      amountMinor: entry.amountMinor,
    })

    if (reason) {
      summary.withheld.push({
        ledgerEntryId: entry.id,
        amountMinor: entry.amountMinor,
        reason,
      })
      continue
    }

    summary.lines.push({
      ledgerEntryId: entry.id,
      orderId: entry.orderId,
      orderItemId: entry.orderItemId,
      amountMinor: entry.amountMinor,
      currency: entry.currency,
      description: `${entry.order.reference} · ${item.experience.titleEn}`,
      createdAt: entry.createdAt,
    })
    summary.netMinor += entry.amountMinor
  }

  return [...bySupplier.values()].sort((a, b) => b.netMinor - a.netMinor)
}

/**
 * Why this entry is not being paid out, or null if it is payable.
 *
 * A negative entry is *always* payable, whatever the state of the order behind
 * it. Withholding a reversal would mean ARC paid out the sale and kept the
 * refund, which is the one asymmetry this function exists to prevent — a
 * cancelled line's positive entry is excluded by the status check and its
 * negative counterpart is not, so the pair nets correctly.
 */
function withholdReason(input: {
  orderStatus: string
  reversalReportedAt: Date | null
  itemStatus: OrderItemStatus
  supplierConfirmedAt: Date | null
  amountMinor: number
}): string | null {
  if (input.amountMinor < 0) return null

  if (input.reversalReportedAt) {
    return 'The guest’s payment has been reported refunded or disputed at the provider.'
  }
  if (input.orderStatus !== 'CONFIRMED' && input.orderStatus !== 'PARTIALLY_CANCELLED') {
    return `The order is ${input.orderStatus.toLowerCase().replace(/_/g, ' ')}.`
  }
  if (input.itemStatus !== OrderItemStatus.CONFIRMED) {
    return `The booking is ${input.itemStatus.toLowerCase()}.`
  }
  if (!input.supplierConfirmedAt) {
    return 'The partner has not confirmed this booking yet.'
  }
  return null
}

const dayAfter = (day: DateKey): Date => {
  const date = fromDateKey(day)
  return new Date(date.getTime() + 24 * 60 * 60 * 1000)
}

export interface PayoutRunResult {
  created: Array<{ payoutId: string; reference: string; supplierId: string; netMinor: number }>
  /** Suppliers whose net was zero or negative, and why nothing was created. */
  skipped: Array<{ supplierId: string; netMinor: number; reason: string }>
}

/**
 * Computes payouts for a window and claims their ledger entries.
 *
 * Creates `DRAFT` rows and a `SUPPLIER_PAYOUT` proposal for each. Nothing is
 * payable until an owner approves that proposal, and nothing is paid until
 * somebody records a settlement — this call moves no money and makes no claim
 * that it has.
 *
 * Claiming here rather than at approval is deliberate. The amount the owner
 * approves has to be the amount that was computed, and if the entries were
 * still floating free a second run — or a refund landing in between — would
 * change the total under the approval. A cancelled payout releases its lines.
 */
export async function runPayouts(
  actor: ActorContext,
  options: { propertyId: string; from: DateKey; to: DateKey; note?: string },
): Promise<PayoutRunResult> {
  const { organizationId } = await assertPropertyAccess(
    actor,
    options.propertyId,
    Role.OWNER,
    Role.ADMIN,
  )

  const summaries = await summarisePayables(actor, options)

  const created: PayoutRunResult['created'] = []
  const skipped: PayoutRunResult['skipped'] = []

  for (const summary of summaries) {
    if (summary.lines.length === 0) {
      skipped.push({
        supplierId: summary.supplierId,
        netMinor: 0,
        reason: 'Nothing payable in this period.',
      })
      continue
    }

    if (summary.netMinor <= 0) {
      /*
       * A net of zero or less is not a payout of zero.
       *
       * The entries stay unclaimed so the next run picks them up and they
       * offset whatever it finds. Creating a zero or negative payout would
       * either produce a remittance advice for no money, or imply ARC is
       * invoicing a supplier — neither of which is a thing this product does.
       */
      skipped.push({
        supplierId: summary.supplierId,
        netMinor: summary.netMinor,
        reason:
          summary.netMinor === 0
            ? 'Sales and reversals cancelled out. The entries stay open for the next run.'
            : 'Reversals exceed sales for this period. The balance carries to the next run.',
      })
      continue
    }

    const payout = await prisma.$transaction(async (tx) => {
      const payoutReference = readableReference('PO')

      const row = await tx.payout.create({
        data: {
          organizationId,
          propertyId: options.propertyId,
          supplierId: summary.supplierId,
          reference: payoutReference,
          periodStart: fromDateKey(options.from),
          periodEnd: fromDateKey(options.to),
          currency: summary.currency,
          netMinor: summary.netMinor,
          status: PayoutStatus.DRAFT,
          note: options.note ?? null,
        },
        select: { id: true, reference: true },
      })

      /*
       * The claim.
       *
       * `createMany` rather than a loop so the unique index on
       * `ledgerEntryId` decides the whole batch atomically: if any entry has
       * been claimed by a concurrent run, this throws and the payout rolls
       * back with it, rather than half-claiming and leaving a payout whose
       * total does not match its lines.
       */
      await tx.payoutLine.createMany({
        data: summary.lines.map((line) => ({
          organizationId,
          payoutId: row.id,
          ledgerEntryId: line.ledgerEntryId,
          orderId: line.orderId,
          orderItemId: line.orderItemId,
          amountMinor: line.amountMinor,
          currency: line.currency,
          description: line.description,
        })),
      })

      const proposal = await tx.proposal.create({
        data: {
          organizationId,
          propertyId: options.propertyId,
          kind: ProposalKind.SUPPLIER_PAYOUT,
          status: ProposalStatus.PENDING_APPROVAL,
          title: `Pay ${summary.supplierName} · ${payoutReference}`,
          summary:
            `${summary.lines.length} confirmed ${summary.lines.length === 1 ? 'booking' : 'bookings'} ` +
            `between ${options.from} and ${options.to}. Approving records that you authorised this ` +
            `payment; it does not send any money — ARC has no way to. Pay it by transfer and then ` +
            `record the reference against ${payoutReference}.`,
          actionJson: {
            type: 'settle_supplier_payout',
            payoutId: row.id,
          } as unknown as Prisma.InputJsonValue,
          evidenceJson: {
            supplierId: summary.supplierId,
            lineCount: summary.lines.length,
            netMinor: summary.netMinor,
            currency: summary.currency,
            withheldCount: summary.withheld.length,
            withheldMinor: summary.withheld.reduce((n, w) => n + w.amountMinor, 0),
          } as Prisma.InputJsonValue,
          /*
           * Zero, and not the payout's own total.
           *
           * `potentialValueMinor` is upside the owner might capture (ADR-007).
           * Money leaving the business is not upside, and putting it in that
           * field would make it sum with upside on `/owner/approvals` — the
           * exact addition ADR-007 exists to prevent.
           */
          potentialValueMinor: 0,
          currency: summary.currency,
        },
        select: { id: true },
      })

      await tx.payout.update({
        where: { id: row.id },
        data: { proposalId: proposal.id },
      })

      await recordAudit(
        {
          organizationId,
          actor,
          action: 'commerce.payout.computed',
          entityType: 'Payout',
          entityId: row.id,
          metadata: {
            supplierId: summary.supplierId,
            reference: row.reference,
            netMinor: summary.netMinor,
            lineCount: summary.lines.length,
            periodStart: options.from,
            periodEnd: options.to,
            proposalId: proposal.id,
          },
        },
        tx,
      )

      return row
    })

    created.push({
      payoutId: payout.id,
      reference: payout.reference,
      supplierId: summary.supplierId,
      netMinor: summary.netMinor,
    })
  }

  return { created, skipped }
}

/**
 * Marks an approved payout as paid, with the reference of the actual payment.
 *
 * The only state change that asserts money has moved, and the assertion is a
 * person's: `settlementReference` is what they typed in after making the
 * transfer. ARC has no way to verify it and does not pretend to — what it can
 * guarantee is that the payout was approved first, that it is settled once, and
 * that the record names who said so.
 */
export async function settlePayout(
  actor: ActorContext,
  options: {
    payoutId: string
    settlementReference: string
    settlementMethod: string
    now?: Date
  },
): Promise<{ payoutId: string; reference: string; netMinor: number }> {
  const now = options.now ?? new Date()

  const reference = options.settlementReference.trim()
  const method = options.settlementMethod.trim()
  if (!reference) throw invalid('Record the reference of the payment you made.')
  if (!method) throw invalid('Record how the payment was made.')

  const payout = await prisma.payout.findUnique({
    where: { id: options.payoutId },
    select: {
      id: true,
      propertyId: true,
      reference: true,
      status: true,
      netMinor: true,
      supplierId: true,
      proposal: { select: { id: true, status: true } },
    },
  })
  if (!payout) throw notFound('Payout')

  const { organizationId } = await assertPropertyAccess(
    actor,
    payout.propertyId,
    Role.OWNER,
    Role.ADMIN,
  )

  if (payout.status === PayoutStatus.SETTLED) {
    throw conflict('That payout has already been recorded as paid.')
  }
  if (payout.status === PayoutStatus.CANCELLED) {
    throw conflict('That payout was cancelled.')
  }

  /*
   * The approval gate, read at the moment of settlement rather than trusted
   * from the payout's own status.
   *
   * `Payout.status` is ARC's bookkeeping; the authority for "a person
   * authorised this" is the proposal's approval. Checking the proposal means a
   * payout whose status was advanced by some other path still cannot be
   * settled without one.
   */
  if (!payout.proposal || payout.proposal.status !== ProposalStatus.APPROVED) {
    throw conflict(
      'That payout has not been approved yet. An owner has to approve it before it can be paid.',
    )
  }

  const updated = await prisma.$transaction(async (tx) => {
    /*
     * Re-read inside the transaction and guard on what we will write.
     *
     * Two owners pressing the same button is the ordinary case, not the
     * exotic one, and the consequence of losing that race is a payout recorded
     * as paid twice with two different references.
     */
    const current = await tx.payout.updateMany({
      where: { id: payout.id, status: PayoutStatus.APPROVED },
      data: {
        status: PayoutStatus.SETTLED,
        settlementReference: reference,
        settlementMethod: method,
        settledAt: now,
        settledById: actor.userId,
      },
    })
    if (current.count === 0) {
      throw conflict('That payout has already been recorded as paid.')
    }

    await recordAudit(
      {
        organizationId,
        actor,
        action: 'commerce.payout.settled',
        entityType: 'Payout',
        entityId: payout.id,
        metadata: {
          reference: payout.reference,
          supplierId: payout.supplierId,
          netMinor: payout.netMinor,
          // The method, and the *name* of the reference field rather than its
          // value: a settlement reference identifies a bank transfer.
          settlementMethod: method,
          settlementReference: 'recorded',
          proposalId: payout.proposal?.id ?? null,
        },
      },
      tx,
    )

    return payout
  })

  return {
    payoutId: updated.id,
    reference: updated.reference,
    netMinor: updated.netMinor,
  }
}

/**
 * Abandons a payout and releases its ledger entries.
 *
 * `onDelete: Cascade` on `PayoutLine.payoutId` means deleting the lines is what
 * frees the entries for the next run. The payout row itself is kept, cancelled:
 * a computed obligation that somebody decided against is a thing an auditor
 * should be able to see.
 */
export async function cancelPayout(
  actor: ActorContext,
  options: { payoutId: string; reason: string; now?: Date },
): Promise<{ payoutId: string; releasedLines: number }> {
  const now = options.now ?? new Date()

  const payout = await prisma.payout.findUnique({
    where: { id: options.payoutId },
    select: {
      id: true,
      propertyId: true,
      reference: true,
      status: true,
      netMinor: true,
      proposalId: true,
      _count: { select: { lines: true } },
    },
  })
  if (!payout) throw notFound('Payout')

  const { organizationId } = await assertPropertyAccess(
    actor,
    payout.propertyId,
    Role.OWNER,
    Role.ADMIN,
  )

  if (payout.status === PayoutStatus.SETTLED) {
    // The money has gone. Cancelling the record would release entries that
    // were genuinely paid, so the next run would pay them again.
    throw conflict(
      'That payout has been paid. Cancelling it would release entries that were already settled — ' +
        'record a correcting entry instead.',
    )
  }
  if (payout.status === PayoutStatus.CANCELLED) {
    throw conflict('That payout was already cancelled.')
  }

  const releasedLines = await prisma.$transaction(async (tx) => {
    const guard = await tx.payout.updateMany({
      where: { id: payout.id, status: { in: [PayoutStatus.DRAFT, PayoutStatus.APPROVED] } },
      data: { status: PayoutStatus.CANCELLED, cancelledAt: now, note: options.reason },
    })
    if (guard.count === 0) throw conflict('That payout is no longer cancellable.')

    const deleted = await tx.payoutLine.deleteMany({ where: { payoutId: payout.id } })

    if (payout.proposalId) {
      // The proposal goes with it. Leaving a PENDING_APPROVAL proposal for a
      // cancelled payout puts a decision in the owner's queue that can no
      // longer be made.
      await tx.proposal.updateMany({
        where: { id: payout.proposalId, status: ProposalStatus.PENDING_APPROVAL },
        data: { status: ProposalStatus.EXPIRED },
      })
    }

    await recordAudit(
      {
        organizationId,
        actor,
        action: 'commerce.payout.cancelled',
        entityType: 'Payout',
        entityId: payout.id,
        metadata: {
          reference: payout.reference,
          netMinor: payout.netMinor,
          releasedLines: deleted.count,
          reason: options.reason,
        },
      },
      tx,
    )

    return deleted.count
  })

  return { payoutId: payout.id, releasedLines }
}

/** A payout and its lines, for a remittance advice. */
export async function getPayout(actor: ActorContext, payoutId: string) {
  const payout = await prisma.payout.findUnique({
    where: { id: payoutId },
    include: {
      supplier: { select: { id: true, name: true, contactEmail: true } },
      property: { select: { name: true } },
      settledBy: { select: { name: true, email: true } },
      lines: { orderBy: { createdAt: 'asc' } },
      proposal: {
        select: {
          id: true,
          status: true,
          approvals: {
            orderBy: { decidedAt: 'desc' },
            select: {
              decision: true,
              decidedAt: true,
              note: true,
              decidedBy: { select: { name: true, email: true } },
            },
          },
        },
      },
    },
  })
  if (!payout) throw notFound('Payout')

  await assertPropertyAccess(actor, payout.propertyId, Role.OWNER, Role.ADMIN)
  return payout
}

/** Payouts for one property, newest first. */
export async function listPayouts(
  actor: ActorContext,
  options: { propertyId: string; status?: PayoutStatus[] },
) {
  await assertPropertyAccess(actor, options.propertyId, Role.OWNER, Role.ADMIN)

  return prisma.payout.findMany({
    where: {
      propertyId: options.propertyId,
      ...(options.status ? { status: { in: options.status } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: {
      supplier: { select: { id: true, name: true } },
      _count: { select: { lines: true } },
    },
  })
}

/**
 * A supplier's own view of what it has been paid and what is outstanding.
 *
 * Scoped by `assertSupplierAccess`, so a partner sees its own payouts and
 * nobody else's. The outstanding figure deliberately includes nothing about
 * *when* it will be paid: ARC does not control that and should not imply it
 * does.
 */
export async function getSupplierPayouts(actor: ActorContext, supplierId: string) {
  const { organizationId } = await assertSupplierAccess(actor, supplierId)

  const [payouts, unclaimed] = await Promise.all([
    prisma.payout.findMany({
      where: { supplierId, organizationId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        reference: true,
        status: true,
        netMinor: true,
        currency: true,
        periodStart: true,
        periodEnd: true,
        settledAt: true,
        settlementMethod: true,
        _count: { select: { lines: true } },
      },
    }),
    prisma.ledgerEntry.aggregate({
      where: {
        organizationId,
        account: SUPPLIER_PAYABLE,
        payoutLine: null,
        orderItem: { supplierId },
      },
      _sum: { amountMinor: true },
      _count: true,
    }),
  ])

  return {
    payouts,
    unclaimed: {
      /*
       * Everything not yet on a payout, including amounts being withheld.
       *
       * Not the same number as the next payout: a line the supplier has not
       * confirmed is in here and will not be in that. Calling it "unclaimed"
       * rather than "due" is the honest word for it.
       */
      amountMinor: unclaimed._sum.amountMinor ?? 0,
      entryCount: unclaimed._count,
    },
  }
}

/** Convenience for a default run window: the calendar month up to today. */
export function monthToDate(now = new Date()): { from: DateKey; to: DateKey } {
  const to = toDateKey(now)
  return { from: `${to.slice(0, 7)}-01` as DateKey, to }
}

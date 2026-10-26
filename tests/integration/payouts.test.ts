import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { toDateKey, type DateKey } from '@/lib/dates'
import { ApprovalDecision, OrderItemStatus, PayoutStatus, ProposalKind, ProposalStatus } from '@/lib/prisma-types'
import { addToCart, getOrCreateCart } from '@/modules/commerce/cart'
import { cancelOrderItem, checkout, confirmOrderItemBySupplier } from '@/modules/commerce/checkout'
import {
  cancelPayout,
  getSupplierPayouts,
  runPayouts,
  settlePayout,
  summarisePayables,
  SUPPLIER_PAYABLE,
} from '@/modules/commerce/payouts'
import { decideProposal } from '@/modules/workflows/proposals'
import { actorFor, createTenant, resetDatabase, type TenantFixture } from '../helpers/factory'

/**
 * Paying suppliers.
 *
 * The invariant every test here circles is the one that costs real money to
 * get wrong: **a ledger entry is paid at most once**. Everything else — the
 * approval gate, the withholding rules, the carry-forward of a negative
 * balance — exists so that the amount reaching a partner is the amount they
 * are owed, and no part of it twice.
 */
let tenant: TenantFixture
let today: DateKey

/** A confirmed, supplier-confirmed order, which is the only payable kind. */
async function payableOrder(options: { quantity: number } = { quantity: 2 }) {
  const cartId = await getOrCreateCart({
    organizationId: tenant.organizationId,
    propertyId: tenant.propertyId,
    guestId: tenant.guestId,
    stayId: tenant.stayId,
    currency: 'MXN',
  })
  await addToCart({ cartId, slotId: tenant.slotId, quantity: options.quantity })
  const order = await checkout({
    cartId,
    guestId: tenant.guestId,
    idempotencyKey: randomUUID(),
  })

  const items = await prisma.orderItem.findMany({
    where: { orderId: order.orderId },
    select: { id: true },
  })
  for (const item of items) {
    await confirmOrderItemBySupplier({ orderItemId: item.id, supplierId: tenant.supplierId })
  }

  return { ...order, itemIds: items.map((item) => item.id) }
}

const period = () => ({ from: '2000-01-01' as DateKey, to: today })

beforeEach(async () => {
  await resetDatabase()
  tenant = await createTenant({ capacity: 10, priceMinor: 95_000 })
  today = toDateKey(new Date())
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('summarisePayables', () => {
  it('reads the ledger rather than recomputing the split', async () => {
    await payableOrder({ quantity: 2 })
    const actor = await actorFor(tenant.ownerUserId)

    const [summary] = await summarisePayables(actor, {
      propertyId: tenant.propertyId,
      ...period(),
    })

    const ledger = await prisma.ledgerEntry.aggregate({
      where: { organizationId: tenant.organizationId, account: SUPPLIER_PAYABLE },
      _sum: { amountMinor: true },
    })

    /*
     * The whole point of deriving rather than recomputing: this page and
     * `/partner/earnings` read the same rows, so they cannot disagree. A
     * recomputed split would drift the moment a commission rule changed.
     */
    expect(summary?.netMinor).toBe(ledger._sum.amountMinor)
    expect(summary?.lines).toHaveLength(1)
  })

  it('withholds a booking the partner has not confirmed, and says so', async () => {
    const cartId = await getOrCreateCart({
      organizationId: tenant.organizationId,
      propertyId: tenant.propertyId,
      guestId: tenant.guestId,
      stayId: tenant.stayId,
      currency: 'MXN',
    })
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 1 })
    await checkout({ cartId, guestId: tenant.guestId, idempotencyKey: randomUUID() })

    const actor = await actorFor(tenant.ownerUserId)
    const [summary] = await summarisePayables(actor, {
      propertyId: tenant.propertyId,
      ...period(),
    })

    expect(summary?.lines).toHaveLength(0)
    expect(summary?.withheld).toHaveLength(1)
    // Itemised, not summarised: "we owe you 40,000 and are paying 31,000"
    // needs the rest accounted for or the partner assumes it is lost.
    expect(summary?.withheld[0]?.reason).toMatch(/not confirmed/i)
  })

  it('withholds everything on an order whose payment was reported reversed', async () => {
    const order = await payableOrder({ quantity: 2 })
    await prisma.order.update({
      where: { id: order.orderId },
      data: {
        reversalReportedAt: new Date(),
        reversalCause: 'REFUND',
        reversalEventId: 'evt_test',
        reversedMinor: order.totalMinor,
      },
    })

    const actor = await actorFor(tenant.ownerUserId)
    const [summary] = await summarisePayables(actor, {
      propertyId: tenant.propertyId,
      ...period(),
    })

    // ARC may not be holding the money it is about to pay out. The order is
    // not cancelled by the report (that needs an approval), but it is
    // certainly not paid out on.
    expect(summary?.lines).toHaveLength(0)
    expect(summary?.withheld[0]?.reason).toMatch(/refunded or disputed/i)
  })

  it('includes a reversal as a negative line even though the sale is excluded', async () => {
    const order = await payableOrder({ quantity: 2 })
    const ownerActor = await actorFor(tenant.ownerUserId)
    await cancelOrderItem({
      orderItemId: order.itemIds[0] ?? '',
      reason: 'Guest cancelled.',
      authority: { kind: 'operator', actor: ownerActor },
    })

    const [summary] = await summarisePayables(ownerActor, {
      propertyId: tenant.propertyId,
      ...period(),
    })

    /*
     * The asymmetry this is about: the cancelled line's positive entry is
     * excluded by the status check, and its negative counterpart is NOT. Were
     * both excluded the pair would simply vanish; were only the negative
     * excluded, ARC would have paid out the sale and kept the refund.
     */
    const lines = summary?.lines ?? []
    expect(lines.filter((line) => line.amountMinor < 0)).toHaveLength(1)
    expect(summary?.netMinor).toBeLessThan(0)
  })

  it('refuses a period that ends before it starts', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    await expect(
      summarisePayables(actor, {
        propertyId: tenant.propertyId,
        from: '2026-06-01' as DateKey,
        to: '2026-05-01' as DateKey,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('includes entries written today, not just up to midnight on the last day', async () => {
    // `createdAt` is an instant and `to` is a calendar day. An inclusive
    // `lte: fromDateKey(to)` silently excludes everything written after
    // midnight, which is every order of the current day.
    await payableOrder({ quantity: 1 })
    const actor = await actorFor(tenant.ownerUserId)

    const [summary] = await summarisePayables(actor, {
      propertyId: tenant.propertyId,
      from: today,
      to: today,
    })

    expect(summary?.lines).toHaveLength(1)
  })
})

describe('runPayouts', () => {
  it('claims its lines, so a second run finds nothing', async () => {
    await payableOrder({ quantity: 2 })
    const actor = await actorFor(tenant.ownerUserId)

    const first = await runPayouts(actor, { propertyId: tenant.propertyId, ...period() })
    expect(first.created).toHaveLength(1)

    const second = await runPayouts(actor, { propertyId: tenant.propertyId, ...period() })
    // Not "a payout of zero" — nothing at all. A ledger entry can be claimed
    // by exactly one payout, ever.
    expect(second.created).toHaveLength(0)
  })

  it('cannot claim a ledger entry twice, by the database’s rule not the query’s', async () => {
    await payableOrder({ quantity: 2 })
    const actor = await actorFor(tenant.ownerUserId)
    const run = await runPayouts(actor, { propertyId: tenant.propertyId, ...period() })

    const line = await prisma.payoutLine.findFirstOrThrow({
      where: { payoutId: run.created[0]?.payoutId },
    })

    const second = await prisma.payout.create({
      data: {
        organizationId: tenant.organizationId,
        propertyId: tenant.propertyId,
        supplierId: tenant.supplierId,
        reference: 'PO-DUPLICATE',
        periodStart: new Date(),
        periodEnd: new Date(),
        netMinor: line.amountMinor,
        proposalId: null,
      },
      select: { id: true },
    })

    /*
     * The unique index is what makes "nothing is paid twice" correct under
     * concurrency: two runs reading the same unclaimed entry both pass the
     * `payoutLine: null` filter, and the second one loses here.
     */
    await expect(
      prisma.payoutLine.create({
        data: {
          organizationId: tenant.organizationId,
          payoutId: second.id,
          ledgerEntryId: line.ledgerEntryId,
          orderId: line.orderId,
          amountMinor: line.amountMinor,
          description: 'second claim',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('opens an approval and does not mark the payout payable', async () => {
    await payableOrder({ quantity: 2 })
    const actor = await actorFor(tenant.ownerUserId)
    const run = await runPayouts(actor, { propertyId: tenant.propertyId, ...period() })

    const payout = await prisma.payout.findUniqueOrThrow({
      where: { id: run.created[0]?.payoutId },
      include: { proposal: true },
    })

    expect(payout.status).toBe(PayoutStatus.DRAFT)
    expect(payout.proposal?.kind).toBe(ProposalKind.SUPPLIER_PAYOUT)
    expect(payout.proposal?.status).toBe(ProposalStatus.PENDING_APPROVAL)
    /*
     * Money leaving the business is not upside. Putting the payout total in
     * `potentialValueMinor` would make it sum with upside on
     * `/owner/approvals` — the exact addition ADR-007 exists to prevent.
     */
    expect(payout.proposal?.potentialValueMinor).toBe(0)
  })

  it('creates nothing and claims nothing when reversals exceed sales', async () => {
    const order = await payableOrder({ quantity: 1 })
    const ownerActor = await actorFor(tenant.ownerUserId)
    await cancelOrderItem({
      orderItemId: order.itemIds[0] ?? '',
      reason: 'Guest cancelled.',
      authority: { kind: 'operator', actor: ownerActor },
    })

    const run = await runPayouts(ownerActor, { propertyId: tenant.propertyId, ...period() })

    expect(run.created).toHaveLength(0)
    expect(run.skipped[0]?.reason).toMatch(/carries to the next run/i)

    /*
     * And critically, the entries are still unclaimed. A negative balance that
     * got written off here would be ARC absorbing a refund it had already paid
     * out on; leaving it open means the next run nets it off.
     */
    const unclaimed = await prisma.ledgerEntry.count({
      where: { account: SUPPLIER_PAYABLE, payoutLine: null },
    })
    expect(unclaimed).toBeGreaterThan(0)
  })

  it('nets a reversal off the following run', async () => {
    const first = await payableOrder({ quantity: 3 })
    const ownerActor = await actorFor(tenant.ownerUserId)

    // Paid out in full.
    const run = await runPayouts(ownerActor, { propertyId: tenant.propertyId, ...period() })
    const paid = run.created[0]?.netMinor ?? 0
    expect(paid).toBeGreaterThan(0)

    // Then a cancellation, after the payout.
    await cancelOrderItem({
      orderItemId: first.itemIds[0] ?? '',
      reason: 'Guest cancelled after the payout.',
      authority: { kind: 'operator', actor: ownerActor },
    })

    // A second, larger sale.
    await payableOrder({ quantity: 4 })

    const second = await runPayouts(ownerActor, { propertyId: tenant.propertyId, ...period() })
    const secondNet = second.created[0]?.netMinor ?? 0

    // The reversal is a line on the next payout, not a write-off. The
    // supplier's second payment is reduced by what they were overpaid.
    const lines = await prisma.payoutLine.findMany({
      where: { payoutId: second.created[0]?.payoutId },
    })
    expect(lines.some((line) => line.amountMinor < 0)).toBe(true)
    expect(secondNet).toBeLessThan(lines.filter((l) => l.amountMinor > 0).reduce((n, l) => n + l.amountMinor, 0))
  })

  it('records an audit row naming who computed it', async () => {
    await payableOrder({ quantity: 2 })
    const actor = await actorFor(tenant.ownerUserId)
    await runPayouts(actor, { propertyId: tenant.propertyId, ...period() })

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: 'commerce.payout.computed' },
    })
    expect(audit.actorUserId).toBe(tenant.ownerUserId)
    expect(audit.entityType).toBe('Payout')
  })

  it('refuses a run from somebody with no access to the property', async () => {
    const other = await createTenant({ name: 'other-hotel' })
    const outsider = await actorFor(other.ownerUserId)

    await expect(
      runPayouts(outsider, { propertyId: tenant.propertyId, ...period() }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('settlePayout', () => {
  async function approvedPayout() {
    await payableOrder({ quantity: 2 })
    const actor = await actorFor(tenant.ownerUserId)
    const run = await runPayouts(actor, { propertyId: tenant.propertyId, ...period() })
    const payoutId = run.created[0]?.payoutId ?? ''

    const payout = await prisma.payout.findUniqueOrThrow({
      where: { id: payoutId },
      select: { proposalId: true },
    })
    await decideProposal(actor, {
      proposalId: payout.proposalId ?? '',
      decision: ApprovalDecision.APPROVED,
    })

    return { actor, payoutId }
  }

  it('refuses a payout nobody has approved', async () => {
    await payableOrder({ quantity: 2 })
    const actor = await actorFor(tenant.ownerUserId)
    const run = await runPayouts(actor, { propertyId: tenant.propertyId, ...period() })

    // Non-negotiable 6. There is no path from "computed" to "paid" that does
    // not pass through a named decision.
    await expect(
      settlePayout(actor, {
        payoutId: run.created[0]?.payoutId ?? '',
        settlementReference: 'SPEI-1',
        settlementMethod: 'Bank transfer',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('refuses a payout whose status says approved but whose proposal does not', async () => {
    await payableOrder({ quantity: 2 })
    const actor = await actorFor(tenant.ownerUserId)
    const run = await runPayouts(actor, { propertyId: tenant.propertyId, ...period() })
    const payoutId = run.created[0]?.payoutId ?? ''

    // Advance the bookkeeping without the decision.
    await prisma.payout.update({
      where: { id: payoutId },
      data: { status: PayoutStatus.APPROVED },
    })

    /*
     * `Payout.status` is ARC's bookkeeping; the authority for "a person
     * authorised this" is the proposal's approval. Settlement reads the
     * proposal, so a status advanced by any other path still cannot pay.
     */
    await expect(
      settlePayout(actor, {
        payoutId,
        settlementReference: 'SPEI-1',
        settlementMethod: 'Bank transfer',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('records the payment, who recorded it, and refuses a second time', async () => {
    const { actor, payoutId } = await approvedPayout()

    const settled = await settlePayout(actor, {
      payoutId,
      settlementReference: 'SPEI-ABC-123',
      settlementMethod: 'Bank transfer',
    })
    expect(settled.payoutId).toBe(payoutId)

    const row = await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } })
    expect(row.status).toBe(PayoutStatus.SETTLED)
    expect(row.settledById).toBe(tenant.ownerUserId)
    expect(row.settlementReference).toBe('SPEI-ABC-123')

    // Two owners pressing the same button is the ordinary case, and the cost
    // of losing that race is a payout recorded as paid twice.
    await expect(
      settlePayout(actor, {
        payoutId,
        settlementReference: 'SPEI-ABC-124',
        settlementMethod: 'Bank transfer',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('refuses a blank reference or method', async () => {
    const { actor, payoutId } = await approvedPayout()

    for (const bad of [
      { settlementReference: '   ', settlementMethod: 'Bank transfer' },
      { settlementReference: 'SPEI-1', settlementMethod: '' },
    ]) {
      await expect(settlePayout(actor, { payoutId, ...bad })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      })
    }
  })

  it('keeps the settlement reference out of the audit metadata', async () => {
    const { actor, payoutId } = await approvedPayout()
    await settlePayout(actor, {
      payoutId,
      settlementReference: 'SPEI-SECRET-9f2b',
      settlementMethod: 'Bank transfer',
    })

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: 'commerce.payout.settled' },
    })
    // A settlement reference identifies a bank transfer. The field *name*
    // goes in the audit row, as recordAudit's rule requires; the value does
    // not.
    expect(JSON.stringify(audit.metadataJson)).not.toContain('SPEI-SECRET-9f2b')
    expect(JSON.stringify(audit.metadataJson)).toContain('recorded')
  })
})

describe('cancelPayout', () => {
  it('releases its lines so the next run picks them up', async () => {
    await payableOrder({ quantity: 2 })
    const actor = await actorFor(tenant.ownerUserId)
    const run = await runPayouts(actor, { propertyId: tenant.propertyId, ...period() })
    const payoutId = run.created[0]?.payoutId ?? ''

    const cancelled = await cancelPayout(actor, { payoutId, reason: 'Wrong period.' })
    expect(cancelled.releasedLines).toBe(1)

    const again = await runPayouts(actor, { propertyId: tenant.propertyId, ...period() })
    expect(again.created).toHaveLength(1)

    // The cancelled row is kept. A computed obligation somebody decided
    // against is a thing an auditor should be able to see.
    const row = await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } })
    expect(row.status).toBe(PayoutStatus.CANCELLED)
    expect(row.note).toBe('Wrong period.')
  })

  it('expires the proposal, so the owner is not left a decision they cannot make', async () => {
    await payableOrder({ quantity: 2 })
    const actor = await actorFor(tenant.ownerUserId)
    const run = await runPayouts(actor, { propertyId: tenant.propertyId, ...period() })
    const payoutId = run.created[0]?.payoutId ?? ''
    const { proposalId } = await prisma.payout.findUniqueOrThrow({
      where: { id: payoutId },
      select: { proposalId: true },
    })

    await cancelPayout(actor, { payoutId, reason: 'Wrong period.' })

    const proposal = await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId ?? '' } })
    expect(proposal.status).toBe(ProposalStatus.EXPIRED)
  })

  it('refuses to cancel a payout that has been paid', async () => {
    await payableOrder({ quantity: 2 })
    const actor = await actorFor(tenant.ownerUserId)
    const run = await runPayouts(actor, { propertyId: tenant.propertyId, ...period() })
    const payoutId = run.created[0]?.payoutId ?? ''
    const { proposalId } = await prisma.payout.findUniqueOrThrow({
      where: { id: payoutId },
      select: { proposalId: true },
    })
    await decideProposal(actor, {
      proposalId: proposalId ?? '',
      decision: ApprovalDecision.APPROVED,
    })
    await settlePayout(actor, {
      payoutId,
      settlementReference: 'SPEI-1',
      settlementMethod: 'Bank transfer',
    })

    // Cancelling would release entries that were genuinely paid, so the next
    // run would pay them again.
    await expect(
      cancelPayout(actor, { payoutId, reason: 'Changed my mind.' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})

describe('the balance invariant', () => {
  it('refuses a payout whose lines do not sum to its declared total', async () => {
    await payableOrder({ quantity: 2 })
    const actor = await actorFor(tenant.ownerUserId)
    const run = await runPayouts(actor, { propertyId: tenant.propertyId, ...period() })
    const payoutId = run.created[0]?.payoutId ?? ''

    /*
     * A deferred constraint trigger, not a CHECK, because a CHECK cannot read
     * another table. The alternative — trusting the service that writes both
     * numbers — is exactly what ADR-020 argues against for an invariant that
     * matters, and "how much we owe this partner" matters.
     */
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.payoutLine.create({
          data: {
            organizationId: tenant.organizationId,
            payoutId,
            ledgerEntryId: (
              await tx.ledgerEntry.create({
                data: {
                  organizationId: tenant.organizationId,
                  orderId: (await tx.order.findFirstOrThrow({ select: { id: true } })).id,
                  account: SUPPLIER_PAYABLE,
                  amountMinor: 50_000,
                  memo: 'invented',
                },
                select: { id: true },
              })
            ).id,
            orderId: (await tx.order.findFirstOrThrow({ select: { id: true } })).id,
            amountMinor: 50_000,
            description: 'a line nobody accounted for',
          },
        })
      }),
    ).rejects.toThrow(/lines sum to/)
  })

  it('refuses a SETTLED payout with no evidence of the payment', async () => {
    await payableOrder({ quantity: 2 })
    const actor = await actorFor(tenant.ownerUserId)
    const run = await runPayouts(actor, { propertyId: tenant.propertyId, ...period() })

    // "Settled" with no reference is a claim about money with nothing behind
    // it. The service refuses it; so does the database.
    await expect(
      prisma.payout.update({
        where: { id: run.created[0]?.payoutId },
        data: { status: PayoutStatus.SETTLED },
      }),
    ).rejects.toThrow(/payout_settled_is_evidenced/)
  })
})

describe('what a partner sees', () => {
  it('shows its own payouts and its unclaimed balance', async () => {
    await payableOrder({ quantity: 2 })
    const ownerActor = await actorFor(tenant.ownerUserId)
    await runPayouts(ownerActor, { propertyId: tenant.propertyId, ...period() })

    const supplierActor = await actorFor(tenant.supplierUserId)
    const view = await getSupplierPayouts(supplierActor, tenant.supplierId)

    expect(view.payouts).toHaveLength(1)
    // Everything on a payout is claimed, so nothing is left unclaimed.
    expect(view.unclaimed.amountMinor).toBe(0)
  })

  it('will not show one partner another partner’s payouts', async () => {
    const other = await createTenant({ name: 'other-supplier' })
    const outsider = await actorFor(other.supplierUserId)

    await expect(getSupplierPayouts(outsider, tenant.supplierId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })
})

describe('approving a payout', () => {
  it('moves it to APPROVED and says plainly that no money moved', async () => {
    await payableOrder({ quantity: 2 })
    const actor = await actorFor(tenant.ownerUserId)
    const run = await runPayouts(actor, { propertyId: tenant.propertyId, ...period() })
    const { proposalId } = await prisma.payout.findUniqueOrThrow({
      where: { id: run.created[0]?.payoutId },
      select: { proposalId: true },
    })

    const result = await decideProposal(actor, {
      proposalId: proposalId ?? '',
      decision: ApprovalDecision.APPROVED,
    })

    /*
     * `executed: false` on purpose. ARC cannot send money, so an execution
     * that claimed to have paid would be the plainest lie in the codebase —
     * and marking it EXECUTED would take it off the owner's list of things
     * still to do.
     */
    expect(result.execution?.executed).toBe(false)
    expect(result.execution?.summary).toMatch(/No money has moved/i)

    const payout = await prisma.payout.findUniqueOrThrow({
      where: { id: run.created[0]?.payoutId },
    })
    expect(payout.status).toBe(PayoutStatus.APPROVED)
  })

  it('leaves the payout alone when the owner rejects it', async () => {
    await payableOrder({ quantity: 2 })
    const actor = await actorFor(tenant.ownerUserId)
    const run = await runPayouts(actor, { propertyId: tenant.propertyId, ...period() })
    const { proposalId } = await prisma.payout.findUniqueOrThrow({
      where: { id: run.created[0]?.payoutId },
      select: { proposalId: true },
    })

    await decideProposal(actor, {
      proposalId: proposalId ?? '',
      decision: ApprovalDecision.REJECTED,
    })

    const payout = await prisma.payout.findUniqueOrThrow({
      where: { id: run.created[0]?.payoutId },
    })
    expect(payout.status).toBe(PayoutStatus.DRAFT)
    expect(
      await prisma.orderItem.count({ where: { status: OrderItemStatus.CONFIRMED } }),
    ).toBeGreaterThan(0)
  })
})

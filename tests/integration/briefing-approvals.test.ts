import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { isAppError } from '@/lib/errors'
import {
  ApprovalDecision,
  ExperienceStatus,
  ProposalKind,
  ProposalStatus,
  Role,
  StayStatus,
} from '@/lib/prisma-types'
import { buildMorningBriefing } from '@/modules/operator/briefing'
import { createProposal, decideProposal, expireStaleProposals } from '@/modules/workflows/proposals'
import { addToCart, getOrCreateCart } from '@/modules/commerce/cart'
import { checkout } from '@/modules/commerce/checkout'
import { getRevenueAnalytics } from '@/modules/analytics/reports'
import { resetRateLimits } from '@/modules/ai/service'
import { toDateKey } from '@/lib/dates'
import { actorFor, createTenant, resetDatabase, type TenantFixture } from '../helpers/factory'

/**
 * Morning briefing and the approval workflow.
 *
 * The two claims under test: every figure in the briefing is derived from
 * stored rows (and earned is never conflated with potential), and nothing
 * executes without a recorded human approval.
 */
let tenant: TenantFixture

beforeEach(async () => {
  await resetDatabase()
  resetRateLimits()
  tenant = await createTenant({ capacity: 6, priceMinor: 95_000 })
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function buyOne(t: TenantFixture, quantity = 2) {
  const cartId = await getOrCreateCart({
    organizationId: t.organizationId,
    propertyId: t.propertyId,
    guestId: t.guestId,
    stayId: t.stayId,
    currency: 'MXN',
  })
  await addToCart({ cartId, slotId: t.slotId, quantity })
  return checkout({ cartId, guestId: t.guestId, idempotencyKey: randomUUID() })
}

describe('morning briefing', () => {
  it('derives every figure from stored rows and says how', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    const briefing = await buildMorningBriefing(actor, tenant.propertyId, { withNarrative: false })

    expect(briefing.propertyId).toBe(tenant.propertyId)
    expect(briefing.earned.allTimeMinor.derivation).toMatch(/confirmed orders/)
    expect(briefing.earned.attachRatePct.derivation).toMatch(/stays/)
    expect(briefing.narrative).toEqual([])
  })

  it('counts earned revenue only from confirmed orders', async () => {
    const actor = await actorFor(tenant.ownerUserId)

    const before = await buildMorningBriefing(actor, tenant.propertyId, { withNarrative: false })
    expect(before.earned.allTimeMinor.value).toBe(0)

    await buyOne(tenant, 2)

    const after = await buildMorningBriefing(actor, tenant.propertyId, { withNarrative: false })
    // 15% of 190 000 centavos.
    expect(after.earned.allTimeMinor.value).toBe(28_500)
  })

  it('keeps potential value entirely out of the earned figures', async () => {
    // Opportunities are unsold departures in the next three days, so the
    // fixture needs one inside that window.
    const soon = await createTenant({
      capacity: 6,
      priceMinor: 95_000,
      departureDate: toDateKey(new Date(Date.now() + 2 * 86_400_000)),
    })

    const actor = await actorFor(soon.ownerUserId)
    const briefing = await buildMorningBriefing(actor, soon.propertyId, { withNarrative: false })

    // An unsold departure exists, so there is potential upside...
    expect(briefing.potential.totalMinor).toBeGreaterThan(0)
    // ...and nothing has been earned.
    expect(briefing.earned.allTimeMinor.value).toBe(0)
    expect(briefing.potential.note).toMatch(/not revenue/i)
    expect(briefing.potential.note).toMatch(/never added/i)
  })

  it('reports amenities that cannot be sold as catalog gaps', async () => {
    await prisma.amenity.create({
      data: {
        organizationId: tenant.organizationId,
        propertyId: tenant.propertyId,
        name: 'Loaner boards',
        category: 'SURF',
        isIncluded: true,
      },
    })

    const actor = await actorFor(tenant.ownerUserId)
    const briefing = await buildMorningBriefing(actor, tenant.propertyId, { withNarrative: false })

    expect(briefing.gaps.items.map((i) => i.label)).toContain('Loaner boards')
  })

  it('flags an unpublished experience as a gap', async () => {
    await prisma.experience.update({
      where: { id: tenant.experienceId },
      data: { status: ExperienceStatus.DRAFT },
    })

    const actor = await actorFor(tenant.ownerUserId)
    const briefing = await buildMorningBriefing(actor, tenant.propertyId, { withNarrative: false })

    expect(briefing.gaps.items.some((i) => i.detail?.includes('not visible to guests'))).toBe(true)
  })

  it('names the unverified partners rather than summarising them away', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    const briefing = await buildMorningBriefing(actor, tenant.propertyId, { withNarrative: false })

    expect(briefing.gaps.summary).toMatch(/unverified/)
    expect(briefing.gaps.items.some((i) => i.detail?.includes('unverified by ARC'))).toBe(true)
  })

  it('produces a narrative that adds no figures of its own', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    const briefing = await buildMorningBriefing(actor, tenant.propertyId)

    expect(briefing.agentRunId).toBeTruthy()
    expect(briefing.narrative.length).toBeGreaterThan(0)

    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: briefing.agentRunId! } })
    expect(run.task).toBe('briefing.compose')
    expect(run.status).toBe('SUCCEEDED')
  })

  it('refuses another tenant’s property', async () => {
    const other = await createTenant({})
    const actor = await actorFor(tenant.ownerUserId)

    await expect(
      buildMorningBriefing(actor, other.propertyId, { withNarrative: false }),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === 'FORBIDDEN')
  })
})

describe('proposals', () => {
  it('executes a publish action only after a recorded approval', async () => {
    await prisma.experience.update({
      where: { id: tenant.experienceId },
      data: { status: ExperienceStatus.DRAFT },
    })

    const actor = await actorFor(tenant.ownerUserId)
    const { proposalId } = await createProposal(actor, {
      propertyId: tenant.propertyId,
      kind: ProposalKind.CATALOG_GAP,
      title: 'Publish the surf lesson',
      summary: 'It has a price, a departure and a meeting point.',
      action: { type: 'publish_experience', experienceId: tenant.experienceId },
      evidence: { source: 'database', readiness: 'all checks passed' },
    })

    // Nothing has happened yet.
    const beforeDecision = await prisma.experience.findUniqueOrThrow({
      where: { id: tenant.experienceId },
    })
    expect(beforeDecision.status).toBe(ExperienceStatus.DRAFT)

    const result = await decideProposal(actor, {
      proposalId,
      decision: ApprovalDecision.APPROVED,
      note: 'Looks right.',
    })

    expect(result.status).toBe(ProposalStatus.EXECUTED)
    expect(result.execution?.executed).toBe(true)

    const after = await prisma.experience.findUniqueOrThrow({ where: { id: tenant.experienceId } })
    expect(after.status).toBe(ExperienceStatus.PUBLISHED)

    const approval = await prisma.approval.findFirstOrThrow({ where: { proposalId } })
    expect(approval.decidedById).toBe(tenant.ownerUserId)
    expect(approval.decision).toBe(ApprovalDecision.APPROVED)

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: 'workflow.proposal.executed' },
    })
    expect(audit.entityId).toBe(proposalId)
  })

  it('changes nothing on rejection', async () => {
    await prisma.experience.update({
      where: { id: tenant.experienceId },
      data: { status: ExperienceStatus.DRAFT },
    })

    const actor = await actorFor(tenant.ownerUserId)
    const { proposalId } = await createProposal(actor, {
      propertyId: tenant.propertyId,
      kind: ProposalKind.CATALOG_GAP,
      title: 'Publish it',
      summary: 'Ready to go.',
      action: { type: 'publish_experience', experienceId: tenant.experienceId },
      evidence: {},
    })

    const result = await decideProposal(actor, {
      proposalId,
      decision: ApprovalDecision.REJECTED,
      note: 'Not until the partner is verified.',
    })

    expect(result.status).toBe(ProposalStatus.REJECTED)
    expect(result.execution).toBeNull()

    const experience = await prisma.experience.findUniqueOrThrow({
      where: { id: tenant.experienceId },
    })
    expect(experience.status).toBe(ExperienceStatus.DRAFT)
  })

  it('refuses to execute the same proposal twice', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    const { proposalId } = await createProposal(actor, {
      propertyId: tenant.propertyId,
      kind: ProposalKind.CATALOG_GAP,
      title: 'Publish it',
      summary: 'Ready.',
      action: { type: 'publish_experience', experienceId: tenant.experienceId },
      evidence: {},
    })

    await decideProposal(actor, { proposalId, decision: ApprovalDecision.APPROVED })
    await expect(
      decideProposal(actor, { proposalId, decision: ApprovalDecision.APPROVED }),
    ).rejects.toThrow(/already been carried out/)
  })

  it('refuses a capacity change that would strand committed places', async () => {
    await buyOne(tenant, 4)

    const actor = await actorFor(tenant.ownerUserId)
    const { proposalId } = await createProposal(actor, {
      propertyId: tenant.propertyId,
      kind: ProposalKind.PRICE_ADJUSTMENT,
      title: 'Shrink the boat',
      summary: 'Capacity down to two.',
      action: { type: 'adjust_slot_capacity', slotId: tenant.slotId, capacity: 2 },
      evidence: {},
    })

    await expect(
      decideProposal(actor, { proposalId, decision: ApprovalDecision.APPROVED }),
    ).rejects.toThrow(/cannot go below the 4 places/)

    // The failed execution rolled back: the proposal is still awaiting a decision.
    const proposal = await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId } })
    expect(proposal.status).toBe(ProposalStatus.PENDING_APPROVAL)
  })

  it('refuses outright to message a guest while the kill switch is off', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    const { proposalId } = await createProposal(actor, {
      propertyId: tenant.propertyId,
      kind: ProposalKind.GUEST_MESSAGE,
      title: 'Message tomorrow’s arrivals',
      summary: 'Offer them the transfer.',
      action: { type: 'send_guest_message', stayIds: [tenant.stayId], body: 'Hello' },
      evidence: {},
    })

    await expect(
      decideProposal(actor, { proposalId, decision: ApprovalDecision.APPROVED }),
    ).rejects.toThrow(/will not message a guest on your behalf/)
  })

  it('approves without executing when the action needs a human step', async () => {
    await prisma.amenity.create({
      data: {
        organizationId: tenant.organizationId,
        propertyId: tenant.propertyId,
        name: 'Bicycles',
        category: 'ADVENTURE',
      },
    })

    const actor = await actorFor(tenant.ownerUserId)
    const { proposalId } = await createProposal(actor, {
      propertyId: tenant.propertyId,
      kind: ProposalKind.CATALOG_GAP,
      title: 'Productise the bicycles',
      summary: 'They are recorded but not sellable.',
      action: { type: 'draft_experience_from_amenity', amenityNames: ['Bicycles'] },
      evidence: {},
    })

    const result = await decideProposal(actor, {
      proposalId,
      decision: ApprovalDecision.APPROVED,
    })

    expect(result.status).toBe(ProposalStatus.APPROVED)
    expect(result.execution?.executed).toBe(false)
    // It refuses to invent the missing commercial facts.
    expect(result.execution?.summary).toMatch(/will not invent/)
  })

  it('refuses a decision from staff, who may look but not commit', async () => {
    const staffUser = await prisma.user.create({
      data: { email: `staff-${Date.now()}@example.com`, name: 'Front Desk' },
    })
    await prisma.membership.create({
      data: {
        organizationId: tenant.organizationId,
        userId: staffUser.id,
        propertyId: tenant.propertyId,
        role: Role.STAFF,
      },
    })

    const owner = await actorFor(tenant.ownerUserId)
    const { proposalId } = await createProposal(owner, {
      propertyId: tenant.propertyId,
      kind: ProposalKind.CATALOG_GAP,
      title: 'Publish it',
      summary: 'Ready.',
      action: { type: 'publish_experience', experienceId: tenant.experienceId },
      evidence: {},
    })

    const staff = await actorFor(staffUser.id)
    await expect(
      decideProposal(staff, { proposalId, decision: ApprovalDecision.APPROVED }),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === 'FORBIDDEN')
  })

  it('refuses an expired proposal and marks it so', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    const { proposalId } = await createProposal(actor, {
      propertyId: tenant.propertyId,
      kind: ProposalKind.UPSELL,
      title: 'Time-limited',
      summary: 'Expires immediately.',
      action: { type: 'publish_experience', experienceId: tenant.experienceId },
      evidence: {},
    })
    await prisma.proposal.update({
      where: { id: proposalId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    })

    await expect(
      decideProposal(actor, { proposalId, decision: ApprovalDecision.APPROVED }),
    ).rejects.toThrow(/has expired/)

    const proposal = await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId } })
    expect(proposal.status).toBe(ProposalStatus.EXPIRED)
  })

  it('sweeps stale proposals out of the queue', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    const { proposalId } = await createProposal(actor, {
      propertyId: tenant.propertyId,
      kind: ProposalKind.UPSELL,
      title: 'Stale',
      summary: 'Old.',
      action: { type: 'publish_experience', experienceId: tenant.experienceId },
      evidence: {},
    })
    await prisma.proposal.update({
      where: { id: proposalId },
      data: { expiresAt: new Date(Date.now() - 86_400_000) },
    })

    expect(await expireStaleProposals()).toBe(1)
  })
})

describe('revenue analytics', () => {
  it('reports contribution per stay across every stay, not only buyers', async () => {
    // Only CHECKED_OUT and IN_HOUSE stays are in the denominator: a stay that
    // has not started yet cannot be said to have contributed nothing.
    const housed = await createTenant({
      capacity: 6,
      priceMinor: 95_000,
      stayStatus: StayStatus.IN_HOUSE,
    })
    await buyOne(housed, 2)

    const actor = await actorFor(housed.ownerUserId)
    const report = await getRevenueAnalytics(actor, housed.propertyId)

    expect(report.totals.grossMinor).toBe(190_000)
    expect(report.totals.hotelMinor).toBe(28_500)
    expect(report.totals.platformMinor).toBe(9_500)
    expect(report.totals.supplierMinor).toBe(152_000)
    expect(report.headline.derivation).toMatch(/including the/)
    expect(report.ledgerReconciles).toBe(true)
  })

  it('keeps the ledger balanced after a refund', async () => {
    const housed = await createTenant({ capacity: 6, stayStatus: StayStatus.IN_HOUSE })
    const order = await buyOne(housed, 2)
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.orderId } })

    const { cancelOrderItem } = await import('@/modules/commerce/checkout')
    await cancelOrderItem({ orderItemId: item.id, reason: 'test' })

    const actor = await actorFor(housed.ownerUserId)
    const report = await getRevenueAnalytics(actor, housed.propertyId)

    expect(report.ledgerBalanceMinor).toBe(0)
    expect(report.totals.refundedMinor).toBe(190_000)
  })

  it('keeps the ledger balanced against every order, refunded ones included', async () => {
    // Regression: the ledger was reconciled against gross on *earned* orders,
    // so a fully refunded order — which has entries but is not an earned
    // status — could never balance. It must reconcile to the net position of
    // every order: what was sold, less what was refunded.
    const housed = await createTenant({ capacity: 6, stayStatus: StayStatus.IN_HOUSE })

    const kept = await buyOne(housed, 1)
    const refundedOrder = await buyOne(housed, 1)

    const toRefund = await prisma.orderItem.findFirstOrThrow({
      where: { orderId: refundedOrder.orderId },
    })
    const { cancelOrderItem } = await import('@/modules/commerce/checkout')
    await cancelOrderItem({ orderItemId: toRefund.id, reason: 'regression test' })

    const actor = await actorFor(housed.ownerUserId)
    const report = await getRevenueAnalytics(actor, housed.propertyId)

    const orders = await prisma.order.aggregate({
      where: { propertyId: housed.propertyId },
      _sum: { totalMinor: true, refundedMinor: true },
    })
    const netPosition = (orders._sum.totalMinor ?? 0) - (orders._sum.refundedMinor ?? 0)

    expect(report.ledgerBalanceMinor).toBe(netPosition)
    expect(report.ledgerReconciles).toBe(true)
    // The surviving order still contributes.
    expect(report.totals.hotelMinor).toBeGreaterThan(0)
    expect(kept.orderId).not.toBe(refundedOrder.orderId)
  })

  it('reports zero rather than dividing by zero with no stays', async () => {
    await prisma.stay.deleteMany({ where: { propertyId: tenant.propertyId } })

    const actor = await actorFor(tenant.ownerUserId)
    const report = await getRevenueAnalytics(actor, tenant.propertyId)

    expect(report.headline.perStayMinor).toBe(0)
    expect(report.headline.attachRatePct).toBe(0)
    expect(report.headline.derivation).toMatch(/nothing to divide by/)
  })
})

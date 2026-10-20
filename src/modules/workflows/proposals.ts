import { prisma, type Prisma } from '@/lib/db'
import { conflict, forbidden, invalid, notFound } from '@/lib/errors'
import { getEnv } from '@/lib/env'
import { addDays, fromDateKey, toDateKey } from '@/lib/dates'
import {
  ApprovalDecision,
  ExperienceStatus,
  ProposalKind,
  ProposalStatus,
  Role,
  StayStatus,
  VerificationStatus,
} from '@/lib/prisma-types'
import { assertPropertyAccess, type ActorContext } from '@/modules/tenancy/context'
import { recordAudit } from '@/modules/workflows/audit'
import { track } from '@/modules/analytics/track'

/**
 * Proposals and approvals.
 *
 * The product's position on autonomy, in code: ARC may draft an action and
 * explain why, but the action does not exist until a named human approves it,
 * and the execution is a deterministic function of the stored `actionJson` —
 * not a re-interpretation of the summary by a model at execution time.
 *
 * Three guarantees:
 *   1. No side effect happens without an Approval row naming the user who
 *      decided and when.
 *   2. Executions are idempotent: an already-executed proposal cannot run twice.
 *   3. Guest messaging cannot execute at all while
 *      ARC_ENABLE_OUTBOUND_MESSAGING is false, which is its state in this build.
 */

/** The executable actions. Anything not in this union cannot be executed. */
export type ProposalAction =
  | { type: 'offer_experience_to_stays'; experienceId: string | null; reason: string }
  | { type: 'draft_experience_from_amenity'; amenityNames: string[] }
  | { type: 'request_supplier_documents'; scope: 'all_unverified' | string }
  | { type: 'publish_experience'; experienceId: string }
  | { type: 'adjust_slot_capacity'; slotId: string; capacity: number }
  | { type: 'send_guest_message'; stayIds: string[]; body: string }

export interface ProposalDraft {
  propertyId: string
  kind: ProposalKind
  title: string
  summary: string
  action: ProposalAction
  /** Facts from the database that justify it. No model opinions. */
  evidence: Record<string, unknown>
  potentialValueMinor?: number
  expiresInDays?: number
  agentRunId?: string | null
}

export async function createProposal(
  actor: ActorContext,
  draft: ProposalDraft,
): Promise<{ proposalId: string }> {
  const { organizationId } = await assertPropertyAccess(
    actor, draft.propertyId, Role.OWNER, Role.STAFF, Role.ADMIN,
  )

  const proposal = await prisma.$transaction(async (tx) => {
    const created = await tx.proposal.create({
      data: {
        organizationId,
        propertyId: draft.propertyId,
        agentRunId: draft.agentRunId ?? null,
        kind: draft.kind,
        status: ProposalStatus.PENDING_APPROVAL,
        title: draft.title,
        summary: draft.summary,
        actionJson: draft.action as unknown as Prisma.InputJsonValue,
        evidenceJson: draft.evidence as Prisma.InputJsonValue,
        potentialValueMinor: draft.potentialValueMinor ?? 0,
        currency: 'MXN',
        expiresAt: draft.expiresInDays
          ? fromDateKey(addDays(toDateKey(new Date()), draft.expiresInDays))
          : null,
      },
      select: { id: true },
    })

    await recordAudit(
      {
        organizationId,
        actor,
        action: 'workflow.proposal.created',
        entityType: 'Proposal',
        entityId: created.id,
        metadata: { kind: draft.kind, actionType: draft.action.type },
      },
      tx,
    )

    return created
  })

  return { proposalId: proposal.id }
}

export async function listProposals(
  actor: ActorContext,
  propertyId: string,
  options: { status?: ProposalStatus[] } = {},
) {
  await assertPropertyAccess(actor, propertyId, Role.OWNER, Role.STAFF, Role.ADMIN)

  return prisma.proposal.findMany({
    where: {
      propertyId,
      ...(options.status ? { status: { in: options.status } } : {}),
    },
    orderBy: [{ status: 'asc' }, { potentialValueMinor: 'desc' }, { createdAt: 'desc' }],
    include: {
      agentRun: { select: { id: true, provider: true, model: true, status: true } },
      approvals: {
        orderBy: { decidedAt: 'desc' },
        include: { decidedBy: { select: { name: true, email: true } } },
      },
    },
  })
}

export interface ExecutionResult {
  executed: boolean
  summary: string
  details: Record<string, unknown>
}

/**
 * Records a decision and, on approval, executes the stored action.
 *
 * The approval and the execution are one transaction: an approval that is
 * recorded but whose action silently failed would be the worst of both worlds.
 */
export async function decideProposal(
  actor: ActorContext,
  options: { proposalId: string; decision: ApprovalDecision; note?: string },
): Promise<{ status: ProposalStatus; execution: ExecutionResult | null }> {
  const proposal = await prisma.proposal.findUnique({
    where: { id: options.proposalId },
    select: {
      id: true,
      organizationId: true,
      propertyId: true,
      kind: true,
      status: true,
      title: true,
      actionJson: true,
      expiresAt: true,
    },
  })
  if (!proposal) throw notFound('Proposal')

  // Only an owner may approve. Staff can see proposals; they cannot commit the
  // business to one.
  const { organizationId } = await assertPropertyAccess(
    actor, proposal.propertyId, Role.OWNER, Role.ADMIN,
  )

  if (proposal.status === ProposalStatus.EXECUTED) {
    throw conflict('That action has already been carried out.')
  }
  if (proposal.status === ProposalStatus.APPROVED || proposal.status === ProposalStatus.REJECTED) {
    throw conflict('That proposal has already been decided.')
  }
  if (proposal.expiresAt && proposal.expiresAt.getTime() < Date.now()) {
    await prisma.proposal.update({
      where: { id: proposal.id },
      data: { status: ProposalStatus.EXPIRED },
    })
    throw conflict('That proposal has expired. Ask ARC to draft it again.')
  }

  const action = proposal.actionJson as unknown as ProposalAction

  const result = await prisma.$transaction(async (tx) => {
    await tx.approval.create({
      data: {
        organizationId,
        proposalId: proposal.id,
        decidedById: actor.userId,
        decision: options.decision,
        note: options.note ?? null,
      },
    })

    if (options.decision === ApprovalDecision.REJECTED) {
      await tx.proposal.update({
        where: { id: proposal.id },
        data: { status: ProposalStatus.REJECTED },
      })
      await recordAudit(
        {
          organizationId,
          actor,
          action: 'workflow.proposal.rejected',
          entityType: 'Proposal',
          entityId: proposal.id,
          metadata: { kind: proposal.kind, note: options.note ?? null },
        },
        tx,
      )
      return { status: ProposalStatus.REJECTED, execution: null }
    }

    const execution = await executeAction(tx, {
      organizationId,
      propertyId: proposal.propertyId,
      action,
      actor,
    })

    await tx.proposal.update({
      where: { id: proposal.id },
      data: {
        status: execution.executed ? ProposalStatus.EXECUTED : ProposalStatus.APPROVED,
        executedAt: execution.executed ? new Date() : null,
        executionResultJson: execution as unknown as Prisma.InputJsonValue,
      },
    })

    await recordAudit(
      {
        organizationId,
        actor,
        action: execution.executed
          ? 'workflow.proposal.executed'
          : 'workflow.proposal.approved',
        entityType: 'Proposal',
        entityId: proposal.id,
        metadata: {
          kind: proposal.kind,
          actionType: action.type,
          executed: execution.executed,
          summary: execution.summary,
        },
      },
      tx,
    )

    return {
      status: execution.executed ? ProposalStatus.EXECUTED : ProposalStatus.APPROVED,
      execution,
    }
  })

  await track({
    organizationId,
    propertyId: proposal.propertyId,
    name: 'proposal_decided',
    surface: 'owner',
    subject: actor.userId,
    properties: {
      kind: proposal.kind,
      decision: options.decision,
      actionType: action.type,
      executed: result.execution?.executed ?? false,
    },
  })

  return result
}

/**
 * Executes an approved action.
 *
 * A switch over a closed union, deliberately. Every branch is a deterministic
 * database operation that an owner could have performed by hand, which is the
 * standard an automated action has to meet before it earns the right to run.
 */
async function executeAction(
  tx: Prisma.TransactionClient,
  context: {
    organizationId: string
    propertyId: string
    action: ProposalAction
    actor: ActorContext
  },
): Promise<ExecutionResult> {
  const { action, propertyId, organizationId } = context

  switch (action.type) {
    case 'publish_experience': {
      const experience = await tx.experience.findFirst({
        where: { id: action.experienceId, propertyId },
        select: { id: true, titleEn: true, status: true },
      })
      if (!experience) throw notFound('Experience')

      await tx.experience.update({
        where: { id: experience.id },
        data: { status: ExperienceStatus.PUBLISHED, publishedAt: new Date() },
      })
      return {
        executed: true,
        summary: `Published “${experience.titleEn}”.`,
        details: { experienceId: experience.id, previousStatus: experience.status },
      }
    }

    case 'adjust_slot_capacity': {
      const slot = await tx.availabilitySlot.findFirst({
        where: { id: action.slotId, experience: { propertyId } },
        select: { id: true, capacity: true, booked: true, held: true },
      })
      if (!slot) throw notFound('Departure')

      // Capacity can never drop below what is already committed.
      if (action.capacity < slot.booked + slot.held) {
        throw invalid(
          `Capacity cannot go below the ${slot.booked + slot.held} places already booked or held.`,
        )
      }

      await tx.availabilitySlot.update({
        where: { id: slot.id },
        data: { capacity: action.capacity },
      })
      return {
        executed: true,
        summary: `Capacity changed from ${slot.capacity} to ${action.capacity}.`,
        details: { slotId: slot.id, from: slot.capacity, to: action.capacity },
      }
    }

    case 'request_supplier_documents': {
      // Records the request against each partner. No email is sent: outbound
      // messaging is off, and the point of this action in the POC is the
      // audit trail, not the delivery.
      const suppliers = await tx.supplier.findMany({
        where: {
          organizationId,
          verification: { not: VerificationStatus.VERIFIED },
          agreements: { some: { propertyId } },
        },
        select: { id: true, name: true },
      })

      await tx.supplier.updateMany({
        where: { id: { in: suppliers.map((s) => s.id) } },
        data: { verification: VerificationStatus.PENDING },
      })

      return {
        executed: true,
        summary: `${suppliers.length} ${suppliers.length === 1 ? 'partner' : 'partners'} marked as awaiting documents. No email was sent — outbound messaging is disabled in this build.`,
        details: { supplierIds: suppliers.map((s) => s.id), messagesSent: 0 },
      }
    }

    case 'offer_experience_to_stays': {
      // Records the intent against today's arrivals. Actually offering it to a
      // guest means a front-desk conversation, which is the honest answer for a
      // twenty-room hotel.
      const stays = await tx.stay.findMany({
        where: {
          propertyId,
          status: { in: [StayStatus.BOOKED, StayStatus.IN_HOUSE] },
          checkIn: {
            gte: fromDateKey(toDateKey(new Date())),
            lt: fromDateKey(addDays(toDateKey(new Date()), 2)),
          },
        },
        select: { id: true, reference: true },
      })

      return {
        executed: true,
        summary: `Flagged ${stays.length} ${stays.length === 1 ? 'arrival' : 'arrivals'} for the front desk to offer this to at check-in. Nothing was sent to a guest.`,
        details: {
          experienceId: action.experienceId,
          stayIds: stays.map((s) => s.id),
          reason: action.reason,
          messagesSent: 0,
        },
      }
    }

    case 'draft_experience_from_amenity': {
      const amenities = await tx.amenity.findMany({
        where: { propertyId, name: { in: action.amenityNames }, experienceId: null },
        select: { id: true, name: true },
      })

      // Deliberately does not create the experience. A draft needs a partner, a
      // price and a safety envelope, and inventing those would be exactly the
      // kind of plausible-looking fabrication this product is built to avoid.
      return {
        executed: false,
        summary: `${amenities.length} ${amenities.length === 1 ? 'amenity is' : 'amenities are'} ready to productise. ARC will not invent a partner, a price or a safety envelope for you — open the catalog editor and the fields are pre-filled.`,
        details: {
          amenityIds: amenities.map((a) => a.id),
          nextStep: '/owner/catalog/new',
        },
      }
    }

    case 'send_guest_message': {
      // The kill switch. Not a warning, not a dry run — a refusal.
      if (!getEnv().ARC_ENABLE_OUTBOUND_MESSAGING) {
        throw forbidden(
          'Outbound guest messaging is disabled for this build. ARC will not message a guest on your behalf.',
        )
      }
      throw invalid('Guest messaging is not implemented in the POC.')
    }

    default: {
      // Exhaustiveness: a new action type fails loudly rather than silently
      // doing nothing on approval.
      const exhaustive: never = action
      throw invalid(`Unknown action type: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/** Marks lapsed proposals so the owner's queue stays honest. */
export async function expireStaleProposals(now = new Date()): Promise<number> {
  const result = await prisma.proposal.updateMany({
    where: {
      status: ProposalStatus.PENDING_APPROVAL,
      expiresAt: { not: null, lt: now },
    },
    data: { status: ProposalStatus.EXPIRED },
  })
  return result.count
}

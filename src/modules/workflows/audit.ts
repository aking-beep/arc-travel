import { prisma, type Prisma } from '@/lib/db'
import { redact } from '@/lib/redact'
import { Role } from '@/lib/prisma-types'
import type { ActorContext } from '@/modules/tenancy/context'

/**
 * Append-only audit trail.
 *
 * Every consequential action writes one of these. Rows are never updated or
 * deleted, metadata is PII-redacted before it lands, and the write participates
 * in the caller's transaction when one is passed — so an action and its audit
 * record either both happen or neither does.
 */
export type AuditActorKind = 'system' | 'owner' | 'staff' | 'supplier' | 'guest' | 'admin' | 'agent'

const ROLE_TO_ACTOR_KIND: Record<Role, AuditActorKind> = {
  [Role.OWNER]: 'owner',
  [Role.STAFF]: 'staff',
  [Role.SUPPLIER]: 'supplier',
  [Role.GUEST]: 'guest',
  [Role.ADMIN]: 'admin',
}

export function actorKindOf(actor: ActorContext | null, organizationId?: string): AuditActorKind {
  if (!actor) return 'system'
  if (actor.isPlatformAdmin) return 'admin'
  const relevant = organizationId
    ? actor.memberships.filter((m) => m.organizationId === organizationId)
    : actor.memberships
  const role = relevant[0]?.role
  return role ? ROLE_TO_ACTOR_KIND[role] : 'system'
}

export interface AuditInput {
  organizationId: string
  action: string
  entityType: string
  entityId?: string | null
  actor?: ActorContext | null
  actorKind?: AuditActorKind
  metadata?: Record<string, unknown>
  /** Pre-hashed client address. Raw IPs are never stored. */
  ipHash?: string | null
}

type Client = Prisma.TransactionClient | typeof prisma

export async function recordAudit(input: AuditInput, client: Client = prisma): Promise<void> {
  await client.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actor?.userId ?? null,
      actorKind: input.actorKind ?? actorKindOf(input.actor ?? null, input.organizationId),
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadataJson: input.metadata ? (redact(input.metadata) as Prisma.InputJsonValue) : undefined,
      ipHash: input.ipHash ?? null,
    },
  })
}

export async function listAuditTrail(
  organizationId: string,
  options: { entityType?: string; entityId?: string; limit?: number } = {},
) {
  return prisma.auditEvent.findMany({
    where: {
      organizationId,
      ...(options.entityType ? { entityType: options.entityType } : {}),
      ...(options.entityId ? { entityId: options.entityId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: options.limit ?? 50,
    include: { actor: { select: { name: true, email: true } } },
  })
}

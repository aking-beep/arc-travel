import { createHash, randomBytes } from 'node:crypto'
import { prisma } from '@/lib/db'
import { conflict, forbidden, notFound } from '@/lib/errors'
import { InvitationKind, type Prisma } from '@/lib/prisma-types'
import { assertOrganizationAccess, type ActorContext } from '@/modules/tenancy/context'

/**
 * Invitations: the handover of an account somebody else created.
 *
 * `invitePartner` has to create the partner's `User` row, because the supplier
 * record needs a contact. That row has no password, and ARC must not invent one
 * and mail it — so the invitation is what lets exactly one person set the
 * password on exactly one account, once, within a fixed window.
 *
 * Only the token's hash is stored, for the same reason a password's is: a
 * leaked database must not yield working invitation links.
 *
 * Deliberately free of any session dependency, so a domain module can mint an
 * invitation inside its own transaction without pulling `next/headers` into its
 * import graph. Accepting one needs a session, and lives in `credentials.ts`.
 */
/** How long an invitation link is good for. */
export const INVITATION_TTL_DAYS = 14

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export interface CreatedInvitation {
  invitationId: string
  /** The raw token. Only ever returned here; the database holds its hash. */
  token: string
  expiresAt: Date
}

/**
 * Mints an invitation for a user row that has no password yet.
 *
 * Takes a transaction client, because an invitation and the thing it invites
 * someone to — a supplier record, a staff membership — must be created
 * together or not at all.
 */
export async function createInvitation(
  input: {
    userId: string
    kind: InvitationKind
    organizationId?: string | null
    invitedById?: string | null
    now?: Date
  },
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<CreatedInvitation> {
  const now = input.now ?? new Date()
  const token = randomBytes(24).toString('base64url')
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_DAYS * 86_400_000)

  const invitation = await tx.invitation.create({
    data: {
      userId: input.userId,
      tokenHash: hashInvitationToken(token),
      kind: input.kind,
      organizationId: input.organizationId ?? null,
      invitedById: input.invitedById ?? null,
      expiresAt,
    },
    select: { id: true },
  })

  return { invitationId: invitation.id, token, expiresAt }
}

export interface InvitationView {
  invitationId: string
  kind: InvitationKind
  email: string
  name: string
  organizationName: string | null
  /** True when the account already has a password, so this is a duplicate. */
  alreadyUsable: boolean
  expiresAt: Date
}

/**
 * Resolves an invitation token for display.
 *
 * Refuses a token that is expired, revoked or already accepted, and says which
 * — the holder of the link is the person it was sent to, so an accurate reason
 * is help rather than disclosure.
 */
export async function getInvitation(token: string, now = new Date()): Promise<InvitationView> {
  if (!token || token.length < 16 || token.length > 128) throw notFound('Invitation')

  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
    select: {
      id: true,
      kind: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      user: { select: { email: true, name: true, passwordHash: true } },
      organization: { select: { name: true } },
    },
  })
  if (!invitation) throw notFound('Invitation')
  if (invitation.revokedAt) throw forbidden('This invitation was withdrawn.')
  if (invitation.acceptedAt) throw conflict('This invitation has already been used.')
  if (invitation.expiresAt.getTime() <= now.getTime()) {
    throw forbidden('This invitation has expired. Ask for a new one.')
  }

  return {
    invitationId: invitation.id,
    kind: invitation.kind,
    email: invitation.user.email,
    name: invitation.user.name,
    organizationName: invitation.organization?.name ?? null,
    alreadyUsable: Boolean(invitation.user.passwordHash),
    expiresAt: invitation.expiresAt,
  }
}

/** Withdraws an unaccepted invitation. */
export async function revokeInvitation(
  actor: ActorContext,
  invitationId: string,
  now = new Date(),
): Promise<void> {
  const invitation = await prisma.invitation.findUnique({
    where: { id: invitationId },
    select: { id: true, organizationId: true, acceptedAt: true },
  })
  if (!invitation) throw notFound('Invitation')
  if (invitation.acceptedAt) throw conflict('That invitation has already been used.')
  if (!invitation.organizationId) throw forbidden('That invitation cannot be withdrawn here.')

  await assertOrganizationAccess(actor, invitation.organizationId)

  await prisma.invitation.update({
    where: { id: invitation.id },
    data: { revokedAt: now },
  })
}


import 'server-only'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/lib/db'
import { conflict, forbidden, invalid, unauthenticated } from '@/lib/errors'
import { hashPassword, needsRehash, verifyPassword } from '@/lib/password'
import { assertWithinRateLimit, rateLimitSubject } from '@/lib/rate-limit'
import { recordAudit } from '@/modules/workflows/audit'
import { getInvitation, hashInvitationToken } from './invitations'
import type { ActorContext } from '@/modules/tenancy/context'
import { acceptInvitationSchema, passwordSignInSchema } from './schemas'
import { signInAs } from './service'

/**
 * Real credentials.
 *
 * The POC signed in by picking an account from a list, which was honest about
 * being a demo and is not a product: nobody can be given an account they alone
 * control. This file is the other half — a password a person sets themselves,
 * and accepting the single-use invitation (`./invitations.ts`) that lets them
 * set it on an account somebody else created for them.
 *
 * Three rules run through it:
 *
 *   1. **A failed sign-in says nothing.** Unknown email and wrong password
 *      return the same error, and an account with no password set yet returns
 *      it too. Enumerating ARC's hotels through the sign-in form is not a
 *      feature.
 *   2. **Attempts are bounded.** Per email and per caller, in Postgres
 *      (`src/lib/rate-limit.ts`), because an unbounded guess rate makes the
 *      password's strength irrelevant.
 *   3. **An invitation is a handover, never a credential ARC invents.** ARC
 *      never generates a password for someone, and never mails one. The token
 *      is stored only as a hash, is single-use, and expires.
 */

const SIGN_IN_ATTEMPTS_PER_EMAIL = 10
const SIGN_IN_ATTEMPTS_PER_CALLER = 30
const SIGN_IN_WINDOW_SECONDS = 300

/** Deliberately identical for every failure mode. */
const signInRefused = () =>
  unauthenticated('That email and password do not match an account.')

export interface PasswordSignInOptions {
  /** Whatever the app layer can key the caller on, usually their address. */
  clientKey?: string | null
  now?: Date
}

/**
 * Signs a user in with a password.
 *
 * Note what is *not* here: no "account exists" branch, no separate message for
 * a user who has an invitation outstanding, and no early return before the
 * hash comparison when the email is unknown — the work is done against a
 * dummy hash instead, so the response time does not say whether the address is
 * one of ours.
 */
export async function verifyCredentials(
  raw: unknown,
  options: PasswordSignInOptions = {},
): Promise<string> {
  const input = passwordSignInSchema.parse(raw)
  const now = options.now ?? new Date()

  if (options.clientKey) {
    await assertWithinRateLimit({
      bucket: `sign-in:caller:${rateLimitSubject(options.clientKey)}`,
      limit: SIGN_IN_ATTEMPTS_PER_CALLER,
      windowSeconds: SIGN_IN_WINDOW_SECONDS,
      message: 'Too many sign-in attempts. Wait a few minutes and try again.',
      now,
    })
  }

  await assertWithinRateLimit({
    bucket: `sign-in:email:${rateLimitSubject(input.email)}`,
    limit: SIGN_IN_ATTEMPTS_PER_EMAIL,
    windowSeconds: SIGN_IN_WINDOW_SECONDS,
    message: 'Too many sign-in attempts for that account. Wait a few minutes and try again.',
    now,
  })

  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, passwordHash: true },
  })

  // Compare against *something* even when the address is unknown, so the
  // timing of a refusal does not distinguish the two cases.
  const stored = user?.passwordHash ?? (await unmatchableHash())
  const matches = await verifyPassword(input.password, stored)

  if (!user || !user.passwordHash || !matches) throw signInRefused()

  // Opportunistic upgrade: the parameters are stored with the hash, so raising
  // them later re-hashes on the next successful sign-in rather than locking
  // anyone out.
  if (needsRehash(user.passwordHash)) {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(input.password) },
    })
  }

  return user.id
}

/**
 * Establishes a session for a verified password.
 *
 * The session is the app layer's business — `verifyCredentials` is what the
 * tests and any future non-cookie caller use, and this is the one line that
 * touches a cookie.
 */
export async function signInWithPassword(
  raw: unknown,
  options: PasswordSignInOptions = {},
): Promise<ActorContext> {
  return signInAs(await verifyCredentials(raw, options))
}

/**
 * A valid scrypt hash of a value nobody knows, used to spend the same work on
 * an unknown address as on a known one.
 *
 * Computed on first use and then reused, rather than at module load: a
 * top-level await would make this module's import blocking in every graph that
 * touches it, including ones that never sign anyone in.
 */
let dummyHash: Promise<string> | null = null
function unmatchableHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString('hex'))
  return dummyHash
}

/**
 * Accepts an invitation: sets the password and signs the person in.
 *
 * The whole thing is one transaction, and the invitation is marked accepted by
 * a conditional update inside it. Two people following the same link at once
 * cannot both succeed: the second one's update matches no row.
 */
export async function acceptInvitationFor(
  raw: unknown,
  options: { now?: Date } = {},
): Promise<string> {
  const input = acceptInvitationSchema.parse(raw)
  const now = options.now ?? new Date()

  // Validates expiry, revocation and prior use, and gives us the user.
  await getInvitation(input.token, now)

  const tokenHash = hashInvitationToken(input.token)
  const passwordHash = await hashPassword(input.password)

  const userId = await prisma.$transaction(async (tx) => {
    // Single-use, enforced by the `where` clause rather than by a prior read:
    // `updateMany` matching zero rows is how a race loses.
    const claimed = await tx.invitation.updateMany({
      where: { tokenHash, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { acceptedAt: now },
    })
    if (claimed.count !== 1) throw conflict('This invitation has already been used.')

    const invitation = await tx.invitation.findUniqueOrThrow({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        organizationId: true,
        kind: true,
        user: { select: { email: true, name: true } },
      },
    })

    await tx.user.update({
      where: { id: invitation.userId },
      data: {
        passwordHash,
        ...(input.name ? { name: input.name } : {}),
      },
    })

    if (invitation.organizationId) {
      await recordAudit(
        {
          organizationId: invitation.organizationId,
          actor: {
            userId: invitation.userId,
            email: invitation.user.email,
            name: input.name ?? invitation.user.name,
            isPlatformAdmin: false,
            memberships: [],
          },
          action: 'invitation.accepted',
          entityType: 'Invitation',
          entityId: invitation.id,
          metadata: { kind: invitation.kind },
        },
        tx,
      )
    }

    return invitation.userId
  })

  return userId
}

/** `acceptInvitationFor`, plus the session. */
export async function acceptInvitation(
  raw: unknown,
  options: { now?: Date } = {},
): Promise<ActorContext> {
  return signInAs(await acceptInvitationFor(raw, options))
}

/** Changes the password on the signed-in actor's own account. */
export async function changeOwnPassword(
  actor: ActorContext,
  input: { currentPassword: string; newPassword: string },
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: actor.userId },
    select: { passwordHash: true },
  })
  if (!user?.passwordHash) throw forbidden('This account has no password set.')
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw invalid('That is not your current password.')
  }
  if (input.newPassword.length < 12) throw invalid('Use at least 12 characters.')

  await prisma.user.update({
    where: { id: actor.userId },
    data: { passwordHash: await hashPassword(input.newPassword) },
  })
}

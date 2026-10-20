import 'server-only'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import { unauthenticated, notFound } from '@/lib/errors'
import type { ActorContext } from '@/modules/tenancy/context'
import { decodeSession, encodeSession, SESSION_COOKIE, sessionCookieOptions } from './session'

const ACTOR_SELECT = {
  id: true,
  email: true,
  name: true,
  isPlatformAdmin: true,
  memberships: {
    select: {
      id: true,
      organizationId: true,
      role: true,
      propertyId: true,
      supplierId: true,
    },
  },
} as const

async function loadActor(userId: string): Promise<ActorContext | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: ACTOR_SELECT })
  if (!user) return null
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    isPlatformAdmin: user.isPlatformAdmin,
    memberships: user.memberships,
  }
}

/** Returns the signed-in actor, or null. Never throws for anonymous visitors. */
export async function getActor(): Promise<ActorContext | null> {
  const store = await cookies()
  const userId = decodeSession(store.get(SESSION_COOKIE)?.value)
  if (!userId) return null
  return loadActor(userId)
}

export async function requireActor(): Promise<ActorContext> {
  const actor = await getActor()
  if (!actor) throw unauthenticated()
  return actor
}

/**
 * Establishes a session for a user id. The POC's sign-in surface is an explicit
 * demo account switcher: there are no credentials to steal because the seeded
 * accounts have none. A real deployment replaces this one function.
 */
export async function signInAs(userId: string): Promise<ActorContext> {
  const actor = await loadActor(userId)
  if (!actor) throw notFound('User')

  const store = await cookies()
  store.set(SESSION_COOKIE, encodeSession(userId), sessionCookieOptions)
  await prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } })
  return actor
}

export async function signInByEmail(email: string): Promise<ActorContext> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true },
  })
  if (!user) throw notFound('Account')
  return signInAs(user.id)
}

export async function signOut(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}

/**
 * Resolves a QR-code portal token to its stay and signs the guest in.
 * The token is the guest's only credential, so it is single-purpose: it grants
 * access to one stay's portal and nothing else.
 */
export async function signInWithPortalToken(token: string): Promise<{
  stayId: string
  guestId: string
  propertyId: string
  actor: ActorContext | null
}> {
  const stay = await prisma.stay.findUnique({
    where: { portalToken: token },
    select: {
      id: true,
      propertyId: true,
      guest: { select: { id: true, userId: true } },
    },
  })
  if (!stay) throw notFound('Stay')

  const actor = stay.guest.userId ? await signInAs(stay.guest.userId) : null
  return {
    stayId: stay.id,
    guestId: stay.guest.id,
    propertyId: stay.propertyId,
    actor,
  }
}

/** Demo account switcher options, grouped by surface. Development affordance. */
export async function listDemoAccounts() {
  const users = await prisma.user.findMany({
    orderBy: [{ isPlatformAdmin: 'desc' }, { email: 'asc' }],
    select: {
      id: true,
      email: true,
      name: true,
      isPlatformAdmin: true,
      memberships: { select: { role: true, propertyId: true, supplierId: true } },
      guest: { select: { id: true, stays: { select: { portalToken: true }, take: 1 } } },
    },
  })

  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    roles: u.isPlatformAdmin
      ? (['ADMIN'] as string[])
      : [...new Set(u.memberships.map((m) => m.role as string))],
    portalToken: u.guest?.stays[0]?.portalToken ?? null,
  }))
}

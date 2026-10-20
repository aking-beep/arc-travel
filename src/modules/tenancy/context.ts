import { Role } from '@/lib/prisma-types'
import { forbidden, notFound } from '@/lib/errors'
import { prisma } from '@/lib/db'

/**
 * Tenancy is the single chokepoint for authorisation.
 *
 * Every tenant-scoped read and write in ARC goes through one of the `assert*`
 * helpers below. They take the *caller's* context and the *requested* id and
 * verify the relationship in the database — a client-supplied organizationId is
 * never trusted, and ownership is never inferred from a URL.
 */
export interface MembershipContext {
  id: string
  organizationId: string
  role: Role
  propertyId: string | null
  supplierId: string | null
}

export interface ActorContext {
  userId: string
  email: string
  name: string
  isPlatformAdmin: boolean
  memberships: MembershipContext[]
}

export const hasRole = (actor: ActorContext, ...roles: Role[]): boolean =>
  actor.memberships.some((m) => roles.includes(m.role))

export function organizationIdsFor(actor: ActorContext, ...roles: Role[]): string[] {
  const relevant = roles.length
    ? actor.memberships.filter((m) => roles.includes(m.role))
    : actor.memberships
  return [...new Set(relevant.map((m) => m.organizationId))]
}

/**
 * Confirms the actor may act on `organizationId` in one of `roles`.
 * Platform admins pass, and that fact is what makes every admin action worth
 * auditing — see modules/workflows/audit.
 */
export function assertOrganizationAccess(
  actor: ActorContext,
  organizationId: string,
  ...roles: Role[]
): MembershipContext {
  if (actor.isPlatformAdmin) {
    return {
      id: `platform-admin:${actor.userId}`,
      organizationId,
      role: Role.ADMIN,
      propertyId: null,
      supplierId: null,
    }
  }

  const candidates = actor.memberships.filter((m) => m.organizationId === organizationId)
  if (candidates.length === 0) {
    throw forbidden('You do not have access to this organization.')
  }

  const match = roles.length
    ? candidates.find((m) => roles.includes(m.role))
    : candidates[0]
  if (!match) {
    throw forbidden(`This action requires one of: ${roles.join(', ')}.`)
  }
  return match
}

/**
 * Loads a property and proves the actor may act on it.
 *
 * Two checks, not one: the property must belong to an organization the actor is
 * a member of, AND a property-scoped membership (STAFF) must match this
 * property specifically.
 */
export async function assertPropertyAccess(
  actor: ActorContext,
  propertyId: string,
  ...roles: Role[]
): Promise<{ organizationId: string; propertyId: string; membership: MembershipContext }> {
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { id: true, organizationId: true },
  })
  if (!property) throw notFound('Property')

  const membership = assertOrganizationAccess(actor, property.organizationId, ...roles)

  if (membership.propertyId && membership.propertyId !== propertyId) {
    throw forbidden('Your access is limited to a different property.')
  }

  return { organizationId: property.organizationId, propertyId: property.id, membership }
}

/** Loads a supplier and proves the actor may act on it. */
export async function assertSupplierAccess(
  actor: ActorContext,
  supplierId: string,
): Promise<{ organizationId: string; supplierId: string; membership: MembershipContext }> {
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { id: true, organizationId: true },
  })
  if (!supplier) throw notFound('Supplier')

  const membership = assertOrganizationAccess(
    actor,
    supplier.organizationId,
    Role.SUPPLIER,
    Role.OWNER,
    Role.ADMIN,
  )

  // A SUPPLIER membership is bound to exactly one supplier; owners and admins
  // may act across the organization's suppliers.
  if (membership.role === Role.SUPPLIER && membership.supplierId !== supplierId) {
    throw forbidden('Your access is limited to a different partner account.')
  }

  return { organizationId: supplier.organizationId, supplierId: supplier.id, membership }
}

/** Loads a guest and proves the actor may act on it. */
export async function assertGuestAccess(
  actor: ActorContext,
  guestId: string,
): Promise<{ organizationId: string; propertyId: string; guestId: string }> {
  const guest = await prisma.guest.findUnique({
    where: { id: guestId },
    select: { id: true, organizationId: true, propertyId: true, userId: true },
  })
  if (!guest) throw notFound('Guest')

  // A guest acting on their own record is the common case and needs no
  // organization membership at all.
  if (guest.userId && guest.userId === actor.userId) {
    return { organizationId: guest.organizationId, propertyId: guest.propertyId, guestId: guest.id }
  }

  const membership = assertOrganizationAccess(
    actor,
    guest.organizationId,
    Role.OWNER,
    Role.STAFF,
    Role.ADMIN,
  )

  // Honour the property pin, as assertPropertyAccess does. Front-desk staff at
  // one property must not reach another property's guests, even inside the
  // same organization.
  if (membership.propertyId && membership.propertyId !== guest.propertyId) {
    throw forbidden('Your access is limited to a different property.')
  }

  return { organizationId: guest.organizationId, propertyId: guest.propertyId, guestId: guest.id }
}

/**
 * Platform administration.
 *
 * Gated on `User.isPlatformAdmin` alone. An earlier version also accepted a
 * membership with `role: ADMIN`, which meant a single row scoped to one
 * organization conferred cross-tenant authority over every supplier and
 * property in the database — including the only route to a VERIFIED status.
 * Organization-level administration is what OWNER is for.
 */
export function assertPlatformAdmin(actor: ActorContext): void {
  if (!actor.isPlatformAdmin) {
    throw forbidden('Platform administrator access required.')
  }
}

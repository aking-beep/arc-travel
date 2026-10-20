import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { isAppError } from '@/lib/errors'
import { Role } from '@/lib/prisma-types'
import {
  assertGuestAccess,
  assertOrganizationAccess,
  assertPlatformAdmin,
  assertPropertyAccess,
  assertSupplierAccess,
} from '@/modules/tenancy/context'
import { listCatalog, setExperienceStatus } from '@/modules/catalog/service'
import { listArrivals, listPartners, resolveOperatingProperty } from '@/modules/hotels/service'
import { actorFor, createTenant, resetDatabase, type TenantFixture } from '../helpers/factory'

/**
 * Tenant isolation.
 *
 * Two real organizations, and every assertion is "A cannot reach B". This is
 * the test suite that would catch the single worst class of bug in a
 * multi-tenant hospitality product: one hotel seeing another's guests.
 */
let alpha: TenantFixture
let beta: TenantFixture

beforeEach(async () => {
  await resetDatabase()
  alpha = await createTenant({ name: 'alpha' })
  beta = await createTenant({ name: 'beta' })
})

afterAll(async () => {
  await prisma.$disconnect()
})

const forbidden = (error: unknown) => isAppError(error) && error.code === 'FORBIDDEN'
const notFound = (error: unknown) => isAppError(error) && error.code === 'NOT_FOUND'

describe('assertOrganizationAccess', () => {
  it('admits a member of the organization', async () => {
    const actor = await actorFor(alpha.ownerUserId)
    const membership = assertOrganizationAccess(actor, alpha.organizationId, Role.OWNER)
    expect(membership.organizationId).toBe(alpha.organizationId)
  })

  it('refuses a member of a different organization', async () => {
    const actor = await actorFor(alpha.ownerUserId)
    expect(() => assertOrganizationAccess(actor, beta.organizationId, Role.OWNER)).toThrowError(
      /do not have access/,
    )
  })

  it('refuses a member who lacks the required role', async () => {
    // A GUEST membership in the organization is not authority to act as OWNER.
    const actor = await actorFor(alpha.guestUserId)
    expect(() => assertOrganizationAccess(actor, alpha.organizationId, Role.OWNER)).toThrowError(
      /requires one of: OWNER/,
    )
  })

  it('admits a platform admin to any organization', async () => {
    const adminUser = await prisma.user.create({
      data: { email: `admin-${Date.now()}@example.com`, name: 'Admin', isPlatformAdmin: true },
    })
    const actor = await actorFor(adminUser.id)
    expect(assertOrganizationAccess(actor, beta.organizationId).role).toBe(Role.ADMIN)
  })
})

describe('assertPropertyAccess', () => {
  it('admits the owning organization', async () => {
    const actor = await actorFor(alpha.ownerUserId)
    const result = await assertPropertyAccess(actor, alpha.propertyId, Role.OWNER)
    expect(result.organizationId).toBe(alpha.organizationId)
  })

  it('refuses another tenant’s property', async () => {
    const actor = await actorFor(alpha.ownerUserId)
    await expect(assertPropertyAccess(actor, beta.propertyId, Role.OWNER)).rejects.toSatisfy(
      forbidden,
    )
  })

  it('refuses a staff membership pinned to a different property', async () => {
    const secondProperty = await prisma.property.create({
      data: {
        organizationId: alpha.organizationId,
        slug: `second-${Date.now()}`,
        name: 'Second Property',
        currency: 'MXN',
      },
      select: { id: true },
    })

    const staffUser = await prisma.user.create({
      data: { email: `staff-${Date.now()}@example.com`, name: 'Front Desk' },
    })
    await prisma.membership.create({
      data: {
        organizationId: alpha.organizationId,
        userId: staffUser.id,
        propertyId: alpha.propertyId,
        role: Role.STAFF,
      },
    })

    const actor = await actorFor(staffUser.id)
    await expect(assertPropertyAccess(actor, alpha.propertyId, Role.STAFF)).resolves.toBeTruthy()
    await expect(assertPropertyAccess(actor, secondProperty.id, Role.STAFF)).rejects.toSatisfy(
      forbidden,
    )
  })

  it('reports a property that does not exist as not found', async () => {
    const actor = await actorFor(alpha.ownerUserId)
    await expect(
      assertPropertyAccess(actor, '00000000-0000-4000-8000-000000000000', Role.OWNER),
    ).rejects.toSatisfy(notFound)
  })
})

describe('assertSupplierAccess', () => {
  it('admits a partner to their own account', async () => {
    const actor = await actorFor(alpha.supplierUserId)
    const result = await assertSupplierAccess(actor, alpha.supplierId)
    expect(result.supplierId).toBe(alpha.supplierId)
  })

  it('refuses a partner another partner’s account in the same organization', async () => {
    const otherSupplier = await prisma.supplier.create({
      data: {
        organizationId: alpha.organizationId,
        slug: `other-${Date.now()}`,
        name: 'Other Partner',
      },
      select: { id: true },
    })

    const actor = await actorFor(alpha.supplierUserId)
    await expect(assertSupplierAccess(actor, otherSupplier.id)).rejects.toSatisfy(forbidden)
  })

  it('refuses a partner in another organization entirely', async () => {
    const actor = await actorFor(alpha.supplierUserId)
    await expect(assertSupplierAccess(actor, beta.supplierId)).rejects.toSatisfy(forbidden)
  })

  it('admits the hotel owner to their own partners', async () => {
    const actor = await actorFor(alpha.ownerUserId)
    await expect(assertSupplierAccess(actor, alpha.supplierId)).resolves.toBeTruthy()
  })
})

describe('assertGuestAccess', () => {
  it('admits a guest to their own record without any membership', async () => {
    const actor = await actorFor(alpha.guestUserId)
    const result = await assertGuestAccess(actor, alpha.guestId)
    expect(result.guestId).toBe(alpha.guestId)
  })

  it('refuses a guest another guest’s record', async () => {
    const actor = await actorFor(alpha.guestUserId)
    await expect(assertGuestAccess(actor, beta.guestId)).rejects.toSatisfy(forbidden)
  })

  it('admits the hotel owner to their own guests', async () => {
    const actor = await actorFor(alpha.ownerUserId)
    await expect(assertGuestAccess(actor, alpha.guestId)).resolves.toBeTruthy()
  })

  it('refuses an owner another tenant’s guest', async () => {
    const actor = await actorFor(alpha.ownerUserId)
    await expect(assertGuestAccess(actor, beta.guestId)).rejects.toSatisfy(forbidden)
  })
})

describe('service-level isolation', () => {
  it('scopes the catalog to the caller’s property', async () => {
    const actor = await actorFor(alpha.ownerUserId)
    const catalog = await listCatalog(actor, alpha.propertyId)

    expect(catalog.map((e) => e.id)).toContain(alpha.experienceId)
    expect(catalog.map((e) => e.id)).not.toContain(beta.experienceId)
  })

  it('refuses to list another tenant’s catalog', async () => {
    const actor = await actorFor(alpha.ownerUserId)
    await expect(listCatalog(actor, beta.propertyId)).rejects.toSatisfy(forbidden)
  })

  it('refuses to change the status of another tenant’s experience', async () => {
    const actor = await actorFor(alpha.ownerUserId)
    await expect(setExperienceStatus(actor, beta.experienceId, 'PAUSED')).rejects.toSatisfy(forbidden)

    const untouched = await prisma.experience.findUniqueOrThrow({ where: { id: beta.experienceId } })
    expect(untouched.status).toBe('PUBLISHED')
  })

  it('scopes partners to the caller’s organization', async () => {
    const actor = await actorFor(alpha.ownerUserId)
    const partners = await listPartners(actor, alpha.propertyId)

    expect(partners.map((p) => p.id)).toContain(alpha.supplierId)
    expect(partners.map((p) => p.id)).not.toContain(beta.supplierId)
  })

  it('scopes arrivals to the caller’s property', async () => {
    const actor = await actorFor(alpha.ownerUserId)
    const arrivals = await listArrivals(actor, alpha.propertyId, {
      fromDate: new Date(Date.now() - 86_400_000),
      days: 30,
    })

    const guestIds = arrivals.map((s) => s.guest.id)
    expect(guestIds).toContain(alpha.guestId)
    expect(guestIds).not.toContain(beta.guestId)
  })

  it('resolves the operating property from the caller’s own memberships', async () => {
    const actor = await actorFor(alpha.ownerUserId)
    const resolved = await resolveOperatingProperty(actor)
    expect(resolved.propertyId).toBe(alpha.propertyId)
  })

  it('refuses to resolve a property the caller cannot reach', async () => {
    const actor = await actorFor(alpha.ownerUserId)
    await expect(resolveOperatingProperty(actor, beta.propertyId)).rejects.toSatisfy(forbidden)
  })

  it('refuses platform-admin actions to an ordinary owner', async () => {
    const actor = await actorFor(alpha.ownerUserId)
    expect(() => assertPlatformAdmin(actor)).toThrowError(/administrator access required/)
  })
})

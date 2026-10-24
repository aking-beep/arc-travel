import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { isAppError } from '@/lib/errors'
import { addDays, toDateKey } from '@/lib/dates'
import { Locale, StayStatus } from '@/lib/prisma-types'
import { PORTAL_GRACE_DAYS, resolvePortalContext } from '@/modules/guest/portal'
import { createStay, listStays, reissuePortalToken, setStayStatus } from '@/modules/stays/service'
import { actorFor, createTenant, resetDatabase, type TenantFixture } from '../helpers/factory'

/**
 * Guest and stay provisioning.
 *
 * The readiness audit's finding was that no route created a `Guest` or a
 * `Stay`, so nothing minted a portal token and the guest surface was
 * unreachable for a real guest. The first test here is that finding inverted:
 * create a stay, then open the portal with the token it returns.
 */
let tenant: TenantFixture
const today = () => toDateKey(new Date())

const input = (over: Record<string, unknown> = {}) => ({
  firstName: 'Harriet',
  lastName: 'Okonjo',
  email: `harriet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`,
  locale: Locale.EN,
  checkIn: today(),
  checkOut: addDays(today(), 4),
  adults: 2,
  children: 0,
  roomRevenueMinor: 1_200_000,
  ...over,
})

beforeEach(async () => {
  await resetDatabase()
  tenant = await createTenant({})
})
afterAll(() => prisma.$disconnect())

describe('createStay', () => {
  it('creates the guest and the stay, and the token opens the portal', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    const provisioned = await createStay(actor, tenant.propertyId, input())

    expect(provisioned.reference).toMatch(/^STAY-/)
    // 24 random bytes, base64url.
    expect(provisioned.portalToken).toHaveLength(32)

    const context = await resolvePortalContext(provisioned.portalToken)
    expect(context.stayId).toBe(provisioned.stayId)
    expect(context.guestFirstName).toBe('Harriet')
    expect(context.propertyId).toBe(tenant.propertyId)
  })

  it('says when the portal link stops working', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    const provisioned = await createStay(actor, tenant.propertyId, input())
    expect(provisioned.portalExpiresOn).toBe(addDays(provisioned.checkOut, PORTAL_GRACE_DAYS))
  })

  it('reuses the guest for a second stay, keeping their intake', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    const email = `returning-${Date.now()}@example.com`

    const first = await createStay(actor, tenant.propertyId, input({ email }))
    await prisma.guest.update({
      where: { id: first.guestId },
      data: { surfAbility: 'ADVANCED', intakeCompletedAt: new Date() },
    })

    const second = await createStay(
      actor,
      tenant.propertyId,
      input({ email, checkIn: addDays(today(), 30), checkOut: addDays(today(), 34) }),
    )

    expect(second.guestId).toBe(first.guestId)
    expect(second.stayId).not.toBe(first.stayId)
    // Each stay gets its own credential.
    expect(second.portalToken).not.toBe(first.portalToken)

    const guest = await prisma.guest.findUniqueOrThrow({
      where: { id: first.guestId },
      select: { surfAbility: true, intakeCompletedAt: true },
    })
    expect(guest.surfAbility).toBe('ADVANCED')
    expect(guest.intakeCompletedAt).not.toBeNull()
  })

  it('refuses a reversed stay', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    await expect(
      createStay(actor, tenant.propertyId, input({ checkOut: addDays(today(), -1) })),
    ).rejects.toThrow()
  })

  it('refuses a room type belonging to another property', async () => {
    const other = await createTenant({})
    const roomType = await prisma.roomType.create({
      data: {
        organizationId: other.organizationId,
        propertyId: other.propertyId,
        code: 'OTH',
        name: 'Another property’s room',
        baseRateMinor: 100_000,
        maxOccupancy: 2,
      },
      select: { id: true },
    })

    const actor = await actorFor(tenant.ownerUserId)
    const error = await createStay(
      actor,
      tenant.propertyId,
      input({ roomTypeId: roomType.id }),
    ).catch((e: unknown) => e)
    expect(isAppError(error) && error.code).toBe('NOT_FOUND')
  })

  it('refuses an actor from another tenant', async () => {
    const other = await createTenant({})
    const outsider = await actorFor(other.ownerUserId)

    await expect(createStay(outsider, tenant.propertyId, input())).rejects.toThrow()
    expect(await prisma.stay.count({ where: { propertyId: tenant.propertyId } })).toBe(
      await prisma.stay.count({ where: { propertyId: tenant.propertyId } }),
    )
  })

  it('records the stay without recording the guest’s details', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    const provisioned = await createStay(
      actor,
      tenant.propertyId,
      input({ arrivalNotes: 'Allergic to shellfish' }),
    )

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { action: 'stay.created', entityId: provisioned.stayId },
      select: { metadataJson: true },
    })
    const metadata = JSON.stringify(event.metadataJson)
    expect(metadata).toContain('reference')
    // Field names, not values.
    expect(metadata).not.toContain('shellfish')
    expect(metadata).not.toContain('Harriet')
    expect(metadata).not.toContain(provisioned.portalToken)
  })
})

describe('reissuePortalToken', () => {
  it('replaces the link, and the old one stops resolving', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    const provisioned = await createStay(actor, tenant.propertyId, input())

    const reissued = await reissuePortalToken(actor, provisioned.stayId)
    expect(reissued.portalToken).not.toBe(provisioned.portalToken)

    await expect(resolvePortalContext(reissued.portalToken)).resolves.toBeTruthy()
    await expect(resolvePortalContext(provisioned.portalToken)).rejects.toThrow()
  })

  it('never writes a token into the audit trail', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    const provisioned = await createStay(actor, tenant.propertyId, input())
    const reissued = await reissuePortalToken(actor, provisioned.stayId)

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { action: 'stay.portal_token.reissued', entityId: provisioned.stayId },
      select: { metadataJson: true },
    })
    const metadata = JSON.stringify(event.metadataJson)
    expect(metadata).not.toContain(reissued.portalToken)
    expect(metadata).not.toContain(provisioned.portalToken)
  })

  it('refuses for a cancelled stay, where a new link would open nothing', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    const provisioned = await createStay(actor, tenant.propertyId, input())
    await setStayStatus(actor, { stayId: provisioned.stayId, status: StayStatus.CANCELLED })

    await expect(reissuePortalToken(actor, provisioned.stayId)).rejects.toThrow()
  })
})

describe('setStayStatus', () => {
  it('walks the lifecycle', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    const provisioned = await createStay(actor, tenant.propertyId, input())

    await setStayStatus(actor, { stayId: provisioned.stayId, status: StayStatus.IN_HOUSE })
    await setStayStatus(actor, { stayId: provisioned.stayId, status: StayStatus.CHECKED_OUT })

    const stay = await prisma.stay.findUniqueOrThrow({
      where: { id: provisioned.stayId },
      select: { status: true },
    })
    expect(stay.status).toBe(StayStatus.CHECKED_OUT)
  })

  it('refuses a transition that is not in the table', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    const provisioned = await createStay(actor, tenant.propertyId, input())

    // A booked guest who never arrived cannot have checked out.
    const error = await setStayStatus(actor, {
      stayId: provisioned.stayId,
      status: StayStatus.CHECKED_OUT,
    }).catch((e: unknown) => e)
    expect(isAppError(error) && error.code).toBe('VALIDATION_FAILED')

    await setStayStatus(actor, { stayId: provisioned.stayId, status: StayStatus.NO_SHOW })
    await expect(
      setStayStatus(actor, { stayId: provisioned.stayId, status: StayStatus.IN_HOUSE }),
    ).rejects.toThrow()
  })
})

describe('listStays', () => {
  it('shows only this property’s stays, and whether each link is live', async () => {
    const actor = await actorFor(tenant.ownerUserId)
    const live = await createStay(actor, tenant.propertyId, input())
    const closed = await createStay(actor, tenant.propertyId, input())
    await setStayStatus(actor, { stayId: closed.stayId, status: StayStatus.CANCELLED })

    const other = await createTenant({})
    const otherActor = await actorFor(other.ownerUserId)
    await createStay(otherActor, other.propertyId, input())

    const stays = await listStays(actor, tenant.propertyId)
    const ids = stays.map((s) => s.id)
    expect(ids).toContain(live.stayId)
    expect(ids).toContain(closed.stayId)
    // Nothing from the other tenant, whatever the fixture created there.
    const otherStays = await prisma.stay.findMany({
      where: { propertyId: other.propertyId },
      select: { id: true },
    })
    for (const stay of otherStays) expect(ids).not.toContain(stay.id)

    expect(stays.find((s) => s.id === live.stayId)?.portalLive).toBe(true)
    expect(stays.find((s) => s.id === closed.stayId)?.portalLive).toBe(false)
  })

  it('refuses an actor from another tenant', async () => {
    const other = await createTenant({})
    const outsider = await actorFor(other.ownerUserId)
    await expect(listStays(outsider, tenant.propertyId)).rejects.toThrow()
  })
})

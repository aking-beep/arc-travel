import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { isAppError } from '@/lib/errors'
import { hashPassword, verifyPassword } from '@/lib/password'
import { InvitationKind, Role } from '@/lib/prisma-types'
import {
  acceptInvitationFor,
  changeOwnPassword,
  verifyCredentials,
} from '@/modules/auth/credentials'
import {
  createInvitation,
  getInvitation,
  hashInvitationToken,
  revokeInvitation,
} from '@/modules/auth/invitations'
import { registerOrganization, getOnboardingStatus } from '@/modules/onboarding/service'
import { invitePartner } from '@/modules/hotels/service'
import { actorFor, createTenant, resetDatabase } from '../helpers/factory'

/**
 * Identity: registration, credentials and invitations.
 *
 * These are the three things the readiness audit found missing outright — no
 * route created an organization, no account had a credential, and an invited
 * partner had no way to take their account over. Each test below is one of
 * those claims, inverted.
 */
const PASSWORD = 'a perfectly ordinary passphrase'

const signUpInput = (over: Record<string, unknown> = {}) => ({
  name: 'Ana Rivera',
  email: `ana-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
  password: PASSWORD,
  confirmPassword: PASSWORD,
  organizationName: 'Rivera Hotels',
  countryCode: 'MX',
  propertyName: 'Casa Rivera',
  currency: 'MXN',
  acceptedTerms: true,
  ...over,
})

beforeEach(resetDatabase)
afterAll(() => prisma.$disconnect())

describe('registerOrganization', () => {
  it('creates the account, the business, the first property and the owner membership', async () => {
    const input = signUpInput()
    const result = await registerOrganization(input)

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: result.organizationId },
      select: { name: true, slug: true, status: true, defaultCommissionBps: true },
    })
    expect(organization.name).toBe('Rivera Hotels')
    expect(organization.slug).toBe('rivera-hotels')
    // A new tenant is a draft until it has something to sell.
    expect(organization.status).toBe('DRAFT')

    const property = await prisma.property.findUniqueOrThrow({
      where: { id: result.propertyId },
      select: { name: true, slug: true, status: true, verification: true, currency: true },
    })
    expect(property).toMatchObject({
      name: 'Casa Rivera',
      slug: 'casa-rivera',
      status: 'DRAFT',
      // `/admin` is the only route to a verified status.
      verification: 'UNVERIFIED',
      currency: 'MXN',
    })

    const membership = await prisma.membership.findFirstOrThrow({
      where: { userId: result.userId },
      select: { role: true, organizationId: true, propertyId: true },
    })
    expect(membership).toMatchObject({
      role: Role.OWNER,
      organizationId: result.organizationId,
      propertyId: result.propertyId,
    })

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: result.userId },
      select: { email: true, passwordHash: true, isPlatformAdmin: true },
    })
    expect(user.email).toBe(input.email)
    expect(await verifyPassword(PASSWORD, user.passwordHash)).toBe(true)
    // Registering never grants platform authority.
    expect(user.isPlatformAdmin).toBe(false)
  })

  it('records the terms acceptance in the audit trail', async () => {
    const result = await registerOrganization(signUpInput())
    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: result.organizationId, action: 'organization.registered' },
      select: { metadataJson: true, actorUserId: true },
    })
    expect(event.actorUserId).toBe(result.userId)
    expect(event.metadataJson).toMatchObject({ acceptedTerms: true })
  })

  it('refuses an email that already has an account', async () => {
    const input = signUpInput()
    await registerOrganization(input)

    const error = await registerOrganization(signUpInput({ email: input.email })).catch(
      (e: unknown) => e,
    )
    expect(isAppError(error) && error.code).toBe('CONFLICT')
    expect(await prisma.organization.count()).toBe(1)
  })

  it('refuses mismatched passwords and unaccepted terms, creating nothing', async () => {
    await expect(
      registerOrganization(signUpInput({ confirmPassword: 'something else entirely' })),
    ).rejects.toThrow()
    await expect(registerOrganization(signUpInput({ acceptedTerms: false }))).rejects.toThrow()
    expect(await prisma.organization.count()).toBe(0)
    expect(await prisma.user.count()).toBe(0)
  })

  it('disambiguates a slug rather than failing on a name clash', async () => {
    await registerOrganization(signUpInput())
    const second = await registerOrganization(signUpInput())

    const property = await prisma.property.findUniqueOrThrow({
      where: { id: second.propertyId },
      select: { slug: true },
    })
    expect(property.slug).toBe('casa-rivera-2')
  })

  it('reports what the new tenant still has to do', async () => {
    const result = await registerOrganization(signUpInput())
    const status = await getOnboardingStatus(result.propertyId)

    expect(status).toMatchObject({
      hasRoomTypes: false,
      hasPartners: false,
      hasPublishedExperience: false,
      hasGuests: false,
      complete: false,
    })
  })
})

describe('verifyCredentials', () => {
  it('signs in with the right password', async () => {
    const input = signUpInput()
    const registered = await registerOrganization(input)

    const userId = await verifyCredentials({ email: input.email, password: PASSWORD })
    expect(userId).toBe(registered.userId)
  })

  it('is case-insensitive about the address', async () => {
    const input = signUpInput()
    await registerOrganization(input)
    await expect(
      verifyCredentials({ email: input.email.toUpperCase(), password: PASSWORD }),
    ).resolves.toBeTruthy()
  })

  it('refuses a wrong password and an unknown address with the same error', async () => {
    const input = signUpInput()
    await registerOrganization(input)

    const wrong = await verifyCredentials({ email: input.email, password: 'not it' }).catch(
      (e: unknown) => e,
    )
    const unknown = await verifyCredentials({
      email: 'nobody@example.com',
      password: PASSWORD,
    }).catch((e: unknown) => e)

    expect(isAppError(wrong) && wrong.code).toBe('UNAUTHENTICATED')
    expect(isAppError(unknown) && unknown.code).toBe('UNAUTHENTICATED')
    // Identical, so the form cannot be used to enumerate ARC's hotels.
    expect(isAppError(wrong) && wrong.message).toBe(isAppError(unknown) && unknown.message)
  })

  it('refuses an account that has no password set', async () => {
    // A seeded demo account, or a partner who has not accepted their invitation.
    const tenant = await createTenant()
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: tenant.ownerUserId },
      select: { email: true, passwordHash: true },
    })
    expect(user.passwordHash).toBeNull()

    await expect(
      verifyCredentials({ email: user.email, password: PASSWORD }),
    ).rejects.toThrow()
  })

  it('bounds guessing per account', async () => {
    const input = signUpInput()
    await registerOrganization(input)

    let limited = false
    for (let i = 0; i < 20; i += 1) {
      const error = await verifyCredentials({ email: input.email, password: `guess-${i}` }).catch(
        (e: unknown) => e,
      )
      if (isAppError(error) && error.code === 'RATE_LIMITED') {
        limited = true
        break
      }
    }
    expect(limited).toBe(true)
  })
})

describe('invitations', () => {
  it('gives an invited partner a link, and the link sets their password', async () => {
    const tenant = await createTenant()
    const actor = await actorFor(tenant.ownerUserId)
    const partnerEmail = `partner-${Date.now()}@example.com`

    const invited = await invitePartner(actor, tenant.propertyId, {
      name: 'Olas Verdes',
      contactName: 'Luis Mendoza',
      contactEmail: partnerEmail,
      categories: ['ADVENTURE'],
      hotelCommissionBps: 1500,
    })

    expect(invited.invitation).not.toBeNull()
    const token = invited.invitation!.token

    // The database holds the hash, never the token.
    const row = await prisma.invitation.findUniqueOrThrow({
      where: { tokenHash: hashInvitationToken(token) },
      select: { kind: true, acceptedAt: true, organizationId: true },
    })
    expect(row).toMatchObject({
      kind: InvitationKind.SUPPLIER,
      acceptedAt: null,
      organizationId: tenant.organizationId,
    })
    expect(await prisma.invitation.findFirst({ where: { tokenHash: token } })).toBeNull()

    const view = await getInvitation(token)
    expect(view.email).toBe(partnerEmail)
    expect(view.alreadyUsable).toBe(false)

    const partnerUserId = await acceptInvitationFor({
      token,
      name: 'Luis Mendoza',
      password: PASSWORD,
      confirmPassword: PASSWORD,
    })
    const partner = await actorFor(partnerUserId)
    expect(partner.email).toBe(partnerEmail)
    expect(partner.memberships.some((m) => m.role === Role.SUPPLIER)).toBe(true)

    // And now they can sign in on their own.
    await expect(
      verifyCredentials({ email: partnerEmail, password: PASSWORD }),
    ).resolves.toBeTruthy()
  })

  it('is single-use', async () => {
    const tenant = await createTenant()
    const actor = await actorFor(tenant.ownerUserId)
    const invited = await invitePartner(actor, tenant.propertyId, {
      name: 'Single Use Tours',
      contactName: 'Marta Ruiz',
      contactEmail: `single-${Date.now()}@example.com`,
      categories: ['DINING'],
      hotelCommissionBps: 1200,
    })
    const token = invited.invitation!.token

    await acceptInvitationFor({ token, password: PASSWORD, confirmPassword: PASSWORD })

    const second = await acceptInvitationFor({
      token,
      password: 'a different passphrase here',
      confirmPassword: 'a different passphrase here',
    }).catch((e: unknown) => e)
    expect(isAppError(second) && second.code).toBe('CONFLICT')
  })

  it('refuses one concurrent acceptance of the two', async () => {
    const user = await prisma.user.create({
      data: { email: `race-${Date.now()}@example.com`, name: 'Race Condition' },
      select: { id: true },
    })
    const { token } = await createInvitation({ userId: user.id, kind: InvitationKind.STAFF })

    const outcomes = await Promise.allSettled([
      acceptInvitationFor({ token, password: PASSWORD, confirmPassword: PASSWORD }),
      acceptInvitationFor({ token, password: PASSWORD, confirmPassword: PASSWORD }),
    ])
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1)
  })

  it('refuses an expired invitation', async () => {
    const user = await prisma.user.create({
      data: { email: `expired-${Date.now()}@example.com`, name: 'Past Due' },
      select: { id: true },
    })
    const { token } = await createInvitation({
      userId: user.id,
      kind: InvitationKind.STAFF,
      now: new Date(Date.now() - 365 * 86_400_000),
    })

    const error = await getInvitation(token).catch((e: unknown) => e)
    expect(isAppError(error) && error.code).toBe('FORBIDDEN')
    await expect(
      acceptInvitationFor({ token, password: PASSWORD, confirmPassword: PASSWORD }),
    ).rejects.toThrow()
  })

  it('refuses a withdrawn invitation', async () => {
    const tenant = await createTenant()
    const actor = await actorFor(tenant.ownerUserId)
    const invited = await invitePartner(actor, tenant.propertyId, {
      name: 'Withdrawn Tours',
      contactName: 'Nadia Soto',
      contactEmail: `withdrawn-${Date.now()}@example.com`,
      categories: ['CULTURE'],
      hotelCommissionBps: 1000,
    })
    const token = invited.invitation!.token
    const row = await prisma.invitation.findUniqueOrThrow({
      where: { tokenHash: hashInvitationToken(token) },
      select: { id: true },
    })

    await revokeInvitation(actor, row.id)
    await expect(getInvitation(token)).rejects.toThrow()
  })

  it('refuses a token that does not exist, without saying more', async () => {
    const error = await getInvitation('a'.repeat(32)).catch((e: unknown) => e)
    expect(isAppError(error) && error.code).toBe('NOT_FOUND')
  })

  it('does not mint one for an email that already has an account', async () => {
    const existing = signUpInput()
    await registerOrganization(existing)

    const tenant = await createTenant()
    const actor = await actorFor(tenant.ownerUserId)

    // `invitePartner` refuses an email that already has an account outright
    // (ADR-021), so there is nothing to invite.
    await expect(
      invitePartner(actor, tenant.propertyId, {
        name: 'Clash Tours',
        contactName: 'Someone Else',
        contactEmail: existing.email,
        categories: ['DINING'],
        hotelCommissionBps: 1000,
      }),
    ).rejects.toThrow()
  })
})

describe('changeOwnPassword', () => {
  it('needs the current password', async () => {
    const input = signUpInput()
    const registered = await registerOrganization(input)
    const actor = await actorFor(registered.userId)

    await expect(
      changeOwnPassword(actor, { currentPassword: 'wrong', newPassword: 'a new passphrase here' }),
    ).rejects.toThrow()

    await changeOwnPassword(actor, {
      currentPassword: PASSWORD,
      newPassword: 'a new passphrase here',
    })
    await expect(
      verifyCredentials({ email: input.email, password: 'a new passphrase here' }),
    ).resolves.toBeTruthy()
  })

  it('refuses when the account has no password to confirm', async () => {
    const tenant = await createTenant()
    const actor = await actorFor(tenant.ownerUserId)
    await expect(
      changeOwnPassword(actor, { currentPassword: '', newPassword: 'a new passphrase here' }),
    ).rejects.toThrow()
  })
})

describe('hashPassword is what the services store', () => {
  it('never stores the password itself', async () => {
    const input = signUpInput()
    const registered = await registerOrganization(input)
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: registered.userId },
      select: { passwordHash: true },
    })
    expect(user.passwordHash).not.toContain(PASSWORD)
    expect(user.passwordHash).not.toBe(await hashPassword(PASSWORD))
  })
})

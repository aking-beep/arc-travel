import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { isAppError, type AppError } from '@/lib/errors'
import { stayReference } from '@/lib/ids'
import { hashPassword, verifyPassword } from '@/lib/password'
import { StayStatus } from '@/lib/prisma-types'
import { verifyCredentials } from '@/modules/auth/credentials'
import {
  claimStayForAccount,
  experienceTitle,
  getGuestAccount,
  hasGuestRecords,
  registerGuestAccount,
  registerGuestAccountFromPortal,
} from '@/modules/guest/account'
import { resolvePortalContext } from '@/modules/guest/portal'
import { createTenant, resetDatabase } from '../helpers/factory'

/**
 * Guest accounts (ADR-039).
 *
 * The claim is the whole security story, so most of this file is the ways a
 * claim must fail: a reference without its address, an address without its
 * reference, a cancelled booking, a booking whose portal has closed, and a
 * booking somebody already holds. Each of those is a way a stranger could
 * otherwise read a guest's itinerary, dietary notes and bookings.
 *
 * The rest proves the three things the account exists for: a person can hold
 * bookings at more than one property, they see only their own, and the
 * passwordless placeholder the front desk creates is theirs to take over
 * rather than a wall they cannot get past.
 */
const PASSWORD = 'a perfectly ordinary passphrase'

/**
 * Runs something that must be refused, and returns the `AppError` it threw.
 *
 * A `.catch()` on the call would type the result as a union of the success
 * shape and the error, and — worse — would pass silently if the call ever
 * stopped refusing. This fails instead.
 */
async function refusal(run: () => Promise<unknown>): Promise<AppError> {
  let caught: unknown = null
  try {
    await run()
  } catch (error) {
    caught = error ?? new Error('threw a falsy value')
  }
  if (caught === null) throw new Error('expected this to be refused, and it was not')
  if (!isAppError(caught)) throw caught
  return caught
}

interface Booking {
  organizationId: string
  propertyId: string
  guestId: string
  stayId: string
  reference: string
  portalToken: string
  email: string
  supplierId: string
  experienceId: string
  slotId: string
}

/**
 * A booking with no account behind it.
 *
 * The factory links its guest record to a user, which is the shape the front
 * desk and the demo seed both produce. The default keeps that link,
 * passwordless and on the guest's own address — the state a real deployment is
 * actually in when a guest first signs up. `placeholder: false` removes it.
 */
async function booking(
  options: Parameters<typeof createTenant>[0] & { placeholder?: boolean } = {},
): Promise<Booking> {
  const { placeholder = true, ...tenantOptions } = options
  const tenant = await createTenant(tenantOptions)

  const guest = await prisma.guest.findUniqueOrThrow({
    where: { id: tenant.guestId },
    select: { email: true, userId: true },
  })

  if (placeholder) {
    // The factory's placeholder user has an address of its own; a desk-created
    // one carries the guest's. Align them, which is what `holdsAccount`
    // requires before it will let the guest take the placeholder over.
    await prisma.user.update({
      where: { id: guest.userId as string },
      data: { email: guest.email },
    })
  } else {
    await prisma.guest.update({ where: { id: tenant.guestId }, data: { userId: null } })
  }

  const stay = await prisma.stay.findUniqueOrThrow({
    where: { id: tenant.stayId },
    select: { reference: true, portalToken: true },
  })

  return {
    organizationId: tenant.organizationId,
    propertyId: tenant.propertyId,
    guestId: tenant.guestId,
    stayId: tenant.stayId,
    reference: stay.reference,
    portalToken: stay.portalToken,
    email: guest.email,
    supplierId: tenant.supplierId,
    experienceId: tenant.experienceId,
    slotId: tenant.slotId,
  }
}

const signUp = (over: Record<string, unknown> = {}) => ({
  name: 'Ana Rivera',
  password: PASSWORD,
  confirmPassword: PASSWORD,
  acceptedTerms: true,
  ...over,
})

const portalInput = () => ({
  name: 'Ana Rivera',
  password: PASSWORD,
  confirmPassword: PASSWORD,
  acceptedTerms: true,
})

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('registerGuestAccount', () => {
  it('creates the account, links the booking and sets a usable password', async () => {
    const stay = await booking({ placeholder: false })

    const result = await registerGuestAccount(
      signUp({ email: stay.email, reference: stay.reference }),
    )

    expect(result.stayId).toBe(stay.stayId)
    expect(result.guestId).toBe(stay.guestId)

    const guest = await prisma.guest.findUniqueOrThrow({
      where: { id: stay.guestId },
      select: { userId: true },
    })
    expect(guest.userId).toBe(result.userId)

    // The password is a real credential, not a placeholder.
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: result.userId },
      select: { email: true, passwordHash: true },
    })
    expect(await verifyPassword(PASSWORD, user.passwordHash as string)).toBe(true)
    await expect(verifyCredentials({ email: user.email, password: PASSWORD })).resolves.toBe(
      result.userId,
    )

    expect(await hasGuestRecords(result.userId)).toBe(true)
  })

  it('takes over the passwordless account the front desk created, rather than refusing', async () => {
    const stay = await booking()
    const before = await prisma.guest.findUniqueOrThrow({
      where: { id: stay.guestId },
      select: { userId: true },
    })
    expect(before.userId).not.toBeNull()

    const result = await registerGuestAccount(
      signUp({ email: stay.email, reference: stay.reference }),
    )

    // The same identity, now with a credential — not a second user at the same
    // address, which the unique constraint would refuse anyway.
    expect(result.userId).toBe(before.userId)
    expect(await prisma.user.count({ where: { email: stay.email } })).toBe(1)
    await expect(verifyCredentials({ email: stay.email, password: PASSWORD })).resolves.toBe(
      result.userId,
    )
  })

  it('refuses a placeholder that belongs to a different address', async () => {
    const stay = await booking({ placeholder: false })
    const stranger = await prisma.user.create({
      data: { email: `stranger-${stay.email}`, name: 'A Stranger' },
    })
    await prisma.guest.update({ where: { id: stay.guestId }, data: { userId: stranger.id } })

    const error = await refusal(() =>
      registerGuestAccount(signUp({ email: stay.email, reference: stay.reference })),
    )
    expect(error.code).toBe('VALIDATION_FAILED')

    const unchanged = await prisma.user.findUniqueOrThrow({
      where: { id: stranger.id },
      select: { name: true, passwordHash: true },
    })
    expect(unchanged.name).toBe('A Stranger')
    expect(unchanged.passwordHash).toBeNull()
  })

  it('accepts a reference typed without its hyphens, in lower case', async () => {
    const stay = await booking({ placeholder: false })
    // The real generator's shape, not the factory's: `STAY-7K4M-QX2P` is what
    // a guest reads off a confirmation, and dropping its hyphens is what they
    // do when they type it.
    const minted = stayReference()
    await prisma.stay.update({ where: { id: stay.stayId }, data: { reference: minted } })

    const result = await registerGuestAccount(
      signUp({ email: stay.email, reference: minted.replace(/-/g, '').toLowerCase() }),
    )
    expect(result.stayId).toBe(stay.stayId)
  })

  it('records the claim in the audit trail without the address or the reference', async () => {
    const stay = await booking({ placeholder: false })
    await registerGuestAccount(signUp({ email: stay.email, reference: stay.reference }))

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { action: 'guest.account.registered' },
      select: { actorKind: true, entityId: true, metadataJson: true },
    })
    expect(event.actorKind).toBe('guest')
    expect(event.entityId).toBe(stay.guestId)

    const metadata = JSON.stringify(event.metadataJson)
    expect(metadata).toContain('reference')
    // Field names, not values.
    expect(metadata).not.toContain(stay.email)
    expect(metadata).not.toContain(stay.reference)
  })

  it('refuses a real reference with the wrong address, and leaves no account behind', async () => {
    const stay = await booking({ placeholder: false })

    const error = await refusal(() =>
      registerGuestAccount(signUp({ email: 'someone-else@example.com', reference: stay.reference })),
    )
    expect(error.code).toBe('VALIDATION_FAILED')
    expect(await prisma.user.findUnique({ where: { email: 'someone-else@example.com' } })).toBeNull()

    const guest = await prisma.guest.findUniqueOrThrow({
      where: { id: stay.guestId },
      select: { userId: true },
    })
    expect(guest.userId).toBeNull()
  })

  it('refuses a real address with the wrong reference', async () => {
    const stay = await booking({ placeholder: false })

    const error = await refusal(() =>
      registerGuestAccount(signUp({ email: stay.email, reference: 'STAY-NOPE-NOPE' })),
    )
    expect(error.code).toBe('VALIDATION_FAILED')
  })

  it('refuses the wrong address and the wrong reference with the same message', async () => {
    const stay = await booking({ placeholder: false })

    const wrongEmail = await refusal(() =>
      registerGuestAccount(signUp({ email: 'someone-else@example.com', reference: stay.reference })),
    )
    const wrongReference = await refusal(() =>
      registerGuestAccount(signUp({ email: stay.email, reference: 'STAY-NOPE-NOPE' })),
    )

    // Any difference here answers "is that a real booking?" for free.
    expect(wrongEmail.message).toBe(wrongReference.message)
  })

  it('refuses a cancelled booking', async () => {
    const stay = await booking({ placeholder: false, stayStatus: StayStatus.CANCELLED })

    const error = await refusal(() =>
      registerGuestAccount(signUp({ email: stay.email, reference: stay.reference })),
    )
    expect(error.code).toBe('VALIDATION_FAILED')
  })

  it('refuses a booking whose portal has already closed', async () => {
    const stay = await booking({ placeholder: false })
    await prisma.stay.update({
      where: { id: stay.stayId },
      data: {
        checkIn: new Date('2026-01-01T00:00:00.000Z'),
        checkOut: new Date('2026-01-05T00:00:00.000Z'),
      },
    })

    const error = await refusal(() =>
      registerGuestAccount(signUp({ email: stay.email, reference: stay.reference })),
    )
    expect(error.code).toBe('VALIDATION_FAILED')
  })

  it('refuses a booking somebody has already claimed, and leaves their account alone', async () => {
    const stay = await booking({ placeholder: false })
    const first = await registerGuestAccount(
      signUp({ email: stay.email, reference: stay.reference }),
    )

    // A second person with the same two facts — the paper confirmation left in
    // the room — must not be able to take the booking over. They get the same
    // refusal as somebody with a wrong reference: whether a booking has been
    // claimed is not this form's to say.
    const error = await refusal(() =>
      registerGuestAccount(
        signUp({ name: 'Somebody Else', email: stay.email, reference: stay.reference }),
      ),
    )
    expect(error.code).toBe('VALIDATION_FAILED')

    const guest = await prisma.guest.findUniqueOrThrow({
      where: { id: stay.guestId },
      select: { userId: true },
    })
    expect(guest.userId).toBe(first.userId)

    // And the first person's credential still works, unchanged.
    await expect(verifyCredentials({ email: stay.email, password: PASSWORD })).resolves.toBe(
      first.userId,
    )
  })

  it('takes over an orphan placeholder left by an earlier claim at another property', async () => {
    // The shape `claimStayForAccount` creates when it absorbs a placeholder:
    // a credential-free user at this address with no guest records left. It
    // blocks `User.email`, nothing can sign into it, and there is no password
    // reset — so refusing here would refuse that address forever.
    const stay = await booking({ placeholder: false })
    const orphan = await prisma.user.create({
      data: { email: stay.email, name: 'Desk Placeholder' },
    })

    const result = await registerGuestAccount(
      signUp({ email: stay.email, reference: stay.reference }),
    )

    expect(result.userId).toBe(orphan.id)
    expect(await prisma.user.count({ where: { email: stay.email } })).toBe(1)
    await expect(verifyCredentials({ email: stay.email, password: PASSWORD })).resolves.toBe(
      result.userId,
    )
  })

  it('refuses an address that already has a real ARC account elsewhere', async () => {
    const stay = await booking({ placeholder: false })
    await prisma.user.create({
      data: {
        email: stay.email,
        name: 'Already Here',
        passwordHash: await hashPassword('some other passphrase entirely'),
      },
    })

    const error = await refusal(() =>
      registerGuestAccount(signUp({ email: stay.email, reference: stay.reference })),
    )
    expect(error.code).toBe('CONFLICT')
    expect(await prisma.user.count({ where: { email: stay.email } })).toBe(1)
  })
})

describe('registerGuestAccountFromPortal', () => {
  it('claims the stay the token names, with no reference or address typed', async () => {
    const stay = await booking({ placeholder: false })
    const context = await resolvePortalContext(stay.portalToken)
    expect(context.hasAccount).toBe(false)

    const { userId } = await registerGuestAccountFromPortal(
      { stayReference: context.reference, guestEmail: context.guestEmail },
      portalInput(),
    )

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    })
    expect(user.email).toBe(stay.email.toLowerCase())

    // The portal now knows the record is claimed, and nothing more than that.
    const after = await resolvePortalContext(stay.portalToken)
    expect(after.hasAccount).toBe(true)
  })

  it('does not treat the front desk’s passwordless placeholder as claimed', async () => {
    const stay = await booking()
    const context = await resolvePortalContext(stay.portalToken)

    // The whole point: a guest record the desk linked to a credential-free
    // user is not an account anybody holds, so the offer still stands.
    expect(context.hasAccount).toBe(false)

    const { userId } = await registerGuestAccountFromPortal(
      { stayReference: context.reference, guestEmail: context.guestEmail },
      portalInput(),
    )
    expect(await resolvePortalContext(stay.portalToken)).toMatchObject({ hasAccount: true })
    await expect(verifyCredentials({ email: stay.email, password: PASSWORD })).resolves.toBe(userId)
  })

  it('refuses when the booking was claimed between the page and the submit', async () => {
    const stay = await booking({ placeholder: false })
    const context = await resolvePortalContext(stay.portalToken)

    const other = await prisma.user.create({
      data: {
        email: stay.email,
        name: 'First Person',
        passwordHash: await hashPassword('the first person’s passphrase'),
      },
    })
    await prisma.guest.update({ where: { id: context.guestId }, data: { userId: other.id } })

    const error = await refusal(() =>
      registerGuestAccountFromPortal(
        { stayReference: context.reference, guestEmail: context.guestEmail },
        portalInput(),
      ),
    )
    expect(error.code).toBe('CONFLICT')

    const guest = await prisma.guest.findUniqueOrThrow({
      where: { id: context.guestId },
      select: { userId: true },
    })
    expect(guest.userId).toBe(other.id)
  })

  it('refuses a cancelled booking, as the cold form does', async () => {
    const stay = await booking({ placeholder: false })
    const context = await resolvePortalContext(stay.portalToken)
    await prisma.stay.update({
      where: { id: stay.stayId },
      data: { status: StayStatus.CANCELLED },
    })

    const error = await refusal(() =>
      registerGuestAccountFromPortal(
        { stayReference: context.reference, guestEmail: context.guestEmail },
        portalInput(),
      ),
    )
    expect(error.code).toBe('NOT_FOUND')
  })
})

describe('claimStayForAccount', () => {
  it('adds a booking at a second property to the same account', async () => {
    const first = await booking({ name: 'Casa Uno', placeholder: false })
    const second = await booking({ name: 'Casa Dos', placeholder: false })

    const account = await registerGuestAccount(
      signUp({ email: first.email, reference: first.reference }),
    )

    // Deliberately a different address: hotels hold whatever they were given,
    // and the account's own address is only the fallback.
    const claimed = await claimStayForAccount(account.userId, {
      reference: second.reference,
      email: second.email,
    })
    expect(claimed.stayId).toBe(second.stayId)

    const view = await getGuestAccount(account.userId)
    expect(view?.stays.map((s) => s.stayId).sort()).toEqual([first.stayId, second.stayId].sort())
    // Two guest records, one account — the thing the UNIQUE constraint on
    // Guest.userId used to make impossible.
    expect(await prisma.guest.count({ where: { userId: account.userId } })).toBe(2)
  })

  it('absorbs the placeholder on a second property rather than refusing', async () => {
    const first = await booking({ name: 'Casa Uno', placeholder: false })
    const second = await booking({ name: 'Casa Dos' })

    const account = await registerGuestAccount(
      signUp({ email: first.email, reference: first.reference }),
    )

    const claimed = await claimStayForAccount(account.userId, {
      reference: second.reference,
      email: second.email,
    })
    expect(claimed.stayId).toBe(second.stayId)

    const guest = await prisma.guest.findUniqueOrThrow({
      where: { id: second.guestId },
      select: { userId: true },
    })
    expect(guest.userId).toBe(account.userId)
  })

  it('falls back to the address on the account when the form left it blank', async () => {
    const stay = await booking({ placeholder: false })
    const account = await registerGuestAccount(
      signUp({ email: stay.email, reference: stay.reference }),
    )

    // A second stay at the same property, so the same guest record and so the
    // same address.
    const second = await prisma.stay.create({
      data: {
        organizationId: stay.organizationId,
        propertyId: stay.propertyId,
        guestId: stay.guestId,
        reference: 'STAY-SAME-GUES',
        checkIn: new Date(Date.now() + 40 * 86_400_000),
        checkOut: new Date(Date.now() + 44 * 86_400_000),
        portalToken: 'token-same-guest-second-stay',
        currency: 'MXN',
      },
      select: { id: true },
    })

    const claimed = await claimStayForAccount(account.userId, { reference: 'STAY-SAME-GUES' })
    expect(claimed.stayId).toBe(second.id)
  })

  it('is idempotent for a booking the account already holds', async () => {
    const stay = await booking({ placeholder: false })
    const account = await registerGuestAccount(
      signUp({ email: stay.email, reference: stay.reference }),
    )

    const again = await claimStayForAccount(account.userId, {
      reference: stay.reference,
      email: stay.email,
    })
    expect(again.stayId).toBe(stay.stayId)
  })

  it('refuses a booking that belongs to somebody else', async () => {
    const mine = await booking({ name: 'Casa Mia', placeholder: false })
    const theirs = await booking({ name: 'Casa Suya', placeholder: false })

    const me = await registerGuestAccount(signUp({ email: mine.email, reference: mine.reference }))
    await registerGuestAccount(
      signUp({ name: 'Someone Else', email: theirs.email, reference: theirs.reference }),
    )

    const error = await refusal(() =>
      claimStayForAccount(me.userId, { reference: theirs.reference, email: theirs.email }),
    )
    expect(error.code).toBe('VALIDATION_FAILED')

    const view = await getGuestAccount(me.userId)
    expect(view?.stays).toHaveLength(1)
  })
})

describe('establishAccount concurrency', () => {
  it('a claim that lost the race does not overwrite the winner', async () => {
    const first = await booking({ name: 'Casa Uno', placeholder: false })
    const second = await booking({ name: 'Casa Dos' })

    const account = await registerGuestAccount(
      signUp({ email: first.email, reference: first.reference }),
    )

    // Both callers read `second`'s guest record while it still pointed at the
    // placeholder, and both go on to write it. One of them has to lose.
    const outcomes = await Promise.allSettled([
      claimStayForAccount(account.userId, { reference: second.reference, email: second.email }),
      registerGuestAccountFromPortal(
        { stayReference: second.reference, guestEmail: second.email },
        portalInput(),
      ),
    ])

    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1)

    // Whoever won, the booking belongs to exactly one account and the record
    // was not left pointing at the loser.
    const guest = await prisma.guest.findUniqueOrThrow({
      where: { id: second.guestId },
      select: { userId: true },
    })
    expect(guest.userId).not.toBeNull()

    const owner = await prisma.user.findUniqueOrThrow({
      where: { id: guest.userId as string },
      select: { passwordHash: true },
    })
    // And the owner is a real account rather than the placeholder: nobody is
    // left holding a booking they cannot sign in to.
    expect(owner.passwordHash).not.toBeNull()
  })
})

describe('getGuestAccount', () => {
  it('shows only the signed-in person’s bookings', async () => {
    const mine = await booking({ name: 'Casa Mia', placeholder: false })
    const theirs = await booking({ name: 'Casa Suya', placeholder: false })

    const me = await registerGuestAccount(signUp({ email: mine.email, reference: mine.reference }))
    const them = await registerGuestAccount(
      signUp({ name: 'Someone Else', email: theirs.email, reference: theirs.reference }),
    )

    expect((await getGuestAccount(me.userId))?.stays.map((s) => s.stayId)).toEqual([mine.stayId])
    expect((await getGuestAccount(them.userId))?.stays.map((s) => s.stayId)).toEqual([
      theirs.stayId,
    ])
  })

  it('offers the portal link while the stay is live', async () => {
    const stay = await booking({ placeholder: false })
    const account = await registerGuestAccount(
      signUp({ email: stay.email, reference: stay.reference }),
    )

    const view = await getGuestAccount(account.userId)
    expect(view?.stays[0]?.portalPath).toBe(`/g/${stay.portalToken}`)
  })

  it('withholds the portal link once the grace window has passed', async () => {
    const stay = await booking({ placeholder: false })
    const account = await registerGuestAccount(
      signUp({ email: stay.email, reference: stay.reference }),
    )

    // Moved after the claim: the account keeps the receipt, and the link that
    // would 404 is not offered. A dead link on this page reads as lost data.
    await prisma.stay.update({
      where: { id: stay.stayId },
      data: {
        checkIn: new Date('2026-01-01T00:00:00.000Z'),
        checkOut: new Date('2026-01-05T00:00:00.000Z'),
        status: StayStatus.CHECKED_OUT,
      },
    })

    const view = await getGuestAccount(account.userId)
    expect(view?.stays).toHaveLength(1)
    expect(view?.stays[0]?.portalPath).toBeNull()
  })

  it('leaves out a cancelled stay', async () => {
    const stay = await booking({ placeholder: false })
    const account = await registerGuestAccount(
      signUp({ email: stay.email, reference: stay.reference }),
    )
    await prisma.stay.update({
      where: { id: stay.stayId },
      data: { status: StayStatus.CANCELLED },
    })

    expect((await getGuestAccount(account.userId))?.stays).toHaveLength(0)
  })

  it('carries both titles for a booked item, so the account can be read in Spanish', async () => {
    const stay = await booking({ placeholder: false })
    const account = await registerGuestAccount(
      signUp({ email: stay.email, reference: stay.reference }),
    )

    const order = await prisma.order.create({
      data: {
        organizationId: stay.organizationId,
        propertyId: stay.propertyId,
        guestId: stay.guestId,
        stayId: stay.stayId,
        reference: 'ARC-TEST-TITL',
        currency: 'MXN',
        totalMinor: 95_000,
      },
      select: { id: true },
    })
    await prisma.experience.update({
      where: { id: stay.experienceId },
      data: { titleEs: 'Clase de surf para principiantes' },
    })
    await prisma.orderItem.create({
      data: {
        organizationId: stay.organizationId,
        orderId: order.id,
        experienceId: stay.experienceId,
        slotId: stay.slotId,
        supplierId: stay.supplierId,
        quantity: 2,
        unitPriceMinor: 47_500,
        lineTotalMinor: 95_000,
        currency: 'MXN',
      },
    })

    const view = await getGuestAccount(account.userId)
    const item = view?.stays[0]?.orders[0]?.items[0]
    expect(item?.titleEs).toBe('Clase de surf para principiantes')
    expect(experienceTitle(item!, 'es')).toBe('Clase de surf para principiantes')
    // English falls back to itself, and a missing Spanish title falls back to
    // English rather than rendering blank.
    expect(experienceTitle({ titleEn: 'Sunrise surf', titleEs: null }, 'es')).toBe('Sunrise surf')
    expect(experienceTitle(item!, 'en')).toBe(item?.titleEn)
  })

  it('returns null for an account that no longer exists', async () => {
    expect(await getGuestAccount('00000000-0000-0000-0000-000000000000')).toBeNull()
  })
})

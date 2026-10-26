import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { isAppError, type AppError } from '@/lib/errors'
import { hashPassword, verifyPassword } from '@/lib/password'
import { resetEnvCache } from '@/lib/env'
import { EmailKind, EmailStatus, Locale } from '@/lib/prisma-types'
import {
  completePasswordReset,
  getResetToken,
  hashResetToken,
  requestPasswordReset,
  RESET_TTL_MINUTES,
} from '@/modules/auth/password-reset'
import { invitePartner } from '@/modules/hotels/service'
import { resetMailer } from '@/modules/notifications/providers'
import {
  dispatchQueued,
  listOrganizationEmails,
  MAX_ATTEMPTS,
  publicUrl,
  queueEmail,
} from '@/modules/notifications/service'
import { resetRateLimitCounters } from '@/lib/rate-limit'
import { actorFor, createTenant, resetDatabase } from '../helpers/factory'

/**
 * Transactional email and the password reset it makes possible (ADR-040).
 *
 * The things worth proving against a real database:
 *
 *   - a message is *recorded* even when nothing is delivered, because that is
 *     what makes `MAIL_PROVIDER=log` an honest mode rather than a silent one;
 *   - the queue converges — a message that could not be sent is retried, and a
 *     message that can never be sent stops being retried;
 *   - a reset is single-use, expires, and is superseded by a newer one;
 *   - a reset says nothing about whether an address has an account;
 *   - a passwordless placeholder cannot be taken over by asking for a reset,
 *     which would be a way round the invitation and the booking claim;
 *   - an owner's mail log is scoped to their own organization, and never shows
 *     a password reset.
 */
const PASSWORD = 'a perfectly ordinary passphrase'
const PUBLIC_URL = 'https://stay.test.example.com'

async function refusal(run: () => Promise<unknown>): Promise<AppError> {
  try {
    await run()
  } catch (error) {
    if (isAppError(error)) return error
    throw error
  }
  throw new Error('Expected a refusal, and the call succeeded.')
}

beforeEach(async () => {
  await resetDatabase()
  await resetRateLimitCounters()
  /*
   * A public url and nothing else: messages are composed in full and
   * delivered by the logging mailer, which is the default. That is the
   * configuration a demo runs in, and the one where a bug is invisible unless
   * a test asserts on the recorded row.
   */
  process.env.ARC_PUBLIC_URL = PUBLIC_URL
  delete process.env.ARC_ENABLE_TRANSACTIONAL_EMAIL
  delete process.env.MAIL_PROVIDER
  resetEnvCache()
  resetMailer()
})

afterEach(() => {
  delete process.env.ARC_PUBLIC_URL
  delete process.env.ARC_ENABLE_TRANSACTIONAL_EMAIL
  resetEnvCache()
  resetMailer()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('the queue', () => {
  const message = (overrides: Record<string, unknown> = {}) => ({
    kind: EmailKind.PASSWORD_RESET,
    organizationId: null,
    to: { address: 'someone@example.com', name: 'Someone' },
    locale: 'en' as const,
    rendered: { subject: 'A subject', text: 'A body with a link.' },
    ...overrides,
  })

  it('records a message that the logging mailer deliberately does not deliver', async () => {
    const id = await queueEmail(message())

    const queued = await prisma.emailMessage.findUniqueOrThrow({ where: { id } })
    expect(queued.status).toBe(EmailStatus.QUEUED)
    expect(queued.attempts).toBe(0)
    expect(queued.sentAt).toBeNull()

    // Nothing is attempted while the switch is off: the message waits, and
    // turning the switch on later sends the backlog.
    const deferred = await dispatchQueued({ ids: [id] })
    expect(deferred).toMatchObject({ sent: 0, logged: 0, failed: 0, deferred: 1 })
    expect((await prisma.emailMessage.findUniqueOrThrow({ where: { id } })).attempts).toBe(0)

    process.env.ARC_ENABLE_TRANSACTIONAL_EMAIL = '1'
    resetEnvCache()
    resetMailer()

    const outcome = await dispatchQueued({ ids: [id] })
    expect(outcome).toMatchObject({ sent: 0, logged: 1, failed: 0 })

    const logged = await prisma.emailMessage.findUniqueOrThrow({ where: { id } })
    /*
     * LOGGED, not SENT. The provider returned ok and delivered nothing, and
     * recording that as sent is the exact lie this status exists to prevent.
     */
    expect(logged.status).toBe(EmailStatus.LOGGED)
    expect(logged.provider).toBe('log')
    expect(logged.sentAt).not.toBeNull()
    expect(logged.body).toContain('A body with a link.')
  })

  it('refuses an address that could never be a recipient', async () => {
    const error = await refusal(() => queueEmail(message({ to: { address: 'not-an-address' } })))
    expect(error.status).toBe(422)
    expect(await prisma.emailMessage.count()).toBe(0)
  })

  it('normalises the address and keeps the name as typed', async () => {
    const id = await queueEmail(message({ to: { address: '  Someone@Example.COM ', name: ' Ana ' } }))
    const row = await prisma.emailMessage.findUniqueOrThrow({ where: { id } })
    expect(row.toAddress).toBe('someone@example.com')
    expect(row.toName).toBe('Ana')
  })

  it('stores the locale it was written in', async () => {
    const id = await queueEmail(message({ locale: 'es' }))
    expect((await prisma.emailMessage.findUniqueOrThrow({ where: { id } })).locale).toBe(Locale.ES)
  })

  it('stops retrying a message that has used up its attempts', async () => {
    const id = await queueEmail(message())
    await prisma.emailMessage.update({ where: { id }, data: { attempts: MAX_ATTEMPTS } })

    process.env.ARC_ENABLE_TRANSACTIONAL_EMAIL = '1'
    resetEnvCache()
    resetMailer()

    // Not claimed at all: the dispatcher's `where` excludes it, so a
    // permanently-bad address cannot be retried for ever.
    const outcome = await dispatchQueued({ limit: 10 })
    expect(outcome).toMatchObject({ sent: 0, logged: 0, failed: 0, deferred: 0 })
  })

  it('takes the oldest first, and only queued ones', async () => {
    const older = await queueEmail(message({ rendered: { subject: 'Older', text: 'x' } }))
    const newer = await queueEmail(message({ rendered: { subject: 'Newer', text: 'y' } }))
    await prisma.emailMessage.update({
      where: { id: older },
      data: { queuedAt: new Date(Date.now() - 60_000) },
    })
    await prisma.emailMessage.update({
      where: { id: newer },
      data: { status: EmailStatus.SENT, attempts: 1, sentAt: new Date() },
    })

    process.env.ARC_ENABLE_TRANSACTIONAL_EMAIL = '1'
    resetEnvCache()
    resetMailer()

    const outcome = await dispatchQueued({ limit: 10 })
    expect(outcome.logged).toBe(1)
    // The one already sent is untouched — no second delivery of the same thing.
    const sent = await prisma.emailMessage.findUniqueOrThrow({ where: { id: newer } })
    expect(sent.attempts).toBe(1)
  })

  it('refuses to build a link when no public url is configured', async () => {
    delete process.env.ARC_PUBLIC_URL
    resetEnvCache()
    /*
     * Rather than falling back to a relative path or a request header: these
     * links carry invitation, portal and reset tokens, and a link built from a
     * header points wherever the sender of the request said.
     */
    expect(() => publicUrl('/invite/abc')).toThrow(/ARC_PUBLIC_URL/)
  })
})

describe('the database invariants on a message', () => {
  it('refuses a SENT row with no sent timestamp', async () => {
    const id = await queueEmail({
      kind: EmailKind.PASSWORD_RESET,
      organizationId: null,
      to: { address: 'someone@example.com' },
      locale: 'en',
      rendered: { subject: 'A subject', text: 'A body.' },
    })

    await expect(
      prisma.emailMessage.update({
        where: { id },
        data: { status: EmailStatus.SENT, attempts: 1 },
      }),
    ).rejects.toThrow(/email_status_matches_timestamps/)
  })

  it('refuses a delivered row that was never attempted', async () => {
    const id = await queueEmail({
      kind: EmailKind.PASSWORD_RESET,
      organizationId: null,
      to: { address: 'someone@example.com' },
      locale: 'en',
      rendered: { subject: 'A subject', text: 'A body.' },
    })

    await expect(
      prisma.emailMessage.update({
        where: { id },
        data: { status: EmailStatus.SENT, sentAt: new Date(), attempts: 0 },
      }),
    ).rejects.toThrow(/email_attempts_sane/)
  })
})

describe('inviting a partner', () => {
  it('queues the invitation and tells the owner it was recorded, not sent', async () => {
    const tenant = await createTenant()
    const actor = await actorFor(tenant.ownerUserId)

    process.env.ARC_ENABLE_TRANSACTIONAL_EMAIL = '1'
    resetEnvCache()
    resetMailer()

    const result = await invitePartner(actor, tenant.propertyId, {
      name: 'Escuela Olas Verdes',
      contactName: 'Mariana',
      contactEmail: 'mariana@olasverdes.example',
      categories: ['SURF'],
      hotelCommissionBps: 1500,
      contactLocale: 'ES',
    })

    // The link is still handed to the owner. Mail is the convenience; the link
    // in their hands is what works when a provider silently drops it.
    expect(result.invitation).not.toBeNull()
    expect(result.emailStatus).toBe('logged')

    const [message] = await listOrganizationEmails(tenant.organizationId)
    expect(message?.kind).toBe(EmailKind.PARTNER_INVITATION)
    expect(message?.toAddress).toBe('mariana@olasverdes.example')
    // Written in the language the owner chose for them, and carrying the link.
    expect(message?.body).toContain(result.invitation!.token)
    expect(message?.body).toContain('Escuela Olas Verdes')
    expect(message?.subject).toContain('te invita')
  })

  it('says the message is queued when delivery is switched off, not that nothing was sent', async () => {
    /*
     * The difference matters to an owner: a queued message goes out when the
     * switch is turned on, so "no email was sent" would be true now and wrong
     * in an hour.
     */
    const tenant = await createTenant()
    const actor = await actorFor(tenant.ownerUserId)

    const result = await invitePartner(actor, tenant.propertyId, {
      name: 'Lancha Azul',
      contactName: 'Pedro',
      contactEmail: 'pedro@lancha.example',
      categories: ['ADVENTURE'],
      hotelCommissionBps: 1500,
      contactLocale: 'ES',
    })

    expect(result.emailStatus).toBe('queued')
    const [message] = await listOrganizationEmails(tenant.organizationId)
    expect(message?.status).toBe(EmailStatus.QUEUED)
    expect(message?.attempts).toBe(0)
  })

  it('says the mail was not configured rather than claiming it was sent', async () => {
    const tenant = await createTenant()
    const actor = await actorFor(tenant.ownerUserId)

    delete process.env.ARC_PUBLIC_URL
    resetEnvCache()
    resetMailer()

    const result = await invitePartner(actor, tenant.propertyId, {
      name: 'Taller Jiménez',
      contactName: 'Luis',
      contactEmail: 'luis@taller.example',
      categories: ['CULTURE'],
      hotelCommissionBps: 1000,
      contactLocale: 'ES',
    })

    expect(result.invitation).not.toBeNull()
    expect(result.emailStatus).toBe('unconfigured')
    expect(await prisma.emailMessage.count()).toBe(0)
  })

  it('records the partner contact in the language the owner chose', async () => {
    const tenant = await createTenant()
    const actor = await actorFor(tenant.ownerUserId)

    await invitePartner(actor, tenant.propertyId, {
      name: 'Cocina Abuela',
      contactName: 'Rosa',
      contactEmail: 'rosa@cocina.example',
      categories: ['DINING'],
      hotelCommissionBps: 1200,
      contactLocale: 'ES',
    })

    const contact = await prisma.user.findUniqueOrThrow({
      where: { email: 'rosa@cocina.example' },
      select: { locale: true, passwordHash: true },
    })
    expect(contact.locale).toBe(Locale.ES)
    // Still no password: ARC never invents a credential for someone else.
    expect(contact.passwordHash).toBeNull()
  })
})

describe('the owner mail log', () => {
  it('shows only this organization, and never a password reset', async () => {
    const mine = await createTenant({ name: 'mine' })
    const theirs = await createTenant({ name: 'theirs' })

    await queueEmail({
      kind: EmailKind.GUEST_PORTAL_LINK,
      organizationId: mine.organizationId,
      to: { address: 'mine@example.com' },
      locale: 'en',
      rendered: { subject: 'Mine', text: 'x' },
    })
    await queueEmail({
      kind: EmailKind.GUEST_PORTAL_LINK,
      organizationId: theirs.organizationId,
      to: { address: 'theirs@example.com' },
      locale: 'en',
      rendered: { subject: 'Theirs', text: 'y' },
    })
    await queueEmail({
      kind: EmailKind.PASSWORD_RESET,
      // A reset belongs to an account, not a tenant, so it carries no
      // organization and the query cannot reach it.
      organizationId: null,
      to: { address: 'someone@example.com' },
      locale: 'en',
      rendered: { subject: 'Reset', text: 'z' },
    })

    const rows = await listOrganizationEmails(mine.organizationId)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.subject).toBe('Mine')
  })
})

describe('asking for a password reset', () => {
  async function accountWithPassword(email: string): Promise<string> {
    const user = await prisma.user.create({
      data: { email, name: 'Dana', passwordHash: await hashPassword(PASSWORD) },
      select: { id: true },
    })
    return user.id
  }

  it('mails a working link to an account that has a password', async () => {
    const userId = await accountWithPassword('owner@example.com')

    const outcome = await requestPasswordReset({ email: 'owner@example.com' })
    expect(outcome).toMatchObject({ accepted: true, deliveryConfigured: true })

    const [message] = await prisma.emailMessage.findMany({ where: { kind: EmailKind.PASSWORD_RESET } })
    expect(message?.toAddress).toBe('owner@example.com')
    expect(message?.organizationId).toBeNull()
    expect(message?.body).toContain(`${PUBLIC_URL}/reset-password/`)

    // Only the hash is stored, exactly as for an invitation: a leaked database
    // must not yield working reset links.
    const token = message!.body.match(/\/reset-password\/([A-Za-z0-9_-]+)/)![1]!
    const stored = await prisma.passwordResetToken.findUniqueOrThrow({
      where: { tokenHash: hashResetToken(token) },
      select: { userId: true, expiresAt: true },
    })
    expect(stored.userId).toBe(userId)
    const minutes = (stored.expiresAt.getTime() - Date.now()) / 60_000
    expect(minutes).toBeGreaterThan(RESET_TTL_MINUTES - 2)
    expect(minutes).toBeLessThanOrEqual(RESET_TTL_MINUTES)

    expect((await getResetToken(token)).email).toBe('owner@example.com')
  })

  it('answers identically for an address with no account', async () => {
    const outcome = await requestPasswordReset({ email: 'nobody@example.com' })
    /*
     * The same shape as the success case above. The accounts here are a named
     * list of boutique hotels and their partners, so "is this hotel on ARC" is
     * commercially interesting information to hand to whoever asks a form.
     */
    expect(outcome).toMatchObject({ accepted: true, deliveryConfigured: true })
    expect(await prisma.emailMessage.count()).toBe(0)
    expect(await prisma.passwordResetToken.count()).toBe(0)
  })

  it('refuses to reset a passwordless placeholder', async () => {
    /*
     * A credential-free `User` is a guest a front desk entered, or a partner
     * who has not accepted their invitation (ADR-039). Mailing a reset to one
     * would be a way to take over that account by asking, going round the
     * invitation or the booking claim that is supposed to prove the link.
     */
    await prisma.user.create({ data: { email: 'placeholder@example.com', name: 'Placeholder' } })

    const outcome = await requestPasswordReset({ email: 'placeholder@example.com' })
    expect(outcome.accepted).toBe(true)
    expect(await prisma.emailMessage.count()).toBe(0)
    expect(await prisma.passwordResetToken.count()).toBe(0)
  })

  it('supersedes an older link when a newer one is asked for', async () => {
    await accountWithPassword('owner@example.com')

    await requestPasswordReset({ email: 'owner@example.com' })
    const first = tokenFrom(await latestResetBody())

    await requestPasswordReset({ email: 'owner@example.com' })
    const second = tokenFrom(await latestResetBody())
    expect(second).not.toBe(first)

    // The link sitting in the inbox from the first request is dead, so
    // whoever reads that inbox next cannot use it.
    const error = await refusal(() => getResetToken(first))
    expect(error.status).toBe(403)
    expect((await getResetToken(second)).email).toBe('owner@example.com')
  })

  it('bounds requests per address', async () => {
    await accountWithPassword('owner@example.com')
    for (let i = 0; i < 5; i += 1) {
      await requestPasswordReset({ email: 'owner@example.com' })
    }
    const error = await refusal(() => requestPasswordReset({ email: 'owner@example.com' }))
    expect(error.status).toBe(429)
  })

  it('bounds requests per caller, so the form cannot be walked down a list', async () => {
    /*
     * Consumed before anything is looked up, so the limit reveals nothing
     * about which addresses existed — and so an attacker cannot use the
     * per-address limit's absence as the answer.
     */
    for (let i = 0; i < 10; i += 1) {
      await requestPasswordReset(
        { email: `nobody${i}@example.com` },
        { requesterKey: '198.51.100.7' },
      )
    }
    const error = await refusal(() =>
      requestPasswordReset({ email: 'another@example.com' }, { requesterKey: '198.51.100.7' }),
    )
    expect(error.status).toBe(429)
  })

  it('does not send when the deployment cannot compose a link', async () => {
    await accountWithPassword('owner@example.com')
    delete process.env.ARC_PUBLIC_URL
    resetEnvCache()

    const outcome = await requestPasswordReset({ email: 'owner@example.com' })
    // Said out loud, because silently dropping it leaves somebody waiting for
    // a link that is never coming.
    expect(outcome).toMatchObject({ accepted: true, deliveryConfigured: false })
    expect(await prisma.passwordResetToken.count()).toBe(0)
  })
})

describe('completing a password reset', () => {
  const NEW_PASSWORD = 'an entirely different passphrase'

  async function freshReset(email = 'owner@example.com'): Promise<{ userId: string; token: string }> {
    const user = await prisma.user.create({
      data: { email, name: 'Dana', passwordHash: await hashPassword(PASSWORD) },
      select: { id: true },
    })
    await requestPasswordReset({ email })
    return { userId: user.id, token: tokenFrom(await latestResetBody()) }
  }

  it('sets the password and marks the token used', async () => {
    const { userId, token } = await freshReset()

    const result = await completePasswordReset({
      token,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    })
    expect(result.email).toBe('owner@example.com')

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    })
    expect(await verifyPassword(NEW_PASSWORD, user.passwordHash!)).toBe(true)
    expect(await verifyPassword(PASSWORD, user.passwordHash!)).toBe(false)

    const stored = await prisma.passwordResetToken.findUniqueOrThrow({
      where: { tokenHash: hashResetToken(token) },
      select: { usedAt: true },
    })
    expect(stored.usedAt).not.toBeNull()
  })

  it('works exactly once', async () => {
    const { token } = await freshReset()
    await completePasswordReset({ token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })

    const error = await refusal(() =>
      completePasswordReset({ token, password: 'a third passphrase here', confirmPassword: 'a third passphrase here' }),
    )
    expect(error.status).toBe(403)
  })

  it('refuses two simultaneous submissions of the same link', async () => {
    /*
     * Single use is enforced by the `where` clause of an `updateMany`, not by
     * the read before it: a check-then-write loses this race, and the loser
     * would silently set a password over the winner's.
     */
    const { token } = await freshReset()

    const results = await Promise.allSettled([
      completePasswordReset({ token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }),
      completePasswordReset({ token, password: 'yet another passphrase', confirmPassword: 'yet another passphrase' }),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
  })

  it('refuses an expired link', async () => {
    const { token } = await freshReset()
    /*
     * `createdAt` moves with it, because `password_reset_window_is_forward`
     * forbids a window that closes before it opens — so the only way to age a
     * token is to age the whole row, which is also what really happens.
     */
    const past = new Date(Date.now() - 2 * RESET_TTL_MINUTES * 60_000)
    await prisma.passwordResetToken.update({
      where: { tokenHash: hashResetToken(token) },
      data: { createdAt: past, expiresAt: new Date(past.getTime() + 60_000) },
    })

    const error = await refusal(() =>
      completePasswordReset({ token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }),
    )
    expect(error.status).toBe(403)
  })

  it('refuses a superseded link even though it has not expired', async () => {
    const { token } = await freshReset()
    await requestPasswordReset({ email: 'owner@example.com' })

    const error = await refusal(() =>
      completePasswordReset({ token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }),
    )
    expect(error.status).toBe(403)
  })

  it('refuses a token that was never issued', async () => {
    const error = await refusal(() =>
      completePasswordReset({
        token: 'definitely-not-a-real-token-value',
        password: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      }),
    )
    expect(error.status).toBe(403)
  })

  it('refuses mismatched passwords before touching anything', async () => {
    const { userId, token } = await freshReset()
    /*
     * A `ZodError` rather than an `AppError`: the schema is parsed by the
     * service and `toFormState` turns it into field errors at the app edge,
     * which is the convention for every form in this codebase.
     */
    await expect(
      completePasswordReset({ token, password: NEW_PASSWORD, confirmPassword: 'something else' }),
    ).rejects.toThrow(/do not match/)

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    })
    expect(await verifyPassword(PASSWORD, user.passwordHash!)).toBe(true)
  })

  it('refuses if the account lost its password between the request and the reset', async () => {
    const { userId, token } = await freshReset()
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } })

    const error = await refusal(() =>
      completePasswordReset({ token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }),
    )
    expect(error.status).toBe(403)
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    })
    // Still a placeholder: the state no longer matches what was proved.
    expect(user.passwordHash).toBeNull()
  })
})

/** The body of the most recent reset message. */
async function latestResetBody(): Promise<string> {
  const row = await prisma.emailMessage.findFirstOrThrow({
    where: { kind: EmailKind.PASSWORD_RESET },
    orderBy: { queuedAt: 'desc' },
    select: { body: true },
  })
  return row.body
}

function tokenFrom(body: string): string {
  const match = body.match(/\/reset-password\/([A-Za-z0-9_-]+)/)
  if (!match) throw new Error('No reset link in the message body.')
  return match[1]!
}

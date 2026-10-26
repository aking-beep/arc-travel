import { prisma } from '@/lib/db'
import { getEnv } from '@/lib/env'
import { invalid } from '@/lib/errors'
import { createTranslator, type AppLocale } from '@/lib/i18n'
import { reportError } from '@/lib/observability'
import { EmailKind, EmailStatus, Locale, type Prisma } from '@/lib/prisma-types'
import { getMailer, isPermanentFailure } from './providers'
import { toHtml, type RenderedEmail } from './templates'

/**
 * Queueing and delivering transactional mail. See ADR-040.
 *
 * **Queued inside the transaction, delivered after it.** `queueEmail` takes a
 * `tx` and writes one `EmailMessage` row, so a confirmation and the order it
 * confirms commit together or not at all. Nothing is sent from inside that
 * transaction: a `fetch` inside a Serializable block holds the block open for
 * the length of somebody else's network, and a mail outage would roll back a
 * paid booking. Sending is `dispatchQueued`, called by the caller once its
 * transaction has committed and by `/api/cron/dispatch-email` for everything a
 * caller did not get to — a crash between commit and dispatch must cost a delay
 * rather than a lost invitation.
 *
 * **One recipient, from the record.** `queueEmail` takes an address, and every
 * caller passes one already on the entity the action touched. There is no
 * audience form of this function and there must not be one: a second recipient
 * is outbound messaging, which is a kill switch and not this (non-negotiable 6).
 */

/** Delivery attempts before a message is left alone. */
export const MAX_ATTEMPTS = 5

/** Messages one dispatcher run will claim. */
const DISPATCH_BATCH = 25

export interface QueueEmailInput {
  kind: EmailKind
  organizationId: string | null
  to: { address: string; name?: string | null }
  locale: AppLocale
  rendered: RenderedEmail
  /** What this message is about, for the log. */
  about?: { entityType: string; entityId: string } | null
  /** The signed-in actor whose action caused it, where there is one. */
  causedByUserId?: string | null
}

/**
 * Writes one message to the queue. Returns its id so the caller can dispatch it.
 *
 * Validates the address here rather than trusting the call site: this is the
 * one funnel every message passes through, and an address that cannot be a
 * recipient is a row the dispatcher retries five times for nothing.
 */
export async function queueEmail(
  input: QueueEmailInput,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<string> {
  const address = input.to.address.trim().toLowerCase()
  if (!isPlausibleAddress(address)) {
    throw invalid('A message cannot be queued without a valid email address.', {
      toAddress: 'This does not look like an email address.',
    })
  }

  const message = await tx.emailMessage.create({
    data: {
      kind: input.kind,
      organizationId: input.organizationId,
      toAddress: address,
      toName: input.to.name?.trim() || null,
      locale: input.locale === 'es' ? Locale.ES : Locale.EN,
      subject: input.rendered.subject,
      body: input.rendered.text,
      entityType: input.about?.entityType ?? null,
      entityId: input.about?.entityId ?? null,
      causedByUserId: input.causedByUserId ?? null,
      status: EmailStatus.QUEUED,
    },
    select: { id: true },
  })

  return message.id
}

/**
 * Delivers queued messages.
 *
 * `ids` dispatches exactly those, which is what a caller does immediately after
 * its transaction commits. With no ids it takes the oldest queued batch, which
 * is what the cron route does.
 *
 * Never throws. A caller is a server action that has already committed
 * something the user cares about, and failing that action because mail is down
 * would roll nothing back and report a success as a failure. A message that
 * could not be delivered stays in the queue with its reason recorded.
 */
export async function dispatchQueued(options?: { ids?: string[]; limit?: number }): Promise<{
  sent: number
  logged: number
  failed: number
  deferred: number
}> {
  const env = getEnv()
  const mailer = getMailer()

  const candidates = await prisma.emailMessage.findMany({
    where: {
      status: EmailStatus.QUEUED,
      attempts: { lt: MAX_ATTEMPTS },
      ...(options?.ids ? { id: { in: options.ids } } : {}),
    },
    orderBy: { queuedAt: 'asc' },
    take: options?.limit ?? (options?.ids ? options.ids.length : DISPATCH_BATCH),
    select: {
      id: true,
      toAddress: true,
      toName: true,
      subject: true,
      body: true,
      attempts: true,
    },
  })

  const outcome = { sent: 0, logged: 0, failed: 0, deferred: 0 }

  for (const message of candidates) {
    /*
     * The switch is read per message, not per run.
     *
     * `ARC_ENABLE_TRANSACTIONAL_EMAIL` being off is not a failure and must not
     * consume an attempt: the message stays queued, and turning the switch on
     * sends the backlog. A deployment that was configured after its first
     * invitation was created should still deliver that invitation.
     */
    if (!env.ARC_ENABLE_TRANSACTIONAL_EMAIL) {
      outcome.deferred += 1
      continue
    }

    /*
     * Claim the row before sending it, or let the other worker have it.
     *
     * The query above is a read, and two workers do run at once: every caller
     * dispatches straight after its own commit while `/api/cron/dispatch-email`
     * runs on a schedule, and a send can take seconds. Both read the same
     * QUEUED row and both deliver it, so a guest gets two confirmations — or
     * two copies of a portal link, which is a bearer credential (ADR-035).
     *
     * The claim is the attempt counter doing double duty: `attempts` is part
     * of the predicate, so exactly one worker's update matches and the other
     * sees no rows and moves on. It needs no new status and no migration. A
     * worker that dies mid-send leaves the row QUEUED with the attempt spent,
     * which is what an attempt is for.
     */
    const taken = await prisma.emailMessage.updateMany({
      where: { id: message.id, status: EmailStatus.QUEUED, attempts: message.attempts },
      data: { attempts: message.attempts + 1 },
    })
    if (taken.count !== 1) continue

    const result = await mailer.send({
      to: { address: message.toAddress, name: message.toName },
      subject: message.subject,
      text: message.body,
      html: toHtml(message.body),
    })

    const attempts = message.attempts + 1

    if (result.ok) {
      /*
       * `LOGGED` when the provider cannot deliver, `SENT` when it did.
       *
       * The same ok-result means two different things to a hotel reading the
       * log, and recording both as sent is the lie this distinction exists to
       * prevent.
       */
      const delivered = mailer.canDeliver
      await prisma.emailMessage.update({
        where: { id: message.id },
        data: {
          status: delivered ? EmailStatus.SENT : EmailStatus.LOGGED,
          attempts,
          provider: mailer.name,
          providerReference: result.data?.reference ?? null,
          sentAt: new Date(),
          lastError: null,
        },
      })
      if (delivered) outcome.sent += 1
      else outcome.logged += 1
      continue
    }

    const permanent = isPermanentFailure(result.reason)
    const exhausted = attempts >= MAX_ATTEMPTS
    const giveUp = permanent || exhausted

    await prisma.emailMessage.update({
      where: { id: message.id },
      data: {
        status: giveUp ? EmailStatus.FAILED : EmailStatus.QUEUED,
        attempts,
        provider: mailer.name,
        lastError: result.reason?.slice(0, 1000) ?? 'unknown',
        failedAt: giveUp ? new Date() : null,
      },
    })

    if (giveUp) {
      outcome.failed += 1
      /*
       * Reported, because a message that will never arrive is a person who
       * cannot get in. The address is not in the context: a fault report is
       * not a place for a recipient's email (the PII rule), and the message id
       * is enough to find the row.
       */
      await reportError(
        new Error(`Transactional email gave up after ${attempts} attempt(s): ${result.reason}`),
        { where: 'notifications/dispatchQueued', extra: { messageId: message.id } },
      )
    } else {
      outcome.deferred += 1
    }
  }

  return outcome
}

/**
 * Queue, then deliver, outside any transaction.
 *
 * The shape a server action wants: it has already committed, and this is the
 * message that follows. Returns the message id whatever happened to delivery,
 * because the action's own outcome does not depend on it.
 */
export async function queueAndDispatch(input: QueueEmailInput): Promise<string> {
  const id = await queueEmail(input)
  await dispatchQueued({ ids: [id] }).catch(async (error) => {
    await reportError(error, { where: 'notifications/queueAndDispatch' })
    return null
  })
  return id
}

/**
 * Builds an absolute link for a message.
 *
 * Refuses rather than falling back to a relative path or a request header.
 * These links carry invitation, portal and reset tokens; a link built from a
 * header is a link whose destination was chosen by whoever sent the request.
 */
export function publicUrl(path: string): string {
  const base = getEnv().ARC_PUBLIC_URL
  if (!base) {
    throw invalid(
      'ARC_PUBLIC_URL is not set, so no link can be built for a message. Set it to this ' +
        "deployment's public origin, e.g. https://stay.example.com.",
    )
  }
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

/** True when transactional mail is configured well enough to attempt a send. */
export const canSendEmail = (): boolean => {
  const env = getEnv()
  return Boolean(env.ARC_ENABLE_TRANSACTIONAL_EMAIL && env.ARC_PUBLIC_URL)
}

/**
 * Whether a link may be built at all.
 *
 * Separate from `canSendEmail` because `MAIL_PROVIDER=log` should still record
 * complete messages: a demo's mail log is only useful if the link in it is the
 * real one. So a deployment with `ARC_PUBLIC_URL` set and the switch off
 * records everything and delivers nothing.
 */
export const canComposeEmail = (): boolean => Boolean(getEnv().ARC_PUBLIC_URL)

/**
 * Whether a message queued now will actually reach somebody.
 *
 * Stricter than both of the above, and the only honest basis for telling a
 * person to check their inbox. `canComposeEmail` is true as soon as
 * `ARC_PUBLIC_URL` is set, which the docs recommend doing while delivery is
 * still off — so the password-reset page, which asked that question, promised
 * a link that `dispatchQueued` was deferring or recording as `LOGGED`.
 */
export const canDeliverEmail = (): boolean => canSendEmail() && getMailer().canDeliver

export interface EmailLogRow {
  id: string
  kind: EmailKind
  status: EmailStatus
  toAddress: string
  toName: string | null
  subject: string
  body: string
  entityType: string | null
  entityId: string | null
  attempts: number
  provider: string | null
  lastError: string | null
  queuedAt: Date
  sentAt: Date | null
}

/**
 * One organization's mail, newest first.
 *
 * Scoped by `organizationId` in the `where` clause, not filtered afterwards.
 * Password resets have no organization and therefore never appear here, which
 * is correct: a reset is about an account, and an owner has no business reading
 * the resets of people who happen to be their guests.
 */
export async function listOrganizationEmails(
  organizationId: string,
  options?: { limit?: number },
): Promise<EmailLogRow[]> {
  return prisma.emailMessage.findMany({
    where: { organizationId },
    orderBy: { queuedAt: 'desc' },
    take: Math.min(options?.limit ?? 50, 200),
    select: {
      id: true,
      kind: true,
      status: true,
      toAddress: true,
      toName: true,
      subject: true,
      body: true,
      entityType: true,
      entityId: true,
      attempts: true,
      provider: true,
      lastError: true,
      queuedAt: true,
      sentAt: true,
    },
  })
}

/**
 * A plausible address, which is as far as a syntax check should go.
 *
 * Deliberately not an RFC 5322 regex: those accept things no provider will and
 * reject things that work. One `@`, something either side, a dot in the domain,
 * no whitespace, and a length bound. Whether the address exists is answered by
 * delivering to it.
 */
export function isPlausibleAddress(value: string): boolean {
  if (value.length < 5 || value.length > 254) return false
  if (/\s/.test(value)) return false
  const at = value.indexOf('@')
  if (at < 1 || at !== value.lastIndexOf('@')) return false
  const domain = value.slice(at + 1)
  if (domain.length < 3 || !domain.includes('.')) return false
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return false
  return true
}

/**
 * A human label for a kind, in the reader's language.
 *
 * Here rather than in the dictionary because the mapping is from a Prisma enum,
 * so exhaustiveness is checked by the compiler.
 */
export function describeKind(kind: EmailKind, locale: AppLocale): string {
  const t = createTranslator(locale)
  switch (kind) {
    case EmailKind.PARTNER_INVITATION:
      return t('email.kind.partnerInvitation')
    case EmailKind.STAFF_INVITATION:
      return t('email.kind.staffInvitation')
    case EmailKind.ORDER_CONFIRMATION:
      return t('email.kind.orderConfirmation')
    case EmailKind.ORDER_CANCELLED:
      return t('email.kind.orderCancelled')
    case EmailKind.GUEST_PORTAL_LINK:
      return t('email.kind.guestPortalLink')
    case EmailKind.PASSWORD_RESET:
      return t('email.kind.passwordReset')
  }
}

import { createHash, randomBytes } from 'node:crypto'
import { prisma } from '@/lib/db'
import { forbidden } from '@/lib/errors'
import { createTranslator, resolveLocale, type AppLocale } from '@/lib/i18n'
import { hashPassword } from '@/lib/password'
import { assertWithinRateLimit, rateLimitSubject } from '@/lib/rate-limit'
import { EmailKind } from '@/lib/prisma-types'
import {
  canComposeEmail,
  publicUrl,
  queueAndDispatch,
} from '@/modules/notifications/service'
import { passwordReset as renderPasswordReset } from '@/modules/notifications/templates'
import { passwordResetRequestSchema, passwordResetCompleteSchema } from './schemas'

/**
 * Password reset.
 *
 * ARC Stay had none, for a reason that was true at the time: there was no
 * outbound mail path, so there was nowhere to send a reset to, and inventing
 * one would have meant a reset nobody receives. Now that transactional mail
 * exists (ADR-040) the absence is just a gap, and a gap a real hotel hits on
 * roughly its first week — a manager forgets a password and there is no way
 * back into their own dashboard.
 *
 * Three decisions worth stating, because each one is a thing that goes wrong:
 *
 * **The request never says whether the address exists.** `requestPasswordReset`
 * returns the same thing for a known address, an unknown one and an address
 * with no password. A reset form that answers differently is an account
 * enumeration oracle, and for this product the accounts are a named list of
 * boutique hotels and their partners — "is this hotel on ARC" is commercially
 * interesting information to hand to anybody who asks.
 *
 * **An hour, one use, and the newest link wins.** Requesting a second reset
 * supersedes the first, so a link sitting in an inbox from last week cannot be
 * used by whoever reads that inbox next.
 *
 * **Completing one does not sign you in.** It sets the password and sends the
 * person to `/sign-in` to use it. A reset link arriving in a mailbox is weaker
 * proof than a password, and treating it as a session would make a readable
 * inbox equivalent to a credential for as long as the session lasts.
 */

/** How long a reset link is good for. Short: it is a credential in an inbox. */
export const RESET_TTL_MINUTES = 60

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export interface ResetRequestOutcome {
  /**
   * Always true. Not "was an email sent" — the caller must not be able to tell
   * the difference, and neither must the page it renders.
   */
  accepted: true
  /**
   * Whether this deployment can send at all, which is a configuration fact
   * rather than a fact about the address. The page uses it to say "check your
   * email" or "this deployment does not send mail; ask an administrator".
   */
  deliveryConfigured: boolean
}

/**
 * Asks for a reset. Mails a link if, and only if, the address has an account
 * with a password.
 *
 * Rate-limited twice: per address, so one account cannot be mail-bombed, and
 * per caller, so the form cannot be walked down a list of addresses. Both
 * buckets count *requests*, so they are consumed before anything is looked up
 * — a limiter that only counts successes tells you which addresses existed.
 */
export async function requestPasswordReset(
  raw: unknown,
  options: { now?: Date; requesterKey?: string | null } = {},
): Promise<ResetRequestOutcome> {
  const input = passwordResetRequestSchema.parse(raw)
  const now = options.now ?? new Date()

  if (options.requesterKey) {
    await assertWithinRateLimit({
      bucket: `password-reset:from:${rateLimitSubject(options.requesterKey)}`,
      limit: 10,
      windowSeconds: 3_600,
      message: 'Too many reset requests from here. Try again later.',
      now,
    })
  }

  await assertWithinRateLimit({
    bucket: `password-reset:for:${rateLimitSubject(input.email)}`,
    limit: 5,
    windowSeconds: 3_600,
    message: 'Too many reset requests for that address. Try again later.',
    now,
  })

  const deliveryConfigured = canComposeEmail()

  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, name: true, email: true, locale: true, passwordHash: true },
  })

  /*
   * No account, or an account nobody has claimed yet, and the answer is the
   * same shape either way.
   *
   * A credential-free `User` is a placeholder — a guest a front desk entered,
   * a partner who has not accepted their invitation (ADR-039). Sending a reset
   * to one would be a way to take over an account by asking, bypassing the
   * invitation or the booking claim that is supposed to prove the link. Those
   * people have a route in already, and it is not this one.
   */
  if (!user || !user.passwordHash || !deliveryConfigured) {
    return { accepted: true, deliveryConfigured }
  }

  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(now.getTime() + RESET_TTL_MINUTES * 60_000)
  const locale: AppLocale = user.locale === 'ES' ? 'es' : 'en'

  await prisma.$transaction(async (tx) => {
    // Supersede every live link for this account before minting a new one.
    await tx.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null, supersededAt: null },
      data: { supersededAt: now },
    })

    await tx.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashResetToken(token),
        expiresAt,
        requestedFromHash: options.requesterKey
          ? rateLimitSubject(options.requesterKey)
          : null,
      },
    })
  })

  await queueAndDispatch({
    kind: EmailKind.PASSWORD_RESET,
    // A reset belongs to an account, not to a tenant. Null keeps it out of
    // `/owner/messages`, where an owner has no business reading it.
    organizationId: null,
    to: { address: user.email, name: user.name },
    locale,
    rendered: renderPasswordReset(locale, {
      name: user.name,
      resetUrl: publicUrl(`/reset-password/${token}`),
      expiresInMinutes: RESET_TTL_MINUTES,
    }),
    about: { entityType: 'User', entityId: user.id },
    causedByUserId: null,
  })

  return { accepted: true, deliveryConfigured }
}

export interface ResetTokenView {
  email: string
  name: string
}

/**
 * Resolves a reset token for display, so the form can greet the right person.
 *
 * Every rejection is the same message. Unlike an invitation — where the holder
 * of the link is by definition the person it was sent to and an accurate reason
 * is help — a reset link may be presented by somebody reading a mailbox they
 * should not have, and "this expired four minutes ago" tells them a valid one
 * recently existed.
 */
export async function getResetToken(token: string, now = new Date()): Promise<ResetTokenView> {
  const rejected = forbidden('This reset link is not valid any more. Ask for a new one.')
  if (!token || token.length < 16 || token.length > 128) throw rejected

  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(token) },
    select: {
      expiresAt: true,
      usedAt: true,
      supersededAt: true,
      user: { select: { email: true, name: true } },
    },
  })

  if (!row) throw rejected
  if (row.usedAt || row.supersededAt) throw rejected
  if (row.expiresAt.getTime() <= now.getTime()) throw rejected

  return { email: row.user.email, name: row.user.name }
}

/**
 * Sets the new password.
 *
 * Single-use is enforced by the `where` clause of an `updateMany`, not by the
 * read above: a check-then-write loses a race between two submissions of the
 * same link, and the loser would silently set a password the winner had just
 * replaced.
 *
 * Returns nothing. The caller redirects to `/sign-in`; see the note above about
 * why a reset is not a session.
 */
export async function completePasswordReset(
  raw: unknown,
  options: { now?: Date } = {},
): Promise<{ email: string }> {
  const input = passwordResetCompleteSchema.parse(raw)
  const now = options.now ?? new Date()
  const tokenHash = hashResetToken(input.token)
  const passwordHash = await hashPassword(input.password)

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.passwordResetToken.updateMany({
      where: { tokenHash, usedAt: null, supersededAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    })
    if (claimed.count !== 1) {
      throw forbidden('This reset link is not valid any more. Ask for a new one.')
    }

    const row = await tx.passwordResetToken.findUniqueOrThrow({
      where: { tokenHash },
      select: { userId: true, user: { select: { email: true, passwordHash: true } } },
    })

    /*
     * The account must still have a password.
     *
     * It had one when the link was minted — `requestPasswordReset` refuses a
     * placeholder. If it does not now, something removed it between then and
     * now, and setting one here would be completing a reset for an account
     * whose state no longer matches what was proved.
     */
    if (!row.user.passwordHash) {
      throw forbidden('This reset link is not valid any more. Ask for a new one.')
    }

    await tx.user.update({ where: { id: row.userId }, data: { passwordHash } })

    return { email: row.user.email }
  })
}

/** Copy for the page, so both locales say the same careful thing. */
export function resetRequestedMessage(locale: AppLocale, deliveryConfigured: boolean): string {
  const t = createTranslator(locale)
  return deliveryConfigured ? t('auth.reset.sent') : t('auth.reset.notConfigured')
}

/** Normalises an `Accept-Language` header for a page with no session yet. */
export const localeFromHeader = (value: string | null): AppLocale => resolveLocale(value)

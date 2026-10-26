import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getEnv, resetEnvCache } from '@/lib/env'
import { EmailKind } from '@/lib/prisma-types'
import {
  formatRecipient,
  getMailer,
  isPermanentFailure,
  resetMailer,
} from '@/modules/notifications/providers'
import { isPlausibleAddress } from '@/modules/notifications/service'
import {
  KINDS_WITH_TEMPLATES,
  guestPortalLink,
  orderCancelled,
  orderConfirmation,
  partnerInvitation,
  passwordReset,
  staffInvitation,
  toHtml,
} from '@/modules/notifications/templates'

/**
 * Transactional mail, the parts that are pure.
 *
 * The interesting cases are not "does it interpolate a name". They are the
 * four ways this feature could quietly break a product commitment:
 *
 *   - a confirmation that reads the same for a simulated booking as for a real
 *     one (non-negotiable 7, at the point somebody actually reads something);
 *   - a message that asserts a partner is verified, or that conditions are
 *     fine, in a document read days later (non-negotiables 1 and 2);
 *   - a recipient name that becomes a second recipient;
 *   - a body that becomes markup.
 */

const REQUIRED = {
  DATABASE_URL: 'postgresql://arc:arc@127.0.0.1:5432/arc_stay_env_test?schema=public',
  NODE_ENV: 'test',
}

let saved: NodeJS.ProcessEnv

beforeEach(() => {
  saved = process.env
  process.env = { ...REQUIRED } as NodeJS.ProcessEnv
  resetEnvCache()
  resetMailer()
})

afterEach(() => {
  process.env = saved
  resetEnvCache()
  resetMailer()
})

describe('the environment contract for mail', () => {
  it('defaults to recording and delivering nothing', () => {
    const env = getEnv()
    expect(env.MAIL_PROVIDER).toBe('log')
    expect(env.ARC_ENABLE_TRANSACTIONAL_EMAIL).toBe(false)
    expect(getMailer().canDeliver).toBe(false)
  })

  it('keeps outbound guest messaging off when transactional mail is on', () => {
    /*
     * The whole point of the second switch. Turning on confirmations must not
     * turn on ARC messaging a guest unprompted — those are different
     * permissions and non-negotiable 6 only governs the second.
     */
    process.env.ARC_ENABLE_TRANSACTIONAL_EMAIL = '1'
    process.env.ARC_PUBLIC_URL = 'https://stay.example.com'
    const env = getEnv()
    expect(env.ARC_ENABLE_TRANSACTIONAL_EMAIL).toBe(true)
    expect(env.ARC_ENABLE_OUTBOUND_MESSAGING).toBe(false)
    expect(env.MESSAGING_PROVIDER).toBe('noop')
  })

  it('refuses the switch without a public url to build links against', () => {
    process.env.ARC_ENABLE_TRANSACTIONAL_EMAIL = '1'
    expect(() => getEnv()).toThrow(/ARC_PUBLIC_URL/)
  })

  it('refuses a trailing slash, which would double up in every link', () => {
    process.env.ARC_ENABLE_TRANSACTIONAL_EMAIL = '1'
    process.env.ARC_PUBLIC_URL = 'https://stay.example.com/'
    expect(() => getEnv()).toThrow(/slash/)
  })

  it('refuses a live provider that is only half configured', () => {
    process.env.ARC_DATA_MODE = 'pilot'
    process.env.ARC_ENABLE_TRANSACTIONAL_EMAIL = '1'
    process.env.ARC_PUBLIC_URL = 'https://stay.example.com'
    process.env.MAIL_PROVIDER = 'resend'
    expect(() => getEnv()).toThrow(/RESEND_API_KEY/)

    process.env.RESEND_API_KEY = 're_test'
    expect(() => getEnv()).toThrow(/ARC_MAIL_FROM/)
  })

  it('refuses a live provider configured but never switched on', () => {
    process.env.ARC_DATA_MODE = 'pilot'
    process.env.MAIL_PROVIDER = 'resend'
    process.env.RESEND_API_KEY = 're_test'
    process.env.ARC_MAIL_FROM = 'ARC Stay <stay@example.com>'
    expect(() => getEnv()).toThrow(/ARC_ENABLE_TRANSACTIONAL_EMAIL/)
  })

  it('refuses a live mail provider on an open demo', () => {
    /*
     * The demo sign-in hands a stranger an owner session with no credential
     * (ADR-028), and an owner can invite a partner at any address. A live
     * provider there is an open relay sending from ARC's verified domain.
     */
    process.env.ARC_DATA_MODE = 'demo'
    process.env.ARC_ALLOW_OPEN_DEMO = '1'
    process.env.ARC_ENABLE_TRANSACTIONAL_EMAIL = '1'
    process.env.ARC_PUBLIC_URL = 'https://demo.example.com'
    process.env.MAIL_PROVIDER = 'resend'
    process.env.RESEND_API_KEY = 're_test'
    process.env.ARC_MAIL_FROM = 'ARC Stay <stay@example.com>'
    expect(() => getEnv()).toThrow(/open relay/)
  })

  it('points MESSAGING_PROVIDER=resend at the right setting instead', () => {
    process.env.MESSAGING_PROVIDER = 'resend'
    expect(() => getEnv()).toThrow(/MAIL_PROVIDER=resend/)
  })

  it('selects the live mailer once fully configured outside demo mode', () => {
    process.env.ARC_DATA_MODE = 'pilot'
    process.env.ARC_ENABLE_TRANSACTIONAL_EMAIL = '1'
    process.env.ARC_PUBLIC_URL = 'https://stay.example.com'
    process.env.MAIL_PROVIDER = 'resend'
    process.env.RESEND_API_KEY = 're_test'
    process.env.ARC_MAIL_FROM = 'ARC Stay <stay@example.com>'
    const mailer = getMailer()
    expect(mailer.name).toBe('resend')
    expect(mailer.canDeliver).toBe(true)
  })

  it('falls back to the logging mailer when the switch is off', () => {
    // Configured but not enabled would be refused by getEnv; this is the
    // provider-selection half: `log` whenever delivery is not switched on.
    expect(getMailer().name).toBe('log')
  })
})

describe('a recipient address', () => {
  it.each([
    'guest@example.com',
    'first.last+tag@sub.example.co.uk',
  ])('accepts %s', (value) => {
    expect(isPlausibleAddress(value)).toBe(true)
  })

  it.each([
    ['no at sign', 'guest.example.com'],
    ['two at signs', 'a@b@example.com'],
    ['nothing before the at', '@example.com'],
    ['no dot in the domain', 'guest@example'],
    ['whitespace', 'guest @example.com'],
    ['a newline, which is a header', 'guest@example.com\nBcc: other@example.com'],
    ['consecutive dots', 'guest@example..com'],
    ['a trailing dot', 'guest@example.com.'],
  ])('refuses %s', (_why, value) => {
    expect(isPlausibleAddress(value)).toBe(false)
  })
})

describe('a recipient display name', () => {
  it('quotes a name so a comma cannot split it into two recipients', () => {
    expect(formatRecipient({ address: 'a@example.com', name: 'Smith, Jane' })).toBe(
      '"Smith  Jane" <a@example.com>',
    )
  })

  it('strips what would otherwise become a header or a second recipient', () => {
    const formatted = formatRecipient({
      address: 'a@example.com',
      name: 'Jane"\r\nBcc: evil@example.com',
    })

    /*
     * What matters is that the result is still *one* quoted display name and
     * *one* address. Text reading "Bcc:" inside the quotes is inert — it is a
     * line break or a quote that would end the name that turns it into a
     * header, and both are gone.
     */
    expect(formatted).not.toContain('\r')
    expect(formatted).not.toContain('\n')
    expect(formatted).toMatch(/^"[^"]*" <a@example\.com>$/)
    // The injected address cannot escape the quotes to become a recipient.
    expect(formatted.indexOf('evil@example.com')).toBeLessThan(formatted.lastIndexOf('"'))
    expect(formatted.startsWith('"Jane')).toBe(true)
  })

  it('falls back to the bare address when a name strips to nothing', () => {
    expect(formatRecipient({ address: 'a@example.com', name: '<<>>' })).toBe('a@example.com')
    expect(formatRecipient({ address: 'a@example.com', name: null })).toBe('a@example.com')
  })
})

describe('a provider failure', () => {
  it('is permanent only when the provider said the message is wrong', () => {
    expect(isPermanentFailure('permanent 422: unverified domain')).toBe(true)
    expect(isPermanentFailure('transient 503: upstream')).toBe(false)
    expect(isPermanentFailure('transport: TimeoutError: timed out')).toBe(false)
    expect(isPermanentFailure(null)).toBe(false)
  })
})

describe('every kind has a template', () => {
  it('covers the enum', () => {
    // The record is typed `Record<EmailKind, true>`, so this is really a
    // compile-time assertion; the runtime check catches an enum value added to
    // the database and not to the type.
    expect(Object.keys(KINDS_WITH_TEMPLATES).sort()).toEqual(Object.values(EmailKind).sort())
  })
})

const INVITE = {
  partnerName: 'Escuela Olas Verdes',
  contactName: 'Mariana',
  propertyName: 'Casa Olas',
  inviteUrl: 'https://stay.example.com/invite/abc123def456ghi789',
  expiresAt: new Date('2026-11-09T12:00:00.000Z'),
  commissionPct: '15',
}

describe('the partner invitation', () => {
  it('carries the link, the commission and the unverified standing, in both languages', () => {
    for (const locale of ['en', 'es'] as const) {
      const message = partnerInvitation(locale, INVITE)
      expect(message.subject).toContain('Casa Olas')
      expect(message.text).toContain(INVITE.inviteUrl)
      expect(message.text).toContain('15')
      // The partner must not be told they are verified, and must be told they
      // are not: payouts are off until ARC has checked (non-negotiable 2).
      expect(message.text.toLowerCase()).toMatch(/unverified|no verificado/)
    }
  })

  it('names the expiry as a date rather than a duration', () => {
    // "Expires in 14 days" is wrong the moment the message sits in a queue.
    expect(partnerInvitation('en', INVITE).text).toContain('9 November 2026')
  })
})

describe('the staff invitation', () => {
  it('names who invited them when that is known, and does not invent one when it is not', () => {
    const withSender = staffInvitation('en', {
      contactName: 'Luis',
      propertyName: 'Casa Olas',
      invitedByName: 'Ana',
      inviteUrl: 'https://stay.example.com/invite/tokentokentoken',
      expiresAt: new Date('2026-11-09T12:00:00.000Z'),
    })
    expect(withSender.text).toContain('Ana')

    const without = staffInvitation('en', {
      contactName: 'Luis',
      propertyName: 'Casa Olas',
      invitedByName: null,
      inviteUrl: 'https://stay.example.com/invite/tokentokentoken',
      expiresAt: new Date('2026-11-09T12:00:00.000Z'),
    })
    expect(without.text).toContain('You have been given access')
  })
})

const ORDER = {
  guestName: 'Dana',
  propertyName: 'Casa Olas',
  reference: 'ORD-4K2M',
  lines: [
    {
      title: 'Sunrise surf lesson',
      when: '3 November 2026, 06:30',
      quantity: 2,
      lineTotalMinor: 180_000,
      awaitingPartner: true,
    },
  ],
  totalMinor: 180_000,
  currency: 'MXN',
  portalUrl: 'https://stay.example.com/g/sometokenvalue',
  isSimulated: false,
}

describe('the booking confirmation', () => {
  it('lists what was booked, the total and the portal link', () => {
    const message = orderConfirmation('en', ORDER)
    expect(message.subject).toContain('ORD-4K2M')
    expect(message.text).toContain('Sunrise surf lesson')
    expect(message.text).toContain('3 November 2026, 06:30')
    expect(message.text).toContain(ORDER.portalUrl)
    // Money is formatted from minor units, never arithmetic on a float.
    expect(message.text).toContain('$1,800')
  })

  it('says a line is awaiting the partner rather than calling it confirmed', () => {
    expect(orderConfirmation('en', ORDER).text).toContain('awaiting')
    expect(orderConfirmation('es', ORDER).text).toContain('pendiente')
  })

  it('says a simulated booking is a demonstration, in both languages', () => {
    const en = orderConfirmation('en', { ...ORDER, isSimulated: true })
    expect(en.text).toContain('demonstration booking')
    expect(en.text).toContain('No payment was taken')
    const es = orderConfirmation('es', { ...ORDER, isSimulated: true })
    expect(es.text).toContain('demostración')
  })

  it('omits the portal link entirely rather than sending one that 404s', () => {
    const message = orderConfirmation('en', { ...ORDER, portalUrl: null })
    expect(message.text).not.toContain('/g/')
  })

  it('makes no claim about safety, conditions or verification', () => {
    /*
     * An email is read days after it is sent. A condition report carries a
     * timestamp precisely because it goes stale (non-negotiable 1), and a
     * partner's verification can lapse (ADR-036) — so neither belongs in a
     * document with no timestamp that the reader keeps.
     */
    for (const locale of ['en', 'es'] as const) {
      const text = orderConfirmation(locale, ORDER).text.toLowerCase()
      expect(text).not.toMatch(/\bsafe\b|\bseguro\b|verified|verificado/)
    }
  })
})

describe('the cancellation notice', () => {
  const base = {
    guestName: 'Dana',
    propertyName: 'Casa Olas',
    reference: 'ORD-4K2M',
    what: 'Sunrise surf lesson — 3 November 2026, 06:30 — 2',
    refundedMinor: 180_000,
    currency: 'MXN',
    isSimulated: false,
    cancelledByProperty: false,
  }

  it('never promises when a refund will arrive', () => {
    /*
     * ARC knows it asked the provider to refund. How long a card issuer takes
     * is not ARC's to promise, and a number in a confirmation is exactly the
     * invented fact non-negotiable 2 is about.
     */
    for (const locale of ['en', 'es'] as const) {
      const text = orderCancelled(locale, base).text
      expect(text).not.toMatch(/\d+\s*[-–]\s*\d+\s*(business\s+)?days|días hábiles/i)
    }
  })

  it('marks a simulated refund as one', () => {
    expect(orderCancelled('en', { ...base, isSimulated: true }).text).toContain('simulated')
  })

  it('says no refund is due rather than reporting a refund of zero', () => {
    expect(orderCancelled('en', { ...base, refundedMinor: 0 }).text).toContain('No refund is due')
  })

  it('distinguishes the guest cancelling from the property cancelling', () => {
    expect(orderCancelled('en', base).text).toContain('as you asked')
    expect(
      orderCancelled('en', { ...base, cancelledByProperty: true }).text,
    ).toContain('Casa Olas has cancelled')
  })
})

describe('the guest portal link', () => {
  it('tells the guest the link is a credential', () => {
    const message = guestPortalLink('en', {
      guestName: 'Dana',
      propertyName: 'Casa Olas',
      checkIn: '3 November 2026',
      checkOut: '9 November 2026',
      reference: 'STAY-7K4M',
      portalUrl: 'https://stay.example.com/g/sometokenvalue',
    })
    expect(message.text).toContain('do not share it')
    expect(message.text).toContain('https://stay.example.com/g/sometokenvalue')
  })
})

describe('the password reset', () => {
  it('says what to do if it was not you, and names the window', () => {
    const message = passwordReset('en', {
      name: 'Dana',
      resetUrl: 'https://stay.example.com/reset-password/tokentokentoken',
      expiresInMinutes: 60,
    })
    expect(message.text).toContain('60 minutes')
    expect(message.text).toContain('works once')
    expect(message.text).toContain('your password has not changed')
  })
})

describe('the html part', () => {
  it('is generated from the text, with the links made clickable', () => {
    const html = toHtml('Hi,\n\nUse this link:\nhttps://stay.example.com/invite/abc\n')
    expect(html).toContain('<a href="https://stay.example.com/invite/abc"')
    expect(html).toContain('<!doctype html>')
  })

  it('escapes a body that would otherwise become markup', () => {
    // A guest's own dietary note reaches a confirmation. A property name
    // reaches every message. Neither is trusted input for a document.
    const html = toHtml('Booking for <script>alert(1)</script> & "co"')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp;')
    expect(html).toContain('&quot;')
  })

  it('does not load a remote image or stylesheet', () => {
    // The two ways a transactional message fails to be legible: the client
    // strips the CSS, or blocks the images. There are neither.
    const html = toHtml('Hello,\n\nSomething happened.')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<link')
    expect(html).not.toContain('@import')
  })
})

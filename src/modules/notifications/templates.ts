import { formatMoney } from '@/lib/money'
import type { AppLocale } from '@/lib/i18n'
import { EmailKind } from '@/lib/prisma-types'

/**
 * The text of every message ARC sends, in English and Spanish.
 *
 * Here rather than in `src/lib/i18n/dictionary.ts`, which is interface copy
 * keyed by string and asserted complete by `_EsIsComplete`. These are whole
 * documents with their own paragraph structure, and the parity guarantee is
 * stronger for being structural: a template is a `Record<AppLocale, …>`, so a
 * kind added without its Spanish fails typecheck.
 *
 * Three rules, all of them product commitments rather than style:
 *
 *   1. **Plain text is the message.** The HTML part is generated from it. A
 *      confirmation that only renders in a client that loads remote CSS is a
 *      confirmation some guests do not get.
 *   2. **Nothing is claimed that is not known.** No "your booking is
 *      confirmed with our verified partner" — the partner's standing is a
 *      claim with its own lifecycle (ADR-036) and a confirmation email is the
 *      worst place to assert it. No conditions, no safety wording: an email is
 *      read days after it is sent, and a condition report has a timestamp for
 *      a reason (non-negotiable 1).
 *   3. **The sender is named.** Every message says which property or which
 *      system it is from, because the recipient did not sign up to hear from
 *      "ARC".
 */

export interface RenderedEmail {
  subject: string
  text: string
}

const SIGN_OFF: Record<AppLocale, string> = {
  en: 'ARC Stay',
  es: 'ARC Stay',
}

/** Wraps a body in the greeting and sign-off every message shares. */
function compose(
  locale: AppLocale,
  input: { subject: string; greetingName: string | null; paragraphs: string[]; footer: string },
): RenderedEmail {
  const hello =
    input.greetingName
      ? locale === 'es'
        ? `Hola ${input.greetingName},`
        : `Hi ${input.greetingName},`
      : locale === 'es'
        ? 'Hola,'
        : 'Hello,'

  const text = [hello, '', ...input.paragraphs, '', '—', SIGN_OFF[locale], input.footer].join('\n')
  return { subject: input.subject, text }
}

const AUTOMATIC: Record<AppLocale, string> = {
  en: 'This message was sent automatically because of an action taken in ARC Stay. Nobody at ARC reads your replies to it; contact the property directly.',
  es: 'Este mensaje se envió automáticamente por una acción realizada en ARC Stay. Nadie en ARC lee las respuestas; comunícate directamente con el alojamiento.',
}

const UNEXPECTED: Record<AppLocale, string> = {
  en: 'If you were not expecting this, you can ignore it. The link stops working on its own.',
  es: 'Si no esperabas este mensaje, puedes ignorarlo. El enlace deja de funcionar por sí solo.',
}

// === Partner invitation =====================================================

export interface PartnerInvitationVars {
  partnerName: string
  contactName: string | null
  propertyName: string
  inviteUrl: string
  expiresAt: Date
  commissionPct: string
}

export function partnerInvitation(
  locale: AppLocale,
  v: PartnerInvitationVars,
): RenderedEmail {
  const until = formatDate(locale, v.expiresAt)
  if (locale === 'es') {
    return compose('es', {
      subject: `${v.propertyName} te invita a ofrecer experiencias en ARC Stay`,
      greetingName: v.contactName,
      paragraphs: [
        `${v.propertyName} agregó a ${v.partnerName} como socio local en ARC Stay y te invita a administrar tu propio perfil, tu disponibilidad y tus experiencias.`,
        `Crea tu contraseña con este enlace, válido hasta el ${until}:`,
        v.inviteUrl,
        `El acuerdo registrado es una comisión del ${v.commissionPct}% para el alojamiento sobre lo que se venda de tus experiencias, más un 5% de ARC. Puedes ver cada reserva y lo que te corresponde en tu panel.`,
        'Tu negocio aparece como no verificado hasta que ARC revise tus documentos, y los pagos están desactivados hasta entonces. Nada se publica a los huéspedes sin que tú lo publiques.',
        UNEXPECTED.es,
      ],
      footer: AUTOMATIC.es,
    })
  }
  return compose('en', {
    subject: `${v.propertyName} has invited you to offer experiences on ARC Stay`,
    greetingName: v.contactName,
    paragraphs: [
      `${v.propertyName} has added ${v.partnerName} as a local partner on ARC Stay, and invited you to run your own profile, availability and experiences.`,
      `Set your password with this link, which works until ${until}:`,
      v.inviteUrl,
      `The agreement on record is ${v.commissionPct}% to the property on anything sold from your experiences, plus 5% to ARC. Every booking and your share of it are on your dashboard.`,
      'Your business shows as unverified until ARC has checked your documents, and payouts are off until then. Nothing reaches a guest until you publish it.',
      UNEXPECTED.en,
    ],
    footer: AUTOMATIC.en,
  })
}

// === Staff invitation =======================================================

export interface StaffInvitationVars {
  contactName: string | null
  propertyName: string
  invitedByName: string | null
  inviteUrl: string
  expiresAt: Date
}

export function staffInvitation(locale: AppLocale, v: StaffInvitationVars): RenderedEmail {
  const until = formatDate(locale, v.expiresAt)
  const by = v.invitedByName
  if (locale === 'es') {
    return compose('es', {
      subject: `Acceso al panel de ${v.propertyName} en ARC Stay`,
      greetingName: v.contactName,
      paragraphs: [
        by
          ? `${by} te dio acceso al panel de ${v.propertyName} en ARC Stay.`
          : `Te dieron acceso al panel de ${v.propertyName} en ARC Stay.`,
        `Crea tu contraseña con este enlace, válido hasta el ${until}:`,
        v.inviteUrl,
        UNEXPECTED.es,
      ],
      footer: AUTOMATIC.es,
    })
  }
  return compose('en', {
    subject: `Access to the ${v.propertyName} dashboard on ARC Stay`,
    greetingName: v.contactName,
    paragraphs: [
      by
        ? `${by} has given you access to the ${v.propertyName} dashboard on ARC Stay.`
        : `You have been given access to the ${v.propertyName} dashboard on ARC Stay.`,
      `Set your password with this link, which works until ${until}:`,
      v.inviteUrl,
      UNEXPECTED.en,
    ],
    footer: AUTOMATIC.en,
  })
}

// === Order confirmation =====================================================

export interface OrderLine {
  title: string
  /** Local calendar day and wall-clock start, already formatted by the caller. */
  when: string
  quantity: number
  lineTotalMinor: number
  /** True while the partner has still to confirm the booking. */
  awaitingPartner: boolean
}

export interface OrderConfirmationVars {
  guestName: string | null
  propertyName: string
  reference: string
  lines: OrderLine[]
  totalMinor: number
  currency: string
  portalUrl: string | null
  isSimulated: boolean
}

export function orderConfirmation(locale: AppLocale, v: OrderConfirmationVars): RenderedEmail {
  const total = formatMoney(v.totalMinor, v.currency)
  const lines = v.lines.map((line) => {
    const amount = formatMoney(line.lineTotalMinor, v.currency)
    const pending = line.awaitingPartner
      ? locale === 'es'
        ? ' (pendiente de confirmación del socio)'
        : ' (awaiting the partner’s confirmation)'
      : ''
    const people = locale === 'es' ? 'personas' : 'people'
    return `  • ${line.title} — ${line.when} — ${line.quantity} ${people} — ${amount}${pending}`
  })

  /*
   * A simulated order says so, in the message, at the top.
   *
   * `isSimulated` is on the order because no real money moved, and a
   * confirmation that reads identically either way is how a demo booking ends
   * up believed. Non-negotiable 7 is about the provider; this is the same
   * commitment at the point a person actually reads something.
   */
  const demoNotice =
    v.isSimulated
      ? locale === 'es'
        ? ['AVISO: esta es una reserva de demostración. No se cobró ningún pago y nada está reservado realmente.']
        : ['NOTE: this is a demonstration booking. No payment was taken and nothing is actually reserved.']
      : []

  if (locale === 'es') {
    return compose('es', {
      subject: `Tu reserva en ${v.propertyName} — ${v.reference}`,
      greetingName: v.guestName,
      paragraphs: [
        ...demoNotice,
        `Gracias. Esto es lo que reservaste a través de ${v.propertyName}, con la referencia ${v.reference}:`,
        ...lines,
        `Total pagado: ${total}`,
        ...(v.lines.some((l) => l.awaitingPartner)
          ? ['Los puntos marcados como pendientes los confirma el socio local. Te avisaremos si alguno no puede confirmarse, y en ese caso se reembolsa.']
          : []),
        ...(v.portalUrl
          ? [`Puedes ver tu plan, tus reservas y cancelar desde aquí:`, v.portalUrl]
          : []),
      ],
      footer: AUTOMATIC.es,
    })
  }
  return compose('en', {
    subject: `Your booking at ${v.propertyName} — ${v.reference}`,
    greetingName: v.guestName,
    paragraphs: [
      ...demoNotice,
      `Thank you. Here is what you booked through ${v.propertyName}, under reference ${v.reference}:`,
      ...lines,
      `Total paid: ${total}`,
      ...(v.lines.some((l) => l.awaitingPartner)
        ? ['Anything marked pending is confirmed by the local partner. We will tell you if one cannot be confirmed, and it is refunded if so.']
        : []),
      ...(v.portalUrl
        ? ['You can see your plan, your bookings and cancel from here:', v.portalUrl]
        : []),
    ],
    footer: AUTOMATIC.en,
  })
}

// === Order cancelled ========================================================

export interface OrderCancelledVars {
  guestName: string | null
  propertyName: string
  reference: string
  /** What was cancelled. One line, already titled by the caller. */
  what: string
  refundedMinor: number
  currency: string
  /** True when the refund is a simulated one. */
  isSimulated: boolean
  cancelledByProperty: boolean
}

export function orderCancelled(locale: AppLocale, v: OrderCancelledVars): RenderedEmail {
  const refunded = formatMoney(v.refundedMinor, v.currency)
  /*
   * Says what was refunded, and never when it will arrive.
   *
   * ARC knows that it asked the provider to refund. How long a card issuer
   * takes is not ARC's to promise, and "within 5-10 days" in a confirmation is
   * the kind of invented fact non-negotiable 2 is about.
   */
  const refundLine =
    v.refundedMinor > 0
      ? locale === 'es'
        ? v.isSimulated
          ? `Reembolso registrado: ${refunded} (simulado — no se movió dinero real).`
          : `Se solicitó un reembolso de ${refunded} a tu método de pago.`
        : v.isSimulated
          ? `Refund recorded: ${refunded} (simulated — no real money moved).`
          : `A refund of ${refunded} has been requested back to your payment method.`
      : locale === 'es'
        ? 'No corresponde reembolso según la ventana de cancelación acordada.'
        : 'No refund is due under the agreed cancellation window.'

  if (locale === 'es') {
    return compose('es', {
      subject: `Cancelación — ${v.reference}`,
      greetingName: v.guestName,
      paragraphs: [
        v.cancelledByProperty
          ? `${v.propertyName} canceló lo siguiente de tu reserva ${v.reference}:`
          : `Cancelamos lo siguiente de tu reserva ${v.reference}, como pediste:`,
        `  • ${v.what}`,
        refundLine,
      ],
      footer: AUTOMATIC.es,
    })
  }
  return compose('en', {
    subject: `Cancellation — ${v.reference}`,
    greetingName: v.guestName,
    paragraphs: [
      v.cancelledByProperty
        ? `${v.propertyName} has cancelled the following from your booking ${v.reference}:`
        : `We have cancelled the following from your booking ${v.reference}, as you asked:`,
      `  • ${v.what}`,
      refundLine,
    ],
    footer: AUTOMATIC.en,
  })
}

// === Guest portal link ======================================================

export interface GuestPortalLinkVars {
  guestName: string | null
  propertyName: string
  checkIn: string
  checkOut: string
  reference: string
  portalUrl: string
}

export function guestPortalLink(locale: AppLocale, v: GuestPortalLinkVars): RenderedEmail {
  if (locale === 'es') {
    return compose('es', {
      subject: `Tu estancia en ${v.propertyName} — planifica tus días`,
      greetingName: v.guestName,
      paragraphs: [
        `${v.propertyName} te envía el enlace a tu guía personal para tu estancia del ${v.checkIn} al ${v.checkOut} (referencia ${v.reference}).`,
        'Desde ahí puedes contarnos qué te interesa, ver un plan para tus días y reservar experiencias con socios locales:',
        v.portalUrl,
        'Guarda este enlace: es la llave de tu estancia y no lo compartas. Si lo pierdes, pídeselo al alojamiento.',
      ],
      footer: AUTOMATIC.es,
    })
  }
  return compose('en', {
    subject: `Your stay at ${v.propertyName} — plan your days`,
    greetingName: v.guestName,
    paragraphs: [
      `${v.propertyName} is sending you the link to your personal guide for your stay from ${v.checkIn} to ${v.checkOut} (reference ${v.reference}).`,
      'From there you can tell us what you are interested in, see a plan for your days, and book experiences with local partners:',
      v.portalUrl,
      'Keep this link: it is the key to your stay, so do not share it. If you lose it, ask the property for it again.',
    ],
    footer: AUTOMATIC.en,
  })
}

// === Password reset =========================================================

export interface PasswordResetVars {
  name: string | null
  resetUrl: string
  expiresInMinutes: number
}

export function passwordReset(locale: AppLocale, v: PasswordResetVars): RenderedEmail {
  if (locale === 'es') {
    return compose('es', {
      subject: 'Restablece tu contraseña de ARC Stay',
      greetingName: v.name,
      paragraphs: [
        'Alguien pidió restablecer la contraseña de esta cuenta. Si fuiste tú, usa este enlace:',
        v.resetUrl,
        `El enlace caduca en ${v.expiresInMinutes} minutos y sirve una sola vez. Pedir otro invalida este.`,
        'Si no fuiste tú, ignora este mensaje: tu contraseña no ha cambiado y nadie puede entrar sin este enlace.',
      ],
      footer: AUTOMATIC.es,
    })
  }
  return compose('en', {
    subject: 'Reset your ARC Stay password',
    greetingName: v.name,
    paragraphs: [
      'Somebody asked to reset the password on this account. If that was you, use this link:',
      v.resetUrl,
      `The link expires in ${v.expiresInMinutes} minutes and works once. Asking for another one invalidates this.`,
      'If it was not you, ignore this message: your password has not changed, and nobody can get in without this link.',
    ],
    footer: AUTOMATIC.en,
  })
}

// === Shared =================================================================

/**
 * A date in the recipient's language, in the destination's timezone.
 *
 * Fixed to Oaxaca rather than taken from the clock's zone: the server renders
 * this, and an invitation expiring "on the 9th" has to mean the 9th where the
 * hotel is.
 */
export function formatDate(locale: AppLocale, value: Date): string {
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-MX' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Mexico_City',
  }).format(value)
}

/**
 * The HTML part, generated from the text part.
 *
 * Not a designed template. A transactional message's job is to be legible and
 * to carry one link, and the two ways that fails are a client that strips the
 * CSS and a client that blocks the images — so there are neither. Paragraphs,
 * one monospace block for the links, and escaping.
 *
 * Bare URLs become anchors because a client that does not autolink leaves the
 * recipient a string to copy, and the recipients here include people reading on
 * a phone at a front desk.
 */
export function toHtml(text: string): string {
  const paragraphs = text.split('\n')
  const rendered = paragraphs
    .map((line) => {
      if (line.trim() === '') return ''
      if (line.trim() === '—') return '<hr style="border:0;border-top:1px solid #d8d2c6;margin:24px 0">'
      const escaped = escapeHtml(line)
      const linked = escaped.replace(
        /https?:\/\/[^\s<]+/g,
        (url) => `<a href="${url}" style="color:#0f5c4a">${url}</a>`,
      )
      const indented = line.startsWith('  ')
      return `<p style="margin:0 0 12px;${indented ? 'padding-left:16px;' : ''}">${linked}</p>`
    })
    .filter((line) => line !== '')
    .join('\n')

  return [
    '<!doctype html><html><body style="margin:0;padding:24px;background:#faf7f2">',
    '<div style="max-width:560px;margin:0 auto;font:16px/1.6 -apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;color:#2a2522">',
    rendered,
    '</div></body></html>',
  ].join('\n')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Every kind has a template. A new kind without one fails typecheck here. */
export const KINDS_WITH_TEMPLATES: Record<EmailKind, true> = {
  [EmailKind.PARTNER_INVITATION]: true,
  [EmailKind.STAFF_INVITATION]: true,
  [EmailKind.ORDER_CONFIRMATION]: true,
  [EmailKind.ORDER_CANCELLED]: true,
  [EmailKind.GUEST_PORTAL_LINK]: true,
  [EmailKind.PASSWORD_RESET]: true,
}

import { prisma } from '@/lib/db'
import { toLocalTimeString } from '@/lib/dates'
import { reportError } from '@/lib/observability'
import { EmailKind, OrderItemStatus } from '@/lib/prisma-types'
import type { AppLocale } from '@/lib/i18n'
import {
  canComposeEmail,
  dispatchQueued,
  publicUrl,
  queueEmail,
  type QueueEmailInput,
} from './service'
import {
  formatDate,
  guestPortalLink,
  orderCancelled,
  orderConfirmation,
  type OrderLine,
} from './templates'

/**
 * The senders: one function per thing that happens.
 *
 * Each loads what its message needs, renders it and hands it to the queue.
 * They live here rather than in the domain modules that call them so that
 * `checkout()` reads as checkout and not half as a mail merge, and so that
 * every one of them obeys the same two rules in one place:
 *
 *   1. **Never throws.** A sender is called after the thing it describes has
 *      already committed. Letting a mail failure propagate would turn a
 *      successful booking into an error the guest sees, and roll nothing back.
 *      Every one returns a status instead and reports its own faults.
 *   2. **Never invents a recipient.** The address is loaded from the record the
 *      action touched, inside this function, from the database — not passed in
 *      by a caller who might have taken it from a form.
 */

export type SendOutcome = 'sent' | 'logged' | 'queued' | 'failed' | 'unconfigured' | 'skipped'

/** Queue one message and try it immediately, reporting what happened. */
async function deliver(input: QueueEmailInput): Promise<SendOutcome> {
  if (!canComposeEmail()) return 'unconfigured'
  try {
    const id = await queueEmail(input)
    const outcome = await dispatchQueued({ ids: [id] })
    if (outcome.sent > 0) return 'sent'
    if (outcome.logged > 0) return 'logged'
    if (outcome.failed > 0) return 'failed'
    return 'queued'
  } catch (error) {
    await reportError(error, { where: `notifications/deliver:${input.kind}` })
    return 'failed'
  }
}

const localeOf = (value: 'EN' | 'ES'): AppLocale => (value === 'ES' ? 'es' : 'en')

/**
 * The confirmation for an order that has just been paid for.
 *
 * The lines are read back from the committed order rather than taken from the
 * basket the caller had: a confirmation has to describe what was booked, and the
 * two can differ — checkout re-reads and re-prices inside its transaction, and
 * telling a guest what they *tried* to buy is how a support thread starts.
 */
export async function sendOrderConfirmation(orderId: string): Promise<SendOutcome> {
  if (!canComposeEmail()) return 'unconfigured'

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      organizationId: true,
      reference: true,
      totalMinor: true,
      currency: true,
      isSimulated: true,
      guest: { select: { firstName: true, email: true, locale: true } },
      property: { select: { name: true } },
      stay: { select: { portalToken: true } },
      items: {
        where: { cancelledAt: null },
        orderBy: { createdAt: 'asc' },
        select: {
          quantity: true,
          lineTotalMinor: true,
          supplierConfirmedAt: true,
          status: true,
          experience: { select: { titleEn: true, titleEs: true } },
          slot: { select: { startsAt: true } },
        },
      },
    },
  })

  /*
   * No guest means nobody to write to, which is a legitimate state: an order
   * can be placed against a stay whose guest record was removed. Skipped
   * rather than failed — there is nothing to retry.
   */
  if (!order?.guest?.email) return 'skipped'
  if (order.items.length === 0) return 'skipped'

  const locale = localeOf(order.guest.locale)

  const lines: OrderLine[] = order.items.map((item) => ({
    title: (locale === 'es' ? item.experience.titleEs : null) ?? item.experience.titleEn,
    when: `${formatDate(locale, item.slot.startsAt)}, ${toLocalTimeString(item.slot.startsAt)}`,
    quantity: item.quantity,
    lineTotalMinor: item.lineTotalMinor,
    awaitingPartner: item.supplierConfirmedAt === null && item.status === OrderItemStatus.PENDING,
  }))

  return deliver({
    kind: EmailKind.ORDER_CONFIRMATION,
    organizationId: order.organizationId,
    to: { address: order.guest.email, name: order.guest.firstName },
    locale,
    rendered: orderConfirmation(locale, {
      guestName: order.guest.firstName,
      propertyName: order.property.name,
      reference: order.reference,
      lines,
      totalMinor: order.totalMinor,
      currency: order.currency,
      /*
       * The portal link is included only when there is a stay behind the
       * order, because that is where the token lives. An order with no stay
       * gets a confirmation with no link rather than a link that 404s.
       */
      portalUrl: order.stay ? publicUrl(`/g/${order.stay.portalToken}`) : null,
      isSimulated: order.isSimulated,
    }),
    about: { entityType: 'Order', entityId: order.id },
    causedByUserId: null,
  })
}

/**
 * The notice for a cancelled line, with what was refunded.
 *
 * Takes the refunded amount from the caller rather than re-reading it: the
 * caller is the transaction that computed it, and `OrderItem.refundedMinor`
 * accumulates across cancellations, so a re-read would report the total ever
 * refunded on that line rather than what this cancellation returned.
 */
export async function sendOrderCancelled(input: {
  orderItemId: string
  refundedMinor: number
  cancelledByProperty: boolean
}): Promise<SendOutcome> {
  if (!canComposeEmail()) return 'unconfigured'

  const item = await prisma.orderItem.findUnique({
    where: { id: input.orderItemId },
    select: {
      currency: true,
      quantity: true,
      experience: { select: { titleEn: true, titleEs: true } },
      slot: { select: { startsAt: true } },
      order: {
        select: {
          id: true,
          organizationId: true,
          reference: true,
          isSimulated: true,
          guest: { select: { firstName: true, email: true, locale: true } },
          property: { select: { name: true } },
        },
      },
    },
  })

  if (!item?.order.guest?.email) return 'skipped'

  const locale = localeOf(item.order.guest.locale)
  const title = (locale === 'es' ? item.experience.titleEs : null) ?? item.experience.titleEn

  return deliver({
    kind: EmailKind.ORDER_CANCELLED,
    organizationId: item.order.organizationId,
    to: { address: item.order.guest.email, name: item.order.guest.firstName },
    locale,
    rendered: orderCancelled(locale, {
      guestName: item.order.guest.firstName,
      propertyName: item.order.property.name,
      reference: item.order.reference,
      what: `${title} — ${formatDate(locale, item.slot.startsAt)}, ${toLocalTimeString(item.slot.startsAt)} — ${item.quantity}`,
      refundedMinor: input.refundedMinor,
      currency: item.currency,
      isSimulated: item.order.isSimulated,
      cancelledByProperty: input.cancelledByProperty,
    }),
    about: { entityType: 'OrderItem', entityId: input.orderItemId },
    causedByUserId: null,
  })
}

/**
 * Sends a guest the link to their own portal, at a named operator's request.
 *
 * This is the one sender that is not automatic, and it must stay that way. The
 * portal token is a bearer credential for one stay (ADR-035): mailing it on a
 * schedule, or on stay creation, would put a working credential in an inbox
 * nobody asked to receive it in. An owner pressing a button on a stay they can
 * see is the authorisation, `causedByUserId` records who pressed it, and the
 * caller has already checked that they have access to that property.
 */
export async function sendGuestPortalLink(input: {
  stayId: string
  organizationId: string
  propertyId: string
  byUserId: string
}): Promise<SendOutcome> {
  if (!canComposeEmail()) return 'unconfigured'

  const stay = await prisma.stay.findFirst({
    /*
     * The tenancy predicate is in the `where` clause, not a check afterwards —
     * and it names the *property*, not only the organization. It used to name
     * only the organization while the comment above it claimed property access
     * was what stopped a press reaching another hotel's guest. In an
     * organization with two properties it did not: a stay id from the sibling
     * property matched, and what this sender mails is a bearer credential.
     */
    where: {
      id: input.stayId,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
    },
    select: {
      id: true,
      reference: true,
      portalToken: true,
      checkIn: true,
      checkOut: true,
      guest: { select: { firstName: true, email: true, locale: true } },
      property: { select: { name: true } },
    },
  })

  if (!stay?.guest?.email) return 'skipped'

  const locale = localeOf(stay.guest.locale)

  return deliver({
    kind: EmailKind.GUEST_PORTAL_LINK,
    organizationId: input.organizationId,
    to: { address: stay.guest.email, name: stay.guest.firstName },
    locale,
    rendered: guestPortalLink(locale, {
      guestName: stay.guest.firstName,
      propertyName: stay.property.name,
      checkIn: formatDate(locale, stay.checkIn),
      checkOut: formatDate(locale, stay.checkOut),
      reference: stay.reference,
      portalUrl: publicUrl(`/g/${stay.portalToken}`),
    }),
    about: { entityType: 'Stay', entityId: stay.id },
    causedByUserId: input.byUserId,
  })
}

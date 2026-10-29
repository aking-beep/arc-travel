import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { CheckCircle2, Clock, MapPin } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { LinkButton } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DemoBanner } from '@/components/demo-banner'
import { DemoFigure, Money } from '@/components/money'
import { getTranslator } from '@/lib/i18n/server'
import { toDateKey, toLocalDateKey, toLocalTimeString } from '@/lib/dates'
import { getActor } from '@/modules/auth/service'
import { experienceTitle, getGuestOrder } from '@/modules/guest/account'
import { canDeliverEmail } from '@/modules/notifications/service'
import { PrintLink } from './print-link'

export const metadata = { title: 'Your order · ARC Stay' }
export const dynamic = 'force-dynamic'

/**
 * What somebody just bought, on the account they just got.
 *
 * This is where the storefront's till lands, and it is the first page a new
 * account holder sees. It answers the three questions somebody has the moment
 * a payment goes through — what did I buy, when does it happen, and what do I
 * do now — and then hands off to `/me`, which holds everything rather than
 * this one order.
 *
 * The order is loaded by `getGuestOrder`, which scopes by the signed-in user.
 * A reference belonging to somebody else is `notFound` rather than forbidden:
 * the two answers together would tell a stranger whether a reference exists.
 */
export default async function OrderPage({
  params,
}: {
  params: Promise<{ reference: string }>
}) {
  const { reference } = await params
  const actor = await getActor()
  if (!actor) redirect(`/sign-in?next=${encodeURIComponent(`/me/orders/${reference}`)}`)

  const { t, locale } = await getTranslator()
  const found = await getGuestOrder(actor.userId, reference)
  if (!found) notFound()
  const { stay, order } = found

  /*
   * Whether a confirmation will actually reach an inbox. Stricter than
   * "was it composed": `canDeliverEmail` is false while the mailer only
   * records, which is every demo deployment.
   */
  const mailIsDelivered = canDeliverEmail()

  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBanner />

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-5 py-10">
        <div>
          <p className="text-jade-700 flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="size-4" aria-hidden />
            {t('account.orderThanks')}
          </p>
          <h1 className="font-display mt-2 text-2xl font-semibold">
            {t('account.orderHeading', { reference: order.reference })}
          </h1>
          <p className="text-sand-600 mt-1 text-sm">
            {t('account.orderPlaced', { date: toDateKey(order.placedAt) })} · {stay.propertyName}
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <CardTitle className="text-base">{t('account.bookingsTitle')}</CardTitle>
              <span className="text-sm">
                {t('account.orderTotal')}{' '}
                {/* The headline figure on this page, so it carries the marker.
                    Neutral intent: this is what the guest paid, which is never
                    summed with anybody's earnings (ADR-007). */}
                <DemoFigure>
                  <Money
                    amountMinor={order.totalMinor}
                    currency={order.currency}
                    intent="neutral"
                    className="font-medium"
                  />
                </DemoFigure>
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="border-sand-200 divide-sand-200 divide-y rounded-xl border">
              {order.items.map((item) => (
                <li key={item.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className={item.cancelledAt ? 'text-sand-500 line-through' : 'font-medium'}>
                      {experienceTitle(item, locale)}
                      {item.quantity > 1 ? (
                        <span className="text-sand-500 font-normal"> ×{item.quantity}</span>
                      ) : null}
                    </p>
                    <Money amountMinor={item.totalMinor} currency={item.currency} intent="neutral" />
                  </div>
                  <p className="text-sand-600 mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    {item.startsAt ? (
                      <span className="flex items-center gap-1.5 tabular-nums">
                        <Clock className="size-3.5" aria-hidden />
                        {toLocalDateKey(item.startsAt)} · {toLocalTimeString(item.startsAt)}
                      </span>
                    ) : null}
                    {item.meetingPoint ? (
                      <span className="flex items-center gap-1.5">
                        <MapPin className="size-3.5" aria-hidden />
                        {item.meetingPoint}
                      </span>
                    ) : null}
                    <span>{item.supplierName}</span>
                  </p>
                  <p className="mt-2">
                    {item.cancelledAt ? (
                      <Badge tone="neutral">{t('account.bookingCancelled')}</Badge>
                    ) : item.supplierConfirmed ? (
                      <Badge tone="success">{t('account.bookingConfirmed')}</Badge>
                    ) : (
                      <Badge tone="warning">{t('account.bookingAwaitingPartner')}</Badge>
                    )}
                  </p>
                </li>
              ))}
            </ul>
            <p className="text-sand-600 mt-4 text-sm leading-relaxed">{t('account.orderNext')}</p>
          </CardContent>
        </Card>

        {/*
         * What happens next, and what does not.
         *
         * The page said "Paid. This is what you bought." and then stopped. A
         * visitor who had just handed over money and made an account had no
         * statement of whether an email was coming, nothing they could keep,
         * and nowhere to ask a question — the commonest complaint about the
         * whole flow, and all three are one card.
         *
         * The email line is the honest one rather than the reassuring one.
         * Demo mode forces `MAIL_PROVIDER=log` (ADR-040), so a confirmation
         * is written and recorded and never delivered. Telling somebody to
         * check an inbox nothing will arrive in is how a support thread
         * starts.
         */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('account.orderKeepTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sand-700 text-sm leading-relaxed">
              {mailIsDelivered
                ? t('account.orderEmailSent')
                : t('account.orderEmailRecorded')}
            </p>
            <p className="text-sand-700 text-sm leading-relaxed">
              {t('account.orderKeepBody', { reference: order.reference })}
            </p>
            <p className="text-sand-600 text-sm leading-relaxed">
              {t('account.orderHelp')}{' '}
              <Link href="/support" className="text-jade-800 underline underline-offset-4">
                {t('account.orderHelpLink')}
              </Link>
              .
            </p>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <LinkButton href="/me">{t('account.orderBack')}</LinkButton>
          {stay.portalPath ? (
            <Link
              href={stay.portalPath}
              className="text-jade-800 text-sm underline underline-offset-4"
            >
              {t('account.openTrip')}
            </Link>
          ) : null}
          {/*
           * The one thing a guest could not do with this page: keep it. No
           * email arrives in this deployment, so the browser's own print is
           * the receipt. A plain link rather than a button, because it is a
           * fallback and not the next step.
           */}
          <PrintLink label={t('account.orderPrint')} />
        </div>
      </main>
    </div>
  )
}

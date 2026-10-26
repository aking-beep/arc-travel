import { notFound } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle2, Phone } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Money } from '@/components/money'
import { createTranslator } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'
import { toLocalDateKey, toLocalTimeString } from '@/lib/dates'
import { resolvePortalForRequest } from '../../resolve'
import { getOrderForGuest } from '@/modules/commerce/checkout'
import { isCurrentlyVerified } from '@/modules/admin/verification'
import { CancelBookingForm } from './forms'

export const metadata = { title: 'Your booking' }

export default async function OrderPage({
  params,
}: {
  params: Promise<{ token: string; reference: string }>
}) {
  const { token, reference } = await params
  const context = await resolvePortalForRequest(token)
  const order = await getOrderForGuest(reference, context.guestId)
  if (!order) notFound()

  const locale = await getLocale()
  const t = createTranslator(locale)

  const now = new Date()
  const live = order.items.filter((i) => i.status !== 'CANCELLED' && i.status !== 'REFUNDED')
  const cancelled = order.items.filter((i) => i.status === 'CANCELLED' || i.status === 'REFUNDED')

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
        <p className="flex items-center gap-2 font-medium text-emerald-900">
          <CheckCircle2 className="size-5" aria-hidden />
          {t('guest.orderConfirmed')}
        </p>
        <p className="mt-1 font-mono text-sm text-emerald-800">{order.reference}</p>
        <p className="mt-2 text-sm leading-relaxed text-emerald-900">
          {t('guest.orderSimulatedNote')}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-xl font-semibold">Your bookings</h2>
        <Badge tone="demo">{t('common.demoData')}</Badge>
      </div>

      <ul className="space-y-3">
        {live.map((item) => (
          <li key={item.id} className="card-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">
                  {(locale === 'es' && item.experience.titleEs) || item.experience.titleEn}
                </p>
                <p className="text-sand-500 text-xs tabular-nums">
                  {toLocalDateKey(item.slot.startsAt)} · {toLocalTimeString(item.slot.startsAt)}–
                  {toLocalTimeString(item.slot.endsAt)}
                </p>
                <p className="text-sand-500 text-xs">
                  {item.experience.supplier.name}
                  {/* The live answer: a verification lapses when the
                      insurance on file expires (ADR-036). */}
                  {isCurrentlyVerified(item.experience.supplier, now)
                    ? ''
                    : ` · ${t('common.unverified')}`}
                </p>
              </div>
              <div className="text-right">
                <Money
                  intent="neutral"
                  amountMinor={item.lineTotalMinor}
                  currency={item.currency}
                  className="font-semibold"
                />
                <p className="text-sand-500 text-xs">
                  {item.quantity} {t('common.people')}
                </p>
              </div>
            </div>

            {item.experience.meetingPoint ? (
              <p className="text-sand-600 mt-2 text-sm">
                <span className="text-sand-500 text-xs uppercase">{t('guest.meetingPoint')}: </span>
                {item.experience.meetingPoint}
              </p>
            ) : null}

            <div className="border-sand-200 mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <span className="text-sand-500 text-xs">
                {item.supplierConfirmedAt
                  ? 'Confirmed by the partner.'
                  : 'Waiting on the partner to confirm — they do this by hand.'}
              </span>
              <CancelBookingForm
                token={token}
                orderItemId={item.id}
                cancellationHours={item.experience.cancellationPolicyHours}
                locale={locale}
              />
            </div>
          </li>
        ))}
      </ul>

      {cancelled.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Cancelled</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-sand-200 divide-y text-sm">
              {cancelled.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="text-sand-600">{item.experience.titleEn}</span>
                  <span className="text-sand-500 text-xs">
                    {item.refundedMinor > 0 ? (
                      <>
                        Refunded <Money amountMinor={item.refundedMinor} currency={item.currency} intent="neutral" />
                      </>
                    ) : (
                      'No refund — outside the window'
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('common.total')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-sand-600">{t('common.subtotal')}</span>
            <Money amountMinor={order.subtotalMinor} currency={order.currency} intent="neutral" />
          </div>
          {order.feesMinor > 0 ? (
            <div className="flex justify-between">
              <span className="text-sand-600">{t('common.fees')}</span>
              <Money amountMinor={order.feesMinor} currency={order.currency} intent="neutral" />
            </div>
          ) : null}
          {order.refundedMinor > 0 ? (
            <div className="flex justify-between">
              <span className="text-sand-600">Refunded</span>
              <span>
                −<Money amountMinor={order.refundedMinor} currency={order.currency} intent="neutral" />
              </span>
            </div>
          ) : null}
          <div className="border-sand-200 flex justify-between border-t pt-2 font-semibold">
            <span>{t('common.total')}</span>
            <Money amountMinor={order.totalMinor} currency={order.currency} intent="neutral" />
          </div>
        </CardContent>
      </Card>

      {order.property.contactPhone ? (
        <p className="text-sand-600 flex items-center gap-2 text-sm">
          <Phone className="size-4" aria-hidden />
          Anything unclear, call {order.property.name} on {order.property.contactPhone}.
        </p>
      ) : null}

      <Link href={`/g/${token}`} className="text-jade-800 inline-block text-sm underline underline-offset-4">
        {t('guest.viewItinerary')}
      </Link>
    </div>
  )
}

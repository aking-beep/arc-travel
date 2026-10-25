import { randomUUID } from 'node:crypto'
import { AlertTriangle, Timer } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { LinkButton } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { Money } from '@/components/money'
import { createTranslator } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'
import { toLocalDateKey, toLocalTimeString } from '@/lib/dates'
import { resolvePortalForRequest } from '../resolve'
import { getCartView, getOrCreateCart, validateCart } from '@/modules/commerce/cart'
import { BasketActions, CheckoutForm } from './forms'

export const metadata = { title: 'Your basket' }

export default async function BasketPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const context = await resolvePortalForRequest(token)
  const locale = await getLocale()
  const t = createTranslator(locale)

  const cartId = await getOrCreateCart({
    organizationId: context.organizationId,
    propertyId: context.propertyId,
    guestId: context.guestId,
    stayId: context.stayId,
    currency: context.property.currency,
  })

  const [cart, validation] = await Promise.all([getCartView(cartId), validateCart(cartId)])

  if (!cart || cart.items.length === 0) {
    return (
      <div className="space-y-5">
        <h2 className="font-display text-xl font-semibold">{t('guest.cart')}</h2>
        <EmptyState
          title={t('guest.emptyBasket')}
          description="Add something from your itinerary or from Explore."
          action={<LinkButton href={`/g/${token}/explore`}>{t('guest.explore')}</LinkButton>}
        />
      </div>
    )
  }

  // One key per rendered basket state. A resubmission of this exact page
  // replays the first checkout instead of creating a second order.
  const idempotencyKey = randomUUID()

  const blocking = validation.problems.filter((p) => p.code !== 'empty')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-xl font-semibold">{t('guest.cart')}</h2>
        <Badge tone="demo">{t('common.demoData')}</Badge>
      </div>

      {blocking.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
            <AlertTriangle className="size-4" aria-hidden />
            This needs sorting before checkout
          </p>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {blocking.map((problem) => (
              <li key={`${problem.code}-${problem.slotId}`}>{problem.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <ul className="space-y-3">
        {cart.items.map((item) => (
          <li key={item.id} className="card-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{item.title}</p>
                <p className="text-sand-500 text-xs tabular-nums">
                  {toLocalDateKey(item.startsAt)} · {toLocalTimeString(item.startsAt)} ·{' '}
                  {item.durationMinutes} {t('common.minutes')}
                </p>
                <p className="text-sand-500 text-xs">
                  {item.supplierName}
                  {item.supplierVerified ? '' : ` · ${t('common.unverified')}`}
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
                  {item.quantity} × <Money amountMinor={item.unitPriceMinor} currency={item.currency} intent="neutral" />
                </p>
              </div>
            </div>

            {item.meetingPoint ? (
              <p className="text-sand-600 mt-2 text-xs">
                {t('guest.meetingPoint')}: {item.meetingPoint}
              </p>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              {item.holdExpiresAt ? (
                <span className="text-sand-500 flex items-center gap-1 text-xs tabular-nums">
                  <Timer className="size-3.5" aria-hidden />
                  {t('guest.holdExpires')} {item.holdExpiresAt.toISOString().slice(11, 16)} UTC
                </span>
              ) : (
                <span className="text-xs font-medium text-amber-800">
                  Your hold has lapsed — add it again to re-reserve.
                </span>
              )}
              <BasketActions token={token} slotId={item.slotId} locale={locale} />
            </div>
          </li>
        ))}
      </ul>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('common.total')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-sand-600">{t('common.subtotal')}</span>
            <Money amountMinor={cart.subtotalMinor} currency={cart.currency} intent="neutral" />
          </div>
          {cart.feesMinor > 0 ? (
            <div className="flex justify-between">
              <span className="text-sand-600">{t('common.fees')}</span>
              <Money amountMinor={cart.feesMinor} currency={cart.currency} intent="neutral" />
            </div>
          ) : null}
          <div className="border-sand-200 flex justify-between border-t pt-2 text-base font-semibold">
            <span>{t('common.total')}</span>
            <Money amountMinor={cart.totalMinor} currency={cart.currency} intent="neutral" />
          </div>

          <CheckoutForm
            token={token}
            idempotencyKey={idempotencyKey}
            disabled={blocking.length > 0}
            locale={locale}
          />

          <p className="text-sand-500 text-xs leading-relaxed">
            {t('guest.orderSimulatedNote')}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

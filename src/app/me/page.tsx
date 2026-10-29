import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  CalendarRange,
  Clock,
  Luggage,
  MapPin,
  Phone,
  ShoppingBasket,
  Sparkles,
  Wallet,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button, LinkButton } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { DemoBanner } from '@/components/demo-banner'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { DemoFigure, Money } from '@/components/money'
import { signOutAction } from '@/app/actions'
import { getTranslator } from '@/lib/i18n/server'
import type { AppLocale } from '@/lib/i18n'
import { addDays, toDateKey, toLocalTimeString } from '@/lib/dates'
import { OrderStatus, StayKind, StayStatus } from '@/lib/prisma-types'
import { getActor } from '@/modules/auth/service'
import {
  experienceTitle,
  getGuestAccount,
  type AccountSpend,
  type AccountStay,
} from '@/modules/guest/account'
import { listDirectStorefronts } from '@/modules/guest/direct'
import { ClaimForm } from './claim-form'
import { TripForm } from './trip-form'

export const metadata = { title: 'Your bookings · ARC Stay' }

/**
 * The guest's own account.
 *
 * Deliberately an index and a summary, not a second portal. Everything that
 * *changes* something — intake, the itinerary, the basket, a cancellation —
 * stays behind `/g/<token>`, which is one authorisation boundary with one set
 * of rate limits and one grace window. This page proves who is asking and then
 * hands over the link; it does not re-implement the surface behind it.
 *
 * Two things it does that the portal cannot: it survives a lost QR code, and
 * it shows every booking the person has claimed rather than the one stay the
 * token in their hand happens to name. See ADR-039.
 */
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ unpaid?: string }>
}) {
  const actor = await getActor()
  if (!actor) redirect('/sign-in?next=%2Fme')

  const { unpaid } = await searchParams
  const { locale, t } = await getTranslator()
  const [account, storefronts] = await Promise.all([
    getGuestAccount(actor.userId),
    listDirectStorefronts(),
  ])

  // Server-computed: a client component must not read the clock during render.
  const today = toDateKey(new Date())

  // A signed-in user whose account row vanished between the session and this
  // read. Sending them to sign in again is the honest answer.
  if (!account) redirect('/sign-in?next=%2Fme')

  /*
   * The unpaid notice, for the one state it is about.
   *
   * Matched against this person's own stays, so a crafted link cannot put a
   * reference on somebody's account page — and only a stay with no order at
   * all, which is what a till that committed and then failed to take the
   * payment leaves behind. A stay reference is printed on this page, so
   * without that second condition anybody could paste a *paid* trip's
   * reference and be told nothing had been charged for it; and the same link,
   * revisited after the trip was paid for in the portal, would keep saying so.
   */
  const unpaidStay = unpaid
    ? (account.stays.find((stay) => stay.reference === unpaid && stay.orders.length === 0) ?? null)
    : null

  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBanner />

      <header className="border-sand-200 border-b bg-white">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 px-5 py-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Luggage className="text-jade-700 size-5 shrink-0" aria-hidden />
              <h1 className="font-display truncate text-2xl font-semibold">{t('account.title')}</h1>
            </div>
            <p className="text-sand-600 mt-1 truncate text-sm">
              {t('account.signedInAs', { email: account.email })}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <LocaleSwitcher locale={locale} next="/me" />
            <form action={signOutAction}>
              <Button type="submit" variant="ghost" size="sm">
                {t('account.signOut')}
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-5 py-8">
        {/*
         * The till committed an account and a trip and then could not take the
         * payment. The storefront cannot say so itself — the basket it was
         * holding is claimed, so that page has already fallen back to its empty
         * state by the time anything could be rendered on it. The reference is
         * matched against this person's own stays rather than printed from the
         * URL, so a crafted link cannot put words on somebody's account page.
         */}
        {unpaidStay ? (
          <Card className="border-terracotta-200 bg-terracotta-50">
            <CardHeader>
              <CardTitle className="text-base">{t('account.unpaidTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sand-700 text-sm">
                {t('account.unpaidBody', { reference: unpaidStay.reference })}
              </p>
            </CardContent>
          </Card>
        ) : null}

        {account.stays.length === 0 ? (
          <EmptyState
            icon={<CalendarRange className="size-6" aria-hidden />}
            title={t('account.emptyTitle')}
            description={t('account.emptyBody')}
          />
        ) : (
          <>
            <SpendCard spend={account.spend} t={t} />
            <p className="text-sand-600 text-sm">{t('account.subtitle')}</p>
            {account.stays.map((stay) => (
              <StayCard key={stay.stayId} stay={stay} t={t} locale={locale} />
            ))}
          </>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('account.claimTitle')}</CardTitle>
            <p className="text-sand-600 text-sm">{t('account.claimSub')}</p>
          </CardHeader>
          <CardContent>
            <ClaimForm
              labels={{
                reference: t('account.claimReference'),
                email: t('account.claimEmail'),
                emailHint: t('account.claimEmailHint'),
                submit: t('account.claimSubmit'),
                pending: t('account.claimPending'),
                note: t('account.nothingChanged'),
              }}
            />
          </CardContent>
        </Card>
        {storefronts.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('account.tripTitle')}</CardTitle>
              <p className="text-sand-600 text-sm">{t('account.tripSub')}</p>
            </CardHeader>
            <CardContent>
              <TripForm
                labels={{
                  property: t('account.tripProperty'),
                  from: t('account.tripFrom'),
                  to: t('account.tripTo'),
                  party: t('account.tripParty'),
                  submit: t('account.tripSubmit'),
                  pending: t('account.tripPending'),
                }}
                storefronts={storefronts}
                defaultFromDate={today}
                defaultToDate={addDays(today, 2)}
              />
            </CardContent>
          </Card>
        ) : null}
      </main>
    </div>
  )
}

type Translate = Awaited<ReturnType<typeof getTranslator>>['t']

function StayCard({
  stay,
  t,
  locale,
}: {
  stay: AccountStay
  t: Translate
  locale: AppLocale
}) {
  const live = stay.portalPath !== null
  const orders = stay.orders
  const bookedItems = orders.flatMap((order) => order.items)

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-lg">{stay.propertyName}</CardTitle>
            {stay.placeName ? (
              <p className="text-sand-600 mt-1 flex items-center gap-1 text-sm">
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                {stay.placeName}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {stay.kind === StayKind.DIRECT ? (
              <Badge tone="accent">{t('account.tripBadge')}</Badge>
            ) : null}
            <Badge tone={timingTone(stay)}>{timingLabel(stay, t)}</Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-sand-500 text-xs tracking-wide uppercase">
              {stay.kind === StayKind.DIRECT ? t('account.tripFrom') : t('account.checkIn')}
            </dt>
            <dd className="mt-0.5 font-medium">
              {stay.checkIn}
              {stay.kind === StayKind.DIRECT ? null : (
                <span className="text-sand-500 font-normal"> · {stay.checkInTime}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-sand-500 text-xs tracking-wide uppercase">
              {stay.kind === StayKind.DIRECT ? t('account.tripTo') : t('account.checkOut')}
            </dt>
            <dd className="mt-0.5 font-medium">
              {stay.checkOut}
              {stay.kind === StayKind.DIRECT ? null : (
                <span className="text-sand-500 font-normal"> · {stay.checkOutTime}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-sand-500 text-xs tracking-wide uppercase">
              {t('account.reference')}
            </dt>
            <dd className="mt-0.5 font-mono text-xs font-medium">{stay.reference}</dd>
          </div>
          <div>
            <dt className="text-sand-500 text-xs tracking-wide uppercase">
              {stay.nights === 1 ? t('account.oneNight') : t('account.nights', { count: stay.nights })}
            </dt>
            <dd className="text-sand-700 mt-0.5">
              {stay.partySize === 1
                ? t('account.oneGuest')
                : t('account.guests', { count: stay.partySize })}
            </dd>
          </div>
        </dl>

        {/* --- The plan ------------------------------------------------------ */}
        <section>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="text-jade-700 size-4" aria-hidden />
            {t('account.planTitle')}
          </h3>
          <p className="text-sand-700 mt-1 text-sm">
            {stay.itinerary
              ? t('account.planSummary', {
                  items: stay.itinerary.itemCount,
                  days: stay.itinerary.dayCount,
                })
              : t('account.planNone')}
          </p>
          {!stay.intakeCompleted ? (
            <p className="text-sand-600 mt-1 text-sm">{t('account.intakeOutstanding')}</p>
          ) : null}
          {stay.basketCount > 0 ? (
            <p className="text-sand-700 mt-1 flex items-center gap-1.5 text-sm">
              <ShoppingBasket className="size-4" aria-hidden />
              {t('account.basket', { count: stay.basketCount })}
            </p>
          ) : null}
        </section>

        {/* --- The itinerary, day by day ------------------------------------ */}
        <section>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Clock className="text-jade-700 size-4" aria-hidden />
            {t('account.scheduleTitle')}
          </h3>
          {stay.schedule.length === 0 ? (
            <p className="text-sand-600 mt-1 text-sm">{t('account.scheduleNone')}</p>
          ) : (
            <ol className="mt-2 space-y-3">
              {stay.schedule.map((day) => (
                <li key={day.date || 'unscheduled'}>
                  <p className="text-sand-500 text-xs font-medium tracking-wide uppercase tabular-nums">
                    {day.date || t('account.scheduleUnscheduled')}
                  </p>
                  <ul className="border-sand-200 mt-1 divide-y rounded-xl border">
                    {day.items.map((item) => (
                      <li key={item.id} className="px-4 py-2.5 text-sm">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="min-w-0">
                            <span className={item.cancelledAt ? 'text-sand-500 line-through' : ''}>
                              {item.startsAt ? (
                                <span className="tabular-nums">
                                  {toLocalTimeString(item.startsAt)}{' '}
                                </span>
                              ) : null}
                              {experienceTitle(item, locale)}
                            </span>
                            {item.quantity > 1 ? (
                              <span className="text-sand-500"> ×{item.quantity}</span>
                            ) : null}
                          </span>
                          <Money
                            amountMinor={item.totalMinor}
                            currency={item.currency}
                            intent="neutral"
                          />
                        </div>
                        <p className="text-sand-600 mt-0.5 text-xs">
                          {item.supplierName}
                          {item.meetingPoint ? ` · ${item.meetingPoint}` : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* --- What is booked ------------------------------------------------ */}
        <section>
          <h3 className="text-sm font-semibold">{t('account.bookingsTitle')}</h3>
          {bookedItems.length === 0 ? (
            <p className="text-sand-600 mt-1 text-sm">{t('account.bookingsNone')}</p>
          ) : (
            <ul className="border-sand-200 mt-2 divide-y rounded-xl border">
              {orders.map((order) => (
                <li key={order.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-mono text-xs">{order.reference}</p>
                    <p className="text-sand-700 text-sm">
                      {t('account.orderTotal')}{' '}
                      {/* Neutral: this is what the guest paid, not anyone's
                          earnings, and the two are never summed (ADR-007). */}
                      <Money
                        amountMinor={order.totalMinor}
                        currency={order.currency}
                        intent="neutral"
                        className="font-medium"
                      />
                      {order.status === OrderStatus.CANCELLED ||
                      order.status === OrderStatus.REFUNDED ? (
                        <Badge tone="neutral" className="ml-2">
                          {t('account.bookingCancelled')}
                        </Badge>
                      ) : null}
                    </p>
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {order.items.map((item) => (
                      <li
                        key={item.id}
                        className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                      >
                        <span className="min-w-0">
                          <span className={item.cancelledAt ? 'text-sand-500 line-through' : ''}>
                            {experienceTitle(item, locale)}
                          </span>
                          {item.quantity > 1 ? (
                            <span className="text-sand-500"> ×{item.quantity}</span>
                          ) : null}
                          {item.startsAt ? (
                            <span className="text-sand-500">
                              {' '}
                              · {toLocalTimeString(item.startsAt)}
                            </span>
                          ) : null}
                        </span>
                        <span className="flex items-center gap-2">
                          <Money
                            amountMinor={item.totalMinor}
                            currency={item.currency}
                            intent="neutral"
                          />
                          {item.cancelledAt ? (
                            <Badge tone="neutral">{t('account.bookingCancelled')}</Badge>
                          ) : item.supplierConfirmed ? (
                            <Badge tone="success">{t('account.bookingConfirmed')}</Badge>
                          ) : (
                            <Badge tone="warning">{t('account.bookingAwaitingPartner')}</Badge>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* --- Into the portal ---------------------------------------------- */}
        <div className="flex flex-wrap items-center gap-3">
          {live ? (
            <LinkButton href={stay.portalPath as string}>{t('account.openStay')}</LinkButton>
          ) : (
            <p className="text-sand-600 text-sm">{t('account.portalClosed')}</p>
          )}
          {stay.contactPhone ? (
            <Link
              href={`tel:${stay.contactPhone}`}
              className="text-jade-800 flex items-center gap-1.5 text-sm underline underline-offset-4"
            >
              <Phone className="size-3.5" aria-hidden />
              {stay.contactPhone}
            </Link>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function timingTone(stay: AccountStay): 'brand' | 'success' | 'neutral' {
  if (stay.status === StayStatus.IN_HOUSE) return 'success'
  if (stay.daysUntilCheckIn >= 0) return 'brand'
  return 'neutral'
}

function timingLabel(stay: AccountStay, t: Translate): string {
  if (stay.status === StayStatus.IN_HOUSE) return t('account.underway')
  if (stay.daysUntilCheckIn === 0) return t('account.arrivesToday')
  if (stay.daysUntilCheckIn > 0) return t('account.arrivesInDays', { count: stay.daysUntilCheckIn })
  return t('account.past')
}

/**
 * What the person has spent, and on what.
 *
 * One block per currency, never a single figure across them: an account can
 * hold bookings at two properties pricing in different currencies, and one
 * number over both has no unit. Gross and refunded are shown side by side
 * rather than netted into one figure, because "you paid 4,000 and 1,200 came
 * back" is something somebody can check against their bank and a net number is
 * not.
 */
function SpendCard({ spend, t }: { spend: AccountSpend[]; t: Translate }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Wallet className="text-jade-700 size-4" aria-hidden />
          <CardTitle className="text-base">{t('account.spendTitle')}</CardTitle>
        </div>
        <p className="text-sand-600 text-sm">{t('account.spendSub')}</p>
      </CardHeader>
      <CardContent>
        {spend.length === 0 ? (
          <p className="text-sand-600 text-sm">{t('account.spendNothing')}</p>
        ) : (
          <div className="space-y-5">
            {spend.map((entry) => (
              <div key={entry.currency}>
                <dl className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <dt className="text-sand-500 text-xs tracking-wide uppercase">
                      {t('account.spendGross')}
                    </dt>
                    <dd className="mt-0.5">
                      {/* The headline figure, so it carries the demo marker.
                          Neutral: guest spend is never summed with earnings
                          or potential value (ADR-007). */}
                      <DemoFigure>
                        <Money
                          amountMinor={entry.grossMinor}
                          currency={entry.currency}
                          intent="neutral"
                          className="font-medium"
                        />
                      </DemoFigure>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sand-500 text-xs tracking-wide uppercase">
                      {t('account.spendRefunded')}
                    </dt>
                    <dd className="mt-0.5">
                      <Money
                        amountMinor={entry.refundedMinor}
                        currency={entry.currency}
                        intent="neutral"
                      />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sand-500 text-xs tracking-wide uppercase">
                      {t('account.spendNet')}
                    </dt>
                    <dd className="mt-0.5 font-medium">
                      <Money
                        amountMinor={entry.netMinor}
                        currency={entry.currency}
                        intent="neutral"
                      />
                    </dd>
                  </div>
                </dl>

                {entry.byCategory.length > 0 ? (
                  <ul className="border-sand-200 mt-3 divide-y rounded-xl border">
                    {entry.byCategory.map((row) => (
                      <li
                        key={row.category}
                        className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm"
                      >
                        <span>
                          {row.category}
                          <span className="text-sand-500">
                            {' '}
                            · {t('account.spendItems', { count: row.itemCount })}
                          </span>
                        </span>
                        {/* Deliberately not a DemoFigure: thirty badges down a
                            column stop being read. The marker is on the
                            headline above. */}
                        <Money
                          amountMinor={row.totalMinor}
                          currency={entry.currency}
                          intent="neutral"
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

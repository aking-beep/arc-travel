import { randomUUID } from 'node:crypto'
import Link from 'next/link'
import { CalendarRange, Clock, Info, MapPin, ShieldCheck, Users } from 'lucide-react'
import { Shell } from '@/components/explore/editorial'
import { DemoFigure, Money } from '@/components/money'
import { EmptyState } from '@/components/ui/states'
import { toLocalDateKey, toLocalTimeString } from '@/lib/dates'
import { getTranslator } from '@/lib/i18n/server'
import { getActor } from '@/modules/auth/service'
import {
  listVisitorListings,
  nextBookableDate,
  resumeVisitorTrip,
  type VisitorDeparture,
} from '@/modules/guest/visitor'
import { abilityField } from './ability-labels'
import { ChangeTripForm, DepartureDay, PayForTripForm, RemoveLineForm } from './forms'
import { readTripSession } from './session'

export const metadata = { title: 'Your trip' }
/** The basket is per-visitor and changes on every add; nothing here is static. */
export const dynamic = 'force-dynamic'

/**
 * The storefront basket, and the till.
 *
 * Everything a visitor can buy is on one page on purpose. The product already
 * had a basket, a conditions gate, holds and a checkout — behind a QR code a
 * hotel hands out at a front desk. Somebody reading a property page had no way
 * to reach any of it, so the page ended at a link into a demo portal, which is
 * a tour of the product rather than a way to buy from it.
 *
 * What the page refuses to do is as important as what it does. It sells no
 * room: ARC holds no room calendar, the property page says so, and a basket
 * line for a bed nobody has confirmed would be the invented availability the
 * product exists not to claim. It sells departures, which are real rows with
 * real seat counts, and it says who is behind each one and whether anybody has
 * checked them.
 */
export default async function BookPage() {
  const { t } = await getTranslator()
  const [session, actor] = await Promise.all([readTripSession(), getActor()])
  const trip = await resumeVisitorTrip(session)

  if (!trip) {
    return (
      <Shell className="pt-10 pb-20 md:pt-16">
        <h1 className="text-4xl tracking-tight md:text-6xl">{t('explore.book.heading')}</h1>
        <EmptyState
          className="mt-8"
          icon={<CalendarRange className="size-6" aria-hidden />}
          title={t('explore.book.noneTitle')}
          description={t('explore.book.noneBody')}
        />
        <p className="mt-6 text-sm">
          <Link href="/stays" className="underline underline-offset-4">
            {t('explore.book.browseStays')}
          </Link>
        </p>
      </Shell>
    )
  }

  const listings = await listVisitorListings({
    propertyId: trip.property.id,
    fromDate: trip.session.fromDate,
    toDate: trip.session.toDate,
    partySize: trip.session.partySize,
    surfAbility: trip.session.surfAbility,
  })

  // Asked only when the window came back empty: "nothing runs on those days"
  // on its own leaves somebody guessing which days do.
  const nextDay =
    listings.length === 0
      ? await nextBookableDate({ propertyId: trip.property.id, after: trip.session.toDate })
      : null

  const inBasket = new Set(trip.cart.items.map((item) => item.slotId))
  // Server-computed: the forms below must not read a clock during render.
  const idempotencyKey = randomUUID()

  return (
    <Shell className="pt-10 pb-20 md:pt-16">
      <h1 className="text-4xl tracking-tight md:text-6xl">{t('explore.book.heading')}</h1>
      <p className="text-muted mt-3 max-w-xl text-sm leading-relaxed">
        {t('explore.book.lede', { property: trip.property.name })}
      </p>

      <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_380px] lg:gap-16">
        <div>
          {/* --- When, and who with ---------------------------------------- */}
          <section className="border-line rounded-2xl border p-5">
            <h2 className="text-lg">{t('explore.book.windowHeading')}</h2>
            <p className="text-muted mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="flex items-center gap-1.5">
                <CalendarRange className="size-4" aria-hidden />
                {trip.session.fromDate} → {trip.session.toDate}
              </span>
              <span className="flex items-center gap-1.5">
                <Users className="size-4" aria-hidden />
                {t('explore.book.travellersCount', { count: trip.session.partySize })}
              </span>
              {trip.property.placeName ? (
                <span className="flex items-center gap-1.5">
                  <MapPin className="size-4" aria-hidden />
                  {trip.property.placeName}
                </span>
              ) : null}
            </p>
            <div className="mt-4">
              <ChangeTripForm
                fromDate={trip.session.fromDate}
                toDate={trip.session.toDate}
                partySize={trip.session.partySize}
                ability={abilityField(t, trip.session.surfAbility)}
                labels={{
                  arrive: t('explore.stay.arrive'),
                  depart: t('explore.stay.depart'),
                  travellers: t('explore.stay.travellers'),
                  submit: t('explore.book.changeSubmit'),
                  pending: t('explore.book.changePending'),
                }}
              />
            </div>
          </section>

          {/* --- What you can book ----------------------------------------- */}
          <section className="mt-12">
            <h2 className="text-2xl md:text-3xl">{t('explore.book.catalogueHeading')}</h2>
            <p className="text-muted mt-2 max-w-prose text-sm leading-relaxed">
              {t('explore.book.catalogueLede')}
            </p>

            {listings.length === 0 ? (
              <EmptyState
                className="mt-6"
                icon={<CalendarRange className="size-6" aria-hidden />}
                title={t('explore.book.catalogueEmptyTitle')}
                description={
                  nextDay
                    ? t('explore.book.catalogueNextDay', { date: nextDay })
                    : t('explore.book.catalogueEmptyBody')
                }
              />
            ) : (
              <ul className="divide-line border-line mt-6 divide-y border-y">
                {listings.map((listing) => (
                  <li key={listing.experienceId} className="py-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-lg">{listing.title}</h3>
                        <p className="text-muted mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          <span>{listing.supplierName}</span>
                          <span className="flex items-center gap-1">
                            {listing.supplierVerified ? (
                              <>
                                <ShieldCheck className="size-3.5" aria-hidden />
                                {t('explore.verification.verified')}
                              </>
                            ) : (
                              <>
                                <Info className="size-3.5" aria-hidden />
                                {t('explore.verification.unverified')}
                              </>
                            )}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="size-3.5" aria-hidden />
                            {t('explore.book.minutes', { count: listing.durationMinutes })}
                          </span>
                        </p>
                        {listing.summary ? (
                          <p className="text-muted mt-2 max-w-prose text-sm leading-relaxed">
                            {listing.summary}
                          </p>
                        ) : null}
                      </div>
                      <p className="shrink-0 text-sm">
                        <Money
                          amountMinor={listing.unitPriceMinor}
                          currency={listing.currency}
                          intent="neutral"
                          className="font-medium"
                        />
                        <span className="text-muted"> {t('explore.book.perPerson')}</span>
                      </p>
                    </div>

                    <div className="mt-4 space-y-4">
                      {groupByDay(listing.departures).map((day) => (
                        <DepartureDay
                          key={day.date}
                          date={day.date}
                          defaultQuantity={trip.session.partySize}
                          maxParty={listing.maxParty}
                          labels={{
                            adding: t('explore.book.adding'),
                            inBasket: t('explore.book.alreadyAdded'),
                          }}
                          choices={day.departures.map((departure) => ({
                            slotId: departure.slotId,
                            time: toLocalTimeString(departure.startsAt),
                            inBasket: inBasket.has(departure.slotId),
                            blockedReason: !departure.allowed
                              ? (departure.blockers[0] ?? t('explore.book.notBookable'))
                              : departure.capacityRemaining < trip.session.partySize
                                ? t('explore.book.notEnoughSeats')
                                : null,
                          }))}
                        />
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* --- The basket and the till -------------------------------------- */}
        <aside className="order-first self-start lg:sticky lg:top-28 lg:order-none">
          <div className="border-line rounded-2xl border p-5">
            <h2 className="text-lg">{t('explore.book.basketHeading')}</h2>

            {trip.cart.items.length === 0 ? (
              <p className="text-muted mt-3 text-sm leading-relaxed">
                {t('explore.book.basketEmpty')}
              </p>
            ) : (
              <>
                <ul className="divide-line mt-3 divide-y">
                  {trip.cart.items.map((item) => {
                    const outsideWindow =
                      toLocalDateKey(item.startsAt) < trip.session.fromDate ||
                      toLocalDateKey(item.startsAt) > trip.session.toDate
                    return (
                      <li key={item.id} className="py-3">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="min-w-0 text-sm">
                            {item.title}
                            {item.quantity > 1 ? (
                              <span className="text-muted"> ×{item.quantity}</span>
                            ) : null}
                          </p>
                          <Money
                            amountMinor={item.lineTotalMinor}
                            currency={item.currency}
                            intent="neutral"
                            className="shrink-0 text-sm"
                          />
                        </div>
                        <p className="text-muted mt-0.5 text-xs tabular-nums">
                          {toLocalDateKey(item.startsAt)} · {toLocalTimeString(item.startsAt)}
                        </p>
                        {item.holdExpiresAt === null ? (
                          <p className="mt-1 text-xs">{t('explore.book.holdLapsed')}</p>
                        ) : null}
                        {outsideWindow ? (
                          <p className="mt-1 text-xs">{t('explore.book.outsideWindow')}</p>
                        ) : null}
                        <div className="mt-1">
                          <RemoveLineForm slotId={item.slotId} label={t('explore.book.remove')} />
                        </div>
                      </li>
                    )
                  })}
                </ul>

                <div className="border-line mt-4 border-t pt-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm">{t('explore.book.total')}</span>
                    {/* A headline figure, so it carries the demo marker. It is
                        what the guest pays — neither earnings nor potential
                        value, which are never summed with it (ADR-007). */}
                    <DemoFigure>
                      <Money
                        amountMinor={trip.cart.totalMinor}
                        currency={trip.cart.currency}
                        intent="neutral"
                        className="text-lg font-medium"
                      />
                    </DemoFigure>
                  </div>
                  {trip.cart.feesMinor > 0 ? (
                    <p className="text-muted mt-1 text-xs">
                      {t('explore.book.includesFees')}{' '}
                      <Money
                        amountMinor={trip.cart.feesMinor}
                        currency={trip.cart.currency}
                        intent="neutral"
                      />
                    </p>
                  ) : null}
                </div>

                <div className="mt-5">
                  <PayForTripForm
                    idempotencyKey={idempotencyKey}
                    signedInAs={actor?.email ?? null}
                    labels={{
                      name: t('explore.book.name'),
                      email: t('explore.book.email'),
                      password: t('explore.book.password'),
                      confirmPassword: t('explore.book.confirmPassword'),
                      passwordHint: t('explore.book.passwordHint'),
                      terms: t('explore.book.terms'),
                      submit: t('explore.book.pay'),
                      pending: t('explore.book.paying'),
                      signedIn: t('explore.book.signedIn'),
                    }}
                  />
                </div>
              </>
            )}

            <p className="text-muted mt-5 text-xs leading-relaxed">
              {t('explore.book.roomNote')}
            </p>
          </div>
        </aside>
      </div>
    </Shell>
  )
}

/**
 * Departures grouped by the day they run on, in order.
 *
 * `listVisitorListings` returns them flat and sorted, which is what the module
 * owes the caller; how they are laid out is this page's business.
 */
function groupByDay(
  departures: VisitorDeparture[],
): Array<{ date: string; departures: VisitorDeparture[] }> {
  const days = new Map<string, VisitorDeparture[]>()
  for (const departure of departures) {
    const bucket = days.get(departure.dateKey) ?? []
    bucket.push(departure)
    days.set(departure.dateKey, bucket)
  }
  return [...days.entries()].map(([date, items]) => ({ date, departures: items }))
}

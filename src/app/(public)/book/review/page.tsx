import { randomUUID } from 'node:crypto'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, CalendarRange, Info, MapPin, Users } from 'lucide-react'
import { Shell } from '@/components/explore/editorial'
import { DemoFigure, Money } from '@/components/money'
import { toLocalDateKey, toLocalTimeString } from '@/lib/dates'
import { getTranslator } from '@/lib/i18n/server'
import { getActor } from '@/modules/auth/service'
import { resumeVisitorTrip } from '@/modules/guest/visitor'
import { PayForTripForm } from '../forms'
import { readTripSession } from '../session'

export const metadata = { title: 'Review your trip' }

/** The basket is per-visitor and changes on every add; nothing here is static. */
export const dynamic = 'force-dynamic'

/**
 * Read your trip back before you pay for it.
 *
 * The till used to be one column: the basket lines, then a name, an email,
 * two password fields, a terms checkbox and a "Pay and create my account"
 * button, all in the right-hand rail of the page you shop on. One click
 * created the account, wrote the stay and took the money, and nothing in
 * between said *this is what you are buying*.
 *
 * That is a lot to ask of somebody buying from a brand they met four minutes
 * ago, and it is the step people look for. So the basket page now ends at
 * "Review and pay" and this is where paying happens: the window, the lines
 * grouped by the day they fall on, the total, and — stated before the button
 * rather than under it — the fact that no room is included.
 *
 * It holds nothing new. The basket, its holds and `payForTripAction` are
 * unchanged; this is a page between two things that already existed.
 */
export default async function ReviewTripPage() {
  const { t, locale } = await getTranslator()
  const [session, actor] = await Promise.all([readTripSession(), getActor()])
  const trip = await resumeVisitorTrip(session)

  // No basket to review. Sending them back to the shop is the only useful
  // answer, and it is the page that explains how to start one.
  if (!trip || trip.cart.items.length === 0) redirect('/book')

  // Server-computed: the form below must not read a clock during render. One
  // key per rendered page, so a double-tap replays the first order rather
  // than buying twice.
  const idempotencyKey = randomUUID()

  /*
   * Grouped by day, because that is how somebody checks a trip: they are
   * looking for a morning with two things in it, or a day with nothing. A
   * flat list of six lines sorted by when they were added answers neither.
   */
  const byDay = new Map<string, typeof trip.cart.items>()
  for (const item of [...trip.cart.items].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  )) {
    const day = toLocalDateKey(item.startsAt)
    byDay.set(day, [...(byDay.get(day) ?? []), item])
  }

  return (
    <Shell className="pt-10 pb-20 md:pt-16">
      <p className="text-sm">
        <Link
          href="/book"
          className="text-muted hover:text-ink inline-flex items-center gap-1.5 transition-colors duration-150"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t('explore.book.backToTrip')}
        </Link>
      </p>

      <h1 className="mt-4 text-4xl tracking-tight md:text-6xl">{t('explore.book.reviewHeading')}</h1>
      <p className="text-muted mt-3 max-w-xl text-sm leading-relaxed">
        {t('explore.book.reviewLede')}
      </p>

      <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_380px] lg:gap-16">
        {/* --- What you are buying ------------------------------------------ */}
        <div>
          <dl className="border-line grid grid-cols-2 gap-x-4 gap-y-4 border-y py-5 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted flex items-center gap-1.5 text-xs tracking-wide uppercase">
                <MapPin className="size-3.5" aria-hidden />
                {t('explore.book.reviewProperty')}
              </dt>
              <dd className="mt-1 font-medium">{trip.property.name}</dd>
            </div>
            <div>
              <dt className="text-muted flex items-center gap-1.5 text-xs tracking-wide uppercase">
                <CalendarRange className="size-3.5" aria-hidden />
                {t('explore.book.reviewWhen')}
              </dt>
              <dd className="mt-1 font-medium tabular-nums">
                {trip.session.fromDate} → {trip.session.toDate}
              </dd>
            </div>
            <div>
              <dt className="text-muted flex items-center gap-1.5 text-xs tracking-wide uppercase">
                <Users className="size-3.5" aria-hidden />
                {t('explore.book.reviewParty')}
              </dt>
              <dd className="mt-1 font-medium">{trip.session.partySize}</dd>
            </div>
          </dl>

          <div className="mt-8 space-y-8">
            {[...byDay.entries()].map(([day, items]) => (
              <section key={day}>
                <h2 className="text-muted text-xs font-medium tracking-wide uppercase tabular-nums">
                  {day}
                </h2>
                <ul className="divide-line mt-2 divide-y">
                  {items.map((item) => (
                    <li key={item.id} className="flex flex-wrap gap-3 py-3">
                      <span className="text-muted w-14 shrink-0 text-sm tabular-nums">
                        {toLocalTimeString(item.startsAt)}
                      </span>
                      <span className="min-w-0 flex-1 text-sm">
                        {item.title}
                        {item.quantity > 1 ? (
                          <span className="text-muted"> ×{item.quantity}</span>
                        ) : null}
                      </span>
                      <Money
                        amountMinor={item.lineTotalMinor}
                        currency={item.currency}
                        locale={locale}
                        intent="neutral"
                        className="shrink-0 text-sm"
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          {/*
           * Stated here, in full, before the button rather than in grey text
           * under it. A visitor has just come from a property page whose
           * largest figure was a room estimate; the one thing they must not
           * carry into this page is the belief that a bed is included.
           */}
          <div className="border-line mt-10 flex gap-3 rounded-2xl border border-dashed p-5">
            <Info className="text-muted mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="space-y-2 text-sm leading-relaxed">
              <p>{t('explore.book.roomNote')}</p>
              <p className="text-muted">{t('explore.book.reviewChangeNote')}</p>
            </div>
          </div>
        </div>

        {/* --- The till ----------------------------------------------------- */}
        <aside className="self-start lg:sticky lg:top-28">
          <div className="border-line rounded-2xl border p-6">
            <h2 className="text-lg">{t('explore.book.reviewPayHeading')}</h2>

            <div className="border-line mt-4 border-t pt-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm">{t('explore.book.total')}</span>
                {/* A headline figure, so it carries the demo marker. What the
                    guest pays — neither earnings nor potential value, which
                    are never summed with it (ADR-007). */}
                <DemoFigure>
                  <Money
                    amountMinor={trip.cart.totalMinor}
                    currency={trip.cart.currency}
                    locale={locale}
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
                    locale={locale}
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

            <p className="text-muted mt-4 text-xs leading-relaxed">
              {t('explore.book.reviewPaymentNote')}
            </p>
          </div>
        </aside>
      </div>
    </Shell>
  )
}

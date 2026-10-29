import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Check, Clock, MapPin } from 'lucide-react'
import { ExperienceCard } from '@/components/explore/cards'
import { IllustrativeNote, ListingBadge, Shell } from '@/components/explore/editorial'
import { ImageGallery } from '@/components/explore/image-gallery'
import { SaveButton } from '@/components/explore/save-button'
import { StayEstimator } from '@/components/explore/stay-estimator'
import { abilityField } from '@/app/(public)/book/ability-labels'
import { addDays, isDateKey, toLocalDateKey } from '@/lib/dates'
import { getTranslator } from '@/lib/i18n/server'
import { getDestination } from '@/modules/discovery/content/destinations'
import { experiences } from '@/modules/discovery/content/experiences'
import { getStay, stays } from '@/modules/discovery/content/stays'
import { liveStay } from '@/modules/discovery/live'
import { CONTENT_CURRENCY } from '@/modules/discovery/content/types'

export async function generateStaticParams() {
  return stays.map((stay) => ({ slug: stay.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { locale } = await getTranslator()
  const live = await liveStay(locale)
  const stay = live?.slug === slug ? live : getStay(slug)
  return { title: stay?.name ?? 'Stay' }
}

/**
 * One stay, ported from the export's `StayDetailPage`.
 *
 * Three differences. The invented 12% tax line is gone, for the reason in
 * `StayEstimator`. The star rating and review count are labelled as sample
 * figures rather than shown as social proof. And the map iframe is gone: the
 * export embedded OpenStreetMap at the *destination* centroid for a specific
 * hotel, which is a map of the wrong thing presented as the right thing, and it
 * pulled a third-party frame into the page to do it. The written location note,
 * which is accurate, stays.
 */
/**
 * A party size from a query string.
 *
 * The planner links here with the number of travellers it drafted for. Bounded
 * to what the estimator and the booking panel can honour, so a crafted
 * `?party=900` produces the default rather than a panel quoting for a coach
 * party the hotel does not have.
 */
function clampParty(value: string | undefined, fallback = 2): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 12) return fallback
  return n
}

export default async function StayDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ arrive?: string; depart?: string; party?: string }>
}) {
  const { slug } = await params
  const { arrive, depart, party } = await searchParams
  const { t, locale } = await getTranslator()

  // The real property first, for the reason in `../../experiences/[slug]`.
  const live = await liveStay(locale)
  const stay = live?.slug === slug ? live : getStay(slug)
  if (!stay) notFound()
  const destination = getDestination(stay.destination)
  /*
   * Only the live property can be sold from.
   *
   * The content set's stays have no hotel, no catalogue and no availability
   * behind them, so the panel on one of those offers no booking control at
   * all — it says the listing is illustrative and points at the one that is
   * not. The page used to end at "Open the guest portal demo" on every listing
   * alike, which was a tour of the product rather than a way to buy from it.
   */
  const bookable = live !== null && live.slug === slug
  const nearby = experiences.filter((e) => e.destination === stay.destination).slice(0, 3)

  // Dates are computed here, on the server, and handed to the client island as
  // props. Nothing below the fold reads a clock during render.
  /*
   * `toLocalDateKey`, not `toDateKey(new Date())`.
   *
   * `toDateKey` slices a UTC instant, and the property is UTC-6: after 18:00
   * in Puerto Escondido the server's calendar day has already rolled forward,
   * so an arrival of *today* carried over from the planner read as past and
   * was thrown away for a window a week out. Every trip window in the product
   * is a local date key, which is the whole point of `DateKey`.
   */
  const today = toLocalDateKey(new Date())
  /*
   * A week out, not a month.
   *
   * The export's panel was an estimator and a month ahead was a neutral
   * default for one. It is now also what the booking panel carries, and a
   * month ahead is past the horizon the catalogue publishes departures for —
   * so the default sent everybody to an empty trip page and the product's
   * first impression was "nothing runs on those days".
   */
  /*
   * Carried from the illustrative planner, when it sent somebody here.
   *
   * A visitor who drafted a plan for particular days should not have to type
   * them again to buy it. Validated as date keys and clamped to today rather
   * than trusted: a query string is not a brief, and an arrival in the past
   * produces a window with no departures in it.
   */
  const fallbackArrive = addDays(today, 7)
  const defaultArrive = isDateKey(arrive) && arrive >= today ? arrive : fallbackArrive
  const defaultDepart =
    isDateKey(depart) && depart > defaultArrive ? depart : addDays(defaultArrive, 4)
  const defaultParty = clampParty(party)

  return (
    <Shell className="pt-6 pb-20 md:pt-10">
      <p className="text-muted mb-4 text-sm">
        <Link href="/stays" className="hover:text-ink">
          {t('explore.nav.stay')}
        </Link>
        {destination ? (
          <>
            {' / '}
            <Link href={`/destinations/${destination.slug}`} className="hover:text-ink">
              {destination.name}
            </Link>
          </>
        ) : null}
      </p>

      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {/*
             * `provenance` matters here and was not being passed.
             *
             * The live property carries `verification: 'illustrative'` because
             * that union has one member; what distinguishes it from the
             * content set is `provenance.kind === 'live'`. Without it this
             * badge read "Illustrative listing" on the one property a visitor
             * can actually buy from — telling them the thing they are about
             * to pay for is a mock-up. It now reads "unverified", which is
             * both true and the claim ADR-036 allows.
             */}
            <ListingBadge
              status={stay.verification}
              provenance={stay.provenance}
              locale={locale}
            />
            <span className="text-muted text-xs">{stay.type}</span>
          </div>
          <h1 className="mt-3 text-4xl tracking-tight md:text-6xl">{stay.name}</h1>
          <p className="text-muted mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="text-muted tabular-nums">
              {stay.rating} · {stay.reviews} sample reviews
            </span>
            {destination ? (
              <span className="flex items-center gap-1">
                <MapPin className="size-4" aria-hidden />
                {destination.name}, {destination.country}
              </span>
            ) : null}
          </p>
        </div>
        <SaveButton
          kind="stays"
          slug={stay.slug}
          label={stay.name}
          locale={locale}
          variant="inline"
        />
      </div>

      <ImageGallery images={stay.images} alt={stay.name} />

      <div className="mt-12 grid gap-12 lg:grid-cols-[1fr_380px] lg:gap-16">
        <div>
          <section>
            <p className="text-2xl leading-snug md:text-3xl">{stay.summary}</p>
            {stay.description.map((paragraph) => (
              <p key={paragraph} className="text-muted mt-4 leading-relaxed">
                {paragraph}
              </p>
            ))}
            <ul className="mt-6 flex flex-wrap gap-x-8 gap-y-2">
              {stay.highlights.map((highlight) => (
                <li key={highlight} className="flex items-center gap-2 text-sm">
                  <Check className="text-sage size-4" aria-hidden />
                  {highlight}
                </li>
              ))}
            </ul>
            <p className="text-muted mt-6 flex items-center gap-2 text-sm">
              <Clock className="size-4" aria-hidden />
              {t('explore.stay.checkTimes', { checkIn: stay.checkIn, checkOut: stay.checkOut })}
            </p>
          </section>

          <section className="mt-14">
            <h2 className="mb-5 text-2xl md:text-3xl">{t('explore.stay.roomsHeading')}</h2>
            <dl className="divide-line border-line divide-y border-y">
              {stay.rooms.map((room) => (
                <div key={room.name} className="grid gap-1 py-5 md:grid-cols-[1fr_auto] md:gap-8">
                  <div>
                    <dt className="font-medium">{room.name}</dt>
                    <dd className="text-muted mt-0.5 text-sm">
                      {t('explore.stay.sleeps', { count: room.sleeps })} · {room.size} · {room.note}
                    </dd>
                  </div>
                </div>
              ))}
            </dl>
            <IllustrativeNote className="mt-4">{t('explore.stay.estimateNote')}</IllustrativeNote>
          </section>

          <section className="mt-14">
            <h2 className="mb-5 text-2xl md:text-3xl">{t('explore.stay.amenitiesHeading')}</h2>
            <ul className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              {stay.amenities.map((amenity) => (
                <li key={amenity} className="flex items-center gap-2 text-sm">
                  <span className="bg-gold size-1.5 rounded-full" aria-hidden />
                  {amenity}
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-14">
            <h2 className="mb-2 text-2xl md:text-3xl">{t('explore.stay.locationHeading')}</h2>
            <p className="text-muted text-sm leading-relaxed">{stay.location}</p>
            <p className="text-muted mt-3 text-xs">
              The neighbourhood, not an address. An exact location would be shared by the hotel.
            </p>
          </section>

          {nearby.length > 0 ? (
            <section className="mt-14">
              <h2 className="mb-6 text-2xl md:text-3xl">Nearby experiences</h2>
              <div className="grid gap-6 sm:grid-cols-3">
                {nearby.map((experience) => (
                  <ExperienceCard key={experience.slug} experience={experience} locale={locale} />
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="order-first self-start lg:sticky lg:top-28 lg:order-none">
          <StayEstimator
            locale={locale}
            rooms={stay.rooms}
            currency={CONTENT_CURRENCY}
            defaultArrive={defaultArrive}
            defaultDepart={defaultDepart}
            defaultParty={defaultParty}
            booking={
              bookable ? { propertySlug: stay.slug, ability: abilityField(t, null) } : null
            }
            liveStayHref={live && !bookable ? `/stays/${live.slug}` : null}
          />
        </aside>
      </div>
    </Shell>
  )
}

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Check, Clock, MapPin } from 'lucide-react'
import { ExperienceCard } from '@/components/explore/cards'
import { IllustrativeNote, ListingBadge, Shell } from '@/components/explore/editorial'
import { ImageGallery } from '@/components/explore/image-gallery'
import { SaveButton } from '@/components/explore/save-button'
import { StayEstimator } from '@/components/explore/stay-estimator'
import { addDays, toDateKey } from '@/lib/dates'
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
export default async function StayDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { t, locale } = await getTranslator()

  // The real property first, for the reason in `../../experiences/[slug]`.
  const live = await liveStay(locale)
  const stay = live?.slug === slug ? live : getStay(slug)
  if (!stay) notFound()
  const destination = getDestination(stay.destination)
  const nearby = experiences.filter((e) => e.destination === stay.destination).slice(0, 3)

  // Dates are computed here, on the server, and handed to the client island as
  // props. Nothing below the fold reads a clock during render.
  const today = toDateKey(new Date())
  const defaultArrive = addDays(today, 30)
  const defaultDepart = addDays(defaultArrive, 4)

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
            <ListingBadge status={stay.verification} locale={locale} />
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
            defaultParty={2}
            portalHref="/sign-in"
          />
        </aside>
      </div>
    </Shell>
  )
}

import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight, Clock, Coins, Languages, Plane, Sun } from 'lucide-react'
import type { ReactNode } from 'react'
import { ExperienceCard, PropertyCard } from '@/components/explore/cards'
import { CulturePanel } from '@/components/explore/culture-panel'
import { DaySketch } from '@/components/explore/day-sketch'
import { IllustrativeNote, Shell } from '@/components/explore/editorial'
import { SaveButton } from '@/components/explore/save-button'
import { getTranslator } from '@/lib/i18n/server'
import { getCulture } from '@/modules/discovery/content/culture'
import { destinations, getDestination } from '@/modules/discovery/content/destinations'
import { experiences } from '@/modules/discovery/content/experiences'
import { stays } from '@/modules/discovery/content/stays'

export async function generateStaticParams() {
  return destinations.map((destination) => ({ slug: destination.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const destination = getDestination(slug)
  return { title: destination?.name ?? 'Destination' }
}

const SECTIONS = [
  ['overview', 'Overview'],
  ['stays', 'Stays'],
  ['experiences', 'Experiences'],
  ['itinerary', 'Itinerary'],
  ['neighbourhoods', 'Neighbourhoods'],
  ['culture', 'Culture'],
  ['info', 'Travel info'],
] as const

/**
 * One destination, ported from the export's `DestinationDetailPage`.
 *
 * The section nav used `document.getElementById(...).scrollIntoView`, which
 * needed the whole page to be a client component to attach the handlers. Plain
 * anchor links do the same job natively, keep working without JavaScript, and
 * leave the page a Server Component with two small client islands — the day
 * sketch and the culture tabs.
 */
export default async function DestinationDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const destination = getDestination(slug)
  if (!destination) notFound()

  const { t, locale } = await getTranslator()
  const localStays = stays.filter((s) => s.destination === destination.slug)
  const localExperiences = experiences.filter((e) => e.destination === destination.slug)
  const culture = getCulture(destination.slug)

  return (
    <div>
      <section className="bg-ink relative h-[620px] overflow-hidden md:h-[760px]">
        <Image
          src={destination.image}
          alt={`${destination.name}, ${destination.country}`}
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div className="bg-ink/40 absolute inset-0" />
        <Shell className="text-ivory relative flex h-full flex-col justify-end pb-10 md:pb-16">
          <p className="text-ivory/80 text-sm">
            <Link href="/explore/destinations" className="hover:text-ivory">
              {t('explore.nav.home')}
            </Link>{' '}
            / {destination.country}
          </p>
          <h1 className="mt-3 text-5xl leading-[0.95] tracking-tight sm:text-6xl md:text-8xl">
            {destination.name}
          </h1>
          <p className="text-ivory/85 mt-4 max-w-2xl text-lg italic md:text-xl">
            {destination.tagline}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={`/explore/plan?destination=${destination.slug}`}
              className="bg-gold text-ink hover:bg-gold-hover inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm font-medium transition-colors duration-150"
            >
              Plan a trip here <ArrowRight className="size-4" aria-hidden />
            </Link>
            <SaveButton
              kind="destinations"
              slug={destination.slug}
              label={destination.name}
              locale={locale}
              variant="inline"
            />
            <Link
              href={`/explore/culture/${destination.slug}`}
              className="border-ivory/40 hover:border-ivory inline-flex h-11 items-center rounded-full border px-5 text-sm transition-colors duration-150"
            >
              {t('explore.guide.cultureHeading')}
            </Link>
          </div>
        </Shell>
      </section>

      <nav
        className="bg-ivory/95 border-line sticky top-16 z-40 border-b backdrop-blur md:top-20"
        aria-label="Sections"
      >
        <Shell className="no-scrollbar flex gap-6 overflow-x-auto">
          {SECTIONS.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="text-muted hover:text-ink py-4 text-sm whitespace-nowrap transition-colors duration-150"
            >
              {label}
            </a>
          ))}
        </Shell>
      </nav>

      <Shell>
        <section
          id="overview"
          className="grid scroll-mt-36 gap-12 pt-16 md:pt-24 lg:grid-cols-[1.5fr_1fr] lg:gap-20"
        >
          <div>
            <h2 className="text-3xl md:text-4xl">Overview</h2>
            {destination.overview.map((paragraph, i) => (
              <p
                key={paragraph}
                className={
                  i === 0 ? 'text-ink mt-5 text-lg leading-relaxed' : 'text-muted mt-5 leading-relaxed'
                }
              >
                {paragraph}
              </p>
            ))}
          </div>
          <dl className="border-line grid grid-cols-2 gap-x-6 gap-y-5 self-start border-t pt-6 lg:grid-cols-1">
            <Fact icon={<Sun className="size-4" aria-hidden />} label="Best time" value={destination.bestTime} />
            <Fact icon={<Plane className="size-4" aria-hidden />} label="Arrive via" value={destination.airport} />
            <Fact icon={<Clock className="size-4" aria-hidden />} label="Time zone" value={destination.timezone} />
            <Fact icon={<Coins className="size-4" aria-hidden />} label="Currency" value={destination.currency} />
            <Fact icon={<Languages className="size-4" aria-hidden />} label="Language" value={destination.language} />
          </dl>
        </section>

        <section id="stays" className="scroll-mt-36 pt-20 md:pt-28">
          <div className="mb-8 flex items-end justify-between gap-4">
            <h2 className="text-3xl md:text-4xl">{t('explore.home.stayHeading')}</h2>
            <Link
              href={`/explore/stays?destination=${destination.slug}`}
              className="border-gold border-b pb-1 text-sm whitespace-nowrap"
            >
              All stays in {destination.name}
            </Link>
          </div>
          {localStays.length > 0 ? (
            <>
              <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
                {localStays.map((property) => (
                  <PropertyCard key={property.slug} property={property} locale={locale} />
                ))}
              </div>
              <IllustrativeNote className="mt-6">
                {t('explore.stay.estimateNote')}
              </IllustrativeNote>
            </>
          ) : (
            <p className="text-muted text-sm">
              No stays listed for this destination yet —{' '}
              <Link href="/explore/stays" className="underline">
                browse all stays
              </Link>
              .
            </p>
          )}
        </section>

        {localExperiences.length > 0 ? (
          <section id="experiences" className="scroll-mt-36 pt-20 md:pt-28">
            <div className="mb-8 flex items-end justify-between gap-4">
              <h2 className="text-3xl md:text-4xl">Local experiences</h2>
              <Link
                href={`/explore/experiences?destination=${destination.slug}`}
                className="border-gold border-b pb-1 text-sm whitespace-nowrap"
              >
                See all
              </Link>
            </div>
            <div className="no-scrollbar -mx-5 flex snap-x gap-6 overflow-x-auto px-5 md:mx-0 md:grid md:grid-cols-3 md:px-0 lg:grid-cols-4">
              {localExperiences.map((experience) => (
                <div
                  key={experience.slug}
                  className="w-[75%] shrink-0 snap-start sm:w-[45%] md:w-auto"
                >
                  <ExperienceCard experience={experience} locale={locale} />
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section id="itinerary" className="scroll-mt-36 pt-20 md:pt-28">
          <div className="bg-paper rounded-3xl p-6 md:p-12">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-3xl md:text-4xl">
                  A {destination.itinerary.length}-day sketch
                </h2>
                <p className="text-muted mt-2 text-sm">
                  Tap through the days. Make it yours in the planner.
                </p>
              </div>
              <Link
                href={`/explore/plan?destination=${destination.slug}`}
                className="bg-ink text-ivory hover:bg-ink-soft inline-flex h-11 items-center gap-2 self-start rounded-full px-5 text-sm transition-colors duration-150"
              >
                Customise this itinerary <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
            <DaySketch days={destination.itinerary} />
          </div>
        </section>

        <section id="neighbourhoods" className="scroll-mt-36 pt-20 md:pt-28">
          <h2 className="mb-8 text-3xl md:text-4xl">Neighbourhoods</h2>
          <div className="grid gap-x-12 md:grid-cols-2">
            {destination.neighborhoods.map((neighbourhood) => (
              <div key={neighbourhood.name} className="border-line border-t py-6">
                <p className="text-2xl">{neighbourhood.name}</p>
                <p className="text-muted mt-2 leading-relaxed">{neighbourhood.vibe}</p>
                <p className="mt-3 text-sm">
                  <span className="text-sage font-medium">Best for</span> · {neighbourhood.bestFor}
                </p>
              </div>
            ))}
          </div>
        </section>

        {culture ? (
          <section id="culture" className="scroll-mt-36 pt-20 md:pt-28">
            <CulturePanel guide={culture} name={destination.name} locale={locale} />
          </section>
        ) : null}

        <section id="info" className="scroll-mt-36 py-20 md:py-28">
          <h2 className="mb-8 text-3xl md:text-4xl">Travel information</h2>
          <dl className="divide-line border-line divide-y border-y">
            {destination.travelInfo.map((info) => (
              <div
                key={info.label}
                className="grid gap-2 py-5 md:grid-cols-[240px_1fr] md:gap-8"
              >
                <dt className="text-sm font-medium">{info.label}</dt>
                <dd className="text-muted text-sm leading-relaxed">{info.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </Shell>
    </div>
  )
}

function Fact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted flex items-center gap-2 text-xs">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 text-sm leading-relaxed">{value}</dd>
    </div>
  )
}

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Band, IllustrativeNote, Shell } from '@/components/explore/editorial'
import { TripPlanner } from '@/components/explore/trip-planner'
import { addDays, toDateKey } from '@/lib/dates'
import { getTranslator } from '@/lib/i18n/server'
import { getDestination } from '@/modules/discovery/content/destinations'
import { getSampleItinerary, sampleItineraries } from '@/modules/discovery/content/itineraries'
import type { PlannerPreferences } from '@/modules/discovery/content/types'
import { liveStay } from '@/modules/discovery/live'
import { PUBLIC_DESTINATION } from '@/modules/discovery/service'

export const metadata = { title: 'Plan' }

/**
 * The illustrative trip planner.
 *
 * The export's `PlanPage` called `addDays(new Date(), 45)` in render to pick
 * its default dates, so the whole screen was impure and the defaults differed
 * between a server render and a hydration. The instant and the default brief
 * are computed here, on the server, and handed down as props — the rule
 * `CLAUDE.md` puts on client components, and the reason the planner module
 * takes `now` as a parameter.
 *
 * The band underneath is deliberately part of this page rather than a separate
 * route. A visitor who has just watched a plan appear out of nowhere is exactly
 * the person who needs to read that the planner which can actually book
 * something is a different, gated thing: a deterministic engine, a hard
 * conditions check before any scoring, and a model that may only rephrase the
 * reasons the engine produced.
 */
export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ sample?: string; destination?: string }>
}) {
  const { t, locale } = await getTranslator()
  const { sample, destination } = await searchParams

  const now = new Date()
  const start = addDays(toDateKey(now), 45)

  /*
   * The destination the visitor clicked.
   *
   * Five surfaces link here as `/plan?destination=<slug>` — a destination page
   * (twice), the local guide, the journal and an experience. This page read
   * only `?sample=`, so every one of them dropped the slug and opened the
   * planner on Puerto Escondido with a "Surf & Ocean" brief. Clicking Chamonix
   * and being asked about surf is the bug that made the whole surface read as
   * a mock-up.
   *
   * Resolved through `getDestination` rather than trusted: an unknown slug
   * falls back to the public destination instead of putting an arbitrary
   * string into the brief. `styles[0]` is the content set's own first answer
   * for what a place is for, so the shape of the trip follows the place rather
   * than being hardcoded to the one this demo started from.
   */
  const chosen = getDestination(destination) ?? getDestination(PUBLIC_DESTINATION)

  const defaultPrefs: PlannerPreferences = {
    destination: chosen?.slug ?? PUBLIC_DESTINATION,
    startDate: start,
    endDate: addDays(start, 5),
    travelers: 2,
    budget: 'Comfort',
    style: chosen?.styles[0] ?? 'Surf & Ocean',
    accommodation: 'Any',
    activities: ['Adventure', 'Food'],
    pace: 'Balanced',
  }

  const initialItinerary = getSampleItinerary(sample)

  /*
   * The one destination that can actually be bought, looked up here so the
   * planner — a client component — can offer a real exit instead of only a
   * `localStorage` write. `liveStay` returns null when no property is
   * published, and the planner then says nothing is bookable rather than
   * linking somewhere that cannot honour it.
   */
  const live = await liveStay(locale)
  const bookable = live
    ? { destination: live.destination, href: `/stays/${live.slug}`, propertyName: live.name }
    : null

  return (
    <>
      <Shell className="pt-10 pb-20 md:pt-16">
        <h1 className="text-5xl tracking-tight md:text-7xl">{t('explore.planner.heading')}</h1>
        <p className="text-muted mt-4 max-w-2xl text-sm leading-relaxed">
          {t('explore.planner.lede')}
        </p>

        <div className="mt-12 md:mt-16">
          <TripPlanner
            locale={locale}
            nowIso={now.toISOString()}
            defaultPrefs={defaultPrefs}
            samples={sampleItineraries}
            initialItinerary={initialItinerary}
            bookable={bookable}
          >
            <IllustrativeNote className="mt-12 max-w-2xl">
              {t('explore.planner.note')}
            </IllustrativeNote>
          </TripPlanner>
        </div>
      </Shell>

      <Band>
        <Shell className="py-20 md:py-28">
          <h2 className="max-w-2xl text-3xl leading-[1.1] tracking-tight md:text-[42px]">
            {t('explore.plan.heading')}
          </h2>
          <p className="text-muted mt-4 max-w-2xl text-[15px] leading-relaxed">
            {t('explore.plan.lede')}
          </p>

          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {[
              { heading: t('explore.plan.step1Heading'), body: t('explore.plan.step1Body') },
              { heading: t('explore.plan.step2Heading'), body: t('explore.plan.step2Body') },
              { heading: t('explore.plan.step3Heading'), body: t('explore.plan.step3Body') },
            ].map((step, index) => (
              <div key={step.heading} className="border-line border-t pt-6">
                <p className="text-gold-deep text-xs tracking-wide">
                  {String(index + 1).padStart(2, '0')}
                </p>
                <h3 className="mt-2 text-xl leading-snug">{step.heading}</h3>
                <p className="text-muted mt-3 text-sm leading-relaxed">{step.body}</p>
              </div>
            ))}
          </div>

          <Link
            href="/sign-in"
            className="border-gold text-ink hover:text-gold-deep mt-12 inline-flex items-center gap-2 border-b pb-1 text-sm transition-colors duration-150"
          >
            {t('explore.plan.cta')}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
          <p className="text-muted mt-3 text-xs">{t('explore.plan.ctaNote')}</p>
        </Shell>
      </Band>
    </>
  )
}

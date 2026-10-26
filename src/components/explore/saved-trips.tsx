'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ArrowRight, Trash2 } from 'lucide-react'
import { DemoFigure, Money } from '@/components/money'
import { cn } from '@/lib/cn'
import { createTranslator, type AppLocale } from '@/lib/i18n'
import { destinations, getDestination } from '@/modules/discovery/content/destinations'
import { experiences } from '@/modules/discovery/content/experiences'
import { stays } from '@/modules/discovery/content/stays'
import { CONTENT_CURRENCY } from '@/modules/discovery/content/types'
import { itineraryTotalMinor } from '@/modules/discovery/planner'
import { DestinationCard, ExperienceCard, PropertyCard } from './cards'
import { EditorialEmptyState, IllustrativeNote } from './editorial'
import { useSaved } from './saved-store'

type Tab = 'destinations' | 'stays' | 'experiences'

/**
 * Saved destinations, stays, experiences and itineraries.
 *
 * Two things the export had here are gone.
 *
 * It tracked "inquiries" and listed them as "Inquiry sent · awaiting host
 * reply". No inquiry was sent and no host was waiting — the modal wrote to
 * `localStorage`. A line telling a visitor that a business is about to reply to
 * them is a false statement about the world, not a rough edge, so both the
 * enquiry flow and this list are out.
 *
 * It also read `format(new Date(), 'yyyy-MM-dd')` during render to decide what
 * counted as upcoming. `today` arrives as a prop from the server instead.
 */
export function SavedTrips({
  locale,
  today,
}: {
  locale: AppLocale
  /** Server-computed, so this component never reads the clock. */
  today: string
}) {
  const t = createTranslator(locale)
  const saved = useSaved()
  const [tab, setTab] = useState<Tab>('destinations')

  const savedDestinations = destinations.filter((d) => saved.destinations.includes(d.slug))
  const savedStays = stays.filter((s) => saved.stays.includes(s.slug))
  const savedExperiences = experiences.filter((e) => saved.experiences.includes(e.slug))

  const counts: Record<Tab, number> = {
    destinations: savedDestinations.length,
    stays: savedStays.length,
    experiences: savedExperiences.length,
  }

  const upcoming = saved.itineraries
    .filter((itinerary) => (itinerary.days[0]?.date ?? '') >= today)
    .sort((a, b) => (a.days[0]?.date ?? '').localeCompare(b.days[0]?.date ?? ''))

  const grandTotalMinor = saved.itineraries.reduce(
    (sum, itinerary) => sum + itineraryTotalMinor(itinerary),
    0,
  )

  if (!saved.ready) {
    return <p className="text-muted mt-10 text-sm">{t('common.loading')}</p>
  }

  const nothingSaved =
    savedDestinations.length === 0 &&
    savedStays.length === 0 &&
    savedExperiences.length === 0 &&
    saved.itineraries.length === 0

  if (nothingSaved) {
    return (
      <div className="mt-12">
        <EditorialEmptyState
          title={t('explore.saved.empty')}
          text={t('explore.saved.emptyHint')}
          action={
            <Link
              href="/destinations"
              className="bg-ink text-ivory inline-flex h-11 items-center rounded-full px-5 text-sm"
            >
              {t('explore.nav.destinations')}
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <>
      {saved.itineraries.length > 0 ? (
        <section className="mt-12 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <h2 className="mb-5 text-2xl md:text-3xl">Upcoming</h2>
            {upcoming.length > 0 ? (
              <ul className="divide-line border-line divide-y border-y">
                {upcoming.map((itinerary) => {
                  const destination = getDestination(itinerary.preferences.destination)
                  const date = itinerary.days[0]?.date ?? ''
                  return (
                    <li
                      key={itinerary.id}
                      className="grid grid-cols-[64px_1fr_auto] items-center gap-4 py-5"
                    >
                      <div className="text-center">
                        <p className="text-3xl leading-none">{date.slice(8, 10)}</p>
                        <p className="text-muted mt-1 text-xs">{date.slice(0, 7)}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-muted text-xs">Itinerary · {destination?.name}</p>
                        <p className="truncate text-xl leading-snug">{itinerary.title}</p>
                        <p className="text-muted mt-0.5 text-xs">
                          Estimated{' '}
                          <Money
                            amountMinor={itineraryTotalMinor(itinerary)}
                            currency={CONTENT_CURRENCY}
                            locale={locale}
                            intent="potential"
                          />
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => saved.removeItinerary(itinerary.id)}
                        aria-label={`Remove ${itinerary.title}`}
                        className="text-muted hover:text-danger flex size-10 items-center justify-center transition-colors duration-150"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="text-muted text-sm">
                Nothing upcoming — the saved itineraries below all start in the past.
              </p>
            )}
          </div>

          <div className="bg-paper self-start rounded-3xl p-6">
            <p className="text-muted text-xs">All saved itineraries</p>
            <p className="mt-1 text-3xl">
              <DemoFigure>
                <Money
                  amountMinor={grandTotalMinor}
                  currency={CONTENT_CURRENCY}
                  locale={locale}
                  intent="potential"
                />
              </DemoFigure>
            </p>
            <ul className="mt-5 space-y-3">
              {saved.itineraries.map((itinerary) => (
                <li key={itinerary.id} className="text-sm">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate">{itinerary.title}</span>
                    <span className="text-muted shrink-0">
                      <Money
                        amountMinor={itineraryTotalMinor(itinerary)}
                        currency={CONTENT_CURRENCY}
                        locale={locale}
                        intent="potential"
                      />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <IllustrativeNote className="mt-5">{t('explore.saved.lede')}</IllustrativeNote>
          </div>
        </section>
      ) : null}

      <section className="mt-16">
        <div
          className="no-scrollbar border-line mb-8 flex gap-1 overflow-x-auto border-b"
          role="tablist"
        >
          {(['destinations', 'stays', 'experiences'] as Tab[]).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={tab === item}
              onClick={() => setTab(item)}
              className={cn(
                '-mb-px border-b-2 px-4 py-3 text-sm whitespace-nowrap capitalize transition-colors duration-150',
                tab === item
                  ? 'border-gold text-ink'
                  : 'text-muted hover:text-ink border-transparent',
              )}
            >
              {item} <span className="tabular-nums">({counts[item]})</span>
            </button>
          ))}
        </div>

        {tab === 'destinations' ? (
          savedDestinations.length > 0 ? (
            <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
              {savedDestinations.map((destination) => (
                <DestinationCard
                  key={destination.slug}
                  destination={destination}
                  locale={locale}
                />
              ))}
            </div>
          ) : (
            <EditorialEmptyState title={t('explore.saved.empty')} />
          )
        ) : null}

        {tab === 'stays' ? (
          savedStays.length > 0 ? (
            <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
              {savedStays.map((property) => (
                <PropertyCard key={property.slug} property={property} locale={locale} />
              ))}
            </div>
          ) : (
            <EditorialEmptyState title={t('explore.saved.empty')} />
          )
        ) : null}

        {tab === 'experiences' ? (
          savedExperiences.length > 0 ? (
            <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
              {savedExperiences.map((experience) => (
                <ExperienceCard key={experience.slug} experience={experience} locale={locale} />
              ))}
            </div>
          ) : (
            <EditorialEmptyState title={t('explore.saved.empty')} />
          )
        ) : null}
      </section>

      <Link
        href="/plan"
        className="border-line hover:border-ink mt-16 flex items-center justify-between gap-3 rounded-2xl border p-5 transition-colors duration-150"
      >
        <span>
          <span className="text-muted block text-xs">{t('explore.nav.plan')}</span>
          <span className="block text-lg">{t('explore.home.planCta')}</span>
        </span>
        <ArrowRight className="size-5" aria-hidden />
      </Link>
    </>
  )
}

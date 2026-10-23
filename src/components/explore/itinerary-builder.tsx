'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ArrowLeft, ArrowRight, BookmarkCheck, BookmarkPlus } from 'lucide-react'
import { DemoFigure, Money } from '@/components/money'
import { cn } from '@/lib/cn'
import { createTranslator, type AppLocale } from '@/lib/i18n'
import { experiences } from '@/modules/discovery/content/experiences'
import { stays } from '@/modules/discovery/content/stays'
import {
  CONTENT_CURRENCY,
  type Itinerary,
  type ItineraryActivity,
  type Pace,
} from '@/modules/discovery/content/types'
import {
  alternativesFor,
  buildItinerary,
  dayCost,
  itineraryTotalMinor,
} from '@/modules/discovery/planner'
import { ExperienceCard } from './cards'
import { IllustrativeNote, SectionHeading } from './editorial'
import { ItineraryDay } from './itinerary-day'
import { useSaved } from './saved-store'

/**
 * A drafted itinerary, with the day list editable and the cost shown alongside.
 *
 * Three things changed from the export.
 *
 * It re-drafted with `source: 'mock-generator'`, a value the narrowed
 * `Itinerary['source']` union no longer has — a re-draft is still the rules
 * engine, and it says so.
 *
 * It computed per-person cost as `total / travelers` on floats. That is a
 * division on money, so it is integer minor units here and floors rather than
 * rounds: a per-person figure that reads high is worse than one that reads low.
 *
 * Its save button wrote to `localStorage` and said "Trip saved to your
 * account". There is no account on this surface. The button says where the
 * itinerary is actually kept, which is this browser.
 */

const PACES: Pace[] = ['Slow', 'Balanced', 'Full']

export function ItineraryBuilder({
  locale,
  itinerary,
  onChange,
  onBack,
  now,
  generatorLabel,
}: {
  locale: AppLocale
  itinerary: Itinerary
  onChange: (itinerary: Itinerary) => void
  onBack: () => void
  /** The instant this page was rendered, from the server. Never `new Date()`. */
  now: Date
  generatorLabel: string
}) {
  const t = createTranslator(locale)
  const saved = useSaved()
  const [dirty, setDirty] = useState(false)

  const update = (next: Itinerary) => {
    setDirty(true)
    onChange(next)
  }

  const totalMinor = itineraryTotalMinor(itinerary)
  const travelers = Math.max(1, itinerary.preferences.travelers)
  const perPersonMinor = Math.floor(totalMinor / travelers)

  const dayTotals = itinerary.days.map((day) => dayCost(day, travelers).totalMinor)
  const maxDayMinor = Math.max(1, ...dayTotals)

  const stay = stays.find((s) => s.slug === itinerary.stay)
  const recommended = experiences
    .filter((experience) => itinerary.recommendations.includes(experience.slug))
    .slice(0, 3)

  const isKept = saved.itineraries.some((x) => x.id === itinerary.id)

  const getAlternatives = (time: ItineraryActivity['time']): ItineraryActivity[] =>
    alternativesFor(itinerary, time)

  const redraft = (pace: Pace) => {
    const next = { ...itinerary.preferences, pace }
    update({
      ...buildItinerary(next, now, 'rules-engine', itinerary.id),
      title: itinerary.title,
    })
  }

  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_340px] lg:gap-16">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="text-muted hover:text-ink inline-flex items-center gap-2 text-sm transition-colors duration-150"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t('explore.planner.back')}
        </button>

        <p className="border-line text-muted mt-6 inline-flex rounded-full border px-3 py-1 text-[11px]">
          {t('explore.planner.generatorNote', { label: generatorLabel })}
        </p>

        <label className="mt-5 block">
          <span className="sr-only">{t('explore.planner.titleLabel')}</span>
          <input
            type="text"
            value={itinerary.title}
            onChange={(event) => update({ ...itinerary, title: event.target.value })}
            className="focus:border-line w-full border-b border-transparent bg-transparent text-4xl leading-tight tracking-tight outline-none md:text-5xl"
          />
        </label>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <span className="text-muted text-xs">{t('explore.planner.paceHeading')}</span>
          <div className="border-line inline-flex rounded-full border p-1">
            {PACES.map((pace) => (
              <button
                key={pace}
                type="button"
                onClick={() => redraft(pace)}
                aria-pressed={pace === itinerary.preferences.pace}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs transition-colors duration-150',
                  pace === itinerary.preferences.pace
                    ? 'bg-ink text-ivory'
                    : 'text-muted hover:text-ink',
                )}
              >
                {pace}
              </button>
            ))}
          </div>
          <span className="text-muted text-xs">{t('explore.planner.redraft')}</span>
        </div>

        <div className="mt-10 space-y-3">
          {itinerary.days.map((day) => (
            <ItineraryDay
              key={day.day}
              locale={locale}
              day={day}
              travelers={travelers}
              defaultOpen={day.day <= 2}
              getAlternatives={getAlternatives}
              onChange={(nextDay) =>
                update({
                  ...itinerary,
                  days: itinerary.days.map((d) => (d.day === nextDay.day ? nextDay : d)),
                })
              }
            />
          ))}
        </div>

        {recommended.length > 0 ? (
          <section className="mt-16">
            <SectionHeading title={t('explore.planner.recommendedHeading')} />
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {recommended.map((experience) => (
                <ExperienceCard key={experience.slug} experience={experience} locale={locale} />
              ))}
            </div>
          </section>
        ) : null}

        <Link
          href={`/explore/culture/${itinerary.preferences.destination}`}
          className="border-gold text-ink hover:text-gold-deep mt-12 inline-flex items-center gap-2 border-b pb-1 text-sm transition-colors duration-150"
        >
          {t('explore.planner.cultureCta')}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>

      <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
        <div className="border-line rounded-3xl border p-6">
          <p className="text-muted text-xs tracking-wide">{t('explore.planner.costHeading')}</p>
          <p className="mt-2 text-3xl">
            <DemoFigure>
              <Money
                amountMinor={totalMinor}
                currency={CONTENT_CURRENCY}
                locale={locale}
                intent="potential"
              />
            </DemoFigure>
          </p>
          <p className="text-muted mt-1 text-xs">
            {t('explore.planner.perPerson')}:{' '}
            <Money
              amountMinor={perPersonMinor}
              currency={CONTENT_CURRENCY}
              locale={locale}
              intent="potential"
            />
          </p>

          <p className="text-muted mt-6 text-xs">{t('explore.planner.byDay')}</p>
          <ul className="mt-3 space-y-2">
            {itinerary.days.map((day, index) => (
              <li key={day.day} className="flex items-center gap-3">
                <span className="text-muted w-8 shrink-0 text-xs tabular-nums">
                  {t('explore.planner.dayLabel', { day: day.day })}
                </span>
                <span className="bg-paper h-2 flex-1 overflow-hidden rounded-full">
                  <span
                    className="bg-gold block h-full rounded-full"
                    style={{ width: `${Math.round(((dayTotals[index] ?? 0) / maxDayMinor) * 100)}%` }}
                  />
                </span>
                <span className="shrink-0 text-xs">
                  <Money
                    amountMinor={dayTotals[index] ?? 0}
                    currency={CONTENT_CURRENCY}
                    locale={locale}
                    intent="potential"
                  />
                </span>
              </li>
            ))}
          </ul>

          <IllustrativeNote className="mt-5">{t('explore.planner.note')}</IllustrativeNote>
        </div>

        <button
          type="button"
          onClick={() => {
            saved.saveItinerary(itinerary)
            setDirty(false)
          }}
          className={cn(
            'flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm transition-colors duration-150',
            isKept && !dirty
              ? 'border-line text-muted border'
              : 'bg-ink text-ivory hover:bg-ink-soft',
          )}
        >
          {isKept && !dirty ? (
            <>
              <BookmarkCheck className="size-4" aria-hidden />
              {t('explore.planner.savedState')}
            </>
          ) : (
            <>
              <BookmarkPlus className="size-4" aria-hidden />
              {isKept ? t('explore.planner.unsaved') : t('explore.planner.save')}
            </>
          )}
        </button>

        {stay ? (
          <div className="border-line rounded-3xl border p-6">
            <p className="text-muted text-xs tracking-wide">
              {t('explore.planner.stayPanelHeading')}
            </p>
            <Link
              href={`/explore/stays/${stay.slug}`}
              className="hover:text-gold-deep mt-2 block text-xl leading-snug transition-colors duration-150"
            >
              {stay.name}
            </Link>
            <p className="text-muted mt-1 text-xs">
              {stay.type} · {stay.location}
            </p>
            <p className="mt-3 text-sm">
              <Money
                amountMinor={stay.pricePerNightMinor}
                currency={CONTENT_CURRENCY}
                locale={locale}
                intent="potential"
              />{' '}
              <span className="text-muted text-xs">a night, illustrative</span>
            </p>
          </div>
        ) : null}

        <div className="border-line rounded-3xl border p-6">
          <p className="text-muted text-xs tracking-wide">
            {t('explore.planner.logisticsHeading')}
          </p>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed">
            {itinerary.logistics.map((line) => (
              <li key={line} className="text-muted">
                {line}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  )
}

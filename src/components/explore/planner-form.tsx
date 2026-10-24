'use client'

import Image from 'next/image'
import { ArrowRight, Check, Minus, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { Money } from '@/components/money'
import { cn } from '@/lib/cn'
import { createTranslator, type AppLocale } from '@/lib/i18n'
import { destinations, getDestination } from '@/modules/discovery/content/destinations'
import {
  CONTENT_CURRENCY,
  EXPERIENCE_CATEGORIES,
  PROPERTY_TYPES,
  TRAVEL_STYLES,
  type Budget,
  type ExperienceCategory,
  type Itinerary,
  type Pace,
  type PlannerPreferences,
  type PropertyType,
} from '@/modules/discovery/content/types'
import { tripLength } from '@/modules/discovery/planner'
import { PLANNER_ISSUE_KEYS, type PlannerIssue } from '@/modules/discovery/schemas'

/**
 * The brief a visitor writes before the planner drafts anything.
 *
 * Two changes from the export. It computed its own default dates with
 * `addDays(new Date(), 45)` while rendering, which is the impure-read rule
 * `CLAUDE.md` puts on client components; the defaults now arrive as props from
 * the server. And its "Generate My Journey" button described a model doing the
 * work — the label here says what actually happens, and the generator names
 * itself on the result.
 *
 * The form holds no money logic. The one figure it shows is the destination's
 * published daily-from rate, rendered through `<Money>` from minor units.
 */

const BUDGETS: Budget[] = ['Considered', 'Comfort', 'Luxury']
const PACES: Pace[] = ['Slow', 'Balanced', 'Full']

function Step({
  n,
  title,
  children,
}: {
  n: number
  title: string
  children: ReactNode
}) {
  return (
    <section className="border-line border-t py-8 first:border-t-0 first:pt-0">
      <p className="text-gold-deep text-xs tracking-wide">
        {String(n).padStart(2, '0')}
      </p>
      <h2 className="mt-1 text-2xl leading-snug tracking-tight">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm transition-colors duration-150',
        active ? 'bg-ink text-ivory border-ink' : 'border-line hover:border-ink',
      )}
    >
      {active ? <Check className="size-3.5" aria-hidden /> : null}
      {children}
    </button>
  )
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly T[]
  value: T
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div className="border-line inline-flex rounded-full border p-1" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={option === value}
          className={cn(
            'rounded-full px-4 py-2 text-sm transition-colors duration-150',
            option === value ? 'bg-ink text-ivory' : 'hover:text-ink text-muted',
          )}
        >
          {option}
        </button>
      ))}
    </div>
  )
}

export function PlannerForm({
  locale,
  prefs,
  onChange,
  onGenerate,
  issues = [],
  samples,
  onOpenSample,
  generatorLabel,
}: {
  locale: AppLocale
  prefs: PlannerPreferences
  onChange: (prefs: PlannerPreferences) => void
  onGenerate: () => void
  /** Reasons the brief cannot be drafted. Empty when it can. */
  issues?: PlannerIssue[]
  samples: Itinerary[]
  onOpenSample: (itinerary: Itinerary) => void
  generatorLabel: string
}) {
  const t = createTranslator(locale)
  const destination = getDestination(prefs.destination)
  const nights = tripLength(prefs)

  const set = <K extends keyof PlannerPreferences>(key: K, value: PlannerPreferences[K]) =>
    onChange({ ...prefs, [key]: value })

  const toggleActivity = (category: ExperienceCategory) =>
    set(
      'activities',
      prefs.activities.includes(category)
        ? prefs.activities.filter((c) => c !== category)
        : [...prefs.activities, category],
    )

  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_320px] lg:gap-16">
      <div>
        <Step n={1} title={t('explore.planner.whereHeading')}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {destinations.map((option) => (
              <button
                key={option.slug}
                type="button"
                onClick={() => set('destination', option.slug)}
                aria-pressed={option.slug === prefs.destination}
                className={cn(
                  'group relative block overflow-hidden rounded-xl text-left',
                  option.slug === prefs.destination
                    ? 'ring-ink ring-2 ring-offset-2'
                    : 'ring-0',
                )}
              >
                <span className="bg-sand relative block aspect-[4/5]">
                  <Image
                    src={option.image}
                    alt={`${option.name}, ${option.country}`}
                    fill
                    sizes="(max-width: 640px) 45vw, 200px"
                    className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                  <span className="from-ink/80 absolute inset-0 bg-gradient-to-t to-transparent" />
                </span>
                <span className="text-ivory absolute bottom-3 left-3 right-3">
                  <span className="block text-sm leading-tight">{option.name}</span>
                  <span className="block text-[11px] opacity-80">{option.country}</span>
                </span>
              </button>
            ))}
          </div>
        </Step>

        <Step n={2} title={t('explore.planner.whenHeading')}>
          <div className="flex flex-wrap gap-4">
            <label className="text-muted text-xs">
              <span className="block">Arrive</span>
              <input
                type="date"
                value={prefs.startDate}
                onChange={(event) => set('startDate', event.target.value)}
                className="border-line text-ink focus:border-ink mt-1 rounded-xl border px-4 py-3 text-sm outline-none"
              />
            </label>
            <label className="text-muted text-xs">
              <span className="block">Leave</span>
              <input
                type="date"
                value={prefs.endDate}
                min={prefs.startDate}
                onChange={(event) => set('endDate', event.target.value)}
                className="border-line text-ink focus:border-ink mt-1 rounded-xl border px-4 py-3 text-sm outline-none"
              />
            </label>
          </div>
          <p className="text-muted mt-3 text-xs">{t('explore.planner.nights', { nights })}</p>
        </Step>

        <Step n={3} title={t('explore.planner.whoHeading')}>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => set('travelers', Math.max(1, prefs.travelers - 1))}
              disabled={prefs.travelers <= 1}
              aria-label="Fewer travellers"
              className="border-line hover:border-ink flex size-10 items-center justify-center rounded-full border transition-colors duration-150 disabled:opacity-40"
            >
              <Minus className="size-4" aria-hidden />
            </button>
            <span className="w-8 text-center text-2xl tabular-nums">{prefs.travelers}</span>
            <button
              type="button"
              onClick={() => set('travelers', Math.min(12, prefs.travelers + 1))}
              disabled={prefs.travelers >= 12}
              aria-label="More travellers"
              className="border-line hover:border-ink flex size-10 items-center justify-center rounded-full border transition-colors duration-150 disabled:opacity-40"
            >
              <Plus className="size-4" aria-hidden />
            </button>
          </div>
        </Step>

        <Step n={4} title={t('explore.planner.budgetHeading')}>
          <Segmented
            options={BUDGETS}
            value={prefs.budget}
            onChange={(value) => set('budget', value)}
            label={t('explore.planner.budgetHeading')}
          />
        </Step>

        <Step n={5} title={t('explore.planner.styleHeading')}>
          <div className="flex flex-wrap gap-2">
            {TRAVEL_STYLES.map((style) => (
              <Chip key={style} active={prefs.style === style} onClick={() => set('style', style)}>
                {style}
              </Chip>
            ))}
          </div>
        </Step>

        <Step n={6} title={t('explore.planner.stayHeading')}>
          <div className="flex flex-wrap gap-2">
            <Chip
              active={prefs.accommodation === 'Any'}
              onClick={() => set('accommodation', 'Any')}
            >
              {t('explore.planner.anyStay')}
            </Chip>
            {PROPERTY_TYPES.map((type: PropertyType) => (
              <Chip
                key={type}
                active={prefs.accommodation === type}
                onClick={() => set('accommodation', type)}
              >
                {type}
              </Chip>
            ))}
          </div>
        </Step>

        <Step n={7} title={t('explore.planner.activitiesHeading')}>
          <div className="flex flex-wrap gap-2">
            {EXPERIENCE_CATEGORIES.map((category) => (
              <Chip
                key={category}
                active={prefs.activities.includes(category)}
                onClick={() => toggleActivity(category)}
              >
                {category}
              </Chip>
            ))}
          </div>
        </Step>

        <Step n={8} title={t('explore.planner.paceHeading')}>
          <Segmented
            options={PACES}
            value={prefs.pace}
            onChange={(value) => set('pace', value)}
            label={t('explore.planner.paceHeading')}
          />
        </Step>

        {samples.length > 0 ? (
          <section className="border-line border-t py-8">
            <h2 className="text-muted text-sm">{t('explore.planner.sampleHeading')}</h2>
            <ul className="mt-4 space-y-2">
              {samples.map((sample) => (
                <li key={sample.id}>
                  <button
                    type="button"
                    onClick={() => onOpenSample(sample)}
                    className="border-line hover:border-ink flex w-full items-center justify-between gap-4 rounded-xl border px-5 py-4 text-left transition-colors duration-150"
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{sample.title}</span>
                      <span className="text-muted block text-xs">
                        {getDestination(sample.preferences.destination)?.name} ·{' '}
                        {sample.days.length} days · {sample.preferences.pace}
                      </span>
                    </span>
                    <ArrowRight className="text-muted size-4 shrink-0" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="bg-ink text-ivory rounded-3xl p-7">
          <p className="text-ivory/60 text-xs tracking-wide">
            {t('explore.planner.briefHeading')}
          </p>

          <dl className="divide-ivory/15 mt-5 divide-y text-sm">
            {[
              [t('explore.planner.whereHeading'), destination?.name ?? prefs.destination],
              [t('explore.planner.whenHeading'), `${prefs.startDate} → ${prefs.endDate}`],
              [t('explore.planner.whoHeading'), String(prefs.travelers)],
              [t('explore.planner.budgetHeading'), prefs.budget],
              [t('explore.planner.styleHeading'), prefs.style],
              [
                t('explore.planner.stayHeading'),
                prefs.accommodation === 'Any' ? t('explore.planner.anyStay') : prefs.accommodation,
              ],
              [
                t('explore.planner.activitiesHeading'),
                prefs.activities.length > 0 ? prefs.activities.join(', ') : '—',
              ],
              [t('explore.planner.paceHeading'), prefs.pace],
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-ivory/60 shrink-0 text-xs">{label}</dt>
                <dd className="min-w-0 truncate text-right">{value}</dd>
              </div>
            ))}
          </dl>

          {destination ? (
            <p className="text-ivory/60 mt-5 text-xs">
              From{' '}
              <Money
                amountMinor={destination.dailyFromMinor}
                currency={CONTENT_CURRENCY}
                locale={locale}
                intent="potential"
                className="text-ivory"
              />{' '}
              a day, illustrative
            </p>
          ) : null}

          {issues.length > 0 ? (
            <div
              role="status"
              className="border-ivory/25 mt-6 rounded-2xl border px-4 py-3 text-left"
            >
              <p className="text-ivory/80 text-xs tracking-wide">
                {t('explore.planner.issuesHeading')}
              </p>
              <ul className="text-ivory/70 mt-2 space-y-1 text-[11px] leading-relaxed">
                {issues.map((issue) => (
                  <li key={issue}>{t(PLANNER_ISSUE_KEYS[issue])}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <button
            type="button"
            onClick={onGenerate}
            disabled={issues.length > 0}
            className="bg-gold text-ink hover:bg-gold-hover mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('explore.planner.generate')}
            <ArrowRight className="size-4" aria-hidden />
          </button>

          <p className="text-ivory/50 mt-4 text-[11px] leading-relaxed">{generatorLabel}</p>
        </div>
      </aside>
    </div>
  )
}

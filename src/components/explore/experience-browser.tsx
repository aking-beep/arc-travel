'use client'

import { useMemo, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Money } from '@/components/money'
import { createTranslator, type AppLocale } from '@/lib/i18n'
import {
  EXPERIENCE_CATEGORIES,
  CONTENT_CURRENCY,
  type Difficulty,
  type Experience,
} from '@/modules/discovery/content/types'
import { ExperienceCard } from './cards'
import { EditorialEmptyState } from './editorial'
import { FilterPanel, RangeField, type FilterGroup } from './filter-panel'

const DIFFICULTIES: Difficulty[] = ['Easy', 'Moderate', 'Challenging', 'Expert']

/**
 * Browse the experience set.
 *
 * Filtering happens in the browser over a list the server passed in, rather
 * than by round-tripping each checkbox through the URL. That is the right
 * trade for this page specifically: the content set is fifteen records of
 * static editorial copy, so there is nothing to re-fetch and the instant
 * response is what the prototype was designed around. The Prisma-backed
 * catalogue is a different matter — `modules/discovery/service` filters in the
 * query, because that list is a real one and will not stay small.
 *
 * The price ceiling is in minor units like every other figure here, so the
 * slider steps in whole currency units and never produces a fractional bound.
 */
export function ExperienceBrowser({
  experiences,
  locale,
  initialDestination,
}: {
  experiences: Experience[]
  locale: AppLocale
  initialDestination?: string
}) {
  const t = createTranslator(locale)

  const priceCeilingMinor = useMemo(
    () => Math.max(...experiences.map((e) => e.priceMinor), 0),
    [experiences],
  )

  const [categories, setCategories] = useState<string[]>([])
  const [difficulties, setDifficulties] = useState<string[]>([])
  const [maxPriceMinor, setMaxPriceMinor] = useState(priceCeilingMinor)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const toggle = (list: string[], set: (next: string[]) => void) => (value: string) =>
    set(list.includes(value) ? list.filter((x) => x !== value) : [...list, value])

  const filtered = useMemo(
    () =>
      experiences.filter(
        (experience) =>
          (!initialDestination || experience.destination === initialDestination) &&
          (categories.length === 0 || categories.includes(experience.category)) &&
          (difficulties.length === 0 || difficulties.includes(experience.difficulty)) &&
          experience.priceMinor <= maxPriceMinor,
      ),
    [experiences, initialDestination, categories, difficulties, maxPriceMinor],
  )

  const activeCount =
    categories.length + difficulties.length + (maxPriceMinor < priceCeilingMinor ? 1 : 0)

  const clear = () => {
    setCategories([])
    setDifficulties([])
    setMaxPriceMinor(priceCeilingMinor)
  }

  const groups: FilterGroup[] = [
    {
      id: 'category',
      label: t('explore.experiences.category'),
      options: [...EXPERIENCE_CATEGORIES],
      selected: categories,
      onToggle: toggle(categories, setCategories),
    },
    {
      id: 'difficulty',
      label: t('explore.experience.ability'),
      options: DIFFICULTIES,
      selected: difficulties,
      onToggle: toggle(difficulties, setDifficulties),
    },
  ]

  return (
    <div className="flex gap-10 lg:gap-16">
      <FilterPanel
        groups={groups}
        onClear={clear}
        activeCount={activeCount}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        resultCount={filtered.length}
        labels={{
          heading: t('explore.experiences.filterHeading'),
          clear: t('explore.experiences.clear'),
          close: t('common.close'),
          show: `${t('explore.experiences.apply')} ({count})`,
        }}
      >
        <RangeField
          label={t('explore.experiences.maxDuration')}
          value={maxPriceMinor}
          min={0}
          max={priceCeilingMinor}
          stepSize={500}
          onChange={setMaxPriceMinor}
          format={(value) => (
            <Money
              amountMinor={value}
              currency={CONTENT_CURRENCY}
              locale={locale}
              intent="potential"
            />
          )}
        />
      </FilterPanel>

      <div className="min-w-0 flex-1">
        <div className="mb-6 flex items-center justify-between gap-4">
          <p className="text-muted text-sm tabular-nums">
            {t('explore.experiences.resultCount', {
              count: filtered.length,
              total: experiences.length,
            })}
          </p>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="border-line hover:border-ink inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm transition-colors duration-150 lg:hidden"
          >
            <SlidersHorizontal className="size-4" aria-hidden />
            {t('explore.experiences.filterHeading')}
            {activeCount > 0 ? <span className="tabular-nums">({activeCount})</span> : null}
          </button>
        </div>

        {filtered.length === 0 ? (
          <EditorialEmptyState
            title={t('explore.experiences.empty')}
            text={t('explore.experiences.emptyHint')}
            action={
              <button
                type="button"
                onClick={clear}
                className="text-gold-deep text-sm underline underline-offset-4"
              >
                {t('explore.experiences.clear')}
              </button>
            }
          />
        ) : (
          <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((experience) => (
              <ExperienceCard key={experience.slug} experience={experience} locale={locale} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

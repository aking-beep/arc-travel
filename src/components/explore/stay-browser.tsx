'use client'

import { useMemo, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Money } from '@/components/money'
import { createTranslator, type AppLocale } from '@/lib/i18n'
import { destinations } from '@/modules/discovery/content/destinations'
import {
  CONTENT_CURRENCY,
  PROPERTY_TYPES,
  type Property,
} from '@/modules/discovery/content/types'
import { PropertyCard } from './cards'
import { EditorialEmptyState, IllustrativeNote } from './editorial'
import { FilterPanel, RangeField, type FilterGroup } from './filter-panel'

type Sort = 'recommended' | 'price-asc' | 'price-desc'

/**
 * Browse the stay set.
 *
 * The export sorted by rating as a fourth option. That is gone: the ratings in
 * this content set were invented along with the hotels, and offering to rank by
 * one makes a fabricated number look like it means something. Sorting by a
 * published rate is honest — it ranks by a figure the listing states.
 */
export function StayBrowser({
  stays,
  locale,
  initialDestination,
}: {
  stays: Property[]
  locale: AppLocale
  initialDestination?: string
}) {
  const t = createTranslator(locale)

  const priceCeilingMinor = useMemo(
    () => Math.max(...stays.map((s) => s.pricePerNightMinor), 0),
    [stays],
  )

  const allAmenities = useMemo(
    () => [...new Set(stays.flatMap((s) => s.amenities))].sort(),
    [stays],
  )

  const [types, setTypes] = useState<string[]>([])
  const [amenities, setAmenities] = useState<string[]>([])
  const [maxPriceMinor, setMaxPriceMinor] = useState(priceCeilingMinor)
  const [sort, setSort] = useState<Sort>('recommended')
  const [drawerOpen, setDrawerOpen] = useState(false)

  const toggle = (list: string[], set: (next: string[]) => void) => (value: string) =>
    set(list.includes(value) ? list.filter((x) => x !== value) : [...list, value])

  const filtered = useMemo(() => {
    const matched = stays.filter(
      (stay) =>
        (!initialDestination || stay.destination === initialDestination) &&
        (types.length === 0 || types.includes(stay.type)) &&
        amenities.every((amenity) => stay.amenities.includes(amenity)) &&
        stay.pricePerNightMinor <= maxPriceMinor,
    )

    if (sort === 'price-asc') {
      return [...matched].sort((a, b) => a.pricePerNightMinor - b.pricePerNightMinor)
    }
    if (sort === 'price-desc') {
      return [...matched].sort((a, b) => b.pricePerNightMinor - a.pricePerNightMinor)
    }
    return matched
  }, [stays, initialDestination, types, amenities, maxPriceMinor, sort])

  const activeCount =
    types.length + amenities.length + (maxPriceMinor < priceCeilingMinor ? 1 : 0)

  const clear = () => {
    setTypes([])
    setAmenities([])
    setMaxPriceMinor(priceCeilingMinor)
  }

  const byDestination = destinations
    .map((destination) => ({
      destination,
      items: filtered.filter((s) => s.destination === destination.slug),
    }))
    .filter((group) => group.items.length > 0)

  const groups: FilterGroup[] = [
    {
      id: 'type',
      label: 'Property type',
      options: [...PROPERTY_TYPES],
      selected: types,
      onToggle: toggle(types, setTypes),
    },
    {
      id: 'amenities',
      label: 'Amenities',
      options: allAmenities,
      selected: amenities,
      onToggle: toggle(amenities, setAmenities),
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
          stepSize={1_000}
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
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <p className="text-muted text-sm tabular-nums">
            {t('explore.experiences.resultCount', {
              count: filtered.length,
              total: stays.length,
            })}
          </p>
          <div className="flex items-center gap-3">
            <label className="text-muted flex items-center gap-2 text-sm">
              Sort
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as Sort)}
                className="border-line text-ink h-10 rounded-full border bg-transparent px-3 text-sm"
              >
                <option value="recommended">As listed</option>
                <option value="price-asc">Rate, low to high</option>
                <option value="price-desc">Rate, high to low</option>
              </select>
            </label>
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
          <div className="space-y-14">
            {byDestination.map((group) => (
              <section key={group.destination.slug}>
                <h2 className="border-line mb-6 border-b pb-3 text-2xl">
                  {group.destination.name}
                  <span className="text-muted text-base"> · {group.destination.country}</span>
                </h2>
                <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-3">
                  {group.items.map((property) => (
                    <PropertyCard key={property.slug} property={property} locale={locale} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        <IllustrativeNote className="mt-10">{t('explore.stay.estimateNote')}</IllustrativeNote>
      </div>
    </div>
  )
}

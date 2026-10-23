'use client'

import { useState } from 'react'
import { ChevronDown, Moon, Plus, Repeat, Sun, Sunset, Trash2 } from 'lucide-react'
import { Money } from '@/components/money'
import { cn } from '@/lib/cn'
import { createTranslator, type AppLocale } from '@/lib/i18n'
import {
  CONTENT_CURRENCY,
  type ItineraryActivity,
  type ItineraryDayPlan,
} from '@/modules/discovery/content/types'
import { dayCost } from '@/modules/discovery/planner'

/**
 * One collapsible day of a drafted itinerary, editable in place.
 *
 * The export's version held the whole itinerary in this component and mutated
 * it. This one is told about a single day and hands a new day object back, so
 * the itinerary has one owner. Alternatives arrive as a function rather than a
 * list because what is available depends on what the rest of the plan already
 * uses, and that is the builder's knowledge, not the day's.
 *
 * Money is minor units throughout and renders through `<Money>`. Nothing here
 * divides, sums across intents, or formats a figure itself.
 */

const ORDER: Record<ItineraryActivity['time'], number> = { Morning: 0, Afternoon: 1, Evening: 2 }

const SLOTS: ItineraryActivity['time'][] = ['Morning', 'Afternoon', 'Evening']

const ICONS: Record<ItineraryActivity['time'], typeof Sun> = {
  Morning: Sun,
  Afternoon: Sunset,
  Evening: Moon,
}

const sortActivities = (activities: ItineraryActivity[]): ItineraryActivity[] =>
  [...activities].sort((a, b) => ORDER[a.time] - ORDER[b.time])

export function ItineraryDay({
  locale,
  day,
  travelers,
  defaultOpen,
  getAlternatives,
  onChange,
}: {
  locale: AppLocale
  day: ItineraryDayPlan
  travelers: number
  /** Decided by the builder, so this component picks no default of its own. */
  defaultOpen: boolean
  getAlternatives: (time: ItineraryActivity['time']) => ItineraryActivity[]
  onChange: (day: ItineraryDayPlan) => void
}) {
  const t = createTranslator(locale)
  const [open, setOpen] = useState(defaultOpen)
  const [picker, setPicker] = useState<{ time: ItineraryActivity['time']; replaceId?: string } | null>(
    null,
  )

  const cost = dayCost(day, travelers)

  const replace = (id: string, next: ItineraryActivity) => {
    onChange({
      ...day,
      activities: sortActivities(
        day.activities.map((a) => (a.id === id ? { ...next, id: a.id } : a)),
      ),
    })
    setPicker(null)
  }

  const add = (activity: ItineraryActivity) => {
    onChange({
      ...day,
      activities: sortActivities([
        ...day.activities,
        { ...activity, id: `d${day.day}-added-${day.activities.length}` },
      ]),
    })
    setPicker(null)
  }

  const remove = (id: string) => {
    onChange({ ...day, activities: day.activities.filter((a) => a.id !== id) })
  }

  const alternatives = picker ? getAlternatives(picker.time) : []

  return (
    <article className="border-line overflow-hidden rounded-2xl border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="hover:bg-paper flex w-full items-center gap-4 px-5 py-4 text-left transition-colors duration-150"
      >
        <span className="bg-ink text-ivory flex size-9 shrink-0 items-center justify-center rounded-full text-sm tabular-nums">
          {day.day}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-lg leading-snug">{day.theme}</span>
          <span className="text-muted block text-xs">
            {day.date} · {t('explore.planner.dayLabel', { day: day.day })}
          </span>
        </span>
        <span className="text-muted hidden text-sm sm:block">
          <Money
            amountMinor={cost.totalMinor}
            currency={cost.currency}
            locale={locale}
            intent="potential"
          />
        </span>
        <ChevronDown
          className={cn('text-muted size-4 shrink-0 transition-transform duration-150', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open ? (
        <div className="border-line border-t px-5 pt-4 pb-5">
          <ul className="divide-line divide-y">
            {sortActivities(day.activities).map((activity) => {
              const Icon = ICONS[activity.time]
              return (
                <li key={activity.id} className="flex items-start gap-4 py-4">
                  <Icon className="text-gold-deep mt-1 size-4 shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-muted text-xs">{activity.time}</p>
                    <p className="mt-0.5 leading-snug">{activity.title}</p>
                    <p className="text-muted mt-1 text-xs leading-relaxed">{activity.detail}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {activity.costMinor > 0 ? (
                      <span className="text-sm">
                        <Money
                          amountMinor={activity.costMinor}
                          currency={CONTENT_CURRENCY}
                          locale={locale}
                          intent="potential"
                        />
                      </span>
                    ) : null}
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setPicker({ time: activity.time, replaceId: activity.id })}
                        aria-label={`${t('explore.planner.swap')}: ${activity.title}`}
                        className="border-line hover:border-ink flex size-7 items-center justify-center rounded-full border transition-colors duration-150"
                      >
                        <Repeat className="size-3" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(activity.id)}
                        aria-label={`${t('explore.planner.remove')}: ${activity.title}`}
                        className="border-line hover:border-danger hover:text-danger flex size-7 items-center justify-center rounded-full border transition-colors duration-150"
                      >
                        <Trash2 className="size-3" aria-hidden />
                      </button>
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-muted text-xs">{t('explore.planner.addActivity')}</span>
            {SLOTS.map((slot) => (
              <button
                key={slot}
                type="button"
                onClick={() => setPicker({ time: slot })}
                className="border-line hover:border-ink inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors duration-150"
              >
                <Plus className="size-3" aria-hidden />
                {slot}
              </button>
            ))}
          </div>

          {picker ? (
            <div className="border-line bg-paper mt-4 rounded-xl border p-4">
              <p className="text-muted text-xs">{picker.time}</p>
              {alternatives.length === 0 ? (
                <p className="mt-2 text-sm">{t('explore.planner.noAlternatives')}</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {alternatives.slice(0, 6).map((alternative) => (
                    <li key={alternative.id}>
                      <button
                        type="button"
                        onClick={() =>
                          picker.replaceId
                            ? replace(picker.replaceId, alternative)
                            : add(alternative)
                        }
                        className="hover:bg-ivory flex w-full items-baseline justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150"
                      >
                        <span className="min-w-0">
                          <span className="block truncate">{alternative.title}</span>
                          <span className="text-muted block truncate text-xs">
                            {alternative.detail}
                          </span>
                        </span>
                        {alternative.costMinor > 0 ? (
                          <span className="shrink-0 text-xs">
                            <Money
                              amountMinor={alternative.costMinor}
                              currency={CONTENT_CURRENCY}
                              locale={locale}
                              intent="potential"
                            />
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={() => setPicker(null)}
                className="text-muted hover:text-ink mt-3 text-xs underline transition-colors duration-150"
              >
                Close
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { createTranslator, type AppLocale } from '@/lib/i18n'
import type { Itinerary, PlannerPreferences } from '@/modules/discovery/content/types'
import { activeGenerator } from '@/modules/discovery/planner'
import { plannerIssues } from '@/modules/discovery/schemas'
import { ItineraryBuilder } from './itinerary-builder'
import { PlannerForm } from './planner-form'

/**
 * The planner's one piece of state: a brief, and the plan drafted from it.
 *
 * `nowIso` is the instant the server rendered the page. Constructing a `Date`
 * from a prop is pure; calling `new Date()` here would not be, and the planner
 * stamps `createdAt` and derives dates from it, so an impure read would also
 * have produced a server/client hydration mismatch.
 *
 * There is no autosave and no network call. Nothing a visitor does here
 * reaches ARC: no hold, no enquiry, no approval. The gated planner that can
 * commit a guest lives in the portal, behind `modules/itinerary` and the
 * conditions gate.
 */
export function TripPlanner({
  locale,
  nowIso,
  defaultPrefs,
  samples,
  initialItinerary,
  bookable,
  children,
}: {
  locale: AppLocale
  nowIso: string
  /** Dates computed on the server, so the form picks no default from a clock. */
  defaultPrefs: PlannerPreferences
  samples: Itinerary[]
  initialItinerary?: Itinerary
  /**
   * The one destination that can actually be booked, resolved on the server.
   *
   * This planner drafts over editorial content for eight places, exactly one
   * of which has a hotel, a catalogue and seats behind it. Its only exit used
   * to be "Keep in this browser" — a `localStorage` write — so somebody who
   * had just built a plan was offered a button about browser storage and
   * nothing else. Where the plan *can* be bought, say so and link to it;
   * where it cannot, say that instead of implying it can.
   */
  bookable: { destination: string; href: string; propertyName: string } | null
  /** The explanatory band, rendered on the server and shown under the form. */
  children?: ReactNode
}) {
  const t = createTranslator(locale)
  const now = useMemo(() => new Date(nowIso), [nowIso])

  const [prefs, setPrefs] = useState<PlannerPreferences>(
    initialItinerary?.preferences ?? defaultPrefs,
  )
  const [itinerary, setItinerary] = useState<Itinerary | null>(initialItinerary ?? null)

  /**
   * Why the brief cannot be drafted, if it cannot. `buildItinerary` throws on
   * the same list, so this is the readable half of one rule rather than a
   * second, looser copy of it.
   */
  const issues = useMemo(() => plannerIssues(prefs), [prefs])

  if (itinerary) {
    return (
      <ItineraryBuilder
        locale={locale}
        itinerary={itinerary}
        onChange={setItinerary}
        onBack={() => setItinerary(null)}
        now={now}
        generatorLabel={activeGenerator.label}
        bookable={bookable}
      />
    )
  }

  return (
    <>
      <PlannerForm
        locale={locale}
        prefs={prefs}
        onChange={setPrefs}
        issues={issues}
        onGenerate={() => {
          if (issues.length > 0) return
          setItinerary(activeGenerator.generate(prefs, now))
        }}
        samples={samples}
        onOpenSample={(sample) => {
          setPrefs(sample.preferences)
          setItinerary(sample)
        }}
        generatorLabel={t('explore.planner.generatorNote', { label: activeGenerator.label })}
      />
      {children}
    </>
  )
}

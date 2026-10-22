import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { ArrowLeft, BookmarkCheck, Bookmark, Info, ArrowRight, Plane } from 'lucide-react'
import { Itinerary, ItineraryDayPlan, Pace } from '../data/types'
import { getDestination } from '../data/destinations'
import { getStay } from '../data/stays'
import { getExperience } from '../data/experiences'
import { alternativesFor, buildItinerary, dayCost, itineraryTotal } from '../lib/planner'
import { useSaved } from '../store/SavedContext'
import { ItineraryDay } from './ItineraryDay'
import { money } from './ui'

type Props = { itinerary: Itinerary; onChange: (it: Itinerary) => void; onEditPreferences: () => void; generatorLabel: string }

export function ItineraryBuilder({ itinerary: it, onChange, onEditPreferences, generatorLabel }: Props) {
  const saved = useSaved()
  const dest = getDestination(it.preferences.destination)!
  const stay = getStay(it.stay)
  const travelers = it.preferences.travelers
  const total = useMemo(() => itineraryTotal(it), [it])
  const savedId = it.source === 'sample' ? `saved-${it.id}` : it.id
  const isSaved = saved.itineraries.some((x) => x.id === savedId)
  const [dirty, setDirty] = useState(false)

  const update = (next: Itinerary) => {
    onChange(next)
    setDirty(true)
  }

  const updateDay = (day: ItineraryDayPlan) => update({ ...it, days: it.days.map((d) => (d.day === day.day ? day : d)) })

  const changePace = (pace: Pace) => {
    if (pace === it.preferences.pace) return
    const rebuilt = buildItinerary({ ...it.preferences, pace }, it.source === 'sample' ? 'mock-generator' : it.source, savedId)
    update({ ...rebuilt, title: it.title })
    saved.notify(`Re-paced to ${pace.toLowerCase()} — days re-drafted`)
  }

  const save = () => {
    const toSave: Itinerary = { ...it, id: savedId, source: it.source === 'sample' ? 'mock-generator' : it.source }
    saved.saveItinerary(toSave)
    onChange(toSave)
    setDirty(false)
  }

  const maxDay = Math.max(...it.days.map((d) => dayCost(d, travelers).total))

  return (
    <div>
      <button onClick={onEditPreferences} className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink transition-colors duration-150">
        <ArrowLeft className="w-4 h-4" /> Edit preferences
      </button>

      <header className="mt-6 grid lg:grid-cols-[1fr_auto] gap-6 items-end">
        <div>
          <p className="inline-flex items-center gap-1.5 text-xs text-sage bg-sage-soft px-2.5 py-1 rounded-full">
            <Info className="w-3.5 h-3.5" /> {generatorLabel}
          </p>
          <input
            value={it.title}
            onChange={(e) => update({ ...it, title: e.target.value })}
            aria-label="Itinerary title"
            className="block w-full mt-4 font-serif text-4xl md:text-6xl tracking-tight bg-transparent outline-none border-b border-transparent focus:border-line"
          />
          <p className="mt-3 text-muted text-sm">
            {dest.name}, {dest.country} · {format(parseISO(it.days[0].date), 'd MMM')} – {format(parseISO(it.days[it.days.length - 1].date), 'd MMM yyyy')} · {travelers} traveller{travelers > 1 ? 's' : ''} · {it.preferences.budget}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-full border border-line p-1" role="group" aria-label="Travel pace">
            {(['Slow', 'Balanced', 'Full'] as Pace[]).map((p) => (
              <button
                key={p}
                onClick={() => changePace(p)}
                aria-pressed={it.preferences.pace === p}
                className={`px-4 h-9 rounded-full text-sm transition-colors duration-150 ${it.preferences.pace === p ? 'bg-ink text-ivory' : 'text-muted hover:text-ink'}`}
              >
                {p}
              </button>
            ))}
          </div>
          <button onClick={save} className={`inline-flex items-center gap-2 h-11 px-5 rounded-full text-sm whitespace-nowrap transition-colors duration-150 ${isSaved && !dirty ? 'bg-sage text-ivory' : 'bg-gold text-ink hover:bg-gold-hover'}`}>
            {isSaved && !dirty ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
            {isSaved ? (dirty ? 'Save changes' : 'Saved') : 'Save itinerary'}
          </button>
        </div>
      </header>

      <div className="mt-10 grid lg:grid-cols-[1fr_360px] gap-10 lg:gap-14">
        <div className="space-y-4">
          {it.days.map((d) => (
            <ItineraryDay
              key={d.day}
              day={d}
              travelers={travelers}
              onChange={updateDay}
              getAlternatives={(time) => alternativesFor(it, time)}
            />
          ))}
        </div>

        <aside className="space-y-8 lg:sticky lg:top-28 self-start">
          {/* Budget */}
          <section className="bg-ink text-ivory rounded-3xl p-6">
            <p className="text-sm text-ivory/60">Total estimated budget</p>
            <p className="font-serif text-5xl mt-1 tabular-nums">{money(total)}</p>
            <p className="text-xs text-ivory/50 mt-1">{money(total / travelers)} per person · excludes flights</p>
            <ul className="mt-6 space-y-2.5">
              {it.days.map((d) => {
                const c = dayCost(d, travelers)
                return (
                  <li key={d.day} className="grid grid-cols-[44px_1fr_64px] items-center gap-3 text-xs">
                    <span className="text-ivory/60">Day {d.day}</span>
                    <span className="h-1.5 rounded-full bg-ivory/10 overflow-hidden">
                      <span className="block h-full bg-gold rounded-full" style={{ width: `${(c.total / maxDay) * 100}%` }} />
                    </span>
                    <span className="text-right tabular-nums">{money(c.total)}</span>
                  </li>
                )
              })}
            </ul>
            <p className="mt-5 text-xs text-ivory/50 leading-relaxed">Estimates use sample rates for stays and experiences. Daily figures include lodging.</p>
          </section>

          {/* Stay */}
          {stay && (
            <section>
              <p className="text-sm font-medium mb-3">Suggested stay</p>
              <Link to={`/stays/${stay.slug}`} className="group flex gap-4">
                <img src={stay.images[0]} alt="" className="w-24 h-24 rounded-xl object-cover" />
                <div>
                  <p className="text-xs text-muted">{stay.type}</p>
                  <p className="font-serif text-lg leading-snug group-hover:text-sage transition-colors duration-150">{stay.name}</p>
                  <p className="text-sm mt-1">{money(stay.pricePerNight)} <span className="text-muted">/ room / night</span></p>
                </div>
              </Link>
            </section>
          )}

          {/* Logistics */}
          <section>
            <p className="text-sm font-medium mb-3 flex items-center gap-2"><Plane className="w-4 h-4" /> Travel logistics</p>
            <ul className="space-y-2.5">
              {it.logistics.map((l) => <li key={l} className="text-sm text-muted leading-relaxed pl-3 border-l border-line">{l}</li>)}
            </ul>
          </section>

          {/* Recommendations */}
          <section>
            <p className="text-sm font-medium mb-3">Recommended experiences</p>
            <ul className="divide-y divide-line border-y border-line">
              {it.recommendations.map((slug) => {
                const e = getExperience(slug)
                if (!e) return null
                return (
                  <li key={slug}>
                    <Link to={`/experiences/${slug}`} className="flex items-center justify-between gap-3 py-3 text-sm hover:text-sage transition-colors duration-150">
                      <span>{e.title}</span>
                      <span className="text-muted tabular-nums shrink-0">{money(e.price)}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>

          <Link to={`/culture/${dest.slug}`} className="flex items-center justify-between gap-3 bg-sage text-ivory rounded-2xl p-5 hover:bg-sage-deep transition-colors duration-150">
            <span>
              <span className="block text-xs text-ivory/70">Culture Context</span>
              <span className="block font-serif text-lg">Know before you go to {dest.name}</span>
            </span>
            <ArrowRight className="w-5 h-5 shrink-0" />
          </Link>
        </aside>
      </div>
    </div>
  )
}

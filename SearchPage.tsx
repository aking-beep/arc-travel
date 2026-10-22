import React, { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { differenceInCalendarDays, format, parseISO, isValid } from 'date-fns'
import { destinations } from '../data/destinations'
import { stays } from '../data/stays'
import { experiences } from '../data/experiences'
import { SearchBar, SearchValues } from '../components/SearchBar'
import { DestinationCard } from '../components/DestinationCard'
import { PropertyCard } from '../components/PropertyCard'
import { ExperienceCard } from '../components/ExperienceCard'
import { EmptyState, money } from '../components/ui'
import { TravelStyle } from '../data/types'

const STYLE_TO_CATEGORY: Record<string, string[]> = {
  'Surf & Ocean': ['Adventure', 'Nature'],
  'Culture & City': ['Culture', 'Food'],
  'Mountain & Alpine': ['Adventure', 'Nature'],
  Wellness: ['Wellness'],
  'Food & Craft': ['Food', 'Culture'],
  'Wild Nature': ['Nature', 'Adventure'],
}

export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const values: SearchValues = {
    q: params.get('q') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    guests: Number(params.get('guests') ?? 2),
    style: params.get('style') ?? '',
  }

  const nights = useMemo(() => {
    const a = parseISO(values.from), b = parseISO(values.to)
    return isValid(a) && isValid(b) ? Math.max(1, differenceInCalendarDays(b, a)) : 0
  }, [values.from, values.to])

  const destMatches = destinations.filter((d) => {
    const q = values.q.trim().toLowerCase()
    const qOk = !q || `${d.name} ${d.country} ${d.region}`.toLowerCase().includes(q)
    const sOk = !values.style || d.styles.includes(values.style as TravelStyle)
    return qOk && sOk
  })
  const slugs = new Set(destMatches.map((d) => d.slug))
  const stayMatches = stays.filter((s) => slugs.has(s.destination) && s.rooms.some((r) => r.sleeps >= Math.min(values.guests, 8)) )
  const expMatches = experiences.filter((e) => slugs.has(e.destination) && (!values.style || STYLE_TO_CATEGORY[values.style]?.includes(e.category)))

  const onSearch = (v: SearchValues) => {
    const p = new URLSearchParams()
    if (v.q) p.set('q', v.q)
    if (v.from) p.set('from', v.from)
    if (v.to) p.set('to', v.to)
    p.set('guests', String(v.guests))
    if (v.style) p.set('style', v.style)
    setParams(p)
  }

  const summary = [
    values.q || 'All destinations',
    values.from && values.to ? `${format(parseISO(values.from), 'd MMM')} – ${format(parseISO(values.to), 'd MMM yyyy')}` : 'Flexible dates',
    `${values.guests} traveller${values.guests > 1 ? 's' : ''}`,
    values.style || 'Any style',
  ]

  return (
    <div className="max-w-7xl mx-auto px-5 md:px-8 pt-8 md:pt-12 pb-20">
      <SearchBar key={params.toString()} initial={values} variant="inline" onSearch={onSearch} />
      <div className="mt-10">
        <h1 className="font-serif text-4xl md:text-5xl">Your results</h1>
        <p className="mt-3 text-muted text-sm">{summary.join(' · ')}</p>
      </div>

      {destMatches.length === 0 ? (
        <div className="mt-10">
          <EmptyState title="No destinations match" text="Try a broader search or a different travel style." action={<button onClick={() => setParams({})} className="text-sm underline underline-offset-4">Reset search</button>} />
        </div>
      ) : (
        <>
          <section className="mt-12">
            <h2 className="font-serif text-2xl mb-6">Destinations <span className="text-muted text-base">({destMatches.length})</span></h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {destMatches.map((d) => <DestinationCard key={d.slug} destination={d} />)}
            </div>
          </section>
          <section className="mt-16">
            <div className="flex items-baseline justify-between mb-6 gap-4">
              <h2 className="font-serif text-2xl">Stays <span className="text-muted text-base">({stayMatches.length})</span></h2>
              {nights > 0 && <p className="text-sm text-muted">Prices shown per night · {nights} night{nights > 1 ? 's' : ''} selected</p>}
            </div>
            {stayMatches.length ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {stayMatches.map((p) => (
                  <div key={p.slug} className="flex flex-col">
                    <PropertyCard property={p} />
                    {nights > 0 && <p className="text-xs text-muted mt-2">≈ {money(p.pricePerNight * nights * Math.ceil(values.guests / 2))} total for {nights} nights</p>}
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted">No stays sleep this many travellers here — try fewer travellers.</p>}
          </section>
          <section className="mt-16">
            <h2 className="font-serif text-2xl mb-6">Experiences <span className="text-muted text-base">({expMatches.length})</span></h2>
            {expMatches.length ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {expMatches.map((e) => <ExperienceCard key={e.slug} experience={e} />)}
              </div>
            ) : <p className="text-sm text-muted">No experiences match this style here. <Link to="/experiences" className="underline">Browse all</Link></p>}
          </section>
        </>
      )}
    </div>
  )
}

import React, { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Search, ArrowRight } from 'lucide-react'
import { destinations } from '../data/destinations'
import { DestinationCategory, TRAVEL_STYLES, TravelStyle } from '../data/types'
import { DestinationCard } from '../components/DestinationCard'
import { Chip, EmptyState, SectionHeading } from '../components/ui'

const CATEGORIES: (DestinationCategory | 'All')[] = ['All', 'Coastal', 'City', 'Island', 'Mountain']

export function DestinationsPage() {
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const category = (params.get('category') as DestinationCategory | null) ?? 'All'
  const [style, setStyle] = useState<TravelStyle>('Surf & Ocean')

  const setCategory = (c: string) => {
    const p = new URLSearchParams(params)
    if (c === 'All') p.delete('category')
    else p.set('category', c)
    setParams(p, { replace: true })
  }

  const filtered = useMemo(
    () =>
      destinations.filter((d) => {
        const ql = q.trim().toLowerCase()
        return (category === 'All' || d.category === category) && (!ql || `${d.name} ${d.country} ${d.region} ${d.tagline}`.toLowerCase().includes(ql))
      }),
    [q, category],
  )

  const featured = destinations.find((d) => d.slug === 'puerto-escondido')!
  const forStyle = destinations.filter((d) => d.styles.includes(style))

  return (
    <div>
      <section className="max-w-7xl mx-auto px-5 md:px-8 pt-10 md:pt-16">
        <h1 className="font-serif text-5xl md:text-7xl tracking-tight">Destinations</h1>
        <p className="mt-4 text-muted max-w-xl leading-relaxed">Eight places, chosen for their culture, landscape and the people who host there. Each has stays, experiences and a Culture Context guide.</p>

        {/* Featured */}
        <Link to={`/destinations/${featured.slug}`} className="group mt-10 grid lg:grid-cols-[1.6fr_1fr] rounded-3xl overflow-hidden bg-ink text-ivory">
          <div className="relative aspect-[16/10] lg:aspect-auto lg:min-h-[420px] overflow-hidden">
            <img src={featured.image} alt={featured.name} className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-[1.02]" />
          </div>
          <div className="p-8 md:p-12 flex flex-col">
            <p className="text-sm text-gold">Destination of the season</p>
            <h2 className="font-serif text-4xl md:text-5xl mt-3 leading-tight">{featured.name}</h2>
            <p className="text-ivory/60 text-sm mt-1">{featured.region}, {featured.country}</p>
            <p className="mt-6 text-ivory/80 leading-relaxed">{featured.overview[0]}</p>
            <span className="mt-auto pt-8 inline-flex items-center gap-2 text-sm text-gold">Explore {featured.name} <ArrowRight className="w-4 h-4" /></span>
          </div>
        </Link>
      </section>

      {/* Directory */}
      <section className="max-w-7xl mx-auto px-5 md:px-8 pt-16 md:pt-24">
        <div className="flex flex-col md:flex-row md:items-center gap-4 md:justify-between mb-8">
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-5 px-5 md:mx-0 md:px-0">
            {CATEGORIES.map((c) => <Chip key={c} active={category === c} onClick={() => setCategory(c)}>{c}</Chip>)}
          </div>
          <label className="flex items-center gap-2 h-11 px-4 rounded-full border border-line bg-ivory md:w-80 focus-within:border-ink">
            <Search className="w-4 h-4 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by place or country" className="flex-1 bg-transparent outline-none text-sm" aria-label="Search destinations" />
          </label>
        </div>
        <p className="text-sm text-muted mb-6">{filtered.length} of {destinations.length} destinations</p>
        {filtered.length ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-10">
            {filtered.map((d) => <DestinationCard key={d.slug} destination={d} />)}
          </div>
        ) : (
          <EmptyState title="Nothing matches yet" text="Try another place name or clear the category." action={<button onClick={() => { setQ(''); setCategory('All') }} className="text-sm underline underline-offset-4">Clear search</button>} />
        )}
      </section>

      {/* Style recommendations */}
      <section className="mt-20 md:mt-28 bg-paper">
        <div className="max-w-7xl mx-auto px-5 md:px-8 py-16 md:py-24">
          <SectionHeading title="Recommended for how you travel" kicker="Pick a travel style to see where it fits best." />
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-5 px-5 md:mx-0 md:px-0 mb-10">
            {TRAVEL_STYLES.map((s) => <Chip key={s} active={style === s} onClick={() => setStyle(s)}>{s}</Chip>)}
          </div>
          <ul className="divide-y divide-line border-y border-line">
            {forStyle.map((d) => (
              <li key={d.slug}>
                <Link to={`/destinations/${d.slug}`} className="group grid grid-cols-[72px_1fr_auto] md:grid-cols-[96px_1.2fr_2fr_auto] gap-5 items-center py-5">
                  <img src={d.image} alt="" className="w-[72px] h-[72px] md:w-24 md:h-24 rounded-xl object-cover" />
                  <div>
                    <p className="font-serif text-xl md:text-2xl group-hover:text-sage transition-colors duration-150">{d.name}</p>
                    <p className="text-xs text-muted mt-1">{d.country} · Best: {d.bestTime.split(';')[0]}</p>
                  </div>
                  <p className="hidden md:block text-sm text-muted leading-relaxed">{d.tagline}</p>
                  <ArrowRight className="w-5 h-5 text-muted group-hover:text-ink transition-colors duration-150" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  )
}

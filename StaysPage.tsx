import React, { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, LayoutGrid, Map as MapIcon, SlidersHorizontal } from 'lucide-react'
import { stays, ALL_AMENITIES } from '../data/stays'
import { destinations, getDestination } from '../data/destinations'
import { PROPERTY_TYPES } from '../data/types'
import { osmEmbed } from '../data/geo'
import { PropertyCard } from '../components/PropertyCard'
import { FilterPanel } from '../components/FilterPanel'
import { EmptyState } from '../components/ui'

type Sort = 'recommended' | 'price-asc' | 'price-desc' | 'rating'
const PRICE_MAX = 500

export function StaysPage() {
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [types, setTypes] = useState<string[]>([])
  const [amenities, setAmenities] = useState<string[]>([])
  const [maxPrice, setMaxPrice] = useState(PRICE_MAX)
  const [sort, setSort] = useState<Sort>('recommended')
  const [view, setView] = useState<'grid' | 'map'>('grid')
  const [drawer, setDrawer] = useState(false)
  const destination = params.get('destination') ?? ''
  const [mapDest, setMapDest] = useState(destination || 'puerto-escondido')

  const setDestination = (slug: string) => {
    const p = new URLSearchParams(params)
    if (slug) p.set('destination', slug)
    else p.delete('destination')
    setParams(p, { replace: true })
    if (slug) setMapDest(slug)
  }

  const toggle = (list: string[], set: (v: string[]) => void) => (v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const list = stays.filter((s) => {
      const dest = getDestination(s.destination)
      return (
        (!destination || s.destination === destination) &&
        (!ql || `${s.name} ${s.type} ${dest?.name} ${dest?.country}`.toLowerCase().includes(ql)) &&
        (!types.length || types.includes(s.type)) &&
        amenities.every((a) => s.amenities.includes(a)) &&
        s.pricePerNight <= maxPrice
      )
    })
    if (sort === 'price-asc') return [...list].sort((a, b) => a.pricePerNight - b.pricePerNight)
    if (sort === 'price-desc') return [...list].sort((a, b) => b.pricePerNight - a.pricePerNight)
    if (sort === 'rating') return [...list].sort((a, b) => b.rating - a.rating)
    return list
  }, [q, destination, types, amenities, maxPrice, sort])

  const activeCount = types.length + amenities.length + (maxPrice < PRICE_MAX ? 1 : 0) + (destination ? 1 : 0)
  const clear = () => { setTypes([]); setAmenities([]); setMaxPrice(PRICE_MAX); setDestination('') }
  const byDest = destinations.map((d) => ({ d, items: filtered.filter((s) => s.destination === d.slug) })).filter((x) => x.items.length)
  const mapItems = filtered.filter((s) => s.destination === mapDest)

  return (
    <div className="max-w-7xl mx-auto px-5 md:px-8 pt-10 md:pt-16 pb-20">
      <h1 className="font-serif text-5xl md:text-7xl tracking-tight">Stays</h1>
      <p className="mt-4 text-muted max-w-xl leading-relaxed">Boutique hotels, surf lodges, villas and mountain refuges. Verified partners are marked; others are illustrative examples.</p>

      <div className="mt-10 flex flex-col md:flex-row gap-3 md:items-center">
        <label className="flex items-center gap-2 h-12 px-4 rounded-full border border-line bg-ivory flex-1 focus-within:border-ink">
          <Search className="w-4 h-4 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search stays, places or types" className="flex-1 bg-transparent outline-none text-sm" aria-label="Search stays" />
        </label>
        <div className="flex gap-3">
          <select value={destination} onChange={(e) => setDestination(e.target.value)} className="h-12 px-4 rounded-full border border-line bg-ivory text-sm flex-1 md:flex-none" aria-label="Destination">
            <option value="">All destinations</option>
            {destinations.map((d) => <option key={d.slug} value={d.slug}>{d.name}</option>)}
          </select>
          <button onClick={() => setDrawer(true)} className="lg:hidden h-12 px-4 rounded-full border border-line text-sm inline-flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4" /> Filters{activeCount ? ` (${activeCount})` : ''}
          </button>
        </div>
      </div>

      <div className="mt-10 flex gap-12">
        <FilterPanel
          open={drawer}
          onClose={() => setDrawer(false)}
          activeCount={activeCount}
          onClear={clear}
          resultCount={filtered.length}
          groups={[
            { id: 'type', label: 'Property type', options: PROPERTY_TYPES, selected: types, onToggle: toggle(types, setTypes) },
            { id: 'amenities', label: 'Amenities', options: ALL_AMENITIES, selected: amenities, onToggle: toggle(amenities, setAmenities) },
          ]}
        >
          <div>
            <div className="flex justify-between text-sm mb-3"><span className="font-medium">Max nightly price</span><span className="tabular-nums">{maxPrice >= PRICE_MAX ? 'Any' : `$${maxPrice}`}</span></div>
            <input type="range" min={100} max={PRICE_MAX} step={10} value={maxPrice} onChange={(e) => setMaxPrice(Number(e.target.value))} className="w-full accent-[#52685B]" aria-label="Maximum price per night" />
            <div className="flex justify-between text-xs text-muted mt-1"><span>$100</span><span>$500+</span></div>
          </div>
        </FilterPanel>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-4 mb-6">
            <p className="text-sm text-muted">{filtered.length} stay{filtered.length === 1 ? '' : 's'}</p>
            <div className="flex items-center gap-3">
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-10 px-3 rounded-full border border-line bg-ivory text-sm" aria-label="Sort">
                <option value="recommended">Recommended</option>
                <option value="price-asc">Price: low to high</option>
                <option value="price-desc">Price: high to low</option>
                <option value="rating">Top rated</option>
              </select>
              <div className="flex rounded-full border border-line p-1" role="group" aria-label="View">
                <button onClick={() => setView('grid')} aria-pressed={view === 'grid'} aria-label="Grid view" className={`w-9 h-8 rounded-full flex items-center justify-center transition-colors duration-150 ${view === 'grid' ? 'bg-ink text-ivory' : 'text-muted'}`}><LayoutGrid className="w-4 h-4" /></button>
                <button onClick={() => setView('map')} aria-pressed={view === 'map'} aria-label="Map view" className={`w-9 h-8 rounded-full flex items-center justify-center transition-colors duration-150 ${view === 'map' ? 'bg-ink text-ivory' : 'text-muted'}`}><MapIcon className="w-4 h-4" /></button>
              </div>
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState title="No stays match these filters" text="Raise the price limit or remove an amenity." action={<button onClick={clear} className="text-sm underline underline-offset-4">Clear filters</button>} />
          ) : view === 'grid' ? (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-10">
              {filtered.map((p) => <PropertyCard key={p.slug} property={p} />)}
            </div>
          ) : (
            <div>
              <div className="flex gap-2 overflow-x-auto no-scrollbar mb-4">
                {byDest.map(({ d, items }) => (
                  <button key={d.slug} onClick={() => setMapDest(d.slug)} className={`h-10 px-4 rounded-full border text-sm whitespace-nowrap transition-colors duration-150 ${mapDest === d.slug ? 'bg-ink text-ivory border-ink' : 'border-line hover:border-ink'}`}>
                    {d.name} · {items.length}
                  </button>
                ))}
              </div>
              <div className="grid xl:grid-cols-[1.3fr_1fr] gap-6">
                <div className="rounded-2xl overflow-hidden border border-line bg-paper aspect-[4/3] xl:aspect-auto xl:min-h-[520px]">
                  <iframe key={mapDest} title={`Map of ${getDestination(mapDest)?.name}`} src={osmEmbed(mapDest)} className="w-full h-full border-0" loading="lazy" />
                </div>
                <div>
                  <p className="font-serif text-2xl">{getDestination(mapDest)?.name}</p>
                  <p className="text-xs text-muted mb-3">Map shows destination area; exact addresses shared after inquiry.</p>
                  {mapItems.length ? (
                    <div className="divide-y divide-line">{mapItems.map((p) => <PropertyCard key={p.slug} property={p} layout="row" />)}</div>
                  ) : <p className="text-sm text-muted">No stays here match your filters.</p>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

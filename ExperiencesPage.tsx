import React, { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, SlidersHorizontal } from 'lucide-react'
import { experiences, ACTIVITIES } from '../data/experiences'
import { destinations } from '../data/destinations'
import { EXPERIENCE_CATEGORIES, ExperienceCategory } from '../data/types'
import { ExperienceCard } from '../components/ExperienceCard'
import { FilterPanel } from '../components/FilterPanel'
import { Chip, EmptyState } from '../components/ui'

const DIFFICULTIES = ['Easy', 'Moderate', 'Challenging', 'Expert']
const DURATIONS = ['Under 4 hours', 'Half to full day', 'Multi-day']

export function ExperiencesPage() {
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [category, setCategory] = useState<ExperienceCategory | 'All'>('All')
  const [activities, setActivities] = useState<string[]>([])
  const [difficulty, setDifficulty] = useState<string[]>([])
  const [durations, setDurations] = useState<string[]>([])
  const [drawer, setDrawer] = useState(false)
  const destination = params.get('destination') ?? ''

  const setDestination = (slug: string) => {
    const p = new URLSearchParams(params)
    if (slug) p.set('destination', slug)
    else p.delete('destination')
    setParams(p, { replace: true })
  }
  const toggle = (list: string[], set: (v: string[]) => void) => (v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  const durationBucket = (h: number) => (h < 4 ? DURATIONS[0] : h <= 10 ? DURATIONS[1] : DURATIONS[2])

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase()
    return experiences.filter((e) =>
      (category === 'All' || e.category === category) &&
      (!destination || e.destination === destination) &&
      (!activities.length || activities.includes(e.activity)) &&
      (!difficulty.length || difficulty.includes(e.difficulty)) &&
      (!durations.length || durations.includes(durationBucket(e.durationHours))) &&
      (!ql || `${e.title} ${e.activity} ${e.summary} ${e.host.name}`.toLowerCase().includes(ql)),
    )
  }, [q, category, destination, activities, difficulty, durations])

  const activeCount = activities.length + difficulty.length + durations.length + (destination ? 1 : 0)
  const clear = () => { setActivities([]); setDifficulty([]); setDurations([]); setDestination(''); setCategory('All') }

  return (
    <div className="max-w-7xl mx-auto px-5 md:px-8 pt-10 md:pt-16 pb-20">
      <h1 className="font-serif text-5xl md:text-7xl tracking-tight">Experiences</h1>
      <p className="mt-4 text-muted max-w-xl leading-relaxed">Surf at dawn, cook in a family kitchen, climb above the glaciers. Every experience is led by a local host.</p>

      <div className="mt-10 flex flex-col md:flex-row gap-3">
        <label className="flex items-center gap-2 h-12 px-4 rounded-full border border-line bg-ivory flex-1 focus-within:border-ink">
          <Search className="w-4 h-4 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search surfing, cooking, hosts…" className="flex-1 bg-transparent outline-none text-sm" aria-label="Search experiences" />
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

      <div className="mt-6 flex gap-2 overflow-x-auto no-scrollbar -mx-5 px-5 md:mx-0 md:px-0">
        {(['All', ...EXPERIENCE_CATEGORIES] as const).map((c) => <Chip key={c} active={category === c} onClick={() => setCategory(c)}>{c}</Chip>)}
      </div>

      <div className="mt-10 flex gap-12">
        <FilterPanel
          open={drawer}
          onClose={() => setDrawer(false)}
          activeCount={activeCount}
          onClear={clear}
          resultCount={filtered.length}
          groups={[
            { id: 'activity', label: 'Activity', options: ACTIVITIES, selected: activities, onToggle: toggle(activities, setActivities) },
            { id: 'difficulty', label: 'Difficulty', options: DIFFICULTIES, selected: difficulty, onToggle: toggle(difficulty, setDifficulty) },
            { id: 'duration', label: 'Duration', options: DURATIONS, selected: durations, onToggle: toggle(durations, setDurations) },
          ]}
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-muted mb-6">{filtered.length} experience{filtered.length === 1 ? '' : 's'}</p>
          {filtered.length ? (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-10">
              {filtered.map((e) => <ExperienceCard key={e.slug} experience={e} />)}
            </div>
          ) : (
            <EmptyState title="No experiences match" text="Try another category or loosen a filter." action={<button onClick={clear} className="text-sm underline underline-offset-4">Clear filters</button>} />
          )}
        </div>
      </div>
    </div>
  )
}

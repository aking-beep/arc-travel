import React from 'react'
import { Link } from 'react-router-dom'
import { Minus, Plus, Check, Loader2, ArrowRight } from 'lucide-react'
import { destinations } from '../data/destinations'
import { sampleItineraries } from '../data/itineraries'
import { Budget, EXPERIENCE_CATEGORIES, Pace, PlannerPreferences, PROPERTY_TYPES, TRAVEL_STYLES } from '../data/types'
import { tripLength } from '../lib/planner'
import { Chip } from './ui'

type Props = { value: PlannerPreferences; onChange: (p: PlannerPreferences) => void; onGenerate: () => void; generating: boolean }

const BUDGETS: { id: Budget; note: string }[] = [
  { id: 'Considered', note: 'Simple stays, local food' },
  { id: 'Comfort', note: 'Boutique stays, a few splurges' },
  { id: 'Luxury', note: 'Best rooms, private guides' },
]
const PACES: { id: Pace; note: string }[] = [
  { id: 'Slow', note: '2 plans a day' },
  { id: 'Balanced', note: '3 plans a day' },
  { id: 'Full', note: '4 plans a day' },
]

export function PlannerForm({ value: v, onChange, onGenerate, generating }: Props) {
  const set = <K extends keyof PlannerPreferences>(k: K, val: PlannerPreferences[K]) => onChange({ ...v, [k]: val })
  const nights = tripLength(v)
  const datesInvalid = !v.startDate || !v.endDate || v.endDate <= v.startDate
  const toggleActivity = (a: (typeof EXPERIENCE_CATEGORIES)[number]) =>
    set('activities', v.activities.includes(a) ? v.activities.filter((x) => x !== a) : [...v.activities, a])

  return (
    <div className="grid lg:grid-cols-[1fr_340px] gap-12 lg:gap-16">
      <div>
        <h1 className="font-serif text-5xl md:text-6xl tracking-tight">Plan your journey</h1>
        <p className="mt-4 text-muted max-w-xl leading-relaxed">Answer eight questions. The planner drafts a day-by-day itinerary you can then edit, re-pace and save.</p>

        <Step n={1} title="Where to?">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {destinations.map((d) => {
              const on = v.destination === d.slug
              return (
                <button
                  key={d.slug}
                  type="button"
                  onClick={() => set('destination', d.slug)}
                  aria-pressed={on}
                  className={`relative text-left rounded-xl overflow-hidden aspect-[4/3] ring-2 ring-offset-2 ring-offset-ivory transition-[box-shadow] duration-150 ${on ? 'ring-ink' : 'ring-transparent'}`}
                >
                  <img src={d.image} alt="" className="absolute inset-0 w-full h-full object-cover" />
                  <span className="absolute inset-0 bg-ink/35" />
                  <span className="absolute bottom-2 left-3 right-3 text-ivory text-sm font-medium leading-tight">{d.name}</span>
                  {on && <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-gold flex items-center justify-center"><Check className="w-3.5 h-3.5 text-ink" /></span>}
                </button>
              )
            })}
          </div>
        </Step>

        <Step n={2} title="When?">
          <div className="grid sm:grid-cols-2 gap-3 max-w-lg">
            <DateField label="Arrive" value={v.startDate} onChange={(x) => onChange({ ...v, startDate: x, endDate: v.endDate <= x ? '' : v.endDate })} />
            <DateField label="Depart" value={v.endDate} min={v.startDate} onChange={(x) => set('endDate', x)} />
          </div>
          <p className={`mt-3 text-sm ${datesInvalid ? 'text-danger' : 'text-muted'}`}>
            {datesInvalid ? 'Choose a departure after your arrival.' : `${nights} night${nights > 1 ? 's' : ''}${nights === 10 ? ' (planner drafts up to 10 days)' : ''}`}
          </p>
        </Step>

        <Step n={3} title="Who’s coming?">
          <div className="flex items-center gap-5">
            <button type="button" aria-label="Fewer travellers" onClick={() => set('travelers', Math.max(1, v.travelers - 1))} className="w-11 h-11 rounded-full border border-line flex items-center justify-center hover:border-ink transition-colors duration-150"><Minus className="w-4 h-4" /></button>
            <span className="font-serif text-3xl w-10 text-center tabular-nums">{v.travelers}</span>
            <button type="button" aria-label="More travellers" onClick={() => set('travelers', Math.min(10, v.travelers + 1))} className="w-11 h-11 rounded-full border border-line flex items-center justify-center hover:border-ink transition-colors duration-150"><Plus className="w-4 h-4" /></button>
            <span className="text-sm text-muted">traveller{v.travelers > 1 ? 's' : ''}</span>
          </div>
        </Step>

        <Step n={4} title="Budget">
          <Segmented options={BUDGETS} value={v.budget} onChange={(x) => set('budget', x)} />
        </Step>

        <Step n={5} title="Travel style">
          <div className="flex flex-wrap gap-2">
            {TRAVEL_STYLES.map((s) => <Chip key={s} active={v.style === s} onClick={() => set('style', s)}>{s}</Chip>)}
          </div>
        </Step>

        <Step n={6} title="Where you’d like to sleep">
          <div className="flex flex-wrap gap-2">
            {(['Any', ...PROPERTY_TYPES] as const).map((t) => <Chip key={t} active={v.accommodation === t} onClick={() => set('accommodation', t)}>{t === 'Any' ? 'No preference' : t}</Chip>)}
          </div>
        </Step>

        <Step n={7} title="What you want to do">
          <div className="flex flex-wrap gap-2">
            {EXPERIENCE_CATEGORIES.map((a) => <Chip key={a} active={v.activities.includes(a)} onClick={() => toggleActivity(a)}>{a}</Chip>)}
          </div>
        </Step>

        <Step n={8} title="Pace" last>
          <Segmented options={PACES} value={v.pace} onChange={(x) => set('pace', x)} />
        </Step>
      </div>

      {/* Summary rail */}
      <aside className="lg:sticky lg:top-28 self-start">
        <div className="bg-ink text-ivory rounded-3xl p-6 md:p-8">
          <p className="font-serif text-2xl">Your brief</p>
          <dl className="mt-5 space-y-3 text-sm">
            {[
              ['Destination', destinations.find((d) => d.slug === v.destination)?.name],
              ['Length', datesInvalid ? '—' : `${nights} nights`],
              ['Travellers', v.travelers],
              ['Budget', v.budget],
              ['Style', v.style],
              ['Stay', v.accommodation === 'Any' ? 'No preference' : v.accommodation],
              ['Activities', v.activities.length ? v.activities.join(', ') : 'Open'],
              ['Pace', v.pace],
            ].map(([k, val]) => (
              <div key={k as string} className="flex justify-between gap-4 border-b border-ivory/10 pb-3">
                <dt className="text-ivory/60">{k}</dt>
                <dd className="text-right">{val}</dd>
              </div>
            ))}
          </dl>
          <button
            onClick={onGenerate}
            disabled={generating || datesInvalid}
            className="mt-6 w-full h-13 py-4 rounded-full bg-gold text-ink text-sm font-medium flex items-center justify-center gap-2 hover:bg-gold-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
          >
            {generating ? <><Loader2 className="w-4 h-4 animate-spin" /> Drafting…</> : 'Generate My Journey'}
          </button>
          <p className="mt-4 text-xs text-ivory/50 leading-relaxed">Drafted by ARC’s rules-based sample planner from our listings. It is not a live AI model; results are deterministic.</p>
        </div>
        <div className="mt-6">
          <p className="text-sm font-medium mb-3">Or start from a sample</p>
          <ul className="space-y-2">
            {sampleItineraries.map((s) => (
              <li key={s.id}>
                <Link to={`/plan?sample=${s.id}`} className="flex items-center justify-between gap-3 text-sm py-2 border-b border-line hover:text-sage transition-colors duration-150">
                  <span>{s.title}</span>
                  <ArrowRight className="w-4 h-4 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  )
}

function Step({ n, title, children, last }: { n: number; title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <section className={`mt-12 ${last ? '' : 'pb-2'}`}>
      <h2 className="flex items-baseline gap-3 font-serif text-2xl mb-5">
        <span className="text-sm font-sans text-gold-deep tabular-nums">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  )
}

function DateField({ label, value, onChange, min }: { label: string; value: string; onChange: (v: string) => void; min?: string }) {
  return (
    <label className="block border border-line rounded-xl px-4 py-3 bg-ivory focus-within:border-ink">
      <span className="block text-xs text-muted">{label}</span>
      <input type="date" value={value} min={min} onChange={(e) => onChange(e.target.value)} className="w-full bg-transparent outline-none text-sm mt-0.5" />
    </label>
  )
}

function Segmented<T extends string>({ options, value, onChange }: { options: { id: T; note: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2 max-w-xl">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`text-left rounded-xl border px-4 py-3 transition-colors duration-150 ${value === o.id ? 'bg-ink text-ivory border-ink' : 'border-line hover:border-ink'}`}
        >
          <span className="block text-sm font-medium">{o.id}</span>
          <span className={`block text-xs mt-0.5 ${value === o.id ? 'text-ivory/70' : 'text-muted'}`}>{o.note}</span>
        </button>
      ))}
    </div>
  )
}

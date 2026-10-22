import React, { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Search, Minus, Plus, MapPin } from 'lucide-react'
import { destinations } from '../data/destinations'
import { TRAVEL_STYLES } from '../data/types'

export type SearchValues = { q: string; from: string; to: string; guests: number; style: string }

type Props = { key?: React.Key; initial?: Partial<SearchValues>; variant?: 'hero' | 'inline'; onSearch?: (v: SearchValues) => void }

export function SearchBar({ initial, variant = 'hero', onSearch }: Props) {
  const navigate = useNavigate()
  const [v, setV] = useState<SearchValues>({ q: '', from: '', to: '', guests: 2, style: '', ...initial })
  const [focus, setFocus] = useState(false)
  const blurTimer = useRef<number>()

  const suggestions = useMemo(() => {
    const q = v.q.trim().toLowerCase()
    return destinations.filter((d) => !q || `${d.name} ${d.country} ${d.region}`.toLowerCase().includes(q)).slice(0, 6)
  }, [v.q])

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (onSearch) return onSearch(v)
    const p = new URLSearchParams()
    if (v.q) p.set('q', v.q)
    if (v.from) p.set('from', v.from)
    if (v.to) p.set('to', v.to)
    p.set('guests', String(v.guests))
    if (v.style) p.set('style', v.style)
    navigate(`/search?${p.toString()}`)
  }

  const shell = variant === 'hero' ? 'bg-ivory text-ink shadow-[0_20px_60px_-20px_rgba(32,40,36,0.45)]' : 'bg-ivory text-ink border border-line'

  return (
    <form onSubmit={submit} className={`${shell} rounded-2xl lg:rounded-full p-2 grid grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_0.9fr_1.1fr_auto] gap-1 lg:items-center`}>
      <div className="relative col-span-2 lg:col-span-1">
        <Field label="Where">
          <input
            value={v.q}
            onChange={(e) => setV({ ...v, q: e.target.value })}
            onFocus={() => { window.clearTimeout(blurTimer.current); setFocus(true) }}
            onBlur={() => { blurTimer.current = window.setTimeout(() => setFocus(false), 120) }}
            placeholder="Search destinations"
            className="w-full bg-transparent outline-none text-[15px] placeholder:text-muted"
            aria-label="Destination"
          />
        </Field>
        <AnimatePresence>
          {focus && suggestions.length > 0 && (
            <motion.ul
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
              className="absolute left-0 right-0 lg:right-auto lg:w-80 top-full mt-2 z-30 bg-ivory border border-line rounded-xl shadow-xl py-2"
            >
              {suggestions.map((d) => (
                <li key={d.slug}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setV({ ...v, q: d.name }); setFocus(false) }}
                    className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-paper transition-colors duration-100"
                  >
                    <MapPin className="w-4 h-4 text-gold-deep shrink-0" />
                    <span className="text-sm">{d.name}<span className="text-muted">, {d.country}</span></span>
                  </button>
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
      <Field label="Arrive" divider>
        <input type="date" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value, to: v.to && v.to < e.target.value ? '' : v.to })} className="w-full bg-transparent outline-none text-sm" aria-label="Arrival date" />
      </Field>
      <Field label="Depart" divider>
        <input type="date" value={v.to} min={v.from || undefined} onChange={(e) => setV({ ...v, to: e.target.value })} className="w-full bg-transparent outline-none text-sm" aria-label="Departure date" />
      </Field>
      <Field label="Travellers" divider>
        <div className="flex items-center gap-3">
          <button type="button" aria-label="Fewer travellers" onClick={() => setV({ ...v, guests: Math.max(1, v.guests - 1) })} className="w-7 h-7 rounded-full border border-line flex items-center justify-center hover:border-ink transition-colors duration-150"><Minus className="w-3 h-3" /></button>
          <span className="text-sm w-4 text-center tabular-nums">{v.guests}</span>
          <button type="button" aria-label="More travellers" onClick={() => setV({ ...v, guests: Math.min(12, v.guests + 1) })} className="w-7 h-7 rounded-full border border-line flex items-center justify-center hover:border-ink transition-colors duration-150"><Plus className="w-3 h-3" /></button>
        </div>
      </Field>
      <Field label="Travel style" divider>
        <select value={v.style} onChange={(e) => setV({ ...v, style: e.target.value })} className="w-full bg-transparent outline-none text-sm appearance-none cursor-pointer" aria-label="Travel style">
          <option value="">Any style</option>
          {TRAVEL_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
      <button type="submit" className="col-span-2 lg:col-span-1 h-12 lg:h-14 lg:w-14 xl:w-auto xl:px-6 rounded-xl lg:rounded-full bg-ink text-ivory flex items-center justify-center gap-2 hover:bg-ink-soft transition-colors duration-150 mt-1 lg:mt-0">
        <Search className="w-4 h-4" />
        <span className="lg:hidden xl:inline text-sm">Search</span>
      </button>
    </form>
  )
}

function Field({ label, children, divider }: { label: string; children: React.ReactNode; divider?: boolean }) {
  return (
    <label className={`block px-4 py-2.5 rounded-xl lg:rounded-full hover:bg-paper transition-colors duration-150 cursor-text ${divider ? 'lg:border-l lg:border-line lg:rounded-none lg:hover:bg-transparent' : ''}`}>
      <span className="block text-[11px] font-medium text-muted mb-0.5">{label}</span>
      {children}
    </label>
  )
}

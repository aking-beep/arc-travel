import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { format, parseISO } from 'date-fns'
import { ChevronDown, Pencil, RefreshCw, Trash2, Plus, Check, X } from 'lucide-react'
import { ItineraryActivity, ItineraryDayPlan } from '../data/types'
import { dayCost } from '../lib/planner'
import { money } from './ui'

type Props = {
  key?: React.Key
  day: ItineraryDayPlan
  travelers: number
  onChange: (d: ItineraryDayPlan) => void
  getAlternatives: (time: ItineraryActivity['time']) => ItineraryActivity[]
}

const ORDER = { Morning: 0, Afternoon: 1, Evening: 2 }

export function ItineraryDay({ day, travelers, onChange, getAlternatives }: Props) {
  const [open, setOpen] = useState(day.day <= 2)
  const [adding, setAdding] = useState<ItineraryActivity['time'] | null>(null)
  const cost = dayCost(day, travelers)

  const setActs = (activities: ItineraryActivity[]) =>
    onChange({ ...day, activities: [...activities].sort((a, b) => ORDER[a.time] - ORDER[b.time]) })

  const swap = (a: ItineraryActivity) => {
    const alts = getAlternatives(a.time)
    if (!alts.length) return
    setActs(day.activities.map((x) => (x.id === a.id ? { ...alts[0], id: a.id } : x)))
  }

  return (
    <article className="border border-line rounded-2xl bg-ivory overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-4 p-5 md:p-6 text-left" aria-expanded={open}>
        <span className="font-serif text-3xl text-gold-deep w-10 tabular-nums">{String(day.day).padStart(2, '0')}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-xs text-muted">{format(parseISO(day.date), 'EEEE d MMMM')}</span>
          <span className="block font-serif text-xl md:text-2xl leading-tight truncate">{day.theme}</span>
        </span>
        <span className="hidden sm:block text-right">
          <span className="block text-xs text-muted">Est. day</span>
          <span className="block text-sm tabular-nums">{money(cost.total)}</span>
        </span>
        <ChevronDown className={`w-5 h-5 text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}>
            <div className="px-5 md:px-6 pb-5 md:pb-6">
              <ol className="border-t border-line">
                <AnimatePresence initial={false}>
                  {day.activities.map((a) => (
                    <motion.li key={a.id} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }}>
                      <ActivityRow
                        a={a}
                        travelers={travelers}
                        onSwap={() => swap(a)}
                        onRemove={() => setActs(day.activities.filter((x) => x.id !== a.id))}
                        onSave={(next) => setActs(day.activities.map((x) => (x.id === a.id ? next : x)))}
                      />
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ol>
              {day.activities.length === 0 && <p className="text-sm text-muted py-4">A free day. Add something, or leave it open.</p>}

              {adding ? (
                <div className="mt-4 rounded-xl bg-paper p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="flex gap-1">
                      {(['Morning', 'Afternoon', 'Evening'] as const).map((t) => (
                        <button key={t} onClick={() => setAdding(t)} className={`px-3 h-8 rounded-full text-xs transition-colors duration-150 ${adding === t ? 'bg-ink text-ivory' : 'text-muted hover:text-ink'}`}>{t}</button>
                      ))}
                    </div>
                    <button onClick={() => setAdding(null)} aria-label="Close" className="w-8 h-8 flex items-center justify-center"><X className="w-4 h-4" /></button>
                  </div>
                  <ul className="space-y-1 max-h-64 overflow-y-auto">
                    {[...getAlternatives(adding), { id: 'free', time: adding, title: 'Free time', detail: 'Unscheduled — rest or explore', cost: 0, category: 'Free' } as ItineraryActivity].map((alt) => (
                      <li key={alt.id + alt.title}>
                        <button
                          onClick={() => {
                            setActs([...day.activities, { ...alt, id: `d${day.day}-${Date.now()}` }])
                            setAdding(null)
                          }}
                          className="w-full flex items-center justify-between gap-3 text-left text-sm px-3 py-2.5 rounded-lg hover:bg-ivory transition-colors duration-100"
                        >
                          <span>{alt.title}<span className="block text-xs text-muted">{alt.detail}</span></span>
                          <span className="text-muted tabular-nums shrink-0">{alt.cost ? money(alt.cost) : 'Free'}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <button onClick={() => setAdding('Afternoon')} className="mt-4 inline-flex items-center gap-2 text-sm text-sage hover:text-ink transition-colors duration-150">
                  <Plus className="w-4 h-4" /> Add activity
                </button>
              )}

              <div className="mt-5 pt-4 border-t border-line flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
                <span>Activities {money(cost.activities)}</span>
                <span>Lodging {money(cost.lodging)}</span>
                <span className="text-ink">Day total {money(cost.total)}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  )
}

function ActivityRow({ a, travelers, onSwap, onRemove, onSave }: { a: ItineraryActivity; travelers: number; onSwap: () => void; onRemove: () => void; onSave: (a: ItineraryActivity) => void }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(a.title)
  const [cost, setCost] = useState(String(a.cost))

  if (editing) {
    return (
      <form
        className="py-4 border-b border-line grid gap-3 sm:grid-cols-[1fr_120px_auto] items-end"
        onSubmit={(e) => {
          e.preventDefault()
          onSave({ ...a, title: title.trim() || a.title, cost: Math.max(0, Number(cost) || 0), experienceSlug: title === a.title ? a.experienceSlug : undefined })
          setEditing(false)
        }}
      >
        <label className="text-xs text-muted">Activity
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 block w-full border border-line rounded-lg px-3 h-10 text-sm text-ink bg-ivory outline-none focus:border-ink" />
        </label>
        <label className="text-xs text-muted">{a.category === 'Logistics' ? 'Cost (total)' : 'Cost / person'}
          <input type="number" min={0} value={cost} onChange={(e) => setCost(e.target.value)} className="mt-1 block w-full border border-line rounded-lg px-3 h-10 text-sm text-ink bg-ivory outline-none focus:border-ink" />
        </label>
        <div className="flex gap-2">
          <button type="submit" className="h-10 px-4 rounded-full bg-ink text-ivory text-sm inline-flex items-center gap-1.5"><Check className="w-4 h-4" />Done</button>
          <button type="button" onClick={() => setEditing(false)} className="h-10 px-3 rounded-full text-sm text-muted">Cancel</button>
        </div>
      </form>
    )
  }

  return (
    <div className="group py-4 border-b border-line grid grid-cols-[76px_1fr] sm:grid-cols-[88px_1fr_auto] gap-x-4 gap-y-2 items-start">
      <span className="text-xs text-muted pt-1">{a.time}</span>
      <div className="min-w-0">
        {a.experienceSlug ? (
          <Link to={`/experiences/${a.experienceSlug}`} className="text-[15px] leading-snug hover:text-sage underline decoration-line underline-offset-4">{a.title}</Link>
        ) : (
          <p className="text-[15px] leading-snug">{a.title}</p>
        )}
        <p className="text-xs text-muted mt-1">{a.detail}</p>
        <p className="text-xs mt-1 tabular-nums">
          {a.cost ? (a.category === 'Logistics' ? money(a.cost) : `${money(a.cost)} pp · ${money(a.cost * travelers)} total`) : 'No cost'}
        </p>
      </div>
      <div className="col-start-2 sm:col-start-3 flex gap-1 -ml-2 sm:ml-0">
        {a.category !== 'Logistics' && (
          <IconBtn label="Swap for an alternative" onClick={onSwap}><RefreshCw className="w-4 h-4" /></IconBtn>
        )}
        <IconBtn label="Edit activity" onClick={() => { setTitle(a.title); setCost(String(a.cost)); setEditing(true) }}><Pencil className="w-4 h-4" /></IconBtn>
        <IconBtn label="Remove activity" onClick={onRemove}><Trash2 className="w-4 h-4" /></IconBtn>
      </div>
    </div>
  )
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="w-10 h-10 rounded-full flex items-center justify-center text-muted hover:text-ink hover:bg-paper transition-colors duration-150">
      {children}
    </button>
  )
}

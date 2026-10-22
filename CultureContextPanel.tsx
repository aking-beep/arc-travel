import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { getCulture } from '../data/culture'

const TABS = ['Etiquette', 'Language', 'Seasons', 'Responsible travel'] as const
type Tab = (typeof TABS)[number]

export function CultureContextPanel({ destination, name, compact = false }: { destination: string; name: string; compact?: boolean }) {
  const guide = getCulture(destination)
  const [tab, setTab] = useState<Tab>('Etiquette')
  if (!guide) return null

  return (
    <div className={`bg-sage text-ivory rounded-3xl ${compact ? 'p-6' : 'p-6 md:p-12'}`}>
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div className="max-w-xl">
          <p className="text-sm text-ivory/70">Culture Context</p>
          <h2 className={`font-serif mt-2 leading-tight ${compact ? 'text-2xl' : 'text-3xl md:text-4xl'}`}>Before you arrive in {name}</h2>
          {!compact && <p className="mt-3 text-ivory/75 text-sm leading-relaxed">{guide.intro}</p>}
        </div>
        <Link to={`/culture/${destination}`} className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-ivory text-ink text-sm self-start whitespace-nowrap hover:bg-paper transition-colors duration-150">
          Full guide & assistant <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
      <div className="mt-8 flex gap-1 overflow-x-auto no-scrollbar border-b border-ivory/20" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`px-3 py-3 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors duration-150 ${tab === t ? 'border-gold text-ivory' : 'border-transparent text-ivory/60 hover:text-ivory'}`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="pt-6">
        {tab === 'Etiquette' && (
          <div className="grid md:grid-cols-2 gap-x-10 gap-y-5">
            {guide.etiquette.map((e) => (
              <div key={e.title}>
                <p className="font-serif text-lg">{e.title}</p>
                <p className="text-sm text-ivory/75 mt-1 leading-relaxed">{e.text}</p>
              </div>
            ))}
          </div>
        )}
        {tab === 'Language' && (
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-5">
            {guide.language.map((l) => (
              <div key={l.phrase}>
                <p className="font-serif text-xl italic">{l.phrase}</p>
                <p className="text-sm text-ivory/75">{l.meaning} · <span className="text-gold">{l.say}</span></p>
              </div>
            ))}
          </div>
        )}
        {tab === 'Seasons' && (
          <div className="grid md:grid-cols-3 gap-5">
            {guide.seasons.map((s) => (
              <div key={s.months}>
                <p className="text-xs text-gold">{s.months}</p>
                <p className="font-serif text-lg mt-1">{s.label}</p>
                <p className="text-sm text-ivory/75 mt-1 leading-relaxed">{s.text}</p>
              </div>
            ))}
          </div>
        )}
        {tab === 'Responsible travel' && (
          <ul className="grid md:grid-cols-2 gap-x-10 gap-y-3">
            {guide.responsible.map((r) => <li key={r} className="text-sm text-ivory/85 leading-relaxed pl-4 border-l border-gold">{r}</li>)}
          </ul>
        )}
      </div>
    </div>
  )
}

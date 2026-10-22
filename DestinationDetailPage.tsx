import React, { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Sun, Sunset, Moon, Plane, Clock, Coins, Languages } from 'lucide-react'
import { getDestination } from '../data/destinations'
import { stays } from '../data/stays'
import { experiences } from '../data/experiences'
import { SaveButton } from '../components/SaveButton'
import { PropertyCard } from '../components/PropertyCard'
import { ExperienceCard } from '../components/ExperienceCard'
import { CultureContextPanel } from '../components/CultureContextPanel'
import { NotFoundPage } from './NotFoundPage'

const SECTIONS = [
  ['overview', 'Overview'],
  ['stays', 'Stays'],
  ['experiences', 'Experiences'],
  ['itinerary', 'Itinerary'],
  ['neighborhoods', 'Neighbourhoods'],
  ['culture', 'Culture'],
  ['info', 'Travel info'],
] as const

export function DestinationDetailPage() {
  const { slug } = useParams()
  const d = getDestination(slug)
  const [day, setDay] = useState(0)
  if (!d) return <NotFoundPage />

  const localStays = stays.filter((s) => s.destination === d.slug)
  const localExp = experiences.filter((e) => e.destination === d.slug)
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const plan = d.itinerary[day]

  return (
    <div>
      <section className="relative h-[620px] md:h-[760px] bg-ink overflow-hidden">
        <img src={d.image} alt={`${d.name}, ${d.country}`} className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-ink/40" />
        <div className="relative h-full max-w-7xl mx-auto px-5 md:px-8 flex flex-col justify-end pb-10 md:pb-16 text-ivory">
          <p className="text-sm text-ivory/80">
            <Link to="/destinations" className="hover:text-ivory">Destinations</Link> / {d.country}
          </p>
          <h1 className="font-serif text-5xl sm:text-6xl md:text-8xl tracking-tight mt-3 leading-[0.95]">{d.name}</h1>
          <p className="mt-4 text-lg md:text-xl text-ivory/85 max-w-2xl font-serif italic">{d.tagline}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to={`/plan?destination=${d.slug}`} className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-gold text-ink text-sm font-medium hover:bg-gold-hover transition-colors duration-150">
              Plan a trip here <ArrowRight className="w-4 h-4" />
            </Link>
            <SaveButton kind="destinations" slug={d.slug} label={d.name} variant="inline" />
            <Link to={`/culture/${d.slug}`} className="inline-flex items-center h-11 px-5 rounded-full border border-ivory/40 text-sm hover:border-ivory transition-colors duration-150">Culture Context</Link>
          </div>
        </div>
      </section>

      <nav className="sticky top-16 md:top-20 z-40 bg-ivory/95 backdrop-blur border-b border-line">
        <div className="max-w-7xl mx-auto px-5 md:px-8 flex gap-6 overflow-x-auto no-scrollbar">
          {SECTIONS.map(([id, label]) => (
            <button key={id} onClick={() => go(id)} className="py-4 text-sm text-muted hover:text-ink whitespace-nowrap transition-colors duration-150">{label}</button>
          ))}
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-5 md:px-8">
        {/* Overview */}
        <section id="overview" className="scroll-mt-36 pt-16 md:pt-24 grid lg:grid-cols-[1.5fr_1fr] gap-12 lg:gap-20">
          <div>
            <h2 className="font-serif text-3xl md:text-4xl">Overview</h2>
            {d.overview.map((p, i) => (
              <p key={i} className={`mt-5 leading-relaxed ${i === 0 ? 'text-lg text-ink' : 'text-muted'}`}>{p}</p>
            ))}
          </div>
          <dl className="grid grid-cols-2 lg:grid-cols-1 gap-x-6 gap-y-5 self-start border-t border-line pt-6">
            <Fact icon={<Sun className="w-4 h-4" />} label="Best time" value={d.bestTime} />
            <Fact icon={<Plane className="w-4 h-4" />} label="Arrive via" value={d.airport} />
            <Fact icon={<Clock className="w-4 h-4" />} label="Time zone" value={d.timezone} />
            <Fact icon={<Coins className="w-4 h-4" />} label="Currency" value={d.currency} />
            <Fact icon={<Languages className="w-4 h-4" />} label="Language" value={d.language} />
          </dl>
        </section>

        {/* Stays */}
        <section id="stays" className="scroll-mt-36 pt-20 md:pt-28">
          <div className="flex items-end justify-between mb-8 gap-4">
            <h2 className="font-serif text-3xl md:text-4xl">Where to stay</h2>
            <Link to={`/stays?destination=${d.slug}`} className="text-sm border-b border-gold pb-1 whitespace-nowrap">All stays in {d.name}</Link>
          </div>
          {localStays.length ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {localStays.map((p) => <PropertyCard key={p.slug} property={p} />)}
            </div>
          ) : <p className="text-muted text-sm">Stays coming to this destination — browse <Link to="/stays" className="underline">all stays</Link>.</p>}
        </section>

        {/* Experiences */}
        <section id="experiences" className="scroll-mt-36 pt-20 md:pt-28">
          <div className="flex items-end justify-between mb-8 gap-4">
            <h2 className="font-serif text-3xl md:text-4xl">Local experiences</h2>
            <Link to={`/experiences?destination=${d.slug}`} className="text-sm border-b border-gold pb-1 whitespace-nowrap">See all</Link>
          </div>
          <div className="flex md:grid md:grid-cols-3 lg:grid-cols-4 gap-6 overflow-x-auto no-scrollbar snap-x -mx-5 px-5 md:mx-0 md:px-0">
            {localExp.map((e) => (
              <div key={e.slug} className="snap-start shrink-0 w-[75%] sm:w-[45%] md:w-auto"><ExperienceCard experience={e} /></div>
            ))}
          </div>
        </section>

        {/* Itinerary preview */}
        <section id="itinerary" className="scroll-mt-36 pt-20 md:pt-28">
          <div className="bg-paper rounded-3xl p-6 md:p-12">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
              <div>
                <h2 className="font-serif text-3xl md:text-4xl">A {d.itinerary.length}-day sketch</h2>
                <p className="text-muted text-sm mt-2">Tap through the days. Make it yours in the planner.</p>
              </div>
              <Link to={`/plan?destination=${d.slug}`} className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-ink text-ivory text-sm self-start hover:bg-ink-soft transition-colors duration-150">
                Customise this itinerary <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
            <div className="mt-8 flex gap-2 overflow-x-auto no-scrollbar">
              {d.itinerary.map((it, i) => (
                <button
                  key={i}
                  onClick={() => setDay(i)}
                  className={`shrink-0 text-left px-4 py-3 rounded-xl border transition-colors duration-150 ${i === day ? 'bg-ivory border-ink' : 'border-line hover:border-ink'}`}
                >
                  <span className="block text-xs text-muted">Day {i + 1}</span>
                  <span className="block text-sm whitespace-nowrap">{it.title}</span>
                </button>
              ))}
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={day}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                className="mt-6 grid md:grid-cols-3 gap-px bg-line rounded-2xl overflow-hidden"
              >
                {[
                  ['Morning', plan.morning, <Sun key="s" className="w-4 h-4" />],
                  ['Afternoon', plan.afternoon, <Sunset key="a" className="w-4 h-4" />],
                  ['Evening', plan.evening, <Moon key="m" className="w-4 h-4" />],
                ].map(([label, text, icon]) => (
                  <div key={label as string} className="bg-ivory p-6">
                    <p className="flex items-center gap-2 text-xs text-gold-deep">{icon}{label}</p>
                    <p className="mt-3 font-serif text-xl leading-snug">{text}</p>
                  </div>
                ))}
              </motion.div>
            </AnimatePresence>
          </div>
        </section>

        {/* Neighborhoods */}
        <section id="neighborhoods" className="scroll-mt-36 pt-20 md:pt-28">
          <h2 className="font-serif text-3xl md:text-4xl mb-8">Neighbourhoods</h2>
          <div className="grid md:grid-cols-2 gap-x-12">
            {d.neighborhoods.map((n) => (
              <div key={n.name} className="border-t border-line py-6">
                <p className="font-serif text-2xl">{n.name}</p>
                <p className="mt-2 text-muted leading-relaxed">{n.vibe}</p>
                <p className="mt-3 text-sm"><span className="text-sage font-medium">Best for</span> · {n.bestFor}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Culture */}
        <section id="culture" className="scroll-mt-36 pt-20 md:pt-28">
          <CultureContextPanel destination={d.slug} name={d.name} />
        </section>

        {/* Travel info */}
        <section id="info" className="scroll-mt-36 py-20 md:py-28">
          <h2 className="font-serif text-3xl md:text-4xl mb-8">Travel information</h2>
          <dl className="divide-y divide-line border-y border-line">
            {d.travelInfo.map((t) => (
              <div key={t.label} className="grid md:grid-cols-[240px_1fr] gap-2 md:gap-8 py-5">
                <dt className="font-medium text-sm">{t.label}</dt>
                <dd className="text-muted text-sm leading-relaxed">{t.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  )
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <dt className="flex items-center gap-2 text-xs text-muted">{icon}{label}</dt>
      <dd className="mt-1 text-sm leading-relaxed">{value}</dd>
    </div>
  )
}

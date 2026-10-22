import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import { ArrowRight, Trash2, Mail } from 'lucide-react'
import { useSaved } from '../store/SavedContext'
import { destinations, getDestination } from '../data/destinations'
import { stays } from '../data/stays'
import { experiences } from '../data/experiences'
import { sampleItineraries } from '../data/itineraries'
import { itineraryTotal } from '../lib/planner'
import { DestinationCard } from '../components/DestinationCard'
import { PropertyCard } from '../components/PropertyCard'
import { ExperienceCard } from '../components/ExperienceCard'
import { EmptyState, money } from '../components/ui'

type Tab = 'destinations' | 'stays' | 'experiences'

export function TripsPage() {
  const s = useSaved()
  const [tab, setTab] = useState<Tab>('destinations')
  const today = format(new Date(), 'yyyy-MM-dd')

  const upcoming = [
    ...s.itineraries.filter((i) => i.days[0].date >= today).map((i) => ({ kind: 'itinerary' as const, date: i.days[0].date, id: i.id, title: i.title, dest: i.preferences.destination, amount: itineraryTotal(i) })),
    ...s.inquiries.filter((q) => q.startDate >= today).map((q) => ({ kind: 'inquiry' as const, date: q.startDate, id: q.id, title: q.title, dest: '', amount: q.estimate })),
  ].sort((a, b) => a.date.localeCompare(b.date))

  const totals = s.itineraries.map((i) => ({ id: i.id, title: i.title, total: itineraryTotal(i), travelers: i.preferences.travelers }))
  const grand = totals.reduce((a, b) => a + b.total, 0)
  const max = Math.max(1, ...totals.map((t) => t.total))

  const savedDest = destinations.filter((d) => s.destinations.includes(d.slug))
  const savedStays = stays.filter((p) => s.stays.includes(p.slug))
  const savedExp = experiences.filter((e) => s.experiences.includes(e.slug))
  const counts = { destinations: savedDest.length, stays: savedStays.length, experiences: savedExp.length }

  return (
    <div className="max-w-7xl mx-auto px-5 md:px-8 pt-10 md:pt-16 pb-20">
      <h1 className="font-serif text-5xl md:text-7xl tracking-tight">My Trips</h1>
      <p className="mt-4 text-muted text-sm">Saved on this device only (browser storage). Nothing here is a confirmed booking.</p>

      {/* Upcoming + budget */}
      <section className="mt-12 grid lg:grid-cols-[1.4fr_1fr] gap-8">
        <div>
          <h2 className="font-serif text-2xl md:text-3xl mb-5">Upcoming</h2>
          {upcoming.length ? (
            <ul className="divide-y divide-line border-y border-line">
              {upcoming.map((u) => {
                const dest = getDestination(u.dest)
                const days = differenceInCalendarDays(parseISO(u.date), new Date())
                return (
                  <li key={u.kind + u.id} className="py-5 grid grid-cols-[64px_1fr_auto] gap-4 items-center">
                    <div className="text-center">
                      <p className="font-serif text-3xl leading-none">{format(parseISO(u.date), 'd')}</p>
                      <p className="text-xs text-muted mt-1">{format(parseISO(u.date), 'MMM yy')}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-muted">{u.kind === 'inquiry' ? 'Inquiry sent · awaiting host reply' : `Itinerary · ${dest?.name}`}</p>
                      <p className="font-serif text-xl leading-snug truncate">{u.title}</p>
                      <p className="text-xs text-muted mt-0.5">In {days} days · est. {money(u.amount)}</p>
                    </div>
                    {u.kind === 'itinerary' ? (
                      <Link to={`/plan?itinerary=${u.id}`} className="text-sm border-b border-gold pb-0.5 whitespace-nowrap">Open</Link>
                    ) : (
                      <button onClick={() => s.removeInquiry(u.id)} className="text-sm text-muted hover:text-ink whitespace-nowrap">Withdraw</button>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : (
            <EmptyState title="No upcoming trips yet" text="Save an itinerary from the planner or send a booking inquiry and it will appear here." action={<Link to="/plan" className="inline-flex h-11 px-5 rounded-full bg-ink text-ivory text-sm items-center">Plan a journey</Link>} />
          )}
        </div>
        <div className="bg-ink text-ivory rounded-3xl p-6 md:p-8 self-start">
          <p className="text-sm text-ivory/60">Trip budget overview</p>
          <p className="font-serif text-5xl mt-1 tabular-nums">{money(grand)}</p>
          <p className="text-xs text-ivory/50 mt-1">Across {totals.length} saved itinerar{totals.length === 1 ? 'y' : 'ies'} · excludes flights</p>
          <ul className="mt-6 space-y-4">
            {totals.map((t) => (
              <li key={t.id}>
                <div className="flex justify-between text-sm gap-3"><span className="truncate">{t.title}</span><span className="tabular-nums shrink-0">{money(t.total)}</span></div>
                <div className="mt-2 h-1.5 rounded-full bg-ivory/10"><div className="h-full rounded-full bg-gold" style={{ width: `${(t.total / max) * 100}%` }} /></div>
                <p className="text-xs text-ivory/50 mt-1">{money(t.total / t.travelers)} per person</p>
              </li>
            ))}
          </ul>
          {s.inquiries.length > 0 && <p className="mt-6 pt-4 border-t border-ivory/10 text-xs text-ivory/60">{s.inquiries.length} inquiry estimate{s.inquiries.length > 1 ? 's' : ''} totalling {money(s.inquiries.reduce((a, b) => a + b.estimate, 0))} not included above.</p>}
        </div>
      </section>

      {/* Saved itineraries */}
      <section className="mt-20">
        <h2 className="font-serif text-2xl md:text-3xl mb-5">Saved itineraries</h2>
        {s.itineraries.length ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {s.itineraries.map((i) => {
              const d = getDestination(i.preferences.destination)!
              return (
                <article key={i.id} className="flex flex-col border border-line rounded-2xl overflow-hidden">
                  <img src={d.image} alt="" className="aspect-[16/9] object-cover w-full" />
                  <div className="p-5 flex flex-col flex-1">
                    <p className="text-xs text-muted">{d.name} · {i.days.length} days · {i.preferences.pace} pace</p>
                    <p className="font-serif text-xl mt-1 leading-snug">{i.title}</p>
                    <p className="text-sm mt-2">{money(itineraryTotal(i))} <span className="text-muted">est. total</span></p>
                    <div className="mt-auto pt-5 flex items-center gap-2">
                      <Link to={`/plan?itinerary=${i.id}`} className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-ink text-ivory text-sm">Open & edit <ArrowRight className="w-4 h-4" /></Link>
                      <button onClick={() => s.removeItinerary(i.id)} aria-label={`Delete ${i.title}`} className="w-10 h-10 rounded-full flex items-center justify-center text-muted hover:text-ink hover:bg-paper transition-colors duration-150"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <div>
            <p className="text-sm text-muted mb-4">Nothing saved yet. Start from a sample:</p>
            <div className="grid sm:grid-cols-3 gap-4">
              {sampleItineraries.map((i) => (
                <Link key={i.id} to={`/plan?sample=${i.id}`} className="group border border-line rounded-2xl p-5 hover:border-ink transition-colors duration-150">
                  <p className="text-xs text-muted">{getDestination(i.preferences.destination)?.name} · {i.days.length} days</p>
                  <p className="font-serif text-lg mt-1">{i.title}</p>
                  <p className="text-sm text-sage mt-3 inline-flex items-center gap-1">Open sample <ArrowRight className="w-4 h-4" /></p>
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Inquiries */}
      {s.inquiries.length > 0 && (
        <section className="mt-20">
          <h2 className="font-serif text-2xl md:text-3xl mb-5">Booking inquiries</h2>
          <ul className="divide-y divide-line border-y border-line">
            {s.inquiries.map((q) => (
              <li key={q.id} className="py-4 flex items-center gap-4">
                <Mail className="w-5 h-5 text-gold-deep shrink-0" />
                <div className="flex-1 min-w-0">
                  <Link to={`/${q.kind === 'stay' ? 'stays' : 'experiences'}/${q.slug}`} className="font-medium hover:text-sage">{q.title}</Link>
                  <p className="text-xs text-muted">{format(parseISO(q.startDate), 'd MMM yyyy')}{q.endDate ? ` – ${format(parseISO(q.endDate), 'd MMM yyyy')}` : ''} · {q.travelers} traveller{q.travelers > 1 ? 's' : ''} · est. {money(q.estimate)} · Not confirmed</p>
                </div>
                <button onClick={() => s.removeInquiry(q.id)} className="text-sm text-muted hover:text-ink">Withdraw</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Saved items */}
      <section className="mt-20">
        <div className="flex items-center gap-6 border-b border-line mb-8 overflow-x-auto no-scrollbar">
          {(['destinations', 'stays', 'experiences'] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`pb-3 -mb-px border-b-2 font-serif text-xl md:text-2xl capitalize whitespace-nowrap transition-colors duration-150 ${tab === t ? 'border-gold text-ink' : 'border-transparent text-muted hover:text-ink'}`}>
              Saved {t} <span className="text-sm font-sans text-muted">{counts[t]}</span>
            </button>
          ))}
        </div>
        {tab === 'destinations' && (savedDest.length ? <Grid>{savedDest.map((d) => <DestinationCard key={d.slug} destination={d} />)}</Grid> : <Empty kind="destinations" to="/destinations" />)}
        {tab === 'stays' && (savedStays.length ? <Grid>{savedStays.map((p) => <PropertyCard key={p.slug} property={p} />)}</Grid> : <Empty kind="stays" to="/stays" />)}
        {tab === 'experiences' && (savedExp.length ? <Grid>{savedExp.map((e) => <ExperienceCard key={e.slug} experience={e} />)}</Grid> : <Empty kind="experiences" to="/experiences" />)}
      </section>
    </div>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">{children}</div>
}

function Empty({ kind, to }: { kind: string; to: string }) {
  return <EmptyState title={`No saved ${kind}`} text="Tap the heart on any card to keep it here." action={<Link to={to} className="text-sm underline underline-offset-4">Browse {kind}</Link>} />
}

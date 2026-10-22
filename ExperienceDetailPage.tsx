import React, { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { addDays, format } from 'date-fns'
import { Clock, Gauge, Users, MapPin, ShieldCheck, Check } from 'lucide-react'
import { getExperience, experiences } from '../data/experiences'
import { getDestination } from '../data/destinations'
import { SaveButton } from '../components/SaveButton'
import { BookingInquiryModal } from '../components/BookingInquiryModal'
import { ExperienceCard } from '../components/ExperienceCard'
import { VerificationBadge, money } from '../components/ui'
import { NotFoundPage } from './NotFoundPage'

export function ExperienceDetailPage() {
  const { slug } = useParams()
  const e = getExperience(slug)
  const [open, setOpen] = useState(false)
  const [guests, setGuests] = useState(2)
  if (!e) return <NotFoundPage />
  const dest = getDestination(e.destination)!
  const related = experiences.filter((x) => x.slug !== e.slug && (x.destination === e.destination || x.activity === e.activity)).slice(0, 3)

  return (
    <div>
      <section className="max-w-7xl mx-auto px-5 md:px-8 pt-6 md:pt-10">
        <p className="text-sm text-muted mb-4">
          <Link to="/experiences" className="hover:text-ink">Experiences</Link> / <Link to={`/destinations/${dest.slug}`} className="hover:text-ink">{dest.name}</Link>
        </p>
        <div className="relative aspect-[4/3] md:aspect-[21/9] rounded-3xl overflow-hidden bg-sand">
          <img src={e.image} alt={e.title} className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute top-4 left-4"><VerificationBadge status={e.verification} onImage /></div>
          <div className="absolute top-4 right-4"><SaveButton kind="experiences" slug={e.slug} label={e.title} /></div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-5 md:px-8 mt-10 grid lg:grid-cols-[1fr_360px] gap-12 lg:gap-16 pb-20">
        <div>
          <p className="text-sm text-gold-deep">{e.category} · {e.activity} · {dest.name}</p>
          <h1 className="font-serif text-4xl md:text-6xl tracking-tight mt-2 leading-[1.05]">{e.title}</h1>
          <dl className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-6 border-y border-line py-6">
            <Stat icon={<Clock className="w-4 h-4" />} label="Duration" value={e.duration} />
            <Stat icon={<Gauge className="w-4 h-4" />} label="Difficulty" value={e.difficulty} />
            <Stat icon={<Users className="w-4 h-4" />} label="Group" value={e.groupSize} />
            <Stat icon={<MapPin className="w-4 h-4" />} label="Where" value={dest.name} />
          </dl>

          <section className="mt-10">
            <p className="font-serif text-2xl leading-snug">{e.summary}</p>
            {e.description.map((t, i) => <p key={i} className="mt-4 text-muted leading-relaxed">{t}</p>)}
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-2xl md:text-3xl mb-6">How the day unfolds</h2>
            <ol className="relative border-l border-line ml-2">
              {e.itinerary.map((s, i) => (
                <li key={i} className="pl-8 pb-7 last:pb-0 relative">
                  <span className="absolute -left-[5px] top-1.5 w-[9px] h-[9px] rounded-full bg-gold" />
                  <p className="text-xs text-muted tabular-nums">{s.time}</p>
                  <p className="mt-1">{s.step}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="mt-14 grid md:grid-cols-[120px_1fr] gap-6 bg-paper rounded-3xl p-6 md:p-8">
            <div className="w-20 h-20 md:w-28 md:h-28 rounded-full bg-sage text-ivory font-serif text-3xl flex items-center justify-center">
              {e.host.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
            </div>
            <div>
              <p className="text-xs text-muted">Your host</p>
              <p className="font-serif text-2xl mt-1">{e.host.name}</p>
              <p className="text-sm text-sage">{e.host.role} · {e.host.years} years</p>
              <p className="mt-3 text-muted leading-relaxed text-sm">{e.host.bio}</p>
            </div>
          </section>

          <section className="mt-14 grid md:grid-cols-2 gap-10">
            <div>
              <h2 className="font-serif text-2xl mb-4">Meeting point</h2>
              <p className="flex gap-2 text-sm leading-relaxed"><MapPin className="w-4 h-4 mt-0.5 text-gold-deep shrink-0" />{e.meetingPoint}</p>
              <h3 className="font-serif text-xl mt-8 mb-3">What’s included</h3>
              <ul className="space-y-2">{e.included.map((x) => <li key={x} className="text-sm flex gap-2"><Check className="w-4 h-4 text-sage mt-0.5" />{x}</li>)}</ul>
            </div>
            <div>
              <h2 className="font-serif text-2xl mb-4">Safety</h2>
              <ul className="space-y-3">{e.safety.map((x) => <li key={x} className="text-sm flex gap-2 leading-relaxed"><ShieldCheck className="w-4 h-4 text-sage mt-0.5 shrink-0" />{x}</li>)}</ul>
              <Link to={`/culture/${dest.slug}`} className="mt-6 inline-block text-sm border-b border-gold pb-0.5">Culture Context for {dest.name}</Link>
            </div>
          </section>
        </div>

        <aside className="lg:sticky lg:top-28 self-start order-first lg:order-none">
          <div className="border border-line rounded-3xl p-6 shadow-[0_20px_50px_-30px_rgba(32,40,36,0.35)]">
            <p><span className="font-serif text-3xl">{money(e.price)}</span> <span className="text-sm text-muted">per person</span></p>
            <div className="mt-5 flex items-center justify-between border-y border-line py-4">
              <span className="text-sm">Guests</span>
              <div className="flex items-center gap-4">
                <button onClick={() => setGuests(Math.max(1, guests - 1))} aria-label="Fewer guests" className="w-8 h-8 rounded-full border border-line">−</button>
                <span className="w-4 text-center tabular-nums">{guests}</span>
                <button onClick={() => setGuests(Math.min(10, guests + 1))} aria-label="More guests" className="w-8 h-8 rounded-full border border-line">+</button>
              </div>
            </div>
            <div className="mt-4 flex justify-between text-sm font-medium"><span>Estimated total</span><span className="tabular-nums">{money(e.price * guests)}</span></div>
            <button onClick={() => setOpen(true)} className="mt-5 w-full h-12 rounded-full bg-ink text-ivory text-sm hover:bg-ink-soft transition-colors duration-150">Request to book</button>
            <Link to={`/plan?destination=${dest.slug}`} className="mt-3 w-full h-12 rounded-full border border-line text-sm flex items-center justify-center hover:border-ink transition-colors duration-150">Add to a trip plan</Link>
            <p className="mt-3 text-xs text-muted text-center">Inquiry only — the host confirms availability.</p>
          </div>
        </aside>
      </div>

      {related.length > 0 && (
        <section className="bg-paper">
          <div className="max-w-7xl mx-auto px-5 md:px-8 py-16">
            <h2 className="font-serif text-3xl mb-8">You might also like</h2>
            <div className="grid sm:grid-cols-3 gap-6">{related.map((x) => <ExperienceCard key={x.slug} experience={x} />)}</div>
          </div>
        </section>
      )}

      <BookingInquiryModal
        open={open}
        onClose={() => setOpen(false)}
        kind="experience"
        slug={e.slug}
        title={e.title}
        subtitle={`Hosted by ${e.host.name} · ${e.duration}`}
        startDate={format(addDays(new Date(), 30), 'yyyy-MM-dd')}
        travelers={guests}
        estimate={(_s, _e, g) => e.price * g}
      />
    </div>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs text-muted">{icon}{label}</dt>
      <dd className="mt-1 text-sm">{value}</dd>
    </div>
  )
}

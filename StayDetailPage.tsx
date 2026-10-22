import React, { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { addDays, differenceInCalendarDays, format, parseISO, isValid } from 'date-fns'
import { Star, MapPin, Minus, Plus, Check, Clock } from 'lucide-react'
import { getStay } from '../data/stays'
import { getDestination } from '../data/destinations'
import { experiences } from '../data/experiences'
import { osmEmbed } from '../data/geo'
import { ImageGallery } from '../components/ImageGallery'
import { SaveButton } from '../components/SaveButton'
import { BookingInquiryModal } from '../components/BookingInquiryModal'
import { ExperienceCard } from '../components/ExperienceCard'
import { VerificationBadge, money } from '../components/ui'
import { NotFoundPage } from './NotFoundPage'

const TAX_RATE = 0.12

export function StayDetailPage() {
  const { slug } = useParams()
  const p = getStay(slug)
  const base = addDays(new Date(), 30)
  const [start, setStart] = useState(format(base, 'yyyy-MM-dd'))
  const [end, setEnd] = useState(format(addDays(base, 4), 'yyyy-MM-dd'))
  const [guests, setGuests] = useState(2)
  const [roomIdx, setRoomIdx] = useState(0)
  const [inquiry, setInquiry] = useState(false)
  if (!p) return <NotFoundPage />

  const dest = getDestination(p.destination)!
  const room = p.rooms[roomIdx]
  const calc = (s: string, e: string | undefined, g: number) => {
    const a = parseISO(s), b = parseISO(e ?? '')
    const n = isValid(a) && isValid(b) ? Math.max(0, differenceInCalendarDays(b, a)) : 0
    const roomsNeeded = Math.ceil(g / room.sleeps)
    const sub = n * room.price * roomsNeeded
    return { nights: n, roomsNeeded, sub, tax: Math.round(sub * TAX_RATE), total: Math.round(sub * (1 + TAX_RATE)) }
  }
  const c = calc(start, end, guests)
  const nearby = experiences.filter((e) => e.destination === p.destination).slice(0, 3)

  return (
    <div className="max-w-7xl mx-auto px-5 md:px-8 pt-6 md:pt-10 pb-20">
      <p className="text-sm text-muted mb-4">
        <Link to="/stays" className="hover:text-ink">Stays</Link> / <Link to={`/destinations/${dest.slug}`} className="hover:text-ink">{dest.name}</Link>
      </p>
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <div className="flex flex-wrap items-center gap-2"><VerificationBadge status={p.verification} /><span className="text-xs text-muted">{p.type}</span></div>
          <h1 className="font-serif text-4xl md:text-6xl tracking-tight mt-3">{p.name}</h1>
          <p className="mt-2 text-sm text-muted flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="flex items-center gap-1 text-ink"><Star className="w-4 h-4 fill-gold text-gold" />{p.rating} <span className="text-muted">· {p.reviews} sample reviews</span></span>
            <span className="flex items-center gap-1"><MapPin className="w-4 h-4" />{dest.name}, {dest.country}</span>
          </p>
        </div>
        <SaveButton kind="stays" slug={p.slug} label={p.name} variant="inline" />
      </div>

      <ImageGallery images={p.images} alt={p.name} />

      <div className="mt-12 grid lg:grid-cols-[1fr_380px] gap-12 lg:gap-16">
        <div>
          <section>
            <p className="font-serif text-2xl md:text-3xl leading-snug">{p.summary}</p>
            {p.description.map((t, i) => <p key={i} className="mt-4 text-muted leading-relaxed">{t}</p>)}
            <ul className="mt-6 flex flex-wrap gap-x-8 gap-y-2">
              {p.highlights.map((h) => <li key={h} className="flex items-center gap-2 text-sm"><Check className="w-4 h-4 text-sage" />{h}</li>)}
            </ul>
            <p className="mt-6 text-sm text-muted flex items-center gap-2"><Clock className="w-4 h-4" />Check-in from {p.checkIn} · Check-out by {p.checkOut}</p>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-2xl md:text-3xl mb-5">Room options</h2>
            <div className="divide-y divide-line border-y border-line" role="radiogroup" aria-label="Room options">
              {p.rooms.map((r, i) => (
                <button
                  key={r.name}
                  role="radio"
                  aria-checked={roomIdx === i}
                  onClick={() => setRoomIdx(i)}
                  className="w-full grid grid-cols-[24px_1fr_auto] gap-4 items-center py-5 text-left"
                >
                  <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${roomIdx === i ? 'border-ink' : 'border-line'}`}>
                    {roomIdx === i && <span className="w-2.5 h-2.5 rounded-full bg-ink" />}
                  </span>
                  <span>
                    <span className="block font-medium">{r.name}</span>
                    <span className="block text-sm text-muted mt-0.5">Sleeps {r.sleeps} · {r.size} · {r.note}</span>
                  </span>
                  <span className="text-right whitespace-nowrap"><span className="font-medium">{money(r.price)}</span><span className="block text-xs text-muted">per night</span></span>
                </button>
              ))}
            </div>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-2xl md:text-3xl mb-5">Amenities</h2>
            <ul className="grid grid-cols-2 sm:grid-cols-3 gap-y-3 gap-x-6">
              {p.amenities.map((a) => <li key={a} className="text-sm flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-gold" />{a}</li>)}
            </ul>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-2xl md:text-3xl mb-2">Location</h2>
            <p className="text-sm text-muted mb-5">{p.location}</p>
            <div className="rounded-2xl overflow-hidden border border-line aspect-[16/9] bg-paper">
              <iframe title={`Map near ${p.name}`} src={osmEmbed(p.destination, 0.6)} className="w-full h-full border-0" loading="lazy" />
            </div>
            <p className="text-xs text-muted mt-2">Map shows the neighbourhood. Exact address is shared by the host after inquiry.</p>
          </section>

          {nearby.length > 0 && (
            <section className="mt-14">
              <h2 className="font-serif text-2xl md:text-3xl mb-6">Nearby experiences</h2>
              <div className="grid sm:grid-cols-3 gap-6">{nearby.map((e) => <ExperienceCard key={e.slug} experience={e} />)}</div>
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-28 self-start order-first lg:order-none">
          <div className="border border-line rounded-3xl p-6 bg-ivory shadow-[0_20px_50px_-30px_rgba(32,40,36,0.35)]">
            <p><span className="font-serif text-3xl">{money(room.price)}</span> <span className="text-sm text-muted">/ night · {room.name}</span></p>
            <div className="mt-5 grid grid-cols-2 border border-line rounded-xl overflow-hidden">
              <label className="px-4 py-3 border-r border-line">
                <span className="block text-xs text-muted">Arrive</span>
                <input type="date" value={start} onChange={(e) => { setStart(e.target.value); if (end <= e.target.value) setEnd(format(addDays(parseISO(e.target.value), 1), 'yyyy-MM-dd')) }} className="w-full bg-transparent outline-none text-sm" />
              </label>
              <label className="px-4 py-3">
                <span className="block text-xs text-muted">Depart</span>
                <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className="w-full bg-transparent outline-none text-sm" />
              </label>
              <div className="col-span-2 border-t border-line px-4 py-3 flex items-center justify-between">
                <span className="text-sm">Travellers</span>
                <div className="flex items-center gap-4">
                  <button onClick={() => setGuests(Math.max(1, guests - 1))} aria-label="Fewer travellers" className="w-8 h-8 rounded-full border border-line flex items-center justify-center"><Minus className="w-3.5 h-3.5" /></button>
                  <span className="w-4 text-center tabular-nums">{guests}</span>
                  <button onClick={() => setGuests(Math.min(12, guests + 1))} aria-label="More travellers" className="w-8 h-8 rounded-full border border-line flex items-center justify-center"><Plus className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            </div>
            <dl className="mt-5 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted">{money(room.price)} × {c.nights} night{c.nights === 1 ? '' : 's'}{c.roomsNeeded > 1 ? ` × ${c.roomsNeeded} rooms` : ''}</dt><dd className="tabular-nums">{money(c.sub)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Est. taxes & fees (12%)</dt><dd className="tabular-nums">{money(c.tax)}</dd></div>
              <div className="flex justify-between pt-3 border-t border-line font-medium"><dt>Estimated total</dt><dd className="tabular-nums">{money(c.total)}</dd></div>
            </dl>
            <button onClick={() => setInquiry(true)} disabled={c.nights === 0} className="mt-5 w-full h-12 rounded-full bg-ink text-ivory text-sm hover:bg-ink-soft disabled:opacity-50 transition-colors duration-150">Send booking inquiry</button>
            <p className="mt-3 text-xs text-muted text-center">Sample rates. Inquiry only — no payment or reservation.</p>
          </div>
        </aside>
      </div>

      <BookingInquiryModal
        open={inquiry}
        onClose={() => setInquiry(false)}
        kind="stay"
        slug={p.slug}
        title={p.name}
        subtitle={`${room.name} · ${dest.name}`}
        startDate={start}
        endDate={end}
        travelers={guests}
        estimate={(s, e, g) => calc(s, e, g).total}
      />
    </div>
  )
}

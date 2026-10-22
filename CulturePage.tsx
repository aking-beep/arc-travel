import React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { getCulture } from '../data/culture'
import { destinations, getDestination } from '../data/destinations'
import { experiences } from '../data/experiences'
import { KnowBeforeYouGo } from '../components/KnowBeforeYouGo'
import { NotFoundPage } from './NotFoundPage'

export function CulturePage() {
  const { destination } = useParams()
  const navigate = useNavigate()
  const guide = getCulture(destination)
  const dest = getDestination(destination)
  if (!guide || !dest) return <NotFoundPage />
  const communityExp = experiences.filter((e) => e.destination === dest.slug && (e.category === 'Culture' || e.category === 'Food'))

  return (
    <div>
      <section className="bg-sage text-ivory">
        <div className="max-w-7xl mx-auto px-5 md:px-8 pt-12 md:pt-20 pb-14 md:pb-20 grid lg:grid-cols-[1.4fr_1fr] gap-10 items-end">
          <div>
            <div className="flex items-center gap-3 text-sm text-ivory/70">
              <span>Culture Context</span>
              <select
                value={dest.slug}
                onChange={(e) => navigate(`/culture/${e.target.value}`)}
                className="bg-transparent border border-ivory/30 rounded-full px-3 h-9 text-ivory text-sm"
                aria-label="Choose destination"
              >
                {destinations.map((d) => <option key={d.slug} value={d.slug} className="text-ink">{d.name}</option>)}
              </select>
            </div>
            <h1 className="font-serif text-5xl md:text-7xl tracking-tight mt-5 leading-[1]">Know {dest.name}<br /><em className="text-gold">before you go.</em></h1>
            <p className="mt-6 text-ivory/80 max-w-xl leading-relaxed">{guide.intro}</p>
          </div>
          <img src={dest.image} alt="" className="hidden lg:block w-full aspect-[4/3] object-cover rounded-3xl" />
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-5 md:px-8 py-16 md:py-24 grid lg:grid-cols-[1fr_400px] gap-14 lg:gap-20">
        <div className="space-y-16">
          <Block title="Cultural etiquette">
            <div className="grid sm:grid-cols-2 gap-x-10 gap-y-6">
              {guide.etiquette.map((e) => (
                <div key={e.title} className="border-t border-line pt-4">
                  <p className="font-serif text-xl">{e.title}</p>
                  <p className="text-sm text-muted mt-2 leading-relaxed">{e.text}</p>
                </div>
              ))}
            </div>
          </Block>

          <Block title="Local traditions">
            <div className="space-y-5">
              {guide.traditions.map((t) => (
                <div key={t.title} className="grid md:grid-cols-[200px_1fr] gap-2 md:gap-8">
                  <p className="font-serif text-xl">{t.title}</p>
                  <p className="text-sm text-muted leading-relaxed">{t.text}</p>
                </div>
              ))}
            </div>
          </Block>

          <Block title="Language essentials">
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-px bg-line border border-line rounded-2xl overflow-hidden">
              {guide.language.map((l) => (
                <div key={l.phrase} className="bg-ivory p-5">
                  <p className="font-serif text-xl italic">{l.phrase}</p>
                  <p className="text-sm mt-1">{l.meaning}</p>
                  <p className="text-xs text-gold-deep mt-2">{l.say}</p>
                </div>
              ))}
            </div>
          </Block>

          <Block title="Local customs">
            <ul className="space-y-3">{guide.customs.map((c) => <li key={c} className="text-sm leading-relaxed pl-4 border-l-2 border-gold">{c}</li>)}</ul>
          </Block>

          <div className="grid md:grid-cols-2 gap-12">
            <Block title="Responsible tourism">
              <ul className="space-y-3">{guide.responsible.map((c) => <li key={c} className="text-sm leading-relaxed text-muted">— {c}</li>)}</ul>
            </Block>
            <Block title="Safety">
              <ul className="space-y-3">{guide.safety.map((c) => <li key={c} className="text-sm leading-relaxed text-muted">— {c}</li>)}</ul>
            </Block>
          </div>

          <Block title="Seasonal considerations">
            <ol className="grid md:grid-cols-3 gap-6">
              {guide.seasons.map((s) => (
                <li key={s.months} className="border-t-2 border-sage pt-4">
                  <p className="text-xs text-muted">{s.months}</p>
                  <p className="font-serif text-xl mt-1">{s.label}</p>
                  <p className="text-sm text-muted mt-2 leading-relaxed">{s.text}</p>
                </li>
              ))}
            </ol>
          </Block>

          <Block title="Community experiences">
            <ul className="space-y-2 mb-6">{guide.community.map((c) => <li key={c} className="text-sm">{c}</li>)}</ul>
            {communityExp.length > 0 && (
              <div className="divide-y divide-line border-y border-line">
                {communityExp.map((e) => (
                  <Link key={e.slug} to={`/experiences/${e.slug}`} className="flex items-center gap-4 py-4 group">
                    <img src={e.image} alt="" className="w-16 h-16 rounded-xl object-cover" />
                    <span className="flex-1">
                      <span className="block font-serif text-lg group-hover:text-sage transition-colors duration-150">{e.title}</span>
                      <span className="block text-xs text-muted">Hosted by {e.host.name} · ${e.price}</span>
                    </span>
                    <ArrowRight className="w-4 h-4 text-muted" />
                  </Link>
                ))}
              </div>
            )}
          </Block>
        </div>

        <aside className="lg:sticky lg:top-28 self-start">
          <KnowBeforeYouGo guide={guide} name={dest.name} />
          <Link to={`/plan?destination=${dest.slug}`} className="mt-6 flex items-center justify-between gap-3 border border-line rounded-2xl p-5 hover:border-ink transition-colors duration-150">
            <span><span className="block text-xs text-muted">Ready?</span><span className="block font-serif text-lg">Plan a trip to {dest.name}</span></span>
            <ArrowRight className="w-5 h-5" />
          </Link>
        </aside>
      </div>
    </div>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-serif text-3xl mb-6">{title}</h2>
      {children}
    </section>
  )
}

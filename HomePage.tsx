import React from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { destinations, getDestination } from '../data/destinations'
import { stays } from '../data/stays'
import { experiences } from '../data/experiences'
import { articles } from '../data/articles'
import { getCulture } from '../data/culture'
import { sampleItineraries } from '../data/itineraries'
import { IMG } from '../data/images'
import { SearchBar } from '../components/SearchBar'
import { DestinationCard } from '../components/DestinationCard'
import { PropertyCard } from '../components/PropertyCard'
import { ExperienceCard } from '../components/ExperienceCard'
import { SectionHeading, money } from '../components/ui'
import { dayCost } from '../lib/planner'

export function HomePage() {
  const featured = destinations.filter((d) => d.featured)
  const [lead, ...rest] = featured
  const curatedStays = ['casa-la-punta', 'alfama-light-house', 'chalet-argentiere', 'ubud-sanctuary'].map((s) => stays.find((x) => x.slug === s)!)
  const featuredExp = ['la-punta-dawn-surf', 'oaxacan-kitchen-dona-rosa', 'gili-freediving'].map((s) => experiences.find((x) => x.slug === s)!)
  const culture = getCulture('puerto-escondido')!
  const sample = sampleItineraries[0]
  const sampleDay = sample.days[1]
  const [featuredArticle, ...moreArticles] = articles

  return (
    <div>
      {/* Hero */}
      <section className="relative h-[720px] md:h-[820px] w-full overflow-hidden bg-ink">
        <img src={IMG.puertoEscondido} alt="Golden hour at Zicatela, Puerto Escondido" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-ink/35" />
        <div className="relative h-full max-w-7xl mx-auto px-5 md:px-8 flex flex-col justify-end pb-10 md:pb-20">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}>
            <p className="text-ivory/85 text-sm mb-4">Now featuring · Puerto Escondido, Oaxaca</p>
            <h1 className="font-serif text-ivory text-5xl sm:text-6xl md:text-[88px] leading-[0.98] tracking-tight max-w-4xl">
              Go beyond<br className="hidden sm:block" /> the <em className="text-gold not-italic sm:italic">destination.</em>
            </h1>
            <p className="mt-6 text-ivory/85 text-base md:text-lg max-w-xl leading-relaxed">
              Boutique stays, local hosts and the cultural context to travel well — gathered into journeys built around how you like to move.
            </p>
          </motion.div>
          <div className="mt-10 md:mt-12">
            <SearchBar />
          </div>
        </div>
      </section>

      {/* Featured destinations */}
      <section className="max-w-7xl mx-auto px-5 md:px-8 pt-20 md:pt-28">
        <SectionHeading title="Places worth the long way round" kicker="Eight destinations we know deeply, each with stays, hosts and culture notes." action={{ to: '/destinations', label: 'All destinations' }} />
        <div className="grid lg:grid-cols-[1.25fr_1fr] gap-6 lg:gap-8">
          <DestinationCard destination={lead} size="wide" />
          <div className="flex lg:grid lg:grid-cols-2 gap-5 overflow-x-auto no-scrollbar snap-x snap-mandatory -mx-5 px-5 lg:mx-0 lg:px-0">
            {rest.slice(0, 4).map((d) => (
              <div key={d.slug} className="snap-start shrink-0 w-[70%] sm:w-[45%] lg:w-auto">
                <DestinationCard destination={d} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* AI planner CTA */}
      <section className="max-w-7xl mx-auto px-5 md:px-8 pt-20 md:pt-28">
        <div className="bg-ink text-ivory rounded-3xl overflow-hidden grid lg:grid-cols-2">
          <div className="p-8 md:p-14 flex flex-col">
            <h2 className="font-serif text-4xl md:text-5xl leading-[1.05]">Tell us how you travel.<br />We’ll draft the journey.</h2>
            <p className="mt-5 text-ivory/75 max-w-md leading-relaxed">
              Choose a destination, pace and budget. The planner assembles a day-by-day draft with stays, hosted experiences and honest cost estimates — then hands you the pen.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/plan" className="inline-flex items-center gap-2 h-12 px-6 rounded-full bg-gold text-ink text-sm font-medium hover:bg-gold-hover transition-colors duration-150">
                Plan my journey <ArrowRight className="w-4 h-4" />
              </Link>
              <Link to={`/plan?sample=${sample.id}`} className="inline-flex items-center h-12 px-6 rounded-full border border-ivory/30 text-sm hover:border-ivory transition-colors duration-150">
                Open a sample itinerary
              </Link>
            </div>
            <p className="mt-auto pt-10 text-xs text-ivory/50">Prototype: drafts come from a rules-based sample planner, not a live AI model.</p>
          </div>
          <div className="bg-ink-soft p-6 md:p-10">
            <div className="bg-ivory text-ink rounded-2xl p-6">
              <div className="flex items-baseline justify-between">
                <p className="font-serif text-xl">Day {sampleDay.day} · {sampleDay.theme}</p>
                <p className="text-xs text-muted">{getDestination(sample.preferences.destination)?.name}</p>
              </div>
              <ol className="mt-5 space-y-4">
                {sampleDay.activities.map((a) => (
                  <li key={a.id} className="grid grid-cols-[80px_1fr_auto] gap-3 text-sm">
                    <span className="text-muted">{a.time}</span>
                    <span>{a.title}</span>
                    <span className="text-muted tabular-nums">{a.cost ? money(a.cost) : '—'}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-5 pt-4 border-t border-line flex justify-between text-sm">
                <span className="text-muted">Est. day for {sample.preferences.travelers}, incl. stay</span>
                <span className="font-medium tabular-nums">{money(dayCost(sampleDay, sample.preferences.travelers).total)}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Curated stays */}
      <section className="max-w-7xl mx-auto px-5 md:px-8 pt-20 md:pt-28">
        <SectionHeading title="Curated stays" kicker="Small, characterful places — surf lodges, river-view rooms, fireside chalets." action={{ to: '/stays', label: 'Browse stays' }} />
        <div className="flex md:grid md:grid-cols-2 lg:grid-cols-4 gap-6 overflow-x-auto no-scrollbar snap-x snap-mandatory -mx-5 px-5 md:mx-0 md:px-0">
          {curatedStays.map((p) => (
            <div key={p.slug} className="snap-start shrink-0 w-[78%] sm:w-[46%] md:w-auto">
              <PropertyCard property={p} />
            </div>
          ))}
        </div>
      </section>

      {/* Experiences */}
      <section className="max-w-7xl mx-auto px-5 md:px-8 pt-20 md:pt-28">
        <SectionHeading title="Hosted by people who live there" kicker="Surf coaches, home cooks, mountain guides and cooperatives." action={{ to: '/experiences', label: 'All experiences' }} />
        <div className="flex md:grid md:grid-cols-3 gap-6 overflow-x-auto no-scrollbar snap-x snap-mandatory -mx-5 px-5 md:mx-0 md:px-0">
          {featuredExp.map((e) => (
            <div key={e.slug} className="snap-start shrink-0 w-[78%] sm:w-[46%] md:w-auto">
              <ExperienceCard experience={e} />
            </div>
          ))}
        </div>
      </section>

      {/* Culture Context preview */}
      <section className="mt-20 md:mt-28 bg-paper">
        <div className="max-w-7xl mx-auto px-5 md:px-8 py-20 md:py-24 grid lg:grid-cols-[1fr_1.2fr] gap-12 lg:gap-20">
          <div>
            <p className="text-sm text-sage font-medium">Culture Context</p>
            <h2 className="font-serif text-4xl md:text-5xl leading-[1.05] mt-3">Arrive as a guest, not a spectator.</h2>
            <p className="mt-5 text-muted leading-relaxed max-w-md">Etiquette, language, seasons and responsible-travel notes for every destination — plus a Know Before You Go assistant for the questions you’d feel awkward asking.</p>
            <Link to="/culture/puerto-escondido" className="mt-8 inline-flex items-center gap-2 h-12 px-6 rounded-full bg-sage text-ivory text-sm hover:bg-sage-deep transition-colors duration-150">
              Read the Puerto Escondido guide <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-10 gap-y-8">
            {culture.etiquette.slice(0, 2).map((e) => (
              <div key={e.title} className="border-t border-line pt-5">
                <p className="font-serif text-xl">{e.title}</p>
                <p className="mt-2 text-sm text-muted leading-relaxed">{e.text}</p>
              </div>
            ))}
            <div className="sm:col-span-2 border-t border-line pt-5">
              <p className="text-sm font-medium mb-4">Five words to land with</p>
              <div className="flex flex-wrap gap-x-8 gap-y-4">
                {culture.language.slice(0, 5).map((l) => (
                  <div key={l.phrase}>
                    <p className="font-serif text-lg italic">{l.phrase}</p>
                    <p className="text-xs text-muted">{l.meaning}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Journal */}
      <section className="max-w-7xl mx-auto px-5 md:px-8 py-20 md:py-28">
        <SectionHeading title="From the Journal" action={{ to: '/journal', label: 'Read the Journal' }} />
        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-10">
          <Link to={`/journal/${featuredArticle.slug}`} className="group block">
            <div className="aspect-[16/10] overflow-hidden rounded-2xl bg-sand">
              <img src={featuredArticle.image} alt="" className="w-full h-full object-cover transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-[1.03]" />
            </div>
            <p className="mt-5 text-xs text-gold-deep">{featuredArticle.category} · {featuredArticle.readMinutes} min read</p>
            <h3 className="font-serif text-3xl md:text-4xl mt-2 leading-tight group-hover:text-sage transition-colors duration-150">{featuredArticle.title}</h3>
            <p className="mt-3 text-muted leading-relaxed max-w-xl">{featuredArticle.dek}</p>
          </Link>
          <ul className="divide-y divide-line border-t border-line">
            {moreArticles.slice(0, 4).map((a) => (
              <li key={a.slug}>
                <Link to={`/journal/${a.slug}`} className="group flex gap-5 py-5">
                  <img src={a.image} alt="" className="w-24 h-24 md:w-28 md:h-28 object-cover rounded-xl shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs text-gold-deep">{a.category}</p>
                    <p className="font-serif text-lg md:text-xl leading-snug mt-1 group-hover:text-sage transition-colors duration-150">{a.title}</p>
                    <p className="text-xs text-muted mt-2 flex items-center gap-1">{a.readMinutes} min read <ArrowUpRight className="w-3 h-3" /></p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  )
}

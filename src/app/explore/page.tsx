import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { DemoFigure, Money } from '@/components/money'
import {
  Band,
  IllustrativeNote,
  SectionHeading,
  Shell,
} from '@/components/explore/editorial'
import { DestinationCard, ExperienceCard, PropertyCard } from '@/components/explore/cards'
import { SearchBar } from '@/components/explore/search-bar'
import { getTranslator } from '@/lib/i18n/server'
import { articles } from '@/modules/discovery/content/articles'
import { getCulture } from '@/modules/discovery/content/culture'
import { destinations } from '@/modules/discovery/content/destinations'
import { experiences } from '@/modules/discovery/content/experiences'
import { sampleItineraries } from '@/modules/discovery/content/itineraries'
import { stays } from '@/modules/discovery/content/stays'
import { CONTENT_CURRENCY } from '@/modules/discovery/content/types'
import { dayCost } from '@/modules/discovery/planner'

/**
 * The public home page, ported from the export's `HomePage`.
 *
 * A Server Component: everything on it is content, and the only interactive
 * parts — the search bar, the save buttons inside the cards — are client
 * islands of their own. The export's entrance animation is gone with
 * framer-motion; the hero is static, which is what it looked like after
 * 300ms anyway.
 */
export default async function ExploreHomePage() {
  const { t, locale } = await getTranslator()

  const featured = destinations.filter((d) => d.featured)
  const [lead, ...rest] = featured

  const curatedStays = ['casa-la-punta', 'alfama-light-house', 'chalet-argentiere', 'ubud-sanctuary']
    .map((slug) => stays.find((s) => s.slug === slug))
    .filter((s): s is NonNullable<typeof s> => s !== undefined)

  const featuredExperiences = [
    'la-punta-dawn-surf',
    'oaxacan-kitchen-dona-rosa',
    'gili-freediving',
  ]
    .map((slug) => experiences.find((e) => e.slug === slug))
    .filter((e): e is NonNullable<typeof e> => e !== undefined)

  const culture = getCulture('puerto-escondido')
  const sample = sampleItineraries[0]
  const sampleDay = sample?.days[1]
  const [featuredArticle, ...moreArticles] = articles
  const heroImage = lead?.image

  return (
    <div>
      {/* Hero */}
      <section className="bg-ink relative h-[720px] w-full overflow-hidden md:h-[820px]">
        {heroImage ? (
          <Image
            src={heroImage}
            alt="Golden hour on the Oaxaca coast"
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
        ) : null}
        <div className="bg-ink/35 absolute inset-0" />
        <Shell className="relative flex h-full flex-col justify-end pb-10 md:pb-20">
          <div>
            <p className="text-ivory/85 mb-4 text-sm">{t('explore.hero.kicker')}</p>
            <h1 className="text-ivory max-w-4xl text-5xl leading-[0.98] tracking-tight sm:text-6xl md:text-[88px]">
              {t('explore.hero.title')}
            </h1>
            <p className="text-ivory/85 mt-6 max-w-xl text-base leading-relaxed md:text-lg">
              {t('explore.hero.lede')}
            </p>
            <p className="text-ivory/60 mt-4 max-w-xl text-xs leading-relaxed">
              {t('explore.hero.demoNote')}
            </p>
          </div>
          <div className="mt-10 md:mt-12">
            <SearchBar locale={locale} />
          </div>
        </Shell>
      </section>

      {/* Destinations */}
      <Shell className="pt-20 md:pt-28">
        <SectionHeading
          title="Places worth the long way round"
          kicker={`${featured.length} destinations, each with stays, hosts and culture notes.`}
          action={{ href: '/explore/destinations', label: t('explore.nav.home') }}
        />
        <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr] lg:gap-8">
          {lead ? <DestinationCard destination={lead} locale={locale} size="wide" /> : null}
          <div className="no-scrollbar -mx-5 flex snap-x snap-mandatory gap-5 overflow-x-auto px-5 lg:mx-0 lg:grid lg:grid-cols-2 lg:px-0">
            {rest.slice(0, 4).map((d) => (
              <div key={d.slug} className="w-[70%] shrink-0 snap-start sm:w-[45%] lg:w-auto">
                <DestinationCard destination={d} locale={locale} />
              </div>
            ))}
          </div>
        </div>
      </Shell>

      {/* Planner */}
      <Shell className="pt-20 md:pt-28">
        <div className="bg-ink text-ivory grid overflow-hidden rounded-3xl lg:grid-cols-2">
          <div className="flex flex-col p-8 md:p-14">
            <h2 className="text-4xl leading-[1.05] md:text-5xl">{t('explore.home.planHeading')}</h2>
            <p className="text-ivory/75 mt-5 max-w-md leading-relaxed">
              {t('explore.home.planLede')}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/explore/plan"
                className="bg-gold text-ink hover:bg-gold-hover inline-flex h-12 items-center gap-2 rounded-full px-6 text-sm font-medium transition-colors duration-150"
              >
                {t('explore.home.planCta')} <ArrowRight className="size-4" aria-hidden />
              </Link>
              {sample ? (
                <Link
                  href={`/explore/plan?sample=${sample.id}`}
                  className="border-ivory/30 hover:border-ivory inline-flex h-12 items-center rounded-full border px-6 text-sm transition-colors duration-150"
                >
                  Open a sample itinerary
                </Link>
              ) : null}
            </div>
            <p className="text-ivory/50 mt-auto pt-10 text-xs">
              {t('explore.plan.step3Heading')}. {t('explore.plan.step3Body')}
            </p>
          </div>

          {sample && sampleDay ? (
            <div className="bg-ink-soft p-6 md:p-10">
              <div className="bg-ivory text-ink rounded-2xl p-6">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-xl">
                    Day {sampleDay.day} · {sampleDay.theme}
                  </p>
                  <p className="text-muted text-xs">{sample.title}</p>
                </div>
                <ol className="mt-5 space-y-4">
                  {sampleDay.activities.map((activity) => (
                    <li
                      key={activity.id}
                      className="grid grid-cols-[80px_1fr_auto] gap-3 text-sm"
                    >
                      <span className="text-muted">{activity.time}</span>
                      <span>{activity.title}</span>
                      <span className="text-muted">
                        {activity.costMinor > 0 ? (
                          <Money
                            amountMinor={activity.costMinor}
                            currency={CONTENT_CURRENCY}
                            locale={locale}
                            intent="potential"
                          />
                        ) : (
                          '—'
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
                <div className="border-line mt-5 flex items-baseline justify-between gap-3 border-t pt-4 text-sm">
                  <span className="text-muted">
                    Estimated day for {sample.preferences.travelers}, including the stay
                  </span>
                  <DemoFigure>
                    <Money
                      amountMinor={dayCost(sampleDay, sample.preferences.travelers).totalMinor}
                      currency={CONTENT_CURRENCY}
                      locale={locale}
                      intent="potential"
                    />
                  </DemoFigure>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </Shell>

      {/* Stays */}
      <Shell className="pt-20 md:pt-28">
        <SectionHeading
          title={t('explore.home.stayHeading')}
          kicker={t('explore.home.stayKicker')}
          action={{ href: '/explore/stays', label: t('explore.nav.stay') }}
        />
        <div className="no-scrollbar -mx-5 flex snap-x snap-mandatory gap-6 overflow-x-auto px-5 md:mx-0 md:grid md:grid-cols-2 md:px-0 lg:grid-cols-4">
          {curatedStays.map((property) => (
            <div key={property.slug} className="w-[78%] shrink-0 snap-start sm:w-[46%] md:w-auto">
              <PropertyCard property={property} locale={locale} />
            </div>
          ))}
        </div>
        <IllustrativeNote className="mt-6">{t('explore.stay.estimateNote')}</IllustrativeNote>
      </Shell>

      {/* Experiences */}
      <Shell className="pt-20 md:pt-28">
        <SectionHeading
          title={t('explore.home.experiencesHeading')}
          kicker={t('explore.home.experiencesKicker')}
          action={{
            href: '/explore/experiences',
            label: t('explore.home.experiencesCta', { count: experiences.length }),
          }}
        />
        <div className="no-scrollbar -mx-5 flex snap-x snap-mandatory gap-6 overflow-x-auto px-5 md:mx-0 md:grid md:grid-cols-3 md:px-0">
          {featuredExperiences.map((experience) => (
            <div key={experience.slug} className="w-[78%] shrink-0 snap-start sm:w-[46%] md:w-auto">
              <ExperienceCard experience={experience} locale={locale} />
            </div>
          ))}
        </div>
      </Shell>

      {/* Culture */}
      {culture ? (
        <Band>
          <Shell className="grid gap-12 py-20 md:py-24 lg:grid-cols-[1fr_1.2fr] lg:gap-20">
            <div>
              <p className="text-sage text-sm font-medium">{t('explore.guide.heading')}</p>
              <h2 className="mt-3 text-4xl leading-[1.05] md:text-5xl">
                {t('explore.home.guideHeading')}
              </h2>
              <p className="text-muted mt-5 max-w-md leading-relaxed">
                {t('explore.home.guideKicker')}
              </p>
              <Link
                href="/explore/culture/puerto-escondido"
                className="bg-sage text-ivory hover:bg-sage-deep mt-8 inline-flex h-12 items-center gap-2 rounded-full px-6 text-sm transition-colors duration-150"
              >
                {t('explore.home.guideCta')} <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
            <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
              {culture.etiquette.slice(0, 2).map((item) => (
                <div key={item.title} className="border-line border-t pt-5">
                  <p className="text-xl">{item.title}</p>
                  <p className="text-muted mt-2 text-sm leading-relaxed">{item.text}</p>
                </div>
              ))}
              <div className="border-line border-t pt-5 sm:col-span-2">
                <p className="mb-4 text-sm font-medium">Five words to land with</p>
                <div className="flex flex-wrap gap-x-8 gap-y-4">
                  {culture.language.slice(0, 5).map((phrase) => (
                    <div key={phrase.phrase}>
                      <p className="text-lg italic">{phrase.phrase}</p>
                      <p className="text-muted text-xs">{phrase.meaning}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Shell>
        </Band>
      ) : null}

      {/* Journal */}
      <Shell className="py-20 md:py-28">
        <SectionHeading
          title="From the Journal"
          action={{ href: '/explore/journal', label: t('explore.nav.guide') }}
        />
        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
          {featuredArticle ? (
            <Link href={`/explore/journal/${featuredArticle.slug}`} className="group block">
              <div className="bg-sand relative aspect-16/10 overflow-hidden rounded-2xl">
                <Image
                  src={featuredArticle.image}
                  alt=""
                  fill
                  sizes="(max-width: 1024px) 100vw, 60vw"
                  className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                />
              </div>
              <p className="text-gold-deep mt-5 text-xs">
                {featuredArticle.category} · {featuredArticle.readMinutes} min read
              </p>
              <h3 className="group-hover:text-sage mt-2 text-3xl leading-tight transition-colors duration-150 md:text-4xl">
                {featuredArticle.title}
              </h3>
              <p className="text-muted mt-3 max-w-xl leading-relaxed">{featuredArticle.dek}</p>
            </Link>
          ) : null}
          <ul className="divide-line border-line divide-y border-t">
            {moreArticles.slice(0, 4).map((article) => (
              <li key={article.slug}>
                <Link
                  href={`/explore/journal/${article.slug}`}
                  className="group flex gap-5 py-5"
                >
                  <div className="bg-sand relative size-24 shrink-0 overflow-hidden rounded-xl md:size-28">
                    <Image src={article.image} alt="" fill sizes="112px" className="object-cover" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-gold-deep text-xs">{article.category}</p>
                    <p className="group-hover:text-sage mt-1 text-lg leading-snug transition-colors duration-150 md:text-xl">
                      {article.title}
                    </p>
                    <p className="text-muted mt-2 flex items-center gap-1 text-xs">
                      {article.readMinutes} min read <ArrowUpRight className="size-3" aria-hidden />
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Shell>
    </div>
  )
}

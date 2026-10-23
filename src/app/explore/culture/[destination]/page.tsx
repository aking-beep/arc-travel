import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight, Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { Money } from '@/components/money'
import { IllustrativeNote, Shell } from '@/components/explore/editorial'
import { PreparedAnswers } from '@/components/explore/prepared-answers'
import { getTranslator } from '@/lib/i18n/server'
import { cultureGuides, getCulture } from '@/modules/discovery/content/culture'
import { destinations, getDestination } from '@/modules/discovery/content/destinations'
import { experiences } from '@/modules/discovery/content/experiences'
import { CONTENT_CURRENCY } from '@/modules/discovery/content/types'

export async function generateStaticParams() {
  return cultureGuides.map((guide) => ({ destination: guide.destination }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ destination: string }>
}) {
  const { destination } = await params
  const place = getDestination(destination)
  return { title: place ? `Culture — ${place.name}` : 'Culture' }
}

/**
 * The full culture guide, ported from the export's `CulturePage`.
 *
 * Two changes.
 *
 * The export's destination picker was a `<select>` with an `onChange` that
 * called `navigate`, which made the whole page a client component for one
 * control and broke without JavaScript. It is a row of links.
 *
 * The export's **Safety** block is **Advisories**, labelled as editorial
 * guidance with the date it was last read through, and it carries a pointer to
 * the two places that *are* authoritative: the dated ocean readings in the
 * guest portal's local guide, and the sourced government brief that
 * `modules/culture-context` builds. `CLAUDE.md` is explicit that an advisory is
 * never rendered as law (ADR-024), and an undated list of safety instructions
 * under a heading reading "Safety" is the shape that gets read as law.
 */
export default async function CulturePage({
  params,
}: {
  params: Promise<{ destination: string }>
}) {
  const { destination } = await params
  const guide = getCulture(destination)
  const place = getDestination(destination)
  if (!guide || !place) notFound()

  const { t, locale } = await getTranslator()

  const communityExperiences = experiences.filter(
    (e) => e.destination === place.slug && (e.category === 'Culture' || e.category === 'Food'),
  )

  const reviewed = new Date(guide.reviewedAt).toLocaleDateString(
    locale === 'es' ? 'es-MX' : 'en-GB',
    { day: 'numeric', month: 'long', year: 'numeric' },
  )

  return (
    <div>
      <section className="bg-sage text-ivory">
        <Shell className="grid items-end gap-10 pt-12 pb-14 md:pt-20 md:pb-20 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="text-ivory/70 text-sm">{t('explore.guide.cultureHeading')}</p>
            <h1 className="mt-5 text-5xl leading-none tracking-tight md:text-7xl">
              Know {place.name}
              <br />
              <em className="text-gold">before you go.</em>
            </h1>
            <p className="text-ivory/80 mt-6 max-w-xl leading-relaxed">{guide.intro}</p>
            <p className="text-ivory/60 mt-4 text-xs">
              {t('explore.guide.factsUpdated', { date: reviewed })}
            </p>

            <nav className="mt-8 flex flex-wrap gap-2" aria-label="Other destinations">
              {destinations.slice(0, 8).map((other) => (
                <Link
                  key={other.slug}
                  href={`/explore/culture/${other.slug}`}
                  aria-current={other.slug === place.slug ? 'page' : undefined}
                  className={
                    other.slug === place.slug
                      ? 'bg-ivory text-ink inline-flex h-9 items-center rounded-full px-3 text-sm'
                      : 'border-ivory/30 hover:border-ivory inline-flex h-9 items-center rounded-full border px-3 text-sm'
                  }
                >
                  {other.name}
                </Link>
              ))}
            </nav>
          </div>
          <div className="relative hidden aspect-4/3 w-full overflow-hidden rounded-3xl lg:block">
            <Image src={place.image} alt="" fill sizes="33vw" className="object-cover" />
          </div>
        </Shell>
      </section>

      <Shell className="grid gap-14 py-16 md:py-24 lg:grid-cols-[1fr_400px] lg:gap-20">
        <div className="space-y-16">
          <Block title="Cultural etiquette">
            <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
              {guide.etiquette.map((item) => (
                <div key={item.title} className="border-line border-t pt-4">
                  <p className="text-xl">{item.title}</p>
                  <p className="text-muted mt-2 text-sm leading-relaxed">{item.text}</p>
                </div>
              ))}
            </div>
          </Block>

          <Block title="Local traditions">
            <div className="space-y-5">
              {guide.traditions.map((tradition) => (
                <div
                  key={tradition.title}
                  className="grid gap-2 md:grid-cols-[200px_1fr] md:gap-8"
                >
                  <p className="text-xl">{tradition.title}</p>
                  <p className="text-muted text-sm leading-relaxed">{tradition.text}</p>
                </div>
              ))}
            </div>
          </Block>

          <Block title="Language essentials">
            <div className="bg-line border-line grid gap-px overflow-hidden rounded-2xl border sm:grid-cols-2 md:grid-cols-3">
              {guide.language.map((phrase) => (
                <div key={phrase.phrase} className="bg-ivory p-5">
                  <p className="text-xl italic">{phrase.phrase}</p>
                  <p className="mt-1 text-sm">{phrase.meaning}</p>
                  <p className="text-gold-deep mt-2 text-xs">{phrase.say}</p>
                </div>
              ))}
            </div>
          </Block>

          <Block title="Local customs">
            <ul className="space-y-3">
              {guide.customs.map((custom) => (
                <li key={custom} className="border-gold border-l-2 pl-4 text-sm leading-relaxed">
                  {custom}
                </li>
              ))}
            </ul>
          </Block>

          <div className="grid gap-12 md:grid-cols-2">
            <Block title="Responsible tourism">
              <ul className="space-y-3">
                {guide.responsible.map((item) => (
                  <li key={item} className="text-muted text-sm leading-relaxed">
                    — {item}
                  </li>
                ))}
              </ul>
            </Block>

            <Block title="Advisories">
              <div className="border-line rounded-2xl border border-dashed p-5">
                <p className="text-muted mb-4 flex items-start gap-2 text-xs leading-relaxed">
                  <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>
                    Editorial guidance written by ARC editors and last read through on{' '}
                    {reviewed}. It is not legal advice, it is not a safety assurance, and it is
                    not current the way a reading is. For the state of the water, the local
                    guide carries dated readings with their source.
                  </span>
                </p>
                <ul className="space-y-3">
                  {guide.advisories.map((item) => (
                    <li key={item} className="text-muted text-sm leading-relaxed">
                      — {item}
                    </li>
                  ))}
                </ul>
              </div>
            </Block>
          </div>

          <Block title="Seasonal considerations">
            <ol className="grid gap-6 md:grid-cols-3">
              {guide.seasons.map((season) => (
                <li key={season.months} className="border-sage border-t-2 pt-4">
                  <p className="text-muted text-xs">{season.months}</p>
                  <p className="mt-1 text-xl">{season.label}</p>
                  <p className="text-muted mt-2 text-sm leading-relaxed">{season.text}</p>
                </li>
              ))}
            </ol>
          </Block>

          <Block title="Community experiences">
            <ul className="mb-6 space-y-2">
              {guide.community.map((item) => (
                <li key={item} className="text-sm">
                  {item}
                </li>
              ))}
            </ul>
            {communityExperiences.length > 0 ? (
              <>
                <div className="divide-line border-line divide-y border-y">
                  {communityExperiences.map((experience) => (
                    <Link
                      key={experience.slug}
                      href={`/explore/experiences/${experience.slug}`}
                      className="group flex items-center gap-4 py-4"
                    >
                      <div className="bg-sand relative size-16 shrink-0 overflow-hidden rounded-xl">
                        <Image
                          src={experience.image}
                          alt=""
                          fill
                          sizes="64px"
                          className="object-cover"
                        />
                      </div>
                      <span className="flex-1">
                        <span className="group-hover:text-sage block text-lg transition-colors duration-150">
                          {experience.title}
                        </span>
                        <span className="text-muted block text-xs">
                          {t('explore.experience.hostedBy')} {experience.host.name} ·{' '}
                          <Money
                            amountMinor={experience.priceMinor}
                            currency={CONTENT_CURRENCY}
                            locale={locale}
                            intent="potential"
                          />
                        </span>
                      </span>
                      <ArrowRight className="text-muted size-4" aria-hidden />
                    </Link>
                  ))}
                </div>
                <IllustrativeNote className="mt-4">
                  {t('explore.verification.unverifiedNote')}
                </IllustrativeNote>
              </>
            ) : null}
          </Block>
        </div>

        <aside className="self-start lg:sticky lg:top-28">
          <PreparedAnswers guide={guide} name={place.name} />
          <Link
            href={`/explore/plan?destination=${place.slug}`}
            className="border-line hover:border-ink mt-6 flex items-center justify-between gap-3 rounded-2xl border p-5 transition-colors duration-150"
          >
            <span>
              <span className="text-muted block text-xs">Ready?</span>
              <span className="block text-lg">Plan a trip to {place.name}</span>
            </span>
            <ArrowRight className="size-5" aria-hidden />
          </Link>
        </aside>
      </Shell>
    </div>
  )
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-6 text-3xl">{title}</h2>
      {children}
    </section>
  )
}

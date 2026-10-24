import { ExperienceBrowser } from '@/components/explore/experience-browser'
import { ExperienceCard } from '@/components/explore/cards'
import { Shell } from '@/components/explore/editorial'
import { getTranslator } from '@/lib/i18n/server'
import { experiences } from '@/modules/discovery/content/experiences'
import { liveExperiences } from '@/modules/discovery/live'

export const metadata = { title: 'Experiences' }

/**
 * Two catalogues, kept apart on purpose.
 *
 * The published catalogue — real suppliers in Puerto Escondido, read from the
 * database through `modules/discovery/live` — renders as its own section above
 * the illustrative set rather than merged into it. Two reasons, and neither is
 * presentational.
 *
 * The first is honesty: "illustrative" and "unverified" are different claims,
 * and a visitor who cannot tell which list they are looking at cannot tell
 * which one they are being made. The second is money: the content set is USD
 * and the catalogue is in the property's own currency, and the browser's price
 * slider is a single scale. One slider over two currencies is a slider that
 * lies, and converting between them would mean inventing an exchange rate.
 */
export default async function ExperiencesPage({
  searchParams,
}: {
  searchParams: Promise<{ destination?: string; category?: string; q?: string }>
}) {
  const { destination, category, q } = await searchParams
  const { t, locale } = await getTranslator()

  // Filtered in the query, not over an array in a component: this list is a
  // real one and will not stay small.
  const live = await liveExperiences(locale, { category, q })

  return (
    <Shell className="pt-10 pb-20 md:pt-16">
      <header className="mb-10 max-w-2xl">
        <h1 className="text-4xl tracking-tight md:text-5xl">{t('explore.experiences.heading')}</h1>
        <p className="text-muted mt-4 leading-relaxed">{t('explore.experiences.lede')}</p>
      </header>

      {live.length > 0 ? (
        <section className="border-line mb-16 border-b pb-16">
          <h2 className="text-2xl md:text-3xl">{t('explore.source.live')}</h2>
          <p className="text-muted mt-3 max-w-2xl text-sm leading-relaxed">
            {t('explore.source.liveNote')}
          </p>
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {live.map((experience) => (
              <ExperienceCard key={experience.slug} experience={experience} locale={locale} />
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="sr-only">{t('explore.source.illustrative')}</h2>
        <ExperienceBrowser
          experiences={experiences}
          locale={locale}
          initialDestination={destination}
        />
      </section>
    </Shell>
  )
}

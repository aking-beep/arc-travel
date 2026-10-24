import { PropertyCard } from '@/components/explore/cards'
import { Shell } from '@/components/explore/editorial'
import { StayBrowser } from '@/components/explore/stay-browser'
import { getTranslator } from '@/lib/i18n/server'
import { stays } from '@/modules/discovery/content/stays'
import { liveStays } from '@/modules/discovery/live'

export const metadata = { title: 'Stays' }

/**
 * The real property first, the illustrative set below it.
 *
 * Kept apart for the reasons in `../experiences/page.tsx`: a visitor must be
 * able to tell which catalogue they are reading, and the browser's price
 * filter is a single currency scale.
 */
export default async function StaysPage({
  searchParams,
}: {
  searchParams: Promise<{ destination?: string }>
}) {
  const { destination } = await searchParams
  const { t, locale } = await getTranslator()

  const live = await liveStays(locale)

  return (
    <Shell className="pt-10 pb-20 md:pt-16">
      <header className="mb-10 max-w-2xl">
        <h1 className="text-4xl tracking-tight md:text-5xl">{t('explore.home.stayHeading')}</h1>
        <p className="text-muted mt-4 leading-relaxed">
          Small, characterful places — surf lodges, river-view rooms, fireside chalets.{' '}
          {t('explore.hero.demoNote')}
        </p>
      </header>

      {live.length > 0 ? (
        <section className="border-line mb-16 border-b pb-16">
          <h2 className="text-2xl md:text-3xl">{t('explore.source.live')}</h2>
          <p className="text-muted mt-3 max-w-2xl text-sm leading-relaxed">
            {t('explore.source.liveNote')}
          </p>
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {live.map((property) => (
              <PropertyCard key={property.slug} property={property} locale={locale} />
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="sr-only">{t('explore.source.illustrative')}</h2>
        <StayBrowser stays={stays} locale={locale} initialDestination={destination} />
      </section>
    </Shell>
  )
}

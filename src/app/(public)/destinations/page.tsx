import { DestinationCard } from '@/components/explore/cards'
import { Shell } from '@/components/explore/editorial'
import { getTranslator } from '@/lib/i18n/server'
import { destinations } from '@/modules/discovery/content/destinations'
import type { DestinationCategory } from '@/modules/discovery/content/types'

export const metadata = { title: 'Destinations' }

const CATEGORY_ORDER: DestinationCategory[] = ['Coastal', 'Island', 'City', 'Mountain']

/**
 * The destination index.
 *
 * Grouped by category rather than filtered: eight records do not need a filter
 * panel, and the export's own grouping reads better than a flat grid.
 */
export default async function DestinationsPage() {
  const { t, locale } = await getTranslator()

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    items: destinations.filter((d) => d.category === category),
  })).filter((group) => group.items.length > 0)

  return (
    <Shell className="pt-10 pb-20 md:pt-16">
      <header className="mb-12 max-w-2xl">
        <h1 className="text-4xl tracking-tight md:text-5xl">{t('explore.nav.destinations')}</h1>
        <p className="text-muted mt-4 leading-relaxed">
          {destinations.length} places, each with stays, hosts and culture notes.{' '}
          {t('explore.hero.demoNote')}
        </p>
      </header>

      <div className="space-y-16">
        {grouped.map((group) => (
          <section key={group.category}>
            <h2 className="border-line mb-8 border-b pb-3 text-2xl">{group.category}</h2>
            <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
              {group.items.map((destination) => (
                <DestinationCard
                  key={destination.slug}
                  destination={destination}
                  locale={locale}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </Shell>
  )
}

import { DestinationCard, ExperienceCard, PropertyCard } from '@/components/explore/cards'
import { EditorialEmptyState, IllustrativeNote, Shell } from '@/components/explore/editorial'
import { SearchBar } from '@/components/explore/search-bar'
import { daysBetween } from '@/lib/dates'
import { getTranslator } from '@/lib/i18n/server'
import { destinations } from '@/modules/discovery/content/destinations'
import { experiences } from '@/modules/discovery/content/experiences'
import { stays } from '@/modules/discovery/content/stays'
import type { TravelStyle } from '@/modules/discovery/content/types'

export const metadata = { title: 'Search' }

const STYLE_TO_CATEGORY: Record<string, string[]> = {
  'Surf & Ocean': ['Adventure', 'Nature'],
  'Culture & City': ['Culture', 'Food'],
  'Mountain & Alpine': ['Adventure', 'Nature'],
  Wellness: ['Wellness'],
  'Food & Craft': ['Food', 'Culture'],
  'Wild Nature': ['Nature', 'Adventure'],
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Search results, ported from the export's `SearchPage`.
 *
 * A Server Component reading `searchParams`, rather than the export's
 * `useSearchParams` — the filtering is pure, so there is no reason for it to
 * run in the browser, and a shared result URL renders without JavaScript.
 *
 * The dates and party size narrow which listings are *shown*; they do not
 * check anything. A stay appears if one of its room types sleeps the party,
 * which is a fact about the room, not about the night. The note says so,
 * because a results page with dates on it is exactly where a visitor would
 * otherwise assume an availability lookup had happened.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string
    from?: string
    to?: string
    guests?: string
    style?: string
  }>
}) {
  const query = await searchParams
  const { t, locale } = await getTranslator()

  const q = (query.q ?? '').trim()
  const from = DATE_RE.test(query.from ?? '') ? (query.from ?? '') : ''
  const to = DATE_RE.test(query.to ?? '') ? (query.to ?? '') : ''
  const guests = Math.min(12, Math.max(1, Number(query.guests) || 2))
  const style = query.style ?? ''

  const nights = from && to ? Math.max(0, daysBetween(from, to)) : 0

  const needle = q.toLowerCase()
  const matchedDestinations = destinations.filter((destination) => {
    const textOk =
      !needle ||
      `${destination.name} ${destination.country} ${destination.region}`
        .toLowerCase()
        .includes(needle)
    const styleOk = !style || destination.styles.includes(style as TravelStyle)
    return textOk && styleOk
  })

  const slugs = new Set(matchedDestinations.map((d) => d.slug))

  const matchedStays = stays.filter(
    (stay) =>
      slugs.has(stay.destination) &&
      stay.rooms.some((room) => room.sleeps >= Math.min(guests, 8)),
  )

  const matchedExperiences = experiences.filter(
    (experience) =>
      slugs.has(experience.destination) &&
      (!style || STYLE_TO_CATEGORY[style]?.includes(experience.category)),
  )

  const dateFormatter = new Intl.DateTimeFormat(locale === 'es' ? 'es-MX' : 'en-GB', {
    day: 'numeric',
    month: 'short',
  })

  const summary = [
    q || 'All destinations',
    from && to
      ? `${dateFormatter.format(new Date(from))} – ${dateFormatter.format(new Date(to))}${
          nights > 0 ? ` · ${nights} nights` : ''
        }`
      : 'Flexible dates',
    `${guests} ${guests === 1 ? 'traveller' : 'travellers'}`,
    style || 'Any style',
  ].join(' · ')

  const total = matchedDestinations.length + matchedStays.length + matchedExperiences.length

  return (
    <Shell className="pt-10 pb-20 md:pt-16">
      <h1 className="text-4xl tracking-tight md:text-5xl">{t('explore.experiences.search')}</h1>
      <p className="text-muted mt-3 text-sm">{summary}</p>

      <div className="mt-8">
        <SearchBar locale={locale} variant="inline" initial={{ q, from, to, guests, style }} />
      </div>

      <IllustrativeNote className="mt-6">
        Dates and party size narrow what is shown — a stay appears when one of its room types
        sleeps your party. Nothing here checks whether a night is free.
      </IllustrativeNote>

      {total === 0 ? (
        <div className="mt-14">
          <EditorialEmptyState
            title={t('explore.experiences.empty')}
            text={t('explore.experiences.emptyHint')}
          />
        </div>
      ) : (
        <div className="mt-14 space-y-16">
          {matchedDestinations.length > 0 ? (
            <section>
              <h2 className="border-line mb-6 border-b pb-3 text-2xl">
                Destinations{' '}
                <span className="text-muted text-base tabular-nums">
                  ({matchedDestinations.length})
                </span>
              </h2>
              <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
                {matchedDestinations.map((destination) => (
                  <DestinationCard
                    key={destination.slug}
                    destination={destination}
                    locale={locale}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {matchedStays.length > 0 ? (
            <section>
              <h2 className="border-line mb-6 border-b pb-3 text-2xl">
                Stays{' '}
                <span className="text-muted text-base tabular-nums">({matchedStays.length})</span>
              </h2>
              <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
                {matchedStays.map((property) => (
                  <PropertyCard key={property.slug} property={property} locale={locale} />
                ))}
              </div>
            </section>
          ) : null}

          {matchedExperiences.length > 0 ? (
            <section>
              <h2 className="border-line mb-6 border-b pb-3 text-2xl">
                Experiences{' '}
                <span className="text-muted text-base tabular-nums">
                  ({matchedExperiences.length})
                </span>
              </h2>
              <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
                {matchedExperiences.map((experience) => (
                  <ExperienceCard key={experience.slug} experience={experience} locale={locale} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </Shell>
  )
}

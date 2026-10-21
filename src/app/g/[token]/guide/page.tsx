import { Building2, Info, Waves } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConditionsCard } from '@/components/guest/conditions-card'
import { CultureCard } from '@/components/guest/culture-card'
import { createTranslator } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'
import { addDays, dateRange, toDateKey } from '@/lib/dates'
import { prisma } from '@/lib/db'
import { resolvePortalContext } from '@/modules/guest/portal'
import { getConditionsForDestination } from '@/modules/destination/conditions'
import { getGuestCultureBrief } from '@/modules/culture-context/service'

export const metadata = { title: 'Local guide' }

/**
 * The destination guide.
 *
 * Everything here is reference geography with its provenance shown — no
 * commercial claims, no availability, no recommendation. The ocean readings sit
 * alongside the places they describe so a guest can see for themselves why
 * Carrizalillo is where the beginner lessons happen and Zicatela is not.
 */
export default async function GuidePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const context = await resolvePortalContext(token)
  const locale = await getLocale()
  const t = createTranslator(locale)

  const today = toDateKey(new Date())
  const window = dateRange(today, addDays(today, 2))

  const [places, oceanPlaces, culture] = await Promise.all([
    prisma.place.findMany({
      where: { destination: 'puerto-escondido' },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        kind: true,
        summaryEn: true,
        summaryEs: true,
        safetyNotesEn: true,
        safetyNotesEs: true,
        typicalRisk: true,
        provenance: true,
        verification: true,
        factsUpdatedAt: true,
        parent: { select: { name: true } },
      },
    }),
    getConditionsForDestination('puerto-escondido', window),
    getGuestCultureBrief(context),
  ])

  const byKind = new Map<string, typeof places>()
  for (const place of places) {
    const bucket = byKind.get(place.kind) ?? []
    bucket.push(place)
    byKind.set(place.kind, bucket)
  }

  const KIND_TITLES: Record<string, string> = {
    SURF_BREAK: 'Surf breaks',
    BEACH: 'Beaches',
    NEIGHBORHOOD: 'Neighbourhoods',
    LAGOON: 'Lagoons',
    DINING_DISTRICT: 'Where to eat',
    MARKET: 'Markets',
    VIEWPOINT: 'Viewpoints',
    TRANSPORT_HUB: 'Getting here',
    STUDIO: 'Studios',
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-semibold">{t('guest.guide')}</h2>
        <p className="text-sand-600 mt-1 text-sm">
          Puerto Escondido is not one beach. Which one you are on decides what is possible that day.
        </p>
      </div>

      {context.property.houseNotes ? (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Building2 className="text-jade-700 size-4" aria-hidden />
              <CardTitle className="text-base">From {context.property.name}</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sand-700 text-sm leading-relaxed whitespace-pre-line">
              {context.property.houseNotes}
            </p>
            <p className="text-sand-500 mt-3 text-xs">
              Check-in from {context.property.checkInTime}, check-out by{' '}
              {context.property.checkOutTime}.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Waves className="text-jade-700 size-4" aria-hidden />
          <h3 className="font-display text-base font-semibold">{t('conditions.title')}</h3>
        </div>
        <p className="text-sand-600 text-sm">
          Today and the next two days, per spot. Each reading carries the time it was taken.
        </p>
        <div className="space-y-3">
          {oceanPlaces.map((place) => {
            const todayReport = place.reports.find((r) => r.forDate === today) ?? place.reports[0]
            if (!todayReport) return null
            return (
              <ConditionsCard
                key={place.id}
                snapshot={todayReport}
                placeName={place.name}
                safetyNotes={locale === 'es' ? place.safetyNotesEs : place.safetyNotesEn}
                locale={locale}
              />
            )
          })}
        </div>
      </section>

      <CultureCard result={culture} locale={locale} />

      {[...byKind.entries()].map(([kind, group]) => (
        <section key={kind} className="space-y-3">
          <h3 className="font-display text-base font-semibold">
            {KIND_TITLES[kind] ?? kind.replace('_', ' ').toLowerCase()}
          </h3>
          <ul className="space-y-3">
            {group.map((place) => (
              <li key={place.id} className="border-sand-200 rounded-xl border bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{place.name}</p>
                    {place.parent ? (
                      <p className="text-sand-500 text-xs">in {place.parent.name}</p>
                    ) : null}
                  </div>
                  <Badge tone="neutral">{place.typicalRisk}</Badge>
                </div>

                <p className="text-sand-700 mt-2 text-sm leading-relaxed">
                  {(locale === 'es' && place.summaryEs) || place.summaryEn}
                </p>

                {(locale === 'es' ? place.safetyNotesEs : place.safetyNotesEn) ? (
                  <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {locale === 'es' ? place.safetyNotesEs : place.safetyNotesEn}
                  </p>
                ) : null}

                <p className="text-sand-400 mt-2.5 flex items-start gap-1.5 text-xs">
                  <Info className="mt-px size-3 shrink-0" aria-hidden />
                  {place.provenance.replace('_', ' ').toLowerCase()} ·{' '}
                  {place.verification === 'VERIFIED' ? t('common.verified') : t('common.unverified')}{' '}
                  · {t('common.lastUpdated')} {toDateKey(place.factsUpdatedAt)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p className="text-sand-500 text-xs leading-relaxed">{t('conditions.disclaimer')}</p>
    </div>
  )
}

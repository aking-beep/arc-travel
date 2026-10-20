import Link from 'next/link'
import { CalendarRange, Info, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { LinkButton } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { Money } from '@/components/money'
import { ConditionsCard } from '@/components/guest/conditions-card'
import { createTranslator } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'
import { toLocalTimeString } from '@/lib/dates'
import { ItineraryItemKind } from '@/lib/prisma-types'
import { resolvePortalContext } from '@/modules/guest/portal'
import { getItineraryForGuest } from '@/modules/itinerary/service'
import { getConditions } from '@/modules/destination/conditions'
import { getGuestPreferences } from '@/modules/preferences/service'
import { ItineraryControls, ItemActions } from './itinerary-controls'

export const metadata = { title: 'Your itinerary' }

const KIND_LABEL = {
  [ItineraryItemKind.EXPERIENCE]: null,
  [ItineraryItemKind.MEAL]: 'guest.meal',
  [ItineraryItemKind.REST]: 'guest.rest',
  [ItineraryItemKind.TRANSFER]: 'guest.transfer',
  [ItineraryItemKind.FREE_TIME]: 'guest.freeTime',
} as const

export default async function GuestItineraryPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const context = await resolvePortalContext(token)
  const locale = await getLocale()
  const t = createTranslator(locale)

  const [itinerary, preferences] = await Promise.all([
    getItineraryForGuest(context.guestId),
    getGuestPreferences(context.guestId),
  ])

  // --- Not through intake yet ----------------------------------------------
  if (!context.intakeCompleted) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{context.property.tagline ?? t('guest.welcomeSub')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {context.property.description ? (
              <p className="text-sand-700 text-sm leading-relaxed">
                {context.property.description}
              </p>
            ) : null}
            <LinkButton href={`/g/${token}/intake`} size="lg" block>
              {t('guest.startPlanning')}
            </LinkButton>
            <p className="text-sand-500 text-xs">
              Thirty seconds of questions. We will not guess your surf level — an unanswered
              question stays unanswered.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">While you are here</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <LinkButton href={`/g/${token}/explore`} variant="outline" block>
              {t('guest.explore')}
            </LinkButton>
            <LinkButton href={`/g/${token}/guide`} variant="outline" block>
              {t('guest.guide')}
            </LinkButton>
          </CardContent>
        </Card>
      </div>
    )
  }

  // --- Through intake, no plan yet -----------------------------------------
  if (!itinerary) {
    return (
      <div className="space-y-6">
        <EmptyState
          icon={<Sparkles className="size-6" aria-hidden />}
          title="No itinerary yet"
          description="We have your preferences. Build a plan for the rest of your stay and you can change it as often as you like."
        />
        <ItineraryControls
          token={token}
          locale={locale}
          startDate={context.planningStart}
          endDate={context.planningEnd}
          pace={preferences.pace ?? 'BALANCED'}
          budget={
            preferences.budgetPerDayMinor
              ? String(Math.round(preferences.budgetPerDayMinor / 100))
              : ''
          }
          partySize={preferences.partySize || context.partySize}
          label={t('guest.buildItinerary')}
        />
      </div>
    )
  }

  // --- Render the plan ------------------------------------------------------
  const placeIds = [
    ...new Set(itinerary.items.map((i) => i.placeId).filter((id): id is string => Boolean(id))),
  ]
  const dates = [...new Set(itinerary.items.map((i) => i.date.toISOString().slice(0, 10)))]
  const conditions = await getConditions(placeIds, dates)

  const byDay = new Map<number, typeof itinerary.items>()
  for (const item of itinerary.items) {
    const bucket = byDay.get(item.dayIndex) ?? []
    bucket.push(item)
    byDay.set(item.dayIndex, bucket)
  }

  const narrative =
    (itinerary.agentRun?.outputJson as { paragraphs?: string[] } | null)?.paragraphs ?? []
  const unmet = (itinerary.unmetConstraints as Array<{ code: string; message: string; date?: string }> | null) ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold">{itinerary.title}</h2>
          <p className="text-sand-600 mt-1 text-sm">
            {t(`pace.${itinerary.pace}`)} · {itinerary.partySize} {t('common.people')} ·{' '}
            <Money amountMinor={itinerary.estimatedTotalMinor} currency={itinerary.currency} />{' '}
            {t('common.total').toLowerCase()}
          </p>
        </div>
        <Badge tone="demo">{t('common.demoData')}</Badge>
      </div>

      {narrative.length > 0 ? (
        <div className="border-jade-200 bg-jade-50/60 rounded-xl border px-4 py-3">
          {narrative.map((paragraph) => (
            <p key={paragraph} className="text-jade-900 text-sm leading-relaxed not-first:mt-2">
              {paragraph}
            </p>
          ))}
          <p className="text-jade-700/70 mt-2 text-xs">
            Written by {itinerary.agentRun?.model ?? 'the mock provider'} from the reasons below. It
            can rephrase them; it cannot add to them.
          </p>
        </div>
      ) : null}

      {[...byDay.entries()]
        .sort(([a], [b]) => a - b)
        .map(([dayIndex, items]) => {
          const date = items[0]?.date.toISOString().slice(0, 10) ?? ''
          const dayCost = items.reduce((n, i) => n + i.estimatedCostMinor, 0)

          return (
            <section key={dayIndex} className="space-y-3">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-display text-sand-800 text-base font-semibold">
                  {t('guest.day')} {dayIndex + 1}
                  <span className="text-sand-500 ml-2 text-sm font-normal tabular-nums">{date}</span>
                </h3>
                {dayCost > 0 ? (
                  <p className="text-sand-500 text-xs">
                    {t('guest.estimatedDayCost')}{' '}
                    <Money amountMinor={dayCost} currency={itinerary.currency} />
                  </p>
                ) : null}
              </div>

              <ol className="space-y-3">
                {items.map((item) => {
                  const kindKey = KIND_LABEL[item.kind]
                  const snapshot = item.placeId
                    ? conditions.get(`${item.placeId}:${date}`) ?? null
                    : null

                  return (
                    <li
                      key={item.id}
                      className={
                        item.kind === ItineraryItemKind.EXPERIENCE
                          ? 'card-surface shadow-lift p-4'
                          : 'border-sand-200 rounded-xl border border-dashed px-4 py-3'
                      }
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sand-500 text-xs tabular-nums">
                            {item.startTime}–{item.endTime}
                            {item.travelMinutesFromPrev > 0 && item.travelModeFromPrev
                              ? ` · ${item.travelMinutesFromPrev} min ${t('guest.travelTime')} (${t(`transport.${item.travelModeFromPrev}`)})`
                              : ''}
                          </p>
                          <p className="font-medium">
                            {item.experience
                              ? (locale === 'es' && item.experience.titleEs) || item.experience.titleEn
                              : item.titleEn}
                          </p>
                          {item.place ? (
                            <p className="text-sand-500 text-xs">{item.place.name}</p>
                          ) : null}
                        </div>

                        <div className="flex shrink-0 flex-col items-end gap-1">
                          {kindKey ? (
                            <Badge tone="neutral">{t(kindKey)}</Badge>
                          ) : (
                            <Badge tone="brand">{item.score}/100</Badge>
                          )}
                          {item.estimatedCostMinor > 0 ? (
                            <Money
                              amountMinor={item.estimatedCostMinor}
                              currency={item.currency}
                              className="text-sm font-medium"
                            />
                          ) : null}
                        </div>
                      </div>

                      {item.experience?.summaryEn ? (
                        <p className="text-sand-600 mt-2 text-sm">
                          {(locale === 'es' && item.experience.summaryEs) || item.experience.summaryEn}
                        </p>
                      ) : null}

                      {item.rationale.length > 0 ? (
                        <details className="group mt-3">
                          <summary className="text-jade-800 cursor-pointer text-xs font-medium underline-offset-4 hover:underline">
                            {t('guest.whyThis')}
                          </summary>
                          <ul className="text-sand-600 mt-2 space-y-1 text-xs">
                            {item.rationale.map((reason) => (
                              <li key={reason} className="flex items-start gap-1.5">
                                <Info className="mt-0.5 size-3 shrink-0 opacity-60" aria-hidden />
                                {reason}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}

                      {snapshot ? (
                        <ConditionsCard
                          snapshot={snapshot}
                          placeName={item.place?.name ?? ''}
                          locale={locale}
                          compact
                          className="mt-3"
                        />
                      ) : null}

                      {item.experience ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Link
                            href={`/g/${token}/experience/${item.experience.slug}`}
                            className="text-jade-800 text-xs underline underline-offset-4"
                          >
                            Details and times
                          </Link>
                          {item.slot ? (
                            <ItemActions
                              token={token}
                              slotId={item.slot.id}
                              quantity={itinerary.partySize}
                              remaining={Math.max(
                                0,
                                item.slot.capacity - item.slot.booked - item.slot.held,
                              )}
                              startsAt={toLocalTimeString(item.slot.startsAt)}
                              locale={locale}
                            />
                          ) : null}
                          {!item.experience.supplier ||
                          item.experience.supplier.verification !== 'VERIFIED' ? (
                            <Badge tone="neutral">{t('common.unverified')}</Badge>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ol>
            </section>
          )
        })}

      {unmet.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('guest.unmetConstraints')}</CardTitle>
            <p className="text-sand-600 text-sm">
              Listed rather than hidden. Some of these are gaps in what the hotel can sell yet.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="text-sand-700 space-y-1.5 text-sm">
              {unmet.map((constraint, index) => (
                <li key={`${constraint.code}-${index}`} className="flex items-start gap-2">
                  <CalendarRange className="text-sand-400 mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>
                    {constraint.date ? (
                      <span className="text-sand-500 font-mono text-xs">{constraint.date} </span>
                    ) : null}
                    {constraint.message}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('guest.rebuild')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ItineraryControls
            token={token}
            locale={locale}
            startDate={itinerary.startDate.toISOString().slice(0, 10)}
            endDate={itinerary.endDate.toISOString().slice(0, 10)}
            pace={itinerary.pace}
            budget={
              itinerary.budgetPerDayMinor
                ? String(Math.round(itinerary.budgetPerDayMinor / 100))
                : ''
            }
            partySize={itinerary.partySize}
            label={t('guest.rebuild')}
            personalizationAllowed={preferences.personalizationAllowed}
          />
        </CardContent>
      </Card>
    </div>
  )
}

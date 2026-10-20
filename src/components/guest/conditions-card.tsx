import { Clock, Waves, Wind } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { ConditionsSnapshot } from '@/modules/destination/conditions'
import { createTranslator, type AppLocale } from '@/lib/i18n'
import { cn } from '@/lib/cn'

const RISK_TONE = {
  LOW: 'success',
  MODERATE: 'warning',
  HIGH: 'danger',
  EXTREME: 'danger',
} as const

/**
 * One day's ocean reading for one place.
 *
 * The non-negotiable parts of this component: the risk band, the timestamp the
 * reading was taken, its source, and the disclaimer. It has no "safe" state and
 * there is no variant that omits the timestamp — a reading without its age is
 * worse than no reading, because it invites a guest to treat yesterday's calm
 * as today's.
 */
export function ConditionsCard({
  snapshot,
  placeName,
  safetyNotes,
  locale,
  compact = false,
  className,
}: {
  snapshot: ConditionsSnapshot
  placeName: string
  safetyNotes?: string | null
  locale: AppLocale
  compact?: boolean
  className?: string
}) {
  const t = createTranslator(locale)
  const currentNotes = locale === 'es' ? snapshot.currentNotesEs : snapshot.currentNotesEn

  return (
    <div
      className={cn(
        'border-sand-200 rounded-xl border bg-white p-4',
        snapshot.isStale && 'border-amber-300 bg-amber-50/40',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Waves className="text-jade-700 size-4" aria-hidden />
          <p className="font-medium">{placeName}</p>
        </div>
        <Badge tone={RISK_TONE[snapshot.risk]}>{t(`conditions.risk.${snapshot.risk}`)}</Badge>
      </div>

      <dl className="text-sand-700 mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-sand-500 text-xs">{t('conditions.waveHeight')}</dt>
          <dd className="font-medium tabular-nums">
            {snapshot.waveHeightMinM}–{snapshot.waveHeightMaxM} m
          </dd>
        </div>
        {snapshot.windKph !== null ? (
          <div>
            <dt className="text-sand-500 flex items-center gap-1 text-xs">
              <Wind className="size-3" aria-hidden />
              {t('conditions.wind')}
            </dt>
            <dd className="font-medium tabular-nums">
              {snapshot.windKph} km/h {snapshot.windDirection ?? ''}
            </dd>
          </div>
        ) : null}
        {!compact && snapshot.waterTempC !== null ? (
          <div>
            <dt className="text-sand-500 text-xs">{t('conditions.water')}</dt>
            <dd className="font-medium tabular-nums">{snapshot.waterTempC}°C</dd>
          </div>
        ) : null}
        {!compact && snapshot.highTideLocal ? (
          <div>
            <dt className="text-sand-500 text-xs">{t('conditions.tides')}</dt>
            <dd className="font-medium tabular-nums">
              ↑{snapshot.highTideLocal} ↓{snapshot.lowTideLocal}
            </dd>
          </div>
        ) : null}
        <div className="col-span-2">
          <dt className="text-sand-500 text-xs">{t('conditions.minAbility')}</dt>
          <dd className="font-medium">
            {t(`ability.${snapshot.minAbilityRequired}`)}
            {snapshot.guideRecommended ? (
              <span className="text-sand-600 font-normal"> · {t('conditions.guideRecommended')}</span>
            ) : null}
          </dd>
        </div>
      </dl>

      {currentNotes && !compact ? (
        <p className="text-sand-600 mt-3 text-sm">
          <span className="text-sand-500 text-xs uppercase">{t('conditions.currents')}: </span>
          {currentNotes}
        </p>
      ) : null}

      {safetyNotes && !compact ? (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{safetyNotes}</p>
      ) : null}

      <p className="text-sand-500 mt-3 flex items-center gap-1.5 text-xs">
        <Clock className="size-3" aria-hidden />
        {t('conditions.observedAt')}{' '}
        {snapshot.observedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC · {t('common.source')}
        : {snapshot.source}
      </p>

      {snapshot.isStale ? (
        <p className="mt-1.5 text-xs font-medium text-amber-800">{t('conditions.stale')}</p>
      ) : null}

      {!compact ? (
        <p className="text-sand-500 mt-2 text-xs leading-relaxed">{t('conditions.disclaimer')}</p>
      ) : null}
    </div>
  )
}

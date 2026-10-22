import { BookOpenText, ExternalLink, Info, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { createTranslator, type AppLocale, type MessageKey, type Translator } from '@/lib/i18n'
import { toDateKey } from '@/lib/dates'
import type { BriefItem, BriefWarning, SourceStatus } from '@/modules/culture-context/schemas'
import type { GuestCultureBrief } from '@/modules/culture-context/service'

/**
 * The guest's country brief.
 *
 * The non-negotiable parts, per docs/culture-context.md: every item shows its
 * kind label ("Travel advice, not the law of Mexico"), authority, source
 * class, link, retrieval time, jurisdiction and review status, with the OGL
 * attribution when the source requires it. There is no compact variant that
 * drops any of these.
 *
 * The source-down state is a visible panel that says what is missing. It is
 * never an empty list that looks like "nothing applies".
 */
const KNOWN_TOPICS = new Set([
  'driving',
  'medication',
  'drone',
  'filming',
  'nightlife',
  'hiking',
  'climbing',
  'surfing',
  'camping',
])

/** Warnings that explain an absence, shown prominently above the items. */
const BLOCKING: ReadonlySet<BriefWarning['code']> = new Set([
  'SOURCE_UNAVAILABLE',
  'SOURCE_UNPARSEABLE',
  'DESTINATION_UNSUPPORTED',
])

const formatInstant = (date: Date) => `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`

function topicLabel(t: Translator, topic: string): string {
  return KNOWN_TOPICS.has(topic) ? t(`culture.topic.${topic}` as MessageKey) : topic
}

function reasonText(t: Translator, reason: string, country: string): string {
  const [kind, value = ''] = reason.split(':')
  if (kind === 'destination') return t('culture.reason.destination', { country })
  if (kind === 'topic') return t('culture.reason.topic', { topic: topicLabel(t, value) })
  if (kind === 'activity') return t('culture.reason.activity', { topic: topicLabel(t, value) })
  if (kind === 'nationality' && value === 'unknown') return t('culture.reason.nationalityUnknown')
  return reason
}

function warningText(
  t: Translator,
  warning: BriefWarning,
  sources: SourceStatus[],
  country: string,
): string {
  const authority =
    sources.find((s) => s.sourceKey === warning.sourceKey)?.authority ?? sources[0]?.authority ?? ''
  return t(`culture.warning.${warning.code}`, { country, authority })
}

function Item({
  item,
  t,
  country,
}: {
  item: BriefItem
  t: Translator
  country: string
}) {
  return (
    <li className="border-sand-200 rounded-xl border bg-white p-4" data-testid="culture-item">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sand-500 text-xs uppercase">
            {t(`culture.category.${item.category}`)}
          </p>
          <p className="font-medium">{item.title}</p>
        </div>
        <Badge tone={item.kind === 'LAW' ? 'brand' : 'warning'} data-testid="culture-kind">
          {t(`culture.kind.${item.kind}`, { country })}
        </Badge>
      </div>

      <p className="text-sand-700 mt-2 text-sm leading-relaxed whitespace-pre-line">
        {item.summary}
      </p>

      {item.applicabilityUncertain ? (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {t('culture.uncertain')}
        </p>
      ) : null}

      <div className="text-sand-600 mt-3 text-xs">
        <p className="text-sand-500">{t('culture.why')}</p>
        <ul className="mt-0.5 space-y-0.5">
          {item.relevance.map((reason) => (
            <li key={reason}>· {reasonText(t, reason, country)}</li>
          ))}
        </ul>
      </div>

      {item.sources.map((source) => (
        <div key={source.id} className="bg-sand-100 mt-3 rounded-lg px-3 py-2.5 text-xs">
          <dl className="text-sand-700 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            <div>
              <dt className="text-sand-500 inline">{t('culture.authority')}: </dt>
              <dd className="inline">{source.authority}</dd>
            </div>
            <div>
              <dt className="text-sand-500 inline">{t('culture.sourceClass')}: </dt>
              <dd className="inline">{t(`culture.class.${source.sourceClass}`)}</dd>
            </div>
            <div>
              <dt className="text-sand-500 inline">{t('culture.jurisdiction')}: </dt>
              <dd className="inline">{source.jurisdiction}</dd>
            </div>
            <div>
              <dt className="text-sand-500 inline">{t('culture.retrieved')}: </dt>
              <dd className="inline tabular-nums">{formatInstant(source.retrievedAt)}</dd>
            </div>
          </dl>
          <p className="text-sand-600 mt-1.5">{t(`culture.reviewed.${item.verification}`)}</p>
          <a
            href={source.url}
            className="text-jade-800 mt-1.5 inline-flex items-center gap-1 underline"
            rel="noopener noreferrer"
            target="_blank"
          >
            {t('culture.readSource')}
            <ExternalLink className="size-3" aria-hidden />
          </a>
          {source.attribution ? (
            <p className="text-sand-500 mt-1.5" data-testid="culture-attribution">
              {source.attribution}{' '}
              {source.licenceUrl ? (
                <a
                  href={source.licenceUrl}
                  className="underline"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {t('culture.licence')}
                </a>
              ) : null}
            </p>
          ) : null}
        </div>
      ))}
    </li>
  )
}

export function CultureCard({
  result,
  locale,
}: {
  result: GuestCultureBrief
  locale: AppLocale
}) {
  const t = createTranslator(locale)
  const { brief, changeNotice } = result
  const country = result.country ? (locale === 'es' ? result.country.nameEs : result.country.nameEn) : ''

  const blocking = brief.warnings.filter((w) => BLOCKING.has(w.code))
  const fixture = brief.warnings.find((w) => w.code === 'FIXTURE_DATA')
  const notes = brief.warnings.filter((w) => !BLOCKING.has(w.code) && w.code !== 'FIXTURE_DATA')
  const sourceUrl = brief.sources[0]?.url

  return (
    <section className="space-y-3" data-testid="culture-brief">
      <div className="flex items-center gap-2">
        <BookOpenText className="text-jade-700 size-4" aria-hidden />
        <h3 className="font-display text-base font-semibold">
          {t('culture.title', { country: country || '—' })}
        </h3>
      </div>
      <p className="text-sand-600 text-sm">{t('culture.intro')}</p>

      {fixture ? (
        <p className="flex items-start gap-1.5" data-testid="culture-fixture">
          <Badge tone="demo">{t('common.demoData')}</Badge>
          <span className="text-sand-600 text-xs leading-relaxed">
            {warningText(t, fixture, brief.sources, country)}
          </span>
        </p>
      ) : null}

      {blocking.map((warning) => (
        <div
          key={warning.code}
          role="status"
          data-testid="culture-unavailable"
          className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p>{warningText(t, warning, brief.sources, country)}</p>
            {sourceUrl && warning.code !== 'DESTINATION_UNSUPPORTED' ? (
              <a
                href={sourceUrl}
                className="mt-1 inline-flex items-center gap-1 text-xs underline"
                rel="noopener noreferrer"
                target="_blank"
              >
                {t('culture.readSource')}
                <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : null}
          </div>
        </div>
      ))}

      {changeNotice && brief.items.length > 0 ? (
        <p className="border-jade-200 bg-jade-50 text-jade-900 rounded-lg border px-3 py-2 text-xs">
          {t('culture.updated', { date: toDateKey(changeNotice.reviewedAt) })}
        </p>
      ) : null}

      {brief.items.length > 0 ? (
        <>
          {locale === 'es' ? (
            <p className="text-sand-500 text-xs">{t('culture.sourceLanguage')}</p>
          ) : null}
          <ul className="space-y-3">
            {brief.items.map((item) => (
              <Item key={item.id} item={item} t={t} country={country} />
            ))}
          </ul>
        </>
      ) : blocking.length === 0 ? (
        <p className="border-sand-300 text-sand-600 rounded-xl border border-dashed px-4 py-6 text-center text-sm">
          {t('culture.empty')}
        </p>
      ) : null}

      <ul className="text-sand-500 space-y-1 text-xs leading-relaxed">
        {notes.map((warning) => (
          <li key={warning.code} className="flex items-start gap-1.5">
            <Info className="mt-px size-3 shrink-0" aria-hidden />
            {warningText(t, warning, brief.sources, country)}
          </li>
        ))}
      </ul>
    </section>
  )
}

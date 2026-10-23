'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { createTranslator, type AppLocale } from '@/lib/i18n'
import type { CultureGuide } from '@/modules/discovery/content/culture'

const TABS = ['Etiquette', 'Language', 'Seasons', 'Responsible travel'] as const
type Tab = (typeof TABS)[number]

/**
 * The destination culture panel.
 *
 * A client component for the tabs only. Note what is *not* in here: the
 * export's `advisories` list, which this panel is not the place for. Etiquette,
 * phrases, seasons and responsible-travel notes are editorial and carry no
 * consequence if a reader ignores them. Anything with a consequence — entry
 * rules, conduct, the law — belongs on the full guide beside the sourced brief
 * from `modules/culture-context`, which labels an advisory as an advisory and
 * refuses to render one as law (ADR-024).
 */
export function CulturePanel({
  guide,
  name,
  locale,
  compact = false,
}: {
  guide: CultureGuide
  name: string
  locale: AppLocale
  compact?: boolean
}) {
  const t = createTranslator(locale)
  const [tab, setTab] = useState<Tab>('Etiquette')

  return (
    <div className={cn('bg-sage text-ivory rounded-3xl', compact ? 'p-6' : 'p-6 md:p-12')}>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="max-w-xl">
          <p className="text-ivory/70 text-sm">{t('explore.guide.cultureHeading')}</p>
          <h2
            className={cn('mt-2 leading-tight', compact ? 'text-2xl' : 'text-3xl md:text-4xl')}
          >
            Before you arrive in {name}
          </h2>
          {!compact ? (
            <p className="text-ivory/75 mt-3 text-sm leading-relaxed">{guide.intro}</p>
          ) : null}
        </div>
        <Link
          href={`/explore/culture/${guide.destination}`}
          className="bg-ivory text-ink hover:bg-paper inline-flex h-11 items-center gap-2 self-start rounded-full px-5 text-sm whitespace-nowrap transition-colors duration-150"
        >
          {t('explore.home.guideCta')} <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>

      <div
        className="no-scrollbar border-ivory/20 mt-8 flex gap-1 overflow-x-auto border-b"
        role="tablist"
      >
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            onClick={() => setTab(item)}
            className={cn(
              '-mb-px border-b-2 px-3 py-3 text-sm whitespace-nowrap transition-colors duration-150',
              tab === item
                ? 'border-gold text-ivory'
                : 'text-ivory/60 hover:text-ivory border-transparent',
            )}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="pt-6">
        {tab === 'Etiquette' ? (
          <div className="grid gap-x-10 gap-y-5 md:grid-cols-2">
            {guide.etiquette.map((item) => (
              <div key={item.title}>
                <p className="text-lg">{item.title}</p>
                <p className="text-ivory/75 mt-1 text-sm leading-relaxed">{item.text}</p>
              </div>
            ))}
          </div>
        ) : null}

        {tab === 'Language' ? (
          <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3">
            {guide.language.map((phrase) => (
              <div key={phrase.phrase}>
                <p className="text-xl italic">{phrase.phrase}</p>
                <p className="text-ivory/75 text-sm">
                  {phrase.meaning} · <span className="text-gold">{phrase.say}</span>
                </p>
              </div>
            ))}
          </div>
        ) : null}

        {tab === 'Seasons' ? (
          <div className="grid gap-5 md:grid-cols-3">
            {guide.seasons.map((season) => (
              <div key={season.months}>
                <p className="text-gold text-xs">{season.months}</p>
                <p className="mt-1 text-lg">{season.label}</p>
                <p className="text-ivory/75 mt-1 text-sm leading-relaxed">{season.text}</p>
              </div>
            ))}
          </div>
        ) : null}

        {tab === 'Responsible travel' ? (
          <ul className="grid gap-x-10 gap-y-3 md:grid-cols-2">
            {guide.responsible.map((item) => (
              <li
                key={item}
                className="text-ivory/85 border-gold border-l pl-4 text-sm leading-relaxed"
              >
                {item}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}

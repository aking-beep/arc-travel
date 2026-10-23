'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { DemoFigure, Money } from '@/components/money'
import { createTranslator, type AppLocale } from '@/lib/i18n'
import { estimateExperience } from '@/modules/discovery/estimate'
import { IllustrativeNote } from './editorial'

/**
 * Per-person price × party size, for an experience.
 *
 * The export called this "Request to book", opened an enquiry modal, wrote the
 * guest's name, email, dates and party size to `localStorage` and showed a
 * confirmation. That is three separate problems: a consequential action with no
 * `Approval` row behind it, a confirmation for something nobody received, and
 * guest contact details in browser storage. It is replaced by an estimate and a
 * link into the guest portal demo, which is where ARC actually takes a basket
 * through a hold, an approval and a checkout.
 *
 * The arithmetic is `estimateExperience` from the module, in minor units. The
 * component does no money maths of its own.
 */
export function PartyEstimator({
  locale,
  amountMinor,
  bookingFeeMinor = 0,
  currency,
  minParty,
  maxParty,
  defaultParty,
  portalHref,
}: {
  locale: AppLocale
  amountMinor: number
  bookingFeeMinor?: number
  currency: string
  minParty: number
  maxParty: number
  /** Computed on the server. The component never picks a default itself. */
  defaultParty: number
  portalHref: string
}) {
  const t = createTranslator(locale)
  const [party, setParty] = useState(defaultParty)

  const total = estimateExperience({ amountMinor, bookingFeeMinor, currency, partySize: party })

  return (
    <div className="border-line rounded-3xl border p-6 shadow-xl">
      <p>
        <span className="text-3xl">
          <Money amountMinor={amountMinor} currency={currency} locale={locale} intent="potential" />
        </span>{' '}
        <span className="text-muted text-sm">{t('explore.experience.perPerson')}</span>
      </p>
      {bookingFeeMinor > 0 ? (
        <p className="text-muted mt-1 flex items-baseline gap-1 text-xs">
          <span>+</span>
          <Money
            amountMinor={bookingFeeMinor}
            currency={currency}
            locale={locale}
            intent="potential"
          />
          <span>per booking</span>
        </p>
      ) : null}

      <div className="border-line mt-5 flex items-center justify-between border-y py-4">
        <span className="text-sm">{t('explore.stay.travellers')}</span>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setParty((p) => Math.max(minParty, p - 1))}
            disabled={party <= minParty}
            aria-label="Fewer travellers"
            className="border-line hover:border-ink flex size-8 items-center justify-center rounded-full border transition-colors duration-150 disabled:opacity-40"
          >
            <Minus className="size-3.5" aria-hidden />
          </button>
          <span className="w-4 text-center tabular-nums">{party}</span>
          <button
            type="button"
            onClick={() => setParty((p) => Math.min(maxParty, p + 1))}
            disabled={party >= maxParty}
            aria-label="More travellers"
            className="border-line hover:border-ink flex size-8 items-center justify-center rounded-full border transition-colors duration-150 disabled:opacity-40"
          >
            <Plus className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>

      <div className="mt-4 flex items-baseline justify-between gap-3 text-sm font-medium">
        <span>{t('explore.experience.estimateFor', { count: party })}</span>
        <DemoFigure>
          <Money
            amountMinor={total.amountMinor}
            currency={total.currency}
            locale={locale}
            intent="potential"
          />
        </DemoFigure>
      </div>

      <Link
        href={portalHref}
        className="bg-ink text-ivory hover:bg-ink-soft mt-5 flex h-12 w-full items-center justify-center rounded-full text-sm transition-colors duration-150"
      >
        {t('explore.stay.enquireCta')}
      </Link>

      <IllustrativeNote className="mt-4">{t('explore.stay.enquireNote')}</IllustrativeNote>
    </div>
  )
}

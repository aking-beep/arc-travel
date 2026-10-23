'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { DemoFigure, Money } from '@/components/money'
import { createTranslator, type AppLocale } from '@/lib/i18n'
import { estimateStay } from '@/modules/discovery/estimate'
import type { Room } from '@/modules/discovery/content/types'
import { IllustrativeNote } from './editorial'

/**
 * Estimate a stay from a published nightly rate.
 *
 * The export computed `nights × rate × rooms`, added a flat 12% tax and
 * labelled the result "Estimated total" — in float dollars, in the component.
 * The arithmetic moved to `estimateStay` in the module, in minor units, with
 * unit tests behind it. The invented tax line is gone: a 12% figure attached to
 * no jurisdiction and no rule is a number that looks like a quote, and this
 * surface is in no position to quote tax.
 *
 * `defaultArrive` and `defaultDepart` are computed on the server and passed in.
 * The export called `addDays(new Date(), 30)` during render, which is the
 * impure-read rule and would also have produced a server/client mismatch.
 */
export function StayEstimator({
  locale,
  rooms,
  currency,
  defaultArrive,
  defaultDepart,
  defaultParty,
  portalHref,
}: {
  locale: AppLocale
  rooms: Room[]
  currency: string
  defaultArrive: string
  defaultDepart: string
  defaultParty: number
  portalHref: string
}) {
  const t = createTranslator(locale)
  const [arrive, setArrive] = useState(defaultArrive)
  const [depart, setDepart] = useState(defaultDepart)
  const [party, setParty] = useState(defaultParty)
  const [roomIndex, setRoomIndex] = useState(0)

  const room = rooms[roomIndex]

  // The content set gives a room a `sleeps` figure but no count of how many of
  // that room exist, so the estimate is allowed as many as the party needs.
  const estimate = room
    ? estimateStay({
        arrive,
        depart,
        partySize: party,
        nightlyRateMinor: room.priceMinor,
        currency,
        maxOccupancy: room.sleeps,
        roomCount: Number.MAX_SAFE_INTEGER,
      })
    : null

  if (!room || !estimate) return null

  return (
    <div className="border-line bg-ivory rounded-3xl border p-6 shadow-xl">
      <p>
        <span className="text-3xl">
          <Money
            amountMinor={room.priceMinor}
            currency={currency}
            locale={locale}
            intent="potential"
          />
        </span>{' '}
        <span className="text-muted text-sm">
          {t('explore.stay.perNight')} · {room.name}
        </span>
      </p>

      <div className="border-line mt-5 grid grid-cols-2 overflow-hidden rounded-xl border">
        <label className="border-line border-r px-4 py-3">
          <span className="text-muted block text-xs">{t('explore.stay.arrive')}</span>
          <input
            type="date"
            value={arrive}
            onChange={(event) => {
              const next = event.target.value
              setArrive(next)
              if (depart <= next) setDepart(next)
            }}
            className="w-full bg-transparent text-sm outline-none"
          />
        </label>
        <label className="px-4 py-3">
          <span className="text-muted block text-xs">{t('explore.stay.depart')}</span>
          <input
            type="date"
            value={depart}
            min={arrive}
            onChange={(event) => setDepart(event.target.value)}
            className="w-full bg-transparent text-sm outline-none"
          />
        </label>
        <div className="border-line col-span-2 flex items-center justify-between border-t px-4 py-3">
          <span className="text-sm">{t('explore.stay.travellers')}</span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setParty((p) => Math.max(1, p - 1))}
              disabled={party <= 1}
              aria-label="Fewer travellers"
              className="border-line flex size-8 items-center justify-center rounded-full border disabled:opacity-40"
            >
              <Minus className="size-3.5" aria-hidden />
            </button>
            <span className="w-4 text-center tabular-nums">{party}</span>
            <button
              type="button"
              onClick={() => setParty((p) => Math.min(12, p + 1))}
              disabled={party >= 12}
              aria-label="More travellers"
              className="border-line flex size-8 items-center justify-center rounded-full border disabled:opacity-40"
            >
              <Plus className="size-3.5" aria-hidden />
            </button>
          </div>
        </div>
      </div>

      <fieldset className="mt-5">
        <legend className="text-muted mb-2 text-xs">{t('explore.stay.roomType')}</legend>
        <div className="divide-line border-line divide-y border-y" role="radiogroup">
          {rooms.map((option, index) => (
            <button
              key={option.name}
              type="button"
              role="radio"
              aria-checked={roomIndex === index}
              onClick={() => setRoomIndex(index)}
              className="grid w-full grid-cols-[20px_1fr_auto] items-center gap-3 py-3 text-left"
            >
              <span
                className={`flex size-5 items-center justify-center rounded-full border-2 ${
                  roomIndex === index ? 'border-ink' : 'border-line'
                }`}
              >
                {roomIndex === index ? <span className="bg-ink size-2.5 rounded-full" /> : null}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm">{option.name}</span>
                <span className="text-muted block text-xs">
                  {t('explore.stay.sleeps', { count: option.sleeps })} · {option.size}
                </span>
              </span>
              <span className="text-sm whitespace-nowrap">
                <Money
                  amountMinor={option.priceMinor}
                  currency={currency}
                  locale={locale}
                  intent="potential"
                />
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      {estimate.nights === 0 ? (
        <p className="text-muted mt-5 text-sm">{t('explore.stay.pickDates')}</p>
      ) : (
        <dl className="mt-5 space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted">
              {estimate.roomsNeeded > 1
                ? t('explore.stay.nightsLineRooms', {
                    nights: estimate.nights,
                    rooms: estimate.roomsNeeded,
                  })
                : t('explore.stay.nightsLine', { nights: estimate.nights })}
            </dt>
            <dd className="text-muted">
              <Money
                amountMinor={room.priceMinor}
                currency={currency}
                locale={locale}
                intent="potential"
              />
              {' / night'}
            </dd>
          </div>
          <div className="border-line flex items-baseline justify-between gap-3 border-t pt-3 font-medium">
            <dt>{t('explore.stay.estimateTotal')}</dt>
            <dd>
              <DemoFigure>
                <Money
                  amountMinor={estimate.total.amountMinor}
                  currency={estimate.total.currency}
                  locale={locale}
                  intent="potential"
                />
              </DemoFigure>
            </dd>
          </div>
        </dl>
      )}

      <Link
        href={portalHref}
        className="bg-ink text-ivory hover:bg-ink-soft mt-5 flex h-12 w-full items-center justify-center rounded-full text-sm transition-colors duration-150"
      >
        {t('explore.stay.enquireCta')}
      </Link>

      <IllustrativeNote className="mt-4">{t('explore.stay.estimateNote')}</IllustrativeNote>
    </div>
  )
}

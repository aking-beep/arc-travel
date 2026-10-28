'use client'

import { useEffect, useRef, useState } from 'react'
import { Users } from 'lucide-react'

import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState, ErrorState } from '@/components/ui/states'

/**
 * The town right now.
 *
 * The personas above are the scrutiny; this is the population. While the demo
 * is being used, simulated travellers arrive, fill baskets, buy seats and give
 * them back, businesses ask to work with the hotel, and the front desk checks
 * people in — all of it through the product's own services, so what an owner
 * sees in the briefing is what the product would really have produced.
 *
 * Polled on its own slow timer rather than folded into the persona feed: they
 * are different subjects with different lifetimes, and the town carries on
 * when no run is live.
 */
const POLL_MS = 10_000

interface Activity {
  id: string
  kind: string
  source: string
  actor: string
  summary: string
  detail: string | null
  path: string | null
  occurredAt: string
}

interface Town {
  population: number
  cap: number
  activity: Activity[]
}

/**
 * A tone per kind, from the design system's own set.
 *
 * Not hand-written colours: the sand and jade lightness values are set by
 * measured contrast (ADR-038), and a one-off `bg-teal-50` in one panel is how
 * a contrast decision gets made by accident.
 */
const TONE: Record<string, BadgeProps['tone']> = {
  ARRIVAL: 'brand',
  INTAKE: 'neutral',
  RESERVATION: 'brand',
  BASKET: 'neutral',
  PURCHASE: 'success',
  CANCELLATION: 'warning',
  JOIN_REQUEST: 'accent',
  CHECK_IN: 'brand',
  HORIZON: 'neutral',
  QUIET: 'demo',
}

export function TownPanel({ initial }: { initial: Town }) {
  const [town, setTown] = useState<Town>(initial)
  const [failed, setFailed] = useState(false)
  const inFlight = useRef(false)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      if (cancelled || inFlight.current) return
      if (document.visibilityState !== 'visible') return
      inFlight.current = true
      try {
        const response = await fetch('/api/simulation/town?limit=30', { cache: 'no-store' })
        if (!response.ok) throw new Error(String(response.status))
        const next = (await response.json()) as Town
        if (!cancelled) {
          setTown(next)
          setFailed(false)
        }
      } catch {
        if (!cancelled) setFailed(true)
      } finally {
        inFlight.current = false
      }
    }

    const timer = window.setInterval(() => void load(), POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="size-4" aria-hidden />
          The town right now
        </CardTitle>
        <Badge tone="demo">
          {town.population} of {town.cap} simulated trips
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {failed ? (
          <ErrorState description="The town could not be read just now. Still trying." />
        ) : null}

        {town.activity.length === 0 ? (
          <EmptyState
            title="Nothing yet"
            description="The scheduled clock runs every few minutes, and an open demo page nudges it along. The first arrivals show up here."
          />
        ) : (
          <ol className="max-h-[32rem] space-y-2 overflow-y-auto pr-1">
            {town.activity.map((row) => (
              <li
                key={row.id}
                className="border-sand-200 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl border px-3 py-2 text-sm"
              >
                <Badge tone={TONE[row.kind] ?? 'demo'}>
                  {row.kind.toLowerCase().replace('_', ' ')}
                </Badge>
                <span className="text-sand-800">{row.summary}</span>
                {row.detail ? (
                  <span className="text-sand-500 basis-full text-xs leading-relaxed">
                    {row.detail}
                  </span>
                ) : null}
                <span className="text-sand-400 ml-auto text-xs">
                  {new Date(row.occurredAt).toLocaleTimeString()} · {row.source}
                </span>
              </li>
            ))}
          </ol>
        )}

        <p className="text-sand-500 max-w-prose text-xs leading-relaxed">
          Every line above went through the same service your own clicks do — the conditions gate,
          the hold, the commission split, the audit row. Nothing is written straight into the
          database, which is why a refusal (&ldquo;the product said no&rdquo;) shows up here as an
          event rather than disappearing. Simulated people hold addresses at{' '}
          <code>sim.arcstay.demo</code> and never take the last couple of places on a departure, so
          there is always something left for you to book.
        </p>
      </CardContent>
    </Card>
  )
}

'use client'

import { useState } from 'react'
import { Moon, Sun, Sunset } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { ItineraryPreviewDay } from '@/modules/discovery/content/types'

/**
 * The tap-through day sketch on a destination page.
 *
 * The export cross-faded between days with framer-motion's `AnimatePresence`.
 * The panel simply swaps now: a 180ms fade on content a reader asked to see is
 * not worth a runtime dependency, and `prefers-reduced-motion` would have
 * removed it for some readers anyway.
 */
export function DaySketch({ days }: { days: ItineraryPreviewDay[] }) {
  const [index, setIndex] = useState(0)
  const plan = days[index]
  if (!plan) return null

  return (
    <>
      <div className="no-scrollbar mt-8 flex gap-2 overflow-x-auto" role="tablist">
        {days.map((day, i) => (
          <button
            key={day.title}
            type="button"
            role="tab"
            aria-selected={i === index}
            onClick={() => setIndex(i)}
            className={cn(
              'shrink-0 rounded-xl border px-4 py-3 text-left transition-colors duration-150',
              i === index ? 'bg-ivory border-ink' : 'border-line hover:border-ink',
            )}
          >
            <span className="text-muted block text-xs">Day {i + 1}</span>
            <span className="block text-sm whitespace-nowrap">{day.title}</span>
          </button>
        ))}
      </div>

      <div className="bg-line mt-6 grid gap-px overflow-hidden rounded-2xl md:grid-cols-3">
        {[
          { label: 'Morning', text: plan.morning, Icon: Sun },
          { label: 'Afternoon', text: plan.afternoon, Icon: Sunset },
          { label: 'Evening', text: plan.evening, Icon: Moon },
        ].map(({ label, text, Icon }) => (
          <div key={label} className="bg-ivory p-6">
            <p className="text-gold-deep flex items-center gap-2 text-xs">
              <Icon className="size-4" aria-hidden />
              {label}
            </p>
            <p className="mt-3 text-xl leading-snug">{text}</p>
          </div>
        ))}
      </div>
    </>
  )
}

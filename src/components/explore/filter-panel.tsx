'use client'

import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { cn } from '@/lib/cn'

export interface FilterGroup {
  id: string
  label: string
  options: string[]
  selected: string[]
  onToggle: (value: string) => void
}

/**
 * Sidebar on desktop, bottom sheet on phones.
 *
 * The export's sheet was a framer-motion drag gesture. This is a plain
 * fixed-position sheet with a close button and an Escape handler, which is
 * what the control needs to be operable; the drag was the only thing the
 * animation library was carrying here.
 */
export function FilterPanel({
  groups,
  children,
  onClear,
  activeCount,
  open,
  onClose,
  resultCount,
  labels,
}: {
  groups: FilterGroup[]
  children?: ReactNode
  onClear: () => void
  activeCount: number
  open: boolean
  onClose: () => void
  resultCount: number
  labels: { heading: string; clear: string; close: string; show: string }
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const body = (
    <div className="space-y-8">
      {children}
      {groups.map((group) => (
        <fieldset key={group.id}>
          <legend className="mb-3 text-sm font-medium">{group.label}</legend>
          <div className="space-y-1">
            {group.options.map((option) => (
              <label
                key={option}
                className="text-ink-soft flex cursor-pointer items-center gap-3 py-1.5 text-sm"
              >
                <input
                  type="checkbox"
                  checked={group.selected.includes(option)}
                  onChange={() => group.onToggle(option)}
                  className="accent-sage size-4 rounded"
                />
                {option}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {activeCount > 0 ? (
        <button
          type="button"
          onClick={onClear}
          className="text-gold-deep text-sm underline underline-offset-4"
        >
          {labels.clear} ({activeCount})
        </button>
      ) : null}
    </div>
  )

  return (
    <>
      <aside className="hidden w-64 shrink-0 lg:block" aria-label={labels.heading}>
        {body}
      </aside>

      {open ? (
        <div className="fixed inset-0 z-70 lg:hidden">
          <button
            type="button"
            aria-label={labels.close}
            className="bg-ink/40 absolute inset-0"
            onClick={onClose}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={labels.heading}
            className="bg-ivory absolute inset-x-0 bottom-0 flex max-h-[85%] flex-col rounded-t-3xl"
          >
            <div className="border-line flex items-center justify-between border-b px-5 pt-3 pb-4">
              <p className="mt-2 text-xl">{labels.heading}</p>
              <button
                type="button"
                onClick={onClose}
                className="mt-2 flex size-10 items-center justify-center"
                aria-label={labels.close}
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-6">{body}</div>
            <div className="border-line border-t p-4">
              <button
                type="button"
                onClick={onClose}
                className="bg-ink text-ivory h-12 w-full rounded-full text-sm"
              >
                {labels.show.replace('{count}', String(resultCount))}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

/** A labelled range control, used for the price and duration ceilings. */
export function RangeField({
  label,
  value,
  min,
  max,
  stepSize,
  onChange,
  format,
}: {
  label: string
  value: number
  min: number
  max: number
  stepSize: number
  onChange: (value: number) => void
  format: (value: number) => ReactNode
}) {
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className={cn('text-muted text-sm tabular-nums')}>{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={stepSize}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="accent-sage w-full"
        aria-label={label}
      />
    </div>
  )
}

'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { MapPin, Minus, Plus, Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import { createTranslator, type AppLocale } from '@/lib/i18n'
import { destinations } from '@/modules/discovery/content/destinations'
import { TRAVEL_STYLES } from '@/modules/discovery/content/types'

export interface SearchValues {
  q: string
  from: string
  to: string
  guests: number
  style: string
}

/**
 * The hero search.
 *
 * The suggestion list is the reason this is a client component. Two changes
 * from the export: navigation goes through `useRouter().push` rather than
 * react-router's `useNavigate`, and the dropdown appears and disappears
 * without an animation library.
 *
 * Note what it does *not* do: nothing here checks availability. The dates and
 * party size are carried into `/explore/search` as filter inputs, and the
 * results page says as much. A date picker that implied a booking lookup
 * behind it would be claiming something this surface cannot know.
 */
export function SearchBar({
  locale,
  initial,
  variant = 'hero',
  onSearch,
}: {
  locale: AppLocale
  initial?: Partial<SearchValues>
  variant?: 'hero' | 'inline'
  onSearch?: (values: SearchValues) => void
}) {
  const t = createTranslator(locale)
  const router = useRouter()
  const [values, setValues] = useState<SearchValues>({
    q: '',
    from: '',
    to: '',
    guests: 2,
    style: '',
    ...initial,
  })
  const [focused, setFocused] = useState(false)
  const blurTimer = useRef<number | undefined>(undefined)

  const suggestions = useMemo(() => {
    const query = values.q.trim().toLowerCase()
    return destinations
      .filter(
        (d) =>
          !query ||
          `${d.name} ${d.country} ${d.region}`.toLowerCase().includes(query),
      )
      .slice(0, 6)
  }, [values.q])

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (onSearch) {
      onSearch(values)
      return
    }
    const params = new URLSearchParams()
    if (values.q) params.set('q', values.q)
    if (values.from) params.set('from', values.from)
    if (values.to) params.set('to', values.to)
    params.set('guests', String(values.guests))
    if (values.style) params.set('style', values.style)
    router.push(`/explore/search?${params.toString()}`)
  }

  return (
    <form
      onSubmit={submit}
      role="search"
      className={cn(
        'grid grid-cols-2 gap-1 rounded-2xl p-2 lg:grid-cols-[1.5fr_1fr_1fr_0.9fr_1.1fr_auto] lg:items-center lg:rounded-full',
        variant === 'hero'
          ? 'bg-ivory text-ink shadow-2xl'
          : 'bg-ivory text-ink border-line border',
      )}
    >
      <div className="relative col-span-2 lg:col-span-1">
        <SearchField label="Where">
          <input
            value={values.q}
            onChange={(event) => setValues({ ...values, q: event.target.value })}
            onFocus={() => {
              window.clearTimeout(blurTimer.current)
              setFocused(true)
            }}
            // A click on a suggestion fires after blur, so closing is deferred.
            onBlur={() => {
              blurTimer.current = window.setTimeout(() => setFocused(false), 120)
            }}
            placeholder={t('explore.experiences.searchPlaceholder')}
            className="placeholder:text-muted w-full bg-transparent text-[15px] outline-none"
            aria-label="Destination"
          />
        </SearchField>
        {focused && suggestions.length > 0 ? (
          <ul className="bg-ivory border-line absolute top-full right-0 left-0 z-30 mt-2 rounded-xl border py-2 shadow-xl lg:right-auto lg:w-80">
            {suggestions.map((destination) => (
              <li key={destination.slug}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setValues({ ...values, q: destination.name })
                    setFocused(false)
                  }}
                  className="hover:bg-paper flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-100"
                >
                  <MapPin className="text-gold-deep size-4 shrink-0" aria-hidden />
                  <span className="text-sm">
                    {destination.name}
                    <span className="text-muted">, {destination.country}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <SearchField label={t('explore.stay.arrive')} divider>
        <input
          type="date"
          value={values.from}
          onChange={(event) =>
            setValues({
              ...values,
              from: event.target.value,
              to: values.to && values.to < event.target.value ? '' : values.to,
            })
          }
          className="w-full bg-transparent text-sm outline-none"
          aria-label={t('explore.stay.arrive')}
        />
      </SearchField>

      <SearchField label={t('explore.stay.depart')} divider>
        <input
          type="date"
          value={values.to}
          min={values.from || undefined}
          onChange={(event) => setValues({ ...values, to: event.target.value })}
          className="w-full bg-transparent text-sm outline-none"
          aria-label={t('explore.stay.depart')}
        />
      </SearchField>

      <SearchField label={t('explore.stay.travellers')} divider>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Fewer travellers"
            onClick={() => setValues({ ...values, guests: Math.max(1, values.guests - 1) })}
            className="border-line hover:border-ink flex size-7 items-center justify-center rounded-full border transition-colors duration-150"
          >
            <Minus className="size-3" aria-hidden />
          </button>
          <span className="w-4 text-center text-sm tabular-nums">{values.guests}</span>
          <button
            type="button"
            aria-label="More travellers"
            onClick={() => setValues({ ...values, guests: Math.min(12, values.guests + 1) })}
            className="border-line hover:border-ink flex size-7 items-center justify-center rounded-full border transition-colors duration-150"
          >
            <Plus className="size-3" aria-hidden />
          </button>
        </div>
      </SearchField>

      <SearchField label="Travel style" divider>
        <select
          value={values.style}
          onChange={(event) => setValues({ ...values, style: event.target.value })}
          className="w-full cursor-pointer appearance-none bg-transparent text-sm outline-none"
          aria-label="Travel style"
        >
          <option value="">Any style</option>
          {TRAVEL_STYLES.map((style) => (
            <option key={style} value={style}>
              {style}
            </option>
          ))}
        </select>
      </SearchField>

      <button
        type="submit"
        className="bg-ink text-ivory hover:bg-ink-soft col-span-2 mt-1 flex h-12 items-center justify-center gap-2 rounded-xl transition-colors duration-150 lg:col-span-1 lg:mt-0 lg:h-14 lg:w-14 lg:rounded-full xl:w-auto xl:px-6"
      >
        <Search className="size-4" aria-hidden />
        <span className="text-sm lg:hidden xl:inline">{t('explore.experiences.search')}</span>
      </button>
    </form>
  )
}

function SearchField({
  label,
  children,
  divider,
}: {
  label: string
  children: ReactNode
  divider?: boolean
}) {
  return (
    <label
      className={cn(
        'hover:bg-paper block cursor-text rounded-xl px-4 py-2.5 transition-colors duration-150 lg:rounded-full',
        divider && 'lg:border-line lg:rounded-none lg:border-l lg:hover:bg-transparent',
      )}
    >
      <span className="text-muted mb-0.5 block text-[11px] font-medium">{label}</span>
      {children}
    </label>
  )
}

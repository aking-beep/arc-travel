/**
 * Date helpers for a single-destination product.
 *
 * Everything the guest sees is in the property's local timezone
 * (America/Mexico_City for Puerto Escondido, UTC-6, no DST since 2022).
 * Calendar days are stored as `@db.Date` and handled as `YYYY-MM-DD` strings so
 * no timezone conversion can shift a day boundary.
 */
export type DateKey = string // YYYY-MM-DD

export function toDateKey(d: Date | string): DateKey {
  if (typeof d === 'string') return d.slice(0, 10)
  return d.toISOString().slice(0, 10)
}

/**
 * Whether an untrusted string really is a calendar day.
 *
 * `YYYY-MM-DD` shaped *and* a real date, so "2026-02-31" and "2026-13-01" are
 * refused rather than silently rolled forward by `Date`. For query strings and
 * anywhere else a `DateKey` arrives from outside the product; a value that
 * fails this belongs in a fallback, not in a date.
 */
export function isDateKey(value: unknown): value is DateKey {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/** Midnight UTC for a calendar day — the canonical form for a `@db.Date`. */
export function fromDateKey(key: DateKey): Date {
  return new Date(`${key}T00:00:00.000Z`)
}

export function addDays(key: DateKey, days: number): DateKey {
  const d = fromDateKey(key)
  d.setUTCDate(d.getUTCDate() + days)
  return toDateKey(d)
}

export function daysBetween(from: DateKey, to: DateKey): number {
  const ms = fromDateKey(to).getTime() - fromDateKey(from).getTime()
  return Math.round(ms / 86_400_000)
}

export function dateRange(from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = []
  const span = daysBetween(from, to)
  for (let i = 0; i <= span; i += 1) out.push(addDays(from, i))
  return out
}

export function monthOf(key: DateKey): number {
  return Number(key.slice(5, 7))
}

/** "HH:MM" -> minutes since local midnight. */
export function parseTime(hhmm: string): number {
  const [h, m] = hhmm.split(':')
  const hours = Number(h)
  const minutes = Number(m ?? '0')
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    throw new Error(`Invalid time "${hhmm}", expected HH:MM.`)
  }
  return hours * 60 + minutes
}

export function formatTime(minutesSinceMidnight: number): string {
  const wrapped = ((minutesSinceMidnight % 1440) + 1440) % 1440
  const h = Math.floor(wrapped / 60)
  const m = wrapped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Combines a calendar day and local wall time into a UTC instant. */
export function localInstant(key: DateKey, hhmm: string, utcOffsetHours = -6): Date {
  const minutes = parseTime(hhmm)
  const base = fromDateKey(key).getTime()
  return new Date(base + (minutes - utcOffsetHours * 60) * 60_000)
}

export function toLocalTimeString(instant: Date, utcOffsetHours = -6): string {
  const shifted = new Date(instant.getTime() + utcOffsetHours * 3_600_000)
  return formatTime(shifted.getUTCHours() * 60 + shifted.getUTCMinutes())
}

export function toLocalDateKey(instant: Date, utcOffsetHours = -6): DateKey {
  return toDateKey(new Date(instant.getTime() + utcOffsetHours * 3_600_000))
}

export const PUERTO_ESCONDIDO_UTC_OFFSET = -6

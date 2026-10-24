import { invalid } from '@/lib/errors'
import { monthOf, parseTime, type DateKey } from '@/lib/dates'

/**
 * An activity's operating window: the hours it may depart in and the months it
 * runs at all.
 *
 * This lived inline in `scoreCandidate` and nowhere else, which meant the
 * window shaped the *recommendation* and nothing else. A dawn-only surf session
 * scheduled at 23:00 was excluded from every generated itinerary and remained
 * fully purchasable from the experience page — the same split between the
 * recommendation gate and the commitment gate that ADR-019 exists to close,
 * reopened on the time axis instead of the ability axis.
 *
 * So the rule is one pure function with four callers, in two layers:
 *   * `addSlot` and `scheduleAvailability` refuse to create the bad row.
 *   * `evaluateSlotForGuest` (and so `addToCart`) and `scoreCandidate` refuse
 *     the rows that already exist.
 *
 * Both layers, not one. Validation stops new rows; the gate protects guests
 * from the rows a seed, an import or an earlier build already wrote.
 */
export interface OperatingWindow {
  /** Earliest permitted departure time, "HH:MM" local. */
  earliestStart: string
  /** Latest permitted departure time, "HH:MM" local. */
  latestStart: string
  /** Months the activity runs, 1–12. */
  seasonMonths: number[]
}

export interface OperatingWindowGate {
  allowed: boolean
  /** Machine-readable exclusion codes, shared with the conditions gate. */
  exclusions: string[]
  /** Deterministic guest-facing sentences. */
  notes: string[]
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

const monthName = (month: number): string => MONTH_NAMES[month - 1] ?? `month ${month}`

/** Whether a departure time falls inside the window's hours. */
export function isWithinHours(window: OperatingWindow, startTime: string): boolean {
  const start = parseTime(startTime)
  return start >= parseTime(window.earliestStart) && start <= parseTime(window.latestStart)
}

/** Whether a calendar day falls in a month the activity runs in. */
export function isInSeason(window: OperatingWindow, forDate: DateKey): boolean {
  return window.seasonMonths.includes(monthOf(forDate))
}

/**
 * The pure gate. Mirrors `gateByConditions`'s shape so a caller can merge the
 * two without special-casing either.
 */
export function gateByOperatingWindow(input: {
  window: OperatingWindow
  startTime: string
  forDate: DateKey
}): OperatingWindowGate {
  const exclusions: string[] = []
  const notes: string[] = []
  const { window } = input

  if (!isWithinHours(window, input.startTime)) {
    exclusions.push('outside_activity_operating_window')
    notes.push(
      `This activity departs between ${window.earliestStart} and ${window.latestStart}; this departure is listed at ${input.startTime}.`,
    )
  }

  if (!isInSeason(window, input.forDate)) {
    exclusions.push('out_of_season')
    notes.push(`This activity does not run in ${monthName(monthOf(input.forDate))}.`)
  }

  return { allowed: exclusions.length === 0, exclusions, notes }
}

/**
 * Write-path guard. Throws rather than returning a gate, because a departure
 * outside the window is bad input, not an unsuitable offer.
 */
export function assertWithinOperatingWindow(input: {
  window: OperatingWindow
  startTime: string
  forDate: DateKey
}): void {
  const gate = gateByOperatingWindow(input)
  if (gate.allowed) return
  throw invalid(gate.notes[0] ?? 'That departure falls outside the activity’s operating window.', {
    exclusions: gate.exclusions,
    notes: gate.notes,
  })
}

/**
 * What a simulated person's decisions cost.
 *
 * The personas are scripted in the sense that their goals and their invariants
 * are written down; what they *do* next is decided by a model, one call per
 * step. That is the whole bill, and it is the reason this file exists: a
 * dashboard that runs agents for as long as it is open has to be able to say
 * what it has spent and to stop when it reaches a ceiling.
 *
 * ## Units
 *
 * Nanodollars, as integers. Published prices are dollars per million tokens,
 * so dollars-per-million × 1000 is nanodollars per token exactly — including
 * for the cheapest model, where microdollars would have been 0.1 per token and
 * floating-point would have crept into the only number the cap is read from.
 * Storage is USD cents (`spentMinor`), converted once, at the edge, by
 * `nanosToMinor` — the same shape as `pesosToMinor` and for the same reason
 * (non-negotiable 3).
 *
 * ## Why the table is here and not in the runner
 *
 * The runner decides when to stop and the dashboard reports what was spent. If
 * each had its own copy of the prices, the two would disagree and the
 * disagreement would be invisible: the feed would show a figure the cap was
 * never compared against.
 */

/** 1 cent = 10,000,000 nanodollars. */
export const NANOS_PER_MINOR = 10_000_000

export interface TokenPrice {
  /** Nanodollars per input token. */
  readonly inputNanos: number
  /** Nanodollars per output token. */
  readonly outputNanos: number
}

/**
 * The models a simulation may run on, cheapest first.
 *
 * A closed list rather than a free-text model name: an unknown model has no
 * price, and a run whose spend cannot be computed is a run with no cap.
 */
export const SIMULATION_MODELS = {
  'claude-haiku-5-5': { inputNanos: 100, outputNanos: 500 },
  'claude-sonnet-5-5': { inputNanos: 2_000, outputNanos: 10_000 },
  'claude-opus-5-5': { inputNanos: 4_000, outputNanos: 20_000 },
} as const satisfies Record<string, TokenPrice>

export type SimulationModel = keyof typeof SIMULATION_MODELS

export const SIMULATION_MODEL_IDS = Object.keys(SIMULATION_MODELS) as SimulationModel[]

/** The default: enough judgement to improvise a journey, an eighth of Opus. */
export const DEFAULT_SIMULATION_MODEL: SimulationModel = 'claude-sonnet-5-5'

export function isSimulationModel(value: unknown): value is SimulationModel {
  return typeof value === 'string' && value in SIMULATION_MODELS
}

export function priceOf(model: SimulationModel): TokenPrice {
  return SIMULATION_MODELS[model]
}

export interface TokenUsage {
  readonly inputTokens: number
  readonly outputTokens: number
}

/** The cost of one call, in nanodollars. Integer in, integer out. */
export function costNanos(model: SimulationModel, usage: TokenUsage): number {
  const price = priceOf(model)
  return usage.inputTokens * price.inputNanos + usage.outputTokens * price.outputNanos
}

/**
 * Nanodollars to whole cents, rounded up.
 *
 * Up, not nearest: the figure is read against a ceiling, and a cap that
 * rounds spend down lets a long run of sub-cent decisions cost more than the
 * number beside it says. The same instinct as `splitByBps` giving the
 * remainder to the supplier — decide which way the remainder goes, and say so.
 */
export function nanosToMinor(nanos: number): number {
  if (!Number.isFinite(nanos) || nanos <= 0) return 0
  return Math.ceil(nanos / NANOS_PER_MINOR)
}

/** USD cents as `$1.23`, for the spend meter. Never a product price. */
export function formatUsdMinor(minor: number): string {
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(Math.trunc(minor))
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/**
 * What an hour of this costs, roughly, for the operator choosing a model.
 *
 * Deliberately a range and deliberately labelled an estimate: it is the one
 * number somebody decides a budget from, and a single confident figure would
 * be the least honest way to present it. Derived from the real price table and
 * a measured decision shape, so it moves when the prices do.
 */
export function estimateHourlyMinor(
  model: SimulationModel,
  decisionsPerHour: number,
  shape: TokenUsage = TYPICAL_DECISION,
): number {
  return nanosToMinor(costNanos(model, shape) * Math.max(0, Math.trunc(decisionsPerHour)))
}

/**
 * One decision, measured: the persona brief and page observation in, a short
 * structured action out. Cached prefixes are not assumed — an estimate that
 * assumes the best case is an estimate that under-reports the bill.
 */
export const TYPICAL_DECISION: TokenUsage = { inputTokens: 6_000, outputTokens: 400 }

/** Decisions an hour at the pace a real browser allows. */
export const TYPICAL_DECISIONS_PER_HOUR = 420

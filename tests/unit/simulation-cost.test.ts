import { describe, expect, it } from 'vitest'

import {
  costNanos,
  estimateHourlyMinor,
  formatUsdMinor,
  nanosToMinor,
  NANOS_PER_MINOR,
  priceOf,
  SIMULATION_MODEL_IDS,
  TYPICAL_DECISION,
} from '@/modules/simulation/pricing'

/**
 * What a run costs.
 *
 * This arithmetic is the whole of the spend ceiling: the runner reports tokens,
 * this turns them into money, and the deployment compares the money with the
 * budget. A rounding decision made the wrong way here is a dashboard that runs
 * past the number beside it, which is the failure the budget exists to prevent.
 */
describe('simulation pricing', () => {
  it('prices every model in whole nanodollars', () => {
    for (const model of SIMULATION_MODEL_IDS) {
      const price = priceOf(model)
      expect(Number.isInteger(price.inputNanos)).toBe(true)
      expect(Number.isInteger(price.outputNanos)).toBe(true)
      expect(price.inputNanos).toBeGreaterThan(0)
      // Output is dearer than input on every published price. If that ever
      // stops being true the table has been transcribed wrongly.
      expect(price.outputNanos).toBeGreaterThan(price.inputNanos)
    }
  })

  it('computes a call exactly, with no floating point in the way', () => {
    // Sonnet: $2/M in, $10/M out.
    const nanos = costNanos('claude-sonnet-5-5', { inputTokens: 6_000, outputTokens: 400 })
    expect(nanos).toBe(6_000 * 2_000 + 400 * 10_000)
    expect(Number.isInteger(nanos)).toBe(true)
  })

  it('prices the cheapest model without losing a fraction of a token', () => {
    // Haiku input is $0.10/M — a tenth of a microdollar a token, which is why
    // the unit is nanodollars and not microdollars.
    expect(costNanos('claude-haiku-5-5', { inputTokens: 1, outputTokens: 0 })).toBe(100)
  })

  it('rounds spend up, never down', () => {
    expect(nanosToMinor(1)).toBe(1)
    expect(nanosToMinor(NANOS_PER_MINOR)).toBe(1)
    expect(nanosToMinor(NANOS_PER_MINOR + 1)).toBe(2)
    expect(nanosToMinor(0)).toBe(0)
    expect(nanosToMinor(-5)).toBe(0)
  })

  it('never reports a spend below what was actually spent', () => {
    // The property the ceiling depends on: a thousand sub-cent decisions must
    // not round away to less than they cost.
    const perCall = costNanos('claude-haiku-5-5', TYPICAL_DECISION)
    const total = perCall * 1_000
    expect(nanosToMinor(total) * NANOS_PER_MINOR).toBeGreaterThanOrEqual(total)
  })

  it('orders the hourly estimates the way the prices do', () => {
    const haiku = estimateHourlyMinor('claude-haiku-5-5', 420)
    const sonnet = estimateHourlyMinor('claude-sonnet-5-5', 420)
    const opus = estimateHourlyMinor('claude-opus-5-5', 420)
    expect(haiku).toBeLessThan(sonnet)
    expect(sonnet).toBeLessThan(opus)
    // An hour of the default model is dollars, not cents and not hundreds.
    expect(sonnet).toBeGreaterThan(100)
    expect(sonnet).toBeLessThan(10_000)
  })

  it('formats dollars without pretending to be product money', () => {
    expect(formatUsdMinor(0)).toBe('$0.00')
    expect(formatUsdMinor(5)).toBe('$0.05')
    expect(formatUsdMinor(1_234)).toBe('$12.34')
  })
})

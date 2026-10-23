import { describe, expect, it } from 'vitest'
import {
  estimateExperience,
  estimateStay,
  nightlyRateRange,
  type EstimateInput,
} from '@/modules/discovery/estimate'

const base: EstimateInput = {
  arrive: '2026-11-14',
  depart: '2026-11-19',
  partySize: 2,
  nightlyRateMinor: 240_000,
  currency: 'MXN',
  maxOccupancy: 2,
  roomCount: 4,
}

describe('estimateStay', () => {
  it('multiplies the nightly rate by nights and rooms, in minor units', () => {
    const estimate = estimateStay(base)
    expect(estimate.nights).toBe(5)
    expect(estimate.roomsNeeded).toBe(1)
    expect(estimate.total.amountMinor).toBe(1_200_000)
    expect(estimate.total.currency).toBe('MXN')
  })

  it('splits a party across rooms at the stated occupancy', () => {
    const estimate = estimateStay({ ...base, partySize: 5 })
    expect(estimate.roomsNeeded).toBe(3)
    expect(estimate.total.amountMinor).toBe(240_000 * 5 * 3)
  })

  it('totals zero when the party cannot be housed at all', () => {
    const estimate = estimateStay({ ...base, partySize: 12, roomCount: 2 })
    expect(estimate.exceedsOccupancy).toBe(true)
    expect(estimate.total.amountMinor).toBe(0)
  })

  it('totals zero for a same-day arrival and departure', () => {
    const estimate = estimateStay({ ...base, depart: base.arrive })
    expect(estimate.nights).toBe(0)
    expect(estimate.total.amountMinor).toBe(0)
  })

  it('throws rather than clamping on nonsense input', () => {
    // A clamp is how a zero-night estimate becomes a plausible-looking total.
    expect(() => estimateStay({ ...base, depart: '2026-11-10' })).toThrow(/before arrival/)
    expect(() => estimateStay({ ...base, partySize: 0 })).toThrow(/Party size/)
    expect(() => estimateStay({ ...base, partySize: 2.5 })).toThrow(/Party size/)
    expect(() => estimateStay({ ...base, maxOccupancy: 0 })).toThrow(/occupancy/)
    expect(() => estimateStay({ ...base, nightlyRateMinor: -1 })).toThrow(/minor units/)
    expect(() => estimateStay({ ...base, nightlyRateMinor: 1_200.5 })).toThrow(/minor units/)
  })
})

describe('nightlyRateRange', () => {
  it('reports the cheapest and dearest published rate', () => {
    const range = nightlyRateRange([
      { baseRateMinor: 780_000, currency: 'MXN' },
      { baseRateMinor: 240_000, currency: 'MXN' },
      { baseRateMinor: 410_000, currency: 'MXN' },
    ])
    expect(range?.min.amountMinor).toBe(240_000)
    expect(range?.max.amountMinor).toBe(780_000)
  })

  it('is null, not zero, for a property with nothing priced', () => {
    // "from $0" on a card is worse than a card with no price on it.
    expect(nightlyRateRange([])).toBeNull()
    expect(nightlyRateRange([{ baseRateMinor: 0, currency: 'MXN' }])).toBeNull()
  })
})

describe('estimateExperience', () => {
  it('charges the per-person price per head and the fee once', () => {
    const total = estimateExperience({
      amountMinor: 95_000,
      bookingFeeMinor: 5_000,
      currency: 'MXN',
      partySize: 3,
    })
    expect(total.amountMinor).toBe(95_000 * 3 + 5_000)
  })

  it('rejects a party that is not a positive whole number', () => {
    expect(() =>
      estimateExperience({ amountMinor: 1, bookingFeeMinor: 0, currency: 'MXN', partySize: 0 }),
    ).toThrow(/Party size/)
  })
})

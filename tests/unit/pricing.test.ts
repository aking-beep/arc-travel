import { describe, expect, it } from 'vitest'
import { PriceKind } from '@/lib/prisma-types'
import {
  computeCartTotals,
  computeLinePrice,
  computeRefund,
  selectPrice,
  type PriceRow,
} from '@/modules/commerce/pricing'

const PAST = new Date('2026-01-01T00:00:00Z')
const NOW = new Date('2026-06-01T00:00:00Z')

function price(partial: Partial<PriceRow>): PriceRow {
  return {
    id: 'price',
    kind: PriceKind.BASE,
    amountMinor: 95_000,
    bookingFeeMinor: 0,
    currency: 'MXN',
    minParty: 1,
    validFrom: PAST,
    validTo: null,
    isActive: true,
    ...partial,
  }
}

describe('selectPrice', () => {
  it('throws when nothing is eligible', () => {
    expect(() => selectPrice([], { quantity: 2, at: NOW })).toThrow(/no active price/)
  })

  it('ignores inactive, future and expired rows', () => {
    const rows = [
      price({ id: 'inactive', isActive: false, amountMinor: 1 }),
      price({ id: 'future', validFrom: new Date('2027-01-01Z'), amountMinor: 2 }),
      price({ id: 'expired', validTo: new Date('2026-02-01Z'), amountMinor: 3 }),
      price({ id: 'current', amountMinor: 95_000 }),
    ]
    expect(selectPrice(rows, { quantity: 1, at: NOW }).id).toBe('current')
  })

  it('ignores a group tier the party is too small for', () => {
    const rows = [
      price({ id: 'base' }),
      price({ id: 'group', kind: PriceKind.GROUP, minParty: 4, amountMinor: 83_600 }),
    ]
    expect(selectPrice(rows, { quantity: 2, at: NOW }).id).toBe('base')
    expect(selectPrice(rows, { quantity: 4, at: NOW }).id).toBe('group')
  })

  it('prefers a promo over a group tier the party also qualifies for', () => {
    const rows = [
      price({ id: 'base' }),
      price({ id: 'group', kind: PriceKind.GROUP, minParty: 4, amountMinor: 83_600 }),
      price({ id: 'promo', kind: PriceKind.PROMO, amountMinor: 70_000 }),
    ]
    expect(selectPrice(rows, { quantity: 5, at: NOW }).id).toBe('promo')
  })

  it('prefers the more specific group tier when two apply', () => {
    const rows = [
      price({ id: 'group-4', kind: PriceKind.GROUP, minParty: 4, amountMinor: 85_000 }),
      price({ id: 'group-8', kind: PriceKind.GROUP, minParty: 8, amountMinor: 75_000 }),
    ]
    expect(selectPrice(rows, { quantity: 9, at: NOW }).id).toBe('group-8')
    expect(selectPrice(rows, { quantity: 5, at: NOW }).id).toBe('group-4')
  })
})

describe('computeLinePrice', () => {
  it('charges per person and adds the booking fee once', () => {
    const line = computeLinePrice({
      prices: [price({ amountMinor: 125_000, bookingFeeMinor: 15_000 })],
      quantity: 3,
      currency: 'MXN',
      at: NOW,
    })
    expect(line.unitPriceMinor).toBe(125_000)
    expect(line.bookingFeeMinor).toBe(15_000)
    expect(line.lineTotalMinor).toBe(125_000 * 3 + 15_000)
  })

  it('lets a slot override beat every price row, and carries no booking fee', () => {
    const line = computeLinePrice({
      prices: [price({ amountMinor: 95_000, bookingFeeMinor: 15_000 })],
      quantity: 2,
      slotPriceOverrideMinor: 50_000,
      currency: 'MXN',
      at: NOW,
    })
    expect(line.source).toBe('slot-override')
    expect(line.lineTotalMinor).toBe(100_000)
    expect(line.bookingFeeMinor).toBe(0)
    expect(line.priceId).toBeNull()
  })

  it('treats a zero override as an override, not as absent', () => {
    const line = computeLinePrice({
      prices: [price({ amountMinor: 95_000 })],
      quantity: 2,
      slotPriceOverrideMinor: 0,
      currency: 'MXN',
      at: NOW,
    })
    expect(line.source).toBe('slot-override')
    expect(line.lineTotalMinor).toBe(0)
  })

  it('rejects a non-positive or fractional quantity', () => {
    for (const quantity of [0, -1, 1.5]) {
      expect(() =>
        computeLinePrice({ prices: [price({})], quantity, currency: 'MXN', at: NOW }),
      ).toThrow(/positive whole number/)
    }
  })

  it('refuses a currency mismatch rather than converting', () => {
    expect(() =>
      computeLinePrice({
        prices: [price({ currency: 'USD' })],
        quantity: 1,
        currency: 'MXN',
        at: NOW,
      }),
    ).toThrow(/USD.*MXN/)
  })
})

describe('computeCartTotals', () => {
  it('sums line subtotals and fees separately', () => {
    const totals = computeCartTotals([
      { unitPriceMinor: 95_000, quantity: 2, bookingFeeMinor: 0 },
      { unitPriceMinor: 125_000, quantity: 1, bookingFeeMinor: 15_000 },
    ])
    expect(totals.subtotalMinor).toBe(315_000)
    expect(totals.feesMinor).toBe(15_000)
    expect(totals.totalMinor).toBe(330_000)
  })

  it('is zero for an empty cart', () => {
    expect(computeCartTotals([])).toEqual({
      subtotalMinor: 0,
      feesMinor: 0,
      totalMinor: 0,
      currency: 'MXN',
    })
  })
})

describe('computeRefund', () => {
  const startsAt = new Date('2026-06-10T15:00:00Z')

  it('refunds in full inside the window', () => {
    const result = computeRefund({
      lineTotalMinor: 190_000,
      currency: 'MXN',
      startsAt,
      cancellationPolicyHours: 24,
      now: new Date('2026-06-09T09:00:00Z'),
    })
    expect(result.withinWindow).toBe(true)
    expect(result.refundMinor).toBe(190_000)
  })

  it('refunds nothing outside the window', () => {
    const result = computeRefund({
      lineTotalMinor: 190_000,
      currency: 'MXN',
      startsAt,
      cancellationPolicyHours: 24,
      now: new Date('2026-06-10T09:00:00Z'),
    })
    expect(result.withinWindow).toBe(false)
    expect(result.refundMinor).toBe(0)
  })

  it('treats the boundary as still inside the window', () => {
    const result = computeRefund({
      lineTotalMinor: 100,
      currency: 'MXN',
      startsAt,
      cancellationPolicyHours: 24,
      now: new Date('2026-06-09T15:00:00Z'),
    })
    expect(result.withinWindow).toBe(true)
    expect(result.hoursUntilStart).toBe(24)
  })

  it('refunds nothing after the departure has already run', () => {
    const result = computeRefund({
      lineTotalMinor: 100,
      currency: 'MXN',
      startsAt,
      cancellationPolicyHours: 0,
      now: new Date('2026-06-11T00:00:00Z'),
    })
    expect(result.refundMinor).toBe(0)
    expect(result.hoursUntilStart).toBeLessThan(0)
  })
})

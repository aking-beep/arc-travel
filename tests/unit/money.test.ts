import { describe, expect, it } from 'vitest'
import {
  add,
  applyBps,
  formatMoney,
  money,
  multiply,
  splitByBps,
  subtract,
  sum,
  zero,
} from '@/lib/money'

describe('money', () => {
  it('truncates to whole minor units', () => {
    expect(money(1050.7).amountMinor).toBe(1050)
  })

  it('refuses to mix currencies', () => {
    expect(() => add(money(100, 'MXN'), money(100, 'USD'))).toThrow(/Cannot combine/)
    expect(() => subtract(money(100, 'MXN'), money(100, 'USD'))).toThrow(/Cannot combine/)
  })

  it('adds, subtracts and sums', () => {
    expect(add(money(1000), money(250)).amountMinor).toBe(1250)
    expect(subtract(money(1000), money(250)).amountMinor).toBe(750)
    expect(sum([money(100), money(200), money(300)]).amountMinor).toBe(600)
    expect(sum([]).amountMinor).toBe(zero().amountMinor)
  })

  it('rejects fractional and negative quantities', () => {
    expect(() => multiply(money(100), 1.5)).toThrow(/non-negative integer/)
    expect(() => multiply(money(100), -1)).toThrow(/non-negative integer/)
    expect(multiply(money(95_000), 3).amountMinor).toBe(285_000)
  })

  describe('applyBps', () => {
    it('rounds half up, the way an operator checking by hand would', () => {
      // 1 centavo at 50% is exactly 0.5 — half-up gives 1, not 0.
      expect(applyBps(money(1), 5000).amountMinor).toBe(1)
      expect(applyBps(money(3), 5000).amountMinor).toBe(2)
      expect(applyBps(money(95_000), 1500).amountMinor).toBe(14_250)
    })

    it('rejects out-of-range basis points', () => {
      expect(() => applyBps(money(100), -1)).toThrow(/\[0, 10000\]/)
      expect(() => applyBps(money(100), 10_001)).toThrow(/\[0, 10000\]/)
      expect(() => applyBps(money(100), 15.5)).toThrow(/\[0, 10000\]/)
    })
  })

  describe('splitByBps', () => {
    it('always re-sums to the whole', () => {
      // 1000 centavos split 15/5/80 is exact; 1001 is not.
      for (const total of [1000, 1001, 999, 7, 1, 123_457]) {
        const parts = splitByBps(
          money(total),
          [
            { key: 'hotel', bps: 1500 },
            { key: 'platform', bps: 500 },
            { key: 'supplier', bps: 8000 },
          ],
          'supplier',
        )
        const resummed =
          (parts.hotel?.amountMinor ?? 0) +
          (parts.platform?.amountMinor ?? 0) +
          (parts.supplier?.amountMinor ?? 0)
        expect(resummed).toBe(total)
      }
    })

    it('gives the rounding remainder to the nominated share', () => {
      const parts = splitByBps(
        money(7),
        [
          { key: 'a', bps: 3333 },
          { key: 'b', bps: 3333 },
          { key: 'c', bps: 3334 },
        ],
        'c',
      )
      expect(parts.a?.amountMinor).toBe(2)
      expect(parts.b?.amountMinor).toBe(2)
      expect(parts.c?.amountMinor).toBe(3)
    })

    it('rejects shares over 100% and an unknown remainder target', () => {
      expect(() =>
        splitByBps(money(100), [{ key: 'a', bps: 6000 }, { key: 'b', bps: 6000 }], 'a'),
      ).toThrow(/exceeds 10000/)
      expect(() => splitByBps(money(100), [{ key: 'a', bps: 100 }], 'z')).toThrow(/not one of/)
    })
  })

  describe('formatMoney', () => {
    it('omits decimals on a whole amount', () => {
      expect(formatMoney(95_000, 'MXN')).toMatch(/950/)
      expect(formatMoney(95_000, 'MXN')).not.toMatch(/[.,]00/)
    })

    it('shows centavos when there are any, so a column adds up', () => {
      // 15% of 95 000 centavos is 14 250 — 142.50 pesos. Rounding it to 143
      // meant an owner summing the commission column on screen got a total
      // that disagreed with the exact stored arithmetic.
      const commission = applyBps(money(95_000), 1500)
      expect(commission.amountMinor).toBe(14_250)
      expect(formatMoney(commission.amountMinor, 'MXN')).toMatch(/142[.,]50/)
    })

    it('rounds nothing away', () => {
      expect(formatMoney(1, 'MXN')).toMatch(/0[.,]01/)
      expect(formatMoney(99, 'MXN')).toMatch(/0[.,]99/)
    })

    /*
     * The product puts a USD content set and an MXN catalogue on one journey:
     * a visitor saw "$9,600" (real dollars, the room estimate) above "$950 per
     * person" and "$3,800" on the till, which are pesos. The default used to
     * be the currency's *home* locale, and `es-MX` is the one locale where
     * MXN is a bare `$`.
     */
    it('never renders a currency as a bare $ unless it is the dollar', () => {
      expect(formatMoney(95_000, 'MXN')).toContain('MX$')
      expect(formatMoney(95_000, 'USD')).not.toContain('MX$')
      expect(formatMoney(95_000, 'USD')).toContain('$')
    })

    it('stays unambiguous for a reader in either language', () => {
      for (const locale of ['en', 'es']) {
        // Either "MX$950" or "950 MXN" — what it must never be is "$950".
        expect(formatMoney(95_000, 'MXN', locale)).toMatch(/MX\$|MXN/)
      }
    })
  })
})

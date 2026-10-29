/**
 * Money is integer minor units (centavos for MXN) plus an ISO 4217 code.
 * Never a float, never a Decimal: every total in ARC must be bit-reproducible
 * so an order can be re-derived and audited years later.
 */
export interface Money {
  amountMinor: number
  currency: string
}

export const money = (amountMinor: number, currency = 'MXN'): Money => ({
  amountMinor: Math.trunc(amountMinor),
  currency,
})

export const zero = (currency = 'MXN'): Money => money(0, currency)

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Cannot combine ${a.currency} with ${b.currency}.`)
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return money(a.amountMinor + b.amountMinor, a.currency)
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return money(a.amountMinor - b.amountMinor, a.currency)
}

export function sum(items: Money[], currency = 'MXN'): Money {
  return items.reduce<Money>((acc, m) => add(acc, m), zero(currency))
}

export function multiply(a: Money, quantity: number): Money {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error(`Quantity must be a non-negative integer, received ${quantity}.`)
  }
  return money(a.amountMinor * quantity, a.currency)
}

/**
 * Basis-point share, rounded half-up to the nearest minor unit.
 * Half-up (not banker's rounding) because it is what hotel operators expect
 * when they check the arithmetic by hand.
 */
export function applyBps(a: Money, bps: number): Money {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new Error(`Basis points must be an integer in [0, 10000], received ${bps}.`)
  }
  const product = a.amountMinor * bps
  const rounded = Math.floor(product / 10_000 + 0.5)
  return money(rounded, a.currency)
}

/**
 * Splits an amount into parts by basis points, assigning any rounding
 * remainder to `remainderTo`. Guarantees the parts always re-sum to the whole —
 * a ledger that does not balance is a bug, not a rounding quirk.
 */
export function splitByBps(
  total: Money,
  shares: Array<{ key: string; bps: number }>,
  remainderTo: string,
): Record<string, Money> {
  const totalBps = shares.reduce((acc, s) => acc + s.bps, 0)
  if (totalBps > 10_000) {
    throw new Error(`Shares sum to ${totalBps} bps, which exceeds 10000.`)
  }
  if (!shares.some((s) => s.key === remainderTo)) {
    throw new Error(`remainderTo "${remainderTo}" is not one of the shares.`)
  }

  const out: Record<string, Money> = {}
  let allocated = 0
  for (const share of shares) {
    const part = applyBps(total, share.bps)
    out[share.key] = part
    allocated += part.amountMinor
  }

  const remainder = total.amountMinor - allocated
  const target = out[remainderTo]
  if (target) {
    out[remainderTo] = money(target.amountMinor + remainder, total.currency)
  }
  return out
}

/**
 * The locale a figure is formatted in when the caller names none.
 *
 * Deliberately **not** the currency's home locale. `es-MX` renders MXN as a
 * bare `$`, which is correct in Mexico and ambiguous to everybody else — and
 * this product puts a USD content set and an MXN catalogue on the same
 * journey. A visitor saw "Estimated total $9,600" (real US dollars, the room)
 * and then "$950 per person" and "$3,800" on the till, which are pesos, about
 * US$50 and US$200. Nothing on the page distinguished them.
 *
 * `en-US` renders MXN as `MX$`, USD as `$` and EUR as `€` — each unambiguous
 * whoever is reading. A caller that knows its reader's locale should still
 * pass it, which is what the guest surfaces now do; this is the floor, not the
 * preference.
 */
const FALLBACK_FORMATTING_LOCALE = 'en-US'

/**
 * Formats an amount for display.
 *
 * Shows centavos only when there are any. Rounding every figure to whole pesos
 * meant a commission column of 142.50 displayed as 143, so an owner adding up
 * the numbers on screen — the thing ADR-002 exists to let them do — got a
 * total that did not match, while the stored arithmetic was exact. Whole
 * amounts still render cleanly as "MX$950".
 */
export function formatMoney(amountMinor: number, currency = 'MXN', locale?: string): string {
  const resolved = locale ?? FALLBACK_FORMATTING_LOCALE
  const hasCentavos = Math.trunc(amountMinor) % 100 !== 0

  return new Intl.NumberFormat(resolved, {
    style: 'currency',
    currency,
    minimumFractionDigits: hasCentavos ? 2 : 0,
    maximumFractionDigits: hasCentavos ? 2 : 0,
  }).format(amountMinor / 100)
}

export const formatMoneyObj = (m: Money, locale?: string): string =>
  formatMoney(m.amountMinor, m.currency, locale)

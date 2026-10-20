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

const LOCALE_BY_CURRENCY: Record<string, string> = { MXN: 'es-MX', USD: 'en-US', EUR: 'de-DE' }

export function formatMoney(
  amountMinor: number,
  currency = 'MXN',
  locale?: string,
): string {
  const resolved = locale ?? LOCALE_BY_CURRENCY[currency] ?? 'en-US'
  return new Intl.NumberFormat(resolved, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amountMinor / 100)
}

export const formatMoneyObj = (m: Money, locale?: string): string =>
  formatMoney(m.amountMinor, m.currency, locale)

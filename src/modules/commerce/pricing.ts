import { add, money, multiply } from '@/lib/money'
import { invalid } from '@/lib/errors'
import { PriceKind } from '@/lib/prisma-types'

/**
 * Server-side price calculation.
 *
 * Clients never send money. They send an experience, a slot and a quantity;
 * everything below is derived here from stored rows so a tampered request
 * cannot change what is charged. The same function runs at add-to-cart time and
 * again at checkout, and checkout refuses to proceed if the two disagree.
 */
export interface PriceRow {
  id: string
  kind: PriceKind
  amountMinor: number
  bookingFeeMinor: number
  currency: string
  minParty: number
  validFrom: Date
  validTo: Date | null
  isActive: boolean
}

/** Promo beats group beats seasonal beats base, at equal party eligibility. */
const KIND_PRECEDENCE: Record<PriceKind, number> = {
  [PriceKind.PROMO]: 4,
  [PriceKind.GROUP]: 3,
  [PriceKind.SEASONAL]: 2,
  [PriceKind.BASE]: 1,
}

export function selectPrice(
  prices: PriceRow[],
  options: { quantity: number; at?: Date },
): PriceRow {
  const at = options.at ?? new Date()
  const eligible = prices
    .filter((p) => p.isActive)
    .filter((p) => p.validFrom.getTime() <= at.getTime())
    .filter((p) => p.validTo === null || p.validTo.getTime() >= at.getTime())
    .filter((p) => options.quantity >= p.minParty)
    .sort((a, b) => {
      const byKind = KIND_PRECEDENCE[b.kind] - KIND_PRECEDENCE[a.kind]
      if (byKind !== 0) return byKind
      // A higher minParty is a more specific group tier.
      if (b.minParty !== a.minParty) return b.minParty - a.minParty
      return b.validFrom.getTime() - a.validFrom.getTime()
    })

  const chosen = eligible[0]
  if (!chosen) {
    throw invalid('This experience has no active price for that party size.')
  }
  return chosen
}

export interface LinePriceInput {
  prices: PriceRow[]
  quantity: number
  /** Per-slot override, minor units. Wins over every Price row when set. */
  slotPriceOverrideMinor?: number | null
  currency: string
  at?: Date
}

export interface LinePrice {
  unitPriceMinor: number
  bookingFeeMinor: number
  lineTotalMinor: number
  currency: string
  priceId: string | null
  source: 'slot-override' | 'price-row'
}

export function computeLinePrice(input: LinePriceInput): LinePrice {
  const { quantity, currency } = input

  if (!Number.isInteger(quantity) || quantity < 1) {
    throw invalid('Quantity must be a positive whole number.')
  }

  if (input.slotPriceOverrideMinor !== null && input.slotPriceOverrideMinor !== undefined) {
    const unit = money(input.slotPriceOverrideMinor, currency)
    const total = multiply(unit, quantity)
    return {
      unitPriceMinor: unit.amountMinor,
      bookingFeeMinor: 0,
      lineTotalMinor: total.amountMinor,
      currency,
      priceId: null,
      source: 'slot-override',
    }
  }

  const price = selectPrice(input.prices, { quantity, at: input.at })
  if (price.currency !== currency) {
    throw invalid(`Price is in ${price.currency} but the cart is in ${currency}.`)
  }

  const unit = money(price.amountMinor, currency)
  const fee = money(price.bookingFeeMinor, currency)
  const total = add(multiply(unit, quantity), fee)

  return {
    unitPriceMinor: unit.amountMinor,
    bookingFeeMinor: fee.amountMinor,
    lineTotalMinor: total.amountMinor,
    currency,
    priceId: price.id,
    source: 'price-row',
  }
}

export interface CartTotals {
  subtotalMinor: number
  feesMinor: number
  totalMinor: number
  currency: string
}

export function computeCartTotals(
  lines: Array<{ unitPriceMinor: number; quantity: number; bookingFeeMinor: number }>,
  currency = 'MXN',
): CartTotals {
  let subtotal = money(0, currency)
  let fees = money(0, currency)

  for (const line of lines) {
    subtotal = add(subtotal, multiply(money(line.unitPriceMinor, currency), line.quantity))
    fees = add(fees, money(line.bookingFeeMinor, currency))
  }

  return {
    subtotalMinor: subtotal.amountMinor,
    feesMinor: fees.amountMinor,
    totalMinor: subtotal.amountMinor + fees.amountMinor,
    currency,
  }
}

/**
 * Refund due when an order item is cancelled.
 *
 * Inside the cancellation window the guest is made whole; outside it, nothing is
 * refunded. Deliberately a hard cliff rather than a sliding scale: a rule a
 * guest can read in one sentence beats one that is marginally fairer.
 */
export function computeRefund(input: {
  lineTotalMinor: number
  currency: string
  startsAt: Date
  cancellationPolicyHours: number
  now?: Date
}): { refundMinor: number; withinWindow: boolean; hoursUntilStart: number } {
  const now = input.now ?? new Date()
  const hoursUntilStart = (input.startsAt.getTime() - now.getTime()) / 3_600_000
  const withinWindow = hoursUntilStart >= input.cancellationPolicyHours

  return {
    refundMinor: withinWindow ? input.lineTotalMinor : 0,
    withinWindow,
    hoursUntilStart: Math.round(hoursUntilStart * 10) / 10,
  }
}

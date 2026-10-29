import { prisma } from '@/lib/db'
import { isCurrentlyVerified } from '@/modules/admin/verification'
import { conflict, invalid, notFound } from '@/lib/errors'
import { type AbilityLevel, CartStatus, ExperienceStatus, SlotStatus } from '@/lib/prisma-types'
import { getAvailability, placeHold, releaseHold, releaseHoldsForCart } from '@/modules/inventory/service'
import {
  assertSlotSuitableForAudience,
  assertSlotSuitableForGuest,
} from '@/modules/destination/suitability'
import { track } from '@/modules/analytics/track'
import { computeCartTotals, computeLinePrice } from './pricing'

/**
 * Cart management.
 *
 * Every money value on a cart is computed here from stored rows. The client
 * sends an experience, a departure and a number of people; it never sends a
 * price, and a price it might have seen a minute ago is re-derived on every
 * mutation and again at checkout.
 *
 * Adding to the cart takes an inventory hold immediately rather than at
 * checkout. That is the honest behaviour for a product selling six-seat boats:
 * a guest who has put the last two places in their basket should keep them for
 * long enough to decide, and the next guest should be told they are gone.
 *
 * It also re-runs the suitability gate. Recommending is not the only route to a
 * booking — a guest can open an experience page directly — so refusing an
 * unsuitable departure has to happen at the point of commitment, not only at
 * the point of recommendation.
 */
export const CART_TTL_MINUTES = 30

export interface CartView {
  id: string
  status: CartStatus
  currency: string
  subtotalMinor: number
  feesMinor: number
  totalMinor: number
  expiresAt: Date | null
  items: Array<{
    id: string
    experienceId: string
    slotId: string
    title: string
    category: string
    quantity: number
    unitPriceMinor: number
    bookingFeeMinor: number
    lineTotalMinor: number
    currency: string
    startsAt: Date
    durationMinutes: number
    meetingPoint: string | null
    supplierName: string
    supplierVerified: boolean
    /** Null when the hold has lapsed; the UI shows it as needing re-reservation. */
    holdExpiresAt: Date | null
    capacityRemaining: number
  }>
}

export async function getOrCreateCart(options: {
  organizationId: string
  propertyId: string
  guestId: string
  stayId?: string | null
  currency: string
}): Promise<string> {
  const existing = await prisma.cart.findFirst({
    where: { guestId: options.guestId, status: CartStatus.OPEN },
    orderBy: { createdAt: 'desc' },
    select: { id: true, expiresAt: true },
  })

  if (existing) {
    // Touch the expiry: a guest still shopping has not abandoned the cart.
    await prisma.cart.update({
      where: { id: existing.id },
      data: { expiresAt: new Date(Date.now() + CART_TTL_MINUTES * 60_000) },
    })
    return existing.id
  }

  const cart = await prisma.cart.create({
    data: {
      organizationId: options.organizationId,
      propertyId: options.propertyId,
      guestId: options.guestId,
      stayId: options.stayId ?? null,
      status: CartStatus.OPEN,
      currency: options.currency,
      expiresAt: new Date(Date.now() + CART_TTL_MINUTES * 60_000),
    },
    select: { id: true },
  })
  return cart.id
}

/** Recomputes and persists the cart totals from its current lines. */
async function recalculateCart(cartId: string): Promise<void> {
  const cart = await prisma.cart.findUnique({
    where: { id: cartId },
    select: {
      currency: true,
      items: { select: { unitPriceMinor: true, quantity: true, bookingFeeMinor: true } },
    },
  })
  if (!cart) return

  const totals = computeCartTotals(cart.items, cart.currency)
  await prisma.cart.update({
    where: { id: cartId },
    data: {
      subtotalMinor: totals.subtotalMinor,
      feesMinor: totals.feesMinor,
      totalMinor: totals.totalMinor,
    },
  })
}

export async function addToCart(options: {
  cartId: string
  slotId: string
  quantity: number
  participantNotes?: string | null
  /**
   * Who to gate as, when the basket has no guest behind it yet.
   *
   * Ignored once it does: a `Guest` row is the authority on somebody's
   * ability, and a caller must not be able to talk the gate into a looser
   * answer than the one on file. Only the property-less case — a storefront
   * basket filled before sign-up — uses it, and the ability in it is the
   * person's own declaration, the same answer the portal's intake records.
   */
  audience?: { surfAbility: AbilityLevel | null } | null
  now?: Date
}): Promise<{ cartId: string; holdExpiresAt: Date }> {
  const now = options.now ?? new Date()

  if (!Number.isInteger(options.quantity) || options.quantity < 1) {
    throw invalid('Choose how many people are going.')
  }

  const cart = await prisma.cart.findUnique({
    where: { id: options.cartId },
    select: {
      id: true,
      organizationId: true,
      propertyId: true,
      guestId: true,
      status: true,
      currency: true,
    },
  })
  if (!cart) throw notFound('Basket')
  if (cart.status !== CartStatus.OPEN) {
    throw conflict('This basket has already been checked out.')
  }

  const slot = await prisma.availabilitySlot.findUnique({
    where: { id: options.slotId },
    select: {
      id: true,
      startsAt: true,
      status: true,
      priceOverrideMinor: true,
      experience: {
        select: {
          id: true,
          propertyId: true,
          status: true,
          minParty: true,
          maxParty: true,
          prices: {
            where: { isActive: true },
            select: {
              id: true, kind: true, amountMinor: true, bookingFeeMinor: true,
              currency: true, minParty: true, validFrom: true, validTo: true, isActive: true,
            },
          },
        },
      },
    },
  })
  if (!slot) throw notFound('Departure')

  // Tenant check: a slot id from another property must not be addable here.
  if (slot.experience.propertyId !== cart.propertyId) {
    throw notFound('Departure')
  }
  if (slot.experience.status !== ExperienceStatus.PUBLISHED) {
    throw conflict('That experience is no longer available.')
  }
  if (slot.startsAt.getTime() <= now.getTime()) {
    throw conflict('That departure has already started.')
  }
  if (options.quantity > slot.experience.maxParty) {
    throw invalid(`That experience takes at most ${slot.experience.maxParty} people.`)
  }
  if (options.quantity < slot.experience.minParty) {
    throw invalid(`That experience needs at least ${slot.experience.minParty} people.`)
  }

  /**
   * Price before holding, and suitability before either.
   *
   * Pricing used to run after the hold was taken, so a throw from
   * `computeLinePrice` — an experience whose only active price is a group tier
   * the party is too small for — left a committed hold with no basket line
   * behind it, holding capacity for the full TTL with nothing to release it.
   */
  const line = computeLinePrice({
    prices: slot.experience.prices,
    quantity: options.quantity,
    slotPriceOverrideMinor: slot.priceOverrideMinor,
    currency: cart.currency,
    at: now,
  })

  /*
   * The gate, for whoever is holding this basket.
   *
   * This used to be `if (cart.guestId)`, which was safe only because every
   * basket the product could produce had a guest behind it. A public
   * storefront basket is filled before the person has an account, so the
   * condition would have turned "sign up after you pay" into the one route to
   * a booking the conditions gate never ran on. A basket with no guest is
   * gated as somebody who has stated no ability, which is the ADR-017 case:
   * the gate demands the harder level rather than relaxing.
   */
  if (cart.guestId) {
    await assertSlotSuitableForGuest({ guestId: cart.guestId, slotId: slot.id, now })
  } else {
    await assertSlotSuitableForAudience({
      audience: {
        propertyId: cart.propertyId,
        surfAbility: options.audience?.surfAbility ?? null,
      },
      slotId: slot.id,
      now,
    })
  }

  // Hold last. If capacity is gone we fail before writing a line the guest
  // would then have to be told about, and nothing is held speculatively.
  const hold = await placeHold({
    organizationId: cart.organizationId,
    slotId: slot.id,
    cartId: cart.id,
    quantity: options.quantity,
    now,
  })

  await prisma.cartItem.upsert({
    where: { cartId_slotId: { cartId: cart.id, slotId: slot.id } },
    update: {
      quantity: options.quantity,
      unitPriceMinor: line.unitPriceMinor,
      bookingFeeMinor: line.bookingFeeMinor,
      lineTotalMinor: line.lineTotalMinor,
      participantNotes: options.participantNotes ?? null,
    },
    create: {
      organizationId: cart.organizationId,
      cartId: cart.id,
      experienceId: slot.experience.id,
      slotId: slot.id,
      quantity: options.quantity,
      unitPriceMinor: line.unitPriceMinor,
      bookingFeeMinor: line.bookingFeeMinor,
      lineTotalMinor: line.lineTotalMinor,
      currency: line.currency,
      participantNotes: options.participantNotes ?? null,
    },
  })

  await recalculateCart(cart.id)
  await prisma.cart.update({
    where: { id: cart.id },
    data: { expiresAt: new Date(now.getTime() + CART_TTL_MINUTES * 60_000) },
  })

  await track({
    organizationId: cart.organizationId,
    propertyId: cart.propertyId,
    name: 'added_to_basket',
    surface: 'guest',
    subject: cart.id,
    properties: { experienceId: slot.experience.id, quantity: options.quantity },
  })

  return { cartId: cart.id, holdExpiresAt: hold.expiresAt }
}

export async function removeFromCart(options: { cartId: string; slotId: string }): Promise<void> {
  const item = await prisma.cartItem.findUnique({
    where: { cartId_slotId: { cartId: options.cartId, slotId: options.slotId } },
    select: { id: true },
  })
  if (!item) return

  const hold = await prisma.inventoryHold.findFirst({
    where: { cartId: options.cartId, slotId: options.slotId, status: 'ACTIVE' },
    select: { id: true },
  })

  await prisma.cartItem.delete({ where: { id: item.id } })
  if (hold) await releaseHold({ holdId: hold.id, reason: 'removed_from_basket' })
  await recalculateCart(options.cartId)
}

export async function clearCart(cartId: string): Promise<void> {
  await releaseHoldsForCart(cartId, 'basket_cleared')
  await prisma.cartItem.deleteMany({ where: { cartId } })
  await recalculateCart(cartId)
}

export async function getCartView(cartId: string, now = new Date()): Promise<CartView | null> {
  const cart = await prisma.cart.findUnique({
    where: { id: cartId },
    include: {
      items: {
        orderBy: { createdAt: 'asc' },
        include: {
          experience: {
            select: {
              id: true,
              titleEn: true,
              category: true,
              durationMinutes: true,
              meetingPoint: true,
              supplier: { select: { name: true, verification: true, verifiedChecks: true, insuranceExpiresOn: true } },
            },
          },
          slot: { select: { id: true, startsAt: true } },
        },
      },
      holds: {
        where: { status: 'ACTIVE' },
        select: { slotId: true, expiresAt: true },
      },
    },
  })
  if (!cart) return null

  const availability = await getAvailability(
    cart.items.map((i) => i.slotId),
    now,
  )
  const holdBySlot = new Map(cart.holds.map((h) => [h.slotId, h.expiresAt]))

  return {
    id: cart.id,
    status: cart.status,
    currency: cart.currency,
    subtotalMinor: cart.subtotalMinor,
    feesMinor: cart.feesMinor,
    totalMinor: cart.totalMinor,
    expiresAt: cart.expiresAt,
    items: cart.items.map((item) => {
      const slotAvailability = availability.get(item.slotId)
      const holdExpiresAt = holdBySlot.get(item.slotId) ?? null
      return {
        id: item.id,
        experienceId: item.experienceId,
        slotId: item.slotId,
        title: item.experience.titleEn,
        category: item.experience.category,
        quantity: item.quantity,
        unitPriceMinor: item.unitPriceMinor,
        bookingFeeMinor: item.bookingFeeMinor,
        lineTotalMinor: item.lineTotalMinor,
        currency: item.currency,
        startsAt: item.slot.startsAt,
        durationMinutes: item.experience.durationMinutes,
        meetingPoint: item.experience.meetingPoint,
        supplierName: item.experience.supplier.name,
        /*
         * The *current* standing, not the stored column. A verified partner
         * whose insurance certificate has expired is not a verified partner
         * today, and a basket is exactly where that matters: the guest is
         * about to pay. See src/modules/admin/verification.ts and ADR-036.
         */
        supplierVerified: isCurrentlyVerified(item.experience.supplier, now),
        holdExpiresAt,
        // A lapsed hold means the places are back in the pool, so show what is
        // genuinely left rather than what the guest reserved earlier.
        capacityRemaining: holdExpiresAt
          ? (slotAvailability?.remaining ?? 0) + item.quantity
          : slotAvailability?.remaining ?? 0,
      }
    }),
  }
}

/** Re-prices and re-validates every line. Run immediately before checkout. */
export interface CartValidation {
  ok: boolean
  problems: Array<{ slotId: string; code: string; message: string }>
  totals: { subtotalMinor: number; feesMinor: number; totalMinor: number; currency: string }
}

export async function validateCart(cartId: string, now = new Date()): Promise<CartValidation> {
  const cart = await prisma.cart.findUnique({
    where: { id: cartId },
    include: {
      items: {
        include: {
          experience: {
            select: {
              id: true,
              titleEn: true,
              status: true,
              prices: {
                where: { isActive: true },
                select: {
                  id: true, kind: true, amountMinor: true, bookingFeeMinor: true,
                  currency: true, minParty: true, validFrom: true, validTo: true, isActive: true,
                },
              },
            },
          },
          slot: { select: { id: true, startsAt: true, status: true, priceOverrideMinor: true } },
        },
      },
      holds: { where: { status: 'ACTIVE' }, select: { slotId: true, quantity: true, expiresAt: true } },
    },
  })
  if (!cart) throw notFound('Basket')

  const problems: CartValidation['problems'] = []
  const holdBySlot = new Map(cart.holds.map((h) => [h.slotId, h]))

  if (cart.items.length === 0) {
    problems.push({ slotId: '', code: 'empty', message: 'Your basket is empty.' })
  }

  for (const item of cart.items) {
    const hold = holdBySlot.get(item.slotId)

    if (!hold) {
      problems.push({
        slotId: item.slotId,
        code: 'hold_lost',
        message: `The places we were holding for ${item.experience.titleEn} have been released. Add it again to re-reserve.`,
      })
    } else if (hold.expiresAt.getTime() < now.getTime()) {
      problems.push({
        slotId: item.slotId,
        code: 'hold_expired',
        message: `Your reservation for ${item.experience.titleEn} has expired.`,
      })
    } else if (hold.quantity !== item.quantity) {
      problems.push({
        slotId: item.slotId,
        code: 'hold_quantity_mismatch',
        message: `We are holding ${hold.quantity} places for ${item.experience.titleEn} but the basket says ${item.quantity}.`,
      })
    }

    if (item.experience.status !== ExperienceStatus.PUBLISHED) {
      problems.push({
        slotId: item.slotId,
        code: 'unpublished',
        message: `${item.experience.titleEn} is no longer on sale.`,
      })
    }

    // CLOSED as well as CANCELLED. `placeHold` refuses both, but a hold taken
    // before a partner closed the departure would otherwise walk straight
    // through checkout onto a departure nobody is running.
    if (item.slot.status === SlotStatus.CANCELLED || item.slot.status === SlotStatus.CLOSED) {
      problems.push({
        slotId: item.slotId,
        code: item.slot.status === SlotStatus.CANCELLED ? 'departure_cancelled' : 'departure_closed',
        message: `The ${item.experience.titleEn} departure is no longer running.`,
      })
    }

    if (item.slot.startsAt.getTime() <= now.getTime()) {
      problems.push({
        slotId: item.slotId,
        code: 'departure_passed',
        message: `The ${item.experience.titleEn} departure has already started.`,
      })
    }

    // Re-derive the price. A price that moved since add-to-cart stops checkout
    // rather than charging either the old or the new figure silently.
    try {
      const line = computeLinePrice({
        prices: item.experience.prices,
        quantity: item.quantity,
        slotPriceOverrideMinor: item.slot.priceOverrideMinor,
        currency: cart.currency,
        at: now,
      })
      if (
        line.unitPriceMinor !== item.unitPriceMinor ||
        line.bookingFeeMinor !== item.bookingFeeMinor
      ) {
        problems.push({
          slotId: item.slotId,
          code: 'price_changed',
          message: `The price of ${item.experience.titleEn} changed while it was in your basket.`,
        })
      }
    } catch {
      problems.push({
        slotId: item.slotId,
        code: 'no_price',
        message: `${item.experience.titleEn} has no price for a party of ${item.quantity}.`,
      })
    }
  }

  const totals = computeCartTotals(cart.items, cart.currency)

  return { ok: problems.length === 0, problems, totals }
}

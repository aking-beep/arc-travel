import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { localInstant, toDateKey, type DateKey } from '@/lib/dates'
import { AbilityLevel, ConditionsRisk } from '@/lib/prisma-types'
import { addSlot } from '@/modules/catalog/service'
import { scheduleAvailability } from '@/modules/suppliers/service'
import { addToCart, getOrCreateCart } from '@/modules/commerce/cart'
import { evaluateSlotForGuest } from '@/modules/destination/suitability'
import { buildItinerary } from '@/modules/itinerary/service'
import { actorFor, createTenant, resetDatabase } from '../helpers/factory'

/**
 * AUDIT-2 — the activity's operating window must gate the sale, not only the
 * recommendation.
 *
 * `Activity.earliestStart` / `latestStart` (and `seasonMonths`) are enforced in
 * exactly one place: `scoreCandidate`, which excludes an out-of-window
 * departure from a generated itinerary. Nothing enforces them when a departure
 * is created (`addSlot`, `scheduleAvailability`) or when a guest commits to one
 * (`evaluateSlotForGuest` → `addToCart`).
 *
 * So a dawn-only surf session scheduled at 23:00 is invisible to the planner
 * and fully purchasable from the experience page — the same split between the
 * recommendation gate and the commitment gate that ADR-019 exists to close,
 * reopened on the time axis instead of the ability axis.
 */
const daysOut = (n: number): DateKey => toDateKey(new Date(Date.now() + n * 86_400_000))

describe('activity operating window', () => {
  beforeEach(resetDatabase)

  it('refuses a departure created outside the activity’s hours', async () => {
    const t = await createTenant()
    const actor = await actorFor(t.ownerUserId)

    const activity = await prisma.activity.findUniqueOrThrow({
      where: { id: t.activityId },
      select: { earliestStart: true, latestStart: true },
    })
    expect(activity.latestStart).toBe('18:00')

    await expect(
      addSlot(actor, {
        experienceId: t.experienceId,
        date: daysOut(12),
        startTime: '23:00',
        capacity: 6,
      }),
    ).rejects.toThrow()
  })

  it('refuses a partner schedule whose start times fall outside those hours', async () => {
    const t = await createTenant()
    const actor = await actorFor(t.supplierUserId)

    await expect(
      scheduleAvailability(actor, t.supplierId, {
        experienceId: t.experienceId,
        fromDate: daysOut(12),
        toDate: daysOut(14),
        startTimes: ['23:00'],
        capacity: 6,
        weekdays: [],
      }),
    ).rejects.toThrow()
  })

  it('does not let a guest commit to one that already exists', async () => {
    const date = daysOut(12)
    const t = await createTenant({
      departureDate: date,
      guestAbility: AbilityLevel.ADVANCED,
      conditions: { risk: ConditionsRisk.LOW, minAbilityRequired: AbilityLevel.BEGINNER },
    })

    const startsAt = localInstant(date, '23:00')
    await prisma.availabilitySlot.update({
      where: { id: t.slotId },
      data: { startsAt, endsAt: new Date(startsAt.getTime() + 90 * 60_000) },
    })

    const suitability = await evaluateSlotForGuest({ guestId: t.guestId, slotId: t.slotId })
    expect(suitability.allowed).toBe(false)
    expect(suitability.exclusions).toContain('outside_activity_operating_window')

    const cartId = await getOrCreateCart({
      organizationId: t.organizationId,
      propertyId: t.propertyId,
      guestId: t.guestId,
      currency: 'MXN',
    })
    await expect(addToCart({ cartId, slotId: t.slotId, quantity: 1 })).rejects.toThrow()
  })

  it('gates the sale on the same rule that gates the recommendation', async () => {
    const date = daysOut(12)
    const t = await createTenant({
      departureDate: date,
      guestAbility: AbilityLevel.ADVANCED,
      conditions: { risk: ConditionsRisk.LOW, minAbilityRequired: AbilityLevel.BEGINNER },
    })

    const startsAt = localInstant(date, '23:00')
    await prisma.availabilitySlot.update({
      where: { id: t.slotId },
      data: { startsAt, endsAt: new Date(startsAt.getTime() + 90 * 60_000) },
    })

    const plan = await buildItinerary({ guestId: t.guestId, startDate: date, endDate: date })
    const recommended = plan.generated.items.filter((i) => i.slotId === t.slotId).length

    const cartId = await getOrCreateCart({
      organizationId: t.organizationId,
      propertyId: t.propertyId,
      guestId: t.guestId,
      currency: 'MXN',
    })
    await addToCart({ cartId, slotId: t.slotId, quantity: 1 }).catch(() => undefined)
    const sellable = await prisma.cartItem.count({ where: { cartId } })

    // Not recommended must mean not sellable, for the same reason.
    expect({ recommended, sellable }).toEqual({ recommended: 0, sellable: 0 })
  })
})

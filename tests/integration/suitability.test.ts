import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { isAppError } from '@/lib/errors'
import { AbilityLevel, ConditionsRisk, PlaceKind } from '@/lib/prisma-types'
import {
  assertSlotSuitableForGuest,
  evaluateSlotForGuest,
} from '@/modules/destination/suitability'
import { addToCart, getOrCreateCart } from '@/modules/commerce/cart'
import { createTenant, resetDatabase, slotState, type TenantFixture } from '../helpers/factory'

/**
 * Suitability at the point of commitment.
 *
 * The itinerary was not the only route to a booking: a guest could open an
 * experience page directly, or post a slot id to the basket action, and
 * neither consulted the safety gate. A beginner could put the advanced-only
 * Zicatela session in their basket and pay for it. These tests hold the
 * chokepoint closed.
 */
let tenant: TenantFixture

function tomorrow(): string {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
}

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('evaluateSlotForGuest', () => {
  it('allows a suitable departure', async () => {
    tenant = await createTenant({
      departureDate: tomorrow(),
      guestAbility: AbilityLevel.BEGINNER,
      activityMinAbility: AbilityLevel.BEGINNER,
      conditions: { risk: ConditionsRisk.LOW, minAbilityRequired: AbilityLevel.BEGINNER },
    })

    const verdict = await evaluateSlotForGuest({
      guestId: tenant.guestId,
      slotId: tenant.slotId,
    })
    expect(verdict.allowed).toBe(true)
    expect(verdict.exclusions).toEqual([])
  })

  it('refuses a beginner an advanced-only departure', async () => {
    tenant = await createTenant({
      departureDate: tomorrow(),
      guestAbility: AbilityLevel.BEGINNER,
      activityMinAbility: AbilityLevel.ADVANCED,
      maxSafeRisk: ConditionsRisk.EXTREME,
      conditions: { risk: ConditionsRisk.HIGH, minAbilityRequired: AbilityLevel.ADVANCED },
    })

    const verdict = await evaluateSlotForGuest({
      guestId: tenant.guestId,
      slotId: tenant.slotId,
    })
    expect(verdict.allowed).toBe(false)
    expect(verdict.exclusions).toContain('ability_below_activity_minimum')
  })

  it('refuses a guest who stated no ability on a demanding day', async () => {
    tenant = await createTenant({
      departureDate: tomorrow(),
      guestAbility: null,
      activityMinAbility: AbilityLevel.BEGINNER,
      maxSafeRisk: ConditionsRisk.EXTREME,
      conditions: { risk: ConditionsRisk.HIGH, minAbilityRequired: AbilityLevel.ADVANCED },
    })

    const verdict = await evaluateSlotForGuest({
      guestId: tenant.guestId,
      slotId: tenant.slotId,
    })
    expect(verdict.allowed).toBe(false)
    expect(verdict.exclusions).toContain('ability_unknown_and_conditions_demanding')
    expect(verdict.guestAbility).toBeNull()
  })

  it('refuses another property’s departure as not found', async () => {
    tenant = await createTenant({ departureDate: tomorrow() })
    const other = await createTenant({ departureDate: tomorrow() })

    await expect(
      evaluateSlotForGuest({ guestId: tenant.guestId, slotId: other.slotId }),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === 'NOT_FOUND')
  })

  it('falls back to the activity’s place when the experience has none', async () => {
    tenant = await createTenant({
      departureDate: tomorrow(),
      placeKind: PlaceKind.SURF_BREAK,
      guestAbility: AbilityLevel.BEGINNER,
      maxSafeRisk: ConditionsRisk.EXTREME,
      conditions: { risk: ConditionsRisk.EXTREME, minAbilityRequired: AbilityLevel.EXPERT },
    })

    // Clear the experience's own place; the activity still has one.
    await prisma.experience.update({
      where: { id: tenant.experienceId },
      data: { placeId: null },
    })

    const verdict = await evaluateSlotForGuest({
      guestId: tenant.guestId,
      slotId: tenant.slotId,
    })
    expect(verdict.allowed).toBe(false)
    expect(verdict.exclusions).toContain('conditions_demand_higher_ability')
  })

  it('refuses a water activity with no place anywhere', async () => {
    tenant = await createTenant({ departureDate: tomorrow(), conditionsSensitive: true })

    await prisma.experience.update({ where: { id: tenant.experienceId }, data: { placeId: null } })
    await prisma.activity.update({ where: { id: tenant.activityId }, data: { placeId: null } })

    const verdict = await evaluateSlotForGuest({
      guestId: tenant.guestId,
      slotId: tenant.slotId,
    })
    expect(verdict.allowed).toBe(false)
    expect(verdict.exclusions).toContain('conditions_sensitive_without_location')
  })

  it('leaves a land activity alone even with no place at all', async () => {
    tenant = await createTenant({ departureDate: tomorrow(), conditionsSensitive: false })
    await prisma.experience.update({ where: { id: tenant.experienceId }, data: { placeId: null } })
    await prisma.activity.update({ where: { id: tenant.activityId }, data: { placeId: null } })

    const verdict = await evaluateSlotForGuest({
      guestId: tenant.guestId,
      slotId: tenant.slotId,
    })
    expect(verdict.allowed).toBe(true)
  })
})

describe('addToCart enforces suitability', () => {
  it('refuses to basket a departure the gate excluded', async () => {
    tenant = await createTenant({
      departureDate: tomorrow(),
      guestAbility: AbilityLevel.BEGINNER,
      activityMinAbility: AbilityLevel.ADVANCED,
      maxSafeRisk: ConditionsRisk.EXTREME,
      conditions: { risk: ConditionsRisk.EXTREME, minAbilityRequired: AbilityLevel.EXPERT },
    })

    const cartId = await getOrCreateCart({
      organizationId: tenant.organizationId,
      propertyId: tenant.propertyId,
      guestId: tenant.guestId,
      currency: 'MXN',
    })

    await expect(addToCart({ cartId, slotId: tenant.slotId, quantity: 1 })).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === 'SAFETY_CONSTRAINT',
    )

    // Nothing was held, and no line was written.
    expect((await slotState(tenant.slotId)).held).toBe(0)
    expect(await prisma.cartItem.count({ where: { cartId } })).toBe(0)
  })

  it('re-evaluates against conditions entered after the plan was built', async () => {
    // A guest's plan passed the gate on Monday; ops enter a worse report on
    // Tuesday night. The booking surfaces must refuse it on Wednesday rather
    // than honouring a verdict reached two days earlier.
    const date = tomorrow()
    tenant = await createTenant({
      departureDate: date,
      guestAbility: AbilityLevel.IMPROVER,
      activityMinAbility: AbilityLevel.BEGINNER,
      maxSafeRisk: ConditionsRisk.EXTREME,
      conditions: { risk: ConditionsRisk.MODERATE, minAbilityRequired: AbilityLevel.IMPROVER },
    })

    const cartId = await getOrCreateCart({
      organizationId: tenant.organizationId,
      propertyId: tenant.propertyId,
      guestId: tenant.guestId,
      currency: 'MXN',
    })

    // Allowed at first.
    await expect(
      assertSlotSuitableForGuest({ guestId: tenant.guestId, slotId: tenant.slotId }),
    ).resolves.toBeTruthy()

    await prisma.conditionReport.updateMany({
      where: { placeId: tenant.placeId },
      data: { risk: ConditionsRisk.HIGH, minAbilityRequired: AbilityLevel.ADVANCED },
    })

    await expect(addToCart({ cartId, slotId: tenant.slotId, quantity: 1 })).rejects.toThrow(
      /demands advanced/i,
    )
  })

  it('still allows a suitable departure through to a hold', async () => {
    tenant = await createTenant({
      departureDate: tomorrow(),
      guestAbility: AbilityLevel.BEGINNER,
      conditions: { risk: ConditionsRisk.LOW, minAbilityRequired: AbilityLevel.BEGINNER },
    })

    const cartId = await getOrCreateCart({
      organizationId: tenant.organizationId,
      propertyId: tenant.propertyId,
      guestId: tenant.guestId,
      currency: 'MXN',
    })

    await addToCart({ cartId, slotId: tenant.slotId, quantity: 2 })
    expect((await slotState(tenant.slotId)).held).toBe(2)
  })

  it('does not hold capacity when pricing fails', async () => {
    // Regression: the hold was taken before the price was computed, so a throw
    // from computeLinePrice left a committed hold with no basket line to
    // release it — capacity locked for the full TTL with nothing to show.
    tenant = await createTenant({
      departureDate: tomorrow(),
      guestAbility: AbilityLevel.BEGINNER,
      conditions: { risk: ConditionsRisk.LOW, minAbilityRequired: AbilityLevel.BEGINNER },
    })

    // Leave only a group tier the party is too small for.
    await prisma.price.updateMany({
      where: { experienceId: tenant.experienceId },
      data: { minParty: 6 },
    })

    const cartId = await getOrCreateCart({
      organizationId: tenant.organizationId,
      propertyId: tenant.propertyId,
      guestId: tenant.guestId,
      currency: 'MXN',
    })

    await expect(addToCart({ cartId, slotId: tenant.slotId, quantity: 2 })).rejects.toThrow(
      /no active price/i,
    )
    expect((await slotState(tenant.slotId)).held).toBe(0)
    expect(await prisma.inventoryHold.count({ where: { cartId } })).toBe(0)
  })

  it('refuses to check out onto a departure the partner has closed', async () => {
    tenant = await createTenant({
      departureDate: tomorrow(),
      guestAbility: AbilityLevel.BEGINNER,
      conditions: { risk: ConditionsRisk.LOW, minAbilityRequired: AbilityLevel.BEGINNER },
    })

    const cartId = await getOrCreateCart({
      organizationId: tenant.organizationId,
      propertyId: tenant.propertyId,
      guestId: tenant.guestId,
      currency: 'MXN',
    })
    await addToCart({ cartId, slotId: tenant.slotId, quantity: 1 })

    // The partner closes it after the hold was taken.
    await prisma.availabilitySlot.update({
      where: { id: tenant.slotId },
      data: { status: 'CLOSED' },
    })

    const { checkout } = await import('@/modules/commerce/checkout')
    await expect(
      checkout({ cartId, guestId: tenant.guestId, idempotencyKey: randomUUID() }),
    ).rejects.toThrow(/needs attention/)

    expect(await prisma.order.count({ where: { propertyId: tenant.propertyId } })).toBe(0)
  })
})

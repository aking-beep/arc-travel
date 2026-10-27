import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { prisma } from '@/lib/db'
import { resetEnvCache } from '@/lib/env'
import { SimulatedActivityKind, StayStatus } from '@/lib/prisma-types'
import {
  MAX_SIMULATED_STAYS,
  RESERVED_SEATS,
  SIMULATED_DOMAIN,
  pick,
  recentActivity,
  simulatedPopulation,
  tick,
} from '@/modules/simulation/inhabitants'

import { createTenant, resetDatabase, type TenantFixture } from '../helpers/factory'

/**
 * The population.
 *
 * What is worth a real database here is not that an arrival arrives — that is
 * `registerDirectTrip`, which has its own suite. It is the four rules that
 * exist only because the people are invented: that none of it happens outside
 * a demo, that simulated demand leaves seats for a real visitor, that the town
 * stops growing at its ceiling, and that a refusal from the product is
 * recorded rather than swallowed.
 */
let tenant: TenantFixture

beforeEach(async () => {
  await resetDatabase()
  tenant = await createTenant({ capacity: 8 })
  process.env.ARC_DATA_MODE = 'demo'
  resetEnvCache()
})

afterAll(async () => {
  process.env.ARC_DATA_MODE = 'demo'
  resetEnvCache()
  await prisma.$disconnect()
})

/** Re-points the fixture's guest at a simulated address. */
async function makeGuestSimulated(): Promise<void> {
  await prisma.user.update({
    where: { id: tenant.guestUserId },
    data: { email: `rosa.vidal.test@${SIMULATED_DOMAIN}` },
  })
}

describe('the inhabitants', () => {
  it('refuses to live anywhere but a demo', async () => {
    process.env.ARC_DATA_MODE = 'pilot'
    resetEnvCache()

    await expect(tick({ source: 'cron' })).rejects.toMatchObject({ status: 403 })

    // And nothing was written on the way to the refusal.
    expect(await prisma.simulatedActivity.count()).toBe(0)
  })

  it('counts only simulated trips as the population', async () => {
    // The fixture's guest is an ordinary demo guest, not an invented one.
    expect(await simulatedPopulation()).toBe(0)

    await makeGuestSimulated()
    expect(await simulatedPopulation()).toBe(1)
  })

  it('leaves the last seats of a departure for a real visitor', async () => {
    await makeGuestSimulated()
    await prisma.availabilitySlot.update({
      where: { id: tenant.slotId },
      // Exactly the reserved headroom and not one more.
      data: { capacity: RESERVED_SEATS, booked: 0, held: 0 },
    })

    const result = await tick({ source: 'cron', actions: 1, only: 'fillABasket' })

    // Nothing bookable, so the tick is quiet rather than taking the last seats.
    expect(result.actions.map((a) => a.kind)).toEqual([SimulatedActivityKind.QUIET])
    expect(await prisma.cartItem.count()).toBe(0)
  })

  it('takes a seat when there is room beyond the headroom', async () => {
    await makeGuestSimulated()
    await prisma.availabilitySlot.update({
      where: { id: tenant.slotId },
      data: { capacity: RESERVED_SEATS + 1, booked: 0, held: 0 },
    })

    const result = await tick({ source: 'heartbeat', actions: 1, only: 'fillABasket' })

    expect(result.actions.map((a) => a.kind)).toEqual([SimulatedActivityKind.BASKET])
    // Through `addToCart`, so the hold exists rather than the count being faked.
    const slot = await prisma.availabilitySlot.findUniqueOrThrow({ where: { id: tenant.slotId } })
    expect(slot.held).toBe(1)
    expect(await prisma.inventoryHold.count()).toBe(1)
  })

  it('stops inviting anybody new once the town is full', () => {
    const rolls = Array.from({ length: 400 }, () => pick(MAX_SIMULATED_STAYS))
    expect(rolls).not.toContain('someoneArrives')

    // And below the ceiling it is one of the things that happens.
    const roomy = Array.from({ length: 400 }, () => pick(0))
    expect(roomy).toContain('someoneArrives')
  })

  it('records a refusal from the product instead of swallowing it', async () => {
    await makeGuestSimulated()
    // A departure in the past: the product refuses to put it in a basket.
    await prisma.availabilitySlot.update({
      where: { id: tenant.slotId },
      data: { startsAt: new Date(Date.now() + 2 * 86_400_000) },
    })
    await prisma.stay.update({
      where: { id: tenant.stayId },
      data: { status: StayStatus.CANCELLED },
    })

    await tick({ source: 'cron', actions: 1, only: 'fillABasket' })

    const activity = await recentActivity(10)
    expect(activity).toHaveLength(1)
    expect(activity[0]?.kind).toBe(SimulatedActivityKind.QUIET)
    expect(activity[0]?.source).toBe('cron')
  })

  it('writes every activity as demo data', async () => {
    await tick({ source: 'cron', actions: 1, only: 'keepTheHorizon' })

    const rows = await prisma.simulatedActivity.findMany()
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row.dataMode).toBe('demo')
  })
})

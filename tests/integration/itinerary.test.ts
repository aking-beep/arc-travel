import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import {
  AbilityLevel,
  ConditionsRisk,
  ItineraryItemKind,
  ItineraryStatus,
  PlaceKind,
} from '@/lib/prisma-types'
import { buildItinerary, collectCandidates, getAlternativesForDate } from '@/modules/itinerary/service'
import { resetRateLimits } from '@/modules/ai/service'
import { toDateKey } from '@/lib/dates'
import { createTenant, resetDatabase, type TenantFixture } from '../helpers/factory'

/**
 * End-to-end itinerary generation against a real database.
 *
 * The unit tests prove the generator's rules; these prove the wiring — that the
 * conditions gate is actually consulted, that an unconsented guest is not
 * personalised, that recommendations record the exclusions, and that the plan
 * survives a failing AI layer.
 */
let tenant: TenantFixture

function dateKeyDaysFromNow(days: number): string {
  return toDateKey(new Date(Date.now() + days * 86_400_000))
}

beforeEach(async () => {
  await resetDatabase()
  resetRateLimits()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('collectCandidates', () => {
  it('prices each candidate server-side and reports remaining capacity', async () => {
    const date = dateKeyDaysFromNow(5)
    tenant = await createTenant({ capacity: 6, priceMinor: 95_000, departureDate: date })

    const byDate = await collectCandidates({
      propertyId: tenant.propertyId,
      dates: [date],
      guest: {
        ability: AbilityLevel.BEGINNER,
        interests: [],
        pace: 'BALANCED',
        partySize: 2,
        budgetPerDayMinor: null,
        mobilityNotes: null,
        personalizationAllowed: true,
      },
      basePlaceId: tenant.placeId,
      preferredTransport: [],
      currency: 'MXN',
    })

    const candidates = byDate.get(date) ?? []
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.candidate.unitPriceMinor).toBe(95_000)
    expect(candidates[0]?.candidate.capacityRemaining).toBe(6)
    expect(candidates[0]?.included).toBe(true)
  })

  it('counts held capacity as gone, so a hold cannot be double-offered', async () => {
    const date = dateKeyDaysFromNow(5)
    tenant = await createTenant({ capacity: 3, departureDate: date })

    const cart = await prisma.cart.create({
      data: {
        organizationId: tenant.organizationId,
        propertyId: tenant.propertyId,
        guestId: tenant.guestId,
        currency: 'MXN',
      },
      select: { id: true },
    })
    const { placeHold } = await import('@/modules/inventory/service')
    await placeHold({
      organizationId: tenant.organizationId,
      slotId: tenant.slotId,
      cartId: cart.id,
      quantity: 2,
    })

    const byDate = await collectCandidates({
      propertyId: tenant.propertyId,
      dates: [date],
      guest: {
        ability: AbilityLevel.BEGINNER,
        interests: [],
        pace: 'BALANCED',
        partySize: 2,
        budgetPerDayMinor: null,
        mobilityNotes: null,
        personalizationAllowed: true,
      },
      basePlaceId: tenant.placeId,
      preferredTransport: [],
      currency: 'MXN',
    })

    const candidate = byDate.get(date)?.[0]
    expect(candidate?.candidate.capacityRemaining).toBe(1)
    // A party of two cannot fit into the one remaining place.
    expect(candidate?.included).toBe(false)
    expect(candidate?.exclusions).toContain('insufficient_capacity')
  })

  it('excludes a water activity when the day’s conditions exceed its limit', async () => {
    const date = dateKeyDaysFromNow(5)
    tenant = await createTenant({
      capacity: 6,
      departureDate: date,
      placeKind: PlaceKind.SURF_BREAK,
      maxSafeRisk: ConditionsRisk.MODERATE,
      conditions: { risk: ConditionsRisk.EXTREME, minAbilityRequired: AbilityLevel.EXPERT },
    })

    const byDate = await collectCandidates({
      propertyId: tenant.propertyId,
      dates: [date],
      guest: {
        ability: AbilityLevel.BEGINNER,
        interests: [],
        pace: 'BALANCED',
        partySize: 2,
        budgetPerDayMinor: null,
        mobilityNotes: null,
        personalizationAllowed: true,
      },
      basePlaceId: tenant.placeId,
      preferredTransport: [],
      currency: 'MXN',
    })

    const candidate = byDate.get(date)?.[0]
    expect(candidate?.included).toBe(false)
    expect(candidate?.exclusions).toContain('conditions_risk_above_activity_limit')
  })

  it('leaves a land activity unaffected by ocean conditions', async () => {
    const date = dateKeyDaysFromNow(5)
    tenant = await createTenant({
      capacity: 6,
      departureDate: date,
      placeKind: PlaceKind.MARKET,
      maxSafeRisk: ConditionsRisk.LOW,
      conditions: { risk: ConditionsRisk.EXTREME, minAbilityRequired: AbilityLevel.EXPERT },
    })

    const byDate = await collectCandidates({
      propertyId: tenant.propertyId,
      dates: [date],
      guest: {
        ability: AbilityLevel.BEGINNER,
        interests: [],
        pace: 'BALANCED',
        partySize: 2,
        budgetPerDayMinor: null,
        mobilityNotes: null,
        personalizationAllowed: true,
      },
      basePlaceId: tenant.placeId,
      preferredTransport: [],
      currency: 'MXN',
    })

    expect(byDate.get(date)?.[0]?.included).toBe(true)
  })

  it('never includes another property’s experiences', async () => {
    const date = dateKeyDaysFromNow(5)
    tenant = await createTenant({ departureDate: date })
    const other = await createTenant({ departureDate: date })

    const byDate = await collectCandidates({
      propertyId: tenant.propertyId,
      dates: [date],
      guest: {
        ability: AbilityLevel.BEGINNER,
        interests: [],
        pace: 'BALANCED',
        partySize: 1,
        budgetPerDayMinor: null,
        mobilityNotes: null,
        personalizationAllowed: true,
      },
      basePlaceId: tenant.placeId,
      preferredTransport: [],
      currency: 'MXN',
    })

    const experienceIds = (byDate.get(date) ?? []).map((c) => c.candidate.experienceId)
    expect(experienceIds).toContain(tenant.experienceId)
    expect(experienceIds).not.toContain(other.experienceId)
  })

  it('skips an unpublished experience entirely', async () => {
    const date = dateKeyDaysFromNow(5)
    tenant = await createTenant({ departureDate: date })
    await prisma.experience.update({
      where: { id: tenant.experienceId },
      data: { status: 'DRAFT' },
    })

    const byDate = await collectCandidates({
      propertyId: tenant.propertyId,
      dates: [date],
      guest: {
        ability: AbilityLevel.BEGINNER,
        interests: [],
        pace: 'BALANCED',
        partySize: 1,
        budgetPerDayMinor: null,
        mobilityNotes: null,
        personalizationAllowed: true,
      },
      basePlaceId: tenant.placeId,
      preferredTransport: [],
      currency: 'MXN',
    })

    expect(byDate.get(date) ?? []).toHaveLength(0)
  })
})

describe('buildItinerary', () => {
  it('persists a plan, its items and the recommendations behind it', async () => {
    const date = dateKeyDaysFromNow(5)
    tenant = await createTenant({ capacity: 6, departureDate: date, departureTime: '09:00' })

    const { itineraryId, generated } = await buildItinerary({
      guestId: tenant.guestId,
      stayId: tenant.stayId,
      startDate: date,
      endDate: date,
    })

    const itinerary = await prisma.itinerary.findUniqueOrThrow({
      where: { id: itineraryId },
      include: { items: true },
    })

    expect(itinerary.status).toBe(ItineraryStatus.PROPOSED)
    expect(itinerary.generatorVersion).toBe(generated.generatorVersion)
    expect(itinerary.items.length).toBeGreaterThan(0)

    const experiences = itinerary.items.filter((i) => i.kind === ItineraryItemKind.EXPERIENCE)
    expect(experiences).toHaveLength(1)
    expect(experiences[0]?.experienceId).toBe(tenant.experienceId)
    expect(experiences[0]?.rationale.length).toBeGreaterThan(0)
    expect(experiences[0]?.score).toBeGreaterThan(0)

    const recommendations = await prisma.recommendation.findMany({
      where: { guestId: tenant.guestId },
    })
    expect(recommendations.length).toBeGreaterThan(0)
  })

  it('records a refused candidate as a recommendation with its exclusions', async () => {
    const date = dateKeyDaysFromNow(5)
    tenant = await createTenant({
      capacity: 6,
      departureDate: date,
      placeKind: PlaceKind.SURF_BREAK,
      maxSafeRisk: ConditionsRisk.LOW,
      conditions: { risk: ConditionsRisk.EXTREME, minAbilityRequired: AbilityLevel.EXPERT },
    })

    await buildItinerary({ guestId: tenant.guestId, startDate: date, endDate: date })

    const recommendation = await prisma.recommendation.findFirstOrThrow({
      where: { guestId: tenant.guestId, experienceId: tenant.experienceId },
    })
    expect(recommendation.exclusions).toContain('conditions_risk_above_activity_limit')
  })

  it('archives the previous plan for the same dates instead of accumulating', async () => {
    const date = dateKeyDaysFromNow(5)
    tenant = await createTenant({ departureDate: date })

    const first = await buildItinerary({ guestId: tenant.guestId, startDate: date, endDate: date })
    const second = await buildItinerary({ guestId: tenant.guestId, startDate: date, endDate: date })

    const firstRow = await prisma.itinerary.findUniqueOrThrow({ where: { id: first.itineraryId } })
    const secondRow = await prisma.itinerary.findUniqueOrThrow({ where: { id: second.itineraryId } })

    expect(firstRow.status).toBe(ItineraryStatus.ARCHIVED)
    expect(secondRow.status).toBe(ItineraryStatus.PROPOSED)

    const live = await prisma.itinerary.count({
      where: { guestId: tenant.guestId, status: ItineraryStatus.PROPOSED },
    })
    expect(live).toBe(1)
  })

  it('does not use stated interests without personalization consent', async () => {
    const date = dateKeyDaysFromNow(5)
    tenant = await createTenant({ departureDate: date, grantPersonalization: false })

    await buildItinerary({ guestId: tenant.guestId, startDate: date, endDate: date })

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: 'itinerary.generated' },
      orderBy: { createdAt: 'desc' },
    })
    expect((audit.metadataJson as { personalizationAllowed?: boolean }).personalizationAllowed).toBe(
      false,
    )

    const recommendation = await prisma.recommendation.findFirstOrThrow({
      where: { guestId: tenant.guestId },
    })
    // The interest-match reason is the one thing consent gates.
    expect(recommendation.reasons.join(' ')).not.toMatch(/you said you were here for/i)
  })

  it('records an AgentRun with token and cost telemetry for the narrative', async () => {
    const date = dateKeyDaysFromNow(5)
    tenant = await createTenant({ departureDate: date })

    const { agentRunId, narrative } = await buildItinerary({
      guestId: tenant.guestId,
      startDate: date,
      endDate: date,
    })

    expect(agentRunId).toBeTruthy()
    expect(narrative.length).toBeGreaterThan(0)

    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: agentRunId! } })
    expect(run.task).toBe('itinerary.rationale')
    expect(run.provider).toBe('mock')
    expect(run.status).toBe('SUCCEEDED')
    expect(run.inputTokens).toBeGreaterThan(0)
    expect(run.outputTokens).toBeGreaterThan(0)
  })

  it('builds a plan with no narrative at all when the AI step is skipped', async () => {
    const date = dateKeyDaysFromNow(5)
    tenant = await createTenant({ departureDate: date })

    const result = await buildItinerary({
      guestId: tenant.guestId,
      startDate: date,
      endDate: date,
      withNarrative: false,
    })

    expect(result.agentRunId).toBeNull()
    expect(result.narrative).toEqual([])

    const itinerary = await prisma.itinerary.findUniqueOrThrow({
      where: { id: result.itineraryId },
      include: { items: true },
    })
    // The plan itself is unaffected: the model is decoration, not machinery.
    expect(itinerary.items.filter((i) => i.kind === ItineraryItemKind.EXPERIENCE)).toHaveLength(1)
  })

  it('redacts guest free text before it reaches the model payload', async () => {
    const date = dateKeyDaysFromNow(5)
    tenant = await createTenant({ departureDate: date })
    await prisma.guest.update({
      where: { id: tenant.guestId },
      data: { dietaryNotes: 'Reach me on priya@example.com or +52 954 000 0000' },
    })

    const { agentRunId } = await buildItinerary({
      guestId: tenant.guestId,
      startDate: date,
      endDate: date,
    })

    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: agentRunId! } })
    const serialized = JSON.stringify(run.inputJson)
    expect(serialized).not.toContain('priya@example.com')
    expect(serialized).not.toContain('954 000 0000')
  })

  it('rejects a window longer than the supported trip length', async () => {
    tenant = await createTenant({})
    await expect(
      buildItinerary({
        guestId: tenant.guestId,
        startDate: dateKeyDaysFromNow(1),
        endDate: dateKeyDaysFromNow(40),
      }),
    ).rejects.toThrow(/limited to 21 days/)
  })

  it('rejects an end date before the start date', async () => {
    tenant = await createTenant({})
    await expect(
      buildItinerary({
        guestId: tenant.guestId,
        startDate: dateKeyDaysFromNow(10),
        endDate: dateKeyDaysFromNow(5),
      }),
    ).rejects.toThrow()
  })
})

describe('getAlternativesForDate', () => {
  it('separates what was offered from what was refused, with reasons', async () => {
    const date = dateKeyDaysFromNow(5)
    tenant = await createTenant({ capacity: 6, departureDate: date })

    const blocked = await createTenant({
      capacity: 6,
      departureDate: date,
      placeKind: PlaceKind.SURF_BREAK,
      maxSafeRisk: ConditionsRisk.LOW,
      conditions: { risk: ConditionsRisk.EXTREME, minAbilityRequired: AbilityLevel.EXPERT },
    })

    // Move the blocked experience into the first tenant's property so both are
    // candidates for the same guest.
    await prisma.experience.update({
      where: { id: blocked.experienceId },
      data: { propertyId: tenant.propertyId, organizationId: tenant.organizationId },
    })
    await prisma.availabilitySlot.update({
      where: { id: blocked.slotId },
      data: { organizationId: tenant.organizationId },
    })
    await prisma.price.updateMany({
      where: { experienceId: blocked.experienceId },
      data: { organizationId: tenant.organizationId },
    })

    const alternatives = await getAlternativesForDate({ guestId: tenant.guestId, date })

    expect(alternatives.included.map((c) => c.candidate.experienceId)).toContain(tenant.experienceId)
    expect(alternatives.excluded.map((c) => c.candidate.experienceId)).toContain(
      blocked.experienceId,
    )
    expect(alternatives.excluded[0]?.exclusions.length).toBeGreaterThan(0)
  })
})

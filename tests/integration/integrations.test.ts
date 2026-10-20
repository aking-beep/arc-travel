import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { isAppError } from '@/lib/errors'
import { money } from '@/lib/money'
import { TransportMode } from '@/lib/prisma-types'
import {
  FixtureConditionsProvider,
  FixtureMapsProvider,
  getIntegrations,
  InternalAnalyticsSink,
  NoopMessagingProvider,
  resetIntegrations,
  SimulatedPaymentsProvider,
} from '@/modules/integrations/defaults'
import { createTenant, resetDatabase, type TenantFixture } from '../helpers/factory'

/**
 * Integration provider defaults.
 *
 * The behaviour under test is the refusal to fabricate. A provider that cannot
 * answer must say so, because the safety gate downstream treats a missing
 * conditions reading conservatively — which is only sound if "missing" really
 * means missing rather than "interpolated".
 */
let tenant: TenantFixture

beforeEach(async () => {
  await resetDatabase()
  resetIntegrations()
  tenant = await createTenant({})
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('resolution', () => {
  it('wires the offline defaults', () => {
    const integrations = getIntegrations()
    expect(integrations.payments.name).toBe('simulated')
    expect(integrations.payments.isLive).toBe(false)
    expect(integrations.maps.name).toBe('fixture')
    expect(integrations.conditions.name).toBe('fixture')
    expect(integrations.messaging.canDeliver).toBe(false)
    expect(integrations.analytics.name).toBe('internal')
  })
})

describe('SimulatedPaymentsProvider', () => {
  const provider = new SimulatedPaymentsProvider()

  it('marks every intent as simulated and unmistakably prefixed', async () => {
    const result = await provider.createIntent({
      idempotencyKey: 'key-1',
      amount: money(190_000),
      orderReference: 'ARC-ABCD-EFGH',
      description: 'Two surf lessons',
    })

    expect(result.ok).toBe(true)
    expect(result.data?.isSimulated).toBe(true)
    expect(result.data?.reference).toBe('SIMULATED-ARC-ABCD-EFGH')
    expect(provider.isLive).toBe(false)
  })

  it('marks refunds the same way', async () => {
    const result = await provider.refund({
      idempotencyKey: 'key-2',
      paymentReference: 'SIMULATED-ARC-ABCD-EFGH',
      amount: money(190_000),
      reason: 'guest cancelled',
    })

    expect(result.data?.isSimulated).toBe(true)
    expect(result.data?.reference).toContain('SIMULATED-REFUND-')
  })
})

describe('FixtureMapsProvider', () => {
  const provider = new FixtureMapsProvider()

  it('returns a seeded edge for a known place', async () => {
    const place = await prisma.place.findUniqueOrThrow({ where: { id: tenant.placeId } })

    const result = await provider.estimateRoute({
      from: { latitude: place.latitude, longitude: place.longitude },
      to: { latitude: place.latitude, longitude: place.longitude },
      modes: [],
    })

    expect(result.ok).toBe(true)
    expect(result.data?.length).toBeGreaterThan(0)
    // Provenance travels with the estimate.
    expect(result.data?.[0]?.source).toContain('ARC seeded')
    expect(result.data?.[0]?.observedAt).toBeInstanceOf(Date)
  })

  it('fails rather than guessing a straight-line time for an unknown point', async () => {
    const result = await provider.estimateRoute({
      // Mid-Pacific: nowhere near any seeded place.
      from: { latitude: 10.0, longitude: -140.0 },
      to: { latitude: 11.0, longitude: -141.0 },
      modes: [],
    })

    expect(result.ok).toBe(false)
    expect(result.data).toBeNull()
    expect(result.reason).toBe('no_seeded_place_within_tolerance')
  })

  it('fails when no edge exists for the requested mode', async () => {
    const place = await prisma.place.findUniqueOrThrow({ where: { id: tenant.placeId } })

    const result = await provider.estimateRoute({
      from: { latitude: place.latitude, longitude: place.longitude },
      to: { latitude: place.latitude, longitude: place.longitude },
      modes: [TransportMode.BOAT],
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_edge_for_requested_modes')
  })
})

describe('FixtureConditionsProvider', () => {
  const provider = new FixtureConditionsProvider()

  it('returns readings with their source and observation time', async () => {
    const withConditions = await createTenant({
      conditions: { risk: 'MODERATE', minAbilityRequired: 'IMPROVER' },
      departureDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
    })
    const place = await prisma.place.findUniqueOrThrow({ where: { id: withConditions.placeId } })
    const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)

    const result = await provider.getReadings({
      latitude: place.latitude,
      longitude: place.longitude,
      from: date,
      to: date,
    })

    expect(result.ok).toBe(true)
    expect(result.data).toHaveLength(1)
    expect(result.data?.[0]?.risk).toBe('MODERATE')
    expect(result.data?.[0]?.minAbilityRequired).toBe('IMPROVER')
    expect(result.data?.[0]?.source).toBeTruthy()
    expect(result.data?.[0]?.observedAt).toBeInstanceOf(Date)
  })

  it('omits a date it has no reading for rather than interpolating', async () => {
    const withConditions = await createTenant({
      conditions: { risk: 'LOW', minAbilityRequired: 'BEGINNER' },
      departureDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
    })
    const place = await prisma.place.findUniqueOrThrow({ where: { id: withConditions.placeId } })

    const from = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)
    const to = new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10)

    const result = await provider.getReadings({
      latitude: place.latitude,
      longitude: place.longitude,
      from,
      to,
    })

    // Five days requested, one seeded: exactly one comes back.
    expect(result.ok).toBe(true)
    expect(result.data).toHaveLength(1)
    expect(result.data?.[0]?.forDate).toBe(from)
  })

  it('fails for a point with no seeded place nearby', async () => {
    const result = await provider.getReadings({
      latitude: 10.0,
      longitude: -140.0,
      from: '2026-11-02',
      to: '2026-11-03',
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_seeded_place_within_tolerance')
  })
})

describe('NoopMessagingProvider', () => {
  const provider = new NoopMessagingProvider()

  it('refuses to deliver rather than silently succeeding', async () => {
    // A no-op that reports success is how a product ends up believing it
    // messaged someone. The kill switch lives here as well as in the workflow.
    await expect(
      provider.send({
        to: 'guest@example.com',
        channel: 'email',
        subject: 'Your transfer',
        body: 'Hello',
        approvalId: 'approval-1',
      }),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === 'FORBIDDEN')

    expect(provider.canDeliver).toBe(false)
  })

  it('refuses even when an approval is attached', async () => {
    await expect(
      provider.send({
        to: 'guest@example.com',
        channel: 'whatsapp',
        subject: null,
        body: 'Approved message',
        approvalId: 'a-real-approval',
      }),
    ).rejects.toThrow(/will not contact a guest/)
  })
})

describe('InternalAnalyticsSink', () => {
  it('accepts an event without duplicating the write', async () => {
    const sink = new InternalAnalyticsSink()
    const before = await prisma.analyticsEvent.count()

    const result = await sink.capture({
      name: 'experience_viewed',
      surface: 'guest',
      subjectKey: 'pseudonym-abc',
      properties: { experienceId: tenant.experienceId },
      occurredAt: new Date(),
    })

    expect(result.ok).toBe(true)
    // modules/analytics/track owns the persistence; the sink must not double it.
    expect(await prisma.analyticsEvent.count()).toBe(before)
  })
})

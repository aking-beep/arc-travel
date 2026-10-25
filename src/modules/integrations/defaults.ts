import { getEnv } from '@/lib/env'
import { forbidden } from '@/lib/errors'
import { type Money } from '@/lib/money'
import { prisma } from '@/lib/db'
import { dateRange } from '@/lib/dates'
import { TransportMode } from '@/lib/prisma-types'
import {
  providerFailed,
  providerOk,
  type AnalyticsSink,
  type ConditionsProvider,
  type ConditionsReading,
  type MapsProvider,
  type MessagingProvider,
  type PaymentIntent,
  type PaymentsProvider,
  type ProviderResult,
  type RefundResult,
  type RouteEstimate,
  type TravelAdviceDocument,
  type TravelAdviceProvider,
} from './types'
import { GovUkTravelAdviceProvider, govukPublicUrl } from './govuk'
import { StripePaymentsProvider } from './stripe'
import govukMexico from './fixtures/govuk-travel-advice-mexico.json'

/**
 * The offline defaults.
 *
 * These are what make the POC runnable with no API keys, no network and no
 * budget. Each is honest about what it is: the payment provider marks every
 * intent simulated, the messaging provider refuses to deliver, and the maps and
 * conditions providers read seeded data rather than inventing it.
 */

// === Payments ===============================================================

export class SimulatedPaymentsProvider implements PaymentsProvider {
  readonly name = 'simulated'
  readonly isLive = false

  async createIntent(input: {
    idempotencyKey: string
    amount: Money
    orderReference: string
    description: string
  }): Promise<ProviderResult<PaymentIntent>> {
    // Unmistakably marked, so it can never be reconciled against a real
    // processor by accident.
    return providerOk(this.name, {
      reference: `SIMULATED-${input.orderReference}`,
      status: 'succeeded' as const,
      amount: input.amount,
      isSimulated: true,
    })
  }

  async retrieveIntent(_input: { reference: string }): Promise<ProviderResult<PaymentIntent>> {
    /*
     * There is nothing to read back.
     *
     * This provider never created anything at a processor, so returning a
     * succeeded intent here would be inventing a payment — and it is exactly
     * the value `checkout()` would use to decide an order is paid for.
     */
    return providerFailed(this.name, 'not_applicable')
  }

  async refund(input: {
    idempotencyKey: string
    paymentReference: string
    amount: Money
    reason: string
  }): Promise<ProviderResult<RefundResult>> {
    return providerOk(this.name, {
      reference: `SIMULATED-REFUND-${input.paymentReference}`,
      amount: input.amount,
      isSimulated: true,
    })
  }
}

// === Maps ===================================================================

/**
 * Reads the seeded `TravelEdge` matrix.
 *
 * Resolves coordinates to the nearest seeded place within a tolerance, and
 * fails when it cannot — rather than falling back to a straight-line estimate,
 * which in a town where the road bends inland around a headland would produce
 * an itinerary that does not work.
 */
export class FixtureMapsProvider implements MapsProvider {
  readonly name = 'fixture'

  /** Degrees. Roughly 300m at this latitude — tight enough to be a real match. */
  private static readonly TOLERANCE = 0.003

  async estimateRoute(input: {
    from: { latitude: number; longitude: number }
    to: { latitude: number; longitude: number }
    modes: TransportMode[]
  }): Promise<ProviderResult<RouteEstimate[]>> {
    const places = await prisma.place.findMany({
      select: { id: true, latitude: true, longitude: true },
    })

    const nearest = (point: { latitude: number; longitude: number }) => {
      let best: { id: string; distance: number } | null = null
      for (const place of places) {
        const distance = Math.hypot(
          place.latitude - point.latitude,
          place.longitude - point.longitude,
        )
        if (!best || distance < best.distance) best = { id: place.id, distance }
      }
      return best && best.distance <= FixtureMapsProvider.TOLERANCE ? best.id : null
    }

    const fromId = nearest(input.from)
    const toId = nearest(input.to)

    if (!fromId || !toId) {
      return providerFailed(this.name, 'no_seeded_place_within_tolerance')
    }

    const edges = await prisma.travelEdge.findMany({
      where: {
        fromPlaceId: fromId,
        toPlaceId: toId,
        ...(input.modes.length > 0 ? { mode: { in: input.modes } } : {}),
      },
    })

    if (edges.length === 0) {
      return providerFailed(this.name, 'no_edge_for_requested_modes')
    }

    return providerOk(
      this.name,
      edges.map((edge) => ({
        minutes: edge.minutes,
        distanceKm: edge.distanceKm,
        mode: edge.mode,
        costMinor: edge.typicalCostMinor,
        currency: edge.currency,
        source: 'ARC seeded travel matrix',
        observedAt: edge.observedAt,
      })),
    )
  }
}

// === Conditions =============================================================

/**
 * Reads seeded `ConditionReport` rows.
 *
 * Omits a date it has no reading for rather than interpolating. The safety gate
 * treats a missing reading conservatively, and that is only sound if "missing"
 * genuinely means missing.
 */
export class FixtureConditionsProvider implements ConditionsProvider {
  readonly name = 'fixture'

  /** Degrees. Same tolerance as the maps provider, for the same reason. */
  private static readonly TOLERANCE = 0.003

  async getReadings(input: {
    latitude: number
    longitude: number
    from: string
    to: string
  }): Promise<ProviderResult<ConditionsReading[]>> {
    const places = await prisma.place.findMany({
      where: { conditionReports: { some: {} } },
      select: { id: true, latitude: true, longitude: true },
    })

    let nearest: { id: string; distance: number } | null = null
    for (const place of places) {
      const distance = Math.hypot(
        place.latitude - input.latitude,
        place.longitude - input.longitude,
      )
      if (!nearest || distance < nearest.distance) nearest = { id: place.id, distance }
    }

    if (!nearest || nearest.distance > FixtureConditionsProvider.TOLERANCE) {
      return providerFailed(this.name, 'no_seeded_place_within_tolerance')
    }

    const dates = dateRange(input.from, input.to)
    const reports = await prisma.conditionReport.findMany({
      where: {
        placeId: nearest.id,
        forDate: { in: dates.map((d) => new Date(`${d}T00:00:00.000Z`)) },
      },
      orderBy: { forDate: 'asc' },
    })

    return providerOk(
      this.name,
      reports.map((report) => ({
        forDate: report.forDate.toISOString().slice(0, 10),
        waveHeightMinM: report.waveHeightMinM,
        waveHeightMaxM: report.waveHeightMaxM,
        swellPeriodS: report.swellPeriodS,
        windKph: report.windKph,
        windDirection: report.windDirection,
        waterTempC: report.waterTempC,
        airTempC: report.airTempC,
        highTideLocal: report.highTideLocal,
        lowTideLocal: report.lowTideLocal,
        risk: report.risk,
        minAbilityRequired: report.minAbilityRequired,
        guideRecommended: report.guideRecommended,
        currentNotes: report.currentNotesEn,
        source: report.source,
        observedAt: report.observedAt,
      })),
    )
  }
}

// === Messaging ==============================================================

/**
 * Refuses to deliver.
 *
 * The kill switch lives here as well as in the approval workflow, so a future
 * caller that forgets to check `ARC_ENABLE_OUTBOUND_MESSAGING` still cannot
 * reach a guest. It throws rather than silently succeeding: a no-op that
 * reports success is how a product ends up believing it messaged someone.
 */
export class NoopMessagingProvider implements MessagingProvider {
  readonly name = 'noop'
  readonly canDeliver = false

  async send(_input: {
    to: string
    channel: 'email' | 'sms' | 'whatsapp'
    subject: string | null
    body: string
    approvalId: string | null
  }): Promise<never> {
    throw forbidden(
      'Outbound messaging is disabled in this build. ARC will not contact a guest on a hotel’s behalf.',
    )
  }
}

// === Analytics ==============================================================

/**
 * Writes nowhere beyond our own table.
 *
 * `modules/analytics/track` already persists the event; this sink exists so a
 * third-party destination can be added without changing a call site. It
 * deliberately does nothing rather than duplicating the write.
 */
export class InternalAnalyticsSink implements AnalyticsSink {
  readonly name = 'internal'

  async capture(_input: {
    name: string
    surface: string
    subjectKey: string | null
    properties: Record<string, unknown>
    occurredAt: Date
  }): Promise<ProviderResult<null>> {
    return providerOk<null>(this.name, null)
  }
}

// === Travel advice ==========================================================

/**
 * Reads a GOV.UK-shaped payload from the repository.
 *
 * Offline and deterministic: `retrievedAt` is the fixture's own authored date,
 * not the clock, and every document is marked `isFixture` so the guest card
 * labels it as demo text. A slug with no fixture fails rather than borrowing
 * another country's advice.
 */
export class FixtureTravelAdviceProvider implements TravelAdviceProvider {
  readonly name = 'fixture'
  readonly isLive = false

  private static readonly FIXTURES: Record<string, { _fixture: { authoredAt: string } }> = {
    mexico: govukMexico,
  }

  async getAdvice(input: { slug: string }): Promise<ProviderResult<TravelAdviceDocument>> {
    const payload = FixtureTravelAdviceProvider.FIXTURES[input.slug]
    if (!payload) return providerFailed(this.name, 'no_fixture_for_slug')
    return providerOk(this.name, {
      slug: input.slug,
      sourceUrl: govukPublicUrl(input.slug),
      // A copy, so a caller cannot mutate the shared fixture.
      payload: structuredClone(payload),
      retrievedAt: new Date(payload._fixture.authoredAt),
      isFixture: true,
    })
  }
}

// === Resolution =============================================================

/**
 * Chooses implementations from the environment.
 *
 * Payments is the one boundary with a live implementation wired
 * (`StripePaymentsProvider`, refused outright in demo mode); the rest resolve
 * to their offline defaults. Each further live provider is a new class plus
 * one case here — the point of the interfaces being real types rather than env
 * reads scattered through the domain.
 *
 * The `satisfies never` lines below are what stops this function and
 * `src/lib/env.ts` drifting apart. Adding a name to one of those enums without
 * an implementation here is now a type error rather than a setting that is read
 * and ignored — which is exactly how `CONDITIONS_PROVIDER=stormglass` came to
 * mean "the safety gate reads a seeded table" while reporting itself as live.
 */
const unimplemented = (key: string, value: never): never => {
  throw new Error(
    `${key}=${String(value)} has no implementation in getIntegrations(). ` +
      'Build the provider, or remove the value from the enum in src/lib/env.ts.',
  )
}
let cached: {
  payments: PaymentsProvider
  maps: MapsProvider
  conditions: ConditionsProvider
  messaging: MessagingProvider
  analytics: AnalyticsSink
  travelAdvice: TravelAdviceProvider
} | null = null

export function getIntegrations() {
  if (cached) return cached
  const env = getEnv()

  // Defence in depth: `getEnv()` already refuses this combination.
  if (env.ARC_DATA_MODE === 'demo' && env.PAYMENTS_PROVIDER !== 'simulated') {
    throw new Error('A live payments provider cannot be used while ARC_DATA_MODE=demo.')
  }

  cached = {
    /*
     * `getEnv()` has already refused `stripe` without both of its secrets, so
     * the non-null assertion here is on a value the environment contract
     * guarantees rather than a hope.
     */
    payments:
      env.PAYMENTS_PROVIDER === 'stripe'
        ? new StripePaymentsProvider({ secretKey: env.STRIPE_SECRET_KEY ?? '' })
        : new SimulatedPaymentsProvider(),
    maps:
      env.MAPS_PROVIDER === 'fixture'
        ? new FixtureMapsProvider()
        : unimplemented('MAPS_PROVIDER', env.MAPS_PROVIDER),
    conditions:
      env.CONDITIONS_PROVIDER === 'fixture'
        ? new FixtureConditionsProvider()
        : unimplemented('CONDITIONS_PROVIDER', env.CONDITIONS_PROVIDER),
    messaging:
      env.MESSAGING_PROVIDER === 'noop'
        ? new NoopMessagingProvider()
        : unimplemented('MESSAGING_PROVIDER', env.MESSAGING_PROVIDER),
    analytics:
      env.ANALYTICS_PROVIDER === 'internal'
        ? new InternalAnalyticsSink()
        : unimplemented('ANALYTICS_PROVIDER', env.ANALYTICS_PROVIDER),
    // `getEnv()` refuses `govuk` in demo mode, so the demo never leaves the box.
    travelAdvice:
      env.TRAVEL_ADVICE_PROVIDER === 'govuk'
        ? new GovUkTravelAdviceProvider()
        : new FixtureTravelAdviceProvider(),
  }
  return cached
}

/** Test seam. */
export function resetIntegrations(): void {
  cached = null
}

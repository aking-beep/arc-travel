import type { Money } from '@/lib/money'
import type { DateKey } from '@/lib/dates'
import type { AbilityLevel, ConditionsRisk, TransportMode } from '@/lib/prisma-types'

/**
 * Integration boundaries.
 *
 * Each concern ARC Stay could outsource has an interface here and a
 * deterministic offline implementation in `./defaults.ts`. The point is that
 * the boundary is a type the domain depends on, not an environment variable
 * read at a call site — so "swap in Stripe" is one new class rather than a
 * search for every place a payment might happen.
 *
 * Two rules every implementation must honour:
 *   1. Never fabricate. A provider that cannot answer returns
 *      `{ ok: false, reason }`; it does not guess. A fabricated availability
 *      slot or conditions reading is worse than no answer.
 *   2. Carry provenance. Anything describing the real world comes back with
 *      its source and the time it was observed, so the UI can show both.
 */
export interface ProviderResult<T> {
  ok: boolean
  data: T | null
  /** Set when `ok` is false. Machine-readable. */
  reason: string | null
  /** Which implementation answered, for telemetry and for the UI to attribute. */
  provider: string
}

export const providerOk = <T>(provider: string, data: T): ProviderResult<T> => ({
  ok: true,
  data,
  reason: null,
  provider,
})

export const providerFailed = <T>(provider: string, reason: string): ProviderResult<T> => ({
  ok: false,
  data: null,
  reason,
  provider,
})

// === Payments ===============================================================

/**
 * Payments.
 *
 * The POC's implementation moves no money and the interface is shaped so that
 * it cannot pretend otherwise: every intent carries `isSimulated`, and the
 * simulated provider sets it true unconditionally.
 */
export interface PaymentIntent {
  /** Provider-side reference. The simulated provider prefixes `SIMULATED-`. */
  reference: string
  status: 'requires_confirmation' | 'succeeded' | 'failed'
  amount: Money
  /** False only for a genuinely live provider. */
  isSimulated: boolean
}

export interface RefundResult {
  reference: string
  amount: Money
  isSimulated: boolean
}

export interface PaymentsProvider {
  readonly name: string
  /** True when this provider can move real money. */
  readonly isLive: boolean

  createIntent(input: {
    /** Idempotency is the caller's; the provider must respect the key. */
    idempotencyKey: string
    amount: Money
    orderReference: string
    description: string
  }): Promise<ProviderResult<PaymentIntent>>

  refund(input: {
    idempotencyKey: string
    paymentReference: string
    amount: Money
    reason: string
  }): Promise<ProviderResult<RefundResult>>
}

// === Maps and travel ========================================================

export interface RouteEstimate {
  minutes: number
  distanceKm: number | null
  mode: TransportMode
  /** Typical one-way cost, where the provider can estimate one. */
  costMinor: number | null
  currency: string
  source: string
  observedAt: Date
}

export interface MapsProvider {
  readonly name: string

  /**
   * One-way travel estimate between two coordinates.
   *
   * Returns a failure rather than a straight-line guess when it cannot route:
   * an itinerary built on a fabricated travel time is an itinerary that does
   * not work in the real town.
   */
  estimateRoute(input: {
    from: { latitude: number; longitude: number }
    to: { latitude: number; longitude: number }
    modes: TransportMode[]
  }): Promise<ProviderResult<RouteEstimate[]>>
}

// === Conditions =============================================================

export interface ConditionsReading {
  forDate: DateKey
  waveHeightMinM: number
  waveHeightMaxM: number
  swellPeriodS: number | null
  windKph: number | null
  windDirection: string | null
  waterTempC: number | null
  airTempC: number | null
  highTideLocal: string | null
  lowTideLocal: string | null
  risk: ConditionsRisk
  /** The lowest ability the day demands. Never optimistic. */
  minAbilityRequired: AbilityLevel
  guideRecommended: boolean
  currentNotes: string | null
  /** Mandatory. A reading without its source and age cannot be displayed. */
  source: string
  observedAt: Date
}

export interface ConditionsProvider {
  readonly name: string

  /**
   * Readings for one place over a date range.
   *
   * A provider that cannot cover a date omits it rather than interpolating.
   * The gate in `modules/destination/conditions` treats a missing reading
   * conservatively, which is only sound if "missing" genuinely means missing.
   */
  getReadings(input: {
    latitude: number
    longitude: number
    from: DateKey
    to: DateKey
  }): Promise<ProviderResult<ConditionsReading[]>>
}

// === Messaging ==============================================================

export interface MessagingProvider {
  readonly name: string
  /** True when this provider can actually reach a person. */
  readonly canDeliver: boolean

  /**
   * Sends a message.
   *
   * The POC's implementation refuses. Outbound guest messaging is a kill
   * switch (`ARC_ENABLE_OUTBOUND_MESSAGING`), and the refusal lives at the
   * provider as well as in the approval workflow, so a future caller that
   * forgets to check the switch still cannot message a guest.
   */
  send(input: {
    to: string
    channel: 'email' | 'sms' | 'whatsapp'
    subject: string | null
    body: string
    /** Set when the message was authorised by a recorded Approval. */
    approvalId: string | null
  }): Promise<ProviderResult<{ reference: string }>>
}

// === Analytics ==============================================================

export interface AnalyticsSink {
  readonly name: string

  /**
   * Forwards a product event.
   *
   * `subjectKey` is already pseudonymised by `modules/analytics/track`. An
   * implementation must not attempt to resolve it back to a person, and must
   * not receive raw PII — there is nothing here to receive it with.
   */
  capture(input: {
    name: string
    surface: string
    subjectKey: string | null
    properties: Record<string, unknown>
    occurredAt: Date
  }): Promise<ProviderResult<null>>
}

// === Travel advice ==========================================================

/**
 * One government travel-advice document, as the source published it.
 *
 * `payload` is the source's own structure and is untrusted: it is parsed and
 * HTML-stripped by `modules/culture-context`, never rendered.
 */
export interface TravelAdviceDocument {
  /** The source's slug for the country, e.g. GOV.UK's `mexico`. */
  slug: string
  /** The canonical human-readable page a guest can be sent to. */
  sourceUrl: string
  payload: unknown
  /** When it was fetched, or for the fixture, when the fixture was written. */
  retrievedAt: Date
  /** True when this is the repository fixture rather than the live source. */
  isFixture: boolean
}

export interface TravelAdviceProvider {
  readonly name: string
  /** True when this provider reaches the real source over the network. */
  readonly isLive: boolean

  /**
   * Fetches the advice for one country.
   *
   * A provider that cannot answer returns `{ ok: false, reason }`. It never
   * falls back to remembered or invented text: the brief turns a failure into
   * "we could not reach this source", and that is only honest if a failure
   * really is one.
   */
  getAdvice(input: { slug: string }): Promise<ProviderResult<TravelAdviceDocument>>
}

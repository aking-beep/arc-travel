import { z } from 'zod'

import { applyDatabaseUrl } from './database-url'

/**
 * Environment contract. Parsed once, lazily, so that importing a module never
 * crashes a build just because an optional integration is unconfigured.
 *
 * Rule: the POC must boot with ONLY DATABASE_URL set. Every integration
 * defaults to a deterministic, offline implementation.
 */
const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', ''])])
  .transform((v) => v === true || v === 'true' || v === '1')

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  TEST_DATABASE_URL: z.string().optional(),

  AUTH_SECRET: z.string().default(''),
  /**
   * Salt for analytics pseudonyms. Deliberately separate from AUTH_SECRET:
   * reusing the session-signing key would let anyone who can read the
   * analytics table test guesses against it.
   */
  ANALYTICS_SALT: z.string().default(''),

  ARC_DATA_MODE: z.enum(['demo', 'pilot', 'live']).default('demo'),
  ARC_ENABLE_OUTBOUND_MESSAGING: booleanish.default(false),

  AI_PROVIDER: z.enum(['mock', 'anthropic']).default('mock'),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-sonnet-5-5'),
  AI_MAX_TOKENS: z.coerce.number().int().positive().default(2048),
  AI_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),

  PAYMENTS_PROVIDER: z.enum(['simulated', 'stripe']).default('simulated'),
  STRIPE_SECRET_KEY: z.string().optional(),
  /** Signs the webhook payloads. Without it no event can be trusted, so a live provider requires it. */
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  /*
   * Only the values that have an implementation.
   *
   * These enums used to list every provider the product might one day use —
   * `mapbox`, `google`, `stormglass`, `openweather`, `twilio`, `resend`,
   * `posthog` — and accept all of them, while `getIntegrations()` returned the
   * fixture regardless. The sharp edge was `CONDITIONS_PROVIDER=stormglass`:
   * an operator who set it believed live marine data was feeding the safety
   * gate, and the gate was reading a seeded table from the demo.
   *
   * A setting that is read but does nothing is worse than a missing setting,
   * so the vocabulary is now exactly what is built. A name from the old list
   * is refused by `assertProvidersAreImplemented` with a message that says it
   * is unbuilt rather than mistyped; anything else gets Zod's enum error.
   */
  MAPS_PROVIDER: z.enum(['fixture']).default('fixture'),

  CONDITIONS_PROVIDER: z.enum(['fixture']).default('fixture'),

  MESSAGING_PROVIDER: z.enum(['noop']).default('noop'),

  /** Culture-context travel advice. `fixture` is offline; `govuk` reads the live Content API. */
  TRAVEL_ADVICE_PROVIDER: z.enum(['fixture', 'govuk']).default('fixture'),

  ANALYTICS_PROVIDER: z.enum(['internal']).default('internal'),
  SENTRY_DSN: z.string().optional(),

  /**
   * Shared secret for the scheduled jobs under `/api/cron`.
   *
   * Unset means those routes 404 rather than run unauthenticated: an
   * unconfigured secret is "off", never "open".
   */
  CRON_SECRET: z.string().optional(),
})

export type Env = z.infer<typeof envSchema>

/**
 * Provider names this build once accepted and never implemented.
 *
 * Each maps to the message an operator needs: not "invalid value", which reads
 * as a typo, but "this is not built, and here is what you have instead".
 * Checked against the raw environment before Zod parses, so the refusal wins
 * over the enum error.
 */
const UNBUILT_PROVIDERS: Record<string, Record<string, string>> = {
  MAPS_PROVIDER: {
    mapbox: 'Routing is the seeded TravelEdge matrix (ADR-011). There is no Mapbox client.',
    google: 'Routing is the seeded TravelEdge matrix (ADR-011). There is no Google Maps client.',
  },
  CONDITIONS_PROVIDER: {
    stormglass:
      'There is no Stormglass client. Conditions are read from seeded ConditionReport rows, ' +
      'and those rows are what the safety gate in modules/destination/conditions reads. ' +
      'Setting this would have left you believing live marine data was gating recommendations.',
    openweather:
      'There is no OpenWeather client. Conditions are read from seeded ConditionReport rows, ' +
      'which are what the safety gate reads.',
  },
  MESSAGING_PROVIDER: {
    twilio:
      'Outbound guest messaging is a kill switch, not a provider choice. The messaging provider ' +
      'refuses to deliver while ARC_ENABLE_OUTBOUND_MESSAGING is false (non-negotiable 6).',
    resend:
      'Outbound guest messaging is a kill switch, not a provider choice. The messaging provider ' +
      'refuses to deliver while ARC_ENABLE_OUTBOUND_MESSAGING is false (non-negotiable 6).',
  },
  ANALYTICS_PROVIDER: {
    posthog:
      'There is no PostHog sink. Analytics events are persisted to AnalyticsEvent and forwarded ' +
      'nowhere. POSTHOG_KEY is no longer read.',
  },
}

/**
 * Keys that configured a provider that was never built.
 *
 * Setting one of these is not an error — an operator who has a Mapbox token
 * has done nothing wrong — but it must not look like it took effect. These
 * warn; the provider *names* above refuse.
 */
const IGNORED_KEYS: Record<string, string> = {
  MAPBOX_ACCESS_TOKEN: 'MAPS_PROVIDER has no Mapbox implementation; this token is not read.',
  GOOGLE_MAPS_API_KEY: 'MAPS_PROVIDER has no Google implementation; this key is not read.',
  STORMGLASS_API_KEY:
    'CONDITIONS_PROVIDER has no Stormglass implementation; this key is not read. ' +
    'The safety gate reads seeded ConditionReport rows.',
  POSTHOG_KEY: 'ANALYTICS_PROVIDER has no PostHog sink; this key is not read.',
}

function assertProvidersAreImplemented(source: NodeJS.ProcessEnv): void {
  const refusals: string[] = []
  for (const [key, unbuilt] of Object.entries(UNBUILT_PROVIDERS)) {
    const value = source[key]
    if (!value) continue
    const why = unbuilt[value]
    if (why) refusals.push(`  - ${key}=${value} is not implemented. ${why}`)
  }
  if (refusals.length > 0) {
    throw new Error(
      `Unimplemented integration provider requested:\n${refusals.join('\n')}\n` +
        'Remove the variable, or build the provider and add it to the enum in src/lib/env.ts.',
    )
  }

  for (const [key, why] of Object.entries(IGNORED_KEYS)) {
    if (source[key]) console.warn('[env] %s is set but ignored. %s', key, why)
  }
}


let cached: Env | null = null

/** Development-only fallbacks so `npm run dev` works with a bare .env. */
const DEV_AUTH_SECRET = 'arc-stay-development-only-secret-do-not-use-in-production'
const DEV_ANALYTICS_SALT = 'arc-stay-development-only-analytics-salt-not-for-production'

export function getEnv(): Env {
  if (cached) return cached

  applyDatabaseUrl()
  assertProvidersAreImplemented(process.env)

  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }

  const env = parsed.data

  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) {
    if (env.NODE_ENV === 'production') {
      throw new Error('AUTH_SECRET must be set to at least 32 characters in production.')
    }
    env.AUTH_SECRET = DEV_AUTH_SECRET
  }

  if (!env.ANALYTICS_SALT || env.ANALYTICS_SALT.length < 32) {
    if (env.NODE_ENV === 'production') {
      throw new Error('ANALYTICS_SALT must be set to at least 32 characters in production.')
    }
    env.ANALYTICS_SALT = DEV_ANALYTICS_SALT
  }

  if (env.AI_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
    throw new Error('AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY.')
  }

  // Demo mode is a hard guarantee that no real money can move.
  if (env.ARC_DATA_MODE === 'demo' && env.PAYMENTS_PROVIDER !== 'simulated') {
    throw new Error(
      'PAYMENTS_PROVIDER must be "simulated" while ARC_DATA_MODE=demo. ' +
        'Set ARC_DATA_MODE=pilot (with explicit approval) before enabling a live provider.',
    )
  }

  /*
   * A live payments provider is refused unless it is fully configured.
   *
   * Both halves are required, and the webhook secret is not optional: without
   * it `POST /api/webhooks/stripe` can verify nothing, so a payment that later
   * failed would leave a confirmed order holding capacity for ever. Starting
   * half-configured would make that a silent condition rather than a refusal.
   */
  if (env.PAYMENTS_PROVIDER === 'stripe') {
    if (!env.STRIPE_SECRET_KEY) {
      throw new Error('PAYMENTS_PROVIDER=stripe requires STRIPE_SECRET_KEY.')
    }
    if (!env.STRIPE_WEBHOOK_SECRET) {
      throw new Error(
        'PAYMENTS_PROVIDER=stripe requires STRIPE_WEBHOOK_SECRET. Without it the webhook ' +
          'cannot verify an event, and a payment that later fails would never release its capacity.',
      )
    }
  }

  // The demo is offline by design. A live advice source would also put real,
  // changing government text in front of a guest next to synthetic data.
  if (env.ARC_DATA_MODE === 'demo' && env.TRAVEL_ADVICE_PROVIDER !== 'fixture') {
    throw new Error(
      'TRAVEL_ADVICE_PROVIDER must be "fixture" while ARC_DATA_MODE=demo.',
    )
  }

  cached = env
  return env
}

/** Test-only: drop the memoised env so a test can re-parse mutated process.env. */
export function resetEnvCache(): void {
  cached = null
}

export const isDemoMode = (): boolean => getEnv().ARC_DATA_MODE === 'demo'

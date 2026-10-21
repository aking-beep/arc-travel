import { z } from 'zod'

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

  MAPS_PROVIDER: z.enum(['fixture', 'mapbox', 'google']).default('fixture'),
  MAPBOX_ACCESS_TOKEN: z.string().optional(),
  GOOGLE_MAPS_API_KEY: z.string().optional(),

  CONDITIONS_PROVIDER: z.enum(['fixture', 'stormglass', 'openweather']).default('fixture'),
  STORMGLASS_API_KEY: z.string().optional(),

  MESSAGING_PROVIDER: z.enum(['noop', 'twilio', 'resend']).default('noop'),

  /** Culture-context travel advice. `fixture` is offline; `govuk` reads the live Content API. */
  TRAVEL_ADVICE_PROVIDER: z.enum(['fixture', 'govuk']).default('fixture'),

  ANALYTICS_PROVIDER: z.enum(['internal', 'posthog']).default('internal'),
  POSTHOG_KEY: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
})

export type Env = z.infer<typeof envSchema>

let cached: Env | null = null

/** Development-only fallbacks so `npm run dev` works with a bare .env. */
const DEV_AUTH_SECRET = 'arc-stay-development-only-secret-do-not-use-in-production'
const DEV_ANALYTICS_SALT = 'arc-stay-development-only-analytics-salt-not-for-production'

export function getEnv(): Env {
  if (cached) return cached

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

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

  /**
   * Transactional email: a separate switch from outbound guest messaging, and
   * deliberately so. See ADR-040.
   *
   * `ARC_ENABLE_OUTBOUND_MESSAGING` governs ARC *initiating* contact with a
   * guest on a hotel's behalf — a nudge, a campaign, anything an agent drafted.
   * That stays off and `send_guest_message` keeps throwing. This governs the
   * reply to something a named person just did: the invitation they clicked
   * "invite" to send, the confirmation for the booking they just paid for, the
   * reset for the password they just asked to reset. Those are not outreach,
   * they are the second half of an action the person took, and a product that
   * cannot send them cannot be used by a real hotel.
   *
   * Off by default, so a deployment that says nothing sends nothing.
   */
  ARC_ENABLE_TRANSACTIONAL_EMAIL: booleanish.default(false),

  /**
   * The public origin this deployment is reached at, e.g.
   * `https://stay.example.com`. No trailing slash.
   *
   * Required once transactional email is on: every message carries a link, and
   * a link is the whole point of an invitation or a password reset. Guessing it
   * from a request header would mean whoever sent the request chose where the
   * recipient's credential-bearing link pointed.
   */
  ARC_PUBLIC_URL: z.string().url().optional(),

  /**
   * Who transactional mail is from, e.g. `ARC Stay <stay@example.com>`.
   *
   * Required with a live mail provider. The domain has to be one the provider
   * has verified, which is why this is configuration and not a constant.
   */
  ARC_MAIL_FROM: z.string().optional(),

  /** Where a recipient's reply goes. Optional; unset means replies go to `ARC_MAIL_FROM`. */
  ARC_MAIL_REPLY_TO: z.string().optional(),

  /**
   * Keys the seeded guests' portal tokens. See `src/lib/demo-portals.ts`.
   *
   * A portal token is a bearer credential, and the seed's used to be literals
   * in the repository. Optional here because local development and the test
   * suites use the documented non-secret fallback; required in production by
   * the check in `getEnv()`.
   */
  ARC_SEED_TOKEN_SECRET: z.string().optional(),

  /**
   * Deliberately open the hosted demo to anyone with the URL.
   *
   * `ARC_DEMO_PASSPHRASE` is the front-door lock, and it is opt-in, so a
   * production deployment that simply never set it was wide open and said
   * nothing. The sign-in page hands out an owner session with no credential
   * while `ARC_DATA_MODE=demo`, so "wide open" means a stranger can act as the
   * hotel. That is a reasonable thing to want for a conference URL, and an
   * unreasonable thing to arrive at by forgetting a variable, so it now has to
   * be said out loud.
   */
  ARC_ALLOW_OPEN_DEMO: booleanish.default(false),

  /**
   * Bearer token for the detailed form of `GET /api/health`.
   *
   * Unset means the detailed form is unavailable, never that it is open — the
   * same rule as `CRON_SECRET`. The anonymous form always answers, with almost
   * nothing in it.
   */
  MONITORING_TOKEN: z.string().optional(),

  AI_PROVIDER: z.enum(['mock', 'anthropic']).default('mock'),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-sonnet-5-5'),
  AI_MAX_TOKENS: z.coerce.number().int().positive().default(2048),
  AI_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),

  PAYMENTS_PROVIDER: z.enum(['simulated', 'stripe']).default('simulated'),
  STRIPE_SECRET_KEY: z.string().optional(),
  /** Signs the webhook payloads. Without it no event can be trusted, so a live provider requires it. */
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  /**
   * The key the *browser* initialises Stripe.js with (starts `pk_`).
   *
   * Publishable by design — it identifies the account and can do nothing but
   * confirm an intent whose client secret the holder already has. It is read
   * here, server-side, and passed to the payment form as a prop rather than
   * inlined through `NEXT_PUBLIC_`, so there is one place that decides whether
   * a live key is present and it is the same place that refuses a
   * half-configured provider.
   */
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),

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

  /**
   * Transactional mail delivery. `log` records the message and delivers
   * nothing; `resend` posts it to the Resend API.
   *
   * `log` is not a stub that pretends: the message is written to `EmailMessage`
   * with status `LOGGED`, and `/owner/messages` shows exactly what would have
   * gone out, to whom, with the real link in it. That is what makes a demo
   * honest about its own mail and what lets a hotel read the copy before any
   * of it reaches a guest.
   */
  MAIL_PROVIDER: z.enum(['log', 'resend']).default('log'),
  RESEND_API_KEY: z.string().optional(),

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

  /**
   * Shared secret the live-simulation runner authenticates with.
   *
   * Unset means `POST /api/simulation/ingest` 404s rather than accepts an
   * anonymous writer — the same rule as `CRON_SECRET`, and for a sharper
   * reason: the route writes rows that an operator then reads as a report of
   * what the product did. An unauthenticated feed is a feed anybody can lie
   * into, and the lie would be read as evidence. See ADR-043.
   */
  SIMULATION_TOKEN: z.string().optional(),
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
      'Outbound guest messaging is a kill switch, not a provider choice, and this is the wrong ' +
      'setting for it. If you want confirmations, invitations and password resets, those are ' +
      'transactional mail: set MAIL_PROVIDER=resend and ARC_ENABLE_TRANSACTIONAL_EMAIL=1 ' +
      '(ADR-040). MESSAGING_PROVIDER governs ARC messaging a guest unprompted, which stays off.',
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

/**
 * The non-secret that keys portal tokens on a developer machine.
 *
 * Declared here rather than imported from `src/lib/demo-portals.ts`, which is
 * where it is used. That module needs `node:crypto` for the HMAC, this module
 * is reached from `src/middleware.ts`, and middleware runs on the edge runtime
 * where `node:crypto` does not exist — so importing the one into the other
 * takes the whole site down with "Native module not found: node:crypto" on
 * every request. `src/lib/demo-gate.ts` uses WebCrypto for the same reason.
 * The dependency therefore points the other way: `demo-portals` imports this.
 */
export const LOCAL_SEED_TOKEN_SECRET = 'arc-stay-local-demo-tokens-not-for-any-deployment'

/** Development-only fallbacks so `npm run dev` works with a bare .env. */
const DEV_AUTH_SECRET = 'arc-stay-development-only-secret-do-not-use-in-production'
const DEV_ANALYTICS_SALT = 'arc-stay-development-only-analytics-salt-not-for-production'

/**
 * A blank value means unset.
 *
 * `.env.example` documents the optional variables as `NAME=""`, which is the
 * normal way to show one exists without giving it a value — and dotenv then
 * supplies an empty string, which is *present*. `ARC_PUBLIC_URL=""` therefore
 * failed `z.string().url()` and a copied example file refused to boot, with
 * the fix being to delete the line the file had just recommended. Strip the
 * blanks before parsing instead, so the documented way of writing "not set"
 * and the schema's idea of it are the same thing.
 */
function withoutBlanks(source: NodeJS.ProcessEnv): Record<string, string> {
  const kept: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value.trim() !== '') kept[key] = value
  }
  return kept
}

export function getEnv(): Env {
  if (cached) return cached

  applyDatabaseUrl()
  assertProvidersAreImplemented(process.env)

  const parsed = envSchema.safeParse(withoutBlanks(process.env))
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

  /*
   * A simulation ingest endpoint exists only where the data is synthetic.
   *
   * `ARC_DATA_MODE` is the deployment's own statement about whose data this is.
   * The runner refuses a target that does not say `demo`, and
   * `simulation_run_is_demo_only` refuses the row; this refuses the
   * *configuration*, so the live hotel's deployment cannot be given a token
   * that would let a simulation write to it at all. ADR-043.
   */
  if (env.SIMULATION_TOKEN && env.ARC_DATA_MODE !== 'demo') {
    throw new Error(
      'SIMULATION_TOKEN is only valid while ARC_DATA_MODE=demo. The live simulation invents ' +
        'guests, races for inventory and probes refusals; it runs against synthetic data or not ' +
        'at all (ADR-043). Unset the token on this deployment.',
    )
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
    if (!env.STRIPE_PUBLISHABLE_KEY) {
      throw new Error(
        'PAYMENTS_PROVIDER=stripe requires STRIPE_PUBLISHABLE_KEY. Without it the guest has no ' +
          'way to pay: the Payment Element cannot initialise, and checkout refuses every order ' +
          'for want of a confirmed payment.',
      )
    }
    if (!env.STRIPE_PUBLISHABLE_KEY.startsWith('pk_')) {
      // A secret key pasted into the publishable slot would be rendered into
      // a page. Cheap to check, and the consequence of not checking is total.
      throw new Error(
        'STRIPE_PUBLISHABLE_KEY must be a publishable key (it starts "pk_"). This value is sent ' +
          'to the browser; a secret key here would be published.',
      )
    }
    if (env.STRIPE_SECRET_KEY.startsWith('pk_')) {
      throw new Error('STRIPE_SECRET_KEY looks like a publishable key. The two are swapped.')
    }
  }

  /*
   * A production demo is either locked or explicitly open. Never open by
   * omission.
   *
   * The two things behind this door, while `ARC_DATA_MODE=demo`: the sign-in
   * page's account switcher, which issues an owner, partner or admin session
   * with no credential (ADR-028), and the seeded guest portals, whose tokens
   * are bearer credentials. A stranger with the URL can change a guest's
   * preferences, empty their basket, cancel their bookings, verify a partner
   * or publish an experience.
   *
   * Not enforced outside production, because `npm run dev`, the test suites and
   * the E2E runner all want the door open and none of them is on the internet.
   */
  if (env.NODE_ENV === 'production' && env.ARC_DATA_MODE === 'demo') {
    const locked = (process.env.ARC_DEMO_PASSPHRASE ?? '').length > 0
    if (!locked && !env.ARC_ALLOW_OPEN_DEMO) {
      throw new Error(
        'A production demo must be locked or explicitly open. While ARC_DATA_MODE=demo the ' +
          'sign-in page issues an owner session with no credential and the seeded guest portals ' +
          'are reachable by token, so anyone with the URL can act as the hotel or as a guest. ' +
          'Set ARC_DEMO_PASSPHRASE to lock the front door, or ARC_ALLOW_OPEN_DEMO=1 to say you ' +
          'meant it.',
      )
    }

    /*
     * And the tokens must not be the ones in the repository.
     *
     * Refused even when the demo is deliberately open, because the two are
     * different decisions: "anyone may walk in" is a choice about this
     * deployment, while leaving the fallback secret in place means every reader
     * of the repository can compute a guest's portal token for every
     * deployment that ever did it.
     */
    if (
      !env.ARC_SEED_TOKEN_SECRET ||
      env.ARC_SEED_TOKEN_SECRET === LOCAL_SEED_TOKEN_SECRET ||
      env.ARC_SEED_TOKEN_SECRET.length < 32
    ) {
      throw new Error(
        'ARC_SEED_TOKEN_SECRET must be set to at least 32 random characters in production, and ' +
          'must not be the local fallback. It keys the seeded guests\' portal tokens, which are ' +
          'bearer credentials — without it they are computable by anyone who has read the ' +
          'repository. See src/lib/demo-portals.ts.',
      )
    }
  }

  /*
   * Transactional mail: configured completely, or off.
   *
   * Every one of these messages carries a link that is the credential or the
   * record — an invitation token, a portal token, a reset token. A half-set
   * mail configuration is therefore not "mail is a bit broken", it is a
   * password reset nobody receives and a partner who can never get in.
   */
  if (env.ARC_ENABLE_TRANSACTIONAL_EMAIL) {
    if (!env.ARC_PUBLIC_URL) {
      throw new Error(
        'ARC_ENABLE_TRANSACTIONAL_EMAIL=1 requires ARC_PUBLIC_URL, e.g. ' +
          'https://stay.example.com. Every message carries a link and ARC will not take the ' +
          'origin from a request header: whoever sent the request would then choose where the ' +
          "recipient's invitation or password-reset link pointed.",
      )
    }
    if (env.ARC_PUBLIC_URL.endsWith('/')) {
      throw new Error('ARC_PUBLIC_URL must not end in a slash.')
    }
  }

  if (env.MAIL_PROVIDER === 'resend') {
    if (!env.ARC_ENABLE_TRANSACTIONAL_EMAIL) {
      throw new Error(
        'MAIL_PROVIDER=resend with ARC_ENABLE_TRANSACTIONAL_EMAIL unset would configure a live ' +
          'mail path and then not use it. Set ARC_ENABLE_TRANSACTIONAL_EMAIL=1 to send, or ' +
          'MAIL_PROVIDER=log to record messages without delivering them.',
      )
    }
    if (!env.RESEND_API_KEY) {
      throw new Error('MAIL_PROVIDER=resend requires RESEND_API_KEY.')
    }
    if (!env.ARC_MAIL_FROM) {
      throw new Error(
        'MAIL_PROVIDER=resend requires ARC_MAIL_FROM, on a domain verified with Resend. ' +
          'Mail from an unverified domain is accepted by the API and then not delivered, which ' +
          'is the one failure mode nobody notices.',
      )
    }
  }

  /*
   * An open demo may not send mail.
   *
   * While `ARC_DATA_MODE=demo` and the front door is open, the sign-in page
   * hands a stranger an owner session with no credential (ADR-028). An owner
   * can invite a partner, and an invitation is an email to an address of the
   * sender's choosing, from ARC's verified domain, containing a working link
   * into this deployment. That is an open relay with ARC's reputation on it.
   * Lock the demo, or keep MAIL_PROVIDER=log and let it record what it would
   * have sent.
   */
  if (env.ARC_DATA_MODE === 'demo' && env.MAIL_PROVIDER !== 'log') {
    const locked = (process.env.ARC_DEMO_PASSPHRASE ?? '').length > 0
    if (!locked || env.ARC_ALLOW_OPEN_DEMO) {
      throw new Error(
        'MAIL_PROVIDER must be "log" while ARC_DATA_MODE=demo and the demo is open. The demo ' +
          "sign-in issues an owner session with no credential, and an owner can send an " +
          'invitation to any address — so a live mail provider here is an open relay sending ' +
          "from ARC's domain. Set ARC_DEMO_PASSPHRASE and clear ARC_ALLOW_OPEN_DEMO, or run the " +
          'real deployment at ARC_DATA_MODE=pilot.',
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

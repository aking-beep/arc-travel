import { AppError, type AppErrorCode } from './errors'
import { getEnv } from './env'

/**
 * Error reporting, built on the error taxonomy rather than beside it.
 *
 * The POC logged everything to stdout, which on a hosted deployment means a
 * genuine fault and a guest mistyping a date look identical: both are a line in
 * a log nobody reads. The distinction already exists in the domain — every
 * service throws an `AppError` carrying an HTTP status — so this uses it rather
 * than inventing a second severity scheme.
 *
 *   * **A 4xx `AppError` is not an incident.** `CAPACITY_UNAVAILABLE`,
 *     `HOLD_EXPIRED`, `VALIDATION_FAILED`, `RATE_LIMITED` are the system
 *     working. They are counted, not reported. Paging on them would train
 *     whoever is on call to ignore the channel.
 *   * **Everything else is.** A 5xx `AppError`, and anything that is not an
 *     `AppError` at all, is a bug: `toFormState` deliberately re-throws those
 *     rather than swallowing them into a form message, and this is where they
 *     surface.
 *
 * Implemented with `fetch` against Sentry's envelope endpoint rather than the
 * SDK, for the same reason `StripePaymentsProvider` is: one HTTP POST does not
 * justify a dependency that instruments the runtime. The cost is that there are
 * no traces and no automatic breadcrumbs — see `docs/operations.md`.
 *
 * With `SENTRY_DSN` unset (every local and demo deployment) nothing leaves the
 * box and the report goes to stderr, which keeps development identical to
 * production in everything except where the line ends up.
 */
export type Severity = 'expected' | 'fault'

/** 4xx codes: the system refusing something, correctly. */
const EXPECTED: ReadonlySet<AppErrorCode> = new Set<AppErrorCode>([
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'CONFLICT',
  'CAPACITY_UNAVAILABLE',
  'HOLD_EXPIRED',
  'PRICE_CHANGED',
  'SAFETY_CONSTRAINT',
  'RATE_LIMITED',
  'DEMO_MODE_BLOCKED',
  'PAYMENT_NOT_COMPLETED',
])

/** Every code this build defines. A 5xx one is a fault; anything else expected. */
const KNOWN: ReadonlySet<AppErrorCode> = new Set<AppErrorCode>([
  ...EXPECTED,
  'PAYMENT_UNAVAILABLE',
  'INTERNAL',
])

/**
 * Reads an `AppError`'s code **structurally**, not with `instanceof`.
 *
 * This was found by a test run rather than by reading: every `NOT_FOUND` from
 * the guest portal was being reported as a fault. `instanceof` compares class
 * identity, and `src/instrumentation.ts` is bundled separately from the route
 * chunks, so the `AppError` an action threw is not the `AppError` this module
 * imported — two copies of the same class, and every check between them false.
 *
 * `isAppError` in `lib/errors` keeps using `instanceof` deliberately: inside
 * one bundle it is exact, and it is used for control flow. Here the input has
 * crossed a bundle boundary, so the shape is the only thing that survived.
 */
function appErrorCode(error: unknown): AppErrorCode | null {
  if (error === null || typeof error !== 'object') return null
  if (error instanceof AppError) return error.code

  const candidate = error as { name?: unknown; code?: unknown; status?: unknown }
  if (candidate.name !== 'AppError') return null
  if (typeof candidate.code !== 'string' || typeof candidate.status !== 'number') return null
  // Only a code this build knows. An unrecognised one is a fault, not a
  // silently-expected error, so a renamed code cannot mute reporting.
  return KNOWN.has(candidate.code as AppErrorCode) ? (candidate.code as AppErrorCode) : null
}

export function severityOf(error: unknown): Severity {
  const code = appErrorCode(error)
  if (code) return EXPECTED.has(code) ? 'expected' : 'fault'
  // A ZodError that escaped a service, a Prisma error, a TypeError: all bugs.
  return 'fault'
}

export interface ErrorContext {
  /** Where it happened: a route, a service, a job. Never a guest's data. */
  where: string
  /** Tenant, where it is known. Useful for "is this one hotel or all of them". */
  organizationId?: string | null
  /**
   * Extra fields, redacted by the caller.
   *
   * Prefer field *names* over values, exactly as `recordAudit` does: an error
   * report is a copy of your database in somebody else's SaaS, and the one
   * thing worse than an unreported fault is a guest's email in a third-party
   * issue tracker.
   */
  extra?: Record<string, string | number | boolean | null>
}

/**
 * Reports an error, and says whether it did.
 *
 * Never throws. A monitoring backend that is down must not turn a handled error
 * into an unhandled one, which is how error reporting causes outages.
 */
export async function reportError(
  error: unknown,
  context: ErrorContext,
): Promise<{ severity: Severity; reported: boolean }> {
  const severity = severityOf(error)

  try {
    const code = appErrorCode(error)
    const type = error instanceof Error ? error.name : typeof error
    const message = error instanceof Error ? error.message : String(error)

    if (severity === 'expected') {
      // One line, no stack, no network. Enough to count, not enough to alert.
      console.warn('[expected] %s · %s · %s', context.where, code, message)
      return { severity, reported: false }
    }

    console.error('[fault] %s · %s · %s', context.where, code ?? type, message)
    if (error instanceof Error && error.stack) console.error(error.stack)

    const dsn = getEnv().SENTRY_DSN
    if (!dsn) return { severity, reported: false }

    const sent = await sendToSentry(dsn, { error, context, code, type, message })
    return { severity, reported: sent }
  } catch (reportingFailure) {
    console.error('[observability] failed to report an error:', reportingFailure)
    return { severity, reported: false }
  }
}

/** A DSN is `https://<key>@<host>/<projectId>`. */
export function parseDsn(dsn: string): { url: string; key: string } | null {
  let parsed: URL
  try {
    parsed = new URL(dsn)
  } catch {
    return null
  }
  const projectId = parsed.pathname.replace(/^\//, '')
  if (!parsed.username || !projectId) return null
  return {
    url: `${parsed.protocol}//${parsed.host}/api/${projectId}/envelope/`,
    key: parsed.username,
  }
}

async function sendToSentry(
  dsn: string,
  input: {
    error: unknown
    context: ErrorContext
    code: string | null
    type: string
    message: string
  },
): Promise<boolean> {
  const endpoint = parseDsn(dsn)
  if (!endpoint) {
    console.error('[observability] SENTRY_DSN is not a usable DSN; not reporting.')
    return false
  }

  const eventId = crypto.randomUUID().replace(/-/g, '')
  const sentAt = new Date().toISOString()
  const env = getEnv()

  const event = {
    event_id: eventId,
    timestamp: sentAt,
    platform: 'node',
    level: 'error',
    logger: input.context.where,
    environment: `${env.NODE_ENV}:${env.ARC_DATA_MODE}`,
    exception: {
      values: [
        {
          type: input.code ?? input.type,
          value: input.message,
          stacktrace:
            input.error instanceof Error && input.error.stack
              ? { frames: frames(input.error.stack) }
              : undefined,
        },
      ],
    },
    tags: {
      where: input.context.where,
      ...(input.code ? { app_error_code: input.code } : {}),
      ...(input.context.organizationId
        ? { organization_id: input.context.organizationId }
        : {}),
    },
    extra: input.context.extra ?? {},
  }

  const body = [
    JSON.stringify({ event_id: eventId, sent_at: sentAt }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n')

  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-sentry-envelope',
        'x-sentry-auth': `Sentry sentry_version=7, sentry_client=arc-stay/0.1, sentry_key=${endpoint.key}`,
      },
      body,
      // Short: reporting must never be the slow part of a failing request.
      signal: AbortSignal.timeout(3_000),
    })
    if (!response.ok) {
      console.error('[observability] Sentry rejected the event: %d', response.status)
      return false
    }
    return true
  } catch (failure) {
    const name = failure instanceof Error ? failure.name : ''
    console.error('[observability] could not reach Sentry (%s).', name || 'network error')
    return false
  }
}

/**
 * Parses a V8 stack into Sentry frames, innermost last.
 *
 * Deliberately shallow: ten frames is enough to find the throw and keeps an
 * absolute path from a build machine out of the report.
 */
function frames(stack: string): Array<{ filename: string; function: string; lineno?: number }> {
  return stack
    .split('\n')
    .slice(1, 11)
    .map((line) => {
      const match = /at (?:(.+?) \()?(.+?):(\d+):\d+\)?$/.exec(line.trim())
      const filename = match?.[2]
      if (!filename) return { filename: '<unparsed>', function: line.trim() }
      return {
        filename: filename.replace(/^.*?(?=\/src\/|\/app\/|\/node_modules\/)/, ''),
        function: match[1] ?? '<anonymous>',
        lineno: Number(match[3]),
      }
    })
    .reverse()
}

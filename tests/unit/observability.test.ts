import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'
import {
  AppError,
  capacityUnavailable,
  conflict,
  forbidden,
  invalid,
  notFound,
} from '@/lib/errors'
import { parseDsn, reportError, severityOf } from '@/lib/observability'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('severityOf', () => {
  it('treats the system refusing something correctly as expected', () => {
    // Paging on these would train whoever is on call to ignore the channel.
    for (const error of [
      invalid('check the fields'),
      notFound('Booking'),
      forbidden(),
      conflict('already cancelled'),
      capacityUnavailable('that departure filled up'),
      new AppError('HOLD_EXPIRED', 'your reservation lapsed'),
      new AppError('SAFETY_CONSTRAINT', 'not allowed today'),
      new AppError('RATE_LIMITED', 'slow down'),
      new AppError('DEMO_MODE_BLOCKED', 'not in this build'),
      new AppError('PAYMENT_NOT_COMPLETED', 'your payment has not completed'),
    ]) {
      expect(severityOf(error), String(error)).toBe('expected')
    }
  })

  it('treats a 5xx domain error and anything untyped as a fault', () => {
    for (const error of [
      new AppError('INTERNAL', 'split did not reconcile'),
      new AppError('PAYMENT_UNAVAILABLE', 'could not reach the provider'),
      new TypeError('x is not a function'),
      new ZodError([]),
      'a bare string somebody threw',
      undefined,
    ]) {
      expect(severityOf(error), String(error)).toBe('fault')
    }
  })
})

describe('severityOf across a bundle boundary', () => {
  it('classifies an AppError that lost its class identity', () => {
    /*
     * Found by a test run, not by reading: every NOT_FOUND from the guest
     * portal was being reported as a fault. `src/instrumentation.ts` is
     * bundled separately from the route chunks, so the `AppError` an action
     * threw is not the `AppError` the reporter imported — two copies of one
     * class, and every `instanceof` between them false.
     */
    const crossBundle = Object.assign(new Error('Stay not found.'), {
      name: 'AppError',
      code: 'NOT_FOUND',
      status: 404,
    })
    expect(severityOf(crossBundle)).toBe('expected')
  })

  it('still treats a 5xx code as a fault across that boundary', () => {
    const crossBundle = Object.assign(new Error('nope'), {
      name: 'AppError',
      code: 'INTERNAL',
      status: 500,
    })
    expect(severityOf(crossBundle)).toBe('fault')
  })

  it('does not let an unrecognised code mute reporting', () => {
    // A renamed or invented code must be a fault, not a silently-expected
    // error — otherwise anything can claim to be routine.
    const impostor = Object.assign(new Error('trust me'), {
      name: 'AppError',
      code: 'TOTALLY_FINE',
      status: 200,
    })
    expect(severityOf(impostor)).toBe('fault')
  })

  it('ignores a lookalike with no status, which is not an AppError at all', () => {
    const lookalike = Object.assign(new Error('x'), { name: 'AppError', code: 'NOT_FOUND' })
    expect(severityOf(lookalike)).toBe('fault')
  })
})

describe('parseDsn', () => {
  it('builds the envelope endpoint and extracts the key', () => {
    expect(parseDsn('https://abc123@o4507.ingest.sentry.io/4509')).toEqual({
      url: 'https://o4507.ingest.sentry.io/api/4509/envelope/',
      key: 'abc123',
    })
  })

  it('returns null for anything that is not a usable DSN', () => {
    for (const dsn of [
      '',
      'not a url',
      'https://o4507.ingest.sentry.io/4509', // no key
      'https://abc123@o4507.ingest.sentry.io/', // no project
    ]) {
      expect(parseDsn(dsn), dsn).toBeNull()
    }
  })
})

describe('reportError', () => {
  it('does not send an expected error anywhere', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const result = await reportError(capacityUnavailable('full'), { where: 'test' })

    expect(result).toEqual({ severity: 'expected', reported: false })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
  })

  it('logs a fault even with no DSN configured, and reports nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    // The suite runs with SENTRY_DSN unset, which is every local and demo
    // deployment: development must behave identically except for where the
    // line ends up.
    const result = await reportError(new TypeError('boom'), { where: 'test' })

    expect(result).toEqual({ severity: 'fault', reported: false })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('never throws, whatever it is handed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    // A monitoring backend that is down must not turn a handled error into an
    // unhandled one. Neither must a circular object or a thrown non-Error.
    const circular: Record<string, unknown> = {}
    circular.self = circular

    for (const thrown of [circular, null, Symbol('x'), 42n]) {
      await expect(reportError(thrown, { where: 'test' })).resolves.toMatchObject({
        severity: 'fault',
      })
    }
  })
})

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { isAppError } from '@/lib/errors'
import {
  assertWithinRateLimit,
  consumeRateLimit,
  peekRateLimit,
  rateLimitSubject,
} from '@/lib/rate-limit'
import {
  PORTAL_MISSES_PER_MINUTE,
  guardPortalAttempt,
  recordPortalMiss,
} from '@/modules/guest/portal'
import { resetDatabase } from '../helpers/factory'

/**
 * The durable rate limiter.
 *
 * The limiter it replaces was a `Map` in module scope, so on a serverless
 * runtime the effective ceiling was the configured one times the number of warm
 * instances. These tests exercise the properties that mattered: the counter is
 * shared, concurrent callers cannot both pass the last slot, windows reset, and
 * checking a failure counter does not record a failure.
 */
const WINDOW = 60

beforeEach(resetDatabase)
afterAll(() => prisma.$disconnect())

describe('consumeRateLimit', () => {
  it('allows up to the limit and refuses after it', async () => {
    const bucket = `test:${Date.now()}`
    const verdicts: boolean[] = []
    for (let i = 0; i < 5; i += 1) {
      verdicts.push((await consumeRateLimit({ bucket, limit: 3, windowSeconds: WINDOW })).allowed)
    }
    expect(verdicts).toEqual([true, true, true, false, false])
  })

  it('refuses the extra caller when they arrive together', async () => {
    const bucket = `concurrent:${Date.now()}`
    // The increment is the read, so two callers cannot both see the last slot.
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        consumeRateLimit({ bucket, limit: 4, windowSeconds: WINDOW }),
      ),
    )
    expect(results.filter((r) => r.allowed)).toHaveLength(4)
  })

  it('keeps buckets independent and resets on the next window', async () => {
    const a = `a:${Date.now()}`
    const b = `b:${Date.now()}`
    // Mid-window, so stepping forward lands in the next one rather than on a
    // boundary.
    const now = new Date(Math.floor(Date.now() / 60_000) * 60_000 + 30_000)

    await consumeRateLimit({ bucket: a, limit: 1, windowSeconds: WINDOW, now })
    expect((await consumeRateLimit({ bucket: a, limit: 1, windowSeconds: WINDOW, now })).allowed)
      .toBe(false)
    expect((await consumeRateLimit({ bucket: b, limit: 1, windowSeconds: WINDOW, now })).allowed)
      .toBe(true)

    const next = new Date(now.getTime() + 61_000)
    expect(
      (await consumeRateLimit({ bucket: a, limit: 1, windowSeconds: WINDOW, now: next })).allowed,
    ).toBe(true)
  })

  it('throws a rate-limited AppError from the asserting form', async () => {
    const bucket = `assert:${Date.now()}`
    await assertWithinRateLimit({ bucket, limit: 1, windowSeconds: WINDOW })
    const error = await assertWithinRateLimit({ bucket, limit: 1, windowSeconds: WINDOW }).catch(
      (e: unknown) => e,
    )
    expect(isAppError(error) && error.code).toBe('RATE_LIMITED')
  })
})

describe('peekRateLimit', () => {
  it('reads a counter without incrementing it', async () => {
    const bucket = `peek:${Date.now()}`
    await consumeRateLimit({ bucket, limit: 5, windowSeconds: WINDOW })

    for (let i = 0; i < 3; i += 1) {
      expect((await peekRateLimit({ bucket, limit: 5, windowSeconds: WINDOW })).count).toBe(1)
    }
  })
})

describe('rateLimitSubject', () => {
  it('does not store the value it is given', () => {
    const subject = rateLimitSubject('203.0.113.7')
    expect(subject).not.toContain('203.0.113.7')
    expect(subject).toHaveLength(32)
    expect(rateLimitSubject('203.0.113.7')).toBe(subject)
    expect(rateLimitSubject('203.0.113.8')).not.toBe(subject)
  })
})

describe('guardPortalAttempt', () => {
  it('refuses a caller that has missed too often', async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 200)}`

    // A guest holding a valid QR code never misses; this many is enumeration.
    for (let i = 0; i < PORTAL_MISSES_PER_MINUTE; i += 1) await recordPortalMiss(ip)

    const error = await guardPortalAttempt(ip).catch((e: unknown) => e)
    expect(isAppError(error) && error.code).toBe('RATE_LIMITED')
  })

  it('lets an unkeyable caller through rather than refusing everyone', async () => {
    // A runtime that gives us no address must not take the whole surface down.
    await expect(guardPortalAttempt(null)).resolves.toBeUndefined()
  })

  it('does not count a successful attempt as a miss', async () => {
    const ip = `198.51.100.${200 + Math.floor(Math.random() * 50)}`
    for (let i = 0; i < 20; i += 1) await guardPortalAttempt(ip)

    const misses = await peekRateLimit({
      bucket: `portal-miss:${rateLimitSubject(ip)}`,
      limit: PORTAL_MISSES_PER_MINUTE,
      windowSeconds: WINDOW,
    })
    expect(misses.count).toBe(0)
  })
})

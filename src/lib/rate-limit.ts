import { createHash } from 'node:crypto'
import { prisma } from './db'
import { rateLimited } from './errors'
import type { Prisma } from '@prisma/client'

/**
 * Durable fixed-window rate limiting.
 *
 * The previous limiter was a `Map` in module scope guarding AI calls. It said
 * so itself, honestly — but on a serverless runtime each warm instance keeps
 * its own map, so the effective limit was the configured limit multiplied by
 * however many instances were alive, and nothing else in the product was
 * limited at all.
 *
 * The counter now lives in Postgres, so every instance increments the same row.
 * Fixed windows rather than a sliding log: one row and one upsert per subject
 * per window, which is cheap enough to put in front of a page render, and the
 * worst case of a fixed window — twice the limit across a window boundary — is
 * acceptable for the things being protected here.
 *
 * The increment is the read. `upsert` with `increment` is atomic in Postgres,
 * so two concurrent requests cannot both see "one below the limit"; the second
 * one gets the higher count back and refuses itself.
 */
export interface RateLimitResult {
  allowed: boolean
  /** Requests counted in this window, including this one. */
  count: number
  limit: number
  /** When the current window ends and the count resets. */
  resetAt: Date
}

/**
 * Hashes a subject that must not be stored in the clear — a client IP, a
 * portal token. Keyed with `AUTH_SECRET` so the digests are not reversible by
 * dictionary, and truncated because collision resistance beyond this adds
 * nothing to a counter.
 */
export function rateLimitSubject(value: string): string {
  return createHash('sha256')
    .update(`${process.env.AUTH_SECRET ?? 'arc-rate-limit'}:${value}`)
    .digest('hex')
    .slice(0, 32)
}

const PRUNE_AFTER_WINDOWS = 4

export async function consumeRateLimit(input: {
  /** Namespaced subject. Never a raw IP or token — use `rateLimitSubject`. */
  bucket: string
  limit: number
  windowSeconds: number
  now?: Date
  client?: Prisma.TransactionClient | typeof prisma
}): Promise<RateLimitResult> {
  const client = input.client ?? prisma
  const windowMs = input.windowSeconds * 1_000
  const now = input.now ?? new Date()
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs)
  const resetAt = new Date(windowStart.getTime() + windowMs)

  const row = await client.rateLimitCounter.upsert({
    where: { bucket_windowStart: { bucket: input.bucket, windowStart } },
    create: { bucket: input.bucket, windowStart, count: 1 },
    update: { count: { increment: 1 } },
    select: { count: true },
  })

  // Lazy pruning, on the cheap path only: a window far enough in the past can
  // never be consulted again. Failing to prune must never fail the request the
  // caller actually made, so this is deliberately unawaited-safe.
  if (row.count === 1) {
    const cutoff = new Date(windowStart.getTime() - PRUNE_AFTER_WINDOWS * windowMs)
    try {
      await client.rateLimitCounter.deleteMany({ where: { windowStart: { lt: cutoff } } })
    } catch {
      // A prune failure is not the caller's problem.
    }
  }

  return { allowed: row.count <= input.limit, count: row.count, limit: input.limit, resetAt }
}

/**
 * Reads a counter without incrementing it.
 *
 * For a bucket that counts *failures*: checking whether a caller is already
 * over their failure ceiling must not itself be recorded as a failure.
 */
export async function peekRateLimit(input: {
  bucket: string
  limit: number
  windowSeconds: number
  now?: Date
  client?: Prisma.TransactionClient | typeof prisma
}): Promise<RateLimitResult> {
  const client = input.client ?? prisma
  const windowMs = input.windowSeconds * 1_000
  const now = input.now ?? new Date()
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs)

  const row = await client.rateLimitCounter.findUnique({
    where: { bucket_windowStart: { bucket: input.bucket, windowStart } },
    select: { count: true },
  })
  const count = row?.count ?? 0

  return {
    allowed: count < input.limit,
    count,
    limit: input.limit,
    resetAt: new Date(windowStart.getTime() + windowMs),
  }
}

/** Throws `rateLimited` rather than returning a verdict. */
export async function assertWithinRateLimit(input: {
  bucket: string
  limit: number
  windowSeconds: number
  message?: string
  now?: Date
  client?: Prisma.TransactionClient | typeof prisma
}): Promise<RateLimitResult> {
  const result = await consumeRateLimit(input)
  if (!result.allowed) {
    throw rateLimited(input.message ?? 'Too many requests. Try again shortly.')
  }
  return result
}

/** Test and local helper. Clears every counter, or one bucket prefix. */
export async function resetRateLimitCounters(bucketPrefix?: string): Promise<void> {
  await prisma.rateLimitCounter.deleteMany(
    bucketPrefix ? { where: { bucket: { startsWith: bucketPrefix } } } : undefined,
  )
}

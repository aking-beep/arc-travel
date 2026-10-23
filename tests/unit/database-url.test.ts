import { describe, expect, it } from 'vitest'
import { applyDatabaseUrl, resolveDatabaseUrl } from '@/lib/database-url'

/**
 * `DATABASE_URL` stays the contract everywhere. These cover the one exception:
 * a managed Postgres attached through a hosting provider's storage integration,
 * which writes the connection string under a prefixed name of its own.
 */
const DIRECT = 'postgresql://direct/db'
const NEON = 'postgresql://neon/db'
const NEON_POOLED = 'postgresql://neon-pooler/db'

describe('resolveDatabaseUrl', () => {
  it('prefers an explicit DATABASE_URL over anything prefixed', () => {
    expect(
      resolveDatabaseUrl({ DATABASE_URL: DIRECT, ARCSTAY_DATABASE_URL: NEON }),
    ).toBe(DIRECT)
  })

  it('takes a prefixed connection string when DATABASE_URL is absent', () => {
    expect(resolveDatabaseUrl({ ARCSTAY_DATABASE_URL: NEON })).toBe(NEON)
  })

  it('prefers the unpooled URL, because the hosted build runs schema DDL', () => {
    expect(
      resolveDatabaseUrl({
        ARCSTAY_DATABASE_URL: NEON_POOLED,
        ARCSTAY_DATABASE_URL_UNPOOLED: NEON,
      }),
    ).toBe(NEON)
  })

  it('ignores the unprefixed POSTGRES_* names a previous store left behind', () => {
    // These are written by more than one integration, so a project that has had
    // two stores attached has leftovers from the one it no longer uses.
    // Connecting to that silently is worse than refusing to start.
    expect(
      resolveDatabaseUrl({
        POSTGRES_URL: 'postgresql://stale/db',
        POSTGRES_PRISMA_URL: 'postgresql://stale/db',
        POSTGRES_URL_NON_POOLING: 'postgresql://stale/db',
      }),
    ).toBeUndefined()
  })

  it('treats an empty value as absent', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: '', ARCSTAY_DATABASE_URL: NEON })).toBe(NEON)
  })

  it('returns undefined when nothing supplies a connection string', () => {
    expect(resolveDatabaseUrl({})).toBeUndefined()
  })

  it('refuses to choose between two attached stores', () => {
    expect(() =>
      resolveDatabaseUrl({ A_DATABASE_URL: NEON, B_DATABASE_URL: 'postgresql://other/db' }),
    ).toThrow(/Set DATABASE_URL explicitly/)
  })
})

describe('applyDatabaseUrl', () => {
  it('writes the resolved value back, because Prisma reads process.env itself', () => {
    const env = { ARCSTAY_DATABASE_URL_UNPOOLED: NEON }
    applyDatabaseUrl(env)
    expect(env).toHaveProperty('DATABASE_URL', NEON)
  })

  it('leaves an existing DATABASE_URL alone', () => {
    const env = { DATABASE_URL: DIRECT, ARCSTAY_DATABASE_URL: NEON }
    applyDatabaseUrl(env)
    expect(env.DATABASE_URL).toBe(DIRECT)
  })

  it('is a no-op when there is nothing to resolve', () => {
    const env: Record<string, string | undefined> = {}
    applyDatabaseUrl(env)
    expect(env.DATABASE_URL).toBeUndefined()
  })
})

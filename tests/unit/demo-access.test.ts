import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEMO_PORTAL_COUNT, demoPortalToken, LOCAL_SEED_TOKEN_SECRET, seededPortalToken } from '@/lib/demo-portals'
import { getEnv, resetEnvCache } from '@/lib/env'

/**
 * The demo's front door.
 *
 * Item 11 of the launch-readiness list: "anyone can currently open the demo
 * guest portals and change things." Two separate causes — the tokens were in
 * the repository, and the lock was opt-in — so two separate sets of tests.
 */
describe('seeded portal tokens', () => {
  const SECRET_A = 'a'.repeat(40)
  const SECRET_B = 'b'.repeat(40)

  it('is deterministic for a given secret', () => {
    expect(demoPortalToken(1, SECRET_A)).toBe(demoPortalToken(1, SECRET_A))
  })

  it('differs per stay', () => {
    const tokens = new Set(
      Array.from({ length: DEMO_PORTAL_COUNT }, (_, i) => demoPortalToken(i + 1, SECRET_A)),
    )
    expect(tokens.size).toBe(DEMO_PORTAL_COUNT)
  })

  it('differs per secret — which is the whole point', () => {
    expect(demoPortalToken(1, SECRET_A)).not.toBe(demoPortalToken(1, SECRET_B))
  })

  it('is not the literal it used to be', () => {
    // `demo-portal-01` was readable in prisma/seed.ts and is a bearer
    // credential. If this ever passes again, a deployment's guest portals are
    // open to anyone who can read the repository.
    for (let i = 1; i <= DEMO_PORTAL_COUNT; i += 1) {
      expect(demoPortalToken(i, SECRET_A)).not.toMatch(/^demo-portal-/)
    }
  })

  it('looks like an opaque handle, not a hash', () => {
    const token = demoPortalToken(1, SECRET_A)
    expect(token).toHaveLength(32)
    expect(token).toMatch(/^[a-z2-7]{32}$/)
  })

  it('refuses an index outside the seeded set', () => {
    expect(() => demoPortalToken(0, SECRET_A)).toThrow(/1\.\.6/)
    expect(() => demoPortalToken(DEMO_PORTAL_COUNT + 1, SECRET_A)).toThrow(/1\.\.6/)
    expect(() => demoPortalToken(1.5, SECRET_A)).toThrow(/1\.\.6/)
  })

  it('separates the demo stays from the rest of the fixture set', () => {
    expect(seededPortalToken('history-0', SECRET_A)).not.toBe(demoPortalToken(1, SECRET_A))
  })
})

function setNodeEnv(value: string): void {
  ;(process.env as Record<string, string | undefined>).NODE_ENV = value
}

describe('a production demo must be locked or explicitly open', () => {
  const saved = { ...process.env }

  beforeEach(() => {
    resetEnvCache()
    // `process.env.NODE_ENV` is typed read-only, and the point of these tests
    // is what happens in production, so it is written through the index.
    setNodeEnv('production')
    process.env.ARC_DATA_MODE = 'demo'
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/arc?schema=public'
    process.env.AUTH_SECRET = 'x'.repeat(40)
    process.env.ANALYTICS_SALT = 'y'.repeat(40)
    process.env.ARC_SEED_TOKEN_SECRET = 'z'.repeat(40)
    delete process.env.ARC_DEMO_PASSPHRASE
    delete process.env.ARC_ALLOW_OPEN_DEMO
  })

  afterEach(() => {
    process.env = { ...saved }
    resetEnvCache()
  })

  it('refuses to start with neither a passphrase nor the explicit flag', () => {
    expect(() => getEnv()).toThrow(/locked or explicitly open/)
  })

  it('starts when the front door is locked', () => {
    process.env.ARC_DEMO_PASSPHRASE = 'coral reef morning'
    expect(() => getEnv()).not.toThrow()
  })

  it('starts when someone says they meant it', () => {
    process.env.ARC_ALLOW_OPEN_DEMO = '1'
    expect(() => getEnv()).not.toThrow()
  })

  it('refuses the local token secret even when deliberately open', () => {
    // Deliberately open is a decision about one deployment. Shipping the
    // fallback secret is a decision about every reader of the repository.
    process.env.ARC_ALLOW_OPEN_DEMO = '1'
    process.env.ARC_SEED_TOKEN_SECRET = LOCAL_SEED_TOKEN_SECRET
    expect(() => getEnv()).toThrow(/ARC_SEED_TOKEN_SECRET/)
  })

  it('refuses a missing token secret', () => {
    process.env.ARC_DEMO_PASSPHRASE = 'coral reef morning'
    delete process.env.ARC_SEED_TOKEN_SECRET
    expect(() => getEnv()).toThrow(/ARC_SEED_TOKEN_SECRET/)
  })

  it('refuses a token secret too short to be random', () => {
    process.env.ARC_DEMO_PASSPHRASE = 'coral reef morning'
    process.env.ARC_SEED_TOKEN_SECRET = 'short'
    expect(() => getEnv()).toThrow(/at least 32/)
  })

  it('leaves development alone, since none of it is on the internet', () => {
    setNodeEnv('development')
    delete process.env.ARC_SEED_TOKEN_SECRET
    expect(() => getEnv()).not.toThrow()
  })

  it('does not apply outside demo mode, where there is no credential-free switcher', () => {
    process.env.ARC_DATA_MODE = 'pilot'
    process.env.TRAVEL_ADVICE_PROVIDER = 'fixture'
    delete process.env.ARC_SEED_TOKEN_SECRET
    expect(() => getEnv()).not.toThrow()
  })
})

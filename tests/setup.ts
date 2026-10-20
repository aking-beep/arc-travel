import 'dotenv/config'
import { beforeAll } from 'vitest'

/**
 * Points every test at the integration database before any module can
 * construct a PrismaClient. `src/lib/db.ts` reads DATABASE_URL at import time,
 * and setup files are evaluated before the test module's imports, so this is
 * the last safe moment to redirect it.
 */
const testUrl = process.env.TEST_DATABASE_URL
if (testUrl) {
  process.env.DATABASE_URL = testUrl
}

// A deterministic secret keeps pseudonymised analytics keys stable across runs.
process.env.AUTH_SECRET = 'arc-stay-test-secret-deterministic-0000000000'
process.env.ARC_DATA_MODE = 'demo'
process.env.AI_PROVIDER = 'mock'
// NODE_ENV is set to 'test' by Vitest itself and is read-only in Next's types.

beforeAll(() => {
  if (!process.env.DATABASE_URL?.includes('test')) {
    throw new Error(
      `Refusing to run tests against "${process.env.DATABASE_URL}" — it does not look like a test database.`,
    )
  }
})

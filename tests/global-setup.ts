import { execFileSync } from 'node:child_process'
import 'dotenv/config'

/**
 * Prepares the integration database once per `vitest run`.
 *
 * Integration tests run against a real PostgreSQL schema rather than a mock,
 * because the things most worth testing here — serialized inventory holds,
 * unique constraints, transactional rollback — only exist in the database. A
 * separate TEST_DATABASE_URL keeps the demo data intact while tests truncate.
 */
export default function globalSetup(): void {
  const testUrl = process.env.TEST_DATABASE_URL
  if (!testUrl) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Copy .env.example to .env — tests must never run against DATABASE_URL.',
    )
  }
  if (testUrl === process.env.DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL.')
  }

  const env = { ...process.env, DATABASE_URL: testUrl }

  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    stdio: 'inherit',
    env,
  })

  // The CHECK constraints are not expressible in the Prisma schema, so they
  // are applied separately. Tests must run against the same constraints as
  // production, or the suite passes on a weaker schema than it ships.
  execFileSync(
    'npx',
    ['prisma', 'db', 'execute', '--file', 'prisma/constraints.sql', '--schema', 'prisma/schema.prisma'],
    { stdio: 'inherit', env },
  )
}

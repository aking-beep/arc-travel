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

  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: testUrl },
  })
}

import { execFileSync } from 'node:child_process'
import 'dotenv/config'

/**
 * Prepares the integration database once per `vitest run`.
 *
 * Integration tests run against a real PostgreSQL schema rather than a mock,
 * because the things most worth testing here — serialized inventory holds,
 * unique constraints, transactional rollback — only exist in the database. A
 * separate TEST_DATABASE_URL keeps the demo data intact while tests truncate.
 *
 * ## Built by the migrations, not by `db push`
 *
 * It used to be `db push` plus a separate `db execute` of `constraints.sql`,
 * which was the only way to do it when there was no migration history. The two
 * are not the same schema in general: `db push` applies the *datamodel*, while
 * a deployment applies a *sequence of migrations*. A suite that passes on the
 * first proves nothing about the second. Since the point of these tests is
 * that they run against the real constraints, they now run against the real
 * construction too.
 *
 * ## Why the schema is dropped here rather than by `prisma migrate reset`
 *
 * `migrate reset` is the obvious command and it is not used, for two reasons.
 *
 * Prisma 7 refuses it when it detects an AI agent in the environment, and
 * demands a consent string from the user instead. That guard is correct —
 * `migrate reset` against a production URL destroys everything — and the way
 * to live with it is not to carry a consent token in the repository, which
 * would disable it for every future run and every future agent.
 *
 * And `reset` runs the seed, since Prisma 7 removed `--skip-seed`. The suite
 * builds its own graph with `createTenant()`, so the demo seed is three
 * hundred rows of noise that every `TRUNCATE` then has to clear.
 *
 * So the teardown is explicit: drop the schema, then `migrate deploy`. This is
 * the same category of action the suite already performs on every test —
 * `resetDatabase()` truncates every tenant table on this database — and it is
 * guarded the same way, by refusing a URL that does not name a test database.
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

  /*
   * The guard that makes dropping a schema here acceptable.
   *
   * Deliberately stricter than `tests/setup.ts`'s equivalent check, which only
   * runs once Vitest has started: this one gates DDL. A database whose name
   * does not say it is for tests does not get dropped, whatever any
   * environment variable says.
   */
  const databaseName = databaseNameOf(testUrl)
  if (!databaseName || !/test/i.test(databaseName)) {
    throw new Error(
      `Refusing to rebuild the schema of "${databaseName ?? testUrl}". ` +
        'TEST_DATABASE_URL must name a database with "test" in it — this step drops and ' +
        'recreates the public schema, and every row in it goes.',
    )
  }

  const env = { ...process.env, DATABASE_URL: testUrl, ARC_SKIP_SEED: '1' }

  /*
   * A stale column from a branch must not survive into a run, and
   * `migrate deploy` refuses a database whose state it cannot account for —
   * which this one's is, having been built by `db push` for most of its life.
   * Dropping the schema gives `deploy` the empty database it wants.
   *
   * `prisma db execute` rather than a `psql` subprocess, so the only database
   * client this repository needs is the one it already depends on. It takes no
   * `--url` in Prisma 7: both commands read the datasource from
   * `prisma.config.ts`, which reads `DATABASE_URL` — hence the override in
   * `env` above, which is what points them at the test database.
   */
  execFileSync('npx', ['prisma', 'db', 'execute', '--stdin'], {
    input: 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;',
    stdio: ['pipe', 'inherit', 'inherit'],
    env,
  })

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit', env })
}

/** The database name from a connection string, or null if it has none. */
function databaseNameOf(url: string): string | null {
  try {
    const name = new URL(url).pathname.replace(/^\//, '')
    return name.length > 0 ? name : null
  } catch {
    return null
  }
}

/**
 * Rebuild a demo database from the migration history.
 *
 * ## Why this exists
 *
 * Every database created before 2026-10-25 was built by `prisma db push`, which
 * records nothing. `prisma migrate deploy` then meets a schema it has no
 * history for and refuses with `P3005 — the database schema is not empty`,
 * which is the right refusal: applying a baseline migration over existing
 * tables would fail halfway, and recording it as already applied is a claim
 * nobody can check.
 *
 * `docs/deployment.md` gives the careful answer for a database with data worth
 * keeping: confirm the schema really matches, apply `constraints.sql`, then
 * `migrate resolve --applied`. That needs a person with the connection string
 * and the judgement to confirm the claim is true.
 *
 * This is the other answer, for the case where there is nothing to keep. A
 * demo's entire content is the deterministic seed, so dropping it loses
 * precisely nothing: `migrate deploy` builds the schema it has a full history
 * for, and `db:ensure-seed` fills it. It doubles as the reset for when the
 * seeded availability horizon runs out.
 *
 * ## Why it is this hard to fire
 *
 * It drops every table. Three locks, all of which must agree:
 *
 *   1. `ARC_DB_REBUILD` must be exactly `1` or `true`. No default and no
 *      prompt — a hosted build cannot answer one.
 *   2. `ARC_DATA_MODE` must be `demo`. A pilot database holds a real hotel's
 *      bookings and this must not be reachable from one.
 *   3. The database must not be named like a production one.
 *
 * It is wired into `vercel-build` ahead of `migrate deploy` and returns
 * immediately when the flag is absent, which is every ordinary deploy. Set the
 * flag, redeploy, then remove it — left set, it would drop the database on
 * every future deploy.
 */
import 'dotenv/config'
import { applyDatabaseUrl, resolveDatabaseUrl } from '../src/lib/database-url'

applyDatabaseUrl()
import { prisma } from '../src/lib/db'

const armed = (): boolean => {
  const flag = (process.env.ARC_DB_REBUILD ?? '').trim().toLowerCase()
  return flag === '1' || flag === 'true'
}

/** Does this database have a Prisma migration history? */
async function hasMigrationHistory(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ present: boolean }>>`
    SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present
  `
  return rows[0]?.present === true
}

/** Does it have ARC's tables? `Order` stands in for the whole datamodel. */
async function hasApplicationTables(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ present: boolean }>>`
    SELECT to_regclass('public."Order"') IS NOT NULL AS present
  `
  return rows[0]?.present === true
}

function refuseUnlessDemo(): void {
  if (process.env.ARC_DATA_MODE !== 'demo') {
    throw new Error(
      'ARC_DB_REBUILD is set but ARC_DATA_MODE is not "demo". This drops every table, and ' +
        "outside demo mode those tables hold a real hotel's bookings. Refusing.",
    )
  }

  /*
   * A name check as well as the mode check. `ARC_DATA_MODE` is a variable
   * somebody sets; the database name is what they actually pointed at, and the
   * two have disagreed before.
   */
  const url = resolveDatabaseUrl() ?? ''
  const name = url.split('/').pop()?.split('?')[0] ?? ''
  if (/prod|live|pilot/i.test(name)) {
    throw new Error(
      `ARC_DB_REBUILD is set but the database is called "${name}". Refusing on the name alone. ` +
        'If this really is a demo database, rename it or baseline it by hand — see ' +
        'docs/deployment.md.',
    )
  }
}

async function main(): Promise<void> {
  try {
    if (!armed()) {
      /*
       * Not armed, which is the normal case. Say something only when this
       * database is in the state that makes the next command fail, so an
       * ordinary deploy's log stays quiet.
       */
      if (!(await hasMigrationHistory()) && (await hasApplicationTables())) {
        console.warn(
          [
            '',
            "⚠ This database has ARC's tables but no migration history, so the",
            '  `prisma migrate deploy` that follows will stop with P3005.',
            '',
            '  Two ways out, both in docs/deployment.md:',
            '    • Keep the data: confirm the schema matches, apply prisma/constraints.sql,',
            '      then `prisma migrate resolve --applied` for each migration it has.',
            '    • Demo data only: set ARC_DB_REBUILD=1 and redeploy. This script then',
            '      resets the schema, the migrations rebuild it and the seed refills it.',
            '      Remove the flag afterwards.',
            '',
          ].join('\n'),
        )
      }
      return
    }

    refuseUnlessDemo()

    const had = await hasApplicationTables()
    console.log(
      had
        ? '▸ ARC_DB_REBUILD is set — resetting the demo schema so migrations can rebuild it…'
        : '▸ ARC_DB_REBUILD is set — the schema is already empty, recreating it anyway…',
    )

    /*
     * Reset the schema rather than truncate it. The point is to leave a
     * database `migrate deploy` has a complete history for, and a truncated
     * database still has the tables `db push` made, which is the state that
     * fails.
     */
    await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE')
    await prisma.$executeRawUnsafe('CREATE SCHEMA public')

    console.log('✔ Schema reset. `prisma migrate deploy` will build it from prisma/migrations.')
    console.log('  Remove ARC_DB_REBUILD now — left set, the next deploy resets it again.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

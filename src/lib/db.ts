import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

import { applyDatabaseUrl, resolveDatabaseUrl } from './database-url'

applyDatabaseUrl()

/**
 * The Prisma client.
 *
 * ## Why there is a driver adapter here now
 *
 * Prisma 7 removed `url` from the `datasource` block: the client takes a driver
 * adapter and the CLI takes its URL from `prisma.config.ts`. That is a chore,
 * and it has one real benefit worth stating — the connection string is resolved
 * in exactly one place (`./database-url`) by exactly one function, rather than
 * by a Rust engine reading `process.env` on its own. The prefixed-variable
 * problem that cost this project a week of red deployments was a disagreement
 * between where ARC looked for the URL and where Prisma did.
 *
 * `PrismaPg` is `node-postgres` underneath, which is a **session**-mode pool.
 * That is required, not incidental: `inSerializableTransaction` uses
 * interactive transactions, which hold one session across several statements,
 * and a transaction-mode pooler hands a different backend to each statement.
 * See the pooling note in `docs/deployment.md`.
 *
 * ## Why `server-only` is not imported here
 *
 * It throws outside an RSC graph, which would break the seed, the standalone
 * `prisma/*.ts` scripts and every integration test. The import lives in
 * `modules/auth/service.ts` instead, which is the module a client bundle would
 * actually have to reach through; the tests alias it to a stub. See
 * `CLAUDE.md`, "things that look wrong but are not".
 */
const globalForPrisma = globalThis as unknown as { arcPrisma?: PrismaClient }

function createClient(): PrismaClient {
  const connectionString = resolveDatabaseUrl()
  if (!connectionString) {
    /*
     * A clear failure here beats the adapter's.
     *
     * Without a URL, `node-postgres` falls back to libpq's defaults and tries
     * to connect to a local socket as the current OS user — which produces
     * "role 'root' does not exist" rather than "nobody configured a database".
     * That exact confusion is what `database-url.ts` exists to prevent.
     */
    throw new Error(
      'No database connection string. Set DATABASE_URL, or attach a managed Postgres whose ' +
        'integration writes a prefixed *_DATABASE_URL — see src/lib/database-url.ts.',
    )
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })
}

/**
 * One client per process. Next.js hot-reloads modules in development, so the
 * instance is parked on `globalThis` to avoid exhausting the pool.
 */
export const prisma: PrismaClient = globalForPrisma.arcPrisma ?? createClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.arcPrisma = prisma
}

export type { Prisma } from '@prisma/client'

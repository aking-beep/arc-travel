import 'dotenv/config'
import path from 'node:path'
import { defineConfig } from 'prisma/config'
import { applyDatabaseUrl } from './src/lib/database-url'

// The CLI resolves `env("DATABASE_URL")` out of `process.env`, so a hosting
// provider's prefixed connection string has to be written back before any
// command runs. See `src/lib/database-url.ts`.
applyDatabaseUrl()

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  /*
   * Where Migrate gets its connection from, as of Prisma 7.
   *
   * `applyDatabaseUrl()` above has already written the bare name back onto
   * `process.env` from whatever prefixed form a hosting provider's storage
   * integration produced, so this reads one variable rather than guessing
   * among several.
   */
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
  migrations: {
    /*
     * `prisma migrate reset` runs this, and Prisma 7 removed the
     * `--skip-seed` flag that used to say otherwise.
     *
     * The integration suite resets the database once per run and builds its
     * own graph with `createTenant()`, so the demo seed there is three hundred
     * rows of noise that every `TRUNCATE` then has to clear — and about ten
     * seconds on every `vitest run`. `tests/global-setup.ts` sets this.
     */
    seed: process.env.ARC_SKIP_SEED === '1' ? undefined : 'tsx prisma/seed.ts',
  },
})

/**
 * Resolve `DATABASE_URL` from a hosting provider's prefixed equivalent.
 *
 * Every environment this repository runs in — a developer machine, CI, the
 * integration suite — sets `DATABASE_URL`, and that stays the contract. The
 * exception is a managed Postgres attached through a Vercel storage
 * integration: the integration writes the connection string under a name of
 * its own choosing, and when the person attaching it fills in the optional
 * "environment variable prefix" field, every name it writes carries that
 * prefix. `ARCSTAY_DATABASE_URL` is not a name Prisma reads, so the build died
 * at `prisma db push` with `P1012 — Environment variable not found:
 * DATABASE_URL` before Next.js was ever reached, and the prefix cannot be
 * changed after the store is attached.
 *
 * So: if `DATABASE_URL` is absent, take the prefixed one.
 *
 * Two deliberate narrownesses.
 *
 * Only `*_DATABASE_URL_UNPOOLED` and `*_DATABASE_URL` are considered, never
 * `POSTGRES_URL`, `POSTGRES_PRISMA_URL` or their relatives. Those names are
 * unprefixed and are written by *several* integrations, so a project that has
 * had two Postgres stores attached over its life has leftovers from the one it
 * no longer uses — accepting them means quietly connecting to the wrong
 * database, which is worse than failing to start.
 *
 * An unpooled URL is preferred because the first thing the hosted build does is
 * `prisma db push`, and a connection pooler in transaction mode cannot run the
 * schema DDL that needs.
 *
 * If more than one candidate is present this throws rather than picking one.
 * Two attached stores is a configuration the person has to resolve; guessing
 * between two databases is not a decision this code gets to make.
 */

/**
 * The shape this reads, rather than `NodeJS.ProcessEnv`: that type requires
 * `NODE_ENV`, which nothing here cares about and which would force every test
 * to supply it. `process.env` is assignable to this.
 */
type EnvLike = Record<string, string | undefined>

/** Suffixes to look for, most specific first. */
const SUFFIXES = ['_DATABASE_URL_UNPOOLED', '_DATABASE_URL'] as const

function candidates(env: EnvLike, suffix: string): string[] {
  return Object.keys(env)
    .filter((key) => key.endsWith(suffix) && (env[key] ?? '').length > 0)
    .sort()
}

/**
 * The connection string this process should use, or `undefined` if nothing in
 * the environment supplies one. Pure: reads `env`, writes nothing.
 */
export function resolveDatabaseUrl(env: EnvLike = process.env): string | undefined {
  const direct = env.DATABASE_URL
  if (direct && direct.length > 0) return direct

  for (const suffix of SUFFIXES) {
    const keys = candidates(env, suffix)
    if (keys.length === 1) return env[keys[0]!]
    if (keys.length > 1) {
      throw new Error(
        `DATABASE_URL is not set, and ${keys.length} candidates were found ` +
          `(${keys.join(', ')}). Set DATABASE_URL explicitly to say which ` +
          `database this deployment should use.`,
      )
    }
  }

  return undefined
}

/**
 * Put the resolved value on `process.env.DATABASE_URL` so that the Prisma CLI,
 * the generated client and `src/lib/env.ts` all read the same thing.
 *
 * Prisma resolves `env("DATABASE_URL")` out of `process.env` itself, inside
 * both the CLI and the generated client, so a resolved value has to be written
 * back rather than passed. Idempotent, and a no-op when `DATABASE_URL` is
 * already set.
 */
export function applyDatabaseUrl(env: EnvLike = process.env): void {
  if (env.DATABASE_URL && env.DATABASE_URL.length > 0) return
  const resolved = resolveDatabaseUrl(env)
  if (resolved) env.DATABASE_URL = resolved
}

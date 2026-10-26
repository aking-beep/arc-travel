import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The migration history, checked for the two ways it silently stops being
 * trustworthy.
 *
 * A migration history is only worth having if what it produces is what the
 * schema says and what a restore re-applies. Neither of those is checked by
 * anything that runs on a deployment: `migrate deploy` applies the files it
 * finds and reports success, whatever they contain.
 */
const MIGRATIONS = path.join(process.cwd(), 'prisma', 'migrations')
const CONSTRAINTS = path.join(process.cwd(), 'prisma', 'constraints.sql')

const directories = (): string[] =>
  readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()


/** Every `*_constraints` migration's SQL, in application order. */
const constraintMigrations = (): string[] =>
  directories()
    .filter((name) => name.endsWith('_constraints'))
    .map((name) => readFileSync(path.join(MIGRATIONS, name, 'migration.sql'), 'utf8'))

/**
 * A constraints migration without its explanatory header.
 *
 * Each one opens with a `-- ---` banner saying why it exists separately, which
 * is deliberately not part of the shared `constraints.sql`.
 */
const bodyOf = (sql: string): string => {
  const end = sql.lastIndexOf('-- ---------------------------------------------------------------------------')
  return end === -1 ? sql : sql.slice(end + 1).replace(/^[^\n]*\n/, '')
}

/** The DDL statements in a file, ignoring comments and blank lines. */
const statements = (sql: string): string[] =>
  sql
    .split('\n')
    .filter((line) =>
      /^\s*(ALTER TABLE|CREATE (OR REPLACE )?(FUNCTION|TRIGGER|CONSTRAINT TRIGGER)|DROP TRIGGER)/i.test(
        line,
      ),
    )
    .map((line) => line.trim())

describe('the migration history', () => {
  it('has a migration for every directory, and nothing else', () => {
    const names = directories()
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      const sql = readFileSync(path.join(MIGRATIONS, name, 'migration.sql'), 'utf8')
      expect(sql.trim().length).toBeGreaterThan(0)
      // Prisma orders by directory name, so a name that does not sort
      // chronologically applies in the wrong order on a fresh database.
      expect(name).toMatch(/^\d{14}_[a-z0-9_]+$/)
    }
  })

  it('keeps constraints.sql and its migrations in step', () => {
    /*
     * The same SQL exists twice on purpose: in the migration history, so a
     * database built by `migrate deploy` ends up with the constraints, and on
     * its own, because a `pg_restore` of a schema-only dump does not carry
     * them and `docs/operations.md` re-runs the file by hand.
     *
     * Two copies drift. This is the test that stops it. The standalone file
     * must equal the concatenation of every `*_constraints` migration, in
     * order — which is also what makes "add a NEW constraints migration, never
     * edit an applied one" an enforceable rule rather than a note in a header.
     */
    const constraints = readFileSync(CONSTRAINTS, 'utf8')
    const migrations = constraintMigrations()
    expect(migrations.length).toBeGreaterThan(0)

    for (const sql of migrations) {
      /*
       * Each migration's own body must appear verbatim in the file. Checked per
       * migration rather than by concatenating, because each carries a header
       * explaining itself and those are not part of the shared SQL.
       */
      expect(constraints).toContain(bodyOf(sql))
    }
  })

  it('does not apply a constraint the standalone file has forgotten', () => {
    // The direction the `toContain` above cannot catch: SQL added to a
    // migration and not to `constraints.sql` would be lost on every restore.
    const constraints = readFileSync(CONSTRAINTS, 'utf8')
    const fromMigrations = constraintMigrations().flatMap((sql) => statements(sql))

    expect(fromMigrations).toEqual(statements(constraints))
  })

  it('adds new constraints in a new migration rather than editing an applied one', () => {
    /*
     * Not a style rule. `migrate deploy` records each migration and never
     * re-runs it, so a constraint appended to an already-applied file exists on
     * a fresh database and is missing from every deployment that is already
     * running — the worst of both, since the schema and the repository agree
     * and the live database disagrees with both.
     *
     * Checked by the shape of the history: more than one constraints migration
     * means the convention is live, and each must be non-empty.
     */
    const names = directories().filter((name) => name.endsWith('_constraints'))
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      expect(bodyOf(readFileSync(path.join(MIGRATIONS, name, 'migration.sql'), 'utf8')).trim())
        .not.toBe('')
    }
  })
})

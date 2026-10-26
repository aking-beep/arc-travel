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

  it('keeps constraints.sql and its migration byte-identical', () => {
    /*
     * The same SQL exists twice on purpose: in the migration history, so a
     * database built by `migrate deploy` ends up with the constraints, and on
     * its own, because a `pg_restore` of a schema-only dump does not carry
     * them and `docs/operations.md` re-runs the file by hand.
     *
     * Two copies drift. This is the test that stops it, and it is the reason
     * the migration is the file verbatim under a header rather than a tidied
     * version of it.
     */
    const constraints = readFileSync(CONSTRAINTS, 'utf8')
    const migration = readFileSync(
      path.join(MIGRATIONS, '20261025000001_constraints', 'migration.sql'),
      'utf8',
    )

    expect(migration).toContain(constraints)
  })

  it('does not apply a constraint the standalone file has forgotten', () => {
    // The direction the `toContain` above cannot catch: SQL added to the
    // migration and not to `constraints.sql` would be lost on every restore.
    const constraints = readFileSync(CONSTRAINTS, 'utf8')
    const migration = readFileSync(
      path.join(MIGRATIONS, '20261025000001_constraints', 'migration.sql'),
      'utf8',
    )

    const statements = (sql: string) =>
      sql
        .split('\n')
        .filter((line) => /^\s*(ALTER TABLE|CREATE (OR REPLACE )?(FUNCTION|TRIGGER|CONSTRAINT TRIGGER)|DROP TRIGGER)/i.test(line))
        .map((line) => line.trim())

    expect(statements(migration)).toEqual(statements(constraints))
  })
})

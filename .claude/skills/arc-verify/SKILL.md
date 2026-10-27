---
name: arc-verify
description: Run ARC Stay's verification gate before a commit — typecheck, lint, unit and integration tests against real Postgres, and the build — and read each failure. Use before committing anything, and when `npm run verify` fails and the failure is not obvious.
---

# Verifying an ARC Stay change

`CLAUDE.md`: **run `npm run verify` before any commit.** It is
`typecheck → lint → test → build`, in that order, and it stops at the first
failure.

```bash
npm run verify
```

## The database the tests need

`npm test` is unit *and* integration, and the integration suite talks to real
Postgres because that is the only place a serialization failure, a unique
constraint or a rollback behaves like the thing it is guarding.

- `TEST_DATABASE_URL` must point at a **separate** database from `DATABASE_URL`.
  `.env.example` has both. The test one is reset on each run.
- `npm run test:unit` needs no database. Reach for it while iterating on pure
  logic — money, pricing, commission, the conditions gate, itinerary
  feasibility — and run the full `verify` before the commit anyway.
- `PrismaPg` is session-mode `node-postgres`. A transaction-mode pooler breaks
  `inSerializableTransaction`, and the symptom is not a clear error: it is
  concurrency tests passing while the product oversells.

## Never, while verifying

- **Do not consent to Prisma's destructive-action guard.** Prisma 7 refuses
  `migrate reset` when it detects an agent and asks for
  `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`. Setting it disarms the guard
  for every later run and every later agent, so it is a person's decision.
  `tests/global-setup.ts` does its own guarded teardown; the suite does not need
  a reset. `.claude/hooks/deny-dangerous.mjs` refuses the command.
- **Do not reach for `db:reset`, `db push` or `db:rebuild`** to make a test pass.
  A schema the tests disagree with is a migration to write, not a database to
  flatten.
- **Do not skip, disable or quarantine a test** to get to green. If a test is
  wrong, say which assertion is wrong and why.

## Reading each stage

### typecheck

`_EsIsComplete` failing means an EN translation key was added without its ES
twin. Add both; that is the whole point of the type (`CLAUDE.md § UI`).

### lint

The custom rule about a client component reading the clock is not a style
nag — it has already caught one real instance. The fix is to compute the value
on the server and pass it as a prop, never to silence the rule.

### test

- A unit failure in `tests/unit/migrations.test.ts` means
  `prisma/constraints.sql` and the migration that carries it have drifted
  (ADR-034). The file is the one people edit; the migration is how a database
  gets it. Update both.
- An integration failure that only happens sometimes is usually a
  serialization failure escaping the retry loop. `isSerializationFailure`
  matches four error shapes on purpose — under the `PrismaPg` adapter the
  failure arrives as a `DriverAdapterError` with the SQLSTATE in its cause and
  no `P2034` at all.
- A failure that mentions a fixture's stay status is a test depending on a
  default. Use `createTenant()` from `tests/helpers/factory.ts` with the
  options the rule needs.

### build

A build failure after the tests pass is nearly always a Server Component
reaching for something client-only, or the reverse.

## E2E, when the change touches a surface

```bash
npm run test:e2e     # reseeds the demo database first
```

Two habits the specs record, learned the hard way:

- After a server action calls `revalidatePath`, the route remounts and
  `useActionState` resets. **Assert on durable state** — a decision list, a
  count — not on a form message that will be gone.
- The locale action redirects to the same path, so `waitForURL` resolves before
  the cookie lands. Use `switchLocale`, which waits on `html[lang]`.

The accessibility spec runs **last** on purpose (ADR-038): one violation only
existed once a guest had generated an itinerary, and a clean-seed audit missed
it. Do not reorder it for speed.

## When it is green

Say so plainly, with the counts. `npm run verify` green and the E2E suite green
are two different claims; do not report one as the other.

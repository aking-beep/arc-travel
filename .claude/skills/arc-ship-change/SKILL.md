---
name: arc-ship-change
description: The full lifecycle of a code change in ARC Stay — which ADRs to read for the paths you are touching, where the code belongs, migration rules, EN/ES parity, which reviewers to run, and the commit and PR. Use at the start of any change to this repository.
---

# Shipping a change to ARC Stay

Work in this order. Most of the expensive mistakes in this repository's history
were a step skipped, not a thing done badly.

## 1. Read what the change is arguing with

`CLAUDE.md` holds eight non-negotiables and a long "things that look wrong but
are not" table. That table is the cheapest file in the project: each row is a
bug somebody already had.

| Touching | Read first |
| --- | --- |
| Anything crossing a module boundary | `docs/architecture.md` |
| Something that looks odd | the matching `CLAUDE.md` row, then that ADR in `docs/decisions.md` |
| `src/modules/inventory/**`, holds, capacity | ADR-014, ADR-019, ADR-020, and `CLAUDE.md § Transactions` |
| Money, commission, payouts | ADR-007, ADR-030, ADR-042, and the `arc-money` skill |
| `src/modules/destination/conditions.ts` | ADR-017, ADR-018, ADR-019, `docs/culture-context.md` |
| `src/modules/ai/**` | non-negotiable 5, ADR-004, ADR-006 |
| Auth, tenancy, the guest portal | ADR-035, ADR-039, ADR-041, `CLAUDE.md § Authorisation` |
| Email or messaging | ADR-040 |
| `prisma/**` | `docs/data-model.md`, ADR-020, ADR-034, ADR-036 |
| A partner surface | ADR-041 |
| A direct consumer booking | ADR-042 |

If the change needs a non-negotiable relaxed, that is a conversation with
Andrew, not a refactor. Say which one and why.

## 2. Put the code where it belongs

```
src/app      → translate HTTP and forms. No business rules.
src/modules  → the domain. No React, no HTTP, no next/* imports.
src/lib      → cross-cutting primitives.
```

- A server action turns `FormData` into a plain object, calls **one** service,
  and turns the thrown error into a `FormState` via `toFormState`.
- Zod schemas live in a module's `schemas.ts` and are parsed by the **service**,
  not the action. A service is the thing that may be trusted to have validated
  its input.
- Throw from `@/lib/errors` — `invalid`, `notFound`, `forbidden`, `conflict`,
  `capacityUnavailable`, `safetyConstraint`. Each carries an HTTP status so no
  handler has to guess. `toFormState` re-throws anything that is neither a
  `ZodError` nor an `AppError`, so a genuine bug surfaces instead of becoming a
  form message.
- Domain modules import Prisma enums and types from `@/lib/prisma-types`.
- Every tenant-scoped operation starts in `src/modules/tenancy/context.ts`. A
  partner-surface read goes through `assertSupplierAccess`, a write through
  `assertActingAsSupplier` (ADR-041). A guest-surface service starts from
  `resolvePortalContext(token)` and scopes its lookup by who is asking — the
  ownership predicate belongs in the `where` clause, not in a check afterwards.
- Anything touching `booked` or `held` goes through `inSerializableTransaction`,
  and **reads inside the transaction what it will write on**. See the
  `arc-inventory` skill; two real bugs came from getting this wrong.

## 3. Migrations, if `prisma/` changed

- A new CHECK constraint goes in a **new** `*_constraints` migration. Never
  append to an applied one: `migrate deploy` never re-runs a recorded
  migration, so an edit lands on fresh databases and misses every running
  deployment (ADR-036).
- `prisma/constraints.sql` is the file people edit and read; the migration is
  how a database gets it. `tests/unit/migrations.test.ts` fails if the two
  drift (ADR-034). Update both.
- A constraint whose rejected rows are history ARC deliberately keeps is added
  `NOT VALID` (ADR-036, ADR-041). A later migration cannot fix this, because
  `migrate deploy` stops at the first failure.
- Never `db push` and never `db:reset`. Write the migration.

## 4. UI, if a surface changed

- Server Components by default. `'use client'` only for `useActionState` or
  genuine interactivity, and a client component must not read the clock or any
  other impure source during render — pass a server-computed default as a prop.
- Every list and panel gets loading, empty **and** error states. A blank panel
  cannot tell an owner "no arrivals today" from "this is broken".
- Every money figure goes through `<Money>` with its `intent`
  (`earned` | `potential` | `neutral`). The demo marker is separate:
  `DemoBanner` per surface, `DemoFigure` around a *headline* figure, nothing
  around a figure inside a table.
- Add the EN and ES keys **together** in `src/lib/i18n/dictionary.ts` or
  `_EsIsComplete` fails typecheck. Spanish carries the same safety disclaimers
  as English, not a subset.

## 5. Tests

| Kind | Where | For |
| --- | --- | --- |
| Unit | `tests/unit` | pure functions: money, pricing, commission, the conditions gate, itinerary feasibility |
| Integration | `tests/integration` | anything needing real Postgres: concurrency, constraints, rollback, tenant isolation |
| E2E | `tests/e2e` | acceptance criteria as journeys |

Use `createTenant()` from `tests/helpers/factory.ts` rather than the demo seed.
For each new test, be able to name the mutation it would catch — a test
asserting a function returns something is not a test.

## 6. Verify

Use the `arc-verify` skill. `npm run verify` green before any commit.

## 7. Review

`CLAUDE.md` asks for an **independent review before merging a change that
touches inventory, money, the conditions gate or tenancy.** Route the diff:

| Path touched | Reviewer |
| --- | --- |
| `prisma/**`, or any new query | `data-reviewer` |
| `src/modules/inventory/**`, anything in a transaction, `src/modules/commerce/**` | `architecture-reviewer` **and** `data-reviewer` |
| `src/modules/auth/**`, `src/modules/tenancy/**`, `src/app/api/**`, server actions, logging | `security-reviewer` |
| `src/modules/ai/**`, `src/modules/destination/conditions.ts` | `ai-safety-reviewer` |
| Any page or component | `ux-reviewer` |
| Any change in behaviour | `qa-reviewer` |

The `release-captain` agent applies this table for you.

## 8. Commit and open the PR

- Develop on the branch this session was given. Never push to another branch
  without asking.
- `git push -u origin <branch>`. On a network failure, retry with backoff;
  on a rejection, read why.
- The PR body starts with the project attribution block the session was given,
  and follows the repository's template if there is one.
- Ask Andrew before pushing or opening a PR. Do not merge — no agent in this
  repository has that tool.

## 9. If you overturned something odd

Write the ADR **and** the matching `CLAUDE.md` "looks wrong but is not" row in
the same change, so the two cannot drift. Use the `arc-adr` skill.

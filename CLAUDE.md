# CLAUDE.md — working in this codebase

ARC Stay: AI-powered destination commerce for independent boutique hotels.
Proof of concept for Puerto Escondido, Oaxaca.

Read [`docs/architecture.md`](docs/architecture.md) before a change that crosses
a module boundary, and [`docs/decisions.md`](docs/decisions.md) before
overturning something that looks odd — several things that look odd are load-
bearing.

## Commands

```bash
npm run setup       # generate client, apply migrations, seed
npm run dev
npm run verify      # typecheck → lint → test → build. Run before any commit.
npm test            # unit + integration (needs TEST_DATABASE_URL)
npm run test:unit   # unit only, no database
npm run test:e2e    # Playwright; reseeds the demo database first
npm run db:seed     # reseed (truncates; deterministic and idempotent)
```

## Non-negotiables

These are product commitments, not style preferences. If a change needs one of
them relaxed, that is a conversation, not a refactor.

1. **Never claim something is safe.** `modules/destination/conditions` returns
   `allowed`, never `safe`, and a test asserts the gate emits no safety claim.
   Report conditions with their timestamp and source; gate what may be
   recommended. Do not add a `safe` field, a "safe today" badge, or copy that
   implies either.
2. **Never invent availability, verification or a commercial relationship.**
   `/admin` is the only route to a `VERIFIED` status. Fixture partners stay
   `UNVERIFIED`. A partner's `claimedCertifications` are claims and must be
   rendered as claims.
3. **Money is integer minor units.** No floats, no `Decimal`. Pesos become
   centavos exactly once, at the form edge, via `pesosToMinor`.
4. **Earned revenue and potential value are never summed** and never adjacent.
   See ADR-007.
5. **The AI explains; it never decides.** No tools, no write path. It may
   rephrase reasons the deterministic engine produced; it may not add a
   candidate, remove an exclusion or change a score.
6. **No autonomous action.** A consequential action requires an `Approval` row
   naming the user who decided. `send_guest_message` throws while
   `ARC_ENABLE_OUTBOUND_MESSAGING` is false.
7. **Demo mode is a guarantee.** While `ARC_DATA_MODE=demo`, a live payment
   provider is a startup error.
8. **An advisory is never rendered as law.** A `LAW` culture rule needs a
   primary-law or regulator source *and* an admin verification; a government
   advisory stays `ADVISORY` and is labelled as one. A source change is a review
   item, not a publication. See `docs/culture-context.md` and ADR-024.

## Conventions

### Layering

```
src/app      → translate HTTP and forms. No business rules.
src/modules  → the domain. No React, no HTTP, no next/* imports.
src/lib      → cross-cutting primitives.
```

A server action turns `FormData` into a plain object, calls one service, and
turns the thrown error into a `FormState` via `toFormState`. If you find
yourself validating or computing money in `src/app`, it belongs in a module.

Domain modules import Prisma enums and types from `@/lib/prisma-types`, not from
`@prisma/client` directly.

### Authorisation

Every tenant-scoped operation starts with a call into
`src/modules/tenancy/context.ts`. Never trust a client-supplied
`organizationId`; never infer ownership from a URL. On the guest surface, start
with `resolvePortalContext(token)` — no guest-surface action accepts a guest id
from the client.

### Validation

Zod schemas live in a module's `schemas.ts` and are parsed by the service, not
by the action. A service is the thing that may be trusted to have validated its
input.

### Errors

Throw from `@/lib/errors` (`invalid`, `notFound`, `forbidden`, `conflict`,
`capacityUnavailable`, …). Each carries an HTTP status, so handlers never guess.
`toFormState` re-throws anything that is neither a `ZodError` nor an `AppError`,
so genuine bugs surface as errors rather than being swallowed into a form
message.

### Transactions

Anything touching `booked` or `held` goes through
`inSerializableTransaction`. Anything that must be all-or-nothing — approval and
its execution, checkout and its ledger — shares one transaction. Pass `tx` to
`recordAudit` so an action and its audit record cannot diverge.

**Read inside the transaction what you will write on.** `inSerializableTransaction`
retries on a serialization failure by re-running the whole function, so a body
whose guard was read outside it applies twice. Two real bugs came from this: a
concurrent cancellation double-decremented `booked` and wrote a second refund,
and checkout committed a stale line quantity while consuming the live hold
quantity. Re-read and re-assert inside.

### Authorisation on the guest surface

Every guest-surface service takes *who is asking* and scopes its lookup by it.
`cancelOrderItem` takes a `CancelAuthority`, not an optional `actorKind`: it
loaded the order item by id alone, so any holder of any portal token could
cancel any other guest's booking. If a new service accepts a client-supplied
entity id, the ownership predicate belongs in the `where` clause, not in a check
you have to remember afterwards.

### Audit and analytics

Consequential writes call `recordAudit`. Metadata is PII-redacted on the way in
— prefer field *names* over values when the values are guest data. Analytics
subjects are pseudonymised; an email or phone number must never reach
`AnalyticsEvent`.

### Dates and times

Calendar days are `YYYY-MM-DD` strings (`DateKey`) and `@db.Date` columns.
Combine a day and a wall-clock time with `localInstant`. Do not construct a
`Date` from a date string without going through `src/lib/dates`.

### UI

- Server Components by default. Reach for `'use client'` only for
  `useActionState` or genuine interactivity.
- **A client component must not read the clock or any other impure source
  during render.** Pass server-computed defaults as props. The linter enforces
  this and it has already caught one real instance.
- Every list and panel renders a loading, empty and error state. A blank panel
  cannot tell an owner "no arrivals today" from "this is broken".
- Every money figure goes through `<Money>` with its `intent`
  (`earned` | `potential` | `neutral`). `<Money>` formats from minor units; it
  does **not** carry the demo marker. The marker is three things: `DemoBanner`
  on every surface, `DemoFigure` around every *headline* figure, and nothing
  around a figure inside a table — thirty badges down a column stop being read.
- Add both EN and ES keys together — `_EsIsComplete` fails typecheck otherwise.

### Testing

| Kind | Put it in | For |
| --- | --- | --- |
| Unit | `tests/unit` | Pure functions: money, pricing, commission, the conditions gate, itinerary feasibility |
| Integration | `tests/integration` | Anything that needs real Postgres: concurrency, constraints, rollback, tenant isolation |
| E2E | `tests/e2e` | Acceptance criteria as journeys |

Use `createTenant()` from `tests/helpers/factory.ts` rather than the demo seed:
it builds the smallest graph that exercises a rule, so a failure points at one
thing. Two organizations exist in the tenancy suite specifically so isolation is
proven rather than assumed.

Two E2E habits, learned the hard way and recorded in the specs:

- After a server action calls `revalidatePath`, the route remounts and
  `useActionState` resets. **Assert on durable state** — the decision list, a
  count — not on a transient form message.
- The locale action redirects to the same path, so `waitForURL` resolves before
  the cookie lands. Use `switchLocale`, which waits on `html[lang]`.

## Things that look wrong but are not

| Looks like | Actually |
| --- | --- |
| `server-only` absent from `src/lib/db.ts` | It throws outside an RSC graph, which would break the seed and every integration test. The import lives in `modules/auth/service.ts`; tests alias it to a stub |
| `splitByBps` gives the remainder to the supplier | Deliberate. The ledger must balance, and the centavo belongs with whoever did the work |
| The itinerary generator is greedy, not optimal | An optimal solver gives a slightly denser plan and a much worse explanation. ADR-004 territory |
| Travel times are a seeded table | ADR-011. Reproducible, and more honest than a routing engine for this town |
| `draft_experience_from_amenity` executes nothing | It refuses to invent a partner, price or safety envelope. That is the feature |
| Holds are taken at add-to-basket | ADR-014 |
| No destination photography | Unlicensed images of a real place in a commercial demo is not a corner worth cutting |
| The seed writes earnings entries for refunded orders too | It mirrors checkout-then-refund exactly. Writing only the refund left the ledger short by the order total — a real bug, now regression-tested |
| `conditionsSensitive` is on `Activity`, not derived from `PlaceKind` | ADR-018. Inferring it from the place let one wrong dropdown choice switch the safety gate off for the heaviest wave in Mexico |
| The gate derives a demanded ability when there is no reading | ADR-017. Guarding the ability rules on a snapshot meant a guest who stated no level was offered an advanced-only break on any undated day |
| `addToCart` re-runs the safety gate | ADR-019. The itinerary was not the only route to a booking, so gating only the recommendation left the commitment open |
| CHECK constraints live in `prisma/constraints.sql`, not the schema | ADR-020. Prisma cannot express them, and application-only invariants fail silently |
| `prisma/constraints.sql` is duplicated inside a migration | ADR-034. The file stays the one people edit and read; the migration is how a database gets it. `tests/unit/migrations.test.ts` fails if the two drift |
| `returnCapacity` throws instead of clamping | ADR-020. The clamp kept the counter non-negative while hiding the double-cancellation that caused it |
| `invitePartner` refuses an email that already has an account | ADR-021. It used to `upsert`, rewriting a stranger's profile and grafting a membership onto it |
| `/sign-in` 404s outside demo mode and lists no guests | **Superseded by ADR-028.** The page now works in every mode and lists accounts only in demo mode, because real passwords exist |
| `/experiences` shows two catalogues rather than one list | ADR-027. "Illustrative" and "unverified" are different claims, and the two sets are in different currencies |
| A live listing has no photograph at all | ADR-027. ADR-025 scoped imagery to the content set; a stock photo on a real supplier's listing is what that scoped away |
| `checkout()` takes a payment it did not confirm | ADR-026. Confirming and then booking has a window that can only be closed with an automatic refund, which needs an `Approval` row |
| The operating-window gate is its own module with four callers | ADR-029. The hours check existed three times and disagreed with itself |
| An organization has a platform commission default as well as a hotel one | ADR-030. The platform share fell back to zero, so ARC earned nothing unless somebody wrote a rule |
| `Guest.userId` is not unique, so a `User` may have several `Guest` rows | ADR-039. A `Guest` is a person *at one property*; the account is the person. The UNIQUE constraint meant the second hotel somebody stayed at could never appear in their account |
| `/me` hands the guest their own `portalToken` in a link | ADR-039. It is the one surface that may: the session proves they are the person the token belongs to. The link is withheld once the portal's grace window has passed |
| Claiming a booking needs the reference *and* the email, and refuses with one message | ADR-039. A matching address alone would let a hotel's typo hand a stranger a guest's itinerary, and a specific refusal would answer "is this a real booking, and whose?" |
| The seeded portal tokens are an HMAC, not literals, and `playwright.config.ts` mints a secret per run | ADR-035. A portal token is a bearer credential and `demo-portal-01` was readable in the repo. Deterministic fixtures and unguessable tokens are not in conflict |
| `LOCAL_SEED_TOKEN_SECRET` lives in `src/lib/env.ts`, not in `demo-portals.ts` where it is used | ADR-035. `demo-portals` needs `node:crypto`; `env` is reached from middleware, which runs on the edge runtime where that module does not exist |
| A VERIFIED partner can read as `lapsed`, and the guest surfaces ask `isCurrentlyVerified` rather than the column | ADR-036. `insuranceOnFile` was a boolean and liability insurance expires. The stored decision was right when it was made; it is not current now |
| The two ADR-036 Supplier constraints are added `NOT VALID` | ADR-036 amendment. Validating them checks existing rows, and the rows they reject are the pre-ADR verified ones the ADR deliberately keeps. New writes carry their evidence; history keeps its own. A later migration cannot fix this: `migrate deploy` stops at the first failure, so the declaration has to be `NOT VALID` where it is added |
| A guest-facing verification badge never reads `supplier.verification` | ADR-036. The column is a historical decision; `isCurrentlyVerified` is the live answer. Spread `VERIFICATION_STANDING_SELECT` so the query loads what the question needs |
| New CHECK constraints go in a NEW `*_constraints` migration, never appended to an applied one | ADR-036. `migrate deploy` never re-runs a recorded migration, so an edit lands on fresh databases and misses every running deployment |
| `/api/cron/check-invariants` returns 200 when it finds a violation | ADR-037. The check ran and worked; the database is what is unhealthy. A 500 would re-alert every few minutes and hide a real monitoring failure |
| `/api/health` exists as well as `/admin/health` and tells an anonymous caller almost nothing | ADR-037. The admin page cannot be polled, and an unauthenticated endpoint is reconnaissance for whoever finds it |
| The `--color-sand-*` lightness values look arbitrary | ADR-038. Each is set by measured contrast against the worst light surface it sits on. Changing one is a contrast decision; re-run the accessibility spec |
| The accessibility spec runs last in the E2E suite | ADR-038. One violation only existed once a guest had generated an itinerary. A clean-seed audit missed it |

## Review

`.claude/agents/` holds focused reviewers: architecture, UX, data, AI safety,
security and QA. Use an independent review before merging a change that touches
inventory, money, the conditions gate or tenancy.

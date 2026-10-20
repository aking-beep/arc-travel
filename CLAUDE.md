# CLAUDE.md — working in this codebase

ARC Stay: AI-powered destination commerce for independent boutique hotels.
Proof of concept for Puerto Escondido, Oaxaca.

Read [`docs/architecture.md`](docs/architecture.md) before a change that crosses
a module boundary, and [`docs/decisions.md`](docs/decisions.md) before
overturning something that looks odd — several things that look odd are load-
bearing.

## Commands

```bash
npm run setup       # generate client, push schema, seed
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
- Any money figure in a demo build renders with its marker. Use `<Money>` and
  its `intent` prop (`earned` | `potential` | `neutral`).
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
| `returnCapacity` throws instead of clamping | ADR-020. The clamp kept the counter non-negative while hiding the double-cancellation that caused it |
| `invitePartner` refuses an email that already has an account | ADR-021. It used to `upsert`, rewriting a stranger's profile and grafting a membership onto it |
| `/sign-in` 404s outside demo mode and lists no guests | ADR-023. The page was public and rendered every guest's portal token into the markup |

## Review

`.claude/agents/` holds focused reviewers: architecture, UX, data, AI safety,
security and QA. Use an independent review before merging a change that touches
inventory, money, the conditions gate or tenancy.

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
   `ARC_ENABLE_OUTBOUND_MESSAGING` is false — that switch is about ARC
   *initiating* contact, and it stays off. Transactional mail (the invitation an
   owner just sent, the confirmation of a booking just paid for, a password
   reset just asked for) is a separate switch, `ARC_ENABLE_TRANSACTIONAL_EMAIL`,
   with its own boundary: one recipient, taken from the record the action
   touched, and never a body an agent composed. See ADR-040.
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
`src/modules/tenancy/context.ts`. On the partner surface, a *read* goes through
`assertSupplierAccess` and a *write* through `assertActingAsSupplier`, which
also requires the `SUPPLIER` membership for that supplier — see ADR-041. Never trust a client-supplied
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
| A guest-facing verification badge never reads `supplier.verification` | ADR-036. The column is a historical decision; `isCurrentlyVerified` is the live answer. Spread `VERIFICATION_STANDING_SELECT` so the query loads what the question needs. This includes the *public* storefront — `discovery/live.ts` read the column and was the one place a stranger could have seen a lapsed badge |
| The seeded demo property is `UNVERIFIED`, like the six seeded partners | ADR-036 amendment. It was `VERIFIED`, and that column is what the public card's badge reads, so the home page printed "Verified by ARC" for a verification nobody performed. A property has no checklist to derive a standing from: the column *is* the decision, which is why a seed must not write it |
| New CHECK constraints go in a NEW `*_constraints` migration, never appended to an applied one | ADR-036. `migrate deploy` never re-runs a recorded migration, so an edit lands on fresh databases and misses every running deployment |
| `/api/cron/check-invariants` returns 200 when it finds a violation | ADR-037. The check ran and worked; the database is what is unhealthy. A 500 would re-alert every few minutes and hide a real monitoring failure |
| `/api/health` exists as well as `/admin/health` and tells an anonymous caller almost nothing | ADR-037. The admin page cannot be polled, and an unauthenticated endpoint is reconnaissance for whoever finds it |
| The `--color-sand-*` lightness values look arbitrary | ADR-038. Each is set by measured contrast against the worst light surface it sits on. Changing one is a contrast decision; re-run the accessibility spec |
| `isSerializationFailure` matches four error shapes rather than one | Prisma raises `P2034` only when Prisma itself detects the failure. Under the `PrismaPg` adapter the same failure is a `DriverAdapterError` carrying the SQLSTATE in its cause and no code at all, so matching `P2034` alone stopped the inventory retry loop and turned a race into a 500 |
| The accessibility spec runs last in the E2E suite | ADR-038. One violation only existed once a guest had generated an itinerary. A clean-seed audit missed it |
| Transactional email has its own switch, and `MESSAGING_PROVIDER` still refuses `resend` | ADR-040. Two different permissions. One is ARC initiating contact with a guest; the other is the reply to something a named person just did, which the product cannot work without |
| `MAIL_PROVIDER=log` records a complete message, link included, rather than sending | ADR-040. A hotel has to read the real words before any of them reach a guest. `LOGGED` is deliberately not `SENT` |
| A message is written inside the caller's transaction and sent after it commits | ADR-040. A `fetch` inside a Serializable block holds it open, and `inSerializableTransaction` re-runs its body on a retry — which is how one cancellation sends two emails |
| A password reset answers identically for an address with no account | ADR-040. The accounts are a named list of boutique hotels; "is this hotel on ARC" is not information a public form should confirm |
| Completing a password reset does not sign you in | ADR-040. A link in a mailbox is weaker proof than a password, and a session would make a readable inbox equivalent to a credential |
| A guest's portal link is emailed only when an owner presses a button | ADR-040. The token is a bearer credential (ADR-035); mailing it automatically would send one to whatever address a front desk mistyped |
| `Supplier` carries `claimedInsurer` *and* `insuranceOnFile` | ADR-041. The first is what the partner says; the second is ARC having seen a certificate. A partner may write the claim and never the check, and `supplier_insurance_on_file_is_checked` refuses the shortcut |
| A partner's experience form has no status field and no supplier field | ADR-041. A partner drafts and the hotel publishes, and the supplier is whoever is signed in. A field that named either would eventually be set to the wrong one |
| `updateOwnExperience` refuses while PUBLISHED but `setOwnPrice` does not | ADR-041. A basket holds the duration and meeting point a guest agreed to; it also holds the price it captured, and a new price is a new row for the next guest |
| `assertActingAsSupplier` is stricter than `assertSupplierAccess` | ADR-041. An owner may *read* their partner's view. An owner writing a business's own description in that business's name is the problem the ADR starts from |
| `acceptJoinRequest` reaches `invitePartner` through a dynamic import | ADR-041. That path already has ADR-021's refusal, the one transaction and the ADR-040 email. A second implementation would drift, and the refusal would drift first |
| Declining a join request emails nobody | ADR-041. ARC writing to a business in the hotel's name, in wording the hotel never saw, is not ARC's to send. The note is the owner's own record |
| A duplicate join request gets the same answer as the first | ADR-041. "You already asked" would let an unauthenticated form answer "is this address already working with this hotel" |
| `supplier_insurance_on_file_is_checked` is added `NOT VALID` | ADR-041, for the ADR-036 reason: the rows it rejects are the pre-ADR verified ones that ADR deliberately keeps, and `migrate deploy` stops at the first failure |
| The seed's fixture partners have no insurance on file, so every demo listing warns about it | ADR-041. They carried `insuranceOnFile: true` while unverified with no recorded check — the exact shortcut ADR-036 exists about. The warning is true, and it was true before |
| `/sign-up/partner` takes no password and creates no account | ADR-041. It writes one `SupplierJoinRequest` and nothing else. The hotel accepting is what creates the supplier, the agreement and the login |
| A direct customer's trip is a `Stay` | ADR-042. The guest surface reasons about days — the planner, the gate, travel times, dated departures — so a stay-less order meant a second code path through all of it, and the gate would have diverged first |
| `Stay.kind` exists and four surfaces filter on it | ADR-042. A direct trip must never read as a room booking: not in arrivals, not in the briefing, not in occupancy, and not in the per-stay revenue figure |
| A direct trip has no check-in control and no room type | ADR-042, and `direct_stay_has_no_room` enforces the second one in the database. "Checked in" is about a room |
| The revenue headline excludes direct bookings from the numerator as well as the denominator | ADR-042. Otherwise a good month of direct business reads as the hotel's own guests spending more — ADR-007's instinct applied to a new pair of numbers |
| A direct booking still pays the hotel its commission | ADR-042. The listing, the price and the agreement are the hotel's, and the storefront is what the person chose. A different share is a commission rule, not a code change |
| `/sign-up/direct` hands over to `establishAccount` rather than creating a user | ADR-042. That path already takes over a front desk's placeholder, refuses an address somebody holds, and handles both races |

## Review

`.claude/agents/` holds focused reviewers: architecture, UX, data, AI safety,
security and QA. Use an independent review before merging a change that touches
inventory, money, the conditions gate or tenancy. `release-captain` runs the
gate and picks the reviewers a diff needs — `.claude/README.md` has the
path-to-reviewer table.

## The agent harness

`.claude/README.md` is the short version. In outline:

- `.claude/skills/` — the procedures that get repeated. `arc-ship-change` is
  the one to read at the start of a change; `arc-verify` before a commit;
  `arc-money`, `arc-inventory`, `arc-adr`, `arc-ops-triage` and
  `arc-demo-reset` for their subjects; `arc-harness-feedback` at the end of
  one.
- `.claude/agents/` — the six reviewers, plus `release-captain` and three
  read-only operators (`ops-triage`, `conditions-steward`,
  `verification-diary`).
- `.claude/hooks/deny-dangerous.mjs` — the non-negotiables that cannot be taken
  back, as a refused tool call rather than prose somebody might not read:
  Prisma's destructive-action consent, a schema reset or push, SQL that writes a
  supplier's verification or a `ConditionReport`, outbound messaging, a live
  Stripe key. A refusal names the document the rule comes from.
- `.claude/harness-log.md` — why each check exists, and the miss that prompted
  it. Nothing in `.claude/` edits itself: an agent that notices a gap proposes
  the amendment and a person approves it.

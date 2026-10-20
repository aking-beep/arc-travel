# Architecture

## Shape

One modular monolith, one deployable web application.

```
┌─────────────────────────────────────────────────────────────┐
│  src/app  — Next.js App Router                              │
│  Server Components, server actions, two API routes.         │
│  Translates HTTP and forms. Contains no business rules.     │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  src/modules  — the domain. No React, no HTTP.              │
│                                                             │
│  tenancy ◄──── every other module calls this first          │
│                                                             │
│  auth  hotels  catalog  suppliers  guest  preferences       │
│  destination  itinerary  inventory  commerce                │
│  operator  workflows  analytics  admin  ai                  │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  src/lib  — cross-cutting primitives                        │
│  money  dates  errors  env  i18n  redact  ids  db           │
└───────────────────────────┬─────────────────────────────────┘
                            │
                    PostgreSQL via Prisma
```

A monolith rather than services because the POC's hard problems are
transactional — inventory under concurrency, a checkout that must be atomic
across holds, order and ledger — and distributing those would add failure modes
without removing any. The module boundaries are real, so extraction later is a
refactor rather than a rewrite.

### The rule that keeps it honest

`src/app` may not contain a business rule. A server action's job is to turn a
`FormData` into a plain object, call one service, and turn the thrown error into
a `FormState`. Pesos become centavos exactly once, at that edge
(`pesosToMinor`). Everything else — validation, authorisation, pricing,
feasibility — lives in a module and is unit-testable without a browser.

## Authorisation: one chokepoint

`src/modules/tenancy/context.ts` is the only place that decides whether a caller
may touch something. Every tenant-scoped read and write calls one of:

- `assertOrganizationAccess(actor, organizationId, ...roles)`
- `assertPropertyAccess(actor, propertyId, ...roles)`
- `assertSupplierAccess(actor, supplierId)`
- `assertGuestAccess(actor, guestId)`
- `assertPlatformAdmin(actor)`

Each takes the caller's context and the *requested* id, and verifies the
relationship in the database. A client-supplied `organizationId` is never
trusted, and ownership is never inferred from a URL. `assertPropertyAccess` does
two checks, not one: the property must belong to an organization the actor is a
member of, **and** a property-pinned membership (front-desk staff) must match
this property specifically.

The guest surface is the exception that proves the rule. A guest reaches the
portal from a QR code, so the stay's `portalToken` *is* the credential. That
makes `resolvePortalContext` the entire guest authorisation boundary: the token
is opaque, scoped to exactly one stay, and stops working when the stay is
cancelled. No guest-surface action accepts a guest id from the client.

## The safety argument, as code

The order of operations in the itinerary pipeline is the product's safety
position:

```
load facts
  → gate every candidate on conditions   (modules/destination/conditions)
  → score what survives                  (modules/itinerary/scoring)
  → assemble a plan deterministically    (modules/itinerary/generator)
  → persist
  → optionally, ask a model to introduce it
```

**The gate runs before scoring and before any model.** It has four independent
disqualifiers, any one of which is fatal:

1. The day's risk exceeds the highest risk the activity may run in at all.
2. The day demands more ability than the guest has.
3. The activity demands more ability than the guest has.
4. The activity is conditions-sensitive and has no place, so it cannot be judged.

Whether an activity is conditions-sensitive is stored on the `Activity`, not
inferred from the kind of place it happens at (ADR-018). And the gate is not
only consulted by the itinerary: `modules/destination/suitability` evaluates a
single departure, `addToCart` refuses on it, and the experience page renders
from it — because gating the recommendation while leaving the booking open is
the wrong way round (ADR-019).

It returns `allowed`, never `safe`. There is no function in that module that
returns a safety judgement, and a test asserts the gate never emits one. Three
further properties matter:

- **Absence of a reading is not permission.** With no `ConditionReport` it falls
  back to the place's baseline character and says so in the guest-facing notes,
  deriving the ability the day demands from that baseline so the ability rules
  still run (ADR-017). With neither reading nor baseline it assumes `HIGH`.
- **An unknown ability is never treated as expert.** On a day demanding more
  than improver level, a guest who declined to state their level gets the
  candidate withheld rather than guessed at.
- **Freshness travels with the reading.** `observedAt`, `ageHours` and
  `isStale` are part of the snapshot type, and `ConditionsCard` has no variant
  that omits the timestamp.

The generator is a pure function over already-scored candidates with no database
access and no clock of its own, so the same inputs always produce the same plan.
Its greedy approach is deliberate: an optimal solver would produce a slightly
denser plan and a much worse explanation, and a guest asking "why is this here?"
deserves "it was the best fit that still left time to get there", not a dual
value.

## The AI boundary

One interface, `AIProvider`, with one method. It takes a task name, a
PII-redacted input payload, instruction text, and a Zod schema the output must
satisfy. It has no tool surface, no write capability and no streaming.

```
runAI()  ─┬─ screen untrusted text for injection → BLOCKED AgentRun, no spend
          ├─ check the per-user rate limit       → BLOCKED AgentRun, no spend
          ├─ redact the payload before persisting
          ├─ call the provider
          └─ validate the output against the schema → FAILED if it does not fit
```

Every call is recorded as an `AgentRun` — mock or live, success, failure or
block — with token counts, a cost estimate, latency and any validation error.
`runAI` never throws on a model failure, because every caller is built to work
without the model: a failed, blocked or rate-limited run degrades to the
deterministic text rather than degrading the page.

The default provider everywhere is `MockAIProvider`, which is why the POC needs
no API key, no network and no budget. It is not a lorem-ipsum stub: it composes
sentences from the facts it is handed, so the demo's prose is the deterministic
engine's own reasoning joined up — and because it is a pure function of its
input, Playwright can assert on it.

Untrusted text (guest notes, partner descriptions) is screened against
injection patterns, has chat-control tokens neutralised, is truncated, and is
wrapped in an `<untrusted_*>` envelope that the system text explicitly
describes as data rather than instruction. Since the provider has no tools, the
realistic risk is not a rogue action but a rogue *statement* — a guest talking
the guide into saying a beach is safe. Screening plus hard output validation is
proportionate to that.

## Inventory and money

**Inventory.** `AvailabilitySlot.capacity` is the truth; `booked` and `held` are
counters moved only inside `Serializable` transactions, with retry on
PostgreSQL's 40001. The invariant `booked + held <= capacity` is re-checked
inside every transaction rather than trusted from a prior read — and is also a
database CHECK constraint (ADR-020), because an application-only invariant fails
silently and two bugs did exactly that. Retry-on-40001 re-runs the whole
function, so any guard a transaction body depends on must be read inside it. Holds expire,
and expiry is swept on read paths as well as explicitly — an expiry that only
happens when a cron job runs is an expiry that does not happen. Serializable is
expensive and correct here: two guests taking the last seat concurrently is
exactly the anomaly weaker levels permit, and a retried transaction is cheaper
than an oversold panga.

**Money.** Integer minor units plus an ISO currency code, everywhere. No floats,
no `Decimal`. `splitByBps` guarantees the parts always re-sum to the whole by
assigning the rounding remainder to a nominated share — the supplier, because we
would rather give the centavo to the operator who did the work than leave it
unaccounted. Rounding is half-up rather than banker's, because that is what an
operator checking the arithmetic by hand expects.

**Checkout** is idempotent through a claimed unique key `(organizationId, scope,
key)`: a retry replays the first result rather than creating a second order, and
a lost race to claim the key is a conflict rather than a duplicate. Consuming
holds, creating the order and writing the ledger share one transaction, and the
transaction refuses to commit if the three-way split fails to reconcile with the
order total.

**Prices are versioned, never edited.** Changing a price deactivates the old row
and writes a new one, so a historical order can always explain the price it
charged. Checkout re-derives every price and refuses to proceed if it disagrees
with what the guest was shown.

## Autonomy and approvals

ARC may draft an action and explain it. The action does not exist until a named
human approves it.

- `Proposal.actionJson` holds a machine-readable action from a **closed union**.
  Execution is a `switch` over that union with an exhaustiveness check, so a new
  action type fails loudly rather than silently doing nothing on approval.
- Execution is never a re-interpretation of the summary by a model.
- The approval and the execution share one transaction: an approval recorded
  against an action that silently failed would be the worst of both worlds.
- Only an owner may approve. Front-desk staff can see proposals; they cannot
  commit the business to one.
- Guest messaging **throws** while `ARC_ENABLE_OUTBOUND_MESSAGING` is false. It
  is a kill switch, not a flag.

## Earned versus potential

The separation is structural rather than a labelling convention, because the
pilot is judged on the earned number and conflating the two would make the
product worthless as an operator tool.

- **Earned** is the hotel's share of confirmed orders, net of refunded lines,
  read from what was stored at checkout rather than recomputed. Recomputing
  would hide a drift between what was recorded and what the rules say today.
- **Potential** is an estimate — unsold departures in the next three days at the
  published rate. It lives in its own field, its own card and its own visual
  treatment, is labelled as not revenue, and is never summed with earned.

Each briefing figure is returned alongside the derivation that produced it, so
an owner who disagrees with a number can be shown where it came from.

## Integrations

`src/modules/integrations/types.ts` declares an interface per outsourceable
concern; `defaults.ts` holds the offline implementation of each and resolves
them from the environment. The boundary is a type the domain depends on rather
than an environment variable read at a call site, so adding Stripe is one new
class plus one case in `getIntegrations()`, not a search for every place a
payment might happen.

Two rules bind every implementation:

1. **Never fabricate.** A provider that cannot answer returns
   `{ ok: false, reason }`. The fixture maps provider fails rather than
   estimating a straight line — in a town where the road bends inland around a
   headland, a fabricated travel time produces an itinerary that does not work.
   The fixture conditions provider omits a date it has no reading for rather
   than interpolating, because the safety gate treats a missing reading
   conservatively and that is only sound if "missing" genuinely means missing.
2. **Carry provenance.** Anything describing the real world returns with its
   source and observation time.

The messaging provider *throws*. A no-op that reports success is how a product
ends up believing it messaged someone, and the kill switch lives at the provider
as well as in the approval workflow — so a future caller that forgets to check
`ARC_ENABLE_OUTBOUND_MESSAGING` still cannot reach a guest.

Current wiring:

| Concern | Default | Optional |
| --- | --- | --- |
| AI | `mock` — deterministic, offline, free | `anthropic` |
| Payments | `simulated` — no network, no charges | `stripe` (MVP) |
| Maps / travel time | `fixture` — seeded Puerto Escondido matrix | `mapbox`, `google` |
| Conditions | `fixture` — seeded seven-day readings | `stormglass`, `openweather` |
| Messaging | `noop` | `twilio`, `resend` (MVP) |
| Analytics | `internal` — our own table | `posthog` (MVP) |

`getEnv()` refuses to start with `PAYMENTS_PROVIDER` set to anything but
`simulated` while `ARC_DATA_MODE=demo`. Demo mode is a guarantee, not a hint.

Travel times read a seeded matrix rather than a routing API: a fixed table makes
itinerary feasibility reproducible in tests, and for a town this size the number
a local would quote is more honest than a routing engine's optimism.

## Internationalisation

A typed EN/ES dictionary rather than a routing framework. Two locales, one
destination, and a typed catalogue gives something a runtime one cannot: the
line `type _EsIsComplete = AssertComplete<typeof dictionary.es>` fails typecheck
if a key is added to English and forgotten in Spanish.

Locale resolution is cookie → `Accept-Language` → English. The switcher is two
server-action buttons rather than a client select, so it works without
JavaScript and needs no hydration boundary.

## Testing strategy

| Layer | Runs against | Covers |
| --- | --- | --- |
| Unit | Nothing — pure functions | Money, pricing, commission, the conditions gate, itinerary feasibility, injection screening |
| Integration | Real PostgreSQL on `TEST_DATABASE_URL` | Serialized holds under concurrency, checkout idempotency and rollback, tenant isolation, briefing derivations, approvals |
| E2E | A built app in a browser, desktop + Pixel 7 | The acceptance criteria as journeys |

Integration tests use a real schema rather than a mock because the things most
worth testing — serialization failures, unique constraints, transactional
rollback — only exist in the database. A guard in `tests/setup.ts` refuses to
run against a `DATABASE_URL` that does not look like a test database.

Two habits learned while writing the E2E suite, recorded in the specs
themselves: after a server action calls `revalidatePath` the route remounts and
`useActionState` resets, so a transient form message is not a reliable assertion
target — assert on durable state. And the locale action redirects to the same
path, so `waitForURL` resolves before the cookie lands — wait on the effect
(`html[lang]`), not the navigation.

## What a production deployment would change

Honest list, in the order it would matter:

1. **Identity.** Replace `/sign-in` and `signInByEmail` with a real provider.
   The authorisation layer behind it needs no change.
2. **Rate limiting.** `modules/ai/service` keeps buckets in process memory,
   which is adequate for one instance and wrong for several. Move to Redis or
   Postgres.
3. **Hold expiry.** Lazy sweeping is correct but does work on read paths. Add a
   scheduled sweep alongside it, not instead of it.
4. **Conditions.** Replace the fixture provider with a live marine feed, keep
   the freshness and staleness handling exactly as it is.
5. **Payments and payouts.** Both are deliberately absent. Manual supplier
   confirmation comes first — see `docs/pilot-plan.md`.
6. **Images.** The POC ships no destination photography, because using
   unlicensed images of a real place in a commercial demo is not a corner worth
   cutting. `Experience.imageUrl` and `imageCredit` exist for licensed assets.

# Decision records

Each entry states the decision, the reasoning, and what it costs — including the
ones worth arguing with.

---

## ADR-001 — A modular monolith, not services

**Decision.** One deployable Next.js application with enforced module
boundaries under `src/modules`.

**Why.** The POC's hard problems are transactional: inventory under
concurrency, and a checkout that must be atomic across holds, order and ledger.
Distributing those adds failure modes without removing any. The boundaries are
real, so extraction later is a refactor rather than a rewrite.

**Cost.** One deploy unit, one scaling unit. Acceptable for a product whose
first pilot is one hotel.

---

## ADR-002 — Money as integer minor units

**Decision.** Every monetary value is an integer of minor units plus an ISO
currency code. No floats, no `Decimal`.

**Why.** Pricing must be exactly reproducible. An order placed today must be
re-derivable years from now when a hotel disputes a commission. Floats cannot
promise that and `Decimal` carries a library dependency into every module.

**Consequences.** `splitByBps` guarantees the parts re-sum to the whole by
assigning the rounding remainder to a nominated share. Rounding is half-up
rather than banker's, because half-up is what an operator checking the
arithmetic by hand expects.

**Cost.** Conversion at the UI edge (`pesosToMinor`), done exactly once.

---

## ADR-003 — Serializable isolation for inventory

**Decision.** Every mutation of `booked` or `held` runs in a `Serializable`
transaction with retry on PostgreSQL 40001.

**Why.** Two guests taking the last seat concurrently is precisely the anomaly
that weaker isolation levels permit. For a six-seat panga that is a real person
turned away at the beach.

**Alternatives rejected.** Optimistic version columns (more code, same retry
logic, easier to get wrong). `SELECT FOR UPDATE` (correct, but it puts the
locking discipline in every call site instead of one place).

**Cost.** Serialization failures under contention, absorbed by bounded retry
with backoff. A burst test fires ten concurrent holds at five places and asserts
exactly five are granted.

---

## ADR-004 — Conditions are a hard gate, and never a safety claim

**Decision.** `gateByConditions` runs before scoring and before any model. It
returns `allowed`, never `safe`. No function in the module returns a safety
judgement, and a test asserts the gate never emits one.

**Why.** This is the decision the product's credibility rests on. A system that
tells a guest a beach is safe has assumed a liability it cannot discharge —
conditions change hour to hour and ARC is not on the beach. What it *can* do
honestly is report a reading with its timestamp and source, and refuse to
recommend something the day does not support.

**Consequences.**
- Absence of a reading is not permission: fall back to the place's baseline and
  say so; with neither, assume `HIGH`.
- An unknown guest ability is never treated as expert. On a demanding day the
  candidate is withheld rather than guessed at.
- `observedAt`, `ageHours` and `isStale` are part of the snapshot type, so a
  caller cannot render a reading without its age.

**Cost.** Conservative. Some genuinely fine days will have candidates withheld
from guests who did not state an ability. That is the right direction to err.

---

## ADR-005 — Suitability lives on the activity, not the experience

**Decision.** `Activity` owns the safety envelope. `Experience` inherits it and
may narrow but never widen; `clampAbilityRange` reports every adjustment.

**Why.** Three surf schools selling a Zicatela session should not be able to
disagree about who it is suitable for. Putting the rule on the activity means
one change governs every supplier's version, and no amount of catalog editing
can turn the Mexican Pipeline into a beginner product.

**Cost.** An owner cannot express a genuinely gentler variant of an activity
without ARC adding a new activity type. That friction is deliberate.

---

## ADR-006 — The AI explains; it never decides

**Decision.** One `AIProvider` interface: task name, redacted input,
instruction text, Zod output schema. No tools, no write path, no streaming.
Every call is recorded as an `AgentRun`.

**Why.** An explanation that turns out to be wrong is embarrassing. A
recommendation that turns out to be wrong can put someone in the water on the
wrong day. Separating the two means the second cannot happen through the model.

**Consequences.** The mock provider is the default everywhere, so the POC needs
no key, no network and no budget. It is a pure function of its input, so demo
prose is stable and Playwright can assert on it. Injection screening blocks a
call before any spend and records it as `BLOCKED`. `runAI` never throws on a
model failure, because every caller works without the model.

**Cost.** The product cannot do anything genuinely agentic — no autonomous
negotiation, no free-form tool use. For a system that recommends ocean
activities to strangers, that is the point.

---

## ADR-007 — Earned and potential are structurally separated

**Decision.** Earned revenue and potential value live in different fields,
different cards and different visual treatments, and are never summed.

**Why.** The pilot is gated on the earned number. A dashboard that adds "you
made 12,000" to "you could make 40,000" produces a number that is true of
nothing, and an owner who discovers that once will not trust the product again.

**Consequences.** Each briefing figure is returned with the derivation that
produced it. The hotel's share is read from what was stored at checkout rather
than recomputed, so a drift between recorded and current rules shows rather than
hides.

**Cost.** The briefing is less immediately impressive than one big number.

---

## ADR-008 — No autonomous action; approvals with closed-union execution

**Decision.** ARC drafts; a named human approves. `Proposal.actionJson` holds an
action from a closed union, and execution is a `switch` over that union with an
exhaustiveness check. The approval and the execution share one transaction.

**Why.** A hotel owner's name is on anything sent to a guest. An agent that can
act unsupervised on a twenty-room property's behalf is a liability, not a
feature. Executing from a closed union rather than re-reading the summary means
a model's prose can never be the thing that runs.

**Consequences.** `send_guest_message` **throws** while
`ARC_ENABLE_OUTBOUND_MESSAGING` is false — a kill switch, not a flag.
`draft_experience_from_amenity` deliberately does not create the experience,
because inventing a partner, a price and a safety envelope is exactly the
plausible-looking fabrication this product exists to avoid.

**Cost.** Less autonomy than the category's marketing implies. Correct for a
pilot; revisit per-action, with evidence, not wholesale.

---

## ADR-009 — Hand-written UI primitives, not a component registry

**Decision.** Button, Card, Badge, Field, states and form feedback are written
here, on `class-variance-authority` and `tailwind-merge`.

**Why.** The set needed is about seven components. A registry CLI adds a
generation step, a version to keep current, and defaults tuned for a generic SaaS
aesthetic — the opposite of what a boutique-travel product needs. Writing them
costs an afternoon and gives full control of the design language.

**Cost.** No free access to a large component library later. The primitives are
small enough to replace.

---

## ADR-010 — A typed dictionary, not an i18n framework

**Decision.** `src/lib/i18n` is a typed EN/ES object with a `createTranslator`
function. No routing-based i18n.

**Why.** Two locales, one destination. A typed catalogue gives what a runtime one
cannot: `type _EsIsComplete = AssertComplete<typeof dictionary.es>` fails
typecheck if a key is added to English and forgotten in Spanish. No locale
segments in URLs, so a QR code printed today keeps working.

**Cost.** No pluralisation rules, no ICU message format, no translator
workflow. All three matter at ten locales and none at two.

---

## ADR-011 — A seeded travel matrix, not a routing API

**Decision.** `TravelEdge` rows seeded with times a local would quote.
`MAPS_PROVIDER` can switch to Mapbox or Google later.

**Why.** Itinerary feasibility must be reproducible in tests, and for a town
this size a resident's estimate is more honest than a routing engine's
optimism — the taxi that takes twenty minutes to La Punta does not care what the
straight-line distance is.

**Cost.** Manual maintenance per destination. At one destination, trivial.

---

## ADR-012 — PWA first, not native apps

**Decision.** Mobile-first installable web app.

**Why.** The guest portal is reached by scanning a QR code at a front desk. A
guest scanning a code will not install an app for a five-day trip, and app-store
review would make the feedback loop with a pilot hotel useless.

**Cost.** No push notifications on iOS without installation, no deep OS
integration. Neither is needed for the pilot.

---

## ADR-013 — Prices versioned, never edited

**Decision.** A price change deactivates the current row and inserts a new one.

**Why.** An order must be able to explain what it charged. Mutating the row
destroys that.

**Consequences.** Checkout re-derives every price and refuses to proceed if it
disagrees with what the guest was shown — neither silently charging the old
price nor the new one.

**Cost.** Price-table growth, bounded by how often a twenty-room hotel changes
prices.

---

## ADR-014 — Holds taken at add-to-basket, not at checkout

**Decision.** Adding to a basket takes a capacity hold immediately, with a
15-minute TTL.

**Why.** On a six-seat boat, a guest with the last two places in their basket
should keep them long enough to decide, and the next guest should be told they
are gone. Holding only at checkout means two guests can both reach checkout for
the same seat, and one of them loses after committing.

**Consequences.** Expiry is swept on read paths as well as explicitly. Re-adding
for the same cart and slot resizes the hold rather than stacking a second one.

**Cost.** Capacity can sit held by an abandoned basket for up to the TTL.
Fifteen minutes is the trade; the number is one constant.

---

## ADR-015 — Integration tests against real PostgreSQL

**Decision.** Integration tests run against a real schema on a separate
`TEST_DATABASE_URL`.

**Why.** The things most worth testing — serialization failures, unique
constraints, transactional rollback — do not exist in a mock. A mocked Prisma
client would have passed every one of the concurrency tests while the product
overslept departures.

**Consequences.** A guard refuses to run against a `DATABASE_URL` that does not
look like a test database. Test files run serially so a truncate in one cannot
pull rows out from under another.

**Cost.** Tests need a database. The speed penalty is seconds.

---

## ADR-016 — Demo mode as a guarantee, not a hint

**Decision.** While `ARC_DATA_MODE=demo`, `getEnv()` refuses to start if
`PAYMENTS_PROVIDER` is anything but `simulated`, and checkout re-checks the same
condition.

**Why.** "It's only a demo" is how a demo takes a real payment. A startup error
is cheap; an unintended charge against a hotel's guest is not.

**Cost.** Switching to a live provider requires an explicit mode change, which
is the intent.


---

## ADR-017 — A missing reading is judged on the same scale as a present one

**Decision.** When no `ConditionReport` exists, the gate derives the ability
the day demands from the place's baseline risk via `MIN_ABILITY_BY_RISK`, and
runs both ability rules — the guest's stated level and the unknown-level
withhold — exactly as it would with a reading.

**Why.** An independent review found that both rules were guarded on the
*presence* of a snapshot, so a date with no reading skipped them entirely. For
an activity whose `maxSafeRisk` is `EXTREME` the risk comparison can never fire
either, which left the gate with nothing to check: a guest who answered "I'd
rather not say" was offered the advanced-only Zicatela session on any date we
had no data for, while a guest who answered `BEGINNER` was correctly refused.
Answering honestly made a guest *less* safe than declining — the exact
inversion ADR-004 exists to prevent.

**Consequences.** `MIN_ABILITY_BY_RISK` is now exported from
`modules/destination/conditions` as the single source of that mapping; the seed
generates `minAbilityRequired` from the same table. A conditions-sensitive
candidate with no place at all is refused outright (`hasLocation: false`),
because an activity we cannot locate cannot be judged.

**Cost.** More candidates withheld on dates outside the forecast window. The
right direction to err, and it argues for a live conditions feed before a real
pilot rather than for relaxing the rule.

---

## ADR-018 — Conditions sensitivity belongs to the activity, not the place

**Decision.** `Activity.conditionsSensitive` is a stored boolean, defaulting to
true. The itinerary pipeline and the single-slot check both read it; neither
infers sensitivity from `PlaceKind`.

**Why.** Inferring it from the place meant an owner could switch the safety gate
off with one wrong dropdown choice. The seed contains two confusable places —
`playa-zicatela` (a `SURF_BREAK`, baseline `EXTREME`) and `zicatela-barrio` (a
`NEIGHBORHOOD`, baseline `LOW`, displayed simply as "Zicatela") — in a single
flat list. Choosing the latter turned a surf product at the heaviest beach break
in Mexico into a land activity: no risk check, no day-ability check, no
unknown-ability withhold, and no conditions card anywhere. An experience with no
place at all had never been gated in its life.

A surf lesson depends on the water wherever it is held. That is a property of the
activity, and defaulting to true means a new activity is gated until someone
decides otherwise.

**Consequences.** The conditions place resolves as the experience's own, then the
activity's, then refusal. `PlaceKind` no longer carries safety meaning, so adding
a kind cannot silently create an ungated one.

---

## ADR-019 — Suitability is enforced at the point of commitment

**Decision.** `modules/destination/suitability` evaluates one departure for one
guest, and `addToCart` refuses on it. The experience page renders from the same
function, so a departure the gate refuses shows the reason instead of a button.

**Why.** The itinerary was not the only route to a booking. A guest could open
an experience page directly, or post a slot id to the basket action, and neither
consulted the gate — so a beginner could put the advanced-only Zicatela session
in their basket and complete a simulated checkout. Gating only the
*recommendation* path left the *commitment* path open, which is the wrong way
round.

**Consequences.** The check runs at request time rather than being read from the
persisted itinerary, so a conditions report entered overnight changes the answer
before a guest can book on it. The refusal names the reason: "unavailable" to a
guest looking at a listed departure is worse than no answer.

**Cost.** One extra query per rendered departure. Worth it.

---

## ADR-020 — Database CHECK constraints behind the application invariants

**Decision.** `prisma/constraints.sql` holds CHECK constraints for the
invariants the application already enforces: `booked + held <= capacity`,
non-negative counters, a confirmed order's split accounting for its total, a
refund never exceeding its line, commission shares inside 100%, and a
conditions reading whose maximum is not below its minimum. Applied by
`npm run setup`, by the test harness and by CI.

**Why.** Every guarantee lived in application code, which means a bug in that
code corrupted data silently. A review found two such bugs — a concurrent
cancellation double-decrementing `booked`, and a checkout committing a stale
line quantity — and in both cases the counters ended up wrong with nothing
firing. One of them left `booked` *below* the real number of bookings, so
`placeHold` would have sold seats that were already gone, on a six-seat boat.

A CHECK turns that class of defect into a loud failure at the moment it
happens rather than a wrong number an owner discovers weeks later.

**Consequences.** `returnCapacity` now throws when asked to return more places
than are booked, rather than clamping with `Math.min` — the clamp kept the
counter non-negative while hiding the double-cancellation that caused it.

**Cost.** Constraints are not expressible in the Prisma schema, so they are a
separate file three harnesses must remember to apply. Encoded in `npm run
setup` and in CI so forgetting is hard.

---

## ADR-021 — An invitation is not a write to a stranger's profile

**Decision.** `invitePartner` creates the contact user or refuses. An email that
already belongs to an ARC account is rejected with an explanation.

**Why.** It used to `upsert`, so an owner supplying any existing user's email
rewrote that person's name and phone — a cross-tenant write to a row they have
no claim on — and grafted a `SUPPLIER` membership onto their account, exposing
this organization's partner portal to them at their next sign-in. The caller
gained no access to the victim's data, so it was not privilege escalation, but
it was an unauthorised write and a PII overwrite.

**Cost.** Inviting an operator who already has an account needs an acceptance
flow, which the POC does not have. Refusing with a clear message is the honest
interim.

---

## ADR-022 — Platform administration is a user flag, not a membership role

**Decision.** `assertPlatformAdmin` gates on `User.isPlatformAdmin` alone.

**Why.** It also accepted a membership with `role: ADMIN`, and `ADMIN` is a
legal membership role scoped to one organization. Everything behind that gate is
deliberately cross-tenant — every supplier and property in the database, and the
only route to a `VERIFIED` status — so a single row would have turned one
hotel's user into a platform operator. Organization-level administration is what
`OWNER` is for.

**Cost.** None. Nothing created such a membership; the hole was latent.

---

## ADR-023 — The portal token is time-boxed as well as scoped

**Decision.** `resolvePortalContext` refuses a token more than
`PORTAL_GRACE_DAYS` (7) past check-out, in addition to refusing cancelled and
no-show stays.

**Why.** The token is the guest's entire credential. Without an expiry, a
`CHECKED_OUT` stay kept a live one forever — so a QR code photographed at a
front desk months ago still opened a basket and could still check out and
cancel. "Scoped to one stay" has to mean scoped in time as well as in subject.

**Consequences.** The demo switcher no longer lists guests or renders portal
tokens, and both it and passwordless sign-in now refuse outside demo mode. The
page was public, so `curl /sign-in | grep '/g/'` harvested the credential of
every guest in the database.

**Cost.** A guest wanting a receipt after a week has to ask the hotel. Correct.

---

## ADR-024 — Culture Context is a module, not a sidecar

**Decision.** The standalone culture-context product (a Python FastAPI service,
plus TS types) is ported to TypeScript as `src/modules/culture-context`, inside
this deployable. It is not run as a sidecar service. Its doctrine lives in
[`culture-context.md`](culture-context.md).

**Why.** The real logic was about 200 lines of Python. Running it as a service
would break ADR-001 (one deployable) and add a Python host next to Vercel, a
second CI and a second test runner. Worse, the parts that are hard to build
(the admin verification queue, the AI boundary, i18n, the integration
interface) already exist here, and a sidecar would have had to reach them over
HTTP. Python earns its place only if ingestion turns into heavy scraping or
PDF and gazette parsing. If it does, that becomes a worker that writes
snapshots into Postgres, never a service in the request path.

The module lives at `src/modules/culture-context/` rather than the
`modules/culture-context` the merge plan named, because every module here is
under `src/modules/` and the layering rule in `CLAUDE.md` is written against
that path.

**Consequences.**

- `SourceClass` is a new enum *alongside* `Provenance`, never folded into
  `PUBLIC_SOURCE`. Provenance is who supplied a fact; source class is what kind
  of authority backs it.
- GOV.UK sits behind a `TravelAdviceProvider` in `modules/integrations`, with a
  `fixture` default and the live provider refused in demo mode.
- Rules are derived from the latest source text when a brief is built. They are
  not stored as rows. Snapshots and their changes are stored
  (`CultureSourceSnapshot`, `CultureSourceChange`), because change detection
  needs history and review needs a row to decide on.
- A hash change goes to `/admin` as a `PENDING` change, reusing
  `VerificationStatus`, `assertPlatformAdmin`, a mandatory note and
  `recordAudit`. Source changes belong to no organization, so
  `AuditEvent.organizationId` is now nullable: a platform-scoped event has no
  tenant, and inventing one would put a stranger's review into a hotel's audit
  trail.
- Three defects in the original are fixed, not carried over, and each has a
  regression test. `<script>` and `<style>` text leaked into the plain text.
  GOV.UK keyword-tagged the whole laws section with activities, so a traveller
  who declared none of them lost the section entirely. The adapter now emits
  ranking *topics*, and only a record's explicit `activityTags` can exclude it.
  And the API and the ingestion CLI hashed the same payload differently and
  hashed volatile metadata. Now there is one canonical hash over content fields.

**Cost.** One more module and a provider interface to keep honest. The fixture
is not a recording yet, because this environment cannot reach `www.gov.uk`, and
it is labelled as demo text until a recording replaces it.

## ADR-025 — The public destination surface carries destination imagery

**Status.** Accepted, 2026-10-22, by Andrew King (ARC Transformation Group).

**Context.** The Magic Patterns export shipped a complete public, consumer-facing
destination surface — fifteen screens, eight destinations, its own editorial
design language — and it was decided to port it in full rather than extract
parts of it. The export carries twenty images of real places, generated rather
than photographed, hotlinked from `cdn.magicpatterns.com`.

That runs into an earlier decision recorded in `CLAUDE.md`: *"No destination
photography — unlicensed images of a real place in a commercial demo is not a
corner worth cutting."* The reasoning behind it was sound and is unchanged:
putting pictures of Puerto Escondido in front of a prospective hotel partner
implies a relationship with the place that a demo does not have, and an
unlicensed photograph of somewhere real is a liability nobody needs.

**Decision.** The public surface ships with the export's imagery.

This was raised as a blocking concern and overruled deliberately, not missed.
The argument for overruling it: these are generated images rather than
photographs of identifiable property, so the licensing exposure the original
decision was written against does not arise in the same form; and a destination
surface with no imagery at all is not the thing being demonstrated. A consumer
travel page is substantially a visual artefact, and shipping it as typography
would be showing something other than what was designed.

The earlier decision is **not** reversed in general. It still governs the four
product surfaces, which carry no destination photography and should not acquire
any. This ADR is scoped to the public destination surface (the routes in
`src/app/(public)`); the owner, partner, guest-portal and admin surfaces carry
no destination photography.

**Consequences.**

- `next.config.ts` allow-lists `cdn.magicpatterns.com` by exact host and by the
  `/patterns/generated-images/**` path prefix, so the image optimiser cannot be
  aimed at an arbitrary origin through a crafted `src`.
- The build now has a runtime dependency on a third-party CDN for the public
  surface. Every `next/image` on that surface therefore needs a working empty
  state, and the surface must still read correctly with images absent — a CDN
  that goes away must degrade the page, not break it.
- Before this surface is shown to anyone outside a walkthrough, the images
  should be re-hosted under `public/` or an ARC-controlled bucket, and the
  provenance of each one recorded. Hotlinking someone else's CDN is acceptable
  for a demo and is not acceptable for a pilot.
- The image set depicts eight destinations, seven of which are outside the POC's
  scope. They are labelled as illustrative throughout, in the same way the
  listings are.

**Cost.** One documented exception to a product commitment, scoped to one
surface, plus the re-hosting work above before any external use.

---

## ADR-026 — ARC never confirms a payment; it books against one already confirmed

**Status.** Accepted, 2026-10-24.

**Context.** Until now the only payments provider was `SimulatedPaymentsProvider`,
which returns a succeeded intent unconditionally, and `checkout()` hard-refused
any other. That is correct for a demo and leaves no answer to the first question
a pilot asks: what happens when real money is involved?

The obvious implementation — checkout creates *and confirms* a payment, then
books — has a failure window that cannot be closed. Between taking the money and
writing the order there is a hold that may have expired, a slot that may have
filled, and a basket a second tab may have changed. Every one of those leaves
ARC holding a guest's money for a booking it cannot make, and the only recovery
is an automatic refund — which is a consequential action with no `Approval` row
behind it, and so forbidden by non-negotiable 6.

**Decision.** The payment is confirmed by the client, before checkout, and ARC
reads it back.

- `PaymentsProvider` gains `retrieveIntent`. `checkout()` takes an optional
  `paymentIntentId`: **required** when the provider is live, **refused** when it
  is not.
- For a live provider, checkout retrieves the intent and requires `succeeded`.
  It never calls `confirm`, and `StripePaymentsProvider.createIntent` does not
  send `confirm=true`.
- The *authoritative* amount is the provider's, read back from the provider —
  never the client's claim and never what ARC asked for. The transaction
  re-reads the basket lines and refuses to commit if the two disagree.
- A mismatch is a refused checkout plus an audit row
  (`commerce.checkout.payment_mismatch`), not an automatic refund. An operator
  reconciles it. That is slower and it is the honest answer.
- For the simulated provider nothing changes from the outside: there is no
  client-side step, so checkout creates the intent itself and it comes back
  `succeeded` and marked simulated.

**Consequences.**

- An order exists only once its payment does, so `CONFIRMED` continues to mean
  what it says and `OrderStatus.FAILED` is reachable only from the *later*
  failure of a payment that had succeeded.
- That later failure is what the webhook is for.
  `POST /api/webhooks/stripe` verifies the signature over the raw bytes, and
  `applyPaymentEvent` fails the order, returns every place through
  `returnCapacity`, and reverses the earnings lines with offsetting negative
  entries so each ledger account still sums to what is owed. The event id is
  claimed in `IdempotencyKey` **inside** the same transaction as the effect, so
  a redelivery is a no-op and a crash does not make an event unprocessable.
- `payment_intent.succeeded` is deliberately **not** handled. Checkout already
  confirmed the order against that intent, and re-confirming from an event would
  let a replay resurrect an order the guest has since cancelled.
- A webhook can only act on an order whose `paymentProvider` is `stripe`, so a
  live event can never mutate a simulated booking.
- A live provider requires `STRIPE_SECRET_KEY` **and**
  `STRIPE_WEBHOOK_SECRET`. Without the second, a payment that later failed would
  leave a confirmed order holding capacity for ever, so starting
  half-configured is a refusal rather than a silent condition.
- Demo mode still moves no money, and now refuses to three depths: `getEnv()`,
  `getIntegrations()` and `checkout()` each reject a live provider while
  `ARC_DATA_MODE=demo`. The webhook route 404s there.
- **Not built.** The client-side confirmation step itself. The guest surface has
  no payment element, because there is no mode in which this build may render
  one. A pilot needs that UI plus `ARC_DATA_MODE=pilot`, and the server side it
  will talk to is what exists here.

**Cost.** Two round trips instead of one for a live payment, and a reconciliation
an operator performs by hand in the mismatch case.

---

## ADR-027 — The published catalogue and the illustrative set are shown side by side, never merged

**Status.** Accepted, 2026-10-24.

**Context.** `src/modules/discovery/service.ts` is a database-backed read model
of the published catalogue — 350 lines, tested, scoped to
`ExperienceStatus.PUBLISHED` and `EntityStatus.ACTIVE`, taking no identifier
from the client. Until now **no route rendered it**. The public surface ran
entirely on the illustrative content set ported from the Magic Patterns export,
so the one destination this build has real data for was showing fixtures. This
was the largest architectural gap the readiness audit found.

The obvious fix is to merge the two: adapt the database rows into the content
shapes and concatenate. Two things make that wrong.

**They are different claims.** "Illustrative" means nobody is behind this
listing. "Unverified" means a real supplier is, and ARC has not checked them.
A visitor who cannot tell which list they are reading cannot tell which claim
they are being made — and the second is the one a hotel partner is being asked
to evaluate.

**They are different currencies.** The content set is USD
(`CONTENT_CURRENCY`); the catalogue is in the property's own currency. The
browse page's price filter is a single scale. One slider over two currencies is
a slider that lies, and reconciling them would mean inventing an exchange rate
in a build whose first non-negotiable about money is that it is exact.

**Decision.** `modules/discovery/live.ts` adapts the read model into the
content types the existing components already render, and the pages show the
two catalogues as separate, labelled sections.

Five rules govern the adapter, and each is a refusal:

1. **Nothing is invented to fill a field.** No photograph, no host biography, no
   years of experience, no step-by-step itinerary, no room size, no rating.
   Those fields became optional on the content types and are left empty.
2. **Claims stay claims.** `hostClaims` is the supplier's own
   `claimedCertifications`, passed through. `provenance` carries the row's real
   `VerificationStatus`, so only an `/admin` decision can produce verified
   wording (non-negotiable 2).
3. **Currency travels with the price.** Every card and estimator reads the
   listing's currency instead of assuming `CONTENT_CURRENCY`.
4. **An unpriced listing is not a listing.** A published experience with no
   active BASE price is omitted rather than shown as "price on request" by a
   product that holds the price list.
5. **A rejected supplier is not shown.** The published-catalogue predicate does
   not exclude one; the adapter does.

It returns **no availability** — no slots, no holds, no "places left". A
published price is a fact about a price list, not an offer on a date.

**Consequences.**

- Live sections appear on `/`, `/experiences` and `/stays`; `/experiences/[slug]`
  and `/stays/[slug]` try the database first and fall through to the content
  set, so a real listing is never shadowed by a fixture that shares its slug.
- `ListingBadge` gained a third state. It could already say "verified by ARC"
  and never did, because nothing reaching it had a real status; now something
  does, and the wording is reachable only from a recorded admin decision.
- `ExperienceCategory` gained a `Transport` member. The database has a
  `TRANSPORT` category and none of the content set's five buckets it honestly
  maps to; squeezing an airport transfer into "Nature" is how a filter starts
  lying. The map is exhaustive over the Prisma enum, so a new database category
  fails typecheck rather than landing in whichever bucket was nearest.
- `AbilityLevel` has five members and the content set's `Difficulty` four.
  `IMPROVER` and `INTERMEDIATE` both read as "Moderate"; collapsing two
  adjacent middle levels loses less than inventing a fifth word, and the detail
  page shows the real ability range alongside.
- A live card renders on its tinted plate with no image, permanently. ADR-025
  scoped destination imagery to the *content* set; giving a real supplier's
  listing a stock photograph is the thing that decision scoped away.
- On an unseeded database every live section disappears rather than rendering
  an empty shelf.

**Not done.** `/destinations/[slug]`, `/culture/[destination]`, `/search` and
`/plan` still read the content set alone. The places and conditions the read
model exposes (`listPublicPlaces`, `getPublicConditions`) are rendered on the
guest portal and not yet on the public destination page.

**Cost.** Two catalogues visible on one surface, which is more to explain than
one. That is the honest shape of the thing: the product has one real
destination and a demonstration of what eight would look like.

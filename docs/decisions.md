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

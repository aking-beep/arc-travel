# Data model

33 models in `prisma/schema.prisma`. This document covers the conventions, the
invariants, and the decisions worth knowing about. The schema itself is
commented and is the authority.

## Conventions

| Convention | Why |
| --- | --- |
| UUID primary keys | Safe to expose in URLs; no enumeration, no cross-tenant inference |
| `organizationId` on every tenant-owned row | Makes isolation checkable in one place and auditable in SQL |
| Money as integer minor units + ISO code | Bit-reproducible. An order can be re-derived and audited years later |
| `createdAt` / `updatedAt` everywhere | Every row can answer when it changed |
| Explicit lifecycle enums, never booleans | `DRAFT → PENDING_REVIEW → PUBLISHED → PAUSED → ARCHIVED` says more than `isPublished` |
| Calendar days as `@db.Date`, handled as `YYYY-MM-DD` | No timezone conversion can shift a day boundary |
| Provenance + verification + freshness on destination rows | The product structurally cannot present a guess as a verified fact |

## Domains

### Tenancy

```
Organization ──┬── Property ──┬── RoomType
               │              ├── Amenity ──(0..1)── Experience
               │              ├── Stay ── Guest ── Consent
               │              └── SupplierAgreement ── Supplier
               ├── Membership ── User
               └── CommissionRule
```

`Membership` is the sole source of authority. It binds a user to an
organization with a role, and optionally narrows to one property (front-desk
staff) or one supplier (a partner's own account). The unique constraint
`(organizationId, userId, role, propertyId, supplierId)` permits a user to hold
several roles without duplicating one.

`Property.roomCount` is **derived** from the sum of its `RoomType.roomCount` and
recomputed on every upsert, so it cannot drift out of step with the rows beneath
it.

### Destination graph

```
Place ──┬── Place (parentId, self-referential: break inside a neighbourhood)
        ├── ConditionReport  (one per place per day)
        ├── TravelEdge       (directed, mirrored on seed)
        ├── Activity         (what can be done here)
        └── Experience       (what is sold here)
```

`Place` is **shared reference data, not tenant-owned.** Playa Zicatela is not
owned by a hotel. Places carry no commercial claims — no price, no availability,
no partner.

`Activity` holds the safety envelope, and this is the single most important
design choice in the schema:

| Field | Meaning |
| --- | --- |
| `minAbility` / `maxAbility` | Who this is suitable for, at all |
| `maxSafeRisk` | The highest conditions risk at which it may be recommended |
| `guideRequired` | Whether a certified guide is mandatory — enforced, not advisory |
| `minAgeYears` | Hard minimum |
| `seasonMonths` | Months in which it is viable |
| `earliestStart` / `latestStart` | Sensible local hours |
| `physicalIntensity` | 1–5; drives rest scheduling |

Suitability lives on the activity rather than on the experience so that **one
safety rule governs every supplier's version of the same thing.** Three surf
schools selling a Zicatela session all inherit `ADVANCED–EXPERT` and
`guideRequired`. An owner editing their catalog can narrow that range but the
service clamps any attempt to widen it, and reports the clamp.

`ConditionReport` is a dated reading per place:

- `risk` — LOW / MODERATE / HIGH / EXTREME
- `minAbilityRequired` — the lowest ability the day demands. **Named carefully.**
  An earlier draft called this `suitableUpTo`, which reads as "conditions are
  fine up to this level" while the value is the *minimum* the day demands. In a
  safety-gating field that ambiguity is dangerous, so it was renamed.
- `observedAt`, `source`, `provenance` — freshness and attribution, rendered
  next to every reading.

`TravelEdge` is a directed `(from, to, mode)` edge with minutes, distance and a
typical cost. Declared one way in fixtures and mirrored on seed, because a
nine-minute walk down to the cove is a nine-minute walk back as far as planning
is concerned.

### Catalog and inventory

```
Experience ──┬── Price            (versioned; never edited in place)
             ├── AvailabilitySlot ──┬── InventoryHold
             │                      ├── CartItem
             │                      └── OrderItem
             ├── CartItem
             ├── OrderItem
             └── ItineraryItem
```

**`Price` rows are versioned.** Changing a price deactivates the current row
(`isActive: false`, `validTo: now`) and inserts a new one. A historical order can
always explain the price it charged. Selection precedence is PROMO > GROUP >
SEASONAL > BASE, then the more specific `minParty` tier.

**`AvailabilitySlot` is where correctness lives.**

```
capacity   the truth
booked     committed, moved only inside a Serializable transaction
held       reserved for a cart mid-checkout, same
status     OPEN | FULL | CLOSED | CANCELLED
```

The invariant is `booked + held <= capacity`, re-checked inside every
transaction. `status` is reconciled from the counters and never reopens a
`CLOSED` or `CANCELLED` slot. A unique constraint on `(experienceId, startsAt)`
makes bulk scheduling idempotent — re-running a partner's schedule skips
duplicates rather than failing.

**`InventoryHold`** is a short-lived reservation with an `expiresAt`. Lifecycle:
`ACTIVE → CONSUMED | RELEASED | EXPIRED`. A hold is taken at add-to-basket, not
at checkout, and expiry is swept on read paths as well as explicitly.

### Commerce

```
Cart ── CartItem
  └──(on checkout)── Order ──┬── OrderItem ──(1:1)── InventoryHold
                             └── LedgerEntry
IdempotencyKey  guards the checkout mutation
CommissionRule  resolves the split
```

`Order` stores the computed split at confirmation time:
`hotelEarningsMinor + platformEarningsMinor + supplierPayableMinor == totalMinor`.
The transaction refuses to commit otherwise, and the admin health page reports
any violation as a failure rather than a warning.

`isSimulated` and a `SIMULATED-` prefixed `paymentReference` mark every POC
order unmistakably, so it can never be reconciled against a real processor by
accident.

`LedgerEntry` is an append-only record per account: `hotel_earnings`,
`platform_commission`, `supplier_payable`, `refund` (negative). The ledger must
balance to the net position of **every** order in any status — sold less
refunded. Comparing it only against orders in an *earned* status was a real bug:
a fully refunded order holds entries while sitting outside that set, so the
comparison could never balance.

`IdempotencyKey` has a unique constraint on `(organizationId, scope, key)`. The
constraint — not a prior read — is what makes concurrent duplicate submissions
safe.

### Itinerary

```
Itinerary ──┬── ItineraryItem ──┬── Experience / AvailabilitySlot (when bookable)
            │                   ├── Place
            │                   └── OrderItem (once purchased)
            └── AgentRun        (the narrative, if any)
```

`ItineraryItem.kind` is `EXPERIENCE | MEAL | REST | TRANSFER | FREE_TIME`, so a
day reads as a day rather than a list of bookings. `rationale` is a string array
of deterministic, guest-facing reasons; `score` is the deterministic match score.
`generatorVersion` records which version of the generator produced the plan, so
it can be reproduced exactly.

`unmetConstraints` is JSON holding what the generator could not accommodate.
Stored rather than discarded, because telling a guest what did not fit is more
useful than a silently thinner plan.

### AI, workflow and audit

```
AgentRun ──┬── Itinerary        (narrative)
           ├── Recommendation   (optional explanation)
           └── Proposal         (drafted action)

Proposal ── Approval ── User    (who decided, when, with what note)
AuditEvent                      (append-only, PII-redacted)
AnalyticsEvent                  (pseudonymous subject keys only)
```

`AgentRun` records every model call — mock or live, success, failure or block —
with `inputTokens`, `outputTokens`, `costMicroUsd`, `latencyMs`,
`validationError` and `blockedReason`. `inputJson` is PII-redacted before it is
written.

`Recommendation` stores both `reasons` and `exclusions`. The excluded ones are
the more useful half: they are how the product answers "why wasn't I offered the
surf lesson?" without re-deriving anything.

`Proposal.actionJson` holds a machine-readable action from a closed union.
Execution is a switch over that union, so a model's prose can never be the thing
that executes.

`AuditEvent` is append-only — never updated, never deleted. The write
participates in the caller's transaction when one is passed, so an action and
its audit record either both happen or neither does.

`AnalyticsEvent.subjectKey` is always a pseudonym. An email or phone number must
never reach this table.

`AuditEvent.organizationId` is null only for platform-scoped events that belong
to no tenant: a culture-source check or change review (ADR-024). A tenant's
action always names its organization.

### Culture context

```
CultureSourceSnapshot ──┬── CultureSourceChange (previous)
                        └── CultureSourceChange (current) ── User (reviewer)
```

Platform-scoped, so neither carries an organization. `CultureSourceSnapshot` is
one check of an advisory source: append-only, failed checks included
(`ok = false`, `failureReason`). A successful one stores the normalised section
text it hashed (`contentJson`, never raw source HTML) and `contentHash` from
`snapshotHash`. `sourceClass` is the evidence-class axis, separate from
`Provenance`.

`CultureSourceChange` opens as `PENDING` when a successful check's hash differs
from the previous successful one. `changedSections` names the brief categories
whose text moved. Detection is not materiality. Only a `VERIFIED` change, with a
reviewer and a note, can produce guest-facing "this advice was updated" copy.
Rules are not stored. They are derived from the source when a brief is built
(see `docs/culture-context.md`).

## Invariants

Checked in code, in tests, and surfaced on `/admin/health`:

| Invariant | Enforced by |
| --- | --- |
| `booked + held <= capacity` on every slot | Serializable transactions; a health check reports violations as failures |
| An order's three shares sum to its total | Checkout refuses to commit otherwise; a health check |
| The ledger balances to every order's net position | A health check; regression-tested |
| Prices are never edited, only superseded | `updateExperience` deactivates and inserts |
| An experience's ability range sits inside its activity's | `clampAbilityRange`, reported back to the owner |
| A guide-required activity always includes a guide | Catalog service, the conditions gate, and a health check |
| No cross-tenant read or write | `modules/tenancy`, with a dedicated integration suite |
| Nothing becomes VERIFIED without a recorded admin action | Only `modules/admin` sets it; a note is required to approve |
| A successful culture snapshot has a hash; a failed one has a reason | `culture_snapshot_ok_has_hash` CHECK |
| A VERIFIED source change names its reviewer | `culture_change_verified_has_reviewer` CHECK; `reviewSourceChange` requires a note |
| A government advisory is never a LAW record | `ruleRecordSchema`; unit-tested |
| A consequential action has an Approval row | `decideProposal` is the only executor |

## Deliberate omissions

- **No soft deletes.** Lifecycle enums carry the same information more clearly,
  and a `deletedAt` that half the queries forget is worse than neither.
- **No `isPublished` boolean.** `ExperienceStatus` distinguishes a draft from a
  paused experience from an archived one, which a boolean cannot.
- **No computed-revenue column.** Figures are aggregated on read. A stored total
  that drifts from its rows is a reporting bug that hides itself.
- **No `Conditions` on `Experience`.** Conditions belong to a place and a date,
  not to a product. Attaching them to the product would let two suppliers at the
  same break disagree about the swell.

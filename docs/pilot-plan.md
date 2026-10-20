# Pilot plan — Puerto Escondido

A deliberately narrow commercial test. Its purpose is to produce two numbers
trustworthy enough to decide whether to build the MVP.

## Shape

| | |
| --- | --- |
| **Hotels** | One independent property with existing guests |
| **Partners** | Three to five real operators, documents verified |
| **Experiences** | Five, purchasable, each with real availability |
| **Guest access** | QR code at the front desk to the PWA portal |
| **Owner surface** | The morning briefing and the commerce view |
| **Settlement** | Manual supplier confirmation, manual settlement |
| **Duration** | Eight weeks minimum, thirty completed stays minimum |

Five experiences, not fifty. The pilot tests whether guests buy and whether the
owner's life gets easier, and neither question needs breadth. Breadth would
dilute the signal and multiply the verification work.

## Choosing the hotel

Needs:

- Twelve to thirty rooms, independently owned, owner reachable directly.
- Existing occupancy. A hotel with a filling problem has a different problem.
- An owner who already recommends operators informally — the behaviour exists
  and we are formalising it, not inventing it.
- Willingness to be measured, including on the number that makes ARC look bad.

A property that wants ARC to fix distribution is the wrong pilot. Ours is an
attach-rate product.

## Choosing partners

Three to five, one per category, each individually verified before a single
guest sees them:

| Checked | Recorded |
| --- | --- |
| Legal entity and tax registration | `Supplier.legalName`, verification note |
| Public liability insurance, in force | `insuranceOnFile`, expiry in the note |
| Instructor or guide certification, where the activity requires one | Verification note; **never** auto-promoted from `claimedCertifications` |
| Boat or vehicle permits, where applicable | Verification note |
| A named person who answers the phone | `contactUserId` |

`claimedCertifications` exists precisely so a claim can be stored without being
presented as confirmed. Nothing moves to `VERIFIED` without a note saying what
was seen, and a verified badge with no record behind it is a liability rather
than an assurance.

## Before a real guest arrives

1. Real identity provider in place of the demo switcher.
2. Live marine conditions feed replacing the fixture provider. **The freshness
   and staleness handling stays exactly as it is** — a live feed that fails
   silently is more dangerous than a fixture that is honest about its age.
3. All five experiences verified, priced, with real availability loaded by the
   partner.
4. Stripe behind the existing interface, `ARC_DATA_MODE=pilot`.
5. Guest-facing privacy notice and terms. The consent rows exist; the notice
   they point at does not.
6. Error monitoring wired to the existing `AppError` taxonomy.
7. Rate limiting moved out of process memory.
8. A tested database restore. Untested backups are a story.
9. A fifteen-minute front-desk briefing: what the QR code is, what the briefing
   tells them, and that ARC never messages a guest.

## Metrics

### Primary — incremental destination-commerce contribution per guest stay

```
contribution = gross experience sales
             − supplier payments
             − refunds
             − payment processing fees
             − ARC fees

per-stay     = contribution ÷ all completed stays in the period
```

**Every completed stay is in the denominator**, including those that bought
nothing. A per-buyer figure measures the buyers who already wanted this; a
per-stay figure measures the product.

Already computed by `getRevenueAnalytics`, which returns the derivation
alongside the number. Payment fees and ARC fees enter the calculation when the
live rail is enabled.

### Primary — owner time spent maintaining the system

Self-reported weekly, in minutes. Crude and still the second most important
number: a system that earns well and costs an owner an hour a day will be
abandoned. Target under thirty minutes a week by week four.

### Secondary

| Metric | Why | Source |
| --- | --- | --- |
| Attach rate | Share of stays buying anything | `getRevenueAnalytics` |
| Intake completion | How many guests complete preferences | `guest_intake_completed` events |
| Itinerary-to-basket conversion | Whether the plan actually sells | `added_to_basket` events |
| Unmet-constraint frequency | Where the catalog is genuinely thin | `Itinerary.unmetConstraints` |
| Partner confirmation latency | Whether manual confirmation is viable | `OrderItem.supplierConfirmedAt` − `createdAt` |
| Cancellation and refund rate | Whether suitability matching works | Order statuses |
| Conditions exclusion rate | How often safety gating removes candidates | `Recommendation.exclusions` |
| Approval decision rate | Whether proposals are worth drafting | `Approval` rows |

The conditions exclusion rate is the one to watch for an uncomfortable result:
if the gate is excluding most candidates most days, either the fixtures were
optimistic or the catalog is wrong for the destination. Both are findings.

## What would make us stop

Stated in advance, so they cannot be rationalised later:

- **Per-stay contribution below a level worth an owner's attention.** If three
  experiences a week is the ceiling, this is a feature of someone else's product,
  not a company.
- **Owner maintenance time not falling.** If week eight looks like week one, the
  product is a second job.
- **A safety near-miss traceable to a recommendation.** Stop, investigate, and
  publish what changed. Not a metric — a condition.
- **Partners unwilling to confirm by hand.** Manual confirmation is the cheapest
  version of the workflow. If it is already too much friction, automated payouts
  will not fix the relationship.
- **Guests not completing intake.** Personalisation is the product. If guests
  will not answer four questions, the premise is wrong.

## Post-pilot decision

Three outcomes:

1. **Both numbers clear.** Build the MVP in `docs/roadmap.md`, second hotel in
   the same destination before a second destination.
2. **Revenue clears, time does not.** The product works and the operator
   experience does not. Fix the briefing and catalog maintenance; re-run the
   pilot. Do not scale.
3. **Revenue does not clear.** Stop. Write up why — attach rate, catalog fit,
   guest willingness — and do not let a feature backlog become the explanation.

# Product requirements — ARC Stay

## The problem

An independent boutique hotel of twenty rooms has two assets it cannot
currently monetise.

The first is **knowledge**. The front desk knows which cove is calm enough for a
first surf lesson, which panga captain shows up on time, which kitchen is open
on a Tuesday, and which beach will hurt a guest who has never surfed. That
knowledge is transmitted verbally, inconsistently, and only to guests who think
to ask.

The second is **relationships**. The hotel already works with local operators,
usually informally and almost always without taking a share. When the front desk
books a surf lesson by hand it creates revenue for a surf school and
administrative work for the hotel.

Large OTAs do not solve this. They sell rooms, and their experience marketplaces
are built for cities and volume, not for a twenty-room property in a town where
the right answer changes with the swell.

## What ARC Stay is

A system that turns a hotel's amenities, local recommendations and trusted
partners into structured, discoverable, personalised, bookable destination
experiences — and pays the hotel for the guest relationship it already owns.

## What it is not

- Not a booking engine. ARC Stay does not sell rooms.
- Not a hotel management system. It does not replace a PMS.
- Not an Airbnb Experiences clone. Those are built for volume and discovery
  across a city; this is built for one property's guests in one destination,
  where suitability and conditions matter more than selection.
- Not ARC Control. That is a separate enterprise B2B agent-infrastructure
  product. ARC Travel is a separate hospitality vertical with no runtime
  dependency on it in either direction.

## Users

| User | What they want | What they will not tolerate |
| --- | --- | --- |
| **Hotel owner** (Elena) | Incremental revenue without new work; to look good to guests | Time spent maintaining a system; being made to look wrong about a local recommendation |
| **Front-desk staff** (Tomás) | Fewer repetitive bookings by hand; to know what a guest wants before they arrive | A tool that is slower than WhatsApp |
| **Guest** (Harriet) | To not waste days of a short trip; to not get hurt | Being sold something unsuitable; a plan that cannot be changed |
| **Local partner** (Mariana) | Filled departures and clear expectations | Being committed to bookings she did not confirm; opaque commission |
| **Platform admin** (ARC) | Catalog quality; defensible claims | A verified badge that means nothing |

## Scope: proof of concept

**In scope, and built.**

1. Owner surface — onboarding derived from stored facts, property profile, room
   types, amenities, catalog with publish preconditions, partner invitation with
   commission, arrivals board, morning briefing, approvals, revenue analytics.
2. Guest portal — QR-reached, mobile-first, PWA-installable, EN/ES: preference
   intake with explicit consent, a day-by-day itinerary showing its reasoning,
   the local guide with conditions and provenance, experience detail, basket
   with capacity holds, simulated checkout, cancellation.
3. Partner portal — profile with verification state, experiences, bulk
   availability scheduling, booking requests with manual confirmation, earnings
   limited to what the partner is owed.
4. Admin — supplier and property verification, destination graph with
   provenance, data-quality checks, system health including AI telemetry and the
   audit trail.
5. Destination intelligence — places with provenance and safety notes, a travel
   matrix, dated conditions with freshness, activities carrying a safety
   envelope, deterministic matching and scoring.
6. Commerce — server-side pricing, versioned prices, capacity holds under
   serializable isolation, idempotent checkout, configurable commission split, a
   ledger, cancellation and refund rules.
7. Operator intelligence — a briefing built from stored facts with each figure's
   derivation, drafted actions requiring approval, an append-only audit trail.

**Out of scope for the POC, by decision.**

- Real payments or payouts. Checkout is a real state machine over simulated
  money.
- Outbound guest messaging. A hard kill switch, not a flag.
- Autonomous action. Every consequential action requires a recorded approval.
- Multi-destination. The model supports it; the data and fixtures are Puerto
  Escondido only.
- Native apps. Mobile-first PWA instead — see `docs/decisions.md`.
- Channel-manager or PMS integration.
- Destination photography, until assets are licensed.

## Functional requirements

### Destination intelligence

- The destination is modelled as **distinct places**, not one interchangeable
  location. Puerto Escondido is not one beach, and which one a guest is on
  decides what is possible that day.
- Every destination fact carries provenance, verification status and a
  last-reviewed timestamp, and these are rendered to users.
- Conditions are dated readings per place, carrying wave height, wind, water
  temperature, tides, current notes, a risk band, the minimum ability the day
  demands, and whether a guide is recommended.
- **Every reading is shown with the time it was taken and its source.** A
  reading older than twelve hours is rendered as stale.
- **The product never states that a place or activity is safe.** It reports
  conditions and gates what may be recommended.

### Suitability and safety

- Each activity carries a safety envelope: minimum and maximum ability, the
  highest conditions risk it may run in, whether a certified guide is mandatory,
  a minimum age, seasonality and sensible hours.
- An experience inherits that envelope. An owner may set a **narrower** range
  but never a wider one, and the system reports every adjustment it made.
- A guide-required activity always ships with a guide, whatever the form said.
- An activity's category is authoritative — a surf lesson cannot be filed under
  dining to dodge a rule.
- Unknown guest ability is recorded as unknown, never defaulted. On a demanding
  day an unknown ability withholds the candidate.

### Itinerary

- A guest supplies dates, party size, interests, ability, pace, budget and
  transport preferences.
- The generated plan respects activity hours, slot capacity, geographic
  feasibility including travel time, rest after demanding sessions, daily budget
  and suitability.
- Every item shows its reasoning. Alternatives are available, including what was
  considered and rejected and why.
- **Anything the generator could not accommodate is reported to the guest**
  rather than producing a quietly thinner plan.
- The AI layer may rephrase the reasons; it cannot override a validated
  constraint, add a candidate or change a score.

### Consent and privacy

- Intake cannot be stored without explicit data-processing consent.
- Personalisation is a separate, optional consent. Without it the guest still
  receives a full itinerary; it is simply not ranked around what they told us.
- Consents are rows with a source and timestamps. Withdrawal sets `revokedAt`
  rather than deleting, so there is a record that consent existed and was taken
  back.
- PII is redacted before anything reaches a log, an audit payload or a model.
  Analytics subjects are pseudonymous; an email or phone number must never reach
  the analytics table.

### Commerce

- All money is computed server-side from stored rows. A client never sends a
  price.
- Adding to a basket takes a capacity hold immediately. A guest who has the last
  two places in their basket keeps them long enough to decide, and the next
  guest is told they are gone.
- Checkout is idempotent, atomic, and refuses to commit unless the earnings
  split reconciles with the order total.
- Commission is configurable with most-specific-rule-wins resolution:
  experience > category > property > organization default.
- Partners confirm each booking by hand. No automated payout.

### Operator intelligence

- The briefing is built from stored facts, and each figure is returned with its
  derivation.
- Earned revenue and potential value are structurally separated and never
  summed.
- Drafted actions require approval, record who decided and when, and execute as
  deterministic database operations from a closed union of action types.

## Non-functional requirements

- **Mobile first.** The guest portal's real deployment is a phone held
  one-handed in bright sun. Bottom navigation in the thumb zone, 16px gutters,
  no horizontal scroll, visible focus, safe-area padding.
- **Accessible.** Semantic landmarks, labelled form controls, WCAG AA contrast,
  reduced-motion respected, loading/empty/error states on every list and panel —
  an owner looking at a blank panel cannot tell "no arrivals today" from
  "broken".
- **Localised.** Full EN/ES parity, enforced at compile time.
- **Installable.** PWA manifest, standalone display, maskable icon.
- **Reproducible.** The seed is deterministic; the itinerary generator is a pure
  function; demo prose is stable across reloads.
- **Observable.** Every consequential action writes an audit event; every AI
  call writes an `AgentRun` with token and cost telemetry.
- **Runnable with no secrets.** Only `DATABASE_URL` is required.

## Acceptance criteria

The POC is complete when all of these pass. All do.

1. A hotel owner can onboard Casa Olas and edit the property profile.
2. An owner can publish an experience with a price and capacity.
3. A supplier can manage availability and see a simulated booking.
4. A guest can build a feasible, personalised itinerary.
5. A guest can add experiences to a basket and complete a simulated checkout.
6. Inventory decreases correctly without double-booking.
7. An owner can see actual simulated revenue separately from opportunities.
8. The morning briefing uses stored facts and requires approval for actions.
9. The Spanish and English guest experience works on mobile.
10. Lint, typecheck, unit tests, E2E tests and a production build all pass.

## Success metrics — pilot, not POC

The POC's success is that it is credible enough to put in front of a hotel
owner. Commercial validation is a separate, deliberately narrow pilot gated on
two numbers:

1. **Incremental destination-commerce contribution per guest stay**, net of
   supplier payments, refunds, payment fees and ARC fees. Every completed stay is
   in the denominator, including those that bought nothing.
2. **Owner time spent maintaining the system**, per week.

A feature count is not a metric. See `docs/pilot-plan.md`.

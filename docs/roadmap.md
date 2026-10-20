# Roadmap

Three stages. Each is gated on evidence from the one before, not on feature
count.

---

## Stage 1 — Proof of concept · complete

One fictional hotel, synthetic everything, nothing deployed.

**Delivered.** Four surfaces, a 31-model data model, the destination graph with
provenance and the conditions safety gate, deterministic itinerary generation,
simulated commerce with capacity holds and a balanced ledger, the operator
briefing with approvals, verification and data-quality checks, 221 unit and
integration tests, 43 acceptance tests, full EN/ES, PWA-installable.

**What this stage proves.** That the loop holds together and that the product
can be built without lying — no invented availability, no verified badge that
means nothing, no claim that a beach is safe.

**What it does not prove.** Anything commercial. Every number is synthetic.

---

## Stage 2 — Pilot · next

One real hotel, three to five real partners, five verified purchasable
experiences. Detail in [`pilot-plan.md`](pilot-plan.md).

### Must be built before a real guest sees it

| Work | Why it blocks |
| --- | --- |
| Real identity provider | The demo account switcher cannot face real guests |
| Live marine conditions feed | Fixtures must not drive real safety gating. Keep the freshness and staleness handling exactly as it is |
| Supplier verification run | Five experiences, documents actually checked, notes recorded |
| Rate limiting out of process memory | Redis or Postgres. In-process is wrong above one instance |
| Scheduled hold sweep | Alongside lazy sweeping, not instead of it |
| Licensed destination photography | The POC ships none deliberately |
| Error monitoring | Sentry, wired to the existing `AppError` taxonomy |
| Real payment rail | Stripe behind the existing `PAYMENTS_PROVIDER` interface, with `ARC_DATA_MODE=pilot` |
| Guest-facing terms and privacy notice | Consent rows exist; the notice they point at does not |

### Deliberately still absent in the pilot

- **Automated payouts.** Manual supplier confirmation and manual settlement
  first. A payout bug is a relationship ending, not a support ticket.
- **Outbound guest messaging.** The kill switch stays off. The front desk talks
  to guests; ARC drafts and the owner decides.
- **Autonomous action.** Approvals stay mandatory. Relax per action type, with
  evidence, never wholesale.

### Gate to stage 3

Both numbers, over at least eight weeks and thirty completed stays:

1. **Incremental destination-commerce contribution per guest stay**, net of
   supplier payments, refunds, payment fees and ARC fees — with every completed
   stay in the denominator.
2. **Owner time spent maintaining the system**, per week. If this is not small,
   nothing else matters: a system that costs an owner an hour a day will be
   abandoned however much it earns.

A pilot that produces revenue while consuming the owner's week has failed.

---

## Stage 3 — Commercial MVP · gated

Only if stage 2 clears its gate.

### Product

- **Multi-property organizations.** The schema already supports it; the surfaces
  assume one property per operator.
- **Automated payouts**, after manual settlement has been boring for a quarter.
- **Channel-manager or PMS integration** for arrivals, replacing manual stay
  entry. The integration surface already exists.
- **Guest messaging**, narrowly: a pre-arrival portal link and a booking
  confirmation. Owner-approved templates, never free-form generation.
- **Partner self-onboarding** with document upload, so verification scales past
  one admin.
- **Per-action autonomy**, earned individually. A capacity adjustment within
  agreed bounds is a plausible first candidate; anything guest-facing is not.

### Platform

- Observability: structured logging, traces on the checkout and itinerary paths.
- Backups and a tested restore. Untested backups are a story, not a safeguard.
- A second destination, to prove the destination graph is genuinely general.

### Second destination

Lombok, Ericeira or Chamonix — chosen because each stresses something Puerto
Escondido does not:

| Destination | What it would test |
| --- | --- |
| **Ericeira** | A European regulatory and payments environment; a shorter season |
| **Lombok** | Multi-island travel times; boat logistics as a first-class constraint |
| **Chamonix** | Avalanche risk, which is a harder safety model than surf — qualified-guide requirements and conditions that close terrain outright |

Chamonix is the most useful stress test and the one to resist longest. Alpine
risk deserves a proper model, not a renamed surf gate.

---

## Explicitly not planned

- Native iOS and Android apps. See ADR-012.
- A consumer marketplace. The hotel relationship is the product.
- Room booking. ARC Stay is not an OTA.
- Dynamic pricing. The pilot needs prices an owner can explain to a partner.
- A general travel agent. The product's value is that it is narrow and
  verifiable.

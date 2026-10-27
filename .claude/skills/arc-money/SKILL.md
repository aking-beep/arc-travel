---
name: arc-money
description: The money rules in ARC Stay — integer minor units, the commission split, the ledger, and the separation of earned revenue from potential value. Use when touching pricing, commission, checkout, payouts, the ledger, or any surface that renders a figure.
---

# Money in ARC Stay

Four rules. The first three are mechanical; the fourth is a product commitment
and the one most likely to be broken by accident.

## 1. Integer minor units, everywhere

No floats. No `Decimal`. A peso amount becomes centavos **exactly once**, at
the form edge, through `pesosToMinor`. Everything inward of that is an integer
and a currency code.

`src/lib/money.ts` is the only arithmetic: `add`, `subtract`, `sum`,
`multiply`, `applyBps`, `splitByBps`. If you find yourself computing money in
`src/app`, it belongs in a module.

`formatMoney` is for display and is the only place a figure becomes a string.

## 2. The split

`splitByBps` divides an order between the hotel, the platform and the supplier.
**The remainder goes to the supplier**, deliberately: the ledger must balance,
and the centavo belongs with whoever did the work. Do not "fix" this to round
half-up.

An organization carries a platform commission default *as well as* a hotel one
(ADR-030). The platform share used to fall back to zero, so ARC earned nothing
unless somebody wrote a rule.

A direct booking (ADR-042) still pays the hotel its commission: the listing,
the price and the agreement are the hotel's. A different share is a commission
rule somebody writes, not a code change.

## 3. The ledger balances, or nothing moves

- Checkout and its ledger entries share **one transaction**. So do an approval
  and its execution.
- The three-way split sums to the order total. `money.order_split_unreconciled`
  watches for it, and when it fires, **somebody is owed the difference** — find
  which of the four numbers is wrong rather than adjusting the split to match.
- A payout equals the sum of its lines, enforced by a deferred constraint
  trigger. An unbalanced one is not paid.
- `PayoutLine.ledgerEntryId` is unique, so a ledger entry cannot appear on two
  payouts.
- The seed writes earnings entries for refunded orders too, because it mirrors
  checkout-then-refund exactly. Writing only the refund left the ledger short
  by the order total — a real bug, now regression-tested. Do not simplify it.
- `/owner/payouts` is a **statement, not a transfer**. No money moves
  (`docs/going-live.md` §7). Do not write copy implying it does.

## 4. Earned revenue and potential value are never summed, and never adjacent

ADR-007. Two different numbers about two different futures. A figure a hotel
has earned and a figure it might earn must not appear in the same total, and
must not sit next to each other where a glance reads them as one.

The consequence shows up in unexpected places: the revenue headline excludes
direct bookings from the **numerator as well as the denominator** (ADR-042),
because otherwise a good month of direct business reads as the hotel's own
guests spending more.

## Rendering a figure

- Every money figure goes through `<Money>` with its `intent`:
  `earned` | `potential` | `neutral`. The intent is not decoration — it is how
  the surface states which of the two kinds of number this is.
- `<Money>` formats from minor units and does **not** carry the demo marker.
  The marker is three separate things: `DemoBanner` on every surface,
  `DemoFigure` around every *headline* figure, and **nothing** around a figure
  inside a table — thirty badges down a column stop being read.
- A partner-facing query must not `select` the hotel's earnings. Not hidden in
  the UI: not selected.

## Tests

Money belongs in `tests/unit`: rounding where an amount divides unevenly, zero,
one, the boundary. Anything that must hold across a transaction — the ledger
reconciling, a payout's lines — belongs in `tests/integration` against real
Postgres.

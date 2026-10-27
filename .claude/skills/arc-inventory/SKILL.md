---
name: arc-inventory
description: The transaction rules around holds, capacity and checkout in ARC Stay, the two bugs that produced them, and the known lost-race problem and its intended fix. Use before touching src/modules/inventory, anything that mutates booked or held, or checkout.
---

# Holds, capacity and transactions

This is the most load-bearing file in the project. `CLAUDE.md` asks for an
independent review before a change here lands, and it means it.

## The rules

Anything touching `booked` or `held` goes through `inSerializableTransaction`.
Anything that must be all-or-nothing — an approval and its execution, checkout
and its ledger — shares **one** transaction. Pass `tx` to `recordAudit` so an
action and its audit record cannot diverge.

### Read inside the transaction what you will write on

`inSerializableTransaction` retries a serialization failure by **re-running the
whole function**. A body whose guard was read outside it therefore applies
twice. Two real bugs came from exactly this:

- a concurrent cancellation double-decremented `booked` and wrote a second
  refund;
- checkout committed a stale line quantity while consuming the live hold
  quantity.

Re-read and re-assert inside. This is the single most important sentence in the
skill.

### A `fetch` never goes inside the block

ADR-040. A `fetch` inside a Serializable block holds it open, and the body
re-runs on a retry — which is how one cancellation sends two emails. A message
is **written** inside the caller's transaction and **sent** after it commits.

### `isSerializationFailure` matches four shapes, on purpose

Prisma raises `P2034` only when Prisma itself detects the failure. Under the
`PrismaPg` adapter the same failure arrives as a `DriverAdapterError` carrying
the SQLSTATE in its cause and **no code at all**. Matching `P2034` alone once
stopped the retry loop and turned a race into a 500. Do not narrow it.

### `returnCapacity` throws rather than clamping

ADR-020. The clamp kept the counter non-negative while hiding the double
cancellation that caused it. A negative counter is a bug to find, not a number
to correct.

### Other things here that look wrong and are not

- Holds are taken at add-to-basket (ADR-014).
- `addToCart` re-runs the safety gate (ADR-019): the itinerary was not the only
  route to a booking, so gating only the recommendation left the commitment
  open.
- `checkout()` takes a payment it did not confirm (ADR-026). Confirming and
  then booking has a window that can only be closed with an automatic refund,
  which would need an `Approval` row.
- CHECK constraints live in `prisma/constraints.sql`, not the schema (ADR-020),
  and are duplicated inside a migration (ADR-034).

## The known problem, and the fix nobody has made yet

Every mutation in `src/modules/inventory/service.ts` reads a departure's
counters and then increments them, inside a Serializable transaction. That is
the pattern Postgres is strictest about: when several guests commit to the same
departure in the same moment, it cancels all but one and the rest are refused —
correctly, but **refused with places still free**. Measured: six simultaneous
guests, a departure with six seats, none sold.

Nothing oversells and no figure is wrong; people are simply told to try again.
It does not bite a boutique hotel's traffic. It will bite a popular departure
the moment one is promoted.

The intended fix is to **stop reading what you increment** — a conditional
`UPDATE … WHERE booked + held + n <= capacity`, which cannot race because the
condition is evaluated on the row itself.

Before attempting it: `docs/going-live.md` §7 says do it before the first
promotion, not before the first guest, and `CLAUDE.md` requires an independent
review. Run `architecture-reviewer` **and** `data-reviewer`, and write the
concurrency test first.

## Testing a change here

`tests/integration`, against real Postgres. A mocked client passes every
concurrency test while the product oversells.

Assert the **invariant** — `booked + held <= capacity` — not a count. Test the
race, not only the happy path. The suite already has a six-browser oversell
race to model it on.

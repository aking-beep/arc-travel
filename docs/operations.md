# Operations

What someone on call needs. `docs/deployment.md` covers putting the POC on a
URL; this covers keeping it there, and getting it back when it is not.

Scope note: this build is a proof of concept running in demo mode. Several
procedures below are written for the pilot it is meant to become, and say so.
Nothing here claims a guarantee the build does not have.

---

## What runs on a schedule

| Job | Route | Schedule | Why |
| --- | --- | --- | --- |
| Hold sweep | `POST /api/cron/sweep-holds` | every 15 min | Releases abandoned inventory holds |

`vercel.json` holds the schedule. The job is authorised by `CRON_SECRET` in the
`Authorization` header, compared in constant time; with the variable unset the
route **404s** rather than running unauthenticated. Treating an unset secret as
"no authorisation required" is how an internal endpoint becomes a public one on
the one deployment where somebody forgot a variable.

### Why a scheduled sweep exists at all

Holds already expire lazily: every read path that touches a slot sweeps it
first, because an expiry that only happens when a cron job runs is an expiry
that does not happen. That is correct, and incomplete. A guest who abandons a
basket on a departure nobody opens again leaves `held` standing for ever, and
`placeHold` then refuses places that are free. The scheduled sweep is for
exactly those.

It is safe to run by hand, at any time, as often as you like — it is idempotent
and only touches holds already past their TTL:

```bash
curl -fsS -X POST https://<host>/api/cron/sweep-holds \
  -H "Authorization: Bearer $CRON_SECRET"
# {"swept":0,"batches":1}
```

One invocation releases at most 2 000 holds (ten batches of 200). A neglected
database converges over several runs rather than holding locks across every row
in one Serializable transaction.

**If `swept` is persistently large,** something upstream is abandoning baskets —
check whether a client is adding to a cart and never checking out, rather than
treating the sweep as the fix.

---

## Error reporting

Set `SENTRY_DSN` and faults are reported there; leave it unset and they go to
stderr. Nothing else changes between the two, deliberately.

What counts as a fault is decided from the error taxonomy, not a second
severity scheme (`src/lib/observability.ts`):

- **A 4xx `AppError` is not an incident.** `CAPACITY_UNAVAILABLE`,
  `HOLD_EXPIRED`, `VALIDATION_FAILED`, `RATE_LIMITED`, `PAYMENT_NOT_COMPLETED`
  are the system working. They are logged as `[expected]` and never reported.
  Paging on them trains whoever is on call to ignore the channel.
- **Everything else is.** A 5xx `AppError` (`INTERNAL`,
  `PAYMENT_UNAVAILABLE`), and anything that is not an `AppError` at all — a
  `ZodError` that escaped a service, a Prisma error, a `TypeError`. `toFormState`
  re-throws those rather than swallowing them into a form message, and
  `src/instrumentation.ts` is where they surface.

Reports carry the route **path** as Next matched it, never the URL: a URL
carries a portal token in `/g/[token]`, which is a bearer credential. Extra
fields are field *names* rather than values, the same rule `recordAudit`
follows. An error report is a copy of your database in somebody else's SaaS.

No tracing, no automatic breadcrumbs, no client-side reporting — reporting is
one HTTP POST to the envelope endpoint rather than an SDK that instruments the
runtime. If a pilot needs performance tracing, that is when to take the
dependency.

### What to look at first

| Symptom | Look at |
| --- | --- |
| Checkouts failing | `commerce.checkout.payment_mismatch` audit rows; `PAYMENT_UNAVAILABLE` faults |
| "That departure filled up" on an empty boat | `AvailabilitySlot.booked` vs. `OrderItem` rows; run the sweep |
| An order stuck `PENDING` | There should be none — `checkout()` only writes an order once its payment succeeded (ADR-026) |
| An order `FAILED` | A payment that stopped standing. `commerce.payment.failed` audit row names the provider event |
| An order `CONFIRMED` with `reversalReportedAt` set | A refund or chargeback at Stripe, awaiting a decision on `/owner/approvals` (ADR-033). Excluded from payouts meanwhile |
| A partner says they have not been paid | `/owner/payouts` — is it computed, approved, or waiting on a confirmation? The page itemises what is held back and why |
| Guests cannot open their portal | `Stay.portalExpiresOn` and `PORTAL_GRACE_DAYS`; the token expires |

---

## Paying partners

ARC works out what each partner is owed and keeps the record. **It does not send
any money.** Automating that means every supplier is a connected account at a
payment provider, with KYC done before they can be paid at all — a commercial
process, not a deployment step. See ADR-032.

The loop, on `/owner/payouts`:

1. **Compute a run** for a period. Each partner with a positive balance gets a
   `Payout` and an approval; a partner whose refunds exceed their sales gets
   neither, and that balance carries into the next run rather than being
   written off.
2. **Approve it** on `/owner/approvals`. This is the `Approval` row
   non-negotiable 6 requires. Nothing is payable without it, and `settlePayout`
   reads the proposal's approval rather than the payout's own status — so
   advancing the status by any other route still cannot pay.
3. **Pay it**, by transfer or in cash.
4. **Record it**, with the method and the bank's reference, on the payout page.

### What is held back, and why

A ledger entry is not paid while any of these is true:

| Held because | What to do |
| --- | --- |
| The partner has not confirmed the booking | Chase them on `/partner/bookings`; it clears itself |
| The order's payment was reported refunded or disputed | Decide the reversal on `/owner/approvals` (ADR-033) |
| The order is cancelled, failed or refunded | Nothing. Its reversal entry nets it off |

The owner page itemises these rather than summarising them. "We owe you 40,000
and are paying 31,000" needs the other 9,000 accounted for, or the partner
assumes it has been lost.

### If a payout looks wrong

- **It does not add up.** The payout page says so in red and tells you not to
  pay it. A deferred constraint trigger should make this impossible; if you see
  it, it is a bug, not a rounding quirk.
- **A partner says they were paid twice.** They were not paid twice by ARC: a
  ledger entry can be claimed by exactly one payout, enforced by a unique
  index. Check for two transfers against one `settlementReference`.
- **A partner was overpaid before a cancellation.** Expected, and handled: the
  cancellation writes a negative entry on their account and the next run nets
  it off. The remittance advice shows it as a negative line.
- **The wrong period.** Cancel the payout. Its entries are released and the
  next run picks them up. A `SETTLED` payout cannot be cancelled — releasing
  entries that were genuinely paid would make the next run pay them again.

---

## A refund or chargeback raised at Stripe

The webhook acts on these (`charge.refunded`, `charge.dispute.created`,
`charge.dispute.funds_withdrawn`) and **cancels nothing**. It stamps the order
and puts a decision on `/owner/approvals`. See ADR-033.

What that means on call:

- The guest still has their booking and the partner still has the slot
  committed. That is deliberate: a refund can be a goodwill gesture the hotel
  meant to honour the booking through, and a dispute can be resolved in ARC's
  favour.
- The order is excluded from a supplier payout from the moment the report
  arrives, so ARC cannot pay a partner out of money that has gone back.
- **Approving** cancels the live lines, puts the places back on sale and
  reverses the earnings. No refund is sent — the money already went back at
  Stripe, and sending another would send it twice.
- **Rejecting** keeps the bookings. The report stays on the order, so it stays
  out of payouts until somebody resolves it — a dispute you won, settled your
  way, is worth clearing by hand.
- A second event on the same order updates the amount and leaves the one open
  decision alone. `charge.dispute.closed` is ignored, because it can close
  either way.

Find an order from a Stripe dashboard reference with
`select reference, status, "reversalCause", "reversedMinor" from "Order" where
"paymentReference" = 'pi_…';`

---

## Database backup and restore

### What must be backed up

Everything is in one PostgreSQL database. There is no object storage, no
second datastore, no queue with state in it. A dump of the database is a
complete backup of the system.

Two things are **not** in the dump and are needed to make a restore usable:

1. The environment variables (`docs/deployment.md` lists them), `AUTH_SECRET`
   and `ANALYTICS_SALT` above all.
   `AUTH_SECRET` signs sessions and derives rate-limit subjects;
   `ANALYTICS_SALT` derives analytics pseudonyms. Restoring a database with a
   *different* `ANALYTICS_SALT` does not break anything, but every historical
   `AnalyticsEvent.subjectKey` becomes unjoinable to anything written after —
   so the salt is part of the backup, kept where the database dump is not.
2. `prisma/constraints.sql`. A `pg_restore` of a dump taken with
   `--schema-only` from a database whose constraints had never been applied
   produces a schema with `booked + held <= capacity` enforced only by
   application code (ADR-020). The restore below re-applies them and then
   *proves* the invariant, rather than assuming the dump carried it.

### Taking a backup

A managed Postgres (Neon, Supabase, RDS) has point-in-time recovery; use it,
and know your retention window. The explicit dump below is for a copy you hold
yourself — before a schema change, before a demo, or to move data between
environments.

```bash
# Everything, in the custom format so it can be restored selectively.
pg_dump --format=custom --no-owner --no-privileges \
  --file="arc-stay-$(date -u +%Y%m%dT%H%M%SZ).dump" "$DATABASE_URL"
```

`--no-owner --no-privileges` because the role names differ between a managed
host and a local restore, and a dump that insists on its original owner is a
dump you cannot restore in a hurry.

A dump contains **guest names, email addresses, phone numbers, dietary and
medical notes, and live portal tokens**. A portal token is a bearer credential:
anyone holding the dump can open any guest's portal until it expires. Treat the
file as you would a password database — encrypt it at rest, do not put it in
the repository, in a ticket, or in a chat message.

### Restoring

```bash
# 1. An empty target. Never restore over a live database.
createdb arc_stay_restored

# 2. The data.
pg_restore --dbname="$RESTORE_URL" --no-owner --no-privileges \
  --single-transaction arc-stay-20261024T120000Z.dump

# 3. The constraints Prisma cannot express (ADR-020). NOT optional.
#    Every statement in constraints.sql is `IF EXISTS`-guarded, so this is safe
#    to run against a dump that already carried them.
DATABASE_URL="$RESTORE_URL" npm run db:constraints

# 3b. Confirm the restored schema is the one the code expects. A dump from an
#     older deployment can be a migration or two behind; this says so rather
#     than leaving it to be discovered by a query at runtime.
DATABASE_URL="$RESTORE_URL" npm run db:migrate:status

# 4. Prove the invariant the whole inventory model rests on.
psql "$RESTORE_URL" -c \
  'SELECT count(*) AS oversold FROM "AvailabilitySlot" WHERE booked + held > capacity;'
# oversold must be 0.

# 5. Release anything held at the moment of the dump.
DATABASE_URL="$RESTORE_URL" npx tsx -e \
  'import("./src/modules/inventory/service").then(m => m.sweepExpiredHolds()).then(n => console.log("swept", n))'
```

Step 5 matters because a hold is a 15-minute promise and a restore is not
instantaneous. Holds in the dump are promises about a time that has passed;
leaving them standing means capacity nobody can book.

Then point the app at the restored database and check `/admin/health`.

### What a restore does not restore

- **In-flight payments.** For a live provider, an order's truth is at the
  payment provider, not in the dump. After a restore, reconcile: any Stripe
  payment intent `succeeded` without a corresponding `Order` row is a guest who
  paid for a booking that no longer exists, and that is a refund decision for a
  person to make — not something to automate (non-negotiable 6).
- **Rate-limit counters.** `RateLimitCounter` rows in the dump describe windows
  that have passed. Harmless; they prune themselves.
- **Idempotency keys.** Restoring these is *desirable*: a guest retrying a
  checkout whose key is gone would create a second order.

### Testing the restore

A backup nobody has restored is a hypothesis. So the whole sequence above is a
script, and running it is one command:

```bash
npm run restore-drill          # against DATABASE_URL; drops its scratch database after
DRILL_KEEP=1 npm run restore-drill    # keep the scratch database to poke at
```

It takes a dump, restores it into a scratch database, re-applies the
constraints, checks the migration state, proves the capacity invariant and the
ledger, sweeps stale holds, and then reads the restored data through the real
module code. Eleven checks, one line each, non-zero exit on the first failure.
It never writes to `DATABASE_URL`.

**Run it before a release**, and after any change to the schema, the constraints
or the seed. Three minutes.

#### Rehearsal record

| Date | Result | Notes |
| --- | --- | --- |
| 2026-10-26 | 11/11 pass | First end-to-end rehearsal. Found four things, all now fixed: see below |

What the first rehearsal found, recorded because "the steps are written down"
and "the steps work" turned out to be different claims in four separate places:

1. **The commands could not be pasted as written.** `DATABASE_URL` carries
   Prisma's `?schema=public`, and every `pg_*` tool rejects it —
   `psql: error: invalid URI query parameter: "schema"`. The drill strips the
   query string; a person doing this by hand at three in the morning would not
   have known to.
2. **`TEST_DATABASE_URL="$RESTORE_URL" npm run test:integration` was the wrong
   advice.** It was right when the harness used `db push`. Since the harness
   started building its schema from the migrations (ADR-034) it drops the public
   schema first, so pointed at a restore it destroys the thing it is checking
   and then proves the migrations work — which was never the question. Replaced
   by `scripts/restore-smoke.ts`, which reads the restored rows through the
   module code and tries to violate the capacity constraint to confirm the
   restore carried it.
3. **`prisma/seed.ts` and `prisma/ensure-seed.ts` each built their own
   `PrismaClient`.** Harmless until Prisma 7, which requires a driver adapter;
   both then failed at startup, which would have taken the hosted build down on
   its first deploy. Both now use the one client in `src/lib/db.ts`.
4. **Baselining a `db push` database could record a false claim.**
   `migrate diff` compares what Prisma can express, and the entire point of
   `prisma/constraints.sql` is that Prisma cannot express it (ADR-020). A
   database could pass the diff with none of the CHECK constraints present and
   be marked as having had the constraints migration applied. `docs/deployment.md`
   now says to apply them first and count them.

---

## What this build does not have

Said plainly, because an operations document that implies otherwise is worse
than none:

- **No rollback migrations.** There is a migration history now
  (`migrate deploy`, see `docs/deployment.md`), but every migration is
  forward-only. Undoing one means writing the inverse by hand, and a migration
  that drops a column cannot be undone at all once the column is gone. Take a
  backup before deploying a migration that drops or narrows anything.
- **No alerting rules.** Faults reach Sentry; nothing pages anyone. Who gets
  woken, and for what, is a pilot decision.
- **No uptime monitoring** beyond `/admin/health`, which requires a signed-in
  platform admin and so cannot be polled by a checker.
- **No log retention policy.** Logs go wherever the host puts them.
- **No restore drill on a schedule.** `npm run restore-drill` exists and has
  been run; nothing runs it for you. Putting it in CI needs a scratch database
  CI can create, which is a pilot decision.
- **No automated supplier payment.** ARC computes what each partner is owed,
  takes an owner's approval and records the transfer reference; it does not move
  the money. See "Paying partners" below, and ADR-032.

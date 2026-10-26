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
| Invariant check | `POST /api/cron/check-invariants` | hourly, at :17 | Watches for the things that go wrong without throwing |

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

## Monitoring

Three separate things, because they fail separately.

### Is it up?

`GET /api/health` — unauthenticated, and therefore it says almost nothing:

```json
{ "status": "ok", "time": "2026-10-26T01:00:00.000Z" }
```

`status` is `degraded` and the response is **503** when the database does not
answer. Point an uptime checker at it and alert on a non-200.

`/admin/health` is the rich page and requires a signed-in platform admin, which
is why it cannot be polled and why this exists. With `MONITORING_TOKEN` set and
presented as a bearer token, `/api/health` also returns the data mode, the
payment and AI providers, whether outbound messaging is enabled, and whether the
demo's front door is locked. Nothing else: an unauthenticated endpoint is
reconnaissance for whoever finds it, and an authenticated one is still a log
entry somewhere.

```bash
curl -fsS https://<host>/api/health
curl -fsS https://<host>/api/health -H "Authorization: Bearer $MONITORING_TOKEN"
```

### Did a request fail?

See "Error reporting" below. That is the whole of it, and it only sees failures
loud enough to produce an exception.

### Is the data still true?

`POST /api/cron/check-invariants`, hourly. This is the part that did not exist,
and it watches the failures nobody would otherwise notice.

```bash
curl -fsS -X POST https://<host>/api/cron/check-invariants \
  -H "Authorization: Bearer $CRON_SECRET"
# {"healthy":true,"checksRun":9,"findings":[]}
```

Read-only, so it is safe to run by hand at any time. It returns **200 even when
it finds something** — the check ran and worked; the database is what is
unhealthy. A 500 means the monitoring itself broke, which is a different
problem and alerts differently.

Every finding is logged, and a `critical` one is additionally reported as a
fault, so it reaches whatever is already watching faults rather than needing a
second integration nobody has set up. Warnings stay in the log: they are a queue
to work through, and paging on a queue trains whoever is on call to ignore the
channel.

#### What it checks, and what to do

| Key | Severity | Means | Do |
| --- | --- | --- | --- |
| `inventory.oversold` | critical | `booked + held > capacity` | A CHECK constraint makes this unreachable through the app. Either something wrote to the database directly, or this database is missing its constraints — `npm run db:constraints`. Stop selling that slot |
| `inventory.negative_counter` | critical | A counter below zero | Capacity returned more times than taken. `returnCapacity` throws rather than clamping (ADR-020) precisely so this shows. **Find the double cancellation before correcting the number** |
| `money.order_split_unreconciled` | critical | A confirmed order's split ≠ its total | Somebody is owed the difference. Do not adjust the split to match — find which of the four numbers is wrong |
| `money.payout_unbalanced` | critical | A payout ≠ the sum of its lines | **Do not pay it.** A deferred constraint trigger enforces this, so its absence means a direct write or a restore without constraints |
| `money.entry_claimed_twice` | critical | A ledger entry on two payouts | A partner may be paid twice. `PayoutLine.ledgerEntryId` is unique, so this requires that index to be missing |
| `money.orphaned_ledger_entry` | warning | An entry points at a missing order | Most likely a partial restore. The ledger no longer reconstructs from the orders |
| `commerce.order_pending` | warning | An order stuck `PENDING` | There should be none: checkout writes an order only after its payment succeeded (ADR-026). Each is capacity held against an unaccountable payment |
| `commerce.reversal_undecided` | warning | A refund or chargeback reported over a day ago with no decision | Work `/owner/approvals`. The money has gone back; the guest may still hold the seat (ADR-033) |
| `partners.verification_lapsed` | warning | A verified partner's insurance expired | Get the renewal — `docs/supplier-verification.md`. Guests already stopped seeing a verified badge |

Findings carry **ids only**, never guest names, emails or notes, and a test
asserts it. These go into a log and possibly into Sentry, and an error report is
a copy of your database in somebody else's SaaS.

### Alerting rules

Four rules. More than that and nobody reads any of them.

| Alert | Condition | Urgency |
| --- | --- | --- |
| **Down** | `/api/health` non-200 for 3 consecutive checks at 1 min | Wake someone |
| **Invariant violated** | A fault whose message starts `Invariant violation:` | Wake someone |
| **Fault rate** | More than 10 reported faults in 15 min | Working hours |
| **Scheduled job silent** | No `[sweep-holds]` line in 45 min, or no `[check-invariants]` line in 2 h | Working hours |

The last one matters more than it looks. A cron that silently stops running
produces no errors at all, so every other alert here keeps saying everything is
fine while holds accumulate and nothing checks the data.

**Deliberately not alerts:** 4xx `AppError`s (the system working), a guest
failing to pay, `swept` being large on one run, a lapsed verification.

### Load

`node scripts/load-test.mjs` — read-only, so it is safe to point at anything
you are allowed to generate traffic against. 24 concurrent clients for 15
seconds over the public and guest read paths, reporting p50/p95/p99 per route.

`npm run load-test` is the same thing. It needs a server already running, and
**stop that server before running the acceptance suite**: Playwright no longer
reuses one, so a server you left on the port now fails the run immediately
rather than serving pages that reference asset chunks a later build replaced.

```
path                  n     p50     p95     p99     max   errors
/                    168     702    1243    1344    1387        0
/experiences         168     581     671     724     736        0
/stays               168     394     513     530     545        0
/sign-in             160     386     518     545     564        0
/api/health          145      74     425     536     541        0
876 requests, 58/s, 0 failed
```

Those numbers are from a single sandbox container that was also running
Postgres, so read them as "nothing fell over and nothing errored", not as a
capacity figure for Vercel. The useful part is the zero in the last column and
the shape of the tail.

It does **not** test writes, deliberately: an HTTP client cannot drive a Next
server action, and a hand-crafted POST that silently 404s would report a
passing oversell race. That question is answered where it can actually be
driven — `tests/integration/inventory.test.ts` races `placeHold` at the service
level, and `tests/e2e/11-concurrency.spec.ts` races six real browsers at one
departure through the real UI and then asserts `booked + held <= capacity`. The
second one is the one that would catch a transaction-mode pooler, which breaks
interactive transactions while passing every integration test.

### Accessibility

WCAG 2.1 AA, checked on every acceptance run across nine surfaces. See
`docs/accessibility.md`, including what an automated check cannot tell you —
which is most of it.

### Service levels, for a pilot

Not commitments this build makes — it runs in demo mode on a hobby plan. Written
down because a pilot conversation will ask, and these are the numbers the
architecture can defend:

| | Target | Why that one |
| --- | --- | --- |
| Availability | 99.5% monthly, business hours | ~3.6 h a month. A hotel's own PMS does not do better, and ARC is not life-safety |
| Checkout success | > 99% of attempts with a confirmed payment produce an order | ADR-026 closed the window where a payment could succeed without one. A miss here is money taken for nothing |
| Invariant findings | Zero `critical`, always | Not a percentage. One oversold slot is one guest standing on a beach |
| Hold release | < 20 min after TTL | TTL is 15 min, the sweep runs every 15 |
| Payout accuracy | 100%, and provable | The ledger is the record. "Roughly right" is not a target a partner can accept |
| Restore | Within 4 h, losing < 1 h | What `npm run restore-drill` actually takes, plus the time to notice |

Availability is business hours because the guest surfaces are used in Puerto
Escondido's daytime and the owner surfaces in its morning. A 3am outage costs a
pilot nothing and pretending otherwise would mean staffing a rota for it.

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
- **Nothing actually wired to a pager.** The rules are written above and the
  signals exist — `/api/health` is pollable and a critical invariant finding is
  reported as a fault. What is missing is a monitoring service configured to
  watch them and a person on a rota, both of which are pilot decisions and
  neither of which is in this repository.
- **No log retention policy.** Logs go wherever the host puts them.
- **No restore drill on a schedule.** `npm run restore-drill` exists and has
  been run; nothing runs it for you. Putting it in CI needs a scratch database
  CI can create, which is a pilot decision.
- **No automated supplier payment.** ARC computes what each partner is owed,
  takes an owner's approval and records the transfer reference; it does not move
  the money. See "Paying partners" below, and ADR-032.

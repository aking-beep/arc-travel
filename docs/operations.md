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
| Guests cannot open their portal | `Stay.portalExpiresOn` and `PORTAL_GRACE_DAYS`; the token expires |

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
   `--schema-only` from a database where `npm run db:constraints` had not run
   produces a schema with `booked + held <= capacity` enforced only by
   application code (ADR-020). Always re-run it after a restore and before
   taking traffic.

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
DATABASE_URL="$RESTORE_URL" npm run db:constraints

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

A backup nobody has restored is a hypothesis. Restore into a scratch database
and run the integration suite against it at least once per release:

```bash
TEST_DATABASE_URL="$RESTORE_URL" npm run test:integration
```

The suite truncates tenant tables, so **never** point it at anything you want
to keep.

---

## What this build does not have

Said plainly, because an operations document that implies otherwise is worse
than none:

- **No migrations.** `prisma db push`, no migration history (see
  `docs/deployment.md`). A pilot with a real hotel's data needs
  `prisma migrate` before it has data worth keeping.
- **No alerting rules.** Faults reach Sentry; nothing pages anyone. Who gets
  woken, and for what, is a pilot decision.
- **No uptime monitoring** beyond `/admin/health`, which requires a signed-in
  platform admin and so cannot be polled by a checker.
- **No log retention policy.** Logs go wherever the host puts them.
- **No restore drill on a schedule.** See above; it is a manual step.
- **No handling of a refund or a dispute raised at the provider.** The Stripe
  webhook acts on `payment_intent.payment_failed` and
  `payment_intent.canceled`, which covers a payment that stops standing after
  ARC booked against it — a delayed-notification method that fails late. It
  deliberately ignores `charge.refunded` and `charge.dispute.*`. Reversing a
  confirmed booking is a consequential action and needs an `Approval` row
  naming who decided (non-negotiable 6), so the alternative to ignoring those
  events is ARC cancelling a guest's booking on its own, which this build does
  not do. Until there is an approval queue for it, a refund or chargeback
  raised at Stripe is reconciled by hand: find the order by its
  `paymentReference`, and cancel through `/owner` so the audit trail names the
  person who decided.

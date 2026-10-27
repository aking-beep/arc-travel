---
name: arc-ops-triage
description: Read-only triage of a running ARC Stay deployment — health, the nine invariants, the three cron routes, the email queue, and the restore drill. Use when a deployment looks wrong, when a scheduled check fires, or before telling anyone the system is fine.
---

# Triaging a running ARC Stay deployment

**This is a read-only procedure.** Diagnose, report, and if there is a fix, the
fix is a code change that goes through `arc-ship-change`. Do not correct
production data, do not change a deployment's environment, and do not restart
anything. `docs/operations.md` is the long form of what follows.

## 1. Is it up

```bash
curl -fsS https://<host>/api/health
```

`{"status":"ok"}` and a 200, or `degraded` and a **503** when the database does
not answer. It says almost nothing on purpose: an unauthenticated endpoint is
reconnaissance for whoever finds it (ADR-037).

```bash
curl -fsS https://<host>/api/health -H "Authorization: Bearer $MONITORING_TOKEN"
```

With the token it also returns the data mode, the payment and AI providers,
whether outbound messaging is on, and whether the demo's front door is locked.
Check those read the way the deployment is meant to be configured —
`docs/going-live.md` §1 has the table. `/admin/health` is the rich page and
needs a signed-in platform admin, which is why it cannot be polled.

## 2. The invariants

```bash
curl -fsS -X POST https://<host>/api/cron/check-invariants \
  -H "Authorization: Bearer $CRON_SECRET"
```

It returns **200 even when it finds a violation** (ADR-037): the check ran and
worked, the database is what is unhealthy. A 500 would re-alert every few
minutes and hide a genuine monitoring failure. So read the body, not the
status.

Nine checks. What each one means, and what not to do about it:

| Key | Severity | Read it as |
| --- | --- | --- |
| `inventory.oversold` | critical | A CHECK constraint makes this unreachable through the app. Either something wrote to the database directly, or **this database is missing its constraints** — `npm run db:constraints` (ADR-020). |
| `inventory.negative_counter` | critical | Capacity was returned more times than it was taken. **Find the double cancellation before correcting the number** — `returnCapacity` throws rather than clamping precisely so this stays visible. |
| `money.order_split_unreconciled` | critical | Somebody is owed the difference. **Do not adjust the split to match.** Find which of the four numbers is wrong. |
| `money.payout_unbalanced` | critical | **Do not pay it.** A deferred constraint trigger enforces this, so its absence means a direct write or a restore without the constraints. |
| `money.entry_claimed_twice` | critical | A partner may be paid twice. `PayoutLine.ledgerEntryId` is unique, so this needs that index to be missing. |
| `money.orphaned_ledger_entry` | warning | Usually a partial restore. The ledger no longer reconstructs from the orders. |
| `commerce.order_pending` | warning | There should be none — checkout writes an order only after its payment succeeded (ADR-026). Each is capacity held against a payment nobody can account for. |
| `commerce.reversal_undecided` | warning | The money has gone back at the provider; the guest may still hold the seat. It waits on a person at `/owner/approvals` (ADR-033). |
| `partners.verification_lapsed` | warning | An insurance certificate on file has expired. Guests already stopped seeing the badge, by design (ADR-036). **Chase the renewal; never re-verify to clear the warning.** |

Three of the criticals point at missing constraints rather than at application
bugs. If more than one fires at once, check that first:
`prisma/constraints.sql` is re-runnable for exactly this reason.

## 3. The holds sweep

```bash
curl -fsS -X POST https://<host>/api/cron/sweep-holds \
  -H "Authorization: Bearer $CRON_SECRET"
# {"swept":0,"batches":1}
```

Idempotent, safe at any time, and only touches holds already past their TTL.
One invocation releases at most 2 000.

Holds also expire lazily on every read path that touches a slot, because an
expiry that only happens when a cron runs is an expiry that does not happen.
The scheduled sweep is for a departure nobody opens again.

**If `swept` is persistently large, something upstream is abandoning baskets.**
Find the client that adds to a cart and never checks out. The sweep is not the
fix.

## 4. The email queue

`dispatch-email` runs every five minutes. `MAIL_PROVIDER=log` records a
complete message, link included, rather than sending, and `LOGGED` is
deliberately not `SENT` (ADR-040) — a hotel reads the real words at
`/owner/messages` before any of them reach a guest.

Worth looking at: rows stuck `QUEUED`, and rows that reached `FAILED` (a worker
that died on its last attempt used to sit `QUEUED` for ever; it is reaped now).
A `QUEUED` backlog on a deployment where `ARC_ENABLE_TRANSACTIONAL_EMAIL` is
false is **not** a fault — that is the switch doing its job.

## 5. A route that 404s

Every cron route **404s when `CRON_SECRET` is unset**, rather than running
unauthenticated. So a 404 from `/api/cron/*` is almost always a missing
variable on that deployment, and it means holds are not being swept and the
invariants are not being checked. Report it; setting it is Andrew's.

## 6. Restores

```bash
npm run restore-drill
```

Neon takes backups; the open question is whether a restore brings the
constraints with it. **A schema-only dump does not**, which is why
`prisma/constraints.sql` exists as a file you can re-run. Nobody has yet
restored one into an empty project and checked (`docs/going-live.md` §7) — if
you are asked whether backups work, that is the honest answer.

## What to report

One short paragraph: what is wrong, what it means, and what it is waiting on.
If everything reads as expected, say that in one line — an agent that posts a
full report every morning stops being read. Never report a check you did not
run, and never call a warning resolved because it is old.

---
name: arc-demo-reset
description: Refresh the ARC Stay sales demo when its seeded horizon runs out — the seed is relative to the day it ran, so availability and conditions decay. Use when the demo shows no departures, no conditions, or an empty planner. Demo only; never near production.
---

# Refreshing the demo

## Why the demo decays

`prisma/seed.ts` builds everything relative to the day it runs:
`AVAILABILITY_DAYS = 21` and `CONDITION_DAYS = 7` from `TODAY`.

So roughly **three weeks after the last seed** there are no dated departures
left, and after **one week** the conditions readings stop covering today. The
symptoms are a planner that finds nothing, a catalog where everything is
missing a departure, and a gate falling back to a place's baseline.

`npm run db:ensure-seed` runs in the hosted build but **only seeds an empty
database** — that is deliberate, so a redeploy does not wipe whatever the
person showing the demo had just built up. Which also means a redeploy does
**not** refresh the horizon.

The seeded data is deterministic and idempotent, so a refresh produces the same
Casa Olas fixture, just dated from today.

## Before anything

Confirm, out loud, three things:

1. `ARC_DATA_MODE=demo` on the deployment you are about to touch.
2. The database is the **demo's** one. `arc-stay-demo` and `arc-stay` are
   separate projects with separate databases on purpose
   (`docs/going-live.md` §1), and one bad seed against production truncates
   every table it knows about.
3. Andrew has said to do it. This destroys whatever a demo-giver had built up,
   which is the thing `ensure-seed` exists to protect.

The seed refuses to run outside demo mode and `rebuild.ts` refuses a database
named like a production one. Those are the last line, not the plan.

## Doing it

A reseed is `npm run db:seed` — it truncates the tenant tables and rebuilds
them dated from today. That is the whole refresh, and it is what to reach for
first.

`npm run db:rebuild` is a different and heavier thing: it resets a demo
*schema* so the migrations can build it, and exists for `P3005 — the database
schema is not empty`, which is what a database built by `db push` costs. It
needs `ARC_DB_REBUILD=1` in the environment.

Both `db:reset` and `db:rebuild` are refused by
`.claude/hooks/deny-dangerous.mjs`. That is correct: **a person runs them.**
Report what is needed and let Andrew run it.

If `ARC_DB_REBUILD=1` is set for a deploy, **it is removed immediately
afterwards.** A deployment that keeps it will reset the schema on the next
build.

## Afterwards

Open the demo and check three things rather than assuming: a departure exists
in the next few days, a conditions reading shows today's date with its source,
and the planner returns something. Then say which of the three you actually
looked at.

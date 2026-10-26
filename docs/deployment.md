# Deploying a hosted demo

This describes putting the POC on a URL someone can be walked through. It is
not a production runbook — the POC has no identity provider, no payment
provider and no real inventory, and nothing here changes that.

## What a hosted demo needs

1. A PostgreSQL 16 database the deployment can reach.
2. Six environment variables (below).
3. A build that applies the migrations and seeds the demo data before building
   the app.

## The build

```bash
npm run vercel-build
# prisma generate
#   && prisma migrate deploy
#   && npm run db:ensure-seed
#   && next build
```

Three things about this are deliberate.

**`migrate deploy`, not `db push`.** It used to be `db push --accept-data-loss`,
on the grounds that a demo database carries nothing worth migrating. That was
true right up until the moment it stopped being true, and the moment it stops
being true is not announced. `migrate deploy` applies a reviewed sequence of
files, fails rather than guessing, and never drops a column to make the schema
match — which is precisely what `--accept-data-loss` authorises it to do. See
ADR-034.

**The CHECK constraints are a migration now, not a separate step.** There is no
`db:constraints` in the build any more: `20261025000001_constraints` applies
`prisma/constraints.sql`, so the constraints arrive with the schema rather than
after it. A deployment can no longer come up with
`booked + held <= capacity` enforced only by application code, which is how two
counter-corruption bugs stayed invisible. `prisma/constraints.sql` is still the
file people edit; `tests/unit/migrations.test.ts` fails if the migration's copy
drifts from it.

**`db:ensure-seed`, not `db:seed`.** `npm run db:seed` truncates the tenant
tables first. That is right on a developer machine and wrong on a hosted demo,
where it would wipe whatever the person showing the product had just built up on
every redeploy. `db:ensure-seed` counts organizations and seeds only an empty
database.

Every route in the app is server-rendered on demand, so `next build` itself does
not read the database. The build only fails on a database problem if the
migrations or the seed cannot run — which is the honest outcome, because the app
is unusable without them.

## Baselining a database that predates the migrations

**Read this before the first deployment that runs `migrate deploy`.** Every
database that existed before 2026-10-25 — the hosted demo, and every developer's
local `arc_stay` — was built by `db push` and has no `_prisma_migrations` table.
`migrate deploy` sees a database with tables in it and no record of how they got
there, refuses to touch it, and fails the build. That is the right behaviour: it
cannot know whether the existing schema matches the first migration or is three
months divergent, and guessing is how data gets dropped.

The fix is to tell it, once, that both migrations are already applied:

```bash
# Check first. This should list both migrations as "not yet applied" against a
# database whose tables already exist.
npx prisma migrate status

npx prisma migrate resolve --applied 20261025000000_baseline
npx prisma migrate resolve --applied 20261025000001_constraints

npx prisma migrate status   # "Database schema is up to date!"
```

`resolve --applied` writes the migration rows and runs no SQL, so it cannot
damage anything — but it is also a claim, and an untrue claim here is worse than
the error it silences. Before making it, confirm the schema really does match:

```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

Exit code 0 and "No difference detected" means the claim is true. **Anything
else means it is not**, and the database needs the difference applied by hand
first (or, on a demo database with nothing worth keeping, dropping and letting
`migrate deploy` build it from scratch). Do not baseline a database whose schema
disagrees with the datamodel; the next migration will be written against a
schema that is not the one in front of it.

**`migrate diff` does not check the second migration.** It compares what Prisma
can express, and the whole reason `prisma/constraints.sql` exists is that Prisma
cannot express CHECK constraints or constraint triggers (ADR-020). So a database
can pass the diff above and still have none of them — which is exactly the state
a `db push` database is in, since `db push` never read that file either. Marking
`20261025000001_constraints` applied on such a database records a claim that is
simply false, and the invariant the whole inventory model rests on goes back to
being enforced by application code alone.

So make it true before claiming it. Every statement in `constraints.sql` is
`IF EXISTS`-guarded, so this is safe to run whatever state the database is in:

```bash
npm run db:constraints

# 16 CHECK constraints and 1 constraint trigger, as of this writing. Compare
# against `grep -c 'ADD CONSTRAINT' prisma/constraints.sql` rather than against
# the number written here.
psql "$DATABASE_URL" -c "SELECT count(*) FROM pg_constraint
  WHERE contype = 'c' AND connamespace = 'public'::regnamespace;"
```

Then `migrate resolve` both migrations. `./scripts/restore-drill.sh` checks the
same two counts on a restored database, for the same reason.

A fresh database needs none of this. `migrate deploy` on an empty database
applies both migrations and records them.

## Environment variables

| Variable | Value | Why |
| --- | --- | --- |
| `DATABASE_URL` | the connection string | See the pooling note below |
| `AUTH_SECRET` | random, ≥ 32 chars | Required in production; signs sessions |
| `ANALYTICS_SALT` | random, ≥ 32 chars, **different** | Keys analytics pseudonyms |
| `ARC_DATA_MODE` | `demo` | Labels every figure as synthetic and refuses a live payment provider |
| `AI_PROVIDER` | `mock` | Deterministic explanations, no network, no cost |
| `PAYMENTS_PROVIDER` | `simulated` | Redundant with `ARC_DATA_MODE=demo`, which already refuses anything else; set explicitly so the intent is visible |

Taking a real payment needs `ARC_DATA_MODE=pilot` (or `live`) plus all three
Stripe variables: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and
`STRIPE_PUBLISHABLE_KEY`. The app refuses to start without any one of them —
half-configured payments is the condition where a guest can be charged and not
booked, or booked and never un-booked. The publishable key is checked for its
`pk_` prefix because it is rendered into a page, and the secret key is checked
for *not* having one, because swapping the two is the mistake that happens.
With a live provider configured, the Content-Security-Policy widens to allow
`https://js.stripe.com` as a script and frame source; without one it does not.
See ADR-031.
| `ARC_DEMO_PASSPHRASE` | optional | See the front door below |

`MAPS_PROVIDER`, `CONDITIONS_PROVIDER`, `MESSAGING_PROVIDER` and
`ANALYTICS_PROVIDER` have exactly one value each — the offline implementation —
so a hosted demo needs no third-party keys at all.

They used to accept seven names between them (`mapbox`, `google`, `stormglass`,
`openweather`, `twilio`, `resend`, `posthog`) with nothing behind any of them.
Setting one changed the value `/admin/health` displayed and changed no
behaviour. `CONDITIONS_PROVIDER=stormglass` was the one that mattered: it told
an operator that live marine data was feeding the conditions gate, while the
gate carried on reading seeded `ConditionReport` rows. A name from that list is
now refused at boot with a message saying it is unbuilt and what answers
instead, and `MAPBOX_ACCESS_TOKEN`, `GOOGLE_MAPS_API_KEY`, `STORMGLASS_API_KEY`
and `POSTHOG_KEY` warn on startup rather than sitting there looking connected.
Adding a name back to one of those enums without an implementation is a type
error in `getIntegrations()`, not a setting that is read and ignored.

## Connection pooling

`inSerializableTransaction` uses Prisma **interactive** transactions, which hold
one session across several statements. A transaction-mode pooler (PgBouncer, or
Supabase's Supavisor on port 6543) hands a different backend to each statement
and will break them — and it will break them under concurrency, which is exactly
what the inventory invariants are there to protect.

Use a **session-mode** pooler or a direct connection. With Supabase that is the
port 5432 connection string, not the 6543 one. If you must use transaction mode,
the holds and checkout paths need rewriting first, and the race-condition
integration tests in `tests/integration/inventory.test.ts` and
`tests/integration/checkout.test.ts` are the proof that they work.

## The front door

The demo sign-in page hands out an owner, partner or admin session with no
credential. That is the right affordance for a walkthrough — inventing passwords
for synthetic people only creates something to leak — and the wrong thing to
leave open on a public URL.

Setting `ARC_DEMO_PASSPHRASE` puts every route behind `/gate`, which exchanges a
shared passphrase for an HTTP-only cookie holding an HMAC of it keyed by
`AUTH_SECRET`. Unset, there is no gate at all, which is what local development
and the test suites want.

The passphrase is trimmed and case-folded on both sides before the HMAC. An
exact comparison rejected people who had typed the right thing: a phone keyboard
capitalises the first letter, and a pasted passphrase arrives with a space on
the end. Case-folding costs a little entropy, which is the right trade for a
passphrase that gets read aloud or pasted into a chat — choose a longer one if
that matters to you.

It is a lock on the front door, not an authorisation mechanism. Every role and
tenant check behind it still re-derives from the database, and the guest portal
token is still the only guest credential.

Platform-level protection is the better option where it is available: on Vercel,
Deployment Protection with a password is a Pro feature, and the Hobby plan offers
only Vercel Authentication, which restricts viewing to people with an account on
the team and so cannot be handed to a hotel owner.

## What is still missing for a pilot

A real hotel's data needs what `docs/pilot-plan.md` specifies, and at minimum:
a real identity provider in place of `/sign-in`, a backup policy with a restore
that has actually been rehearsed, and `ARC_DATA_MODE=pilot` with the demo
markers replaced by real provenance. Migrations are no longer on this list; see
ADR-034.

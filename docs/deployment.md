# Deploying a hosted demo

This describes putting the POC on a URL someone can be walked through. It is
not a production runbook — the POC has no identity provider, no payment
provider and no real inventory, and nothing here changes that.

## What a hosted demo needs

1. A PostgreSQL 16 database the deployment can reach.
2. Six environment variables (below).
3. A build that pushes the schema, applies the CHECK constraints and seeds the
   demo data before building the app.

## The build

```bash
npm run vercel-build
# prisma generate
#   && prisma db push --accept-data-loss
#   && npm run db:constraints
#   && npm run db:ensure-seed
#   && next build
```

Three things about this are deliberate.

**`db push`, not `migrate deploy`.** The POC has no migration history — the
schema is still moving and a demo database carries nothing worth migrating.
A pilot with a real hotel's data needs migrations; see `docs/roadmap.md`.

**`db:constraints` runs separately.** The CHECK constraints in
`prisma/constraints.sql` cannot be expressed in the Prisma schema (ADR-020) and
`db push` does not know about them. Skipping this step leaves
`booked + held <= capacity` enforced only by application code, which is how two
counter-corruption bugs stayed invisible.

**`db:ensure-seed`, not `db:seed`.** `npm run db:seed` truncates the tenant
tables first. That is right on a developer machine and wrong on a hosted demo,
where it would wipe whatever the person showing the product had just built up on
every redeploy. `db:ensure-seed` counts organizations and seeds only an empty
database.

Every route in the app is server-rendered on demand, so `next build` itself does
not read the database. The build only fails on a database problem if the schema
push, the constraints or the seed cannot run — which is the honest outcome,
because the app is unusable without them.

## Environment variables

| Variable | Value | Why |
| --- | --- | --- |
| `DATABASE_URL` | the connection string | See the pooling note below |
| `AUTH_SECRET` | random, ≥ 32 chars | Required in production; signs sessions |
| `ANALYTICS_SALT` | random, ≥ 32 chars, **different** | Keys analytics pseudonyms |
| `ARC_DATA_MODE` | `demo` | Labels every figure as synthetic and refuses a live payment provider |
| `AI_PROVIDER` | `mock` | Deterministic explanations, no network, no cost |
| `PAYMENTS_PROVIDER` | `simulated` | Redundant with `ARC_DATA_MODE=demo`, which already refuses anything else; set explicitly so the intent is visible |
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
a real identity provider in place of `/sign-in`, migrations in place of
`db push`, a backup policy, and `ARC_DATA_MODE=pilot` with the demo markers
replaced by real provenance.

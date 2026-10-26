# ARC Stay — Puerto Escondido

AI-powered destination commerce for independent boutique hotels. A product of
ARC Travel, ARC Transformation Group.

This repository is the **proof of concept**: a complete, runnable synthetic demo
built around a fictional twenty-room hotel, *Casa Olas*, in La Rinconada,
Puerto Escondido, Oaxaca.

## What it does

A hotel already holds the knowledge a guest wants — which cove is calm enough
for a first surf lesson, which panga captain shows up on time, where to eat on
a Tuesday. ARC Stay turns that into a structured, verifiable catalog a guest can
actually book, and pays the hotel for it.

The loop the POC proves:

```
hotel knowledge → verified catalog → guest preferences → contextual itinerary
                → simulated purchase → hotel earnings → operator insight
```

Five surfaces, one modular monolith:

| Surface | Route | What it does |
| --- | --- | --- |
| Public | `/` | The destination surface: destinations, stays, experiences, cultural guides, the journal, search, and an illustrative trip planner. Editorial content, no availability and no commercial claim |
| Hotel owner | `/owner` | Onboarding, property profile, catalog, partners, arrivals, morning briefing, approvals, revenue |
| Guest | `/g/<portalToken>` | QR-reached portal: intake, itinerary with its reasoning, local guide, basket, simulated checkout |
| Local partner | `/partner` | Supplier profile, experiences, availability, booking requests, earnings |
| Platform admin | `/admin` | Verification, destination graph with provenance, data-quality checks, system health |
| Demo index | `/demo` | The door into the four operational surfaces, so a walkthrough can start anywhere |

## What it deliberately does not do

These are design commitments, not gaps, and each is enforced in code rather
than in copy:

- **It does not invent availability or verification.** Every fixture partner is
  `UNVERIFIED`. `/admin` is the only route to a verified status anywhere in the
  product, and approving requires a note recording what was checked.
- **It does not tell you a beach is safe.** `modules/destination/conditions`
  has no function that returns "safe" — only `allowed`, with the risk band, the
  minimum ability the day demands, the reading's timestamp and its source. A
  test asserts the gate never emits a safety claim.
- **It does not take money.** Checkout is a real state machine over simulated
  payments. While `ARC_DATA_MODE=demo`, configuring a live payment provider is a
  startup error.
- **It does not act on a hotel's behalf.** ARC drafts actions; a named human
  approves them. Outbound guest messaging is a hard kill switch that throws, not
  a feature flag.
- **The AI explains; it never decides.** The model layer has no tools and no
  write path. It can rephrase reasons the deterministic engine produced; it
  cannot add a candidate, remove an exclusion or change a score.

## Running it

### Requirements

- Node 20.11+ (developed on 22)
- PostgreSQL 16 running locally
- No API keys. Every integration defaults to a deterministic offline
  implementation.

### Setup

```bash
# 1. Install
npm install

# 2. Create the two databases (names can be anything; match them in .env)
createdb arc_stay
createdb arc_stay_test

# 3. Configure. The POC runs end to end with only the two DATABASE_* values set.
cp .env.example .env
#    Edit DATABASE_URL and TEST_DATABASE_URL to point at your Postgres.

# 4. Generate the client, push the schema, apply the CHECK constraints, seed
npm run setup

# 5. Run
npm run dev
```

Then open <http://localhost:3000>. The landing page links into all four
surfaces.

### Signing in

The seeded accounts have no passwords — inventing credentials for synthetic
people only creates something to leak. `/sign-in` is an explicit demo account
switcher. A real deployment replaces that page and one function
(`signInByEmail`); every authorisation decision behind it already re-derives
from the database.

| Role | Account |
| --- | --- |
| Owner | `elena@casaolas.demo` |
| Front desk (property-scoped) | `tomas@casaolas.demo` |
| Partner | `mariana@olasverdes.demo` |
| Platform admin | `admin@arctravel.demo` |

Guests are not listed on that page, and it 404s outside demo mode. A guest
reaches the portal from the QR code at the front desk, and that link is their
only credential — so it stays with the operator rather than being published in
the markup. The seed pins three stable portal links so demos and tests do not
break between seeds:

- `/g/demo-portal-01` — Harriet Okonjo, in house, beginner surfer, intake done
- `/g/demo-portal-03` — Nina Brandt, improver, balanced pace
- `/g/demo-portal-05` — Yuki Tanaka, arriving today with no transport booked

The seed prints the full list each time it runs.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run setup` | Generate client, apply migrations, seed |
| `npm run db:migrate:status` | Whether this database has every migration |
| `npm run restore-drill` | Rehearse the backup restore end to end (`docs/operations.md`) |
| `npm run db:constraints` | Re-apply `prisma/constraints.sql` after a `pg_restore` (ADR-020); normally arrives with the migrations |
| `npm run db:seed` | Reseed (truncates first; idempotent and deterministic) |
| `npm run db:rebuild` | Reset a **demo** schema so migrations can rebuild it — needs `ARC_DB_REBUILD=1`, refuses outside demo mode ([`docs/deployment.md`](docs/deployment.md)) |
| `npm run db:ensure-seed` | Seed only if the database is empty — for a hosted demo, where a redeploy must not wipe data |
| `npm run db:studio` | Prisma Studio |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Unit + integration (needs `TEST_DATABASE_URL`) |
| `npm run test:unit` | Unit only — no database |
| `npm run test:e2e` | Playwright (builds and serves, reseeds the demo database first) — includes the WCAG audit and the concurrency race |
| `npm run load-test` | Read-only load test against a running server (`docs/operations.md`) |
| `npm run build` | Production build |
| `npm run verify` | typecheck → lint → test → build |
| `npm run vercel-build` | Hosted build: generate → rebuild-if-asked → `migrate deploy` → seed-if-empty → build. See [`docs/deployment.md`](docs/deployment.md) |

## Testing

**Unit tests** cover the pure logic: money primitives, price selection,
commission resolution and the three-way split, the conditions safety gate,
itinerary feasibility, and the AI layer's injection screening.

**Integration tests** run against a real PostgreSQL schema on a separate
`TEST_DATABASE_URL`, with a guard that refuses to run against a database whose
name does not look like a test database. They cover the things that only exist
in the database: serialized inventory holds under concurrency, checkout
idempotency, transactional rollback, and tenant isolation between two real
organizations.

**End-to-end tests** run the acceptance criteria through a browser, on both a
desktop and a Pixel 7 viewport.

```bash
npm test                 # 285 unit + integration
npm run test:e2e         # 46 acceptance tests
npm run verify           # everything except E2E
```

Integration tests run against the same CHECK constraints as production. The
harness applies `prisma/constraints.sql` itself, so the suite cannot pass on a
weaker schema than the one that ships.

## Repository layout

```
prisma/
  schema.prisma          33 models — see docs/data-model.md
  seed.ts                Deterministic demo seed
  seed/                  Fixtures: destination graph, catalog, people, conditions
src/
  app/                   Next.js App Router — thin surface layer only
    (public)/            The public destination surface, mounted at the root
  components/            UI primitives and shared components
    explore/             The public surface's own components, editorially styled
  lib/                   Cross-cutting: money, dates, errors, env, i18n, redaction
  modules/               Domain logic, no React
    tenancy/             The single authorisation chokepoint
    auth/ hotels/ catalog/ suppliers/ guest/ preferences/
    destination/         Places, travel times, the conditions safety gate
    itinerary/           Deterministic scoring and the day-by-day generator
    inventory/           Capacity and holds, under Serializable isolation
    commerce/            Pricing, commission, cart, checkout
    operator/            The morning briefing
    workflows/           Proposals, approvals, audit
    analytics/           Event capture and revenue reporting
    admin/               Verification and data-quality checks
    discovery/           The public read model, estimates and editorial content
    ai/                  Provider interface, mock, injection defenses
    integrations/        Payments, maps, conditions, messaging, analytics boundaries
tests/
  unit/ integration/ e2e/
docs/
```

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — structure, boundaries and the
  reasoning behind each
- [`docs/product-requirements.md`](docs/product-requirements.md) — what the
  product is for and what is in and out of scope
- [`docs/data-model.md`](docs/data-model.md) — the 33 models and the invariants
  they carry
- [`docs/decisions.md`](docs/decisions.md) — decision records, including the
  ones worth arguing with
- [`docs/deployment.md`](docs/deployment.md) — putting the POC on a URL: the
  build steps, the six environment variables, the connection-pooling constraint
  and the shared-passphrase front door
- [`docs/culture-context.md`](docs/culture-context.md) — the source doctrine
  behind the guest's country brief: evidence classes, advisory never law,
  change review
- [`docs/roadmap.md`](docs/roadmap.md) — POC → pilot → MVP
- [`docs/pilot-plan.md`](docs/pilot-plan.md) — the narrow Puerto Escondido pilot
  and the metrics that gate it
- [`CLAUDE.md`](CLAUDE.md) — conventions for working in this codebase

## Status

The POC is complete and its acceptance tests pass. It has been through
independent review by the security, AI-safety and architecture reviewers in
`.claude/agents/`; the defects they found are fixed, regression-tested, and
recorded as ADR-017 through ADR-023 in [`docs/decisions.md`](docs/decisions.md).
 Nothing here has been
deployed, no external account has been created, and no live integration has been
enabled.

**Every price, metric and partner in this repository is synthetic.** The real
geography of Puerto Escondido is used as public reference data with its
provenance recorded; every commercial fact is invented.

# Penetration test — scope and brief

For whoever is engaged to test ARC Stay. ARC cannot pen-test itself: this
document is the part ARC can do, which is to say exactly what to attack, what
the application believes about itself, and where the money is.

Written to be handed to a tester as-is. Everything below is a claim ARC is
making — the job is to disprove the ones that are wrong.

## What the system is

A Next.js 16 application on Vercel with a PostgreSQL 16 database. Four
surfaces, one codebase:

| Surface | Route prefix | Who |
| --- | --- | --- |
| Public destination | `/`, `/experiences`, `/stays` | Anonymous |
| Guest portal | `/g/[token]` | A guest holding a portal token — **no account** |
| Hotel owner / staff | `/owner` | Signed-in, scoped to one organisation |
| Local partner | `/partner` | Signed-in, scoped to one supplier |
| Platform admin | `/admin` | Signed-in platform admin |

No third-party identity provider. Sessions are a signed cookie; passwords are
scrypt hashes. Payments are Stripe Payment Intents over the REST API, with the
Payment Element in the browser — **card data never reaches ARC's servers**, and
confirming that claim is in scope.

## In scope

Everything in the repository, and the deployed instance you are given. In
particular:

### 1. The guest portal token — the highest-value target

`/g/[token]` is reached from a QR code with no account and no password. The
token is a bearer credential: whoever holds one is that guest. It is the only
guest credential in the system.

What ARC claims, and would like disproved:

- A token cannot be guessed. They are an HMAC of a server-side secret
  (`ARC_SEED_TOKEN_SECRET` for seeded stays, `src/lib/ids.ts` for real ones).
- A token never appears in a URL that leaves the browser — error reports carry
  the matched route *path*, not the URL, for exactly this reason. Check logs,
  `Referer` headers, analytics payloads, and any third-party request.
- One guest's token cannot reach another guest's data. Every guest-surface
  service takes *who is asking* and scopes its database lookup by it. **This was
  once false**: `cancelOrderItem` loaded an order item by id alone, so any
  portal token could cancel any other guest's booking. It is fixed and
  regression-tested. Look for the same shape elsewhere — any service accepting a
  client-supplied entity id where the ownership predicate is a check rather than
  part of the `where` clause.
- An expired or reissued token stops working, including its grace period.

### 2. Tenant isolation

Two hotels' data in one database. ARC claims no cross-tenant read or write is
possible and that every tenant-scoped operation starts at
`src/modules/tenancy/context.ts`.

Specifically: a client-supplied `organizationId` is never trusted, and
ownership is never inferred from a URL. Attack the ids — IDOR on every route
taking a `propertyId`, `experienceId`, `supplierId`, `payoutId`, `orderId` or
`stayId`. The admin surfaces are the interesting ones, because a platform admin
legitimately crosses tenants and a supplier user must not.

### 3. Money

- **Price manipulation.** Prices are computed server-side from the database;
  no client value reaches a total. Try to pay less than the asking price, add a
  line at a price you supply, or change a quantity after a hold.
- **Commission and splits.** Basis points, integer minor units. Try to make a
  split not reconcile, or make the platform's share zero.
- **Payouts.** `/owner/payouts` computes what a partner is owed and records a
  transfer that a human performs; ARC does not move money. Try to get a ledger
  entry onto two payouts, to settle a payout nobody approved, or to settle one
  for an amount other than the computed net.
- **Refunds.** A refund or chargeback at Stripe opens an approval; it cancels
  nothing on its own. Try to trigger a refund path without an `Approval` row, or
  to have one approval execute against items it was not raised for.

### 4. The payment path

- **Webhook forgery.** `POST /api/webhooks/stripe` verifies an HMAC signature.
  Try a replay, a modified payload with a stale signature, a timestamp outside
  the tolerance window, and an event for an order belonging to someone else.
- **Payment intent reuse.** The idempotency key for a payment session is derived
  from `(cartId, total, currency)`. Try to pay once and get two orders, or to
  reuse a succeeded intent against a different basket.
- **Confirm-then-book window.** `checkout()` deliberately accepts a payment it
  did not itself confirm (ADR-026). Attack that: can a basket be checked out
  against a payment intent that did not succeed, or one that belongs to another
  guest's cart?

### 5. The inventory invariant

`booked + held <= capacity` is enforced by a CHECK constraint and Serializable
transactions. Try to oversell a departure: concurrent adds, a held basket
checked out twice, a cancellation that returns capacity twice. `returnCapacity`
throws rather than clamping, which is deliberate.

### 6. Authentication and sessions

- Session cookie: forgery, fixation, failure to rotate on sign-in, missing
  `HttpOnly`/`Secure`/`SameSite`.
- Rate limits on sign-in are per account **and** per caller. Try to get around
  either.
- Password reset and partner invitation. `invitePartner` refuses an email that
  already has an account — it used to upsert, which rewrote a stranger's
  profile and grafted a membership onto it. Look for the same pattern
  elsewhere.
- Privilege escalation: can a `STAFF` user do an `OWNER` action, a `SUPPLIER`
  anything outside their own supplier, or anyone reach `/admin`?

### 7. The demo front door

While `ARC_DATA_MODE=demo` the sign-in page issues an owner, partner or admin
session **with no credential**. This is intended for walkthroughs. A deployment
is either behind `ARC_DEMO_PASSPHRASE` or explicitly open.

Worth testing: whether the passphrase gate can be bypassed (it is middleware
plus an HMAC cookie), and whether the credential-free switcher is genuinely
unreachable when `ARC_DATA_MODE` is not `demo`.

### 8. The usual web surface

CSP (per-request nonce with `strict-dynamic`, widened for Stripe when a live
provider is configured), XSS, CSRF on server actions, SSRF, open redirect
(`?next=` is narrowed by `safeNext`, including the protocol-relative
`//evil.example.com` case), SQL injection (Prisma, with a handful of
`$queryRaw` calls in `src/modules/observability/invariants.ts` worth reading),
dependency vulnerabilities, header and cookie configuration.

### 9. Information disclosure

- `GET /api/health` is unauthenticated and should say almost nothing. With
  `MONITORING_TOKEN` it says more. Check the boundary.
- `/api/e2e/slot-state` must 404 outside demo mode.
- `/api/cron/*` must 404 when `CRON_SECRET` is unset and 401 without it, and
  the comparison must be constant-time.
- Error pages, stack traces, source maps.
- Audit and analytics rows: `AuditEvent` metadata is PII-redacted on the way in
  and `AnalyticsEvent` subjects are pseudonymised. An email or phone number
  reaching either is a finding.

## Out of scope

- **Vercel's and Stripe's own infrastructure.** Do not test their platforms.
- **Denial of service and volumetric load.** A load test exists
  (`scripts/load-test.mjs`); please do not add to it.
- **Social engineering** of ARC, the hotel or the partners.
- **Physical** anything.
- **The six seeded partners.** `Olas Verdes` and the rest are invented
  businesses, and the demo data is synthetic. No real guest, partner or payment
  exists in the demo instance.

## What you should be given

1. A URL for a dedicated instance, not the one being demonstrated to hotels.
2. Credentials for one account of each role, plus two organisations so tenant
   isolation can be tested rather than assumed.
3. Portal tokens for two guests in different organisations.
4. Stripe **test**-mode keys and the webhook signing secret.
5. Read access to the repository, which is the point of this document — this is
   a white-box engagement. Reading `docs/decisions.md` first will save time:
   several things that look like bugs are recorded decisions, and a few of the
   ADRs describe real vulnerabilities that were fixed, which is where to look
   for siblings.

## What ARC would most like to know

In order, because a report of thirty low findings and no answer to these is
less useful than the reverse:

1. Can one guest's portal token reach another guest's data, in any way?
2. Can a guest pay less than the asking price, or get something for nothing?
3. Can a partner be paid twice, or paid without an approval?
4. Can a departure be oversold?
5. Can anything cross a tenant boundary?
6. Does card data touch ARC's servers anywhere?

## Reporting

Please report as you find, rather than only at the end — a critical finding is
worth more on the day than in a PDF three weeks later. Include the request, the
response, and what it took to get there, because a finding that cannot be
reproduced cannot be regression-tested, and every fix here gets a test.

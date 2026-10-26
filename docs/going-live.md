# Going live with a real hotel

Everything in this file is a decision or an account that only a person with
access to the money, the domain and the legal relationships can make. The code
is ready for all of it; none of it can be done from the repository.

Read `docs/deployment.md` first for what each environment variable means. This
file is the order to do things in, and what breaks if you skip a step.

---

## 1. Keep the demo. Build production beside it.

**Do not turn the demo into production.** The demo's front door is deliberately
open: while `ARC_DATA_MODE=demo` the sign-in page lists synthetic accounts and
signs anyone in as any role with no credential, and the seed's portal tokens are
derived from a secret in the environment. That is correct for a sales demo and
catastrophic next to a real hotel's guest list.

Two deployments, two databases:

| | Demo | Production |
| --- | --- | --- |
| Vercel project | `arc-stay-demo` | new, e.g. `arc-stay` |
| Neon database | the existing one | a **new** one, not a branch of it |
| `ARC_DATA_MODE` | `demo` | `pilot` for the first hotel, `live` after |
| `ARC_DEMO_PASSPHRASE` | set, or `ARC_ALLOW_OPEN_DEMO=1` | **unset** |
| `ARC_SEED_TOKEN_SECRET` | set | **unset** — the seed must never run here |
| `PAYMENTS_PROVIDER` | `simulated` | `stripe`, once section 3 is done |
| Seeding | `npm run db:ensure-seed` in the build | **never** |

The databases are separate because a branch shares a parent's data and because
one bad `db:seed` against production truncates every table it knows about. The
seed refuses to run outside demo mode, and that refusal is the last line, not
the plan.

**What you do:**

1. In Neon, create a new project (not a branch). Copy the **pooled** connection
   string, and read `docs/deployment.md § Connection pooling` before you paste
   it — a transaction-mode pooler breaks the serializable transactions that
   protect inventory, and the app would appear to work until two people booked
   the last place at once.
2. In Vercel, create a new project from the same repository, on the branch you
   want to deploy.
3. Set the environment variables in the table above, plus `AUTH_SECRET` and
   `ANALYTICS_SALT` — each 32+ random characters, each **different** from the
   other and from the demo's. `openssl rand -base64 48` twice.
4. Set the build command to run migrations without the seed:
   `prisma generate && prisma migrate deploy && next build`.
5. Deploy, then open `/admin/health` and check that every row says what you
   expect. That page exists for this moment.

---

## 2. The first hotel's own data

Nothing here needs a developer. The product has a screen for each step.

1. **Register the hotel** at `/sign-up`. This creates the organization, the
   property and the owner's account, all as drafts.
2. **The property's details** at `/owner/property`: name, check-in and check-out
   times, currency, house notes, the place it sits in.
3. **Room types** on the same page. Needed before you can enter a guest.
4. **Partners.** Either invite each one from `/owner/partners`, or send them to
   `/sign-up/partner` and accept the requests that arrive. Accepting creates
   their login and emails them an invitation.
5. **Listings.** Either write them yourself at `/owner/catalog/new`, or let each
   partner write their own at `/partner/listings` and publish what they send
   you. A partner's listing arrives as `PENDING_REVIEW` and is called out at the
   top of your catalog.
6. **Departures.** The partner schedules them at `/partner/availability`.
   Nothing is bookable without a published listing, an active price and a dated
   departure — `/owner/catalog/<id>` tells you which of the three is missing.
7. **Guests.** `/owner/guests` creates a guest and a stay and mints the portal
   link you hand over at check-in.

---

## 3. Payments — only you can do this

ARC never touches a card number: the browser confirms with Stripe and hands back
a reference, and the server reads the authoritative amount and status from
Stripe rather than from the client (ADR-026).

1. Create the Stripe account in the hotel's name or ARC's, whichever the
   contract says. This is a legal and tax decision, not a technical one.
2. Complete Stripe's own verification. Expect to need the company's
   registration, a bank account and a person's identity documents.
3. In Vercel, on the **production** project only, set `STRIPE_SECRET_KEY`,
   `STRIPE_PUBLISHABLE_KEY` and `STRIPE_WEBHOOK_SECRET`, then
   `PAYMENTS_PROVIDER=stripe` and `ARC_DATA_MODE=pilot`.
   The app **refuses to start** without all three keys: half-configured
   payments is the state where a guest is charged and not booked.
4. Point the Stripe webhook at `https://<your-domain>/api/webhooks/stripe`.
   Without the webhook secret a forged webhook could mark an order paid.
5. Take one real payment of a small amount, with a real card, and refund it.
   Check the order, the ledger and `/owner/payouts` agree.

**Do not set a live Stripe key on the demo project.** `getEnv()` refuses the
combination and the app will not boot — which is the intended outcome, not a
bug to work around.

---

## 4. Email — only you can do this

Transactional mail is off by default and is a different permission from guest
messaging (ADR-040). Until you do this, confirmations, invitations and password
resets are *written and recorded* but not delivered: the hotel can read every
one of them at `/owner/messages`.

1. Create a Resend account and verify the domain you will send from. This means
   adding DNS records — SPF, DKIM and DMARC — to the domain's DNS. Mail from an
   unverified domain lands in spam, which for a password reset means the manager
   simply cannot get in.
2. On the production project: `MAIL_PROVIDER=resend`, `RESEND_API_KEY`,
   `ARC_ENABLE_TRANSACTIONAL_EMAIL=1`, `ARC_MAIL_FROM` (an address at the
   verified domain), `ARC_PUBLIC_URL` (the full origin, no trailing slash), and
   optionally `ARC_MAIL_REPLY_TO` pointing at a mailbox a person reads.
3. Send yourself a password reset and read what arrives.

`ARC_ENABLE_OUTBOUND_MESSAGING` stays **off**. That one governs ARC writing to
guests on a hotel's behalf — nudges, campaigns, anything an agent drafted — and
nothing in the product needs it.

---

## 5. Verifying real suppliers — only you can do this

`/admin` is the only route to a `VERIFIED` status, and verification means a
person looked at a document. For each partner, before anything of theirs is
published:

1. Ask for their liability insurance certificate and their instructor or guide
   certifications. The partner can upload what they claim at
   `/partner/profile`; those are **claims** until you check them.
2. Look at the documents. Check the insurance is current, names the right
   entity, and covers the activity.
3. Record the check at `/admin`, including the insurance expiry date. A
   verification lapses by itself when the certificate does (ADR-036) — the guest
   surface stops showing a verified badge, without anybody remembering to.
4. Diarise each expiry. `/admin/health` and
   `/api/cron/check-invariants` will tell you about a lapse; neither will chase
   the renewal.

Until a partner is verified, their listings can still be published and guests
see an "unverified partner" notice. That is a decision for the hotel, and the
copy is honest either way. What must never happen is a badge that says ARC
checked something nobody checked.

---

## 6. Security review — only you can do this

`docs/pen-test-scope.md` is written for a tester and names the things worth
paying for: the guest portal's bearer tokens, tenant isolation, the holds and
checkout race conditions, the invitation and claim flows, and the two
unauthenticated forms (`/sign-up/partner` and `/sign-up/direct`).

Book it **after** section 1 and **before** the first real guest. A test against
the demo tests the demo's deliberately open front door and tells you nothing.

---

## 7. The things nobody has built yet

Honest list, so none of it is a surprise:

- **Inventory holds lose races under real contention.** Every mutation in
  `src/modules/inventory/service.ts` reads a departure's counters and then
  increments them, inside a Serializable transaction. That is the pattern
  Postgres is strictest about: when several guests commit to the same departure
  within the same moment, it cancels all but one and the rest are refused —
  correctly, but they are refused with places still free. Measured: six
  simultaneous guests, a departure with six seats, none sold. Nothing oversells
  and no figure is wrong; people are simply told to try again.

  It does not bite a boutique hotel's traffic, where two people booking the same
  boat in the same millisecond is rare. It will bite a popular departure the
  moment one is promoted. The fix is to stop reading what you increment — a
  conditional `UPDATE … WHERE booked + held + n <= capacity`, which cannot race
  because the condition is evaluated on the row itself — and it is a change to
  the most load-bearing file in the project, so `CLAUDE.md` asks for an
  independent review before it lands. Do it before the first promotion, not
  before the first guest.

- **A real identity provider.** `/sign-in` is a password form with per-account
  and per-caller rate limiting. It has no second factor, no SSO and no device
  management. Fine for a first hotel; not fine at ten.
- **A rehearsed restore.** Neon takes backups. Nobody has restored one into an
  empty project and checked the constraints came with it — they do not come with
  a schema-only dump, which is why `prisma/constraints.sql` exists as a file you
  can re-run (`docs/operations.md`).
- **Room revenue is demo data.** `Stay.roomRevenueMinor` is entered by hand and
  nothing reconciles it against a PMS.
- **No PMS integration.** Guests and stays are entered at `/owner/guests` or
  created by a guest themselves.
- **Conditions are seeded rows.** `CONDITIONS_PROVIDER` has one value and it is
  the offline one. The gate reads `ConditionReport` rows somebody wrote. Before
  a real guest is told a break is within their ability, either a person updates
  those daily or somebody builds the feed — and the gate still never says
  anything is *safe*, only what is allowed.
- **Payouts are a statement, not a transfer.** `/owner/payouts` tells the hotel
  what it owes each partner. No money moves.

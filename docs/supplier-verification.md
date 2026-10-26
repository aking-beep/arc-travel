# Verifying a real partner

What to collect, from whom, and what ARC does with it. For the person doing the
verifying — not a design document.

The product side of this is `/admin`, which is the only route to a `VERIFIED`
status anywhere in ARC. The reasoning is in ADR-036; the rule it enforces is
simple enough to state here: **a partner is verified when a named person has
seen each of the documents below and recorded that they did.** Not when somebody
believes the partner is fine.

## Why this is worth the effort

A verified badge is a claim ARC makes to a guest about a stranger. If the claim
is wrong, the guest finds out by standing on a beach at 6am next to someone with
no permit, no insurance and a boat.

That is also the commercial argument. A boutique hotel's reason to use ARC
rather than a WhatsApp group is that somebody checked. The badge is the product.

## The six required checks

These are the checkboxes on the verification form, in the order the
conversation usually goes. All six must be recorded before the status can be set
to verified — the service refuses otherwise, and so does a database constraint.

### 1. A named human being

Official photo ID of whoever signs for the business, matched against the name on
the agreement. INE credential or passport.

A business card is not ID. Nor is a WhatsApp display name, which is what
roughly everyone will offer first.

### 2. RFC — the Mexican tax ID

Ask for the **constancia de situación fiscal** from the SAT, which is a PDF the
partner can download in two minutes. Not the number read out over the phone.

ARC does not issue their invoices. But a partner who cannot invoice cannot be
paid for long, and finding that out after three months of bookings is a
conversation nobody enjoys.

### 3. Permission to operate where they say they do

This is the check most likely to be missing, and the one with the most
consequence.

- **Anything on the water** — surf lessons, boat trips, fishing, turtle
  releases: the **Capitanía de Puerto** permit for Puerto Escondido. Ask which
  activities it covers and read it; a permit for sport fishing is not a permit
  to take beginners into surf.
- **Anything inside a protected area** — Lagunas de Chacahua, the turtle
  sanctuaries: the relevant **CONANP** authorisation.
- **Transport**: a federal permit if they are moving people between towns.

A partner operating without one is not a risk ARC is taking. It is a risk ARC
would be *selling*, with a badge on it.

### 4. Bank details, confirmed out of band

CLABE plus the account holder's name, which should match the legal entity.

**Confirm them by calling a number you already had.** Not by replying to the
email that sent them, and not via WhatsApp. Payout fraud is a redirected bank
detail almost every time, and the message asking you to update it always looks
exactly like the partner.

Record the name mismatch if there is one — a sole trader paying into a personal
account is normal; a company paying into a third party's account is not.

### 5. Liability insurance, in force

The certificate itself. Record four things: insurer, policy number, **which
activities are covered**, and the **expiry date**.

The expiry is mandatory in the form, because it is the one piece of evidence
that stops being true on a date known in advance. ARC marks the verification as
lapsed from that date and stops showing guests a verified badge, so put the
renewal in your own calendar a month before — `/admin` warns at thirty days.

Check the activities. A policy covering "tour operations" may well exclude surf
instruction, and the exclusion page is the one worth reading.

### 6. Guide certification, where an activity requires one

Only for activities where it is needed; `Activity.guideRequired` marks those in
the catalogue. Check the certification against the activities this partner will
actually run.

Anything in their `claimedCertifications` is **a claim** until it is checked
here. The product renders those as claims deliberately and must keep doing so.

## The two optional checks

Recorded if they apply, and not blocking:

- **Legal entity registration.** Acta constitutiva for a company, or evidence of
  registration as a *persona física con actividad empresarial*. Put the legal
  name on the Supplier record: that is what a payout and any dispute will use.
  A one-person surf guide may legitimately have none of this.

## What to write in the note

The note is still required — at least ten characters, and please use more than
ten. The checklist says *what* was checked; the note is where the specifics go:

> Policy GNP-884210 with GNP, covers surf instruction and boat transfers,
> expires 2027-03-31. RFC from SAT constancia. Capitanía permit 2026-114, covers
> surf and sport fishing, not diving. CLABE confirmed by phone with Mariana on
> the number from the original agreement.

A year later, that note is the difference between a verification somebody can
stand behind and a tick in a box.

## The six seeded partners

They are fixtures — `Olas Verdes`, `Cocina Doña Mina` and the rest are invented
businesses — and they stay `UNVERIFIED` for ever. Verifying a fixture would be
inventing a commercial relationship, which non-negotiable 2 forbids, and the
seed asserts their status.

**Nothing in this document applies to them.** The first real verification will
be of a real business, which means somebody will have to do the above for the
first time with a partner on the phone, and it will take longer than it reads.

## When a verification lapses

A lapse is not a failure of the admin who recorded it. The decision was correct
on the evidence available; the evidence has expired.

What happens: `/admin` shows the partner in red with the reason, the publish
checks warn about it, and the guest surfaces stop showing a verified badge. What
does **not** happen: nothing is unpublished, no booking is cancelled, and the
stored decision is not rewritten. ARC does not take consequential action by
itself (non-negotiable 6), and a lapsed certificate is a prompt for a
conversation, not grounds for cancelling a guest's booking.

To clear it, get the renewal and record the check again with the new date.

## Existing verified partners after this change

Every `VERIFIED` supplier that predates ADR-036 has an empty checklist and no
expiry, and therefore reads as **lapsed**. That is intended rather than an
oversight: nobody can now say what was checked for those rows, and filling in a
checklist on their behalf would be inventing verification.

Re-check them. There will not be many, and the alternative is a badge resting on
a note that may say "looks fine".

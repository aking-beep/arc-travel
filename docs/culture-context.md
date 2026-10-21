# Culture context: source doctrine

The culture-context module (`src/modules/culture-context`) gives a guest a short,
sourced brief about the country they are staying in: entry requirements, local
laws and customs, and safety, as published by an official source. It is ported
from the standalone culture-context repository (ADR-024), and these rules come
with it from that repo's `SOURCE_POLICY.md` and `SOURCE_GOVERNANCE.md`. They are
product commitments in the same sense as the non-negotiables in `CLAUDE.md`.

The module is only useful if it is more disciplined than a generic chatbot. Every
rule below is about not saying more than a source says.

## The source-class ladder

Every source carries a `SourceClass`, which records *what kind of authority*
backs a statement. It is a different axis from `Provenance`, which records *who
supplied* a fact (`HOTEL_SUBMITTED`, `PUBLIC_SOURCE` and so on). The two are
never collapsed into one another: a GOV.UK page is `PUBLIC_SOURCE` in provenance
terms and `GOVERNMENT_ADVISORY` in evidence terms, and both facts matter.

From strongest to weakest, for a legal claim about the destination:

1. **`PRIMARY_LAW`**: the destination's own legislation, gazette, regulator
   rule or local ordinance.
2. **`REGULATOR_GUIDANCE`**: a destination authority explaining its own rule.
3. **`GOVERNMENT_ADVISORY`**: another government's travel advice, such as the
   UK FCDO's. Official and useful, but it is not the destination's legal text.
4. **`INTERGOVERNMENTAL_ALERT`**: UN, EU or other international hazard and
   humanitarian sources. Event and risk context, not destination law.
5. **`REFERENCE_DATA`**: country, currency, weather, holiday and geography
   data. Metadata only, unless it is explicitly authoritative for the field.
6. **`COMMUNITY_CONTEXT`**: local reporting, organisations and community
   observations. It may inform cultural or local-impact context. It can never
   establish a legal requirement.

## An advisory is never rendered as law

A record's `RuleKind` (`LAW`, `RESTRICTION`, `ADVISORY`, `CULTURAL_NORM`,
`LOCAL_IMPACT`, `CONTEXT`) is separate from its sources' class, and the two are
tied by one rule, enforced in `ruleRecordSchema`:

- A `LAW` record must cite a `PRIMARY_LAW` or `REGULATOR_GUIDANCE` source **and**
  carry `verification: VERIFIED`. Nothing produces one automatically.
- A government advisory produces an `ADVISORY` record and nothing stronger. The
  GOV.UK adapter hard-codes that, and a test asserts it.
- The guest card labels every advisory as advisory ("Travel advice — not the
  law of Mexico") and names the authority. There is no variant that omits the
  label.

## What every card shows

Every legal or restriction card shows all of these, and the component has no
variant that drops one:

- the source authority
- the source class
- the canonical link
- when it was retrieved
- the jurisdiction
- its verification status, and a clear statement when applicability is
  uncertain

## We could not verify this

When a source is down, unparseable or simply does not cover something, the
brief says so: "We could not reach this source, so we are not showing its
advice." It never fills the gap with model knowledge, a cached guess or a
plausible-sounding sentence. The brief also always says that its coverage is
partial: the absence of a card does not mean the absence of a rule.

The AI boundary (ADR-006) applies here unchanged. A model may rephrase a
`BriefItem` the deterministic service produced. It may not create one, change
its kind, or remove a warning.

## Snapshots and change detection

- Every check of a source is recorded as a `CultureSourceSnapshot`, including a
  failed one, so the admin health view can show freshness and failure counts.
- A successful check stores the normalised section text and a SHA-256 of it.
  There is exactly one hash function, `snapshotHash` in
  `src/modules/culture-context/hash.ts`: canonical JSON (sorted keys, no
  whitespace) over the **content fields only**. Volatile metadata such as
  retrieval time or a page's own `updated_at` is not hashed, so it cannot raise
  a false change.
- History is never overwritten. A new hash creates a new snapshot row.
- **A hash change is detection, not proof** that the legal meaning changed. It
  opens a `CultureSourceChange` in the admin verification queue as `PENDING`.
- **Nothing derived from a change is published without review.** Until a
  platform admin records a decision, with a note, on `/admin`, no guest-facing
  copy can say the advice changed, and no notification can state a new
  requirement. The guest card shows an "updated" notice only for a change an
  admin has `VERIFIED`.

What the brief does show before review is the source's own current text,
labelled as that source's advisory with its retrieval time. That is what the
standalone service did, and it is what the doctrine allows: the advisory is
attributed, not endorsed.

## Third-party HTML is untrusted input

Source HTML is never rendered. `htmlToText` drops `<script>`, `<style>` and
other non-content elements together with their contents, then decodes entities
and collapses whitespace. The guest card renders the result as plain text.

## Licensing and attribution

GOV.UK travel advice is published under the
[Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
Every item from it carries the attribution "Contains public sector information
licensed under the Open Government Licence v3.0", and the guest card renders it.
Check the exact OGL wording for this use before showing it to a real guest.

## Demo mode

`TRAVEL_ADVICE_PROVIDER` defaults to `fixture`, which reads a payload shaped
like the GOV.UK Content API from the repository: no network. While
`ARC_DATA_MODE=demo`, the live `govuk` provider is a startup error, as a live
payment provider is.

The fixture is **not** a recording. This environment could not reach
`www.gov.uk`, so its text is a short, conservative summary written for the demo
in the API's shape. The guest card says so in a demo marker ("Demo text in the
shape of GOV.UK advice, not the live page"). Replace it with a recorded payload
before a pilot.

## Legal positioning

ARC provides sourced travel information. It is not legal advice and not an
entry or visa decision. For anything with real consequences, the card sends the
guest to the cited authority.

## Not ported, on purpose

- **The Expo mobile app.** ADR-012: the guest portal is a PWA reached from a QR
  code.
- **The FastAPI service and TS SDK.** ADR-001: one deployable. A route handler
  can be added if an external consumer ever appears.
- **The State Dept, GDACS, ReliefWeb and other adapters.** The registry listed
  them, but only GOV.UK had an implementation. Each is one new
  `TravelAdviceProvider` (or a sibling interface) when needed.
- **The factory scripts and prompts.** They duplicate `.claude/agents/`.

The upload of the standalone repo was missing `apps/web` (its brief and explain
routes), `apps/mobile`, CI and the eval README. Their behaviour is re-specified
by this document and the module's tests, not recovered.

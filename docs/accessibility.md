# Accessibility

## Where this stands

WCAG 2.1 AA, checked automatically on every acceptance run by
`tests/e2e/10-accessibility.spec.ts` across nine surfaces: the public
destination pages, the experiences catalogue, sign-in, the guest portal in
English and Spanish, the guest basket, owner, partner and admin, and the guest
portal at 390px.

All nine pass. That is a weaker statement than it sounds, and the next section
says why.

## What the first audit found

Every surface in the product failed, on one colour.

`text-sand-500` was the subtle-text token — 166 uses, every one of them text —
and at its old lightness it scored **2.98:1** against white. AA wants 4.5:1 for
body text. It was the timestamp on every row, the caption under every figure,
the hint under every form field.

The fix was the palette, not 166 files. `sand-400` through `sand-700` are now
set by contrast against the *worst* light surface they sit on, which is
`sand-100` rather than white:

| | was | now |
| --- | --- | --- |
| `sand-400` (borders, icons) | 1.99:1 | 3.07:1 |
| `sand-500` (subtle text) | 2.98:1 | 4.92:1 |
| `sand-600` | 4.47:1 | 6.64:1 |
| `sand-700` | 7.34:1 | 8.76:1 |

`sand-400` is not a text colour, and `text-sand-400` appeared in a dozen places;
all of them are `text-sand-500` now. 3.07:1 is the right number for the boundary
of a UI component (WCAG 1.4.11, which no automated check verifies) and the wrong
one for a timestamp.

Four other findings, each its own small lesson:

- **`--color-gold-deep`** passed on white and failed on `--color-ivory`, which
  is the explore surface's own background. A colour that passes where it was
  chosen and fails where it is used.
- **`opacity-60`** on the locale switcher. Opacity multiplies against whatever
  is behind it, so the resulting contrast is not a number anyone can state. An
  explicit colour is checkable; this one came out under 4.5:1.
- **`aria-label` on the brand link** did not contain its own visible text, so a
  voice-control user saying "click ARC Travel" could not activate it
  (WCAG 2.5.3). The two spans already read "ARC Travel"; naming it again,
  differently, only broke it.
- **`text-jade-700/70`** on the AI provenance line — "Written by … It can
  rephrase them; it cannot add to them" — at 3.1:1. The disclosure that exists
  because the AI must never appear to decide was the least readable text on the
  page. This one only appeared once a guest had generated an itinerary, so a
  clean-seed audit missed it; it was caught by running the accessibility spec
  after the rest of the suite had used the app.

## What an automated audit cannot tell you

Axe finds perhaps a third of what a real audit finds, and the nine passing
surfaces should be read as "no machine-detectable failures", not "accessible".

Still needed from a person, and not claimed here:

- **A screen reader, in both languages.** `html[lang]` switches and the copy is
  complete, which is necessary and not sufficient. Nobody has listened to the
  conditions card, the itinerary reasoning or the basket in VoiceOver or NVDA,
  in English or in Spanish.
- **Keyboard-only completion of each journey.** Focus order, focus visibility
  and whether the mobile tab bar can be reached and left are unverified beyond
  what axe infers from the DOM.
- **Whether the labels make sense.** Axe checks that a field has an accessible
  name, not that the name helps. "Ability" on the intake form is the kind of
  thing only a person can judge.
- **Error recovery.** Every form reports failures through `FormState`; whether
  the message says what to do next, announced at the right moment, is a human
  question.
- **Motion and reduced motion.** `prefers-reduced-motion` is not currently
  honoured anywhere, which is a real gap and a small one to close.
- **The conditions card specifically.** It is the surface where a
  misunderstanding has physical consequences — a guest deciding about surf. It
  deserves testing with people, not only with a checker.

## Running it

```bash
npx playwright test tests/e2e/10-accessibility.spec.ts
```

It runs as part of `npm run test:e2e`. A regression is a failing test rather
than something the next audit discovers, which is the whole reason it is a spec
and not a report.

Changing a `--color-sand-*` or `--color-gold-*` value is a contrast decision.
Re-run this spec after.

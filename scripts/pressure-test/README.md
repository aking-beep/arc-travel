# Persona pressure test

Six simulated people, each with a goal rather than a test case, driving a real
browser through the product and recording what they saw.

```bash
npm run setup                        # a seeded database
npm run build && npm run start -- --port 3100
npm run pressure-test                # all six
npm run pressure-test -- --only=adversary,hotel-guest
```

`PRESSURE_BASE_URL` picks the target (default `http://127.0.0.1:3100`) and
`PRESSURE_OUT_DIR` where the output goes (default `pressure-test-output/`,
gitignored): `findings.json`, `readout.html`, and a screenshot of every
expectation that did not hold.

| Persona | Who |
| --- | --- |
| `hotel-owner` | Elena at Casa Olas: briefing, arrivals, approvals, revenue, publishing a listing |
| `supplier-partner` | Mariana at Escuela Olas Verdes: her business page, a draft listing, her price, her earnings |
| `hotel-guest` | Harriet in house: intake, itinerary, the conditions gate, checkout, cancelling |
| `direct-traveller` | Sam with no hotel: the public site, the planner, direct sign-up, buying |
| `arc-admin` | The verification queue, the health page, the machine endpoints |
| `adversary` | Another guest's booking, a hostile redirect, a tampered form, and three people racing for one seat |

## Two things to know before adding a persona

**A probe's string return is a failure.** `check()` takes `true` for a pass, a
bare string for a failure carrying its evidence, and `held('…')` for a pass that
wants to record what it saw. The first version treated any string as a pass and
reported 110 of 110 expectations holding — several of them with evidence that
said the opposite. The ambiguous direction has to be the failing one.

**`isVisible()` does not wait.** It answers about this instant and ignores its
`timeout`, so it returned false for copy an in-flight server action was about to
render, which reads as a missing refusal and is not one. Use `agent.visible()`,
which waits.

## What a persona must not do

The agent harness refuses these at the tool boundary
(`.claude/hooks/deny-dangerous.mjs`), and a persona has no business trying:
write a supplier's verification or insurance check, author a `ConditionReport`,
turn on outbound messaging, or touch a deployment. The admin persona therefore
pushes on the *refusals* — verifying with an empty checklist — rather than
awarding a badge nobody earned.

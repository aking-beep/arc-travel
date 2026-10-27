# The live simulation

Six simulated people using the demo while somebody watches `/admin/simulation`.

```bash
SIMULATION_BASE_URL=https://arc-stay-demo.vercel.app \
SIMULATION_TOKEN=… ANTHROPIC_API_KEY=… \
npm run simulate -- --model=claude-sonnet-5-5 --budget=5.00
```

| Flag | Means |
| --- | --- |
| `--model` | `claude-haiku-5-5`, `claude-sonnet-5-5` (default) or `claude-opus-5-5` |
| `--budget` | The ceiling, in dollars. The run stops there |
| `--cycles` | How many times round the six. Omit to run until stopped |
| `--only` | `--only=hotel-guest,adversary` |

## What this is, and what the suite next door is

`scripts/pressure-test/` walks the same six personas through *written*
journeys and asserts a fixed list of expectations. That is the acceptance
test: deterministic, free, and the thing that should fail a build.

This is the other half. The briefs are written down — the goal, the handful of
facts the person has, and the promises the product makes in that person's terms
— and what they do next is decided a step at a time. The paths are therefore
new every cycle, which is the entire point: the bugs a written journey finds
are the ones somebody already thought of.

## One call per step, doing three things

Each step sends the page the last action produced and gets back a judgement on
the expectation stated last step, what the person does now, and what they
expect of the product next. Judging the previous expectation in the same call
halves the bill and loses nothing — the evidence is the page the call already
has in front of it.

The two claims the product promises never to make — that something is *safe*,
and that a partner is *verified* — are **not** left to the model. They are
checked deterministically on every page by `scripts/pressure-test/claims.ts`,
which strips the refusals first so "it cannot tell you a beach is safe" is not
read as a safety claim. The model's invariant-watching is the wider net; these
two are the ones that must never miss.

Two habits inherited from the pressure test, both learned the hard way: the
browser is resolved the way `playwright.config.ts` resolves it rather than
hardcoded, and a page is read only once its loading state has gone — a model
call spent deciding about a skeleton is a call spent twice.

## The cost, and the ceiling

Every step is one model call, so the bill is the pace times the model. At the
pace a real browser allows — roughly 420 decisions an hour — an hour costs
about $0.30 on Haiku, $6 on Sonnet and $12 on Opus. `/admin/simulation` shows
the estimates and, more usefully, the meter.

The ceiling is enforced by the deployment, not by the runner. The runner
reports tokens; `src/modules/simulation/service.ts` turns them into money with
`pricing.ts` and answers `stop`. One arbiter, and it is the one the operator
can see.

## The one thing it refuses

It asks the target what it is before it does anything, and runs only against
an answer of `demo`. Not a flag and not a URL pattern — the deployment's own
statement. The personas invent guests, race three ways for one seat and probe
refusals; there is exactly one kind of data that may happen to.

Three independent refusals, because one would eventually be the one that was
bypassed:

1. The preflight here.
2. `SIMULATION_TOKEN` is refused by `src/lib/env.ts` outside `ARC_DATA_MODE=demo`,
   so the live deployment cannot hold a usable token at all.
3. `simulation_run_is_demo_only` refuses the row in the database.

See ADR-043.

## What a persona may propose

A persona that sees something fail may propose an amendment to one `.claude/`
file. It may never propose *relaxing* anything — removing a deny-list entry,
turning outbound messaging on, adding a "safe today" badge, letting an agent
apply its own change. `src/modules/simulation/guardrails.ts` refuses those and
records the attempt as a `GUARD` event, because a refusal nobody is told about
looks exactly like a simulation that never tried.

Accepting a proposal on the dashboard records that it should happen. It does
not happen: nothing here writes `.claude/`, and the amendment becomes a pull
request a person opens.

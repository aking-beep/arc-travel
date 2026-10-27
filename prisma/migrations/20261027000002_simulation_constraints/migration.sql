-- ---------------------------------------------------------------------------
-- The constraints added for ADR-043, verbatim from the tail of
-- `prisma/constraints.sql`.
--
-- A new constraints migration rather than an edit to an applied one: `migrate
-- deploy` never re-runs a recorded migration, so an edit would land on fresh
-- databases and miss every running deployment. `tests/unit/migrations.test.ts`
-- checks that `constraints.sql` equals the concatenation of every
-- `*_constraints` migration, so the next one goes in a new directory too.
-- ---------------------------------------------------------------------------
-- A simulation only ever runs against synthetic data.
--
-- The personas invent guests, race three ways for one seat and probe refusals.
-- Doing that to a real hotel's data is the thing this must never be able to
-- become, and "we point it at the demo" is a convention somebody eventually
-- forgets on a Friday. The runner refuses a target whose health endpoint does
-- not say `demo`; this refuses the row even if that check is bypassed, so a
-- run against the live hotel has nowhere to be recorded. ADR-043.
ALTER TABLE "SimulationRun" DROP CONSTRAINT IF EXISTS "simulation_run_is_demo_only";
ALTER TABLE "SimulationRun" ADD CONSTRAINT "simulation_run_is_demo_only" CHECK (
  "dataMode" = 'demo'
);

-- Spend is bounded, and the bound is a real number.
--
-- The budget is what stops a dashboard left open overnight. A run with a
-- non-positive ceiling, or a negative spend, is a run whose cap means nothing.
ALTER TABLE "SimulationRun" DROP CONSTRAINT IF EXISTS "simulation_run_budget_is_bounded";
ALTER TABLE "SimulationRun" ADD CONSTRAINT "simulation_run_budget_is_bounded" CHECK (
  "budgetMinor" > 0
  AND "spentMinor" >= 0
  AND "inputTokens" >= 0
  AND "outputTokens" >= 0
  AND "decisions" >= 0
);

-- A verdict belongs to a check, and only to a check.
--
-- A `DECISION` row carrying a verdict would be counted in the readout's held
-- and failed totals, which are the two numbers an operator reads first.
ALTER TABLE "SimulationEvent" DROP CONSTRAINT IF EXISTS "simulation_event_verdict_is_a_check";
ALTER TABLE "SimulationEvent" ADD CONSTRAINT "simulation_event_verdict_is_a_check" CHECK (
  ("kind" = 'CHECK' AND "verdict" IS NOT NULL)
  OR ("kind" <> 'CHECK' AND "verdict" IS NULL)
);

-- A proposal amends a harness file and nothing else.
--
-- The harness rules let an agent propose an amendment and never apply one. The
-- allow-list here is the second half of that: a proposal that named
-- `src/modules/...` or `prisma/schema.prisma` would be a suggested change to
-- the product dressed as a suggested change to a guardrail. ADR-043.
ALTER TABLE "SimulationProposal" DROP CONSTRAINT IF EXISTS "simulation_proposal_targets_the_harness";
ALTER TABLE "SimulationProposal" ADD CONSTRAINT "simulation_proposal_targets_the_harness" CHECK (
  "targetPath" LIKE '.claude/%'
  AND "targetPath" NOT LIKE '%..%'
  AND length(btrim("miss")) > 0
  AND length(btrim("suggestion")) > 0
);

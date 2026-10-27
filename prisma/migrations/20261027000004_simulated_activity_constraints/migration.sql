-- ---------------------------------------------------------------------------
-- The constraint added for ADR-044, verbatim from the tail of
-- `prisma/constraints.sql`.
--
-- A new constraints migration rather than an edit to an applied one: `migrate
-- deploy` never re-runs a recorded migration, so an edit would land on fresh
-- databases and miss every running deployment. `tests/unit/migrations.test.ts`
-- checks that `constraints.sql` equals the concatenation of every
-- `*_constraints` migration, so the next one goes in a new directory too.
-- ---------------------------------------------------------------------------
-- The inhabitants only ever live in a demo.
--
-- The simulated population books real orders through the real services: holds,
-- commission splits, ledger entries, audit rows. Against a hotel's own data
-- that is not a simulation, it is forgery. `tick` refuses outside
-- `ARC_DATA_MODE=demo` and both clocks 404 there; this refuses the row, so a
-- deployment holding real data has nowhere to record an invented guest.
-- ADR-044.
ALTER TABLE "SimulatedActivity" DROP CONSTRAINT IF EXISTS "simulated_activity_is_demo_only";
ALTER TABLE "SimulatedActivity" ADD CONSTRAINT "simulated_activity_is_demo_only" CHECK (
  "dataMode" = 'demo'
  AND "source" IN ('cron', 'heartbeat')
);

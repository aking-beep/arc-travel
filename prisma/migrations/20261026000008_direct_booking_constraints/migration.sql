-- ---------------------------------------------------------------------------
-- The constraints added for ADR-042, verbatim from the tail of
-- `prisma/constraints.sql`.
--
-- A new constraints migration rather than an edit to an applied one: `migrate
-- deploy` never re-runs a recorded migration, so an edit would land on fresh
-- databases and miss every running deployment. `tests/unit/migrations.test.ts`
-- checks that `constraints.sql` equals the concatenation of every
-- `*_constraints` migration, so the next one goes in a new directory too.
-- ---------------------------------------------------------------------------

-- A direct trip is not a room booking, and nothing may let it read as one.
--
-- No room type and no room revenue: a direct trip that carried either would
-- show up in occupancy, in room revenue, and in the arrivals list the front
-- desk works from — three places where somebody would act on a room that was
-- never booked. ADR-042.
ALTER TABLE "Stay" DROP CONSTRAINT IF EXISTS "direct_stay_has_no_room";
ALTER TABLE "Stay" ADD CONSTRAINT "direct_stay_has_no_room" CHECK (
  "kind" <> 'DIRECT'
  OR ("roomTypeId" IS NULL AND "roomRevenueMinor" = 0)
);

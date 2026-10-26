-- ---------------------------------------------------------------------------
-- The constraints added for ADR-036, verbatim from the tail of
-- `prisma/constraints.sql`.
--
-- A second constraints migration rather than an edit to
-- `20261025000001_constraints`: a deployment that has already applied that one
-- will never apply it again, so editing it would mean the constraint existed on
-- a fresh database and not on the hosted demo. `tests/unit/migrations.test.ts`
-- checks that `constraints.sql` equals the concatenation of every
-- `*_constraints` migration, so the next one goes in a new directory too.
-- ---------------------------------------------------------------------------

-- A verified partner carries the evidence for it.
--
-- The service enforces the full required-check list (it knows which keys are
-- required); the database enforces the part that cannot drift: VERIFIED is not
-- reachable with an empty checklist, and an insurance expiry is never recorded
-- without the insurance check that it dates. ADR-036.
ALTER TABLE "Supplier" DROP CONSTRAINT IF EXISTS "supplier_verified_is_evidenced";
ALTER TABLE "Supplier" ADD CONSTRAINT "supplier_verified_is_evidenced" CHECK (
  "verification" <> 'VERIFIED'
  OR (array_length("verifiedChecks", 1) IS NOT NULL AND "verificationNotes" IS NOT NULL)
);

ALTER TABLE "Supplier" DROP CONSTRAINT IF EXISTS "supplier_insurance_expiry_is_dated";
ALTER TABLE "Supplier" ADD CONSTRAINT "supplier_insurance_expiry_is_dated" CHECK (
  "insuranceExpiresOn" IS NULL OR 'insurance' = ANY("verifiedChecks")
);

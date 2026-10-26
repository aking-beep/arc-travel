-- ---------------------------------------------------------------------------
-- Re-declare the two ADR-036 Supplier constraints as NOT VALID.
--
-- `20261026000001_verification_constraints` added them validating, which
-- checks every existing row. That fails on exactly the rows ADR-036 is about: a
-- partner verified before this release has an empty `verifiedChecks` and no
-- notes, because the service that recorded the decision had no checklist to
-- fill in. A deployment carrying one such row would stop mid-migration.
--
-- Demoting those rows is not the answer either. ADR-036 keeps the stored
-- decision — it was correct on the evidence available — and changes only what
-- ARC *derives* from it: `verificationStanding` reads an incomplete checklist
-- as lapsed, so no badge is shown and nothing is unpublished.
--
-- NOT VALID says precisely that: every insert and update from here on must
-- carry its evidence, and the rows that predate the rule keep their recorded
-- history. Run `VALIDATE CONSTRAINT` once a database has none left.
--
-- A third constraints migration rather than an edit to the second: `migrate
-- deploy` never re-runs a recorded migration, so editing it would leave the
-- validating version on every database that already applied it.
-- ---------------------------------------------------------------------------

ALTER TABLE "Supplier" DROP CONSTRAINT IF EXISTS "supplier_verified_is_evidenced";
ALTER TABLE "Supplier" ADD CONSTRAINT "supplier_verified_is_evidenced" CHECK (
  "verification" <> 'VERIFIED'
  OR (array_length("verifiedChecks", 1) IS NOT NULL AND "verificationNotes" IS NOT NULL)
) NOT VALID;

ALTER TABLE "Supplier" DROP CONSTRAINT IF EXISTS "supplier_insurance_expiry_is_dated";
ALTER TABLE "Supplier" ADD CONSTRAINT "supplier_insurance_expiry_is_dated" CHECK (
  "insuranceExpiresOn" IS NULL OR 'insurance' = ANY("verifiedChecks")
) NOT VALID;

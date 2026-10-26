-- ---------------------------------------------------------------------------
-- The constraints added for ADR-041, verbatim from the tail of
-- `prisma/constraints.sql`.
--
-- A new constraints migration rather than an edit to an applied one: `migrate
-- deploy` never re-runs a recorded migration, so an edit would land on fresh
-- databases and miss every running deployment. `tests/unit/migrations.test.ts`
-- checks that `constraints.sql` equals the concatenation of every
-- `*_constraints` migration, so the next one goes in a new directory too.
--
-- `supplier_insurance_on_file_is_checked` is declared NOT VALID below for the
-- same reason the two ADR-036 constraints are: the rows it rejects are the
-- pre-ADR ones that ADR deliberately keeps.
-- ---------------------------------------------------------------------------

-- A decided join request records when, and an undecided one records nothing.
--
-- The owner surface splits on `status`, and a request reading ACCEPTED with no
-- `decidedAt` is one nobody can account for — which matters because accepting
-- one creates a commercial relationship (ADR-041).
ALTER TABLE "SupplierJoinRequest" DROP CONSTRAINT IF EXISTS "join_request_decision_is_dated";
ALTER TABLE "SupplierJoinRequest" ADD CONSTRAINT "join_request_decision_is_dated" CHECK (
  ("status" = 'PENDING') = ("decidedAt" IS NULL)
);

-- An accepted request names the supplier it created.
--
-- Otherwise "accepted" is a claim with nothing behind it, and the owner cannot
-- get from the request to the partner it became.
ALTER TABLE "SupplierJoinRequest" DROP CONSTRAINT IF EXISTS "join_request_accepted_has_supplier";
ALTER TABLE "SupplierJoinRequest" ADD CONSTRAINT "join_request_accepted_has_supplier" CHECK (
  "status" <> 'ACCEPTED' OR "createdSupplierId" IS NOT NULL
);

-- A request has a business, a person and somewhere to reply to.
ALTER TABLE "SupplierJoinRequest" DROP CONSTRAINT IF EXISTS "join_request_has_contact";
ALTER TABLE "SupplierJoinRequest" ADD CONSTRAINT "join_request_has_contact" CHECK (
  length(btrim("businessName")) > 0
  AND length(btrim("contactName")) > 0
  AND length(btrim("contactEmail")) > 0
);

-- A partner's insurance *claim* never stands in for ARC's own check.
--
-- `insuranceOnFile` is written only by the admin verification path, after
-- somebody has looked at a certificate. This forbids the one shortcut that
-- would quietly turn a self-assertion into a verified fact: a row marked as
-- having insurance on file, with an expiry, where the only expiry anybody
-- supplied is the partner's own claim and no check was ever recorded. ADR-041.
ALTER TABLE "Supplier" DROP CONSTRAINT IF EXISTS "supplier_insurance_on_file_is_checked";
ALTER TABLE "Supplier" ADD CONSTRAINT "supplier_insurance_on_file_is_checked" CHECK (
  "insuranceOnFile" = false
  OR array_length("verifiedChecks", 1) IS NOT NULL
) NOT VALID;

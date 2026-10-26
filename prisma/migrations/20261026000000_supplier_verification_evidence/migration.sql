-- Structured evidence for a partner verification, and an expiry for the
-- insurance it rests on.
--
-- `verification = 'VERIFIED'` used to be backed by a free-text note with a
-- ten-character minimum, and `insuranceOnFile` was a boolean. A boolean cannot
-- expire and liability insurance does, so a partner verified in January on a
-- certificate that ran out in March was still shown to guests as verified in
-- December. See ADR-036 and src/modules/admin/verification.ts.
--
-- Both columns are additive and nullable/defaulted, so this migration is safe
-- on existing rows. What it does NOT do is backfill: an existing VERIFIED
-- supplier has an empty `verifiedChecks` and no expiry, which
-- `verificationStanding` reports as lapsed. That is the intended outcome rather
-- than an oversight — nobody can say what was checked for those rows, and
-- inventing a checklist for them would be inventing verification.

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "insuranceExpiresOn" DATE,
ADD COLUMN     "verifiedChecks" TEXT[] DEFAULT ARRAY[]::TEXT[];

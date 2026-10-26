-- Guest accounts: one person, many guest records.
--
-- `Guest.userId` carried a UNIQUE constraint, which modelled a person as the
-- guest of at most one property. That was true only because nothing created
-- guest accounts: the column was written by `signInWithPortalToken` and the
-- seed, never by a guest. Now that a guest can sign up and claim a booking,
-- the constraint is the thing that would stop the second hotel they stay at
-- from ever appearing in their account.
--
-- A `Guest` is a person *at one property* — it carries that property's copy of
-- their preferences, intake and consents, and `@@unique([propertyId, email])`
-- already says there is one per property per address. The account is the
-- person. See ADR-039.
--
-- Dropping a unique index cannot fail on existing data, and the plain index
-- that replaces it is what `Guest.findMany({ where: { userId } })` reads.

-- DropIndex
DROP INDEX "Guest_userId_key";

-- CreateIndex
CREATE INDEX "Guest_userId_idx" ON "Guest"("userId");

-- ---------------------------------------------------------------------------
-- The constraints added for ADR-040, verbatim from the tail of
-- `prisma/constraints.sql`.
--
-- A new constraints migration rather than an edit to an applied one: `migrate
-- deploy` never re-runs a recorded migration, so an edit would land on fresh
-- databases and miss every running deployment. `tests/unit/migrations.test.ts`
-- checks that `constraints.sql` equals the concatenation of every
-- `*_constraints` migration, so the next one goes in a new directory too.
-- ---------------------------------------------------------------------------

-- An email message's status and its timestamps say the same thing.
--
-- The dispatcher decides what to retry by reading `status`, and a support
-- question is answered by reading `sentAt`. A row claiming SENT with no
-- `sentAt`, or FAILED with no `failedAt`, is a row where those two answers
-- disagree — and the disagreement surfaces as "we sent it" to a hotel whose
-- partner never received anything. ADR-040.
ALTER TABLE "EmailMessage" DROP CONSTRAINT IF EXISTS "email_status_matches_timestamps";
ALTER TABLE "EmailMessage" ADD CONSTRAINT "email_status_matches_timestamps" CHECK (
  ("status" <> 'SENT' OR "sentAt" IS NOT NULL)
  AND ("status" <> 'FAILED' OR "failedAt" IS NOT NULL)
  AND ("status" <> 'QUEUED' OR ("sentAt" IS NULL AND "failedAt" IS NULL))
);

-- Attempts only ever go up, and a delivered message was attempted at least once.
ALTER TABLE "EmailMessage" DROP CONSTRAINT IF EXISTS "email_attempts_sane";
ALTER TABLE "EmailMessage" ADD CONSTRAINT "email_attempts_sane" CHECK (
  "attempts" >= 0 AND ("status" NOT IN ('SENT', 'FAILED') OR "attempts" >= 1)
);

-- A message has somewhere to go and something to say. An empty recipient is
-- how a queue acquires a row that can never succeed and is retried for ever.
ALTER TABLE "EmailMessage" DROP CONSTRAINT IF EXISTS "email_has_recipient_and_subject";
ALTER TABLE "EmailMessage" ADD CONSTRAINT "email_has_recipient_and_subject" CHECK (
  length(btrim("toAddress")) > 0 AND length(btrim("subject")) > 0 AND length(btrim("body")) > 0
);

-- A password reset expires after it is created, and is used at most once.
--
-- A window that closes before it opens is a reset nobody can complete; a
-- negative one is a reset that never closes if anything ever compares the
-- other way round. Both are cheap to forbid.
ALTER TABLE "PasswordResetToken" DROP CONSTRAINT IF EXISTS "password_reset_window_is_forward";
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "password_reset_window_is_forward" CHECK (
  "expiresAt" > "createdAt"
);

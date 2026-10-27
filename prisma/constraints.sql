-- ---------------------------------------------------------------------------
-- Database-level invariants.
--
-- Prisma's schema language cannot express CHECK constraints, so they live here
-- and are applied by `npm run setup` and by the test harness.
--
-- These exist because every guarantee in this product was enforced only in
-- application code, which means a bug in that code corrupts data silently. A
-- review found two such bugs — a concurrent cancellation double-decrementing
-- `booked`, and a checkout committing a stale line quantity — both of which
-- left the counters wrong with nothing firing. A CHECK turns that class of
-- defect into a loud failure at the moment it happens, rather than a wrong
-- number discovered weeks later by an owner.
--
-- Written idempotently so they can be re-applied after any `db push`.
-- ---------------------------------------------------------------------------

-- Capacity is the truth. Nothing may commit or reserve more than exists, and
-- neither counter may go negative.
ALTER TABLE "AvailabilitySlot" DROP CONSTRAINT IF EXISTS "slot_capacity_invariant";
ALTER TABLE "AvailabilitySlot" ADD CONSTRAINT "slot_capacity_invariant"
  CHECK ("booked" >= 0 AND "held" >= 0 AND "booked" + "held" <= "capacity");

ALTER TABLE "AvailabilitySlot" DROP CONSTRAINT IF EXISTS "slot_capacity_positive";
ALTER TABLE "AvailabilitySlot" ADD CONSTRAINT "slot_capacity_positive"
  CHECK ("capacity" >= 0);

-- A hold reserves a positive number of places.
ALTER TABLE "InventoryHold" DROP CONSTRAINT IF EXISTS "hold_quantity_positive";
ALTER TABLE "InventoryHold" ADD CONSTRAINT "hold_quantity_positive"
  CHECK ("quantity" > 0);

-- Money is never negative on a sale, and a refund never exceeds the line.
ALTER TABLE "OrderItem" DROP CONSTRAINT IF EXISTS "order_item_money_sane";
ALTER TABLE "OrderItem" ADD CONSTRAINT "order_item_money_sane"
  CHECK (
    "quantity" > 0
    AND "unitPriceMinor" >= 0
    AND "bookingFeeMinor" >= 0
    AND "lineTotalMinor" >= 0
    AND "refundedMinor" >= 0
    AND "refundedMinor" <= "lineTotalMinor"
  );

ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "order_money_sane";
ALTER TABLE "Order" ADD CONSTRAINT "order_money_sane"
  CHECK (
    "subtotalMinor" >= 0
    AND "feesMinor" >= 0
    AND "totalMinor" >= 0
    AND "refundedMinor" >= 0
    AND "refundedMinor" <= "totalMinor"
  );

-- A confirmed order's three shares must account for exactly its total. This is
-- asserted in the checkout transaction too; here it is also true of any other
-- writer, including a future migration or a manual fix.
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "order_split_reconciles";
ALTER TABLE "Order" ADD CONSTRAINT "order_split_reconciles"
  CHECK (
    "status" <> 'CONFIRMED'
    OR "hotelEarningsMinor" + "platformEarningsMinor" + "supplierPayableMinor" = "totalMinor"
  );

-- Commission shares are expressed in basis points and cannot exceed the whole.
ALTER TABLE "CommissionRule" DROP CONSTRAINT IF EXISTS "commission_shares_sane";
ALTER TABLE "CommissionRule" ADD CONSTRAINT "commission_shares_sane"
  CHECK (
    "hotelShare" >= 0
    AND "platformShare" >= 0
    AND ("basis" <> 'PERCENT_OF_GROSS' OR "hotelShare" + "platformShare" <= 10000)
  );

-- A departure ends after it starts, and a stay checks out after it checks in.
ALTER TABLE "AvailabilitySlot" DROP CONSTRAINT IF EXISTS "slot_time_ordered";
ALTER TABLE "AvailabilitySlot" ADD CONSTRAINT "slot_time_ordered"
  CHECK ("endsAt" > "startsAt");

ALTER TABLE "Stay" DROP CONSTRAINT IF EXISTS "stay_dates_ordered";
ALTER TABLE "Stay" ADD CONSTRAINT "stay_dates_ordered"
  CHECK ("checkOut" >= "checkIn");

-- Conditions readings: a maximum below its minimum is a data-entry error, and
-- the safety gate reads both.
ALTER TABLE "ConditionReport" DROP CONSTRAINT IF EXISTS "conditions_wave_range";
ALTER TABLE "ConditionReport" ADD CONSTRAINT "conditions_wave_range"
  CHECK ("waveHeightMaxM" >= "waveHeightMinM" AND "waveHeightMinM" >= 0);

-- A culture-source check either has content and its hash, or a failure reason.
-- A successful check with no hash would let change detection compare nothing.
ALTER TABLE "CultureSourceSnapshot" DROP CONSTRAINT IF EXISTS "culture_snapshot_ok_has_hash";
ALTER TABLE "CultureSourceSnapshot" ADD CONSTRAINT "culture_snapshot_ok_has_hash"
  CHECK (
    ("ok" AND "contentHash" IS NOT NULL AND "failureReason" IS NULL)
    OR (NOT "ok" AND "contentHash" IS NULL AND "failureReason" IS NOT NULL)
  );

-- A verified change names who verified it and when. "Verified" without a
-- reviewer is the claim this product refuses to make.
ALTER TABLE "CultureSourceChange" DROP CONSTRAINT IF EXISTS "culture_change_verified_has_reviewer";
ALTER TABLE "CultureSourceChange" ADD CONSTRAINT "culture_change_verified_has_reviewer"
  CHECK ("verification" <> 'VERIFIED' OR ("reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL));

-- A payout's total is the sum of the lines it claimed. Asserted in the
-- transaction that writes it too; here it is also true of any other writer,
-- which for a table about money leaving the business is the point.
--
-- Written as a trigger rather than a CHECK because a CHECK cannot read another
-- table. The alternative — trusting the service — is the thing ADR-020 exists
-- to stop doing with invariants that matter.
CREATE OR REPLACE FUNCTION arc_assert_payout_balances() RETURNS trigger AS $$
DECLARE
  line_total integer;
  declared integer;
  payout_status text;
BEGIN
  SELECT "netMinor", "status"::text INTO declared, payout_status
    FROM "Payout" WHERE "id" = COALESCE(NEW."payoutId", OLD."payoutId");

  -- A cancelled payout has had its lines deleted on purpose, to release the
  -- ledger entries. Holding it to its original total would make cancelling
  -- impossible.
  IF payout_status = 'CANCELLED' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(SUM("amountMinor"), 0) INTO line_total
    FROM "PayoutLine" WHERE "payoutId" = COALESCE(NEW."payoutId", OLD."payoutId");

  IF line_total <> declared THEN
    RAISE EXCEPTION
      'Payout % declares % but its lines sum to %',
      COALESCE(NEW."payoutId", OLD."payoutId"), declared, line_total;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "payout_balances" ON "PayoutLine";
CREATE CONSTRAINT TRIGGER "payout_balances"
  AFTER INSERT OR UPDATE OR DELETE ON "PayoutLine"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION arc_assert_payout_balances();

-- A payout that says it was paid says how, by whom and when. "Settled" with no
-- reference is the claim this product refuses to make about money.
ALTER TABLE "Payout" DROP CONSTRAINT IF EXISTS "payout_settled_is_evidenced";
ALTER TABLE "Payout" ADD CONSTRAINT "payout_settled_is_evidenced"
  CHECK (
    "status" <> 'SETTLED'
    OR (
      "settlementReference" IS NOT NULL
      AND "settlementMethod" IS NOT NULL
      AND "settledAt" IS NOT NULL
      AND "settledById" IS NOT NULL
    )
  );

-- A payout is for a positive amount over a period that does not run backwards.
-- A zero or negative net carries to the next run instead (ADR-032); creating
-- one here would mean either a remittance for no money or ARC invoicing a
-- partner, and the product does neither.
ALTER TABLE "Payout" DROP CONSTRAINT IF EXISTS "payout_sane";
ALTER TABLE "Payout" ADD CONSTRAINT "payout_sane"
  CHECK ("netMinor" > 0 AND "periodEnd" >= "periodStart");

-- Anything past DRAFT was authorised by an approved proposal. The service
-- checks the proposal itself; this stops a status being advanced without one.
ALTER TABLE "Payout" DROP CONSTRAINT IF EXISTS "payout_approved_has_proposal";
ALTER TABLE "Payout" ADD CONSTRAINT "payout_approved_has_proposal"
  CHECK ("status" IN ('DRAFT', 'CANCELLED') OR "proposalId" IS NOT NULL);

-- A reported reversal names its cause and the provider event that reported it.
-- A reversal flag with no provenance cannot be reconciled against the
-- provider, which is the only thing it is for.
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "order_reversal_has_provenance";
ALTER TABLE "Order" ADD CONSTRAINT "order_reversal_has_provenance"
  CHECK (
    "reversalReportedAt" IS NULL
    OR ("reversalCause" IS NOT NULL AND "reversalEventId" IS NOT NULL AND "reversedMinor" >= 0)
  );

-- A verified partner carries the evidence for it.
--
-- The service enforces the full required-check list (it knows which keys are
-- required); the database enforces the part that cannot drift: VERIFIED is not
-- reachable with an empty checklist, and an insurance expiry is never recorded
-- without the insurance check that it dates. ADR-036.
--
-- Declared NOT VALID. Adding them validating checks every existing row, and the
-- rows they reject are exactly the ones ADR-036 is about: a partner verified
-- before that release has an empty checklist, because the service that recorded
-- the decision had no checklist to fill in. ARC keeps that recorded decision and
-- changes only what it derives from it — `verificationStanding` reads an
-- incomplete checklist as lapsed — so the constraint must bind new writes
-- without rejecting old rows. Validate it once a database has none left.
ALTER TABLE "Supplier" DROP CONSTRAINT IF EXISTS "supplier_verified_is_evidenced";
ALTER TABLE "Supplier" ADD CONSTRAINT "supplier_verified_is_evidenced" CHECK (
  "verification" <> 'VERIFIED'
  OR (array_length("verifiedChecks", 1) IS NOT NULL AND "verificationNotes" IS NOT NULL)
) NOT VALID;

ALTER TABLE "Supplier" DROP CONSTRAINT IF EXISTS "supplier_insurance_expiry_is_dated";
ALTER TABLE "Supplier" ADD CONSTRAINT "supplier_insurance_expiry_is_dated" CHECK (
  "insuranceExpiresOn" IS NULL OR 'insurance' = ANY("verifiedChecks")
) NOT VALID;

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

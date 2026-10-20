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

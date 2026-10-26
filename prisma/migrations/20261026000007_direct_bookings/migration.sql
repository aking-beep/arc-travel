-- A direct consumer: experiences booked without a room. See ADR-042.
--
-- `Stay` gains a discriminator rather than `Cart.stayId` and `Order.stayId`
-- becoming optional. The entire guest surface — the portal, the itinerary, the
-- basket, checkout, the conditions gate — hangs off a stay's dates, party and
-- token, and a null stay would mean a second code path through every one of
-- them. A row that carries the same fields and says what it is costs one
-- column and one filter on the surfaces that mean "room booking".
--
-- Additive, with a default that makes every existing row what it already was.

-- CreateEnum
CREATE TYPE "StayKind" AS ENUM ('HOTEL_RESERVATION', 'DIRECT');

-- AlterTable
ALTER TABLE "Stay" ADD COLUMN     "kind" "StayKind" NOT NULL DEFAULT 'HOTEL_RESERVATION';

-- CreateIndex
CREATE INDEX "Stay_propertyId_kind_status_idx" ON "Stay"("propertyId", "kind", "status");

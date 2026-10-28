-- CreateEnum
CREATE TYPE "SimulatedActivityKind" AS ENUM ('ARRIVAL', 'INTAKE', 'RESERVATION', 'BASKET', 'PURCHASE', 'CANCELLATION', 'JOIN_REQUEST', 'CHECK_IN', 'HORIZON', 'QUIET');

-- CreateTable
CREATE TABLE "SimulatedActivity" (
    "id" TEXT NOT NULL,
    "kind" "SimulatedActivityKind" NOT NULL,
    "source" TEXT NOT NULL,
    "dataMode" TEXT NOT NULL DEFAULT 'demo',
    "actor" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" TEXT,
    "path" TEXT,
    "stayId" TEXT,
    "orderId" TEXT,
    "orderItemId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulatedActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SimulatedActivity_occurredAt_idx" ON "SimulatedActivity"("occurredAt");

-- CreateIndex
CREATE INDEX "SimulatedActivity_kind_occurredAt_idx" ON "SimulatedActivity"("kind", "occurredAt");

-- CreateEnum
CREATE TYPE "SimulationRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'BUDGET_REACHED', 'STALLED', 'FAILED');

-- CreateEnum
CREATE TYPE "SimulationEventKind" AS ENUM ('SCENARIO', 'DECISION', 'ACTION', 'CHECK', 'PROBLEM', 'GUARD', 'NOTE');

-- CreateEnum
CREATE TYPE "SimulationVerdict" AS ENUM ('HELD', 'FAILED', 'ERRORED');

-- CreateEnum
CREATE TYPE "SimulationProposalStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'DISMISSED');

-- CreateTable
CREATE TABLE "SimulationRun" (
    "id" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "dataMode" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "budgetMinor" INTEGER NOT NULL,
    "spentMinor" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "decisions" INTEGER NOT NULL DEFAULT 0,
    "status" "SimulationRunStatus" NOT NULL DEFAULT 'RUNNING',
    "stoppedReason" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SimulationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" "SimulationEventKind" NOT NULL,
    "persona" TEXT NOT NULL,
    "scenario" TEXT,
    "step" TEXT,
    "summary" TEXT NOT NULL,
    "detail" TEXT,
    "path" TEXT,
    "verdict" "SimulationVerdict",
    "severity" TEXT,
    "costMinor" INTEGER NOT NULL DEFAULT 0,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationProposal" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "targetPath" TEXT NOT NULL,
    "miss" TEXT NOT NULL,
    "suggestion" TEXT NOT NULL,
    "eventId" TEXT,
    "status" "SimulationProposalStatus" NOT NULL DEFAULT 'PROPOSED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulationProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SimulationRun_status_startedAt_idx" ON "SimulationRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "SimulationEvent_runId_sequence_idx" ON "SimulationEvent"("runId", "sequence");

-- CreateIndex
CREATE INDEX "SimulationEvent_runId_kind_sequence_idx" ON "SimulationEvent"("runId", "kind", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "SimulationEvent_runId_clientId_key" ON "SimulationEvent"("runId", "clientId");

-- CreateIndex
CREATE INDEX "SimulationProposal_runId_status_createdAt_idx" ON "SimulationProposal"("runId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "SimulationEvent" ADD CONSTRAINT "SimulationEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SimulationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationProposal" ADD CONSTRAINT "SimulationProposal_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SimulationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

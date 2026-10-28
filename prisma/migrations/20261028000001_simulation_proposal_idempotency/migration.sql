-- A proposal is idempotent on a resend, as an event already was.
--
-- The runner re-sends a batch it was not sure landed. Events carry a
-- `clientId` and a unique `[runId, clientId]`, so the second copy is a no-op;
-- proposals did not, so a flush that committed and then failed to deliver its
-- 200 put the same amendment in the harness panel twice. ADR-043.
--
-- Existing rows get a generated id: they are telemetry about a demo run, and
-- what matters is that no two of them collide.
ALTER TABLE "SimulationProposal" ADD COLUMN "clientId" TEXT;
UPDATE "SimulationProposal" SET "clientId" = "id" WHERE "clientId" IS NULL;
ALTER TABLE "SimulationProposal" ALTER COLUMN "clientId" SET NOT NULL;

CREATE UNIQUE INDEX "SimulationProposal_runId_clientId_key" ON "SimulationProposal"("runId", "clientId");

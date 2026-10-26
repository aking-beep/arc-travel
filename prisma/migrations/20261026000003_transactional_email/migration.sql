-- Transactional email, and the password reset it makes possible. See ADR-040.
--
-- Two tables and nothing altered, so this cannot fail on existing rows.
--
-- `EmailMessage` is a queue and a log in one table. A message is written inside
-- the transaction that caused it — so an order and its confirmation commit
-- together or not at all — and delivered after that transaction commits, by the
-- caller when it can and by `/api/cron/dispatch-email` when it could not. The
-- alternative, sending inside the transaction, puts a network call inside a
-- Serializable block and makes a mail outage roll back a paid booking.
--
-- `PasswordResetToken` stores only a hash, like `Invitation` and for the same
-- reason: a leaked database must not yield working reset links.

-- CreateEnum
CREATE TYPE "EmailKind" AS ENUM ('PARTNER_INVITATION', 'STAFF_INVITATION', 'ORDER_CONFIRMATION', 'ORDER_CANCELLED', 'GUEST_PORTAL_LINK', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'LOGGED', 'FAILED');

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "kind" "EmailKind" NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "toAddress" TEXT NOT NULL,
    "toName" TEXT,
    "locale" "Locale" NOT NULL DEFAULT 'EN',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "causedByUserId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT,
    "providerReference" TEXT,
    "lastError" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "requestedFromHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailMessage_status_queuedAt_idx" ON "EmailMessage"("status", "queuedAt");

-- CreateIndex
CREATE INDEX "EmailMessage_organizationId_queuedAt_idx" ON "EmailMessage"("organizationId", "queuedAt");

-- CreateIndex
CREATE INDEX "EmailMessage_entityType_entityId_idx" ON "EmailMessage"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_usedAt_idx" ON "PasswordResetToken"("userId", "usedAt");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_causedByUserId_fkey" FOREIGN KEY ("causedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

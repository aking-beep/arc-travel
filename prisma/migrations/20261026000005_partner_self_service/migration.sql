-- Partner self-service: claims a partner may edit, and the cold route in.
-- See ADR-041.
--
-- The five `Supplier` columns are deliberately *not* the existing
-- `insuranceOnFile` / `insuranceExpiresOn` pair. Those are ARC's record of
-- having checked a certificate; these are what the partner told us. A partner
-- may edit their claims and may never touch their standing, and one pair of
-- columns cannot hold both without making "insured" a self-assertion.
--
-- `SupplierJoinRequest` creates no commercial relationship. Only an owner
-- accepting one creates the Supplier, the membership and the agreement.
--
-- Additive: new nullable columns and one new table, so nothing can fail on
-- existing rows.

-- CreateEnum
CREATE TYPE "JoinRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "claimedInsurancePolicyRef" TEXT,
ADD COLUMN     "claimedInsuranceExpiresOn" DATE,
ADD COLUMN     "claimedInsurer" TEXT,
ADD COLUMN     "evidenceNotes" TEXT,
ADD COLUMN     "evidenceSubmittedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SupplierJoinRequest" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "categories" "ExperienceCategory"[] DEFAULT ARRAY[]::"ExperienceCategory"[],
    "pitch" TEXT,
    "claimedCertifications" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "locale" "Locale" NOT NULL DEFAULT 'ES',
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "createdSupplierId" TEXT,
    "requestedFromHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierJoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierJoinRequest_organizationId_status_createdAt_idx" ON "SupplierJoinRequest"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SupplierJoinRequest_propertyId_status_idx" ON "SupplierJoinRequest"("propertyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierJoinRequest_propertyId_contactEmail_key" ON "SupplierJoinRequest"("propertyId", "contactEmail");

-- AddForeignKey
ALTER TABLE "SupplierJoinRequest" ADD CONSTRAINT "SupplierJoinRequest_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierJoinRequest" ADD CONSTRAINT "SupplierJoinRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierJoinRequest" ADD CONSTRAINT "SupplierJoinRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

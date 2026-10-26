-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'STAFF', 'SUPPLIER', 'GUEST', 'ADMIN');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('EN', 'ES');

-- CreateEnum
CREATE TYPE "EntityStatus" AS ENUM ('DRAFT', 'PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "Provenance" AS ENUM ('HOTEL_SUBMITTED', 'PARTNER_SUBMITTED', 'ARC_RESEARCH', 'PUBLIC_SOURCE', 'GUEST_FEEDBACK', 'SEED_FIXTURE');

-- CreateEnum
CREATE TYPE "SourceClass" AS ENUM ('PRIMARY_LAW', 'REGULATOR_GUIDANCE', 'GOVERNMENT_ADVISORY', 'INTERGOVERNMENTAL_ALERT', 'REFERENCE_DATA', 'COMMUNITY_CONTEXT');

-- CreateEnum
CREATE TYPE "PlaceKind" AS ENUM ('BEACH', 'SURF_BREAK', 'NEIGHBORHOOD', 'VIEWPOINT', 'LAGOON', 'MARKET', 'DINING_DISTRICT', 'STUDIO', 'TRANSPORT_HUB');

-- CreateEnum
CREATE TYPE "ExperienceCategory" AS ENUM ('SURF', 'WELLNESS', 'ADVENTURE', 'DINING', 'TRANSPORT', 'CULTURE');

-- CreateEnum
CREATE TYPE "AbilityLevel" AS ENUM ('BEGINNER', 'IMPROVER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT');

-- CreateEnum
CREATE TYPE "Pace" AS ENUM ('RELAXED', 'BALANCED', 'PACKED');

-- CreateEnum
CREATE TYPE "TransportMode" AS ENUM ('WALK', 'TAXI', 'SHUTTLE', 'MOTO', 'BOAT');

-- CreateEnum
CREATE TYPE "ConditionsRisk" AS ENUM ('LOW', 'MODERATE', 'HIGH', 'EXTREME');

-- CreateEnum
CREATE TYPE "ExperienceStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PriceKind" AS ENUM ('BASE', 'SEASONAL', 'PROMO', 'GROUP');

-- CreateEnum
CREATE TYPE "SlotStatus" AS ENUM ('OPEN', 'FULL', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HoldStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CartStatus" AS ENUM ('OPEN', 'CHECKING_OUT', 'CONVERTED', 'ABANDONED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PARTIALLY_CANCELLED', 'CANCELLED', 'REFUNDED', 'FAILED');

-- CreateEnum
CREATE TYPE "OrderItemStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "StayStatus" AS ENUM ('BOOKED', 'IN_HOUSE', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "ItineraryStatus" AS ENUM ('DRAFT', 'PROPOSED', 'ACCEPTED', 'BOOKED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ItineraryItemKind" AS ENUM ('EXPERIENCE', 'MEAL', 'REST', 'TRANSFER', 'FREE_TIME');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('DATA_PROCESSING', 'PERSONALIZATION', 'MARKETING_EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ProposalKind" AS ENUM ('CATALOG_GAP', 'UPSELL', 'TRANSPORT_ARRANGEMENT', 'SUPPLIER_OUTREACH', 'PRICE_ADJUSTMENT', 'GUEST_MESSAGE', 'SUPPLIER_PAYOUT', 'PAYMENT_REVERSAL');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXECUTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('DRAFT', 'APPROVED', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentReversalCause" AS ENUM ('REFUND', 'DISPUTE');

-- CreateEnum
CREATE TYPE "CommissionBasis" AS ENUM ('PERCENT_OF_GROSS', 'FIXED_PER_UNIT');

-- CreateEnum
CREATE TYPE "RecommendationSurface" AS ENUM ('GUEST_GUIDE', 'ITINERARY', 'OWNER_BRIEFING', 'PARTNER_INSIGHT');

-- CreateEnum
CREATE TYPE "InvitationKind" AS ENUM ('SUPPLIER', 'STAFF');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "countryCode" TEXT NOT NULL DEFAULT 'MX',
    "status" "EntityStatus" NOT NULL DEFAULT 'DRAFT',
    "defaultCommissionBps" INTEGER NOT NULL DEFAULT 1500,
    "defaultPlatformCommissionBps" INTEGER NOT NULL DEFAULT 500,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT,
    "description" TEXT,
    "houseNotes" TEXT,
    "roomCount" INTEGER NOT NULL DEFAULT 0,
    "checkInTime" TEXT NOT NULL DEFAULT '15:00',
    "checkOutTime" TEXT NOT NULL DEFAULT '11:00',
    "timezone" TEXT NOT NULL DEFAULT 'America/Mexico_City',
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "defaultLocale" "Locale" NOT NULL DEFAULT 'EN',
    "brandPrimary" TEXT NOT NULL DEFAULT '#1F3A34',
    "brandAccent" TEXT NOT NULL DEFAULT '#C97B4A',
    "heroImageUrl" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'DRAFT',
    "verification" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "onboardingStep" INTEGER NOT NULL DEFAULT 0,
    "placeId" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "locale" "Locale" NOT NULL DEFAULT 'EN',
    "passwordHash" TEXT,
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "propertyId" TEXT,
    "supplierId" TEXT,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomType" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "maxOccupancy" INTEGER NOT NULL DEFAULT 2,
    "roomCount" INTEGER NOT NULL DEFAULT 1,
    "baseRateMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Amenity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ExperienceCategory" NOT NULL,
    "description" TEXT,
    "isIncluded" BOOLEAN NOT NULL DEFAULT true,
    "experienceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Amenity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "userId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "locale" "Locale" NOT NULL DEFAULT 'EN',
    "countryCode" TEXT,
    "partySize" INTEGER NOT NULL DEFAULT 2,
    "surfAbility" "AbilityLevel",
    "pace" "Pace",
    "budgetPerDayMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "interests" "ExperienceCategory"[] DEFAULT ARRAY[]::"ExperienceCategory"[],
    "dietaryNotes" TEXT,
    "mobilityNotes" TEXT,
    "preferredTransport" "TransportMode"[] DEFAULT ARRAY[]::"TransportMode"[],
    "intakeCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Guest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stay" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "roomTypeId" TEXT,
    "reference" TEXT NOT NULL,
    "checkIn" DATE NOT NULL,
    "checkOut" DATE NOT NULL,
    "adults" INTEGER NOT NULL DEFAULT 2,
    "children" INTEGER NOT NULL DEFAULT 0,
    "status" "StayStatus" NOT NULL DEFAULT 'BOOKED',
    "roomRevenueMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "portalToken" TEXT NOT NULL,
    "arrivalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "type" "ConsentType" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "description" TEXT,
    "categories" "ExperienceCategory"[] DEFAULT ARRAY[]::"ExperienceCategory"[],
    "contactUserId" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "placeId" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "verification" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "verificationNotes" TEXT,
    "claimedCertifications" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "insuranceOnFile" BOOLEAN NOT NULL DEFAULT false,
    "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierAgreement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "hotelCommissionBps" INTEGER NOT NULL DEFAULT 1500,
    "platformCommissionBps" INTEGER NOT NULL DEFAULT 500,
    "cancellationWindowHours" INTEGER NOT NULL DEFAULT 24,
    "requiresManualConfirmation" BOOLEAN NOT NULL DEFAULT true,
    "status" "EntityStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "signedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Place" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PlaceKind" NOT NULL,
    "destination" TEXT NOT NULL DEFAULT 'puerto-escondido',
    "region" TEXT NOT NULL DEFAULT 'Oaxaca, Mexico',
    "parentId" TEXT,
    "summaryEn" TEXT,
    "summaryEs" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "typicalRisk" "ConditionsRisk" NOT NULL DEFAULT 'MODERATE',
    "safetyNotesEn" TEXT,
    "safetyNotesEs" TEXT,
    "provenance" "Provenance" NOT NULL DEFAULT 'SEED_FIXTURE',
    "sourceUrl" TEXT,
    "verification" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "factsUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Place_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ExperienceCategory" NOT NULL,
    "placeId" TEXT,
    "descriptionEn" TEXT,
    "descriptionEs" TEXT,
    "minAbility" "AbilityLevel" NOT NULL DEFAULT 'BEGINNER',
    "maxAbility" "AbilityLevel" NOT NULL DEFAULT 'EXPERT',
    "guideRequired" BOOLEAN NOT NULL DEFAULT false,
    "conditionsSensitive" BOOLEAN NOT NULL DEFAULT true,
    "maxSafeRisk" "ConditionsRisk" NOT NULL DEFAULT 'MODERATE',
    "minAgeYears" INTEGER,
    "typicalDurationMinutes" INTEGER NOT NULL DEFAULT 120,
    "seasonMonths" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]::INTEGER[],
    "earliestStart" TEXT NOT NULL DEFAULT '06:00',
    "latestStart" TEXT NOT NULL DEFAULT '18:00',
    "physicalIntensity" INTEGER NOT NULL DEFAULT 2,
    "safetyNotesEn" TEXT,
    "safetyNotesEs" TEXT,
    "provenance" "Provenance" NOT NULL DEFAULT 'SEED_FIXTURE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experience" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "placeId" TEXT,
    "slug" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleEs" TEXT,
    "summaryEn" TEXT,
    "summaryEs" TEXT,
    "descriptionEn" TEXT,
    "descriptionEs" TEXT,
    "category" "ExperienceCategory" NOT NULL,
    "status" "ExperienceStatus" NOT NULL DEFAULT 'DRAFT',
    "durationMinutes" INTEGER NOT NULL DEFAULT 120,
    "minAbility" "AbilityLevel" NOT NULL DEFAULT 'BEGINNER',
    "maxAbility" "AbilityLevel" NOT NULL DEFAULT 'EXPERT',
    "minParty" INTEGER NOT NULL DEFAULT 1,
    "maxParty" INTEGER NOT NULL DEFAULT 8,
    "minAgeYears" INTEGER,
    "defaultCapacity" INTEGER NOT NULL DEFAULT 6,
    "includesTransfer" BOOLEAN NOT NULL DEFAULT false,
    "guideIncluded" BOOLEAN NOT NULL DEFAULT true,
    "meetingPoint" TEXT,
    "whatToBringEn" TEXT,
    "whatToBringEs" TEXT,
    "cancellationPolicyHours" INTEGER NOT NULL DEFAULT 24,
    "imageUrl" TEXT,
    "imageCredit" TEXT,
    "verification" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "provenance" "Provenance" NOT NULL DEFAULT 'PARTNER_SUBMITTED',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Experience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Price" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "experienceId" TEXT NOT NULL,
    "kind" "PriceKind" NOT NULL DEFAULT 'BASE',
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "bookingFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "minParty" INTEGER NOT NULL DEFAULT 1,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilitySlot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "experienceId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "booked" INTEGER NOT NULL DEFAULT 0,
    "held" INTEGER NOT NULL DEFAULT 0,
    "status" "SlotStatus" NOT NULL DEFAULT 'OPEN',
    "priceOverrideMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "note" TEXT,
    "lastRiskCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvailabilitySlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryHold" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "cartId" TEXT,
    "orderItemId" TEXT,
    "quantity" INTEGER NOT NULL,
    "status" "HoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cart" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "guestId" TEXT,
    "stayId" TEXT,
    "status" "CartStatus" NOT NULL DEFAULT 'OPEN',
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "subtotalMinor" INTEGER NOT NULL DEFAULT 0,
    "feesMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "convertedOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "experienceId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceMinor" INTEGER NOT NULL,
    "bookingFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "lineTotalMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "participantNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "guestId" TEXT,
    "stayId" TEXT,
    "reference" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "subtotalMinor" INTEGER NOT NULL DEFAULT 0,
    "feesMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL DEFAULT 0,
    "refundedMinor" INTEGER NOT NULL DEFAULT 0,
    "hotelEarningsMinor" INTEGER NOT NULL DEFAULT 0,
    "platformEarningsMinor" INTEGER NOT NULL DEFAULT 0,
    "supplierPayableMinor" INTEGER NOT NULL DEFAULT 0,
    "isSimulated" BOOLEAN NOT NULL DEFAULT true,
    "paymentProvider" TEXT NOT NULL DEFAULT 'simulated',
    "paymentReference" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "reversalReportedAt" TIMESTAMP(3),
    "reversalCause" "PaymentReversalCause",
    "reversalEventId" TEXT,
    "reversedMinor" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "experienceId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "bookingFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "lineTotalMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "status" "OrderItemStatus" NOT NULL DEFAULT 'PENDING',
    "hotelEarningsMinor" INTEGER NOT NULL DEFAULT 0,
    "platformEarningsMinor" INTEGER NOT NULL DEFAULT 0,
    "supplierPayableMinor" INTEGER NOT NULL DEFAULT 0,
    "supplierConfirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "refundedMinor" INTEGER NOT NULL DEFAULT 0,
    "participantNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT,
    "experienceId" TEXT,
    "category" "ExperienceCategory",
    "basis" "CommissionBasis" NOT NULL DEFAULT 'PERCENT_OF_GROSS',
    "hotelShare" INTEGER NOT NULL,
    "platformShare" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "account" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "netMinor" INTEGER NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'DRAFT',
    "proposalId" TEXT,
    "settlementReference" TEXT,
    "settlementMethod" TEXT,
    "settledAt" TIMESTAMP(3),
    "settledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "ledgerEntryId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "responseJson" JSONB,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConditionReport" (
    "id" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "forDate" DATE NOT NULL,
    "waveHeightMinM" DOUBLE PRECISION NOT NULL,
    "waveHeightMaxM" DOUBLE PRECISION NOT NULL,
    "swellPeriodS" DOUBLE PRECISION,
    "windKph" DOUBLE PRECISION,
    "windDirection" TEXT,
    "waterTempC" DOUBLE PRECISION,
    "airTempC" DOUBLE PRECISION,
    "currentNotesEn" TEXT,
    "currentNotesEs" TEXT,
    "highTideLocal" TEXT,
    "lowTideLocal" TEXT,
    "risk" "ConditionsRisk" NOT NULL,
    "minAbilityRequired" "AbilityLevel" NOT NULL,
    "guideRecommended" BOOLEAN NOT NULL DEFAULT true,
    "provenance" "Provenance" NOT NULL DEFAULT 'SEED_FIXTURE',
    "source" TEXT NOT NULL DEFAULT 'ARC demo fixture',
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConditionReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelEdge" (
    "id" TEXT NOT NULL,
    "fromPlaceId" TEXT NOT NULL,
    "toPlaceId" TEXT NOT NULL,
    "mode" "TransportMode" NOT NULL,
    "minutes" INTEGER NOT NULL,
    "distanceKm" DOUBLE PRECISION,
    "typicalCostMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "provenance" "Provenance" NOT NULL DEFAULT 'SEED_FIXTURE',
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TravelEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Itinerary" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "stayId" TEXT,
    "title" TEXT NOT NULL,
    "status" "ItineraryStatus" NOT NULL DEFAULT 'DRAFT',
    "locale" "Locale" NOT NULL DEFAULT 'EN',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "partySize" INTEGER NOT NULL DEFAULT 2,
    "pace" "Pace" NOT NULL DEFAULT 'BALANCED',
    "budgetPerDayMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "generatorVersion" TEXT NOT NULL DEFAULT 'v1',
    "agentRunId" TEXT,
    "unmetConstraints" JSONB,
    "estimatedTotalMinor" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Itinerary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItineraryItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itineraryId" TEXT NOT NULL,
    "kind" "ItineraryItemKind" NOT NULL DEFAULT 'EXPERIENCE',
    "dayIndex" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "experienceId" TEXT,
    "slotId" TEXT,
    "placeId" TEXT,
    "orderItemId" TEXT,
    "titleEn" TEXT NOT NULL,
    "titleEs" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "rationale" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "estimatedCostMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "travelMinutesFromPrev" INTEGER NOT NULL DEFAULT 0,
    "travelModeFromPrev" "TransportMode",
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItineraryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "model" TEXT NOT NULL DEFAULT 'mock-deterministic',
    "status" "AgentRunStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT,
    "inputJson" JSONB,
    "outputJson" JSONB,
    "validationError" TEXT,
    "blockedReason" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "guestId" TEXT,
    "experienceId" TEXT,
    "agentRunId" TEXT,
    "surface" "RecommendationSurface" NOT NULL,
    "score" INTEGER NOT NULL,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exclusions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "explanation" TEXT,
    "shownAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "agentRunId" TEXT,
    "kind" "ProposalKind" NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "actionJson" JSONB NOT NULL,
    "evidenceJson" JSONB,
    "potentialValueMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "expiresAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "executionResultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "decidedById" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "note" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "actorUserId" TEXT,
    "actorKind" TEXT NOT NULL DEFAULT 'system',
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadataJson" JSONB,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT,
    "name" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "subjectKey" TEXT,
    "propertiesJson" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CultureSourceSnapshot" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "sourceClass" "SourceClass" NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "isFixture" BOOLEAN NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "failureReason" TEXT,
    "contentHash" TEXT,
    "contentJson" JSONB,
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CultureSourceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CultureSourceChange" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "previousSnapshotId" TEXT NOT NULL,
    "currentSnapshotId" TEXT NOT NULL,
    "previousHash" TEXT NOT NULL,
    "currentHash" TEXT NOT NULL,
    "changedSections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "verification" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CultureSourceChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitCounter" (
    "id" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "kind" "InvitationKind" NOT NULL,
    "organizationId" TEXT,
    "invitedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_status_idx" ON "Organization"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Property_slug_key" ON "Property"("slug");

-- CreateIndex
CREATE INDEX "Property_organizationId_status_idx" ON "Property"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Property_placeId_idx" ON "Property"("placeId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE INDEX "Membership_organizationId_role_idx" ON "Membership"("organizationId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_organizationId_userId_role_propertyId_supplierId_key" ON "Membership"("organizationId", "userId", "role", "propertyId", "supplierId");

-- CreateIndex
CREATE INDEX "RoomType_organizationId_idx" ON "RoomType"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RoomType_propertyId_code_key" ON "RoomType"("propertyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Amenity_experienceId_key" ON "Amenity"("experienceId");

-- CreateIndex
CREATE INDEX "Amenity_organizationId_propertyId_idx" ON "Amenity"("organizationId", "propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "Guest_userId_key" ON "Guest"("userId");

-- CreateIndex
CREATE INDEX "Guest_organizationId_propertyId_idx" ON "Guest"("organizationId", "propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "Guest_propertyId_email_key" ON "Guest"("propertyId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Stay_reference_key" ON "Stay"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Stay_portalToken_key" ON "Stay"("portalToken");

-- CreateIndex
CREATE INDEX "Stay_organizationId_propertyId_checkIn_idx" ON "Stay"("organizationId", "propertyId", "checkIn");

-- CreateIndex
CREATE INDEX "Stay_propertyId_status_idx" ON "Stay"("propertyId", "status");

-- CreateIndex
CREATE INDEX "Stay_guestId_idx" ON "Stay"("guestId");

-- CreateIndex
CREATE UNIQUE INDEX "Consent_guestId_type_key" ON "Consent"("guestId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_slug_key" ON "Supplier"("slug");

-- CreateIndex
CREATE INDEX "Supplier_organizationId_status_idx" ON "Supplier"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Supplier_verification_idx" ON "Supplier"("verification");

-- CreateIndex
CREATE INDEX "SupplierAgreement_organizationId_idx" ON "SupplierAgreement"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierAgreement_propertyId_supplierId_key" ON "SupplierAgreement"("propertyId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "Place_slug_key" ON "Place"("slug");

-- CreateIndex
CREATE INDEX "Place_destination_kind_idx" ON "Place"("destination", "kind");

-- CreateIndex
CREATE INDEX "Place_parentId_idx" ON "Place"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Activity_slug_key" ON "Activity"("slug");

-- CreateIndex
CREATE INDEX "Activity_category_idx" ON "Activity"("category");

-- CreateIndex
CREATE INDEX "Activity_placeId_idx" ON "Activity"("placeId");

-- CreateIndex
CREATE INDEX "Experience_organizationId_propertyId_status_idx" ON "Experience"("organizationId", "propertyId", "status");

-- CreateIndex
CREATE INDEX "Experience_supplierId_idx" ON "Experience"("supplierId");

-- CreateIndex
CREATE INDEX "Experience_category_status_idx" ON "Experience"("category", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Experience_propertyId_slug_key" ON "Experience"("propertyId", "slug");

-- CreateIndex
CREATE INDEX "Price_experienceId_isActive_kind_idx" ON "Price"("experienceId", "isActive", "kind");

-- CreateIndex
CREATE INDEX "Price_organizationId_idx" ON "Price"("organizationId");

-- CreateIndex
CREATE INDEX "AvailabilitySlot_organizationId_startsAt_idx" ON "AvailabilitySlot"("organizationId", "startsAt");

-- CreateIndex
CREATE INDEX "AvailabilitySlot_experienceId_status_startsAt_idx" ON "AvailabilitySlot"("experienceId", "status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "AvailabilitySlot_experienceId_startsAt_key" ON "AvailabilitySlot"("experienceId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryHold_orderItemId_key" ON "InventoryHold"("orderItemId");

-- CreateIndex
CREATE INDEX "InventoryHold_slotId_status_idx" ON "InventoryHold"("slotId", "status");

-- CreateIndex
CREATE INDEX "InventoryHold_status_expiresAt_idx" ON "InventoryHold"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "InventoryHold_organizationId_idx" ON "InventoryHold"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Cart_convertedOrderId_key" ON "Cart"("convertedOrderId");

-- CreateIndex
CREATE INDEX "Cart_organizationId_propertyId_status_idx" ON "Cart"("organizationId", "propertyId", "status");

-- CreateIndex
CREATE INDEX "Cart_guestId_status_idx" ON "Cart"("guestId", "status");

-- CreateIndex
CREATE INDEX "CartItem_organizationId_idx" ON "CartItem"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_cartId_slotId_key" ON "CartItem"("cartId", "slotId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_reference_key" ON "Order"("reference");

-- CreateIndex
CREATE INDEX "Order_organizationId_propertyId_status_idx" ON "Order"("organizationId", "propertyId", "status");

-- CreateIndex
CREATE INDEX "Order_propertyId_confirmedAt_idx" ON "Order"("propertyId", "confirmedAt");

-- CreateIndex
CREATE INDEX "Order_guestId_idx" ON "Order"("guestId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_paymentProvider_paymentReference_key" ON "Order"("paymentProvider", "paymentReference");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_organizationId_supplierId_status_idx" ON "OrderItem"("organizationId", "supplierId", "status");

-- CreateIndex
CREATE INDEX "OrderItem_slotId_idx" ON "OrderItem"("slotId");

-- CreateIndex
CREATE INDEX "CommissionRule_organizationId_isActive_priority_idx" ON "CommissionRule"("organizationId", "isActive", "priority");

-- CreateIndex
CREATE INDEX "CommissionRule_propertyId_idx" ON "CommissionRule"("propertyId");

-- CreateIndex
CREATE INDEX "LedgerEntry_organizationId_account_idx" ON "LedgerEntry"("organizationId", "account");

-- CreateIndex
CREATE INDEX "LedgerEntry_orderId_idx" ON "LedgerEntry"("orderId");

-- CreateIndex
CREATE INDEX "LedgerEntry_organizationId_account_createdAt_idx" ON "LedgerEntry"("organizationId", "account", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_reference_key" ON "Payout"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_proposalId_key" ON "Payout"("proposalId");

-- CreateIndex
CREATE INDEX "Payout_organizationId_supplierId_status_idx" ON "Payout"("organizationId", "supplierId", "status");

-- CreateIndex
CREATE INDEX "Payout_propertyId_status_idx" ON "Payout"("propertyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutLine_ledgerEntryId_key" ON "PayoutLine"("ledgerEntryId");

-- CreateIndex
CREATE INDEX "PayoutLine_payoutId_idx" ON "PayoutLine"("payoutId");

-- CreateIndex
CREATE INDEX "PayoutLine_organizationId_idx" ON "PayoutLine"("organizationId");

-- CreateIndex
CREATE INDEX "IdempotencyKey_createdAt_idx" ON "IdempotencyKey"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_organizationId_scope_key_key" ON "IdempotencyKey"("organizationId", "scope", "key");

-- CreateIndex
CREATE INDEX "ConditionReport_forDate_idx" ON "ConditionReport"("forDate");

-- CreateIndex
CREATE UNIQUE INDEX "ConditionReport_placeId_forDate_key" ON "ConditionReport"("placeId", "forDate");

-- CreateIndex
CREATE INDEX "TravelEdge_toPlaceId_idx" ON "TravelEdge"("toPlaceId");

-- CreateIndex
CREATE UNIQUE INDEX "TravelEdge_fromPlaceId_toPlaceId_mode_key" ON "TravelEdge"("fromPlaceId", "toPlaceId", "mode");

-- CreateIndex
CREATE INDEX "Itinerary_organizationId_propertyId_idx" ON "Itinerary"("organizationId", "propertyId");

-- CreateIndex
CREATE INDEX "Itinerary_guestId_status_idx" ON "Itinerary"("guestId", "status");

-- CreateIndex
CREATE INDEX "ItineraryItem_itineraryId_dayIndex_idx" ON "ItineraryItem"("itineraryId", "dayIndex");

-- CreateIndex
CREATE INDEX "ItineraryItem_organizationId_idx" ON "ItineraryItem"("organizationId");

-- CreateIndex
CREATE INDEX "AgentRun_organizationId_task_createdAt_idx" ON "AgentRun"("organizationId", "task", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_status_idx" ON "AgentRun"("status");

-- CreateIndex
CREATE INDEX "Recommendation_organizationId_propertyId_surface_idx" ON "Recommendation"("organizationId", "propertyId", "surface");

-- CreateIndex
CREATE INDEX "Recommendation_guestId_idx" ON "Recommendation"("guestId");

-- CreateIndex
CREATE INDEX "Proposal_organizationId_propertyId_status_idx" ON "Proposal"("organizationId", "propertyId", "status");

-- CreateIndex
CREATE INDEX "Proposal_status_expiresAt_idx" ON "Proposal"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Approval_proposalId_idx" ON "Approval"("proposalId");

-- CreateIndex
CREATE INDEX "Approval_organizationId_decidedAt_idx" ON "Approval"("organizationId", "decidedAt");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_createdAt_idx" ON "AuditEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_organizationId_name_occurredAt_idx" ON "AnalyticsEvent"("organizationId", "name", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_propertyId_occurredAt_idx" ON "AnalyticsEvent"("propertyId", "occurredAt");

-- CreateIndex
CREATE INDEX "CultureSourceSnapshot_sourceKey_createdAt_idx" ON "CultureSourceSnapshot"("sourceKey", "createdAt");

-- CreateIndex
CREATE INDEX "CultureSourceSnapshot_sourceKey_ok_createdAt_idx" ON "CultureSourceSnapshot"("sourceKey", "ok", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CultureSourceChange_currentSnapshotId_key" ON "CultureSourceChange"("currentSnapshotId");

-- CreateIndex
CREATE INDEX "CultureSourceChange_verification_detectedAt_idx" ON "CultureSourceChange"("verification", "detectedAt");

-- CreateIndex
CREATE INDEX "CultureSourceChange_sourceKey_verification_reviewedAt_idx" ON "CultureSourceChange"("sourceKey", "verification", "reviewedAt");

-- CreateIndex
CREATE INDEX "RateLimitCounter_windowStart_idx" ON "RateLimitCounter"("windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimitCounter_bucket_windowStart_key" ON "RateLimitCounter"("bucket", "windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_userId_acceptedAt_idx" ON "Invitation"("userId", "acceptedAt");

-- CreateIndex
CREATE INDEX "Invitation_organizationId_acceptedAt_idx" ON "Invitation"("organizationId", "acceptedAt");

-- CreateIndex
CREATE INDEX "Invitation_expiresAt_idx" ON "Invitation"("expiresAt");

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomType" ADD CONSTRAINT "RoomType_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Amenity" ADD CONSTRAINT "Amenity_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Amenity" ADD CONSTRAINT "Amenity_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "Experience"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stay" ADD CONSTRAINT "Stay_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stay" ADD CONSTRAINT "Stay_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stay" ADD CONSTRAINT "Stay_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_contactUserId_fkey" FOREIGN KEY ("contactUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAgreement" ADD CONSTRAINT "SupplierAgreement_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAgreement" ADD CONSTRAINT "SupplierAgreement_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Place" ADD CONSTRAINT "Place_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Place"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experience" ADD CONSTRAINT "Experience_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experience" ADD CONSTRAINT "Experience_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experience" ADD CONSTRAINT "Experience_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experience" ADD CONSTRAINT "Experience_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Price" ADD CONSTRAINT "Price_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "Experience"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilitySlot" ADD CONSTRAINT "AvailabilitySlot_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "Experience"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryHold" ADD CONSTRAINT "InventoryHold_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "AvailabilitySlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryHold" ADD CONSTRAINT "InventoryHold_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryHold" ADD CONSTRAINT "InventoryHold_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "Stay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "Experience"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "AvailabilitySlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "Stay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "Experience"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "AvailabilitySlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "Experience"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_settledById_fkey" FOREIGN KEY ("settledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutLine" ADD CONSTRAINT "PayoutLine_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutLine" ADD CONSTRAINT "PayoutLine_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "LedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConditionReport" ADD CONSTRAINT "ConditionReport_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelEdge" ADD CONSTRAINT "TravelEdge_fromPlaceId_fkey" FOREIGN KEY ("fromPlaceId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelEdge" ADD CONSTRAINT "TravelEdge_toPlaceId_fkey" FOREIGN KEY ("toPlaceId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Itinerary" ADD CONSTRAINT "Itinerary_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Itinerary" ADD CONSTRAINT "Itinerary_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Itinerary" ADD CONSTRAINT "Itinerary_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Itinerary" ADD CONSTRAINT "Itinerary_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "Stay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Itinerary" ADD CONSTRAINT "Itinerary_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryItem" ADD CONSTRAINT "ItineraryItem_itineraryId_fkey" FOREIGN KEY ("itineraryId") REFERENCES "Itinerary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryItem" ADD CONSTRAINT "ItineraryItem_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "Experience"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryItem" ADD CONSTRAINT "ItineraryItem_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "AvailabilitySlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryItem" ADD CONSTRAINT "ItineraryItem_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryItem" ADD CONSTRAINT "ItineraryItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "Experience"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CultureSourceChange" ADD CONSTRAINT "CultureSourceChange_previousSnapshotId_fkey" FOREIGN KEY ("previousSnapshotId") REFERENCES "CultureSourceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CultureSourceChange" ADD CONSTRAINT "CultureSourceChange_currentSnapshotId_fkey" FOREIGN KEY ("currentSnapshotId") REFERENCES "CultureSourceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CultureSourceChange" ADD CONSTRAINT "CultureSourceChange_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

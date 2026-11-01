-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "WhatsappAccount" (
    "id" SERIAL NOT NULL,
    "wabaId" TEXT,
    "phoneNumberId" TEXT,
    "displayPhoneNumber" TEXT,
    "businessTokenEncrypted" TEXT,
    "contactsSyncStartedAt" TIMESTAMP(3),
    "contactsSyncRequestId" TEXT,
    "contactsSyncInFlightAt" TIMESTAMP(3),
    "contactsSyncLastError" TEXT,
    "historySyncStartedAt" TIMESTAMP(3),
    "historySyncRequestId" TEXT,
    "historySyncInFlightAt" TIMESTAMP(3),
    "historySyncLastError" TEXT,
    "historySyncProgress" INTEGER,
    "historySyncDeclined" BOOLEAN NOT NULL DEFAULT false,
    "isOnBizApp" BOOLEAN,
    "platformType" TEXT,
    "onboardedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastSessionEvent" JSONB,
    "disconnectionInfo" JSONB,
    "lastAccountEvent" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" SERIAL NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "fullName" TEXT,
    "firstName" TEXT,
    "profileName" TEXT,
    "removed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" SERIAL NOT NULL,
    "wamid" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "fromMe" BOOLEAN NOT NULL DEFAULT false,
    "type" TEXT NOT NULL,
    "text" TEXT,
    "rawJson" JSONB NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatState" (
    "id" SERIAL NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "lastCustomerMessageAt" TIMESTAMP(3),
    "humanTakeoverAt" TIMESTAMP(3),
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastFallbackSentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" SERIAL NOT NULL,
    "field" TEXT,
    "rawJson" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contact_phoneNumber_key" ON "Contact"("phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Message_wamid_key" ON "Message"("wamid");

-- CreateIndex
CREATE INDEX "Message_contactPhone_timestamp_idx" ON "Message"("contactPhone", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "ChatState_contactPhone_key" ON "ChatState"("contactPhone");

-- CreateIndex
CREATE INDEX "WebhookEvent_processed_id_idx" ON "WebhookEvent"("processed", "id");

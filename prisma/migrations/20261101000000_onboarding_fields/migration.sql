-- AlterTable
ALTER TABLE "WhatsappAccount" ADD COLUMN     "businessId" TEXT,
ADD COLUMN     "onboardingLastError" TEXT,
ADD COLUMN     "subscribedAt" TIMESTAMP(3);

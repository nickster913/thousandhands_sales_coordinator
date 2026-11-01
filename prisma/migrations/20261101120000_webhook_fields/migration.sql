-- AlterTable
ALTER TABLE "Message" ADD COLUMN "status" TEXT;

-- AlterTable
ALTER TABLE "WebhookEvent" ADD COLUMN "processingAt" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "WebhookJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "StockSyncStatus" AS ENUM ('SUCCESS', 'FAILED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "stockHeldAt" TIMESTAMP(3),
ADD COLUMN     "stockHoldReleasedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "holdQuantity" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "shopee_webhook_logs" (
    "id" TEXT NOT NULL,
    "eventCode" INTEGER NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderSn" TEXT,
    "bodyHash" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" "WebhookJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shopee_webhook_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventorySyncLog" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelSku" TEXT NOT NULL,
    "productId" TEXT,
    "oldQuantity" INTEGER NOT NULL,
    "newQuantity" INTEGER NOT NULL,
    "status" "StockSyncStatus" NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventorySyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventorySyncAlert" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelSku" TEXT,
    "orderSn" TEXT,
    "message" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventorySyncAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shopee_webhook_logs_bodyHash_key" ON "shopee_webhook_logs"("bodyHash");

-- CreateIndex
CREATE INDEX "shopee_webhook_logs_status_nextRetryAt_createdAt_idx" ON "shopee_webhook_logs"("status", "nextRetryAt", "createdAt");

-- CreateIndex
CREATE INDEX "shopee_webhook_logs_orderSn_idx" ON "shopee_webhook_logs"("orderSn");

-- CreateIndex
CREATE INDEX "InventorySyncLog_channelId_createdAt_idx" ON "InventorySyncLog"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "InventorySyncLog_status_idx" ON "InventorySyncLog"("status");

-- CreateIndex
CREATE INDEX "InventorySyncAlert_channelId_resolvedAt_idx" ON "InventorySyncAlert"("channelId", "resolvedAt");

-- AddForeignKey
ALTER TABLE "InventorySyncLog" ADD CONSTRAINT "InventorySyncLog_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySyncAlert" ADD CONSTRAINT "InventorySyncAlert_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hàng đợi bền webhook TikTok Shop (16/09/2026) — cùng khuôn shopee_webhook_logs.
-- CreateTable
CREATE TABLE "tiktok_webhook_logs" (
    "id" TEXT NOT NULL,
    "eventType" INTEGER NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT,
    "bodyHash" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" "WebhookJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tiktok_webhook_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tiktok_webhook_logs_bodyHash_key" ON "tiktok_webhook_logs"("bodyHash");

-- CreateIndex
CREATE INDEX "tiktok_webhook_logs_status_nextRetryAt_createdAt_idx" ON "tiktok_webhook_logs"("status", "nextRetryAt", "createdAt");

-- CreateIndex
CREATE INDEX "tiktok_webhook_logs_orderId_idx" ON "tiktok_webhook_logs"("orderId");

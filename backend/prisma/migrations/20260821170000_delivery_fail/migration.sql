-- Cứu đơn giao thất bại (21/08): cấu hình + nhật ký đơn chạm ngưỡng
-- "giao 2 lần không thành công" (đếm mốc FAILED_DELIVERED từ Shopee
-- get_tracking_info). orderId UNIQUE = chống cảnh báo trùng.

CREATE TYPE "DeliveryFailChatStatus" AS ENUM ('NONE', 'SENT', 'FAILED', 'SKIPPED');

CREATE TABLE "delivery_fail_config" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "alertEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoChatEnabled" BOOLEAN NOT NULL DEFAULT false,
    "chatTemplate" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_fail_config_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "delivery_fail_config_ownerId_key" ON "delivery_fail_config"("ownerId");

CREATE TABLE "delivery_fail_notices" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "failCount" INTEGER NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chatStatus" "DeliveryFailChatStatus" NOT NULL DEFAULT 'NONE',
    "chatError" TEXT,
    "sentMessage" TEXT,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "delivery_fail_notices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "delivery_fail_notices_orderId_key" ON "delivery_fail_notices"("orderId");

CREATE INDEX "delivery_fail_notices_ownerId_detectedAt_idx" ON "delivery_fail_notices"("ownerId", "detectedAt");

ALTER TABLE "delivery_fail_notices" ADD CONSTRAINT "delivery_fail_notices_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

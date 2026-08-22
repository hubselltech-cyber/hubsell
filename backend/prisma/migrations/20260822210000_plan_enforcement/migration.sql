-- GĐ2 CƯỠNG CHẾ TRẦN GÓI (22/08):
-- 1) 3 cột theo dõi trần đơn tháng trên subscriptions (reset lười lúc đọc).
-- 2) Index (channelId, createdAt) phục vụ đếm "đơn phát sinh trong tháng"
--    của mọi gian thuộc một chủ shop mà không quét cả bảng.

ALTER TABLE "subscriptions" ADD COLUMN "quotaMonth" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN "overQuotaSince" TIMESTAMP(3);
ALTER TABLE "subscriptions" ADD COLUMN "quotaNotifiedLevel" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Order_channelId_createdAt_idx" ON "Order"("channelId", "createdAt");

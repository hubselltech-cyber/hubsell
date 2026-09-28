-- Danh mục sản phẩm tự kéo theo gian (workers/product-catalog-sync.ts, 28/09/2026)
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "nextProductSyncAt" TIMESTAMP(3);
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "lastProductSyncAt" TIMESTAMP(3);
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "productSyncError" TEXT;
CREATE INDEX IF NOT EXISTS "Channel_status_nextProductSyncAt_idx" ON "Channel"("status", "nextProductSyncAt");

-- Gian online đang hoạt động sẵn có: lên lịch kéo lần đầu rải trong 6 giờ tới
-- (worker chạy tuần tự từng gian, Shopee giãn nhịp) thay vì dồn cùng lúc.
UPDATE "Channel"
SET "nextProductSyncAt" = NOW() + (random() * INTERVAL '6 hours')
WHERE "nextProductSyncAt" IS NULL
  AND "status" = 'ACTIVE'
  AND "refreshToken" IS NOT NULL
  AND "channelName" IN ('SHOPEE', 'LAZADA', 'TIKTOK');

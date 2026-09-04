-- Đồng bộ tồn kho THEO TỪNG GIAN + worker đối soát định kỳ (05/09/2026)

-- Cờ bật đồng bộ tồn của từng gian (thay switch toàn shop shop_sync_settings.autoSyncEnabled)
ALTER TABLE "Channel" ADD COLUMN "stockSyncEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Channel" ADD COLUMN "stockSyncEnabledAt" TIMESTAMP(3);
-- Bookkeeping worker đối soát tồn sàn ↔ Hubsell
ALTER TABLE "Channel" ADD COLUMN "lastStockReconcileAt" TIMESTAMP(3);
ALTER TABLE "Channel" ADD COLUMN "lastStockReconcileMismatch" INTEGER;

-- location_id kho Shopee của SKU (khi sàn trả đúng một địa điểm)
ALTER TABLE "ChannelProduct" ADD COLUMN "channelStockLocationId" TEXT;

-- Cách gieo tồn ban đầu khi nối SKU sàn vào SKU kho tồn 0: SUM | MAX | NONE
ALTER TABLE "shop_sync_settings" ADD COLUMN "initialStockMode" TEXT NOT NULL DEFAULT 'SUM';

-- Chuyển cờ cũ: shop đã BẬT tự động toàn shop → bật cho mọi gian Shopee/Lazada
-- đang hoạt động của shop đó (không đổi hành vi của khách đang dùng).
UPDATE "Channel" c
SET "stockSyncEnabled" = true,
    "stockSyncEnabledAt" = s."updatedAt"
FROM "shop_sync_settings" s
WHERE s."userId" = c."userId"
  AND s."autoSyncEnabled" = true
  AND c."status" = 'ACTIVE'
  AND c."channelName" IN ('SHOPEE', 'LAZADA');

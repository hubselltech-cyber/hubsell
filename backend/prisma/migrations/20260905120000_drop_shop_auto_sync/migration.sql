-- Dọn cột switch tự động toàn shop (05/09/2026): đã thay bằng Channel.stockSyncEnabled
-- theo từng gian từ migration 20260905100000 (cờ cũ đã được chép sang gian lúc đó).
ALTER TABLE "shop_sync_settings" DROP COLUMN IF EXISTS "autoSyncEnabled";

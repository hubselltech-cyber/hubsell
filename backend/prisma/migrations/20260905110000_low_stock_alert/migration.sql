-- Cảnh báo sắp hết hàng theo ngưỡng (05/09/2026)
-- Ngưỡng riêng từng SKU (NULL = dùng mặc định shop, 0 = tắt)
ALTER TABLE "Product" ADD COLUMN "lowStockThreshold" INTEGER;
-- Ngưỡng mặc định toàn shop (0 = tắt)
ALTER TABLE "shop_sync_settings" ADD COLUMN "lowStockDefault" INTEGER NOT NULL DEFAULT 0;

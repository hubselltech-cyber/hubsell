-- ============================================================
-- ĐỒNG BỘ TỒN KHO ĐA SÀN: cấu hình per-shop + hàng đợi đẩy tồn + tồn an toàn.
-- ============================================================

-- AlterTable: tồn an toàn per-SKU (NULL = dùng mặc định toàn shop)
ALTER TABLE "Product" ADD COLUMN "safetyStock" INTEGER;

-- CreateEnum
CREATE TYPE "StockPushStatus" AS ENUM ('PENDING', 'RUNNING');

-- CreateTable
CREATE TABLE "shop_sync_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "autoSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "safetyStockDefault" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_sync_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shop_sync_settings_userId_key" ON "shop_sync_settings"("userId");

-- AddForeignKey
ALTER TABLE "shop_sync_settings" ADD CONSTRAINT "shop_sync_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "stock_push_jobs" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelSku" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "oldAvailable" INTEGER,
    "forced" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,
    "status" "StockPushStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_push_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_push_jobs_channelId_channelSku_key" ON "stock_push_jobs"("channelId", "channelSku");

-- CreateIndex
CREATE INDEX "stock_push_jobs_status_nextRetryAt_idx" ON "stock_push_jobs"("status", "nextRetryAt");

-- AddForeignKey
ALTER TABLE "stock_push_jobs" ADD CONSTRAINT "stock_push_jobs_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- LƯU Ý CHỦ ĐÍCH: KHÔNG backfill bật autoSync cho tài khoản nào — kể cả chủ
-- gian Shopee đang ACTIVE (hành vi đẩy tồn webhook Shopee cũ chỉ chạm SKU đã
-- liên kết, mà thời điểm migration này production chưa có liên kết nào). Bật
-- đồng bộ = trao quyền GHI ĐÈ tồn sàn — phải là quyết định CHỦ ĐỘNG của chủ
-- shop qua trang cấu hình (có cảnh báo), không phải mặc định của một lần deploy.

-- ============================================================
-- BACKFILL — ĐÓNG DẤU ĐƠN LAZADA LỊCH SỬ: từ deploy này đơn Lazada bắt đầu
-- trừ/giữ kho như Shopee. Đơn đã tồn tại TRƯỚC đó chưa từng trừ kho — nếu để
-- trống mốc, vòng quét 10 phút (daysBack 90 ngày) sẽ trừ kho RETROACTIVE hàng
-- loạt đơn cũ làm sập số tồn. Đóng dấu stockDeductedAt = coi như "đã xử lý",
-- các hàm hold/deduct idempotent sẽ bỏ qua; hủy đơn cũ cũng an toàn (restore
-- chỉ hoàn theo bút toán InventoryLog — đơn cũ không có thì không cộng gì).
-- ============================================================
UPDATE "Order" o
SET "stockDeductedAt" = NOW()
FROM "Channel" c
WHERE o."channelId" = c."id"
  AND c."channelName" = 'LAZADA'
  AND o."stockDeductedAt" IS NULL;

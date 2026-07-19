-- ============================================================
-- KIẾN TRÚC 3 TẦNG: Gian hàng → Sản phẩm sàn (đệm) → Sản phẩm gốc
--
-- Không tạo bảng mới cũng không xoá bảng nào. ProductMapping vốn đã có đủ
-- channelId + channelSku + tên sàn, nên nó TIẾN HOÁ thành bảng đệm: cho phép
-- productId = NULL (sản phẩm sàn chưa liên kết) và bổ sung dữ liệu thô từ sàn.
-- Nhờ vậy toàn bộ mapping đang có được giữ nguyên, không phải map lại.
-- ============================================================

-- ---------- TẦNG 1: Gian hàng ----------
ALTER TABLE "Channel" ADD COLUMN "shopName" TEXT;
ALTER TABLE "Channel" ADD COLUMN "externalShopId" TEXT;

-- Đặt tên cho các gian hàng đang có. Sàn nào chỉ có 1 gian thì lấy luôn tên
-- sàn; sàn có nhiều gian thì đánh số theo thứ tự kết nối để không trùng tên
-- (ràng buộc unique bên dưới đòi vậy).
WITH danh_so AS (
  SELECT
    "id",
    "channelName",
    ROW_NUMBER() OVER (PARTITION BY "userId", "channelName" ORDER BY "createdAt") AS stt,
    COUNT(*)    OVER (PARTITION BY "userId", "channelName")                      AS tong
  FROM "Channel"
)
UPDATE "Channel" c
SET "shopName" = CASE
  WHEN d.tong = 1 THEN INITCAP(LOWER(d."channelName"::text))
  ELSE INITCAP(LOWER(d."channelName"::text)) || ' ' || d.stt
END
FROM danh_so d
WHERE c."id" = d."id";

ALTER TABLE "Channel" ALTER COLUMN "shopName" SET NOT NULL;
CREATE UNIQUE INDEX "Channel_userId_channelName_shopName_key"
  ON "Channel"("userId", "channelName", "shopName");

-- ---------- TẦNG 2: Sản phẩm sàn (bảng đệm) ----------
CREATE TYPE "ChannelProductStatus" AS ENUM ('ACTIVE', 'DELISTED');

-- Đổi tên bảng + toàn bộ ràng buộc/index theo đúng quy ước đặt tên của Prisma,
-- nếu không lần migrate sau Prisma sẽ báo lệch schema.
ALTER TABLE "ProductMapping" RENAME TO "ChannelProduct";
ALTER TABLE "ChannelProduct" RENAME CONSTRAINT "ProductMapping_pkey" TO "ChannelProduct_pkey";
ALTER TABLE "ChannelProduct" RENAME CONSTRAINT "ProductMapping_channelId_fkey" TO "ChannelProduct_channelId_fkey";
ALTER TABLE "ChannelProduct" RENAME CONSTRAINT "ProductMapping_productId_fkey" TO "ChannelProduct_productId_fkey";
ALTER INDEX "ProductMapping_productId_idx" RENAME TO "ChannelProduct_productId_idx";
ALTER INDEX "ProductMapping_channelId_channelSku_key" RENAME TO "ChannelProduct_channelId_channelSku_key";

-- Tên sản phẩm trên sàn: từ cột phụ tuỳ chọn thành cột chính bắt buộc
ALTER TABLE "ChannelProduct" RENAME COLUMN "channelProductName" TO "productName";
UPDATE "ChannelProduct" SET "productName" = "channelSku" WHERE "productName" IS NULL;
ALTER TABLE "ChannelProduct" ALTER COLUMN "productName" SET NOT NULL;

-- ĐÂY LÀ THAY ĐỔI CỐT LÕI: NULL = sản phẩm sàn chưa liên kết về kho gốc.
ALTER TABLE "ChannelProduct" ALTER COLUMN "productId" DROP NOT NULL;

-- Dữ liệu thô kéo từ sàn về
ALTER TABLE "ChannelProduct" ADD COLUMN "variantName" TEXT;
ALTER TABLE "ChannelProduct" ADD COLUMN "price" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "ChannelProduct" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "ChannelProduct" ADD COLUMN "externalId" TEXT;
ALTER TABLE "ChannelProduct" ADD COLUMN "lastSyncedAt" TIMESTAMP(3);
ALTER TABLE "ChannelProduct" ADD COLUMN "status" "ChannelProductStatus" NOT NULL DEFAULT 'ACTIVE';

-- Lọc "chưa liên kết / đã liên kết" là thao tác chính của trang Liên kết SP
CREATE INDEX "ChannelProduct_channelId_idx" ON "ChannelProduct"("channelId");

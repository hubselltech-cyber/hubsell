-- Luồng hàng hoàn về kho (RTS) + chốt chặn cộng kho trùng.

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('NONE', 'AWAITING', 'RECEIVED_INTACT', 'DAMAGED', 'CLAIM_SETTLED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "returnStatus" "ReturnStatus" NOT NULL DEFAULT 'NONE';
ALTER TABLE "Order" ADD COLUMN "returnNote" TEXT;
ALTER TABLE "Order" ADD COLUMN "returnedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "stockRestoredAt" TIMESTAMP(3);

-- Đánh dấu những đơn ĐÃ được cộng kho từ trước (do luồng hủy đơn cũ).
-- Nhận diện bằng việc có log kho DƯƠNG gắn với đơn — đó chính là bút toán hoàn
-- kho. Thiếu bước này thì các đơn đó vẫn cộng kho được lần nữa qua luồng quét
-- hàng hoàn, làm tồn kho phình ảo.
UPDATE "Order" o
SET "stockRestoredAt" = (
  SELECT MIN(il."createdAt") FROM "InventoryLog" il
  WHERE il."orderId" = o."id" AND il."changeQuantity" > 0
)
WHERE EXISTS (
  SELECT 1 FROM "InventoryLog" il
  WHERE il."orderId" = o."id" AND il."changeQuantity" > 0
);

-- Đơn đã hủy thì mặc định coi như đang chờ hàng quay về, trừ khi đã cộng kho
-- rồi (nghĩa là hủy trước khi giao, hàng chưa từng rời kho).
UPDATE "Order"
SET "returnStatus" = 'AWAITING'
WHERE "shippingStatus" = 'CANCELLED' AND "stockRestoredAt" IS NULL;

-- Đơn đã hủy VÀ đã cộng kho: coi như đã nhận hoàn nguyên vẹn xong xuôi
UPDATE "Order"
SET "returnStatus" = 'RECEIVED_INTACT', "returnedAt" = "stockRestoredAt"
WHERE "shippingStatus" = 'CANCELLED' AND "stockRestoredAt" IS NOT NULL;

CREATE INDEX "Order_returnStatus_idx" ON "Order"("returnStatus");

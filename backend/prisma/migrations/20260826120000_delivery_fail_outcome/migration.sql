-- KET QUA cuu don giao that bai CHOT tu hanh trinh van chuyen (26/08).
-- Probe production: Order.shippingStatus khong du de tinh the Cuu duoc/Mat don
-- (don giao xong nam TO_CONFIRM_RECEIVE->SHIPPING nhieu ngay; kien quay dau
-- thi order_status Shopee dung im o SHIPPED) — worker tu chot vao notice.
DO $$ BEGIN
  CREATE TYPE "DeliveryFailOutcome" AS ENUM ('PENDING', 'SAVED', 'LOST');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "delivery_fail_notices" ADD COLUMN IF NOT EXISTS "outcome" "DeliveryFailOutcome" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "delivery_fail_notices" ADD COLUMN IF NOT EXISTS "outcomeAt" TIMESTAMP(3);
ALTER TABLE "delivery_fail_notices" ADD COLUMN IF NOT EXISTS "outcomeNote" TEXT;

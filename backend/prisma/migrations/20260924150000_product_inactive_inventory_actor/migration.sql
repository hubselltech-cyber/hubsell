-- HOÀN THIỆN HÀNG HÓA đợt A (24/09/2026): ngừng kinh doanh SKU + nhật ký kho ghi ai làm
-- + loại ADJUST. Viết IF NOT EXISTS để Render `migrate deploy` chạy lại êm.

ALTER TYPE "InventoryLogType" ADD VALUE IF NOT EXISTS 'ADJUST';

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "InventoryLog" ADD COLUMN IF NOT EXISTS "actorId" TEXT;

DO $$ BEGIN
  ALTER TABLE "InventoryLog" ADD CONSTRAINT "InventoryLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "InventoryLog_createdAt_idx" ON "InventoryLog"("createdAt");

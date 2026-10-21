-- ============================================================
-- 22/10/2026 — CRM HQ TỰ CHUYỂN TRẠNG THÁI THEO THUÊ BAO (docs/HQ-CRM-TU-CHUYEN-TRANG-THAI.md)
-- Hồ sơ chăm sóc ghi thêm AI đặt trạng thái lần gần nhất (tay / tự động theo
-- thanh toán / tự động theo hết gói) + LÚC NÀO, để worker không đè quyết định
-- tay sau khi hết gói. Dòng cũ: nguồn = tay, mốc = updatedAt.
-- Bảng nhỏ (một dòng / chủ shop), ADD COLUMN có DEFAULT không ghi lại dữ liệu.
-- ============================================================
DO $$ BEGIN
  CREATE TYPE "PlatformCareStatusSource" AS ENUM ('MANUAL', 'AUTO_PAYMENT', 'AUTO_EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "platform_customer_care"
  ADD COLUMN IF NOT EXISTS "statusSource" "PlatformCareStatusSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "platform_customer_care" SET "statusChangedAt" = "updatedAt"
WHERE "statusChangedAt" > "updatedAt";

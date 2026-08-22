-- KỲ MUA 3 & 6 THÁNG (anh Trung 22/08: khách sẽ mua 3/6/12 tháng): thêm 2 giá
-- kỳ vào bảng giá — 0 = không bán kỳ đó. PG12+ cho ALTER TYPE ADD VALUE trong
-- transaction; IF NOT EXISTS để chạy lại êm.

ALTER TYPE "BillingCycle" ADD VALUE IF NOT EXISTS 'QUARTERLY';

ALTER TYPE "BillingCycle" ADD VALUE IF NOT EXISTS 'SEMIANNUAL';

ALTER TABLE "service_plans" ADD COLUMN IF NOT EXISTS "priceQuarterly" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "service_plans" ADD COLUMN IF NOT EXISTS "priceSemiannual" DECIMAL(14,2) NOT NULL DEFAULT 0;

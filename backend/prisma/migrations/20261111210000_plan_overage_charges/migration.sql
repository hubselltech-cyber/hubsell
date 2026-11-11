-- Phí vượt trần đơn "tính thẳng" cho MỌI gói (11/11/2026, anh Trung chốt): vượt bao nhiêu
-- đơn × đơn giá của gói đang dùng (giá 1 tháng ÷ trần), thu đầu tháng sau.
-- Thiết kế: docs/GOI-VUOT-TRAN-TINH-THEO-DON-GIA-GOI.md. Chỉ THÊM — không đụng dữ liệu cũ.

DO $$ BEGIN
  CREATE TYPE "PackagePaymentKind" AS ENUM ('PLAN', 'OVERAGE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PlanOverageStatus" AS ENUM ('NONE', 'OPEN', 'PAID', 'WAIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "package_payments" ADD COLUMN IF NOT EXISTS "kind" "PackagePaymentKind" NOT NULL DEFAULT 'PLAN';
ALTER TABLE "package_payments" ADD COLUMN IF NOT EXISTS "orderCap" INTEGER;
ALTER TABLE "package_payments" ADD COLUMN IF NOT EXISTS "overageUnitPrice" DECIMAL(10,2);
ALTER TABLE "package_payments" ADD COLUMN IF NOT EXISTS "overageChargeId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "package_payments_overageChargeId_key" ON "package_payments" ("overageChargeId");

ALTER TABLE "gateway_payment_orders" ADD COLUMN IF NOT EXISTS "overageChargeId" TEXT;

CREATE TABLE IF NOT EXISTS "plan_overage_charges" (
  "id"               TEXT NOT NULL,
  "ownerId"          TEXT NOT NULL,
  "month"            TEXT NOT NULL,
  "planCode"         TEXT NOT NULL,
  "planName"         TEXT NOT NULL,
  "orderCap"         INTEGER NOT NULL,
  "ordersCounted"    INTEGER NOT NULL,
  "overOrders"       INTEGER NOT NULL,
  "unitPrice"        DECIMAL(10,2) NOT NULL,
  "amount"           DECIMAL(14,2) NOT NULL,
  "status"           "PlanOverageStatus" NOT NULL DEFAULT 'OPEN',
  "dueAt"            TIMESTAMP(3) NOT NULL,
  "paidAt"           TIMESTAMP(3),
  "packagePaymentId" TEXT,
  "waivedAt"         TIMESTAMP(3),
  "waivedByName"     TEXT,
  "waivedNote"       TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "plan_overage_charges_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "plan_overage_charges_ownerId_month_key" ON "plan_overage_charges" ("ownerId", "month");
CREATE INDEX IF NOT EXISTS "plan_overage_charges_status_dueAt_idx" ON "plan_overage_charges" ("status", "dueAt");

DO $$ BEGIN
  ALTER TABLE "plan_overage_charges"
    ADD CONSTRAINT "plan_overage_charges_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Bật RLS như mọi bảng khác (Supabase 30/09/2026); backend đi Prisma nên không cần policy.
ALTER TABLE "plan_overage_charges" ENABLE ROW LEVEL SECURITY;

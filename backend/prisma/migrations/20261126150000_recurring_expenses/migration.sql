-- ============================================================
-- 26/11/2026 — CHI PHÍ ĐỊNH KỲ (docs/THU-CHI-VAN-HANH-CHI-PHI-DINH-KY.md)
--
--   recurring_expenses            luật "mỗi ngày / mỗi tháng / mỗi năm ghi một khoản chi"
--   OperatingExpense.recurringId  khoản do luật nào ghi (null = nhập tay)
--
-- Bảng luật MỚI, rỗng. "OperatingExpense" đang nhỏ (prod 26/11: 174 dòng) nên thêm cột,
-- khóa ngoại và hai chỉ mục thường (không CONCURRENTLY) là tức thì. Khóa ngoại tới "User" /
-- "Channel" cùng kiểu các migration trước (plan_overage_charges, tiktok_wallet_txns).
-- Mọi lệnh viết kiểu "đã có thì bỏ qua" để script áp migration local chạy lại được.
-- RLS bật theo luật chung (backend đi bằng vai trò chủ database nên không cần policy).
-- ============================================================

DO $$ BEGIN
  CREATE TYPE "RecurringCadence" AS ENUM ('DAILY', 'MONTHLY', 'YEARLY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RecurringStatus" AS ENUM ('ACTIVE', 'STOPPED', 'ENDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "recurring_expenses" (
  "id"               TEXT NOT NULL,
  "userId"           TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "category"         "ExpenseCategory" NOT NULL DEFAULT 'OTHER',
  "type"             "ExpenseType" NOT NULL DEFAULT 'FIXED',
  "appliedSku"       TEXT,
  "amount"           DECIMAL(12,2) NOT NULL,
  "cadence"          "RecurringCadence" NOT NULL,
  "startDay"         DATE NOT NULL,
  "endDay"           DATE,
  "fundChannelId"    TEXT,
  "fundPlatform"     "ChannelName",
  "fundSource"       "FundSourceType",
  "note"             TEXT,
  "status"           "RecurringStatus" NOT NULL DEFAULT 'ACTIVE',
  "generatedThrough" DATE NOT NULL,
  "stoppedAt"        TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recurring_expenses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recurring_expenses_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "recurring_expenses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "recurring_expenses_fundChannelId_fkey" FOREIGN KEY ("fundChannelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "recurring_expenses_userId_idx" ON "recurring_expenses" ("userId");
CREATE INDEX IF NOT EXISTS "recurring_expenses_status_generatedThrough_idx" ON "recurring_expenses" ("status", "generatedThrough");
CREATE INDEX IF NOT EXISTS "recurring_expenses_fundChannelId_idx" ON "recurring_expenses" ("fundChannelId");

ALTER TABLE "OperatingExpense" ADD COLUMN IF NOT EXISTS "recurringId" TEXT;

DO $$ BEGIN
  ALTER TABLE "OperatingExpense"
    ADD CONSTRAINT "OperatingExpense_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "recurring_expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "OperatingExpense_recurringId_expenseDate_key" ON "OperatingExpense" ("recurringId", "expenseDate");
CREATE INDEX IF NOT EXISTS "OperatingExpense_userId_expenseDate_idx" ON "OperatingExpense" ("userId", "expenseDate");

ALTER TABLE "recurring_expenses" ENABLE ROW LEVEL SECURITY;

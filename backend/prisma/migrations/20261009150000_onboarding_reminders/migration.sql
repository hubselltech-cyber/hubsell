-- Vé chống trùng thư nhắc khách mới (workers/onboarding-reminder.ts, 09/10/2026):
-- mỗi (chủ shop, mốc nhắc) chỉ một dòng — hai worker song song không gửi đôi.
CREATE TABLE IF NOT EXISTS "onboarding_reminders" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "kind"      TEXT NOT NULL,
  "batchId"   TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "onboarding_reminders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "onboarding_reminders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "onboarding_reminders_userId_kind_key" ON "onboarding_reminders" ("userId", "kind");
CREATE INDEX IF NOT EXISTS "onboarding_reminders_batchId_idx" ON "onboarding_reminders" ("batchId");

-- Worker quét chủ shop theo khoảng ngày đăng ký → chỉ mục ngay, không quét cả bảng.
CREATE INDEX IF NOT EXISTS "User_createdAt_idx" ON "User" ("createdAt");

ALTER TABLE "onboarding_reminders" ENABLE ROW LEVEL SECURITY;

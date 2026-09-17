-- 17/09/2026: mã SKU lệch giá vốn giữa các gian mà chủ shop chọn "giữ nguyên, không nhắc nữa".
CREATE TABLE IF NOT EXISTS "cost_conflict_dismissals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cost_conflict_dismissals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "cost_conflict_dismissals_userId_code_key" ON "cost_conflict_dismissals"("userId", "code");
ALTER TABLE "cost_conflict_dismissals" ADD CONSTRAINT "cost_conflict_dismissals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

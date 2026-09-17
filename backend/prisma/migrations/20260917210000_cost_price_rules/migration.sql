-- 17/09/2026: bảng giá vốn tự nhập cho tab "Mapping giá vốn" (mã SKU / mã mẫu → giá vốn).
CREATE TABLE IF NOT EXISTS "cost_price_rules" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "costPrice" DECIMAL(12,2) NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cost_price_rules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "cost_price_rules_userId_code_key" ON "cost_price_rules"("userId", "code");
ALTER TABLE "cost_price_rules" ADD CONSTRAINT "cost_price_rules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

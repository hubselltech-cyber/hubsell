-- ============================================================
-- SQL CHẠY TAY TRÊN SUPABASE PRODUCTION (SQL Editor)
--
-- Local dùng `prisma db push`, nhưng Supabase production theo quy trình dự án
-- phải ALTER tay. File này gom các lệnh của từng đợt thay đổi schema — chạy
-- xong đợt nào thì giữ lại làm sử liệu (IF NOT EXISTS nên chạy lại vô hại).
-- ============================================================

-- ── 07/08/2026: Thông số sản phẩm cho Trợ lý vận hành (AI CSKH) ──
-- Chất liệu + hướng dẫn bảo quản + bảng size để AI Copilot tư vấn khách.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "material" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "careInstructions" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sizeChart" JSONB;

-- ── 09/08/2026: Affiliate Tiep Thi & Vi Hubsell (Kiem Tien Cung Hubsell) ──
-- ⚠️ PHAI CHAY NGAY SAU KHI RENDER DEPLOY dot nay: Prisma client moi select
-- cac cot moi tren "User" — thieu cot la VO dang nhap/dang ky production.
-- Toan bo lenh CHI THEM (khong DROP/UPDATE du lieu cu), chay lai vo hai.

DO $$ BEGIN
  CREATE TYPE "WalletTxnType" AS ENUM ('COMMISSION', 'PACKAGE_RENEWAL', 'WITHDRAWAL', 'ADJUSTMENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "WalletTxnStatus" AS ENUM ('PENDING', 'COMPLETED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "WithdrawalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referralCode" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referredById" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referralSeq" SERIAL NOT NULL;

-- Don +100 mot lan duy nhat de ma gioi thieu HUBSELL<seq> co toi thieu 3 chu so
UPDATE "User" SET "referralSeq" = "referralSeq" + 100
WHERE (SELECT MAX("referralSeq") FROM "User") < 100;
SELECT setval(pg_get_serial_sequence('"User"', 'referralSeq'),
              GREATEST((SELECT MAX("referralSeq") FROM "User"), 100));

CREATE UNIQUE INDEX IF NOT EXISTS "User_referralCode_key" ON "User"("referralCode");
CREATE UNIQUE INDEX IF NOT EXISTS "User_referralSeq_key" ON "User"("referralSeq");

DO $$ BEGIN
  ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey"
    FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "hubsell_wallets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hubsell_wallets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hubsell_wallets_userId_fkey" FOREIGN KEY ("userId")
      REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "hubsell_wallets_userId_key" ON "hubsell_wallets"("userId");

CREATE TABLE IF NOT EXISTS "withdrawal_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "bankName" TEXT NOT NULL,
    "bankAccountNumber" TEXT NOT NULL,
    "bankAccountName" TEXT NOT NULL,
    "status" "WithdrawalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "withdrawal_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "withdrawal_requests_userId_fkey" FOREIGN KEY ("userId")
      REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "withdrawal_requests_userId_createdAt_idx" ON "withdrawal_requests"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "withdrawal_requests_status_idx" ON "withdrawal_requests"("status");

CREATE TABLE IF NOT EXISTS "wallet_transactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "WalletTxnType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "WalletTxnStatus" NOT NULL DEFAULT 'COMPLETED',
    "note" TEXT,
    "sourceUserId" TEXT,
    "withdrawalRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wallet_transactions_userId_fkey" FOREIGN KEY ("userId")
      REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "wallet_transactions_withdrawalRequestId_fkey" FOREIGN KEY ("withdrawalRequestId")
      REFERENCES "withdrawal_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "wallet_transactions_userId_createdAt_idx" ON "wallet_transactions"("userId", "createdAt");

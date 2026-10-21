-- ============================================================
-- 21/10/2026 — MIGRATION BÙ: nhóm bảng Ads + Ví lên production bằng `prisma db push`
-- trước khi có migration, nên lịch sử migration KHÔNG có CREATE TABLE cho chúng.
-- Hậu quả: `migrate deploy` trên DB TRỐNG dừng ở 20260914200000_ads_hubsell_pause_flag
-- (ALTER "AdsCampaign" mà bảng chưa có) — không dựng được DB dev/test mới.
--
-- File này đặt TRƯỚC 20260914200000 (tên 20260914190000) và chỉ tạo bảng ở trạng
-- thái trước ngày ấy: cột các migration SAU thêm (hubsellPause*, hubsellBudget*,
-- createdByHubsellAt, hubsellProposal, manualBidding, roasTargetChangedAt,
-- roasTargetPrev, adviceKind*, broadOrderAmount, directOrderAmount) KHÔNG có ở
-- đây — các migration ấy tự thêm như cũ.
--
-- Production (đã có bảng): mọi lệnh đều IF NOT EXISTS / kiểm pg_type, pg_constraint
-- → chạy qua không đổi gì, không khóa bảng nóng. Prisma áp migration chưa ghi
-- nhận theo thứ tự tên, nên tên cũ hơn vẫn được áp một lần trên prod (no-op).
-- ============================================================

-- ---------- Enum của Ví ----------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WalletTxnType') THEN
    CREATE TYPE "WalletTxnType" AS ENUM ('COMMISSION', 'PACKAGE_RENEWAL', 'WITHDRAWAL', 'ADJUSTMENT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WalletTxnStatus') THEN
    CREATE TYPE "WalletTxnStatus" AS ENUM ('PENDING', 'COMPLETED', 'REJECTED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WithdrawalRequestStatus') THEN
    CREATE TYPE "WithdrawalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
  END IF;
END $$;

-- ---------- Ads: chiến dịch ----------
CREATE TABLE IF NOT EXISTS "AdsCampaign" (
  "id"                        TEXT NOT NULL,
  "channelId"                 TEXT NOT NULL,
  "campaignId"                TEXT NOT NULL,
  "adType"                    TEXT NOT NULL DEFAULT '',
  "name"                      TEXT NOT NULL DEFAULT '',
  "status"                    TEXT NOT NULL DEFAULT '',
  "placement"                 TEXT NOT NULL DEFAULT '',
  "biddingMethod"             TEXT NOT NULL DEFAULT '',
  "budget"                    DECIMAL(14,2) NOT NULL DEFAULT 0,
  "roasTarget"                DECIMAL(8,2),
  "startTime"                 TIMESTAMP(3),
  "endTime"                   TIMESTAMP(3),
  "itemIds"                   TEXT NOT NULL DEFAULT '',
  "assistantDecision"         TEXT NOT NULL DEFAULT '',
  "assistantDecisionVerdict"  TEXT NOT NULL DEFAULT '',
  "assistantDecisionAt"       TIMESTAMP(3),
  "lastSyncedAt"              TIMESTAMP(3) NOT NULL,
  "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdsCampaign_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AdsCampaign_channelId_campaignId_key" ON "AdsCampaign"("channelId", "campaignId");
CREATE INDEX IF NOT EXISTS "AdsCampaign_channelId_idx" ON "AdsCampaign"("channelId");

-- ---------- Ads: hiệu suất theo ngày ----------
CREATE TABLE IF NOT EXISTS "AdsCampaignDailyPerf" (
  "id"            TEXT NOT NULL,
  "adsCampaignId" TEXT NOT NULL,
  "date"          DATE NOT NULL,
  "impression"    INTEGER NOT NULL DEFAULT 0,
  "clicks"        INTEGER NOT NULL DEFAULT 0,
  "expense"       DECIMAL(14,2) NOT NULL DEFAULT 0,
  "broadOrder"    INTEGER NOT NULL DEFAULT 0,
  "broadGmv"      DECIMAL(14,2) NOT NULL DEFAULT 0,
  "directOrder"   INTEGER NOT NULL DEFAULT 0,
  "directGmv"     DECIMAL(14,2) NOT NULL DEFAULT 0,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdsCampaignDailyPerf_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AdsCampaignDailyPerf_adsCampaignId_date_key" ON "AdsCampaignDailyPerf"("adsCampaignId", "date");
CREATE INDEX IF NOT EXISTS "AdsCampaignDailyPerf_adsCampaignId_idx" ON "AdsCampaignDailyPerf"("adsCampaignId");

-- ---------- Ads: chi phí cấp gian theo ngày ----------
CREATE TABLE IF NOT EXISTS "AdSpend" (
  "id"        TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "date"      DATE NOT NULL,
  "amount"    DECIMAL(12,2) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdSpend_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AdSpend_channelId_date_key" ON "AdSpend"("channelId", "date");
CREATE INDEX IF NOT EXISTS "AdSpend_channelId_idx" ON "AdSpend"("channelId");

-- ---------- Ads: luật Trợ lý riêng của gian ----------
CREATE TABLE IF NOT EXISTS "AdsAssistantConfig" (
  "id"        TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "config"    JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdsAssistantConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AdsAssistantConfig_channelId_key" ON "AdsAssistantConfig"("channelId");

-- ---------- Ads: nhật ký hành động Trợ lý ----------
CREATE TABLE IF NOT EXISTS "AdsActionLog" (
  "id"            TEXT NOT NULL,
  "channelId"     TEXT NOT NULL,
  "adsCampaignId" TEXT NOT NULL,
  "action"        TEXT NOT NULL,
  "mode"          TEXT NOT NULL,
  "verdict"       TEXT NOT NULL,
  "reasons"       TEXT NOT NULL DEFAULT '',
  "referenceId"   TEXT NOT NULL,
  "status"        TEXT NOT NULL,
  "error"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdsActionLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AdsActionLog_referenceId_key" ON "AdsActionLog"("referenceId");
CREATE INDEX IF NOT EXISTS "AdsActionLog_adsCampaignId_createdAt_idx" ON "AdsActionLog"("adsCampaignId", "createdAt");
CREATE INDEX IF NOT EXISTS "AdsActionLog_channelId_createdAt_idx" ON "AdsActionLog"("channelId", "createdAt");
CREATE INDEX IF NOT EXISTS "AdsActionLog_createdAt_idx" ON "AdsActionLog"("createdAt");

-- ---------- Ví Hubsell ----------
CREATE TABLE IF NOT EXISTS "hubsell_wallets" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "balance"   DECIMAL(14,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hubsell_wallets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "hubsell_wallets_userId_key" ON "hubsell_wallets"("userId");

CREATE TABLE IF NOT EXISTS "withdrawal_requests" (
  "id"                TEXT NOT NULL,
  "userId"            TEXT NOT NULL,
  "amount"            DECIMAL(14,2) NOT NULL,
  "bankName"          TEXT NOT NULL,
  "bankAccountNumber" TEXT NOT NULL,
  "bankAccountName"   TEXT NOT NULL,
  "status"            "WithdrawalRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reviewNote"        TEXT,
  "processedAt"       TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "withdrawal_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "withdrawal_requests_status_idx" ON "withdrawal_requests"("status");
CREATE INDEX IF NOT EXISTS "withdrawal_requests_userId_createdAt_idx" ON "withdrawal_requests"("userId", "createdAt");

CREATE TABLE IF NOT EXISTS "wallet_transactions" (
  "id"                  TEXT NOT NULL,
  "userId"              TEXT NOT NULL,
  "type"                "WalletTxnType" NOT NULL,
  "amount"              DECIMAL(14,2) NOT NULL,
  "status"              "WalletTxnStatus" NOT NULL DEFAULT 'COMPLETED',
  "note"                TEXT,
  "sourceUserId"        TEXT,
  "withdrawalRequestId" TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "wallet_transactions_userId_createdAt_idx" ON "wallet_transactions"("userId", "createdAt");

-- ---------- Khóa ngoại (ADD CONSTRAINT không có IF NOT EXISTS → kiểm pg_constraint) ----------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdsCampaign_channelId_fkey') THEN
    ALTER TABLE "AdsCampaign" ADD CONSTRAINT "AdsCampaign_channelId_fkey"
      FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdsCampaignDailyPerf_adsCampaignId_fkey') THEN
    ALTER TABLE "AdsCampaignDailyPerf" ADD CONSTRAINT "AdsCampaignDailyPerf_adsCampaignId_fkey"
      FOREIGN KEY ("adsCampaignId") REFERENCES "AdsCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdSpend_channelId_fkey') THEN
    ALTER TABLE "AdSpend" ADD CONSTRAINT "AdSpend_channelId_fkey"
      FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdsAssistantConfig_channelId_fkey') THEN
    ALTER TABLE "AdsAssistantConfig" ADD CONSTRAINT "AdsAssistantConfig_channelId_fkey"
      FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdsActionLog_channelId_fkey') THEN
    ALTER TABLE "AdsActionLog" ADD CONSTRAINT "AdsActionLog_channelId_fkey"
      FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdsActionLog_adsCampaignId_fkey') THEN
    ALTER TABLE "AdsActionLog" ADD CONSTRAINT "AdsActionLog_adsCampaignId_fkey"
      FOREIGN KEY ("adsCampaignId") REFERENCES "AdsCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hubsell_wallets_userId_fkey') THEN
    ALTER TABLE "hubsell_wallets" ADD CONSTRAINT "hubsell_wallets_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'withdrawal_requests_userId_fkey') THEN
    ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wallet_transactions_userId_fkey') THEN
    ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wallet_transactions_withdrawalRequestId_fkey') THEN
    ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_withdrawalRequestId_fkey"
      FOREIGN KEY ("withdrawalRequestId") REFERENCES "withdrawal_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

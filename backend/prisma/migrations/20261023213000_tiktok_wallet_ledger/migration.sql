-- Sổ cái ví TikTok (23/10/2026): từng dòng giao dịch tài chính của gian
-- (GET /finance/202309/withdrawals: SETTLE / WITHDRAW / PAYMENT / TRANSFER /
-- REVERSE / REFUND…) — số dư Ví sàn = cộng dồn các dòng (sàn không có API số dư).
CREATE TABLE IF NOT EXISTS "tiktok_wallet_txns" (
  "id" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" TEXT,
  "createTime" TIMESTAMP(3) NOT NULL,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tiktok_wallet_txns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tiktok_wallet_txns_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "tiktok_wallet_txns_channelId_externalId_key" ON "tiktok_wallet_txns"("channelId", "externalId");
CREATE INDEX IF NOT EXISTS "tiktok_wallet_txns_channelId_createTime_idx" ON "tiktok_wallet_txns"("channelId", "createTime");
ALTER TABLE "tiktok_wallet_txns" ENABLE ROW LEVEL SECURITY;

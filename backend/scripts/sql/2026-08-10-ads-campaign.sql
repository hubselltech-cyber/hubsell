-- ============================================================
-- TRỢ LÝ QUẢNG CÁO SHOPEE — GIAI ĐOẠN 1 (10/08/2026)
-- Bảng chiến dịch quảng cáo + hiệu suất theo ngày (sync READ-ONLY từ Ads API).
--
-- CHẠY TAY TRÊN SUPABASE (SQL Editor) TRƯỚC KHI DEPLOY BACKEND MỚI.
-- Local dev chạy qua: npx prisma db execute --file scripts/sql/2026-08-10-ads-campaign.sql
-- Idempotent: IF NOT EXISTS toàn bộ, chạy lặp vô hại.
-- ============================================================

CREATE TABLE IF NOT EXISTS "AdsCampaign" (
    "id"            TEXT NOT NULL,
    "channelId"     TEXT NOT NULL,
    "campaignId"    TEXT NOT NULL,
    "adType"        TEXT NOT NULL DEFAULT '',
    "name"          TEXT NOT NULL DEFAULT '',
    "status"        TEXT NOT NULL DEFAULT '',
    "placement"     TEXT NOT NULL DEFAULT '',
    "biddingMethod" TEXT NOT NULL DEFAULT '',
    "budget"        DECIMAL(14,2) NOT NULL DEFAULT 0,
    "roasTarget"    DECIMAL(8,2),
    "startTime"     TIMESTAMP(3),
    "endTime"       TIMESTAMP(3),
    "itemIds"       TEXT NOT NULL DEFAULT '',
    "lastSyncedAt"  TIMESTAMP(3) NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdsCampaign_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AdsCampaign_channelId_campaignId_key"
    ON "AdsCampaign"("channelId", "campaignId");
CREATE INDEX IF NOT EXISTS "AdsCampaign_channelId_idx"
    ON "AdsCampaign"("channelId");

DO $$ BEGIN
    ALTER TABLE "AdsCampaign"
        ADD CONSTRAINT "AdsCampaign_channelId_fkey"
        FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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

CREATE UNIQUE INDEX IF NOT EXISTS "AdsCampaignDailyPerf_adsCampaignId_date_key"
    ON "AdsCampaignDailyPerf"("adsCampaignId", "date");
CREATE INDEX IF NOT EXISTS "AdsCampaignDailyPerf_adsCampaignId_idx"
    ON "AdsCampaignDailyPerf"("adsCampaignId");

DO $$ BEGIN
    ALTER TABLE "AdsCampaignDailyPerf"
        ADD CONSTRAINT "AdsCampaignDailyPerf_adsCampaignId_fkey"
        FOREIGN KEY ("adsCampaignId") REFERENCES "AdsCampaign"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

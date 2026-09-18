-- 18/09/2026: LOẠI VIDEO TỰ ĐỘNG cho GMV Max (TikTok) — cấu hình theo từng chiến dịch + theo dõi từng video.
ALTER TABLE "tiktok_ads_store_links" ADD COLUMN IF NOT EXISTS "lastVideoTrackOn" TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS "tiktok_ads_auto_rules" (
    "id" TEXT NOT NULL,
    "adsCampaignId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'off',
    "roiTarget" DECIMAL(8,2) NOT NULL,
    "windowDays" INTEGER NOT NULL DEFAULT 7,
    "minSpend" DECIMAL(14,2) NOT NULL DEFAULT 50000,
    "spendNoOrder" DECIMAL(14,2) NOT NULL DEFAULT 200000,
    "roiHardPct" INTEGER NOT NULL DEFAULT 50,
    "maxCpa" DECIMAL(14,2),
    "graceMinOrders" INTEGER NOT NULL DEFAULT 20,
    "graceDays" INTEGER NOT NULL DEFAULT 2,
    "maxExcludePerDay" INTEGER NOT NULL DEFAULT 10,
    "minOrderingVideosKeep" INTEGER NOT NULL DEFAULT 3,
    "lastRunOn" TEXT NOT NULL DEFAULT '',
    "lastRunAt" TIMESTAMP(3),
    "lastRunSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tiktok_ads_auto_rules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "tiktok_ads_auto_rules_adsCampaignId_key" ON "tiktok_ads_auto_rules"("adsCampaignId");
CREATE INDEX IF NOT EXISTS "tiktok_ads_auto_rules_mode_idx" ON "tiktok_ads_auto_rules"("mode");
ALTER TABLE "tiktok_ads_auto_rules" ADD CONSTRAINT "tiktok_ads_auto_rules_adsCampaignId_fkey" FOREIGN KEY ("adsCampaignId") REFERENCES "AdsCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "tiktok_ads_video_watches" (
    "id" TEXT NOT NULL,
    "adsCampaignId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "spuId" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '',
    "statusSince" TEXT NOT NULL DEFAULT '',
    "firstSeenOn" TEXT NOT NULL,
    "lastSeenOn" TEXT NOT NULL DEFAULT '',
    "graduatedOn" TEXT NOT NULL DEFAULT '',
    "statusLog" TEXT NOT NULL DEFAULT '',
    "violationSince" TEXT NOT NULL DEFAULT '',
    "spendAtViolation" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "restoredByUserAt" TIMESTAMP(3),
    "lastVerdict" TEXT NOT NULL DEFAULT '',
    "lastVerdictOn" TEXT NOT NULL DEFAULT '',
    "lastReason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tiktok_ads_video_watches_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "tiktok_ads_video_watches_adsCampaignId_videoId_key" ON "tiktok_ads_video_watches"("adsCampaignId", "videoId");
CREATE INDEX IF NOT EXISTS "tiktok_ads_video_watches_adsCampaignId_lastVerdictOn_idx" ON "tiktok_ads_video_watches"("adsCampaignId", "lastVerdictOn");
ALTER TABLE "tiktok_ads_video_watches" ADD CONSTRAINT "tiktok_ads_video_watches_adsCampaignId_fkey" FOREIGN KEY ("adsCampaignId") REFERENCES "AdsCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

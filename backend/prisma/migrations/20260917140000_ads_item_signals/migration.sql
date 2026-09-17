-- Đợt D (17/09/2026): tín hiệu thị trường theo SP cho "Gợi ý chạy ads" + nguồn tạo campaign từ Hubsell.
CREATE TABLE IF NOT EXISTS "ads_item_signals" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "sale" INTEGER,
    "views" INTEGER,
    "likes" INTEGER,
    "ratingStar" DECIMAL(3,2),
    "commentCount" INTEGER,
    "shopeeTags" TEXT NOT NULL DEFAULT '',
    "adBlocked" BOOLEAN NOT NULL DEFAULT false,
    "ongoingAdTypes" TEXT NOT NULL DEFAULT '',
    "roiLower" DECIMAL(8,2),
    "roiExact" DECIMAL(8,2),
    "roiUpper" DECIMAL(8,2),
    "budgetMin" DECIMAL(14,2),
    "budgetRecommended" DECIMAL(14,2),
    "budgetMax" DECIMAL(14,2),
    "kwSearchVolume" INTEGER,
    "kwAvgBid" DECIMAL(12,2),
    "kwCount" INTEGER,
    "baseSyncedAt" TIMESTAMP(3),
    "proposalSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ads_item_signals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ads_item_signals_channelId_itemId_key" ON "ads_item_signals"("channelId", "itemId");
CREATE INDEX IF NOT EXISTS "ads_item_signals_channelId_idx" ON "ads_item_signals"("channelId");
ALTER TABLE "ads_item_signals" ADD CONSTRAINT "ads_item_signals_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdsCampaign" ADD COLUMN IF NOT EXISTS "createdByHubsellAt" TIMESTAMP(3);
ALTER TABLE "AdsCampaign" ADD COLUMN IF NOT EXISTS "hubsellProposal" JSONB;

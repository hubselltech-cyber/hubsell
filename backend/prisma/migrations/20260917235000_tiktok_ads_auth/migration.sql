-- 17/09/2026: ủy quyền TikTok Marketing API (quảng cáo GMV Max).
-- tiktok_ads_auths  = một lần ủy quyền của chủ shop (token dài hạn, thấy nhiều TKQC/nhiều shop).
-- tiktok_ads_store_links = gian TikTok ↔ TKQC độc quyền GMV Max của gian đó (mỗi gian tối đa 1).
CREATE TABLE IF NOT EXISTS "tiktok_ads_auths" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "advertiserIds" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tiktok_ads_auths_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "tiktok_ads_auths_userId_idx" ON "tiktok_ads_auths"("userId");
ALTER TABLE "tiktok_ads_auths" ADD CONSTRAINT "tiktok_ads_auths_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "tiktok_ads_store_links" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authId" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "advertiserName" TEXT NOT NULL DEFAULT '',
    "storeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tiktok_ads_store_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "tiktok_ads_store_links_channelId_key" ON "tiktok_ads_store_links"("channelId");
CREATE INDEX IF NOT EXISTS "tiktok_ads_store_links_authId_idx" ON "tiktok_ads_store_links"("authId");
CREATE INDEX IF NOT EXISTS "tiktok_ads_store_links_status_lastSyncedAt_idx" ON "tiktok_ads_store_links"("status", "lastSyncedAt");
ALTER TABLE "tiktok_ads_store_links" ADD CONSTRAINT "tiktok_ads_store_links_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tiktok_ads_store_links" ADD CONSTRAINT "tiktok_ads_store_links_authId_fkey" FOREIGN KEY ("authId") REFERENCES "tiktok_ads_auths"("id") ON DELETE CASCADE ON UPDATE CASCADE;

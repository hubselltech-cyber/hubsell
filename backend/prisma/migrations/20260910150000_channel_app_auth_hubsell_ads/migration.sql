-- Hubsell Ads (10/09/2026): token ủy quyền của app phụ "Ads Service" trên cùng
-- gian Shopee — Shopee cấp quyền theo từng app nên app chính (ERP System sau
-- ISV) mất Ads API, Trợ lý quảng cáo chạy trên partner_id riêng.
CREATE TYPE "ChannelAppKind" AS ENUM ('HUBSELL_ADS');

CREATE TABLE "channel_app_auths" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "app" "ChannelAppKind" NOT NULL,
    "externalShopId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessTokenExpireAt" TIMESTAMP(3) NOT NULL,
    "refreshTokenExpireAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_app_auths_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "channel_app_auths_channelId_app_key" ON "channel_app_auths"("channelId", "app");
CREATE INDEX "channel_app_auths_app_status_accessTokenExpireAt_idx" ON "channel_app_auths"("app", "status", "accessTokenExpireAt");

ALTER TABLE "channel_app_auths" ADD CONSTRAINT "channel_app_auths_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

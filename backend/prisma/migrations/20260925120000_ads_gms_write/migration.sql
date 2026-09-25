-- GMV Max cấp shop — LỆNH GHI (25/09/2026): Hubsell nhớ cấu hình GMS đã đặt vì Shopee không có API đọc lại.
-- IF NOT EXISTS để Render migrate deploy chạy lại êm.

CREATE TABLE IF NOT EXISTS "ads_gms_campaigns" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ongoing',
    "dailyBudget" DECIMAL(14,2),
    "roasTarget" DECIMAL(8,1),
    "createdByHubsellAt" TIMESTAMP(3),
    "lastAction" TEXT,
    "lastActionAt" TIMESTAMP(3),
    "lastError" TEXT,
    "history" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ads_gms_campaigns_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ads_gms_campaigns_channelId_key" ON "ads_gms_campaigns"("channelId");
DO $$ BEGIN
  ALTER TABLE "ads_gms_campaigns" ADD CONSTRAINT "ads_gms_campaigns_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

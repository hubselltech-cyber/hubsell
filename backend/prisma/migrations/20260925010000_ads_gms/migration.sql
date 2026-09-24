-- GMS = GMV Max cấp shop (24/09/2026): trạng thái eligibility trên Channel + báo cáo theo cửa sổ (sàn không có số
-- theo ngày lẻ) cấp chiến dịch và từng SP. IF NOT EXISTS để Render migrate deploy chạy lại êm.

ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "adsGmsStatus" TEXT;
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "adsGmsCheckedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ads_gms_reports" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "windowKey" TEXT NOT NULL,
    "campaignId" TEXT,
    "startKey" TEXT NOT NULL,
    "endKey" TEXT NOT NULL,
    "expense" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "impression" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "broadOrder" INTEGER NOT NULL DEFAULT 0,
    "broadGmv" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "directOrder" INTEGER NOT NULL DEFAULT 0,
    "directGmv" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ads_gms_reports_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ads_gms_reports_channelId_windowKey_key" ON "ads_gms_reports"("channelId", "windowKey");
DO $$ BEGIN
  ALTER TABLE "ads_gms_reports" ADD CONSTRAINT "ads_gms_reports_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ads_gms_item_reports" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "windowKey" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "expense" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "impression" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "broadOrder" INTEGER NOT NULL DEFAULT 0,
    "broadGmv" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "directOrder" INTEGER NOT NULL DEFAULT 0,
    "directGmv" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ads_gms_item_reports_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ads_gms_item_reports_channelId_windowKey_itemId_key" ON "ads_gms_item_reports"("channelId", "windowKey", "itemId");
CREATE INDEX IF NOT EXISTS "ads_gms_item_reports_channelId_idx" ON "ads_gms_item_reports"("channelId");
DO $$ BEGIN
  ALTER TABLE "ads_gms_item_reports" ADD CONSTRAINT "ads_gms_item_reports_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

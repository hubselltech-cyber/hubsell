-- 14/09/2026 - Co nguon dung cua Tro ly quang cao (Hubsell dung / nguoi dung / nguoi bat lai = van moi). Idempotent.
ALTER TABLE "AdsCampaign" ADD COLUMN IF NOT EXISTS "hubsellPausedAt" TIMESTAMP(3);
ALTER TABLE "AdsCampaign" ADD COLUMN IF NOT EXISTS "hubsellPauseLogId" TEXT;
ALTER TABLE "AdsCampaign" ADD COLUMN IF NOT EXISTS "hubsellPauseWindow" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AdsCampaign" ADD COLUMN IF NOT EXISTS "hubsellPauseCycle" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AdsCampaign" ADD COLUMN IF NOT EXISTS "hubsellResumedOn" TEXT NOT NULL DEFAULT '';

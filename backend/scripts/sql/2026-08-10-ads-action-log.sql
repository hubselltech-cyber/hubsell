-- ============================================================
-- TRỢ LÝ QUẢNG CÁO SHOPEE — GIAI ĐOẠN 3 (10/08/2026)
-- Sổ hành động của Trợ lý (dry_run/live) — kiểm toán + idempotency + quota.
-- (autoExecute nằm trong JSONB AdsAssistantConfig.config — không cần ALTER.)
--
-- CHẠY TAY TRÊN SUPABASE (SQL Editor) TRƯỚC KHI DEPLOY BACKEND MỚI.
-- Local dev: npx prisma db execute --schema prisma/schema.prisma --file scripts/sql/2026-08-10-ads-action-log.sql
-- Idempotent: IF NOT EXISTS toàn bộ, chạy lặp vô hại.
-- ============================================================

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

CREATE UNIQUE INDEX IF NOT EXISTS "AdsActionLog_referenceId_key"
    ON "AdsActionLog"("referenceId");
CREATE INDEX IF NOT EXISTS "AdsActionLog_channelId_createdAt_idx"
    ON "AdsActionLog"("channelId", "createdAt");
CREATE INDEX IF NOT EXISTS "AdsActionLog_adsCampaignId_createdAt_idx"
    ON "AdsActionLog"("adsCampaignId", "createdAt");

DO $$ BEGIN
    ALTER TABLE "AdsActionLog"
        ADD CONSTRAINT "AdsActionLog_channelId_fkey"
        FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "AdsActionLog"
        ADD CONSTRAINT "AdsActionLog_adsCampaignId_fkey"
        FOREIGN KEY ("adsCampaignId") REFERENCES "AdsCampaign"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

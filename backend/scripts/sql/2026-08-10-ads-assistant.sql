-- ============================================================
-- TRỢ LÝ QUẢNG CÁO SHOPEE — GIAI ĐOẠN 2 (10/08/2026)
-- Bảng luật Trợ lý per-gian + cột quyết định của chủ shop trên AdsCampaign.
--
-- CHẠY TAY TRÊN SUPABASE (SQL Editor) TRƯỚC KHI DEPLOY BACKEND MỚI.
-- Local dev: npx prisma db execute --schema prisma/schema.prisma --file scripts/sql/2026-08-10-ads-assistant.sql
-- Idempotent: IF NOT EXISTS toàn bộ, chạy lặp vô hại.
-- ============================================================

ALTER TABLE "AdsCampaign"
    ADD COLUMN IF NOT EXISTS "assistantDecision"        TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS "assistantDecisionVerdict" TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS "assistantDecisionAt"      TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "AdsAssistantConfig" (
    "id"        TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "config"    JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdsAssistantConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AdsAssistantConfig_channelId_key"
    ON "AdsAssistantConfig"("channelId");

DO $$ BEGIN
    ALTER TABLE "AdsAssistantConfig"
        ADD CONSTRAINT "AdsAssistantConfig_channelId_fkey"
        FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

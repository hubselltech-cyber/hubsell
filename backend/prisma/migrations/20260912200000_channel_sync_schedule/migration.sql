-- 12/09/2026 — Lịch quét theo TỪNG GIAN cho worker auto-sync (thay vòng for tuần tự).
-- Idempotent: chạy lại không lỗi (Render migrate deploy + scripts/apply-migration-local.ts).
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "nextFastSyncAt" TIMESTAMP(3);
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "nextHourlySyncAt" TIMESTAMP(3);
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "nextAdsSyncAt" TIMESTAMP(3);
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "lastAdsSyncAt" TIMESTAMP(3);
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "adsBackfillPending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "syncBackoffLevel" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "syncLockedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Channel_status_nextFastSyncAt_idx" ON "Channel"("status", "nextFastSyncAt");

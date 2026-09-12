-- 12/09/2026 - Xung ads theo gian (tang A) + vi ads doc tu DB. Idempotent.
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "nextAdsPulseAt" TIMESTAMP(3);
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "adsWalletBalance" DECIMAL(14,2);
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "adsWalletSyncedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Channel_status_nextAdsPulseAt_idx" ON "Channel"("status", "nextAdsPulseAt");

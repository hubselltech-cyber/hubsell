-- 23/09/2026 — Gian vừa nối API: cờ kéo trọn lịch sử 90 ngày (đơn + đối soát) ở lượt worker đầu.
-- Idempotent: chạy lại không lỗi (Render migrate deploy + scripts/apply-migration-local.ts).
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "historyBackfillPending" BOOLEAN NOT NULL DEFAULT false;

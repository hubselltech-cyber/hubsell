-- 18/09/2026 (B6): cấu hình mà lượt chấm THẬT gần nhất đã dùng — Tự loại thật chỉ được bật / chạy với đúng cấu hình đã diễn tập.
ALTER TABLE "tiktok_ads_auto_rules" ADD COLUMN IF NOT EXISTS "lastRunConfig" JSONB;

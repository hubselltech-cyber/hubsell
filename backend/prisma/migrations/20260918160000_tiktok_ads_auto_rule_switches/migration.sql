-- 18/09/2026: công tắc bật/tắt từng luật loại video tự động (anh Trung: tính năng nào không muốn dùng thì tắt).
ALTER TABLE "tiktok_ads_auto_rules" ADD COLUMN IF NOT EXISTS "ruleNoOrderOn" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "tiktok_ads_auto_rules" ADD COLUMN IF NOT EXISTS "ruleLowRoiOn" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "tiktok_ads_auto_rules" ADD COLUMN IF NOT EXISTS "ruleCpaOn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tiktok_ads_auto_rules" ADD COLUMN IF NOT EXISTS "graceOn" BOOLEAN NOT NULL DEFAULT true;

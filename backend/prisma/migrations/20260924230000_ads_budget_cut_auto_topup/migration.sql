-- ĐỢT B Trợ lý quảng cáo (24/09/2026): hạ ngân sách trước, tắt sau + cờ ví tự nạp.
-- IF NOT EXISTS để Render migrate deploy chạy lại êm (cùng khuôn stock_locations).

ALTER TABLE "AdsCampaign" ADD COLUMN IF NOT EXISTS "hubsellBudgetCutAt" TIMESTAMP(3);
ALTER TABLE "AdsCampaign" ADD COLUMN IF NOT EXISTS "hubsellBudgetBefore" DECIMAL(14,2);
ALTER TABLE "AdsCampaign" ADD COLUMN IF NOT EXISTS "hubsellBudgetCut" DECIMAL(14,2);
ALTER TABLE "AdsCampaign" ADD COLUMN IF NOT EXISTS "hubsellBudgetCutLogId" TEXT;
ALTER TABLE "AdsCampaign" ADD COLUMN IF NOT EXISTS "hubsellBudgetCutOn" TEXT NOT NULL DEFAULT '';

ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "adsAutoTopUp" BOOLEAN;

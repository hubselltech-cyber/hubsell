-- ĐỢT C Trợ lý quảng cáo (24/09/2026): từ khóa đã chọn của campaign (info_type 2) + cache từ khóa Shopee gợi ý.
-- IF NOT EXISTS để Render migrate deploy chạy lại êm.

ALTER TABLE "AdsCampaign" ADD COLUMN IF NOT EXISTS "manualBidding" JSONB;

ALTER TABLE "ads_item_signals" ADD COLUMN IF NOT EXISTS "kwSuggestions" JSONB;
ALTER TABLE "ads_item_signals" ADD COLUMN IF NOT EXISTS "kwSuggestionsAt" TIMESTAMP(3);

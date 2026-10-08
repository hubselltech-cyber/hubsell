-- Mục tiêu ROAS ngay trước lần đổi gần nhất (so lãi trước/sau nấc hạ)
ALTER TABLE "AdsCampaign" ADD COLUMN IF NOT EXISTS "roasTargetPrev" DECIMAL(8,2);

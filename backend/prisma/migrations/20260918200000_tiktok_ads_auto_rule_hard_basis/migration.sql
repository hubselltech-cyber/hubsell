-- 18/09/2026: mức loại ROI của luật loại video tự động tính theo % mục tiêu ("pct", mặc định) hay ROI hòa vốn ("breakeven") — anh Trung duyệt.
ALTER TABLE "tiktok_ads_auto_rules" ADD COLUMN IF NOT EXISTS "hardBasis" TEXT NOT NULL DEFAULT 'pct';

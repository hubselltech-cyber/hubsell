-- TikTok GMV Max — "Chuyển sang Phân phối tối đa" (08/11/2026, anh Trung: "có gì để Hubsell cảnh báo tới khách khi khách dùng
-- tính năng này"). maxDeliverySince = lúc đồng bộ thấy chiến dịch sang bid_type NO_BID (không còn ROI mục tiêu chặn, không ROI
-- protection); NULL = ROI mục tiêu. Mốc để campaign-advice đếm ngày trọn (khởi động < 3, lỗ từ 3, đánh giá từ 5 — TikTok Best
-- practices for Max delivery). ADD COLUMN nullable không ghi lại dòng, IF NOT EXISTS để chạy lại êm; cột thừa vô hại.
ALTER TABLE "AdsCampaign" ADD COLUMN IF NOT EXISTS "maxDeliverySince" TIMESTAMP(3);

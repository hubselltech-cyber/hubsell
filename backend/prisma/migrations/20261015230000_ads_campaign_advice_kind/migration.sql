-- Chuông kết luận chiến dịch TikTok (15/10/2026 — anh Trung "làm chuông em nhé"): lượt ngày chấm
-- campaign-advice cho từng chiến dịch đang chạy; kết luận ĐỔI loại so với lần trước mới chuông
-- (luật B8 của tự loại video). adviceKind = loại kết luận gần nhất ("" = chưa chấm), adviceKindAt = lúc đổi.
-- ADD COLUMN với DEFAULT hằng không ghi lại dòng (Postgres 11+), chỉ khóa bảng trong tích tắc.
-- IF NOT EXISTS để chạy lại êm. Đường lui: env ADS_TIKTOK_ADVICE_ALERTS_OFF=1 (cột thừa vô hại).
ALTER TABLE "AdsCampaign" ADD COLUMN IF NOT EXISTS "adviceKind" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AdsCampaign" ADD COLUMN IF NOT EXISTS "adviceKindAt" TIMESTAMP(3);

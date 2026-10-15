-- Ngủ đông gian của chủ shop hết gói quá ân hạn (15/10/2026 — anh Trung chốt:
-- "hết gói quá 7 ngày ân hạn thì ngừng cập nhật đơn, tốn hạ tầng mà chẳng được gì";
-- docs/GOI-NGU-DONG-GIAN-HET-HAN.md).
--   hibernatedAt — khác NULL = worker không quét gian này, webhook nhận rồi bỏ.
-- Cột NULL, không mặc định, không chỉ mục riêng: lúc đặt cờ mọi next*SyncAt đẩy
-- về năm 2100 nên gian ngủ đông tự rơi khỏi vùng quét của chỉ mục (status, next*At).
-- ADD COLUMN NULL không ghi lại dòng, chỉ khóa "Channel" trong tích tắc.
-- IF NOT EXISTS để chạy lại êm. Đường lui: env PLAN_HIBERNATE_OFF=1 (cột thừa vô hại).
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "hibernatedAt" TIMESTAMP(3);

-- Mốc nước quét đơn theo gian (lát 3.2 giai đoạn 3, docs/DONG-BO-GIAI-DOAN-3.md
-- mục 2 — anh Trung chốt 14/10/2026). Thay cửa sổ quét cứng 2 ngày:
--   ordersWatermarkAt     — mọi đơn có update_time <= mốc này đã đọc đầy đủ;
--   ordersCatchupBeforeAt — khác NULL = lượt trước bị cắt, lượt sau vét phần
--                           cũ hơn mốc này trước khi tiến mốc nước.
-- Hai cột NULL, không mặc định, không chỉ mục: chỉ worker đọc/ghi theo id gian.
-- ADD COLUMN NULL không ghi lại dòng, chỉ khóa "Channel" trong tích tắc.
-- IF NOT EXISTS để chạy lại êm. Đường lui: env ORDER_SYNC_WINDOW=fixed (cột thừa vô hại).
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "ordersWatermarkAt"     TIMESTAMP(3);
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "ordersCatchupBeforeAt" TIMESTAMP(3);

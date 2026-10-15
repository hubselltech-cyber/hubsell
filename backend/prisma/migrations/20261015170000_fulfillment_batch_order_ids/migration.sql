-- ============================================================
-- CHẶN LƯỢT CHUẨN BỊ HÀNG CHỒNG LÊN LƯỢT ĐANG CHẠY (15/10/2026).
--
-- Sự cố prod 15/10 08:40: lượt 30 đơn DONE sau 8,5 giây; 6 giây sau trình
-- duyệt báo lỗi nên người dùng bấm lại → lượt thứ hai cùng 30 đơn được tạo khi
-- lượt một còn RUNNING: 10 đơn bị bỏ qua, 20 đơn Shopee đã sắp xếp bị gọi lại
-- và sàn từ chối "Package … not eligible for rescheduling". Bảng
-- fulfillment_batches trước đây KHÔNG lưu danh sách đơn đầu vào nên route
-- không biết đơn nào đang được một lượt khác xử lý.
--
-- Cột orderIds: id đơn thật sự đem đi gọi sàn ở lượt này (đã trừ skipped).
-- ADD COLUMN có DEFAULT hằng trên PostgreSQL ≥ 11 không ghi lại bảng — khóa
-- ACCESS EXCLUSIVE chỉ tích tắc; bảng này nhỏ (dòng cũ hơn 7 ngày bị dọn).
--
-- Chỉ mục RIÊNG PHẦN cho câu hỏi "chủ shop này có lượt nào đang chạy, còn
-- sống (updatedAt trong 3 phút) không": lúc bình thường gần như rỗng vì lượt
-- xong là rời RUNNING. Không cần GIN cho orderIds — tập lượt đang chạy của một
-- chủ shop chỉ 0–2 dòng, so khớp id đơn làm trong bộ nhớ. IF NOT EXISTS để
-- chạy lại êm.
-- ============================================================

ALTER TABLE "fulfillment_batches" ADD COLUMN IF NOT EXISTS "orderIds" JSONB NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS "fulfillment_batches_running_owner_idx"
  ON "fulfillment_batches" ("ownerId", "updatedAt")
  WHERE "status" = 'RUNNING';

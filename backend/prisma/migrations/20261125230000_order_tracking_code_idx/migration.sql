-- ============================================================
-- 25/11/2026 — CHỈ MỤC TRA MÃ VẬN ĐƠN trên "Order" (docs/VIDEO-DONG-HANG-THIET-KE.md mục 32, việc B1 / M2.5)
--
--   Order_trackingCode_idx         mã vận đơn chiều đi  — khớp tem ra đơn (video đóng hàng, Quét đóng gói)
--   Order_returnTrackingCode_idx   mã vận đơn chiều hoàn — khớp tem kiện hoàn (video khui)
--
-- Vì sao: services/pack-video/order-match.ts chạy MỖI LẦN giơ tem + mỗi lần luật xóa thử khớp lại video chưa
-- khớp đơn. Không có chỉ mục, câu tra đi qua mọi đơn của các gian rồi mới lọc theo mã (cùng kiểu câu đo
-- 25/11/2026 ở shop lớn nhất: 6,9 giây / 36.344 trang đệm — docs/HAN-KHIEU-NAI-DON-HOAN.md mục 16).
-- Chỉ mục một phần (bỏ dòng chưa có mã) cho nhỏ; điều kiện "= mã" của câu tra đã kéo theo IS NOT NULL.
--
-- Chỉ thêm chỉ mục: không đổi cột, không đụng trigger sổ cái, không ghi dòng nào.
--
-- ⚠️ PROD: CREATE INDEX thường (không CONCURRENTLY) giữ khóa chặn GHI trên "Order" suốt lúc đọc hết bảng
-- (1,12 triệu dòng / 641 MB ngày 25/11/2026). TRƯỚC KHI PUSH phải chạy tay ở Supabase SQL Editor, TỪNG LỆNH MỘT:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_trackingCode_idx"
--     ON "Order" ("trackingCode") WHERE "trackingCode" IS NOT NULL;
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_returnTrackingCode_idx"
--     ON "Order" ("returnTrackingCode") WHERE "returnTrackingCode" IS NOT NULL;
-- rồi kiểm indisvalid = true cho cả hai. Khi đó hai lệnh IF NOT EXISTS dưới đây bỏ qua trên prod.
-- ============================================================

CREATE INDEX IF NOT EXISTS "Order_trackingCode_idx"
  ON "Order" ("trackingCode") WHERE "trackingCode" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Order_returnTrackingCode_idx"
  ON "Order" ("returnTrackingCode") WHERE "returnTrackingCode" IS NOT NULL;

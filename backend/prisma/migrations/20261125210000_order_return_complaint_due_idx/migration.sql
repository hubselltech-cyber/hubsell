-- ============================================================
-- 25/11/2026 — CHỈ MỤC MỘT PHẦN CHO "SẮP HẾT HẠN KHIẾU NẠI"
-- (docs/HAN-KHIEU-NAI-DON-HOAN.md mục 16)
--
--   Order_return_complaint_due_idx   đơn hoàn còn mở và có ít nhất một mốc để tính hạn (hạn sàn trả /
--                                    sàn báo kiện về / kho quét), theo gian.
--
-- Vì sao: dải nhắc "N đơn hoàn sắp hết hạn khiếu nại" của trang Đối soát đơn hoàn (tự làm mới 30 giây /
-- lần) đọc các đơn này của một shop. Đo prod 25/11/2026 KHÔNG có chỉ mục: shop đông đơn hoàn nhất phải
-- quét hết đơn của gian qua Order_channelId_idx — 6,9 giây, 36.344 trang đệm, ra 0 dòng.
--
-- Chỉ thêm chỉ mục: không đổi cột, không đụng trigger sổ cái, không ghi dòng nào.
--
-- ⚠️ PROD: CREATE INDEX thường (không CONCURRENTLY) giữ khóa chặn GHI trên "Order" suốt lúc đọc hết
-- bảng. TRƯỚC KHI PUSH phải chạy tay ở Supabase SQL Editor, ngoài giờ cao điểm:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_return_complaint_due_idx"
--     ON "Order" ("channelId")
--     WHERE "returnStatus" IN ('AWAITING', 'RECEIVED', 'DAMAGED')
--       AND ("returnComplaintDueAt" IS NOT NULL OR "returnDeliveredAt" IS NOT NULL OR "returnedAt" IS NOT NULL);
-- rồi kiểm indisvalid = true. Khi đó lệnh IF NOT EXISTS dưới đây bỏ qua trên prod.
--
-- Vị từ chỉ mục PHẢI khớp từng chữ với complaintDueCandidateSql trong lib/return-complaint-due-sql.ts.
-- ============================================================

CREATE INDEX IF NOT EXISTS "Order_return_complaint_due_idx"
  ON "Order" ("channelId")
  WHERE "returnStatus" IN ('AWAITING', 'RECEIVED', 'DAMAGED')
    AND ("returnComplaintDueAt" IS NOT NULL OR "returnDeliveredAt" IS NOT NULL OR "returnedAt" IS NOT NULL);

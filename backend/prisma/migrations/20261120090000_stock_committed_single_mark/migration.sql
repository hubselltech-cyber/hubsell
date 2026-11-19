-- ============================================================
-- 20/11/2026 — KHO CHUẨN QUỐC TẾ, THIẾT KẾ LẠI LÁT 1 (docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 14)
--
-- "Đơn đang giữ" đổi từ HAI cột (stockCommittedAt có VÀ stockShippedAt trống) sang MỘT cột
-- (stockCommittedAt có; lúc rời kho mã xóa cột này trong cùng câu ghi stockShippedAt). Lý do: với
-- hai cột Postgres nhân hai tỉ lệ như độc lập nên đoán tập đang giữ lớn gấp nhiều lần thật, và
-- sai tăng dần theo số đơn "đã từng giữ" (đo local 19/11: 424 đơn thật → máy đoán 2.852 … 117.646)
-- → câu quét bù đi dọc cả bảng đơn. Một cột thì ước lượng sát ở mọi mức.
--
-- Chỉ mục mới ("channelId", "id"): câu đọc đơn đang giữ của MỘT gian có ORDER BY "id" lấy thứ tự
-- thẳng từ chỉ mục (đo local, gian 3.000 đơn giữ: 870 khối; chỉ mục chỉ có "channelId": 30.000).
--
-- KHÔNG thêm / sửa cột nào → không cần khóa ACCESS EXCLUSIVE trên "Order".
--
-- ⚠️ PROD: CREATE INDEX thường (không CONCURRENTLY) giữ khóa chặn GHI trên "Order" suốt lúc đọc
-- hết bảng (~500 MB). TRƯỚC KHI PUSH phải chạy tay ở Supabase SQL Editor, ngoài giờ cao điểm:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_stock_held_idx"
--     ON "Order" ("channelId", "id") WHERE "stockCommittedAt" IS NOT NULL;
--   rồi kiểm indisvalid = true. Khi đó lệnh IF NOT EXISTS dưới đây bỏ qua trên prod.
--
-- Chỉ mục cũ "Order_stock_committed_idx" CHƯA bỏ ở đây: bản mã cũ còn chạy vài phút lúc deploy
-- vẫn đọc theo vị từ hai cột. Bỏ tay bằng DROP INDEX CONCURRENTLY sau khi bản mới chạy ổn (mục
-- 14.6 bước 6), rồi mới thêm migration DROP INDEX IF EXISTS cho các database dev.
--
-- Vị từ chỉ mục PHẢI khớp từng chữ với HELD_ORDER trong services/stock-committed.ts.
-- Dấu giữ còn sót trên các đơn đã rời kho (bản hai cột không xóa) do worker gỡ một lần sau khi
-- lên bản mới (maintenance_jobs "stock-committed-single-mark") — không làm trong migration.
-- ============================================================

CREATE INDEX IF NOT EXISTS "Order_stock_held_idx"
  ON "Order" ("channelId", "id")
  WHERE "stockCommittedAt" IS NOT NULL;

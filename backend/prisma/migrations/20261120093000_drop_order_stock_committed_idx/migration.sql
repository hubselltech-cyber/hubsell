-- ============================================================
-- 20/11/2026 — KHO CHUẨN QUỐC TẾ, THIẾT KẾ LẠI LÁT 1 (docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 14.6 bước 6)
--
-- Bỏ chỉ mục của bản hai cột (migration 20261112210000_stock_committed_shadow):
--   Order_stock_committed_idx ("channelId") WHERE "stockCommittedAt" IS NOT NULL AND "stockShippedAt" IS NULL
-- Từ bản một dấu (20261120090000) không câu nào cần nó nữa: mọi câu đọc tập "đang giữ" đi qua
-- "Order_stock_held_idx" ("channelId", "id") WHERE "stockCommittedAt" IS NOT NULL.
--
-- PROD: chỉ mục đã được bỏ tay bằng DROP INDEX CONCURRENTLY lúc 21:28 ngày 19/11/2026 (sau khi bản
-- mới chạy xong nhịp đầu, đối chiếu lệch 0) → ở prod lệnh dưới đây không tìm thấy gì và bỏ qua,
-- không lấy khóa nào trên "Order". Tệp này chỉ để các database dev khớp với prod.
-- ============================================================

DROP INDEX IF EXISTS "Order_stock_committed_idx";

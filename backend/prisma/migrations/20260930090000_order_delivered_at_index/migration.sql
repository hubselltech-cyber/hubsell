-- Tờ khai thuế cắt kỳ theo ngày sàn báo giao thành công (anh Trung chốt 30/09/2026).
-- Chỉ mục phục vụ lọc đơn theo (gian, ngày giao); thiếu chỉ mục thì truy vấn vẫn
-- đúng, chỉ chậm dần khi bảng đơn lớn. Chạy tay trên Supabase (SQL Editor).
--
-- Trên Supabase nên chạy bản CONCURRENTLY dưới đây (không khóa ghi bảng Order),
-- chạy RIÊNG một lệnh, không bọc trong transaction:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_channelId_deliveredAt_idx"
--     ON "Order"("channelId", "deliveredAt");
CREATE INDEX IF NOT EXISTS "Order_channelId_deliveredAt_idx" ON "Order"("channelId", "deliveredAt");

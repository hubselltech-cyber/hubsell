-- ============================================================
-- 21/10/2026 — MIGRATION BÙ (phần 3): chỉ mục order_line_ledger(productId) có trong
-- schema.prisma (@@index([productId])) nhưng không migration nào tạo (lên bằng
-- `db push`). Sổ dòng đơn phân mảnh theo tháng → CREATE INDEX trên bảng cha tự tạo
-- cho từng mảnh; KHÔNG dùng được CONCURRENTLY. Production đã có chỉ mục → IF NOT
-- EXISTS bỏ qua, không khóa gì; nếu production chưa có thì dựng một lần lúc deploy
-- (khóa SHARE theo mảnh trong lúc dựng, cỡ vài giây mỗi triệu dòng).
-- ============================================================
CREATE INDEX IF NOT EXISTS "order_line_ledger_productId_idx" ON "order_line_ledger"("productId");

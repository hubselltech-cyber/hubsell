-- ============================================================
-- SQL CHẠY TAY TRÊN SUPABASE PRODUCTION (SQL Editor)
--
-- Local dùng `prisma db push`, nhưng Supabase production theo quy trình dự án
-- phải ALTER tay. File này gom các lệnh của từng đợt thay đổi schema — chạy
-- xong đợt nào thì giữ lại làm sử liệu (IF NOT EXISTS nên chạy lại vô hại).
-- ============================================================

-- ── 07/08/2026: Thông số sản phẩm cho Trợ lý vận hành (AI CSKH) ──
-- Chất liệu + hướng dẫn bảo quản + bảng size để AI Copilot tư vấn khách.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "material" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "careInstructions" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sizeChart" JSONB;

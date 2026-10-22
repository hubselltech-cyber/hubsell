-- ============================================================
-- 22/10/2026 — GIÁ CÔNG BỐ ₫/ĐƠN cho gói bán bằng tư vấn (Enterprise): anh Trung chốt
-- công khai "65đ/đơn" trên landing + /settings/plan nhưng khách vẫn phải liên hệ để
-- HQ tạo gói riêng. Là DATA (sửa ở HQ /admin/plans), null = không công bố (hiện "Liên hệ").
-- Bảng service_plans nhỏ, không bị worker ghi → không cần khóa có thử lại.
-- ============================================================
ALTER TABLE "service_plans" ADD COLUMN IF NOT EXISTS "pricePerOrder" DECIMAL(10,2);

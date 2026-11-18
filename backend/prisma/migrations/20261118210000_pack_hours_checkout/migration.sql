-- ============================================================
-- VIDEO ĐÓNG HÀNG — NỐI CỔNG payOS CHO KHOẢN MUA GIỜ QUAY (18/11/2026 tối,
-- docs/VIDEO-DONG-HANG-THIET-KE.md mục 20). Anh Trung 18/11: "Làm phần mua giờ".
--
-- Dùng lại ĐÚNG luồng payOS của gói / phí vượt (đơn cổng → webhook + poll → chứng từ → sổ quỹ → hóa đơn),
-- chỉ ADD ba thứ, không khóa bảng lớn nào (hai bảng dưới đây mỗi khoản thanh toán một dòng):
--   · loại chứng từ PACK_HOURS  — khoản "mua thêm N giờ quay", KHÔNG gia hạn thuê bao (như OVERAGE).
--   · gateway_payment_orders."packHours" — đơn cổng này mua bao nhiêu giờ (null = mua gói / trả phí vượt).
--   · package_payments."packHours"       — chứng từ này là của bao nhiêu giờ (tên dòng hóa đơn đọc số này).
-- PG12+ cho ADD VALUE trong transaction miễn là không DÙNG giá trị mới trong cùng transaction.
-- ============================================================

ALTER TYPE "PackagePaymentKind" ADD VALUE IF NOT EXISTS 'PACK_HOURS';

ALTER TABLE "gateway_payment_orders" ADD COLUMN IF NOT EXISTS "packHours" INTEGER;
ALTER TABLE "package_payments" ADD COLUMN IF NOT EXISTS "packHours" INTEGER;

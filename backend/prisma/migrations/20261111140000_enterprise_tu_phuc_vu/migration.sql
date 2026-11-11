-- Enterprise tự phục vụ (11/11/2026): khách tự nhập số đơn/tháng, máy chủ tính giá.
-- Chỉ THÊM cột null được — không đụng dữ liệu cũ, bảng đã ENABLE RLS từ trước.
ALTER TABLE "service_plans" ADD COLUMN "minOrdersPerMonth" INTEGER;
ALTER TABLE "package_payments" ADD COLUMN "committedOrders" INTEGER;
ALTER TABLE "gateway_payment_orders" ADD COLUMN "committedOrders" INTEGER;

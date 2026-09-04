-- Sắp xếp vận chuyển thật qua API sàn (04/09/2026)
-- Lựa chọn pickup/dropoff mặc định của từng gian hàng
ALTER TABLE "Channel" ADD COLUMN "fulfillmentSettings" JSONB;
-- Mã kiện phía sàn (Lazada package_id / TikTok package id) để RTS + tải vận đơn
ALTER TABLE "Order" ADD COLUMN "platformPackageId" TEXT;

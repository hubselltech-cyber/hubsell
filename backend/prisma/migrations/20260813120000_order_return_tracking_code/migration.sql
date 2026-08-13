-- Mã vận đơn CHIỀU HOÀN của đơn (Shopee Returns API cấp tracking riêng cho
-- kiện khách gửi trả). Kho quét tem kiện hoàn là quét mã này.
ALTER TABLE "Order" ADD COLUMN "returnTrackingCode" TEXT;

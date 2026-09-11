-- 11/09/2026: lưu nội dung chuyển khoản ĐÃ GỬI sang payOS theo từng đơn
-- (tiền tố sản phẩm PAYOS_TRANSFER_PREFIX + mã gói [+ đuôi mã đơn]) — chuẩn bị
-- nhiều sản phẩm (Hubsell/Hubtax) cùng nhận tiền một tài khoản: FE bày đúng
-- chuỗi đã gửi thay vì dựng lại từ env.
ALTER TABLE "gateway_payment_orders" ADD COLUMN "description" TEXT;

-- Tài khoản nhận tiền do cổng payOS trả về theo từng link (bin + STK + chủ TK)
-- để khách chuyển khoản thủ công khi không quét được QR (anh Trung 09/09 tối).
ALTER TABLE "gateway_payment_orders" ADD COLUMN "bankBin" TEXT;
ALTER TABLE "gateway_payment_orders" ADD COLUMN "bankAccountNumber" TEXT;
ALTER TABLE "gateway_payment_orders" ADD COLUMN "bankAccountName" TEXT;

-- Tên hãng vận chuyển NGUYÊN VĂN từ sàn ("SPX Instant", "AhaMove", "Hỏa Tốc"…)
-- để nhận diện đơn HỎA TỐC — enum Carrier đã gộp mất sắc thái này.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "shippingCarrierName" TEXT;

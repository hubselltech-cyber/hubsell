-- Hồ sơ xuất hóa đơn của khách mua gói (07/10/2026): thêm SĐT in trên hóa đơn +
-- số định danh cá nhân/CCCD — máy đẩy vào tờ nháp meInvoice (ReceiverMobile, CitizenIDNumber).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "billingPhone" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "billingIdNumber" TEXT;

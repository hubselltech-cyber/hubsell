-- Tài khoản meInvoice CỦA SHOP (multi-tenant 23/08): đăng nhập MISA bằng bộ
-- {MST + username + password} của chính shop → hóa đơn mang pháp nhân shop.
ALTER TABLE "InvoiceConfig" ADD COLUMN IF NOT EXISTS "meinvoiceUsername" TEXT;
ALTER TABLE "InvoiceConfig" ADD COLUMN IF NOT EXISTS "meinvoicePassword" TEXT;

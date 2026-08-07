-- Mở rộng InvoiceConfig theo chuẩn NĐ 123/2020 & TT 78/2021:
--   (1) pháp nhân & thuế: taxCode / companyName / companyAddress
--   (2) meInvoice: invoicePattern (mẫu số) / invoiceSeries (ký hiệu)
--   (3) eSign ký nền: esignClientId / esignSecretKey / esignUsername /
--       esignPassword / certSerial
-- + đổi chuẩn giá trị signMethod: usb → USB_TOKEN, hsm → ESIGN_CLOUD.
-- Dùng IF NOT EXISTS để an toàn khi cột đã được thêm tay trên Supabase.

-- AlterTable — (1) pháp nhân & thuế
ALTER TABLE "InvoiceConfig" ADD COLUMN IF NOT EXISTS "taxCode" TEXT;
ALTER TABLE "InvoiceConfig" ADD COLUMN IF NOT EXISTS "companyName" TEXT;
ALTER TABLE "InvoiceConfig" ADD COLUMN IF NOT EXISTS "companyAddress" TEXT;

-- AlterTable — (2) mẫu số / ký hiệu hóa đơn
ALTER TABLE "InvoiceConfig" ADD COLUMN IF NOT EXISTS "invoicePattern" TEXT;
ALTER TABLE "InvoiceConfig" ADD COLUMN IF NOT EXISTS "invoiceSeries" TEXT;

-- AlterTable — (3) MISA eSign ký nền
ALTER TABLE "InvoiceConfig" ADD COLUMN IF NOT EXISTS "esignClientId" TEXT;
ALTER TABLE "InvoiceConfig" ADD COLUMN IF NOT EXISTS "esignSecretKey" TEXT;
ALTER TABLE "InvoiceConfig" ADD COLUMN IF NOT EXISTS "esignUsername" TEXT;
ALTER TABLE "InvoiceConfig" ADD COLUMN IF NOT EXISTS "esignPassword" TEXT;
ALTER TABLE "InvoiceConfig" ADD COLUMN IF NOT EXISTS "certSerial" TEXT;

-- Đổi chuẩn signMethod (giá trị cũ usb/hsm → chuẩn mới, idempotent)
ALTER TABLE "InvoiceConfig" ALTER COLUMN "signMethod" SET DEFAULT 'USB_TOKEN';
UPDATE "InvoiceConfig" SET "signMethod" = 'USB_TOKEN'  WHERE "signMethod" = 'usb';
UPDATE "InvoiceConfig" SET "signMethod" = 'ESIGN_CLOUD' WHERE "signMethod" = 'hsm';

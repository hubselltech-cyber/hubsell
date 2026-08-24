-- KHACH YEU CAU XUAT HOA DON (Shopee get_buyer_invoice_info) + thue suat mac dinh cua shop.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "invoiceRequestType" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "buyerInvoiceInfo" JSONB;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "buyerInvoiceFetchedAt" TIMESTAMP(3);
ALTER TABLE "InvoiceConfig" ADD COLUMN IF NOT EXISTS "defaultVatRate" INTEGER NOT NULL DEFAULT 0;

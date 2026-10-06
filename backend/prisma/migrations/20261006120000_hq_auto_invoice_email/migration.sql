-- Tự động xuất HĐĐT + gửi email hóa đơn khi khách mua gói Hubsell (06/10/2026).
-- Cấu hình meInvoice công ty: công tắc tự xuất (kèm mốc bật) + tự gửi email.
ALTER TABLE "platform_invoice_config" ADD COLUMN IF NOT EXISTS "autoIssueEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "platform_invoice_config" ADD COLUMN IF NOT EXISTS "autoIssueEnabledAt" TIMESTAMP(3);
ALTER TABLE "platform_invoice_config" ADD COLUMN IF NOT EXISTS "autoEmailEnabled" BOOLEAN NOT NULL DEFAULT true;

-- Bút toán sổ quỹ: snapshot người mua, dấu vết lượt máy xử lý, trạng thái email.
ALTER TABLE "platform_ledger_entries" ADD COLUMN IF NOT EXISTS "invoiceBuyerName" TEXT;
ALTER TABLE "platform_ledger_entries" ADD COLUMN IF NOT EXISTS "invoiceBuyerTaxCode" TEXT;
ALTER TABLE "platform_ledger_entries" ADD COLUMN IF NOT EXISTS "einvoiceAutoAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "platform_ledger_entries" ADD COLUMN IF NOT EXISTS "einvoiceAutoError" TEXT;
ALTER TABLE "platform_ledger_entries" ADD COLUMN IF NOT EXISTS "einvoiceAutoTriedAt" TIMESTAMP(3);
ALTER TABLE "platform_ledger_entries" ADD COLUMN IF NOT EXISTS "einvoiceAutoLockedAt" TIMESTAMP(3);
ALTER TABLE "platform_ledger_entries" ADD COLUMN IF NOT EXISTS "invoiceEmailTo" TEXT;
ALTER TABLE "platform_ledger_entries" ADD COLUMN IF NOT EXISTS "invoiceEmailSentAt" TIMESTAMP(3);
ALTER TABLE "platform_ledger_entries" ADD COLUMN IF NOT EXISTS "invoiceEmailError" TEXT;
CREATE INDEX IF NOT EXISTS "platform_ledger_entries_invoiceStatus_packagePaymentId_idx" ON "platform_ledger_entries"("invoiceStatus", "packagePaymentId");

-- Hồ sơ xuất hóa đơn của khách mua gói (khai ở /settings/plan).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "billingName" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "billingTaxCode" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "billingAddress" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "billingEmail" TEXT;

-- Hóa đơn đầu vào của CHÍNH công ty Hubsell + tệp gốc (tab Hóa đơn đầu vào /admin/finance, 28/09/2026).
CREATE TABLE IF NOT EXISTS "platform_input_invoices" (
  "id" TEXT NOT NULL,
  "invoiceNo" TEXT,
  "invoiceSerial" TEXT,
  "invoiceDate" DATE,
  "sellerName" TEXT,
  "sellerTaxCode" TEXT,
  "isForeign" BOOLEAN NOT NULL DEFAULT false,
  "description" TEXT,
  "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "vatRate" TEXT,
  "vatAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "currency" TEXT,
  "amountOriginal" DECIMAL(14,2),
  "fxRate" DECIMAL(14,4),
  "paymentMethod" TEXT,
  "expenseCategory" TEXT,
  "source" TEXT NOT NULL,
  "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "readerNote" TEXT,
  "declaredPeriod" TEXT,
  "declaredAt" TIMESTAMP(3),
  "declaredByName" TEXT,
  "ledgerEntryId" TEXT,
  "createdById" TEXT,
  "createdByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_input_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "platform_input_invoices_ledgerEntryId_key" ON "platform_input_invoices"("ledgerEntryId");
CREATE INDEX IF NOT EXISTS "platform_input_invoices_invoiceDate_idx" ON "platform_input_invoices"("invoiceDate");
CREATE INDEX IF NOT EXISTS "platform_input_invoices_sellerTaxCode_invoiceNo_idx" ON "platform_input_invoices"("sellerTaxCode", "invoiceNo");

DO $$ BEGIN
  ALTER TABLE "platform_input_invoices"
    ADD CONSTRAINT "platform_input_invoices_ledgerEntryId_fkey"
    FOREIGN KEY ("ledgerEntryId") REFERENCES "platform_ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "platform_input_invoice_files" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "storagePath" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "extracted" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_input_invoice_files_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "platform_input_invoice_files_invoiceId_idx" ON "platform_input_invoice_files"("invoiceId");

DO $$ BEGIN
  ALTER TABLE "platform_input_invoice_files"
    ADD CONSTRAINT "platform_input_invoice_files_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "platform_input_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

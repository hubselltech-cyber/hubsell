-- Cấu hình meInvoice của chính công ty Hubsell (xuất HĐĐT khi bán gói)
CREATE TABLE "platform_invoice_config" (
    "id" TEXT NOT NULL,
    "taxCode" TEXT,
    "companyName" TEXT,
    "companyAddress" TEXT,
    "invoicePattern" TEXT,
    "invoiceSeries" TEXT,
    "meinvoiceUsername" TEXT,
    "meinvoicePassword" TEXT,
    "signMethod" TEXT NOT NULL DEFAULT 'ESIGN_CLOUD',
    "esignClientId" TEXT,
    "esignSecretKey" TEXT,
    "esignUsername" TEXT,
    "esignPassword" TEXT,
    "certSerial" TEXT,
    "vatMode" TEXT NOT NULL DEFAULT 'KCT',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_invoice_config_pkey" PRIMARY KEY ("id")
);

-- TransactionID meInvoice trên bút toán sổ quỹ đã xuất HĐĐT qua API
ALTER TABLE "platform_ledger_entries" ADD COLUMN "einvoiceTransactionId" TEXT;

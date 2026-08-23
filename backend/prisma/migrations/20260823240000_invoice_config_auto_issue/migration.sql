-- Cờ TỰ ĐỘNG PHÁT HÀNH hóa đơn (worker quét đơn đã giao + đã đối soát).
ALTER TABLE "InvoiceConfig" ADD COLUMN IF NOT EXISTS "autoIssueEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Bảng HÓA ĐƠN ĐẦU VÀO đồng bộ từ MISA meInvoice (Inbot) — xem model
-- InputInvoice trong schema.prisma. Dùng IF NOT EXISTS để an toàn khi bảng đã
-- được tạo tay trên Supabase SQL Editor trước đó (cùng lý do migration phone).

-- CreateTable
CREATE TABLE IF NOT EXISTS "input_invoices" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "misaInvoiceId" TEXT NOT NULL,
    "invoiceNo" TEXT,
    "invoiceSerial" TEXT,
    "sellerTaxCode" TEXT,
    "sellerName" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "statusRaw" TEXT,
    "rawPayload" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "input_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "input_invoices_ownerId_misaInvoiceId_key" ON "input_invoices"("ownerId", "misaInvoiceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "input_invoices_ownerId_invoiceDate_idx" ON "input_invoices"("ownerId", "invoiceDate");

-- AddForeignKey (drop trước để chạy lại được — Postgres không có ADD CONSTRAINT IF NOT EXISTS)
ALTER TABLE "input_invoices" DROP CONSTRAINT IF EXISTS "input_invoices_ownerId_fkey";
ALTER TABLE "input_invoices" ADD CONSTRAINT "input_invoices_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

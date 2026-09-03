-- Trạng thái phía Cơ quan Thuế + snapshot người mua trên nhật ký hóa đơn
ALTER TABLE "InvoiceLog" ADD COLUMN "cqtStatus" TEXT;
ALTER TABLE "InvoiceLog" ADD COLUMN "cqtCheckedAt" TIMESTAMP(3);
ALTER TABLE "InvoiceLog" ADD COLUMN "buyerName" TEXT;
ALTER TABLE "InvoiceLog" ADD COLUMN "buyerTaxCode" TEXT;

-- Báo cáo/bảng kê theo ngày lập hóa đơn
CREATE INDEX "InvoiceLog_ownerId_issuedAt_idx" ON "InvoiceLog"("ownerId", "issuedAt");

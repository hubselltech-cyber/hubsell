-- HOA DON DIEU CHINH khi khach tra hang (24/08 khuya - TT 91/2026 D.10 k.5c):
-- InvoiceLog them: invoiceSeries (ky hieu luc phat hanh - can de tham chieu
-- hoa don goc khi lap dieu chinh), lines (snapshot dong hang da phat hanh -
-- dieu chinh am DUNG so da xuat ke ca khi thue suat/gia doi sau nay),
-- adjustmentForLogId (tro ve log hoa don goc). InvoiceConfig them cong tac
-- autoAdjustEnabled: tu lap HD dieu chinh giam khi don hoan NHAP KHO.
ALTER TABLE "InvoiceLog" ADD COLUMN IF NOT EXISTS "invoiceSeries" TEXT;
ALTER TABLE "InvoiceLog" ADD COLUMN IF NOT EXISTS "lines" JSONB;
ALTER TABLE "InvoiceLog" ADD COLUMN IF NOT EXISTS "adjustmentForLogId" TEXT;
CREATE INDEX IF NOT EXISTS "InvoiceLog_adjustmentForLogId_idx" ON "InvoiceLog"("adjustmentForLogId");
ALTER TABLE "InvoiceConfig" ADD COLUMN IF NOT EXISTS "autoAdjustEnabled" BOOLEAN NOT NULL DEFAULT false;

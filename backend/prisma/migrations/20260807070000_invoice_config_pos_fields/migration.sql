-- HÓA ĐƠN TỪ MÁY TÍNH TIỀN (meInvoice POS) — nhóm cột pos* trên InvoiceConfig
-- + enum InvoiceType (STANDARD | POS) và cờ luồng phát hành mặc định.
-- IF NOT EXISTS / DO-block để chạy lại an toàn trên DB đã có sẵn một phần.

-- CreateEnum (Postgres không có CREATE TYPE IF NOT EXISTS)
DO $$ BEGIN
  CREATE TYPE "InvoiceType" AS ENUM ('STANDARD', 'POS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable — bộ khóa + định danh máy tính tiền
ALTER TABLE "InvoiceConfig" ADD COLUMN IF NOT EXISTS "posClientId" TEXT;
ALTER TABLE "InvoiceConfig" ADD COLUMN IF NOT EXISTS "posSecretKey" TEXT;
ALTER TABLE "InvoiceConfig" ADD COLUMN IF NOT EXISTS "posCodePrefix" TEXT;
ALTER TABLE "InvoiceConfig" ADD COLUMN IF NOT EXISTS "posMachineId" TEXT;
ALTER TABLE "InvoiceConfig" ADD COLUMN IF NOT EXISTS "posSeries" TEXT;

-- AlterTable — luồng phát hành mặc định
ALTER TABLE "InvoiceConfig" ADD COLUMN IF NOT EXISTS "defaultInvoiceType" "InvoiceType" NOT NULL DEFAULT 'STANDARD';

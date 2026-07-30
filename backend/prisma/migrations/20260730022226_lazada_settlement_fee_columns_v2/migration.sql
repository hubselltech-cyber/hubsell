-- AlterTable
ALTER TABLE "lazada_order_settlements" ADD COLUMN     "feeFixed" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "feeOrderProcessing" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "sellerVoucher" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateEnum
CREATE TYPE "ShippingDisputeStatus" AS ENUM ('CHO_KHIEU_NAI', 'DANG_KHIEU_NAI', 'DA_DOI_SOAT');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "shippingDisputeStatus" "ShippingDisputeStatus" NOT NULL DEFAULT 'CHO_KHIEU_NAI',
ADD COLUMN     "shippingFeeActual" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "shippingFeeQuoted" DECIMAL(12,2) NOT NULL DEFAULT 0;

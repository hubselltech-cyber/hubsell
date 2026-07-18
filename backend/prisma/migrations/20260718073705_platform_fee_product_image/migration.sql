-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "platformFee" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "imageUrl" TEXT;

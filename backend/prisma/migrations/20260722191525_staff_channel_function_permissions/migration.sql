-- DropForeignKey
ALTER TABLE "ChannelProduct" DROP CONSTRAINT "ChannelProduct_productId_fkey";

-- DropIndex
DROP INDEX "Order_itemCount_idx";

-- DropIndex
DROP INDEX "Order_returnStatus_idx";

-- AlterTable
ALTER TABLE "StaffChannel" ADD COLUMN     "canAds" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "canFinance" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "canOrders" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "canWarehouse" BOOLEAN NOT NULL DEFAULT true;

-- AddForeignKey
ALTER TABLE "ChannelProduct" ADD CONSTRAINT "ChannelProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

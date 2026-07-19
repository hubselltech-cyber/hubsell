-- CreateEnum
CREATE TYPE "Carrier" AS ENUM ('SPX', 'GHTK', 'GHN', 'JT', 'VIETTEL_POST', 'NINJA_VAN', 'BEST', 'KHAC');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "carrier" "Carrier",
ADD COLUMN     "customerPhone" TEXT,
ADD COLUMN     "packedAt" TIMESTAMP(3),
ADD COLUMN     "trackingCode" TEXT;

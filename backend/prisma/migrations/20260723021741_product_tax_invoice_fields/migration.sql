-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "taxName" TEXT,
ADD COLUMN     "vatRate" INTEGER NOT NULL DEFAULT 0;

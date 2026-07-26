/*
  Warnings:

  - You are about to drop the column `entityType` on the `ShopTaxSetting` table. All the data in the column will be lost.
  - You are about to drop the column `platformTaxRate` on the `ShopTaxSetting` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "TaxCalculationBase" AS ENUM ('PROFIT', 'REVENUE');

-- AlterTable
ALTER TABLE "ShopTaxSetting" DROP COLUMN "entityType",
DROP COLUMN "platformTaxRate",
ADD COLUMN     "calculationBase" "TaxCalculationBase" NOT NULL DEFAULT 'PROFIT';

-- DropEnum
DROP TYPE "TaxEntityType";

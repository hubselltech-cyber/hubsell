-- CreateEnum
CREATE TYPE "TaxEntityType" AS ENUM ('HOUSEHOLD', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "TaxFilterPeriod" AS ENUM ('MONTH', 'QUARTER', 'YEAR');

-- CreateEnum
CREATE TYPE "InvoiceLogStatus" AS ENUM ('PENDING', 'ISSUED', 'CANCELLED', 'FAILED');

-- CreateTable
CREATE TABLE "ShopTaxSetting" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "entityType" "TaxEntityType" NOT NULL DEFAULT 'HOUSEHOLD',
    "platformTaxRate" DECIMAL(5,4) NOT NULL DEFAULT 0.015,
    "customTaxRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "filterPeriod" "TaxFilterPeriod" NOT NULL DEFAULT 'MONTH',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopTaxSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLog" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "orderId" TEXT,
    "orderCode" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "invoiceNo" TEXT,
    "transactionId" TEXT,
    "status" "InvoiceLogStatus" NOT NULL DEFAULT 'PENDING',
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "platformTaxWithheld" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "issuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopTaxSetting_ownerId_key" ON "ShopTaxSetting"("ownerId");

-- CreateIndex
CREATE INDEX "InvoiceLog_ownerId_createdAt_idx" ON "InvoiceLog"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "InvoiceLog_orderId_idx" ON "InvoiceLog"("orderId");

-- AddForeignKey
ALTER TABLE "ShopTaxSetting" ADD CONSTRAINT "ShopTaxSetting_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLog" ADD CONSTRAINT "InvoiceLog_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLog" ADD CONSTRAINT "InvoiceLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

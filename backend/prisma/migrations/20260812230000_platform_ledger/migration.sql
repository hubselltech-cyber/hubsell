-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "LedgerSource" AS ENUM ('SUBSCRIPTION', 'REFERRAL_PAYOUT', 'OTHER');

-- CreateEnum
CREATE TYPE "LedgerInvoiceStatus" AS ENUM ('NONE', 'PENDING', 'ISSUED');

-- CreateTable
CREATE TABLE "platform_ledger_entries" (
    "id" TEXT NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "source" "LedgerSource" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "customerId" TEXT,
    "withdrawalRequestId" TEXT,
    "invoiceStatus" "LedgerInvoiceStatus" NOT NULL DEFAULT 'NONE',
    "invoiceNo" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_ledger_entries_withdrawalRequestId_key" ON "platform_ledger_entries"("withdrawalRequestId");

-- CreateIndex
CREATE INDEX "platform_ledger_entries_occurredAt_idx" ON "platform_ledger_entries"("occurredAt");

-- AddForeignKey
ALTER TABLE "platform_ledger_entries" ADD CONSTRAINT "platform_ledger_entries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


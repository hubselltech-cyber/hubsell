-- Sổ quỹ HQ: khoản mục chi + chứng từ đầu vào + danh mục chi phí cố định hàng tháng

-- AlterTable
ALTER TABLE "platform_ledger_entries"
  ADD COLUMN "expenseCategory" TEXT,
  ADD COLUMN "vendorName" TEXT,
  ADD COLUMN "vendorTaxCode" TEXT,
  ADD COLUMN "inputInvoiceNo" TEXT,
  ADD COLUMN "paymentMethod" TEXT,
  ADD COLUMN "recurringExpenseId" TEXT;

-- CreateTable
CREATE TABLE "platform_recurring_expenses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "vendorName" TEXT,
    "expectedAmount" DECIMAL(14,2) NOT NULL,
    "dayOfMonth" INTEGER NOT NULL DEFAULT 5,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_recurring_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_ledger_entries_recurringExpenseId_idx" ON "platform_ledger_entries"("recurringExpenseId");

-- AddForeignKey
ALTER TABLE "platform_ledger_entries" ADD CONSTRAINT "platform_ledger_entries_recurringExpenseId_fkey" FOREIGN KEY ("recurringExpenseId") REFERENCES "platform_recurring_expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

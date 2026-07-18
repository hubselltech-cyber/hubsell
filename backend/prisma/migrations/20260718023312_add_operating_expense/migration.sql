-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('RENT', 'SALARY', 'PACKAGING', 'ADS', 'OTHER');

-- CreateTable
CREATE TABLE "OperatingExpense" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL DEFAULT 'OTHER',
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "expenseDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatingExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperatingExpense_userId_idx" ON "OperatingExpense"("userId");

-- AddForeignKey
ALTER TABLE "OperatingExpense" ADD CONSTRAINT "OperatingExpense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

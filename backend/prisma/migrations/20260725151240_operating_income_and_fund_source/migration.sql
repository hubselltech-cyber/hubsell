-- CreateEnum
CREATE TYPE "TransactionDirection" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "FundSourceType" AS ENUM ('PLATFORM_WALLET', 'BANK_ACCOUNT');

-- AlterTable
ALTER TABLE "OperatingExpense" ADD COLUMN     "direction" "TransactionDirection" NOT NULL DEFAULT 'EXPENSE',
ADD COLUMN     "fundChannelId" TEXT,
ADD COLUMN     "fundSource" "FundSourceType";

-- CreateIndex
CREATE INDEX "OperatingExpense_fundChannelId_idx" ON "OperatingExpense"("fundChannelId");

-- AddForeignKey
ALTER TABLE "OperatingExpense" ADD CONSTRAINT "OperatingExpense_fundChannelId_fkey" FOREIGN KEY ("fundChannelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

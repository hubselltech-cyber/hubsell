-- CreateEnum
CREATE TYPE "WithdrawalSource" AS ENUM ('MANUAL', 'SYNC');

-- CreateTable
CREATE TABLE "WalletWithdrawal" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "source" "WithdrawalSource" NOT NULL DEFAULT 'MANUAL',
    "externalTxnId" TEXT,
    "transactionTime" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletWithdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WalletWithdrawal_channelId_idx" ON "WalletWithdrawal"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletWithdrawal_channelId_externalTxnId_key" ON "WalletWithdrawal"("channelId", "externalTxnId");

-- AddForeignKey
ALTER TABLE "WalletWithdrawal" ADD CONSTRAINT "WalletWithdrawal_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

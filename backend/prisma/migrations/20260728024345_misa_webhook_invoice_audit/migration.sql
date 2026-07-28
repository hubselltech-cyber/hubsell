-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "einvoiceStatus" "InvoiceLogStatus";

-- CreateTable
CREATE TABLE "misa_webhook_logs" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "transactionId" TEXT,
    "invoiceNo" TEXT,
    "orderCode" TEXT,
    "bodyHash" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" "WebhookJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "misa_webhook_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceStatusHistory" (
    "id" TEXT NOT NULL,
    "invoiceLogId" TEXT NOT NULL,
    "orderCode" TEXT NOT NULL,
    "fromStatus" "InvoiceLogStatus",
    "toStatus" "InvoiceLogStatus" NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MISA_WEBHOOK',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "misa_webhook_logs_bodyHash_key" ON "misa_webhook_logs"("bodyHash");

-- CreateIndex
CREATE INDEX "misa_webhook_logs_status_nextRetryAt_createdAt_idx" ON "misa_webhook_logs"("status", "nextRetryAt", "createdAt");

-- CreateIndex
CREATE INDEX "misa_webhook_logs_orderCode_idx" ON "misa_webhook_logs"("orderCode");

-- CreateIndex
CREATE INDEX "InvoiceStatusHistory_invoiceLogId_createdAt_idx" ON "InvoiceStatusHistory"("invoiceLogId", "createdAt");

-- CreateIndex
CREATE INDEX "InvoiceStatusHistory_orderCode_idx" ON "InvoiceStatusHistory"("orderCode");

-- CreateIndex
CREATE INDEX "InvoiceLog_transactionId_idx" ON "InvoiceLog"("transactionId");

-- AddForeignKey
ALTER TABLE "InvoiceStatusHistory" ADD CONSTRAINT "InvoiceStatusHistory_invoiceLogId_fkey" FOREIGN KEY ("invoiceLogId") REFERENCES "InvoiceLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

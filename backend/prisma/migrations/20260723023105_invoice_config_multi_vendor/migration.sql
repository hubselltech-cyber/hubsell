-- CreateTable
CREATE TABLE "InvoiceConfig" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "channelId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'MISA',
    "signMethod" TEXT NOT NULL DEFAULT 'usb',
    "partnerCode" TEXT,
    "clientId" TEXT,
    "secretKey" TEXT,
    "apiKey" TEXT,
    "customApiUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceConfig_ownerId_idx" ON "InvoiceConfig"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceConfig_ownerId_channelId_key" ON "InvoiceConfig"("ownerId", "channelId");

-- AddForeignKey
ALTER TABLE "InvoiceConfig" ADD CONSTRAINT "InvoiceConfig_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceConfig" ADD CONSTRAINT "InvoiceConfig_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

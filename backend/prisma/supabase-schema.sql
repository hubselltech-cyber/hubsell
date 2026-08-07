-- ============================================================
-- HUBSELL â€” SCRIPT Táº O TOÃ€N Bá»˜ Báº¢NG TRÃŠN SUPABASE (Postgres)
--
-- File nÃ y SINH Tá»° Äá»˜NG tá»« prisma/schema.prisma báº±ng:
--   npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
-- Äá»ªNG sá»­a tay â€” Ä‘á»•i schema thÃ¬ sá»­a schema.prisma rá»“i sinh láº¡i.
--
-- 2 cÃ¡ch dÃ¹ng (chá»n Má»˜T):
--   A. (khuyáº¿n nghá»‹) Äá»ƒ Render tá»± cháº¡y migration lÃºc deploy:
--      startCommand Ä‘Ã£ cÃ³ `prisma migrate deploy` â€” KHÃ”NG cáº§n cháº¡y file nÃ y.
--   B. Táº¡o tay: dÃ¡n toÃ n bá»™ file vÃ o Supabase â†’ SQL Editor â†’ Run
--      (chá»‰ cháº¡y trÃªn database Rá»–NG; cháº¡y láº¡i trÃªn DB Ä‘Ã£ cÃ³ báº£ng sáº½ lá»—i trÃ¹ng).
-- ============================================================

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ChannelName" AS ENUM ('SHOPEE', 'LAZADA', 'TIKTOK', 'OFFLINE');

-- CreateEnum
CREATE TYPE "ShippingStatus" AS ENUM ('PENDING', 'PROCESSED', 'SHIPPING', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('NONE', 'AWAITING', 'RECEIVED_INTACT', 'DAMAGED', 'CLAIM_SETTLED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "Carrier" AS ENUM ('SPX', 'GHTK', 'GHN', 'JT', 'VIETTEL_POST', 'NINJA_VAN', 'BEST', 'KHAC');

-- CreateEnum
CREATE TYPE "InventoryLogType" AS ENUM ('IMPORT', 'EXPORT', 'SYNC');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('RENT', 'SALARY', 'PACKAGING', 'ADS', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseType" AS ENUM ('FIXED', 'VARIABLE');

-- CreateEnum
CREATE TYPE "TransactionDirection" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "FundSourceType" AS ENUM ('PLATFORM_WALLET', 'BANK_ACCOUNT');

-- CreateEnum
CREATE TYPE "ShippingDisputeStatus" AS ENUM ('CHO_KHIEU_NAI', 'DANG_KHIEU_NAI', 'DA_DOI_SOAT');

-- CreateEnum
CREATE TYPE "TaxCalculationBase" AS ENUM ('PROFIT', 'REVENUE');

-- CreateEnum
CREATE TYPE "TaxFilterPeriod" AS ENUM ('MONTH', 'QUARTER', 'YEAR');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('STANDARD', 'POS');

-- CreateEnum
CREATE TYPE "InvoiceLogStatus" AS ENUM ('PENDING', 'ISSUED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "WebhookJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'VERIFYING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "StockSyncStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'SALES', 'WAREHOUSE');

-- CreateEnum
CREATE TYPE "WithdrawalSource" AS ENUM ('MANUAL', 'SYNC');

-- CreateEnum
CREATE TYPE "ChannelProductStatus" AS ENUM ('ACTIVE', 'DELISTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'VN',
    "phone" TEXT,
    "googleId" TEXT,
    "resetTokenHash" TEXT,
    "resetTokenExpiresAt" TIMESTAMP(3),
    "role" "Role" NOT NULL DEFAULT 'SALES',
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelName" "ChannelName" NOT NULL,
    "shopName" TEXT NOT NULL,
    "externalShopId" TEXT,
    "externalShopName" TEXT,
    "apiToken" TEXT,
    "refreshToken" TEXT,
    "accessTokenExpireAt" TIMESTAMP(3),
    "refreshTokenExpireAt" TIMESTAMP(3),
    "shopCipher" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "syncFailCount" INTEGER NOT NULL DEFAULT 0,
    "feeRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdSpend" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdSpend_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "StaffChannel" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "canFinance" BOOLEAN NOT NULL DEFAULT true,
    "canWarehouse" BOOLEAN NOT NULL DEFAULT true,
    "canAds" BOOLEAN NOT NULL DEFAULT true,
    "canOrders" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "StaffChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsResolvedAlert" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "byRole" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsResolvedAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsChatMessage" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsActivity" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsAlert" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "OpsAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsCenterVisit" (
    "ownerId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsCenterVisit_pkey" PRIMARY KEY ("ownerId")
);

-- CreateTable
CREATE TABLE "InvoiceConfig" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "channelId" TEXT,
    "taxCode" TEXT,
    "companyName" TEXT,
    "companyAddress" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'MISA',
    "partnerCode" TEXT,
    "clientId" TEXT,
    "secretKey" TEXT,
    "apiKey" TEXT,
    "customApiUrl" TEXT,
    "invoicePattern" TEXT,
    "invoiceSeries" TEXT,
    "signMethod" TEXT NOT NULL DEFAULT 'USB_TOKEN',
    "esignClientId" TEXT,
    "esignSecretKey" TEXT,
    "esignUsername" TEXT,
    "esignPassword" TEXT,
    "certSerial" TEXT,
    "posClientId" TEXT,
    "posSecretKey" TEXT,
    "posCodePrefix" TEXT,
    "posMachineId" TEXT,
    "posSeries" TEXT,
    "defaultInvoiceType" "InvoiceType" NOT NULL DEFAULT 'STANDARD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopTaxSetting" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "customTaxRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "calculationBase" "TaxCalculationBase" NOT NULL DEFAULT 'PROFIT',
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

-- CreateTable
CREATE TABLE "input_invoices" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "misaInvoiceId" TEXT NOT NULL,
    "invoiceNo" TEXT,
    "invoiceSerial" TEXT,
    "sellerTaxCode" TEXT,
    "sellerName" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "statusRaw" TEXT,
    "rawPayload" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "input_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "costPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sellingPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "quantityInStock" INTEGER NOT NULL DEFAULT 0,
    "holdQuantity" INTEGER NOT NULL DEFAULT 0,
    "imageUrl" TEXT,
    "taxName" TEXT,
    "vatRate" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "orderCode" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "carrier" "Carrier",
    "trackingCode" TEXT,
    "packedAt" TIMESTAMP(3),
    "labelPrintedAt" TIMESTAMP(3),
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "returnStatus" "ReturnStatus" NOT NULL DEFAULT 'NONE',
    "returnNote" TEXT,
    "returnedAt" TIMESTAMP(3),
    "compensationAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "returnRequestedAt" TIMESTAMP(3),
    "stockRestoredAt" TIMESTAMP(3),
    "stockDeductedAt" TIMESTAMP(3),
    "stockHeldAt" TIMESTAMP(3),
    "stockHoldReleasedAt" TIMESTAMP(3),
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "shippingStatus" "ShippingStatus" NOT NULL DEFAULT 'PENDING',
    "einvoiceStatus" "InvoiceLogStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "platformFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isSettled" BOOLEAN NOT NULL DEFAULT false,
    "settledAt" TIMESTAMP(3),
    "fixedFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "serviceFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sellerProtectionFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paymentFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "affiliateFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sellerVoucher" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shippingFeeQuoted" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shippingFeeActual" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shippingFeeDiff" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shippingDisputeStatus" "ShippingDisputeStatus" NOT NULL DEFAULT 'CHO_KHIEU_NAI',
    "platformSubsidy" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "actualPayout" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shipSubsidyPlatform" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shipSubsidyShop" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "adWalletTopup" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxWithheld" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "channelSku" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "costPriceAtSale" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelProduct" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelSku" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "variantName" TEXT,
    "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "imageUrl" TEXT,
    "externalId" TEXT,
    "status" "ChannelProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "costPrice" DECIMAL(12,2),
    "productId" TEXT,

    CONSTRAINT "ChannelProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLog" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "changeQuantity" INTEGER NOT NULL,
    "type" "InventoryLogType" NOT NULL,
    "reason" TEXT,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatingExpense" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "direction" "TransactionDirection" NOT NULL DEFAULT 'EXPENSE',
    "category" "ExpenseCategory" NOT NULL DEFAULT 'OTHER',
    "type" "ExpenseType" NOT NULL DEFAULT 'VARIABLE',
    "appliedSku" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "fundChannelId" TEXT,
    "fundPlatform" "ChannelName",
    "fundSource" "FundSourceType",
    "note" TEXT,
    "expenseDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatingExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopee_webhook_logs" (
    "id" TEXT NOT NULL,
    "eventCode" INTEGER NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderSn" TEXT,
    "bodyHash" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" "WebhookJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shopee_webhook_logs_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "InventorySyncLog" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelSku" TEXT NOT NULL,
    "productId" TEXT,
    "oldQuantity" INTEGER NOT NULL,
    "newQuantity" INTEGER NOT NULL,
    "status" "StockSyncStatus" NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventorySyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventorySyncAlert" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelSku" TEXT,
    "orderSn" TEXT,
    "message" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventorySyncAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lazada_order_settlements" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "itemRevenue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shipFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shipFeeCustomer" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shipDiscountPlatform" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shipDiscountSeller" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shipFeeReturn" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shipFeeAdjustment" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeFixed" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeOrderProcessing" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feePayment" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeCommission" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeShipSeller" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shipSubsidySeller" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeFreeshipMax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeCashbackMax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeSponsoredDiscovery" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeLazadaBonus" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "bonusLzdCofund" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeBuyerReview" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeLazpick" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeCampaign" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeAffiliate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeInfrastructure" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeOther" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "subsidyOther" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sellerVoucher" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vatFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "incomeTaxFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "actualPayout" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lazada_order_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE INDEX "Channel_userId_idx" ON "Channel"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_userId_channelName_shopName_key" ON "Channel"("userId", "channelName", "shopName");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_userId_channelName_externalShopId_key" ON "Channel"("userId", "channelName", "externalShopId");

-- CreateIndex
CREATE INDEX "AdSpend_channelId_idx" ON "AdSpend"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "AdSpend_channelId_date_key" ON "AdSpend"("channelId", "date");

-- CreateIndex
CREATE INDEX "WalletWithdrawal_channelId_idx" ON "WalletWithdrawal"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletWithdrawal_channelId_externalTxnId_key" ON "WalletWithdrawal"("channelId", "externalTxnId");

-- CreateIndex
CREATE INDEX "StaffChannel_staffId_idx" ON "StaffChannel"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffChannel_staffId_channelId_key" ON "StaffChannel"("staffId", "channelId");

-- CreateIndex
CREATE INDEX "OpsResolvedAlert_ownerId_idx" ON "OpsResolvedAlert"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "OpsResolvedAlert_ownerId_alertId_key" ON "OpsResolvedAlert"("ownerId", "alertId");

-- CreateIndex
CREATE INDEX "OpsChatMessage_ownerId_alertId_idx" ON "OpsChatMessage"("ownerId", "alertId");

-- CreateIndex
CREATE INDEX "OpsActivity_ownerId_idx" ON "OpsActivity"("ownerId");

-- CreateIndex
CREATE INDEX "OpsAlert_ownerId_status_idx" ON "OpsAlert"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OpsAlert_ownerId_type_dedupeKey_key" ON "OpsAlert"("ownerId", "type", "dedupeKey");

-- CreateIndex
CREATE INDEX "InvoiceConfig_ownerId_idx" ON "InvoiceConfig"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceConfig_ownerId_channelId_key" ON "InvoiceConfig"("ownerId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopTaxSetting_ownerId_key" ON "ShopTaxSetting"("ownerId");

-- CreateIndex
CREATE INDEX "InvoiceLog_ownerId_createdAt_idx" ON "InvoiceLog"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "InvoiceLog_orderId_idx" ON "InvoiceLog"("orderId");

-- CreateIndex
CREATE INDEX "InvoiceLog_transactionId_idx" ON "InvoiceLog"("transactionId");

-- CreateIndex
CREATE INDEX "input_invoices_ownerId_invoiceDate_idx" ON "input_invoices"("ownerId", "invoiceDate");

-- CreateIndex
CREATE UNIQUE INDEX "input_invoices_ownerId_misaInvoiceId_key" ON "input_invoices"("ownerId", "misaInvoiceId");

-- CreateIndex
CREATE INDEX "Product_userId_idx" ON "Product"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_userId_skuCode_key" ON "Product"("userId", "skuCode");

-- CreateIndex
CREATE INDEX "Order_channelId_idx" ON "Order"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_channelId_orderCode_key" ON "Order"("channelId", "orderCode");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "ChannelProduct_productId_idx" ON "ChannelProduct"("productId");

-- CreateIndex
CREATE INDEX "ChannelProduct_channelId_idx" ON "ChannelProduct"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelProduct_channelId_channelSku_key" ON "ChannelProduct"("channelId", "channelSku");

-- CreateIndex
CREATE INDEX "InventoryLog_productId_idx" ON "InventoryLog"("productId");

-- CreateIndex
CREATE INDEX "InventoryLog_orderId_idx" ON "InventoryLog"("orderId");

-- CreateIndex
CREATE INDEX "OperatingExpense_userId_idx" ON "OperatingExpense"("userId");

-- CreateIndex
CREATE INDEX "OperatingExpense_fundChannelId_idx" ON "OperatingExpense"("fundChannelId");

-- CreateIndex
CREATE UNIQUE INDEX "shopee_webhook_logs_bodyHash_key" ON "shopee_webhook_logs"("bodyHash");

-- CreateIndex
CREATE INDEX "shopee_webhook_logs_status_nextRetryAt_createdAt_idx" ON "shopee_webhook_logs"("status", "nextRetryAt", "createdAt");

-- CreateIndex
CREATE INDEX "shopee_webhook_logs_orderSn_idx" ON "shopee_webhook_logs"("orderSn");

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
CREATE INDEX "InventorySyncLog_channelId_createdAt_idx" ON "InventorySyncLog"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "InventorySyncLog_status_idx" ON "InventorySyncLog"("status");

-- CreateIndex
CREATE INDEX "InventorySyncAlert_channelId_resolvedAt_idx" ON "InventorySyncAlert"("channelId", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "lazada_order_settlements_orderId_key" ON "lazada_order_settlements"("orderId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdSpend" ADD CONSTRAINT "AdSpend_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletWithdrawal" ADD CONSTRAINT "WalletWithdrawal_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffChannel" ADD CONSTRAINT "StaffChannel_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffChannel" ADD CONSTRAINT "StaffChannel_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsResolvedAlert" ADD CONSTRAINT "OpsResolvedAlert_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsChatMessage" ADD CONSTRAINT "OpsChatMessage_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsActivity" ADD CONSTRAINT "OpsActivity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsAlert" ADD CONSTRAINT "OpsAlert_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsCenterVisit" ADD CONSTRAINT "OpsCenterVisit_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceConfig" ADD CONSTRAINT "InvoiceConfig_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceConfig" ADD CONSTRAINT "InvoiceConfig_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopTaxSetting" ADD CONSTRAINT "ShopTaxSetting_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLog" ADD CONSTRAINT "InvoiceLog_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLog" ADD CONSTRAINT "InvoiceLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "input_invoices" ADD CONSTRAINT "input_invoices_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelProduct" ADD CONSTRAINT "ChannelProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelProduct" ADD CONSTRAINT "ChannelProduct_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLog" ADD CONSTRAINT "InventoryLog_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLog" ADD CONSTRAINT "InventoryLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatingExpense" ADD CONSTRAINT "OperatingExpense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatingExpense" ADD CONSTRAINT "OperatingExpense_fundChannelId_fkey" FOREIGN KEY ("fundChannelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceStatusHistory" ADD CONSTRAINT "InvoiceStatusHistory_invoiceLogId_fkey" FOREIGN KEY ("invoiceLogId") REFERENCES "InvoiceLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySyncLog" ADD CONSTRAINT "InventorySyncLog_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySyncAlert" ADD CONSTRAINT "InventorySyncAlert_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lazada_order_settlements" ADD CONSTRAINT "lazada_order_settlements_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- SỔ KOC (nhịp 1, 30/08/2026): 4 bảng thật thay tầng mock của /koc-marketing
-- KocPartner (hồ sơ) / KocSampleShipment (phiếu mẫu + deadline chống bùng) /
-- KocExpense (booking, MCN) / KocOrderAttribution (cầu nối đơn ↔ KOC từ file AMS)

-- 1) Enums
CREATE TYPE "KocPartnerStatus" AS ENUM ('ACTIVE', 'PAUSED', 'BLACKLISTED');
CREATE TYPE "KocSampleStatus" AS ENUM ('WAITING', 'POSTED', 'BURNED');
CREATE TYPE "KocExpenseKind" AS ENUM ('BOOKING', 'MCN_CONTRACT');
CREATE TYPE "KocExpenseState" AS ENUM ('PAID', 'PENDING');

-- 2) koc_partners
CREATE TABLE "koc_partners" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "handle" TEXT NOT NULL DEFAULT '',
    "platform" "ChannelName" NOT NULL DEFAULT 'SHOPEE',
    "followers" INTEGER NOT NULL DEFAULT 0,
    "contact" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "status" "KocPartnerStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "koc_partners_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "koc_partners_ownerId_name_key" ON "koc_partners"("ownerId", "name");
CREATE INDEX "koc_partners_ownerId_status_idx" ON "koc_partners"("ownerId", "status");
ALTER TABLE "koc_partners" ADD CONSTRAINT "koc_partners_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3) koc_sample_shipments
CREATE TABLE "koc_sample_shipments" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kocId" TEXT NOT NULL,
    "productId" TEXT,
    "sku" TEXT NOT NULL DEFAULT '',
    "productName" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "exportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postDeadlineAt" TIMESTAMP(3) NOT NULL,
    "status" "KocSampleStatus" NOT NULL DEFAULT 'WAITING',
    "postedAt" TIMESTAMP(3),
    "contentUrl" TEXT NOT NULL DEFAULT '',
    "deductedStock" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "koc_sample_shipments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "koc_sample_shipments_ownerId_status_postDeadlineAt_idx"
    ON "koc_sample_shipments"("ownerId", "status", "postDeadlineAt");
ALTER TABLE "koc_sample_shipments" ADD CONSTRAINT "koc_sample_shipments_kocId_fkey"
    FOREIGN KEY ("kocId") REFERENCES "koc_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "koc_sample_shipments" ADD CONSTRAINT "koc_sample_shipments_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4) koc_expenses
CREATE TABLE "koc_expenses" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kocId" TEXT,
    "displayName" TEXT NOT NULL DEFAULT '',
    "contractCode" TEXT NOT NULL DEFAULT '',
    "kind" "KocExpenseKind" NOT NULL DEFAULT 'BOOKING',
    "amount" DECIMAL(14,2) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "state" "KocExpenseState" NOT NULL DEFAULT 'PAID',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "koc_expenses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "koc_expenses_ownerId_state_idx" ON "koc_expenses"("ownerId", "state");
ALTER TABLE "koc_expenses" ADD CONSTRAINT "koc_expenses_kocId_fkey"
    FOREIGN KEY ("kocId") REFERENCES "koc_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5) koc_order_attributions
CREATE TABLE "koc_order_attributions" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kocId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'AMS_IMPORT',
    "commission" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "koc_order_attributions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "koc_order_attributions_orderId_key" ON "koc_order_attributions"("orderId");
CREATE INDEX "koc_order_attributions_kocId_idx" ON "koc_order_attributions"("kocId");
CREATE INDEX "koc_order_attributions_ownerId_idx" ON "koc_order_attributions"("ownerId");
ALTER TABLE "koc_order_attributions" ADD CONSTRAINT "koc_order_attributions_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "koc_order_attributions" ADD CONSTRAINT "koc_order_attributions_kocId_fkey"
    FOREIGN KEY ("kocId") REFERENCES "koc_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

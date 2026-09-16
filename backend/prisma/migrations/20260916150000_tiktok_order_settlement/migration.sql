-- Bản kê TikTok chi tiết (16/09/2026): số có dấu nguyên bản từ Finance API
-- 202501 (đã quyết toán) / 202507 unsettled (ước tính của sàn), tên cột = tên
-- phí TikTok Shop VN. Cùng khuôn lazada_order_settlements.
-- CreateTable
CREATE TABLE "tiktok_order_settlements" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "estimated" BOOLEAN NOT NULL DEFAULT false,
    "statementId" TEXT,
    "estimatedSettlementAt" TIMESTAMP(3),
    "unsettledReason" TEXT,
    "grossSales" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sellerDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "refundGross" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sellerDiscountRefund" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "revenueAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "platformDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "customerRefund" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shipActual" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shipCustomerPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shipPlatformDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shipSubsidy" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shipSellerDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shipReturn" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shipOther" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shipReimbursement" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shippingCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeCommission" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeTransaction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeOrderProcessing" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeSfp" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeVoucherXtra" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeFlashSale" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeAffiliate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeAffiliateAds" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeAffiliatePartner" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeGmvMax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeOther" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeTaxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxVat" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxPit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxOther" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "adjustmentAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "adjustmentTypes" TEXT,
    "settlementAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tiktok_order_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tiktok_order_settlements_orderId_key" ON "tiktok_order_settlements"("orderId");

-- AddForeignKey
ALTER TABLE "tiktok_order_settlements" ADD CONSTRAINT "tiktok_order_settlements_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

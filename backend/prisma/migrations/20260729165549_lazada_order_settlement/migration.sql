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
    "vatFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "incomeTaxFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "actualPayout" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lazada_order_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lazada_order_settlements_orderId_key" ON "lazada_order_settlements"("orderId");

-- AddForeignKey
ALTER TABLE "lazada_order_settlements" ADD CONSTRAINT "lazada_order_settlements_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Đơn thanh toán qua cổng payOS (09/09/2026): mỗi lần khách bấm "Thanh toán ngay"
-- là một dòng, orderCode gửi sang cổng ↔ (khách, gói, kỳ, số tiền). Webhook tìm
-- lại theo orderCode rồi gọi lõi recordPackagePayment (method GATEWAY).

-- CreateEnum
CREATE TYPE "GatewayOrderStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED', 'EXPIRED', 'MISMATCH');

-- CreateTable
CREATE TABLE "gateway_payment_orders" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'PAYOS',
    "orderCode" BIGINT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT,
    "planId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "cycle" "BillingCycle" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "GatewayOrderStatus" NOT NULL DEFAULT 'PENDING',
    "paymentLinkId" TEXT,
    "checkoutUrl" TEXT,
    "qrCode" TEXT,
    "expiresAt" TIMESTAMP(3),
    "gatewayReference" TEXT,
    "paidAmount" DECIMAL(14,2),
    "paidAt" TIMESTAMP(3),
    "packagePaymentId" TEXT,
    "lastWebhook" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gateway_payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gateway_payment_orders_orderCode_key" ON "gateway_payment_orders"("orderCode");

-- CreateIndex
CREATE INDEX "gateway_payment_orders_userId_status_createdAt_idx" ON "gateway_payment_orders"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "gateway_payment_orders_status_expiresAt_idx" ON "gateway_payment_orders"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "gateway_payment_orders" ADD CONSTRAINT "gateway_payment_orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

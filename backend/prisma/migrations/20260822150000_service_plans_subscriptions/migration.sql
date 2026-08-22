-- GÓI DỊCH VỤ & THUÊ BAO (GĐ1 thương mại hóa 22/08/2026): bảng giá gói +
-- thuê bao 1-1 theo chủ shop + lịch sử thanh toán (chứng từ, append-only)
-- + cột nối bút toán thu phí gói tự sinh trên sổ quỹ.
-- IF NOT EXISTS ở nơi cú pháp cho phép (bài học P3009); CREATE TYPE / ADD
-- CONSTRAINT chạy trơn — apply-migration-local.ts tự bỏ qua "already exists".

CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');

CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELLED');

CREATE TYPE "PackagePaymentMethod" AS ENUM ('BANK_TRANSFER', 'WALLET', 'GATEWAY');

CREATE TABLE IF NOT EXISTS "service_plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "tier" INTEGER NOT NULL DEFAULT 0,
    "priceMonthly" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "priceYearly" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "maxChannels" INTEGER,
    "maxOrdersPerMonth" INTEGER,
    "maxStaff" INTEGER,
    "features" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "package_payments" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "cycle" "BillingCycle" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PackagePaymentMethod" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "externalRef" TEXT,
    "note" TEXT,
    "confirmedById" TEXT,
    "confirmedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_payments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "platform_ledger_entries" ADD COLUMN IF NOT EXISTS "packagePaymentId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "service_plans_code_key" ON "service_plans"("code");

CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_userId_key" ON "subscriptions"("userId");

CREATE INDEX IF NOT EXISTS "subscriptions_currentPeriodEnd_idx" ON "subscriptions"("currentPeriodEnd");

CREATE UNIQUE INDEX IF NOT EXISTS "package_payments_externalRef_key" ON "package_payments"("externalRef");

CREATE INDEX IF NOT EXISTS "package_payments_userId_createdAt_idx" ON "package_payments"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "package_payments_occurredAt_idx" ON "package_payments"("occurredAt");

CREATE UNIQUE INDEX IF NOT EXISTS "platform_ledger_entries_packagePaymentId_key" ON "platform_ledger_entries"("packagePaymentId");

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "service_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "package_payments" ADD CONSTRAINT "package_payments_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "package_payments" ADD CONSTRAINT "package_payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "platform_ledger_entries" ADD CONSTRAINT "platform_ledger_entries_packagePaymentId_fkey" FOREIGN KEY ("packagePaymentId") REFERENCES "package_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

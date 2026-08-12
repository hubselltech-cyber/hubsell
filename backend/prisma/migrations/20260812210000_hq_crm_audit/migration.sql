-- CreateEnum
CREATE TYPE "PlatformCareStatus" AS ENUM ('NEW', 'CONTACTED', 'ACTIVE', 'CHURN_RISK', 'CHURNED');

-- CreateTable
CREATE TABLE "platform_customer_care" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "PlatformCareStatus" NOT NULL DEFAULT 'NEW',
    "assigneeId" TEXT,
    "note" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_customer_care_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetUserId" TEXT,
    "targetLabel" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_customer_care_userId_key" ON "platform_customer_care"("userId");

-- CreateIndex
CREATE INDEX "platform_customer_care_status_idx" ON "platform_customer_care"("status");

-- CreateIndex
CREATE INDEX "platform_audit_logs_createdAt_idx" ON "platform_audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "platform_customer_care" ADD CONSTRAINT "platform_customer_care_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_customer_care" ADD CONSTRAINT "platform_customer_care_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


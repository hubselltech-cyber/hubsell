-- GĐ3 (22/08): bảng YÊU CẦU MUA/NÂNG GÓI khách tự gửi từ /settings/plan —
-- cầu nối bán hàng khi chưa có cổng thanh toán; kế toán ghi nhận thanh toán
-- là yêu cầu tự đóng DONE.

CREATE TYPE "PlanUpgradeRequestStatus" AS ENUM ('PENDING', 'DONE', 'CANCELLED');

CREATE TABLE "plan_upgrade_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "cycle" "BillingCycle" NOT NULL,
    "listedPrice" DECIMAL(14,2) NOT NULL,
    "status" "PlanUpgradeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByName" TEXT,

    CONSTRAINT "plan_upgrade_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "plan_upgrade_requests_status_createdAt_idx" ON "plan_upgrade_requests"("status", "createdAt");

CREATE INDEX "plan_upgrade_requests_userId_status_idx" ON "plan_upgrade_requests"("userId", "status");

ALTER TABLE "plan_upgrade_requests" ADD CONSTRAINT "plan_upgrade_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

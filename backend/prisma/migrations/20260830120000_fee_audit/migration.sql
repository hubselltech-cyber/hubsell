-- KIỂM TOÁN PHÍ SÀN (trang /finance/fee-audit, 30/08/2026)
-- 1) Enum trạng thái xử lý khoản "sàn trả thiếu" (rổ #2)
CREATE TYPE "FeeAuditStatus" AS ENUM ('CHO_XU_LY', 'DANG_KHIEU_NAI', 'DA_XU_LY', 'BO_QUA');

-- 2) Cột mới trên Order:
--    expectedPayout   — snapshot escrow ước tính của CHÍNH Shopee trước giải ngân
--                       (mẫu số so với actualPayout; NULL = sàn không cấp số ước tính)
--    payoutShortfall  — max(expectedPayout − actualPayout, 0), ghi một lần lúc quyết toán
--    payoutAuditStatus— trạng thái xử lý khoản trả thiếu
--    deliveredAt      — mốc giao thành công (rổ #3 "quá hạn sàn chưa trả")
ALTER TABLE "Order" ADD COLUMN "expectedPayout" DECIMAL(12,2);
ALTER TABLE "Order" ADD COLUMN "payoutShortfall" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "payoutAuditStatus" "FeeAuditStatus" NOT NULL DEFAULT 'CHO_XU_LY';
ALTER TABLE "Order" ADD COLUMN "deliveredAt" TIMESTAMP(3);

-- 3) Index phục vụ rổ #3 + cột pendingSettle của Báo cáo dòng tiền
CREATE INDEX "Order_channelId_isSettled_idx" ON "Order"("channelId", "isSettled");

-- 19/09/2026 — Tự động phát hành CHỈ áp cho đơn giao từ ngày bật công tắc.
-- Trước đó bật là worker xuất cả đơn giao từ nhiều tháng trước — gồm cả đơn chủ
-- shop đã tự lập hóa đơn trên meInvoice trước khi dùng Hubsell (xuất TRÙNG, mà
-- hóa đơn đã gửi CQT thì không xóa được). Đơn cũ vẫn nằm ở hàng chờ để xuất tay
-- có chủ đích. NULL = shop bật từ trước 19/09 → giữ hành vi cũ (không mốc chặn).

-- AlterTable
ALTER TABLE "InvoiceConfig" ADD COLUMN IF NOT EXISTS "autoIssueEnabledAt" TIMESTAMP(3);

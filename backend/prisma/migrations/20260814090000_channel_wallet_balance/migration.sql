-- Số dư ví sàn THẬT cho bảng "Phân bổ dòng tiền theo gian hàng":
-- Shopee lấy current_balance của giao dịch ví mới nhất; null = sàn không có ví
-- (Lazada/TikTok/Offline) hoặc chưa đồng bộ được.
ALTER TABLE "Channel"
  ADD COLUMN "walletBalance" DECIMAL(14,2),
  ADD COLUMN "walletBalanceSyncedAt" TIMESTAMP(3);

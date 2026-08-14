-- Mốc thời gian gian hàng bị ngắt kết nối — null khi đang ACTIVE.
-- Bảng Phân bổ dòng tiền ẩn gian đã ngắt quá 30 ngày (giữ 30 ngày cho tiền về nốt).
ALTER TABLE "Channel" ADD COLUMN "disconnectedAt" TIMESTAMP(3);

-- Backfill: gian đang DISCONNECTED từ trước chưa có mốc → bắt đầu đếm từ hôm nay.
UPDATE "Channel" SET "disconnectedAt" = NOW() WHERE "status" = 'DISCONNECTED';

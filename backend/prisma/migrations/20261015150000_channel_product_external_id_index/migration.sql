-- 15/10/2026 — khớp dòng đơn / dòng hoàn với ChannelProduct theo id phân loại
-- lá phía sàn (externalId) thay vì chỉ theo mã người bán (mã có thể trùng giữa
-- các phân loại — sự cố Hi.Bé, xem backend/src/marketplace/sku-key.ts).
-- Bảng ChannelProduct cỡ vài chục nghìn dòng: tạo chỉ mục thường, không khóa lâu.
CREATE INDEX IF NOT EXISTS "ChannelProduct_channelId_externalId_idx" ON "ChannelProduct"("channelId", "externalId");

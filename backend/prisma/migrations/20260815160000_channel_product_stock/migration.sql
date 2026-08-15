-- Tồn kho trên sàn tại lần đồng bộ sản phẩm gần nhất (Shopee stock_info_v2 /
-- Lazada quantity). NULL = sàn không trả số hoặc chưa đồng bộ lại từ khi có cột.
-- Dùng để "đồng bộ lần đầu lấy tồn theo sàn": SKU kho tồn 0 khi liên kết sẽ
-- nhận số này làm tồn ban đầu thay vì bắt người dùng nhập tay.
ALTER TABLE "ChannelProduct" ADD COLUMN "channelStock" INTEGER;

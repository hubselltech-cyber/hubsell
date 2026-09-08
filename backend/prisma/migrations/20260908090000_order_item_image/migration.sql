-- Ảnh dòng hàng lấy từ payload đơn của sàn (Shopee image_info / Lazada product_main_image / TikTok sku_image).
-- Trước 08/09 ảnh chỉ tra ChannelProduct (đồng bộ danh mục bằng tay) → gian chưa đồng bộ danh mục là trống ảnh cả bảng đơn.
ALTER TABLE "OrderItem" ADD COLUMN "imageUrl" TEXT;

-- KIỂM TOÁN PHÍ SÀN — diff TỪNG THÀNH PHẦN thay cho so tổng (01/09/2026)
-- Bối cảnh: đơn 26082480K9AARJ báo oan "sàn trả thiếu 7.491" — thực chất là
-- phí hoa hồng Tiếp thị liên kết (AMS) chỉ chốt lúc quyết toán, không có trong
-- số ước tính của chính Shopee. So TỔNG expectedPayout − escrow thì mọi khoản
-- chốt-muộn đều thành cáo buộc; chuyển sang diff từng thành phần:
--   expectedIncome        — snapshot nguyên bản trường số order_income ước tính
--                           (mẫu số theo từng loại phí; NULL = đơn trước nâng cấp)
--   payoutShortfallDetail — bảng diff ghi lúc quyết toán (trả thiếu VÌ ĐÂU,
--                           khoản không buộc tội giữ lại để theo dõi)
ALTER TABLE "Order" ADD COLUMN "expectedIncome" JSONB;
ALTER TABLE "Order" ADD COLUMN "payoutShortfallDetail" JSONB;

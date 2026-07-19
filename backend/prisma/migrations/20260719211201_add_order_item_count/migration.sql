-- Số dòng hàng của đơn, lưu sẵn để lọc nhanh "đơn 1 sản phẩm" / "đơn nhiều sản phẩm".

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "itemCount" INTEGER NOT NULL DEFAULT 0;

-- Điền cho các đơn đã có: đếm số dòng OrderItem của từng đơn.
-- Đơn cũ chưa có OrderItem (từ trước khi hệ thống ghi chi tiết dòng hàng) sẽ
-- giữ giá trị 0 — chúng không rơi vào nhóm nào trong hai bộ lọc, đúng bản chất
-- là "không biết đơn này gồm mấy mặt hàng".
UPDATE "Order" o
SET "itemCount" = (
  SELECT COUNT(*) FROM "OrderItem" oi WHERE oi."orderId" = o."id"
);

-- Lọc theo cột này chạy cùng bộ lọc trạng thái nên đánh index ghép
CREATE INDEX "Order_itemCount_idx" ON "Order"("itemCount");

-- Số của SÀN về yêu cầu hoàn (19/08/2026, chốt anh Trung "không bịa giá"):
-- giải pháp hoàn (hàng về / khách giữ), tiền hoàn sàn báo, trạng thái yêu cầu,
-- mốc kiện hoàn về tay seller. Lãi/Lỗ thực hiện đọc các cột này thay vì tạm
-- tính hoàn full doanh thu + tính đủ giá vốn cho hàng đã về.
CREATE TYPE "ReturnSolution" AS ENUM ('RETURN_REFUND', 'REFUND_ONLY');

ALTER TABLE "Order"
  ADD COLUMN "returnSolution" "ReturnSolution",
  ADD COLUMN "platformRefundAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "platformReturnStatus" TEXT,
  ADD COLUMN "returnDeliveredAt" TIMESTAMP(3);

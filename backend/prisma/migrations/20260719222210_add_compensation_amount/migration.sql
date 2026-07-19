-- Số tiền bưu cục/sàn đền cho kiện hàng hỏng hoặc mất.
-- Mặc định 0: đơn chưa chốt khiếu nại và đơn thua kiện đều là 0 đồng thu về.
ALTER TABLE "Order" ADD COLUMN "compensationAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

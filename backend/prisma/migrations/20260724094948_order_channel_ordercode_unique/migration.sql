-- Mã đơn là DUY NHẤT trong một gian hàng — chốt để đồng bộ API sàn idempotent.
CREATE UNIQUE INDEX "Order_channelId_orderCode_key" ON "Order"("channelId", "orderCode");

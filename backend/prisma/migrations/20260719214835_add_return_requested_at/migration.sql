-- Mốc sàn báo đơn bắt đầu hoàn — dùng để đếm ngày đối soát hàng hoàn.
-- CỐ Ý không backfill bằng createdAt: số ngày chờ là căn cứ khiếu nại bưu cục,
-- bịa mốc ra là đi đòi tiền bằng số liệu sai. Đơn cũ để null = "chưa rõ mốc".
ALTER TABLE "Order" ADD COLUMN "returnRequestedAt" TIMESTAMP(3);

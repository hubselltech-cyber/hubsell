-- Thêm trạng thái "Đã xử lý" vào vòng đời đơn + mốc đã in phiếu giao hàng.
--
-- Cột shippingStatus trước đây là TEXT tự do. Chuyển sang enum để cả CSDL lẫn
-- mã nguồn cùng chặn giá trị sai, thay vì chỉ dựa vào kiểm tra ở tầng ứng dụng.

-- CreateEnum
CREATE TYPE "ShippingStatus" AS ENUM ('PENDING', 'PROCESSED', 'SHIPPING', 'DELIVERED', 'CANCELLED');

-- AlterTable: TEXT -> enum.
-- Phải bỏ DEFAULT trước rồi mới đổi kiểu, nếu không Postgres báo lỗi vì giá trị
-- mặc định cũ (chuỗi) không ép được sang kiểu mới. USING giữ nguyên dữ liệu đang
-- có — 4 giá trị cũ đều nằm trong enum mới nên không đơn nào bị mất trạng thái.
ALTER TABLE "Order" ALTER COLUMN "shippingStatus" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "shippingStatus" TYPE "ShippingStatus"
  USING ("shippingStatus"::text::"ShippingStatus");
ALTER TABLE "Order" ALTER COLUMN "shippingStatus" SET DEFAULT 'PENDING';

-- AlterTable: mốc đã in phiếu giao hàng (null = chưa in)
ALTER TABLE "Order" ADD COLUMN "labelPrintedAt" TIMESTAMP(3);

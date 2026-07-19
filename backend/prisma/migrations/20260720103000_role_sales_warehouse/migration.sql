-- PHÂN QUYỀN 2 LỚP: đổi User.role từ chuỗi tự do sang enum Role.
--
-- Vai trò cũ chỉ có ADMIN và STAFF. Nay tách STAFF thành hai:
--   SALES     — nhân viên vận hành, chỉ thấy gian hàng được phân công
--   WAREHOUSE — nhân viên kho, thấy đơn mọi gian nhưng không thấy tài chính
-- Toàn bộ STAFF hiện có mang đúng ngữ nghĩa của SALES nên đổi thẳng sang SALES.

CREATE TYPE "Role" AS ENUM ('ADMIN', 'SALES', 'WAREHOUSE');

-- Đổi dữ liệu TRƯỚC khi đổi kiểu cột, nếu không câu ép kiểu bên dưới sẽ vỡ vì
-- 'STAFF' không phải là một giá trị hợp lệ của enum mới.
UPDATE "User" SET "role" = 'SALES' WHERE "role" = 'STAFF';

-- Postgres không cho đổi kiểu cột khi còn DEFAULT kiểu cũ ràng buộc vào đó.
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role" USING ("role"::text::"Role");
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'SALES';

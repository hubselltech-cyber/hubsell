-- ============================================================
-- PHÂN QUYỀN NHÂN VIÊN (SUB-ACCOUNT + FINE-GRAINED RBAC) — 10/08/2026
--
-- ⚠️ CHẠY TAY TRÊN SUPABASE (SQL Editor) TRƯỚC KHI PUSH CODE MỚI.
-- Bài học 09/08: chạy từng khối, XÁC NHẬN kết quả thật bằng các câu SELECT
-- kiểm chứng ở cuối file — đừng tin chữ "Success" cũ của SQL Editor.
--
-- Nội dung:
--   1) User.email cho phép NULL (nhân viên kiểu "chủ/nhânviên" không cần email)
--   2) Thêm User."staffUsername" + unique (ownerId, staffUsername)
--   3) Thêm User."permissions" TEXT[] (mảng khóa quyền lá)
--   4) XÓA nhân viên kiểu cũ (tạo bằng email) — anh Trung chốt 10/08: đó chỉ là
--      tài khoản test, từ nay nhân viên hoạt động 100% theo hình thức mới
--   5) Gỡ 4 cờ chết canFinance/canWarehouse/canAds/canOrders trên StaffChannel
-- ============================================================

-- ---------- 1) Email nhân viên không bắt buộc ----------
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;

-- ---------- 2) Tên đăng nhập nhân viên ----------
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "staffUsername" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_ownerId_staffUsername_key"
  ON "User"("ownerId", "staffUsername");

-- ---------- 3) Mảng khóa quyền lá ----------
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- ---------- 4) Xóa nhân viên kiểu cũ (tài khoản test tạo bằng email) ----------
-- Nhân viên cũ = có ownerId nhưng CHƯA có staffUsername (tạo trước mô hình mới).
-- StaffChannel của họ tự xoá theo (FK onDelete: Cascade). Chủ shop (ownerId
-- NULL) tuyệt đối không bị đụng tới.
DELETE FROM "User"
WHERE "ownerId" IS NOT NULL AND "staffUsername" IS NULL;

-- ---------- 5) Gỡ 4 cờ chết trên StaffChannel ----------
ALTER TABLE "StaffChannel" DROP COLUMN IF EXISTS "canFinance";
ALTER TABLE "StaffChannel" DROP COLUMN IF EXISTS "canWarehouse";
ALTER TABLE "StaffChannel" DROP COLUMN IF EXISTS "canAds";
ALTER TABLE "StaffChannel" DROP COLUMN IF EXISTS "canOrders";

-- ============================================================
-- KIỂM CHỨNG (chạy từng câu, đối chiếu kết quả):
-- ============================================================
-- a) email đã nullable? (is_nullable = YES)
-- SELECT is_nullable FROM information_schema.columns
--  WHERE table_name = 'User' AND column_name = 'email';
--
-- b) 2 cột mới tồn tại?
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'User' AND column_name IN ('staffUsername','permissions');
--
-- c) Nhân viên kiểu cũ đã sạch? (mong 0 dòng)
-- SELECT id, "fullName" FROM "User" WHERE "ownerId" IS NOT NULL AND "staffUsername" IS NULL;
--
-- d) StaffChannel đã sạch 4 cờ?
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'StaffChannel';

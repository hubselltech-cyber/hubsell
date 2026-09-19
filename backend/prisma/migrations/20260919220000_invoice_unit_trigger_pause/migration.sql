-- 19/09/2026 — Vá 4 lỗ hổng xuất hóa đơn (anh Trung: "đừng để lúc xảy ra vấn đề"):
--   1. ĐƠN VỊ TÍNH: nội dung bắt buộc của hóa đơn, sàn không trả qua API →
--      mặc định theo shop + ghi đè theo SKU.
--   2. MỐC XUẤT TỰ ĐỘNG: DELIVERED (đúng Điều 9 NĐ 254/2026 — chuyển giao quyền
--      sở hữu) | SETTLED (chờ sàn đối soát — hành vi cũ, trễ vài ngày).
--   3. NGẮT MẠCH tự động phát hành khi lỗi cấp TÀI KHOẢN (sai mật khẩu, hết số
--      hóa đơn, chứng thư hết hạn…) — khỏi đốt FAILED hàng loạt mỗi 15 phút.

-- AlterTable
ALTER TABLE "InvoiceConfig" ADD COLUMN IF NOT EXISTS "defaultUnitName" TEXT NOT NULL DEFAULT 'Cái';
ALTER TABLE "InvoiceConfig" ADD COLUMN IF NOT EXISTS "autoIssueTrigger" TEXT NOT NULL DEFAULT 'DELIVERED';
ALTER TABLE "InvoiceConfig" ADD COLUMN IF NOT EXISTS "autoIssuePausedAt" TIMESTAMP(3);
ALTER TABLE "InvoiceConfig" ADD COLUMN IF NOT EXISTS "autoIssuePauseReason" TEXT;

-- Shop ĐANG BẬT tự động theo luật cũ (đã giao + đã đối soát) giữ nguyên hành vi
-- — đổi mốc ngầm sau deploy sẽ xả một loạt hóa đơn cho đơn chưa đối soát mà chủ
-- shop không hay biết. Shop bật mới từ nay mặc định DELIVERED.
UPDATE "InvoiceConfig" SET "autoIssueTrigger" = 'SETTLED' WHERE "autoIssueEnabled" = true;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "unitName" TEXT;

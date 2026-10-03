-- ============================================================
-- HÓA ĐƠN BƯỚC 5, LÁT 8: làn tự phát hành theo shop (03/10/2026, anh Trung duyệt
-- kế hoạch 03/10: "bây giờ vẫn ít seller dùng nên làm luôn được nhé").
--
-- Bảng MỚI "invoice_lanes", một dòng mỗi shop bật tự phát hành:
--   · leasedBy / leasedUntil — tiến trình đang thuê làn và hạn thuê (300 giây, gia
--     hạn giữa hai tờ). Thuê = UPDATE có điều kiện, không khóa RAM, không giữ giao
--     dịch dài; tiến trình chết thì hết hạn là tiến trình khác nhận.
--   · nextRunAt — lịch của shop (còn tồn 1 phút, hết 15 phút, lỗi tạm lùi 1/5/15
--     phút; bật công tắc / Chạy lại đặt về ngay). Lưới quét đọc theo chỉ mục này.
--   · transientStreak — số lượt liên tiếp dừng vì lỗi tạm của nhà cung cấp.
--
-- Bảng mới, không đụng bảng nào đang có → không cần lấy khóa trước. Bật RLS như
-- mọi bảng khác (backend nối bằng vai bỏ qua RLS; PostgREST / anon không đọc được).
-- ============================================================

CREATE TABLE "invoice_lanes" (
  "ownerId"         TEXT NOT NULL,
  "leasedBy"        TEXT,
  "leasedUntil"     TIMESTAMP(3),
  "nextRunAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastRunAt"       TIMESTAMP(3),
  "transientStreak" INTEGER NOT NULL DEFAULT 0,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "invoice_lanes_pkey" PRIMARY KEY ("ownerId")
);

CREATE INDEX "invoice_lanes_nextRunAt_idx" ON "invoice_lanes" ("nextRunAt");

ALTER TABLE "invoice_lanes"
  ADD CONSTRAINT "invoice_lanes_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invoice_lanes" ENABLE ROW LEVEL SECURITY;

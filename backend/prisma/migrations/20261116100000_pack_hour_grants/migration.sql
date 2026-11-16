-- ============================================================
-- VIDEO ĐÓNG HÀNG — SỔ GIỜ QUAY ĐÃ MUA (16/11/2026, docs/VIDEO-DONG-HANG-THIET-KE.md mục 11)
--
-- Anh Trung 16/11: "thiếu thống kê số giờ còn lại (ví dụ khách mua 1000 giờ, đã quay 400 thì còn
-- lại 600) và cả nút mua thêm giờ quay".
--
-- Mỗi dòng = MỘT LẦN cộng (hoặc trừ điều chỉnh) giờ cho một chủ shop. Chỉ CHÈN, không sửa, không
-- xóa → số dư luôn dựng lại được từ đầu:
--   giờ còn lại = Σ seconds của sổ này − Σ thời lượng các video đã lưu (pack_videos STORED + DELETED).
-- Cùng nguyên tắc với pack_videos: KHÔNG khóa ngoại, KHÔNG trigger, không đụng bảng có sẵn.
-- Chỉ CREATE — không khóa bảng lớn nào trên prod.
-- ============================================================

CREATE TABLE IF NOT EXISTS "pack_hour_grants" (
  "id"          TEXT NOT NULL,
  "ownerId"     TEXT NOT NULL,
  -- Số GIÂY cộng vào (dương) hoặc điều chỉnh giảm (âm). Không bao giờ bằng 0.
  "seconds"     INTEGER NOT NULL,
  -- PURCHASE khách mua | GRANT Hubsell tặng / cấp thử | ADJUST điều chỉnh tay có lý do
  "kind"        TEXT NOT NULL,
  "note"        TEXT,
  -- Ai ghi dòng này (tài khoản điều hành / hệ thống thanh toán); trống = script.
  "createdById" TEXT,
  "createdAt"   TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "pack_hour_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pack_hour_grants_kind_check" CHECK ("kind" IN ('PURCHASE', 'GRANT', 'ADJUST')),
  CONSTRAINT "pack_hour_grants_seconds_check" CHECK ("seconds" <> 0)
);

CREATE INDEX IF NOT EXISTS "pack_hour_grants_owner_idx" ON "pack_hour_grants" ("ownerId", "createdAt");

-- RLS (Supabase 30/09/2026: mọi bảng public phải bật).
ALTER TABLE "pack_hour_grants" ENABLE ROW LEVEL SECURITY;

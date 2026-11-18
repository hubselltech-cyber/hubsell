-- ============================================================
-- VIDEO ĐÓNG HÀNG — SỐ GIỜ ĐÃ QUAY GỘP THEO NGÀY (18/11/2026, docs/VIDEO-DONG-HANG-THIET-KE.md mục 19.6)
--
-- Vì sao có bảng này TRƯỚC mọi việc bỏ mảnh tháng của `pack_videos`: "giờ đã quay" là số tính tiền,
-- đang cộng thẳng từ sổ video. Bỏ một mảnh tháng cũ mà không có số gộp thì số đã quay TỤT, số giờ còn lại
-- của khách tự nhiên TĂNG. Bảng này giữ số đã quay của từng (chủ shop, ngày quay) mãi mãi (rất nhỏ:
-- một dòng / chủ shop / ngày có quay).
--
-- Cách đọc (services/pack-video/usage-daily.ts):
--   đã quay = Σ bảng này với ngày ≤ mốc đã gộp  +  Σ pack_videos (STORED + DELETED) với ngày > mốc.
-- Mốc đã gộp nằm ở maintenance_jobs (key 'pack-usage-daily', cột cursor = ngày "YYYY-MM-DD").
-- Chỉ CREATE — không ALTER bảng có sẵn, không khóa ngoại, không trigger. Bật RLS như mọi bảng public.
-- ============================================================

CREATE TABLE IF NOT EXISTS "pack_usage_daily" (
  "ownerId"    TEXT NOT NULL,
  "usageDate"  DATE NOT NULL,              -- = pack_videos."recordedDate" (giờ VN máy chủ)
  "videoCount" INTEGER NOT NULL,
  "seconds"    BIGINT NOT NULL,            -- Σ durationSec của video STORED + DELETED
  "sizeBytes"  BIGINT NOT NULL,
  "updatedAt"  TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "pack_usage_daily_pkey" PRIMARY KEY ("ownerId", "usageDate"),
  CONSTRAINT "pack_usage_daily_nonneg_check" CHECK ("videoCount" >= 0 AND "seconds" >= 0 AND "sizeBytes" >= 0)
);

ALTER TABLE "pack_usage_daily" ENABLE ROW LEVEL SECURITY;

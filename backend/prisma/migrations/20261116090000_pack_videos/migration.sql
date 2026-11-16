-- ============================================================
-- SỔ VIDEO ĐÓNG HÀNG — bảng `pack_videos` (16/11/2026)
-- docs/VIDEO-DONG-HANG-THIET-KE.md · docs/VIDEO-DONG-HANG-TU-KHIEU-NAI-KHAO-SAT.md mục 58.9–58.11
--
-- Một dòng = một video (đóng hàng / khui hàng hoàn). Tệp video nằm ở Cloudflare R2; bảng này
-- chỉ là SỔ. Anh Trung chốt 16/11: sổ đặt ở database chính, bảng riêng. Ba điều cố ý KHÁC sổ cái:
--   · KHÔNG khóa ngoại tới "Order" / "Channel" / "User";
--   · KHÔNG trigger (ghi sổ video không kích tính lại sổ cái);
--   · KHÔNG thêm cột / chỉ mục nào vào "Order".
-- Chia mảnh theo THÁNG trên "recordedDate" (ngày TẠO DÒNG theo giờ VN của MÁY CHỦ — không tin
-- đồng hồ điện thoại), đúng khuôn 20260930230000_order_ledger. Hết hạn giữ thì BỎ NGUYÊN MẢNH,
-- không DELETE từng dòng. Migration chỉ CREATE — không ALTER bảng nào có sẵn.
-- ============================================================

CREATE TABLE IF NOT EXISTS "pack_videos" (
  "id"           TEXT NOT NULL,
  "recordedDate" DATE NOT NULL,                      -- khóa chia mảnh
  "ownerId"      TEXT NOT NULL,                      -- chủ shop
  "clientId"     TEXT NOT NULL,                      -- mã do app sinh cho MỘT video: gọi lại không sinh dòng trùng
  "channelId"    TEXT,                               -- trống = tem chưa khớp đơn nào
  "orderId"      TEXT,                               -- KHÔNG phải khóa ngoại
  "orderCode"    TEXT,
  "trackingCode" TEXT NOT NULL,                      -- mã đọc được từ tem
  "kind"         TEXT NOT NULL,                      -- PACK đóng hàng | UNBOX khui hàng hoàn
  "recordedById" TEXT NOT NULL,                      -- tài khoản đang đăng nhập trên máy quay
  "deviceName"   TEXT,
  "recordedAt"   TIMESTAMPTZ(3) NOT NULL,            -- giờ bắt đầu quay do app báo (tương lai → giờ máy chủ)
  "durationSec"  INTEGER NOT NULL,
  "sizeBytes"    BIGINT NOT NULL,
  "width"        SMALLINT,
  "height"       SMALLINT,
  "objectKey"    TEXT NOT NULL,                      -- {ownerId}/{recordedDate}/{id}.mp4 — máy chủ tự dựng
  "uploadId"     TEXT,                               -- lượt tải theo mảnh của R2 (chỉ tệp > 32 MB)
  "status"       TEXT NOT NULL DEFAULT 'PENDING',    -- PENDING đã quay, chờ tải | STORED | DELETED | LOST
  "durationFlag" BOOLEAN NOT NULL DEFAULT false,     -- thời lượng lệch cỡ tệp quá biên (chỉ gắn cờ)
  "uploadedAt"   TIMESTAMPTZ(3),
  "deleteAfter"  DATE,                               -- hạn giữ; việc dọn (lát sau) ghi MỘT lần
  "holdReason"   TEXT,                               -- có hoàn / hỏng / mất → đang giữ
  "deletedAt"    TIMESTAMPTZ(3),
  "deleteRule"   TEXT,                               -- L1–L7 (tài liệu khảo sát mục 12.2)
  "createdAt"    TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "pack_videos_pkey" PRIMARY KEY ("recordedDate", "id"),
  -- Một video một dòng. Chỉ mục duy nhất của bảng chia mảnh BẮT BUỘC chứa khóa chia mảnh; đặt
  -- "recordedDate" CUỐI để cùng chỉ mục này tra được (ownerId, clientId) qua MỌI mảnh — gọi lại
  -- vắt qua nửa đêm vẫn ra dòng cũ mà không cần thêm một chỉ mục riêng.
  CONSTRAINT "pack_videos_client_key" UNIQUE ("ownerId", "clientId", "recordedDate"),
  CONSTRAINT "pack_videos_kind_check" CHECK ("kind" IN ('PACK', 'UNBOX')),
  CONSTRAINT "pack_videos_status_check" CHECK ("status" IN ('PENDING', 'STORED', 'DELETED', 'LOST'))
) PARTITION BY RANGE ("recordedDate");

-- Tên chỉ mục ≤ 63 ký tự (bài học 28/10: tên dài bị cắt im lặng).
-- Danh sách của một shop, mới nhất trước + con trỏ phân trang.
CREATE INDEX IF NOT EXISTS "pack_videos_owner_recorded_idx" ON "pack_videos" ("ownerId", "recordedAt" DESC, "id" DESC);
-- Ô tìm theo TIỀN TỐ mã vận đơn (LIKE 'abc%').
CREATE INDEX IF NOT EXISTS "pack_videos_owner_tracking_idx" ON "pack_videos" ("ownerId", "trackingCode" text_pattern_ops);
-- Nối với đơn: tab Đơn hoàn, nút "Xem video" ở dòng đơn.
CREATE INDEX IF NOT EXISTS "pack_videos_order_idx" ON "pack_videos" ("orderId") WHERE "orderId" IS NOT NULL;
-- Việc dọn lấy dòng tới hạn (lát sau).
CREATE INDEX IF NOT EXISTS "pack_videos_delete_after_idx" ON "pack_videos" ("deleteAfter") WHERE "status" = 'STORED';

-- RLS (Supabase 30/09/2026: mọi bảng public phải bật). Backend nối bằng vai trò chủ bảng nên không cần policy.
ALTER TABLE "pack_videos" ENABLE ROW LEVEL SECURITY;

-- ---------- Tạo mảnh theo tháng ----------
-- Tạo MỘT mảnh tháng. Nếu mảnh DEFAULT đang giữ dòng thuộc tháng đó thì đi đường vòng:
-- tạo bảng rời, dời dòng sang, rồi ATTACH — không kẹt vì một dòng ngày lạ. Mảnh mới cũng bật RLS.
CREATE OR REPLACE FUNCTION "pack_videos_create_month_partition"(p_month DATE)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_name  TEXT := 'pack_videos_' || to_char(p_month, 'YYYY_MM');
  v_next  DATE := (p_month + INTERVAL '1 month')::date;
  v_stray BOOLEAN;
BEGIN
  IF to_regclass(format('%I', v_name)) IS NOT NULL THEN
    RETURN false;
  END IF;
  SELECT EXISTS (SELECT 1 FROM "pack_videos_default" WHERE "recordedDate" >= p_month AND "recordedDate" < v_next)
    INTO v_stray;
  IF NOT v_stray THEN
    EXECUTE format('CREATE TABLE %I PARTITION OF "pack_videos" FOR VALUES FROM (%L) TO (%L)', v_name, p_month, v_next);
  ELSE
    EXECUTE format('CREATE TABLE %I (LIKE "pack_videos" INCLUDING DEFAULTS INCLUDING CONSTRAINTS)', v_name);
    EXECUTE format('WITH moved AS (DELETE FROM "pack_videos_default" WHERE "recordedDate" >= %L AND "recordedDate" < %L RETURNING *) INSERT INTO %I SELECT * FROM moved',
                   p_month, v_next, v_name);
    EXECUTE format('ALTER TABLE "pack_videos" ATTACH PARTITION %I FOR VALUES FROM (%L) TO (%L)', v_name, p_month, v_next);
  END IF;
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_name);
  RETURN true;
END;
$$;

-- Tạo sẵn mảnh từ tháng hiện tại (giờ VN) tới p_months_ahead tháng sau. Trả số mảnh mới.
CREATE OR REPLACE FUNCTION "pack_videos_ensure_partitions"(p_months_ahead INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  m       DATE := date_trunc('month', (now() AT TIME ZONE 'UTC') + INTERVAL '7 hours')::date;
  last_m  DATE;
  created INTEGER := 0;
BEGIN
  IF p_months_ahead < 0 THEN p_months_ahead := 0; END IF;
  last_m := (m + (p_months_ahead * INTERVAL '1 month'))::date;
  WHILE m <= last_m LOOP
    IF "pack_videos_create_month_partition"(m) THEN created := created + 1; END IF;
    m := (m + INTERVAL '1 month')::date;
  END LOOP;
  RETURN created;
END;
$$;

-- Mảnh DEFAULT: hứng mọi ngày ngoài dải đã tạo — không mất dòng. Phải có TRƯỚC khi tạo mảnh tháng.
DO $$ BEGIN
  IF to_regclass('pack_videos_default') IS NULL THEN
    CREATE TABLE "pack_videos_default" PARTITION OF "pack_videos" DEFAULT;
    ALTER TABLE "pack_videos_default" ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

SELECT "pack_videos_ensure_partitions"(3);

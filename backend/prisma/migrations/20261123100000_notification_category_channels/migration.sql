-- ============================================================
-- 23/11/2026 — CHUÔNG + TIN ĐẨY CHO NHÂN VIÊN THEO QUYỀN (lát 1, máy chủ)
-- (docs/MOBILE-PHAN-QUYEN-NHAN-VIEN.md mục 8 — anh Trung duyệt 23/11/2026)
--
--   notifications.category     mục con của thông báo, ghi lúc phát (trước đây chỉ suy từ type lúc đọc)
--   notifications.channelIds   các gian thông báo nói tới; rỗng = chuyện của cả shop
--
-- Hai cột để câu đọc của NHÂN VIÊN lọc được theo quyền + gian ngay trong SQL (danh sách và số chưa
-- đọc). Dòng cũ để nguyên (category NULL, channelIds rỗng): chủ shop vẫn thấy đủ, nhân viên chỉ
-- thấy thông báo phát từ lúc bản này lên. KHÔNG điền bù dòng cũ — không ghi hàng loạt lên bảng.
--
-- ADD COLUMN (nullable / mặc định hằng) → Postgres chỉ sửa metadata, không viết lại bảng; nhưng cần
-- khóa ACCESS EXCLUSIVE trên "notifications" trong chớp mắt, mà worker ghi bảng này liên tục → lấy
-- khóa có lock_timeout + thử lại (bẫy deadlock lúc deploy Render 30/09/2026).
-- Không thêm chỉ mục: câu đọc vẫn đi theo (ownerId, createdAt) sẵn có.
-- ============================================================

DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "notifications" IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'notification_category_channels: chưa lấy được khóa notifications (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "category" TEXT,
  ADD COLUMN IF NOT EXISTS "channelIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

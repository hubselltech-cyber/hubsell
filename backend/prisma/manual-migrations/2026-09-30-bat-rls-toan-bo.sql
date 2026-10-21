-- ============================================================
-- 30/09/2026: BẬT ROW LEVEL SECURITY CHO MỌI BẢNG TRONG SCHEMA public
-- Chạy tay trên Supabase production (SQL Editor), từng bước một.
--
-- Vì sao: Supabase báo 75 bảng "RLS Disabled in Public" + InvoiceConfig lộ
-- cột apiKey. Supabase tự mở Data API (PostgREST) trên schema public; bảng
-- chưa bật RLS thì ai cầm khóa anon/publishable của dự án cũng đọc/sửa/xóa
-- được qua https://<ref>.supabase.co/rest/v1/<bảng>.
--
-- Vì sao bật mà KHÔNG viết policy nào:
--  - Hubsell không dùng Data API. Backend đọc/ghi qua Prisma (nối thẳng
--    Postgres bằng role postgres = chủ bảng → RLS không áp lên chủ bảng khi
--    không có FORCE). Kho tệp dùng khóa service_role (BYPASSRLS).
--  - Bật RLS + không policy = anon/authenticated bị chặn sạch, đúng ý.
--  - TUYỆT ĐỐI không thêm FORCE ROW LEVEL SECURITY: sẽ chặn luôn Prisma.
--
-- Chạy lại vô hại (bảng đã bật thì bỏ qua).
-- ============================================================

-- ── BƯỚC 1 (chỉ đọc): kiểm điều kiện trước khi bật ──
-- 1a. Bảng nào chưa bật RLS, chủ bảng là ai. Kỳ vọng: chủ = postgres.
--     Nếu có bảng chủ KHÁC role mà backend đang nối → DỪNG, báo lại.
SELECT c.relname AS bang, pg_get_userbyid(c.relowner) AS chu_bang
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
ORDER BY 1;

-- 1b. Role backend dùng có vượt RLS không (postgres.<ref> trong DATABASE_URL
--     chính là role postgres).
SELECT rolname, rolsuper, rolbypassrls
FROM pg_roles
WHERE rolname IN ('postgres', 'service_role', 'anon', 'authenticated');

-- ── BƯỚC 2: bật RLS ──
-- ALTER TABLE cần khóa ACCESS EXCLUSIVE trong tích tắc. lock_timeout 3s để
-- bảng đang bận (Order, OrderItem...) không làm nghẽn hàng đợi truy vấn:
-- bảng nào không lấy được khóa thì bỏ qua + in NOTICE, chạy lại bước này
-- vài phút sau là xong phần còn lại.
DO $$
DECLARE
  t record;
  ok int := 0;
  skipped int := 0;
BEGIN
  SET LOCAL lock_timeout = '3s';
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
    ORDER BY 1
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
      ok := ok + 1;
    EXCEPTION WHEN lock_not_available THEN
      skipped := skipped + 1;
      RAISE NOTICE 'Bo qua (bang dang ban): %', t.relname;
    END;
  END LOOP;
  RAISE NOTICE 'Da bat RLS: % bang, bo qua: % bang', ok, skipped;
END $$;

-- ── BƯỚC 3 (chỉ đọc): kiểm lại ──
-- 3a. Kỳ vọng: 0 dòng.
SELECT c.relname AS bang_chua_bat
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
ORDER BY 1;

-- 3b. Kỳ vọng: 0 dòng (không bảng nào bị FORCE).
SELECT c.relname AS bang_bi_force
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relforcerowsecurity;

-- ── HOÀN TÁC (chỉ khi app lỗi đọc/ghi ngay sau bước 2) ──
-- ALTER TABLE public."<TênBảng>" DISABLE ROW LEVEL SECURITY;

-- ── GHI NHỚ CHO BẢNG MỚI ──
-- Từ nay mọi đợt CREATE TABLE chạy tay trên Supabase phải kèm dòng:
--   ALTER TABLE "<bảng mới>" ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- SỔ CÁI ĐƠN — chỉ mục cho DANH SÁCH Lãi/Lỗ thực hiện đọc từ sổ
-- (docs/SO-CAI-DON.md mục 9.3). Thiết kế theo mô hình SHOP LỚN ngay từ đầu
-- (anh Trung chốt 30/09/2026: "làm theo mô hình shop lớn luôn sau đỡ phải sửa"):
--   1. Tìm MÃ ĐƠN kiểu "chứa chuỗi" (ILIKE '%…%'): chỉ mục GIN trigram trên
--      "orderCode" — shop vài trăm nghìn đơn/tháng không phải quét cả kỳ.
--   2. Danh sách mới nhất trước + phân trang/con trỏ: chỉ mục
--      ("ownerId", "createdAt" DESC, "orderId" DESC) — trang đầu là một lượt
--      đọc chỉ mục có LIMIT, không phải sắp xếp cả kỳ; xuất Excel đọc theo con
--      trỏ (createdAt, orderId) nên mỗi trang đều rẻ như trang đầu.
-- Chỉ đụng bảng "order_ledger" (không đụng "Order") — không lặp lại kiểu
-- deadlock của migration 20260930230000. Tạo chỉ mục trên bảng cha phân mảnh
-- tự áp cho MỌI mảnh hiện có và mảnh tạo sau (order_ledger_ensure_partitions).
-- Prod 30/09/2026: 42.000 dòng → dựng hai chỉ mục dưới một giây.
-- ============================================================

-- ---------- 0. Extension pg_trgm ----------
-- Supabase để extension trong schema "extensions" (đã kiểm prod 30/09/2026:
-- pg_trgm 1.6 có sẵn, chưa cài; Postgres 17.6). DB dev thuần Postgres không có
-- schema đó → cài vào schema mặc định.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
      CREATE EXTENSION pg_trgm WITH SCHEMA extensions;
    ELSE
      CREATE EXTENSION pg_trgm;
    END IF;
  END IF;
END $$;

-- ---------- 1. Lấy khóa bảng sổ TRƯỚC, có thử lại ----------
-- CREATE INDEX (không CONCURRENTLY — bảng phân mảnh không cho) cần khóa SHARE
-- trên bảng cha và mọi mảnh: chặn GHI vào sổ trong lúc dựng (trigger đánh dấu
-- của đơn + worker sổ cái chờ vài trăm ms), không chặn đọc. Mọi nơi ghi đều đi
-- qua bảng cha nên xin khóa cha trước là không thể kẹt vòng; vẫn bọc thử lại
-- như migration trước cho chắc.
DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "order_ledger" IN SHARE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'order_ledger_list_indexes: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

-- ---------- 2. Chỉ mục tìm mã đơn (GIN trigram) ----------
-- Gọi lớp toán tử KÈM TÊN SCHEMA của extension để không phụ thuộc search_path
-- của kết nối chạy migration.
DO $$
DECLARE
  ext_schema TEXT;
BEGIN
  SELECT n.nspname INTO ext_schema
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pg_trgm';
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS "order_ledger_orderCode_trgm_idx" ON "order_ledger" USING gin ("orderCode" %I.gin_trgm_ops)',
    ext_schema
  );
END $$;

-- ---------- 3. Chỉ mục danh sách mới nhất trước ----------
CREATE INDEX IF NOT EXISTS "order_ledger_ownerId_createdAt_idx"
  ON "order_ledger" ("ownerId", "createdAt" DESC, "orderId" DESC);

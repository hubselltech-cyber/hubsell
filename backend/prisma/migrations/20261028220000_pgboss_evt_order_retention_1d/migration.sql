-- ============================================================
-- Hàng đợi bền: evt.order giữ việc đã xong 1 NGÀY (thay 7 ngày) + chỉ mục việc
-- đang chạy trên bảng riêng. Anh Trung chốt 28/10/2026 sau sự cố Supabase cạn
-- Disk IO (07:40 cùng ngày): ba câu giám sát của pg-boss (thống kê hàng đợi,
-- failJobsByTimeout, failJobsByHeartbeat) mỗi phút quét CẢ bảng riêng của
-- evt.order (~372k việc completed 7 ngày, 141 MB) — Micro 1 GB RAM không chứa
-- nổi nên đọc thẳng đĩa, cạn burst. Chi tiết PROGRESS "Phiên 28/10/2026 (21:00)".
--
-- 1. deletion_seconds 604800 → 86400 trên pgboss.queue: pg-boss CHÉP giá trị này
--    vào từng dòng lúc ghi, nên câu này chỉ áp việc ghi SAU. Dòng đã có trong
--    1 ngày gần nhất sửa kèm ở mục 2 để cùng lứa dọn; dòng cũ hơn do script xóa
--    theo lô (backend/prisma/manual-migrations/20261028-pgboss-evt-order-trim.sql) rồi VACUUM FULL.
--    Không chỗ nào trong mã đọc việc completed cũ hơn 1 ngày (tra 28/10):
--    queueStats đọc cột đếm sẵn ở pgboss.queue, HQ Hàng đợi bền chỉ ready+active,
--    hasLiveJob chỉ cần việc sống; nguồn tra soát là webhook_events (7/30 ngày).
-- 2. Chỉ mục (name) WHERE state='active' trên bảng riêng: hai câu fail* lọc
--    `state='active' AND name=ANY(...)` không dùng được chỉ mục i3 của pg-boss
--    (kèm policy='stately', planner không suy ra được) → Seq Scan. Chỉ mục này
--    gần như rỗng (vài việc đang chạy) nên câu fail* về index scan.
-- Tên bảng riêng = 'j' || sha224('evt.order') (pg-boss job_table_format), 57 ký tự;
-- tên chỉ mục phải ≤ 63 ký tự (Postgres cắt im lặng) → hậu tố ngắn '_hs'.
-- Lùi: UPDATE pgboss.queue SET deletion_seconds = 604800 WHERE name = 'evt.order';
--      DROP INDEX pgboss.<bảng>_hs; dòng đã dọn không ai cần.
-- ============================================================

UPDATE pgboss.queue SET deletion_seconds = 86400 WHERE name = 'evt.order';

DO $$
DECLARE
  tbl text := 'j' || encode(sha224('evt.order'::bytea), 'hex');
BEGIN
  IF to_regclass(format('pgboss.%I', tbl)) IS NULL THEN
    RAISE NOTICE 'pgboss: chưa có bảng riêng của evt.order (%), bỏ qua', tbl;
    RETURN;
  END IF;
  -- Việc đã xong trong 1 ngày gần nhất: hạ hạn dọn cho khớp cấu hình mới (ít dòng,
  -- khóa dòng). Dòng cũ hơn KHÔNG đụng ở đây (xóa theo lô ngoài migration).
  EXECUTE format(
    'UPDATE pgboss.%I SET deletion_seconds = 86400 WHERE state > ''active'' AND deletion_seconds > 86400 AND completed_on >= now() - interval ''1 day''',
    tbl
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON pgboss.%I (name) WHERE state = ''active''',
    tbl || '_hs',
    tbl
  );
END $$;

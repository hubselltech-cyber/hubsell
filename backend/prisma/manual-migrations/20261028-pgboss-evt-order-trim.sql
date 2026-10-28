-- Dọn một lần việc evt.order đã xong quá 1 ngày (28/10/2026, anh Trung chốt giữ
-- 1 ngày). Chạy TAY trên Supabase SQL Editor, từng câu một; KHÔNG nằm trong
-- migration vì ~320k dòng + VACUUM FULL cần giờ vắng (03:00 VN).
--
-- Bảng riêng của evt.order = pgboss.jf7f793055395996304890f5fa2ce60820a708198258bb4b03c608404
-- (= 'j' || sha224('evt.order')). Kiểm trước:
--   select count(*) from pgboss.jf7f793055395996304890f5fa2ce60820a708198258bb4b03c608404
--   where state = 'completed' and completed_on < now() - interval '1 day';
--
-- Bước 1 — xóa theo lô 50.000 dòng (chỉ khóa dòng đã xong, không ai đụng; ~2–4 s/lô).
-- Chạy lại câu này tới khi "0 rows affected".
DELETE FROM pgboss.jf7f793055395996304890f5fa2ce60820a708198258bb4b03c608404
WHERE ctid IN (
  SELECT ctid FROM pgboss.jf7f793055395996304890f5fa2ce60820a708198258bb4b03c608404
  WHERE name = 'evt.order' AND state > 'active'
    AND completed_on < now() - interval '1 day'
  LIMIT 50000
);

-- Bước 2 — thu dọn ngay (không khóa bảng): trang trống được đánh dấu, chỉ mục gọn lại.
VACUUM (ANALYZE) pgboss.jf7f793055395996304890f5fa2ce60820a708198258bb4b03c608404;

-- Bước 3 — 03:00 VN (vắng webhook): co file vật lý. ACCESS EXCLUSIVE ~10–30 s:
-- webhook enqueue + worker complete chờ, sàn tự gửi lại nếu quá hạn. Không co thì
-- seq scan của pg-boss vẫn đọc đủ 141 MB trang trống (VACUUM thường chỉ cắt đuôi file).
VACUUM FULL pgboss.jf7f793055395996304890f5fa2ce60820a708198258bb4b03c608404;

-- Kiểm sau: heap phải còn ~20–45 MB
--   select pg_size_pretty(pg_relation_size('pgboss.jf7f793055395996304890f5fa2ce60820a708198258bb4b03c608404'));

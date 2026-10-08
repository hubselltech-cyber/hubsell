-- ============================================================
-- BẬT LISTEN/NOTIFY CHO CÁC HÀNG ĐỢI WORKER ĐANG NHẬN (08/10/2026)
--
-- Vì sao: Render tính băng thông worker gửi lên Supabase; hỏi việc lúc trống
-- tốn 55 MB/giờ (docs/HANG-DOI-BEN.md mục 3.5). Có cờ notify, lệnh gửi việc
-- phát pg_notify ngay trong giao dịch ghi việc; worker (useListenNotify) được
-- đánh thức ngay và chỉ hỏi việc làm lưới đỡ 30 giây một lần. Đo local: 6,4 MB/giờ.
--
-- Chỉ sửa 6 dòng cấu hình trong pgboss.queue (khóa dòng, không khóa bảng việc).
-- Worker bản cũ (chưa nghe) gặp cờ này vẫn chạy như trước: NOTIFY không ai nghe
-- là vô hại. Đường lui: QUEUE_LISTEN_NOTIFY=off ở worker, hoặc UPDATE ... notify = false.
-- Không đụng bảng "Order" hay bảng nghiệp vụ nào (bẫy deadlock migration 20260930230000).
-- ============================================================
BEGIN;
SET LOCAL lock_timeout = 10000;
SET LOCAL idle_in_transaction_session_timeout = 30000;

UPDATE pgboss.queue
SET notify = true, updated_on = pgboss.job_now()
WHERE name IN ('evt.order', 'evt.auth', 'evt.dead', 'stock.channel', 'stock.verify', 'invoice.issue')
  AND notify IS DISTINCT FROM true;

COMMIT;

-- Nhật ký vận hành kèm mã đơn (09/10/2026): cột JSON có cấu trúc đi cạnh dòng chữ
-- ({refs, refTotal, href, label}) để giao diện in chip mã đơn + nút sao chép.
-- Cột rỗng, bảng nhỏ (log-cleanup giữ 90 ngày) → ALTER tức thì, không đụng Order.
ALTER TABLE "OpsActivity" ADD COLUMN IF NOT EXISTS "meta" JSONB;

-- Bộ đếm sự kiện landing theo ngày (17/10/2026 — anh Trung: "thêm lượt đếm, nhỏ
-- thôi để mình quan sát"). Đo trang công cụ hubsell.vn/tinh-roas-hoa-von:
-- lượt mở trang và lượt bấm "Đăng nhập để tính bằng đơn thật".
-- Một dòng / ngày (giờ VN) / sự kiện, cộng dồn bằng INSERT ... ON CONFLICT —
-- không lưu IP, không lưu người, không phình theo lượt truy cập.
-- Bảng mới, không đụng bảng cũ → không cần khóa có thử lại.
CREATE TABLE IF NOT EXISTS "landing_event_daily" (
  "day"   DATE    NOT NULL,
  "event" TEXT    NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "landing_event_daily_pkey" PRIMARY KEY ("day", "event")
);
ALTER TABLE "landing_event_daily" ENABLE ROW LEVEL SECURITY;

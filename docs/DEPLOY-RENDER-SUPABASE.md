# Deploy backend Hubsell lên Render + Supabase (Free) — test webhook MISA bằng HTTPS thật

Mục tiêu: có URL `https://<app>.onrender.com/v1/webhooks/misa-meinvoice` công khai,
chạy thật 24/7, khai thẳng vào trang quản trị MISA meInvoice Sandbox — không cần
ngrok/tunnel gì ở local.

## Bước 1 — Tạo database trên Supabase

1. Đăng ký https://supabase.com (free) → **New project** → đặt tên `hubsell`,
   chọn region gần (Singapore), đặt **Database Password** (lưu lại!).
2. Vào **Connect** (nút trên đầu trang) → tab **ORMs / Prisma** → copy chuỗi
   **Session pooler** (cổng **5432** — hợp với Prisma; đừng lấy Transaction
   pooler cổng 6543):
   ```
   postgresql://postgres.<ref>:<MẬT_KHẨU>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
   ```
3. Thêm đuôi `?sslmode=require` vào cuối chuỗi — cloud bắt buộc SSL.
4. Tạo bảng: **không cần làm gì** nếu theo Bước 2 (Render tự chạy
   `prisma migrate deploy` lúc khởi động). Muốn tạo tay thì dán
   `backend/prisma/supabase-schema.sql` vào Supabase → **SQL Editor** → Run
   (chỉ trên database rỗng).

## Bước 2 — Deploy backend lên Render

1. Đăng ký https://render.com (free) → **New → Blueprint** → kết nối repo
   Hubsell. Render tự đọc `render.yaml` ở gốc repo.
2. Render hỏi các biến `sync: false` — điền:
   | Biến | Giá trị |
   |---|---|
   | `DATABASE_URL` | chuỗi Supabase Bước 1 (có `?sslmode=require`) |
   | `MISA_CLIENT_ID` / `MISA_CLIENT_SECRET` | cặp khóa MISA cấp |
   | `MISA_WEBHOOK_SECRET` | secret ký webhook MISA cấp — **bắt buộc**, thiếu là endpoint trả 503 (xem lưu ý dưới) |
   | `APP_FRONTEND_URL` | `https://localhost:3000` (frontend vẫn chạy local) |
3. Bấm **Apply** — Render build (`npm ci` + `prisma generate` + `tsc`), chạy
   migration lên Supabase rồi start. Log thấy
   `✅ Hubsell backend đang chạy tại http://localhost:<port>` là xong (Render
   lo phần HTTPS bên ngoài).
4. Kiểm tra sống: mở `https://<app>.onrender.com/health`.
5. Bắn thử webhook xuyên cloud bằng script có sẵn (chạy ở máy local, `--url`
   trỏ lên Render — DB lúc này là Supabase nên cần seed/tạo đơn trước nếu muốn
   case khớp thuế):
   ```bash
   cd backend
   npx tsx scripts/simulate-misa-webhook.ts case1 --url https://<app>.onrender.com/v1/webhooks/misa-meinvoice --no-wait
   ```

### Lưu ý riêng gói Free của Render

- **Ngủ sau ~15 phút không có traffic**, request kế tiếp mất ~30–60s đánh thức.
  Webhook MISA bắn lúc service đang ngủ có thể quá hạn ack 3s lần đầu — MISA sẽ
  retry, và hàng đợi bền + idempotency của mình nuốt bản retry an toàn. Muốn
  triệt để thì dùng cron ping `/health` mỗi 10 phút (vd cron-job.org, free).
- Worker hàng đợi chạy CHUNG process web (thiết kế sẵn như vậy) — không cần
  Background Worker riêng (gói free của Render không có loại này).
- `MISA_WEBHOOK_SECRET`: nếu sandbox MISA **không cấp** secret ký webhook thì
  tạm đặt `NODE_ENV=development` trên Render để tắt kiểm tra (chấp nhận rủi ro
  môi trường test), hoặc giữ production và chờ MISA cấp — code đã sẵn cả hai.

## Bước 3 — Khai URL webhook vào trang quản trị MISA Sandbox

1. Đăng nhập trang quản trị meInvoice Sandbox (tài khoản MISA cấp kèm kit).
2. **Thiết lập → Tích hợp/Kết nối API → Webhook / URL nhận thông báo**, dán:
   ```
   https://<app>.onrender.com/v1/webhooks/misa-meinvoice
   ```
3. Chọn nhận đủ sự kiện hóa đơn (ký số/phát hành, hủy, thay thế). Có nút
   "Kiểm tra kết nối" thì bấm — endpoint ack cả sự kiện lạ bằng 200 nên pass.
4. MISA cấp secret ký webhook ở màn hình này thì cập nhật env
   `MISA_WEBHOOK_SECRET` trên Render (Environment → Edit) — service tự restart.

## Đối chiếu khi có sự kiện thật đổ về

- Mọi request nằm trong bảng `misa_webhook_logs` (kể cả xử lý lỗi — retry
  3 lần × 5 phút rồi mới FAILED): xem nhanh bằng Supabase → **Table Editor**.
- Kết quả nghiệp vụ: `InvoiceLog` (trạng thái + số hóa đơn + thuế đã đối soát),
  `InvoiceStatusHistory` (audit từng lần đổi trạng thái, ghi chú đối soát thuế),
  `Order.einvoiceStatus`.
- Payload thật của MISA có thể lệch tên trường so với hợp đồng dự phóng — sửa
  MỘT chỗ `backend/src/integrations/invoice/misa-webhook.ts` (kiểu +
  validate + bảng map sự kiện), service không phải đổi.

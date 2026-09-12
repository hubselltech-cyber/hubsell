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

## Bước 2b — Tách worker nền ra service riêng (HUBSELL_ROLE, từ 12/09/2026)

Backend có 3 vai, chọn bằng env `HUBSELL_ROLE`:

| Vai | Chạy gì | Dùng khi |
|---|---|---|
| `all` (mặc định) | API + SSE + toàn bộ worker nền trong MỘT tiến trình | Hôm nay (1 service web), local dev |
| `web` | Chỉ API + SSE. Webhook chỉ **enqueue** vào hàng đợi DB | Khi đã có service worker riêng |
| `worker` | Chỉ worker nền, KHÔNG mở cổng HTTP | Render **Background Worker** |

Vì sao tách: deploy/restart web không cắt ngang lượt quét sàn; lượt quét nặng
không làm API của seller chậm; scale worker độc lập. Mọi hàng đợi (webhook
Shopee/MISA, đẩy tồn, cứu đơn, lịch quét theo gian) đều bền trong DB và claim
bằng UPDATE có điều kiện → chạy 2 worker song song vẫn không xử lý trùng.
Refresh token 3 sàn khóa bằng `pg_advisory_xact_lock` theo gian (lib/db-lock.ts)
nên nhiều tiến trình không đua rotate refresh_token.

Thứ tự lên (không gián đoạn seller):

1. Dashboard → **New → Background Worker** → repo này, `rootDir` = `backend`,
   region Singapore, build/start giống service web (mẫu trong `render.yaml`,
   service `hubsell-worker-sg`). Background Worker **không có gói free**.
2. Copy TOÀN BỘ env từ `hubsell-backend-sg` sang worker (DB, sàn, MISA,
   APP_FRONTEND_URL...) rồi thêm `HUBSELL_ROLE=worker`.
3. Xem log worker có `[Role] Tiến trình chạy vai "worker"` + `[Auto-sync] BẬT`
   + các dòng `[Auto-sync] ...` theo gian.
4. Lúc đó mới đặt `HUBSELL_ROLE=web` trên service web (web ngừng chạy worker
   trùng). Chuông SSE vẫn gần real-time nhờ cầu DB→SSE 10s trong web
   (services/notifications.ts).

Biến chỉnh nhịp worker quét sàn (workers/order-auto-sync.ts):

| Env | Mặc định | Ý nghĩa |
|---|---|---|
| `AUTO_SYNC_MINUTES` | 10 | Nhịp gốc tầng NHANH (đơn/hoàn/cứu đơn); `0` = tắt |
| `AUTO_SYNC_MAX_MINUTES` | 60 | Trần giãn nhịp cho gian im ắng (×2 mỗi lượt không biến động) |
| `AUTO_SYNC_CONCURRENCY` | 3 | Số gian xử lý song song trong một worker |
| `ADS_SYNC_HOURS` | 24 | Nhịp tầng ADS (chi phí + campaign + Trợ lý); trang Ads mở mà số cũ >30' tự nudge |

Local: PowerShell `$env:HUBSELL_ROLE="worker"; npm run dev` chạy riêng worker;
không đặt gì = `all` như trước.

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

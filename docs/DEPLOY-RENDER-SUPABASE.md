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
| `ADS_PULSE_MINUTES` | 30 | XUNG ads Shopee: cấu hình + số hôm nay + ví cho gian đang chi → độ trễ cảnh báo cắn tiền |
| `ADS_PULSE_LAZADA_MINUTES` | 60 | XUNG ads Lazada (tới khi có quota app ISV) |
| `ADS_SYNC_HOURS` | 6 | Tầng LỊCH SỬ ads: kéo lại 7 ngày cho số sàn chỉnh muộn |
| `ADS_APP_QPS` | 3 | Trần call/giây mỗi app cho Ads API (token bucket + cầu dao DB) |

Local: PowerShell `$env:HUBSELL_ROLE="worker"; npm run dev` chạy riêng worker;
không đặt gì = `all` như trước.

**22/09/2026 — anh Trung chốt LÀM bước này** (sau sự cố OOM bên dưới): việc
cần tay anh trên Dashboard là mục 1–2 (tạo Background Worker, gói Starter,
copy env); mục 3–4 kiểm tra log rồi đổi `HUBSELL_ROLE=web` trên service web.
Cờ heap trong `npm start` áp cho cả hai service vì dùng chung script.

## Bước 2c — Bộ nhớ tiến trình (sự cố OOM 19–22/09/2026)

**Chuyện đã xảy ra:** Render ghi "Instance failed: exited with status 134"
5 lần trong 4 ngày (19/09 21:45, 21:47, 22:34; 20/09 21:16; 22/09 10:10), log
cùng giây `FATAL ERROR: Reached heap limit … JavaScript heap out of memory`.
Biểu đồ RAM container chỉ 40–55% của 512 MB lúc chết → V8 tự đặt heap limit
theo "RAM máy / 4", thấp hơn nhiều RAM gói. Khách mở app đúng lúc khởi động
lại (10–20 giây) thấy câu lỗi dev "backend đang chạy ở cổng 4000".

**Đã sửa (commit 22/09):**

1. `backend/package.json` → `start` chạy
   `node --max-old-space-size=${NODE_HEAP_MB:-320} --max-semi-space-size=16 dist/index.js`.
   Căn cứ số: gói Starter 512 MB; RSS ngoài heap đo trên Render 23/09 ≈ 90 MB
   (engine Prisma, mã, buffer); young gen chốt 16 MB × 3 = 48 MB → 320 + 48 + 90
   ≈ 460 là trần xấu nhất. **Nâng gói RAM thì chỉ đặt env `NODE_HEAP_MB`** trên
   Dashboard (Standard 2 GB → 1536), không sửa code. KHÔNG đặt NODE_OPTIONS —
   cờ dòng lệnh đè NODE_OPTIONS.

   **23/09 anh Trung chốt: CHƯA tách worker, CHƯA nâng gói** — đợi nhiều khách
   rồi nâng gói (Standard 2 GB, 25 USD) trước, tách worker sau khi tải thật tăng.
   Service hubsell-worker-sg tạo thử 23/09 đã XÓA để khỏi tính tiền.
2. `lib/memory-watch.ts`: log lúc boot `[Bộ nhớ] Khởi động: heap X/Y MB, RSS Z MB`
   (Y phải ≈ 368 = 320 + 48 — nếu không, cờ chưa ăn); lấy mẫu 5 giây, vượt 70%
   / 85% heap ghi một dòng cảnh báo kèm RSS (chỉ ghi lại sau khi hạ dưới 60%);
   mốc nền mỗi 30 phút. Đọc log theo mốc thời gian để dò việc nào gây đỉnh.
   Env: `MEMORY_WATCH_SECONDS=0` tắt, `MEMORY_WATCH_WARN_PCT` / `_CRIT_PCT` đổi ngưỡng.
3. Ba chỗ từng giữ hàng nghìn/chục nghìn đơn kèm include nặng trong một mảng
   chuyển sang đọc theo trang 1.000 đơn rồi rút ngay thành dòng gọn
   (`forEachPnlOrderPage` trong routes/finance.ts): hòa vốn Ads TikTok
   (integrations/tiktok-ads/breakeven.ts — chạy MỖI lần mở trang Quảng cáo
   TikTok, 60 ngày, trần 8.000 đơn), tờ khai thuế (services/tax-declaration.ts —
   cả năm toàn shop, trần 20.000), và backfill bản kê TikTok
   (integrations/tiktok/service.ts — ghi theo từng cửa sổ 30 ngày, đơn gặp lại
   ở cửa sổ sau thì kéo lại bản kê đã ghi để cộng chung, số y hệt cách gom cũ).
4. Frontend: câu lỗi mất kết nối viết cho khách + tự gọi lại mỗi 8 giây
   (lib/use-api-query.ts), React Query thử lại 3 lần giãn 1s → 2s → 4s cho lỗi
   mạng / 5xx (components/shell/query-provider.tsx).

**Khi thấy lại status 134:** Logs → tìm `heap` (dòng FATAL) rồi `[Bộ nhớ]`
(dòng cảnh báo ngay trước đó nói heap đang bao nhiêu và RSS) → đối chiếu việc
đang chạy cùng phút. Không có dòng `[Bộ nhớ]` nào trước FATAL nghĩa là tăng vọt
trong < 5 giây — nghi một request đơn lẻ (báo cáo khoảng rộng, export).

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

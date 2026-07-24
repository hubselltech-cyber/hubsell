# TIẾN ĐỘ PHÁT TRIỂN — HUBSELL

> File ghi nhận tiến độ theo từng phiên làm việc, giữ ngữ cảnh cho các phiên sau.
> Log nghiệp vụ chi tiết (checklist Done/Todo) nằm ở [TODO.md](TODO.md); kiến trúc & hướng dẫn ở [README.md](README.md).

---

## Phiên 24/07/2026 (6) — Chuẩn hoá endpoint OAuth + chẩn đoán lỗi khu vực

### Bối cảnh
Bấm uỷ quyền TikTok báo *"Không khả dụng tại khu vực của cửa hàng bạn"*. Điều tra qua nhiều bước để tách lỗi code vs lỗi cấu hình tài khoản.

### Kết quả chẩn đoán (quan trọng cho phiên sau)
- **KHÔNG phải lỗi code.** Bằng chứng từ URL uỷ quyền thật:
  `seller-vn.tiktok.com/services/market/custom-authorize/{service_id}?is_draft=true&region_check=1&shop_region=VN&target_countries=...country_vietnam_selection&...`
  → request tới đúng trang VN, `shop_region=VN` nhận đúng, `target_countries` CÓ Vietnam.
- **Nút thắt thật (ảnh Partner Center):** app "Hubsell" (Bản nháp, Tùy chỉnh, người bán VN) — mục **Người bán mục tiêu → Việt Nam** hiện *"Vui lòng hoàn thiện biểu mẫu đăng ký đối tác — Cần hoàn tất"*; checklist *"Xét duyệt đăng ký đối tác"* chưa xong. → Thị trường VN chưa kích hoạt nên shop bị chặn.
- **Chặn ở phía TikTok:** tài khoản Partner Center kẹt ở **xét duyệt Doanh nghiệp**. Kế hoạch của chủ shop: tạo tài khoản Partner Center **Cá nhân (Individual)** bằng email khác, gửi duyệt lại. Khi có app mới → **chỉ thay `TIKTOK_APP_KEY`/`TIKTOK_APP_SECRET`/`TIKTOK_SERVICE_ID` trong `.env`**, KHÔNG cần sửa code.

### Đã hoàn thành (code) ✅
- Chuẩn hoá `buildAuthorizeUrl` về hệ Custom App nội địa: `services.tiktokshop.com/open/authorize` + `service_id` + **`app_type=custom`**. (Đã thử `auth.tiktok-shops.com/oauth/authorize`+`app_key` — không hợp, đã revert.)
- Sửa comment trong `config.ts` cho đúng thực tế (lỗi khu vực do `target_countries`/đăng ký đối tác ở Partner Center, không phải tham số URL).
- `tsc` sạch. Không file tạm. Servers dev đã tắt.

### Trạng thái
🔒 **Code luồng OAuth coi như hoàn thiện & ổn định** — đóng băng phần code TikTok, chờ tài khoản Partner Center mới được duyệt. Toàn bộ luồng (OAuth → đồng bộ đơn/đối soát → webhook) đã dựng xong từ các phiên trước, chỉ chờ app "sống" để test thật.

### Việc cần làm khi app mới được duyệt 🔜
1. Thay 3 biến TikTok trong `backend/.env`, khởi động lại backend.
2. Chạy `dev-https.sh` (hoặc để Claude boot) → bấm Kết nối TikTok chạy OAuth end-to-end.
3. Test đồng bộ đơn/đối soát; dựng tunnel để nghiệm thu webhook trừ/hoàn kho.

---

## Phiên 24/07/2026 (5) — Tự động hóa boot môi trường test HTTPS

### Mục tiêu
Một lệnh duy nhất: tắt tiến trình cũ, boot Backend+Frontend HTTPS, phơi tunnel (nếu có), in link để click test ngay.

### Đã hoàn thành ✅
- **Sửa `scripts/gen-certs.sh`** — lỗi `MSYS_NO_PATHCONV` + đường dẫn tuyệt đối khiến openssl-Windows không mở được file. Fix: `cd ROOT` + dùng đường dẫn tương đối `certs/...`. Đã chạy lại, cert mới, cặp key/cert khớp (verify modulus md5).
- **`scripts/dev-https.sh`** (bash thuần, zero-install vì máy không có concurrency/tunnel tool):
  1. `kill_port` tắt tiến trình LISTENING trên 4000/3000 (netstat + `taskkill /F /PID`, `MSYS_NO_PATHCONV`).
  2. Tự tạo cert nếu thiếu.
  3. Boot backend (`npm run dev` → HTTPS) + frontend (`npm run dev:https`) song song, log ra `.dev-logs/`.
  4. `wait_url` chờ cả hai `curl -sk` sẵn sàng.
  5. Tunnel best-effort: dùng cloudflared/ngrok/lt NẾU có (parse URL public), không có thì bỏ qua + hướng dẫn.
  6. In hộp link (Frontend/Backend/Callback/Tunnel/Webhook). `trap cleanup INT TERM` (có guard `CLEANED`) tắt sạch khi Ctrl+C.
- **`start-https.bat`** — wrapper double-click gọi `bash scripts/dev-https.sh`.
- **`.gitignore`** thêm `.dev-logs/`. README thêm mục "MỘT lệnh" + hướng dẫn cài cloudflared.

### Kiểm chứng
- Chạy thật launcher có `timeout 95s`: tắt PID cũ 21404 (:4000) → backend HTTPS lên → **frontend Next 16 `dev:https` Ready in 390ms, phục vụ `GET / 200`** → health cả hai qua → tunnel skip gọn → in hộp link → Ctrl+C(SIGTERM) dọn sạch, ports 4000/3000 FREE lại. ✅
- `bash -n` cả hai script sạch. tsc không đổi (chỉ script/docs).

### Môi trường hiện tại ⚠️
- **Chưa cài** ngrok/cloudflared/localtunnel → bước tunnel bị bỏ qua; webhook thật cần cài 1 tool (khuyến nghị cloudflared) rồi chạy lại.
- Server cũ trên :4000 đã bị launcher tắt; hiện KHÔNG có server nào chạy — anh chạy `bash scripts/dev-https.sh` để bật lại.

### Việc cần làm phiên sau 🔜
1. Cài cloudflared → chạy `dev-https.sh` → lấy URL tunnel khai webhook lên Partner Center.
2. Bấm Kết nối TikTok chạy OAuth end-to-end; tạo đơn test nghiệm thu webhook trừ/hoàn kho.

---

## Phiên 24/07/2026 (4) — Cấu hình HTTPS local để test OAuth/webhook

### Mục tiêu
Dựng môi trường HTTPS ở local cho khớp Redirect URL của TikTok (https) và tránh mixed-content khi trang callback https gọi API.

### Đã hoàn thành ✅
- **Cert tự ký** — `scripts/gen-certs.sh` (OpenSSL, xử lý `MSYS_NO_PATHCONV` cho Git Bash) sinh `certs/localhost-key.pem` + `certs/localhost.pem`, SAN `localhost` + `127.0.0.1`, hạn 2028. Đã tạo cert. `certs/` đã vào `.gitignore` (không commit khóa riêng).
- **Backend HTTPS có điều kiện** — `src/index.ts`: có `SSL_KEY_FILE` + `SSL_CERT_FILE` (trỏ tới file tồn tại) → `https.createServer`; thiếu → fallback HTTP (không phá luồng cũ). `backend/.env` + `.env.example` thêm 2 biến (trỏ `../certs/...`).
- **Frontend HTTPS** — thêm script `dev:https` (`next dev --experimental-https --experimental-https-key/cert` dùng chung cert). `.env.local` đổi `NEXT_PUBLIC_API_URL=https://localhost:4000` (kèm hướng dẫn quay lại http).
- **README** — thêm mục "🔒 Chạy HTTPS ở local" (tạo cert, chạy 2 phía https, tin cert tự ký, quay lại http, và lưu ý webhook thật cần tunnel).

### Kiểm chứng
- Backend HTTPS boot (port 4101): `curl -k https://…/health` OK; HTTP bị từ chối trên cổng HTTPS. ✅
- Fallback: SSL_* trỏ file không tồn tại → chạy HTTP + cảnh báo, không crash. ✅ (Boot HTTPS thành công cũng chứng minh cặp key/cert hợp lệ để Node/Next TLS nạp.)
- `tsc` backend + frontend: sạch ✅.

### Lưu ý vận hành ⚠️
- Cert **tự ký** → trình duyệt cảnh báo; phải mở `https://localhost:4000/health` và `https://localhost:3000` mỗi cổng một lần bấm "vẫn tiếp tục" để tin cert.
- **Webhook thật cần tunnel** (ngrok/cloudflared) vì TikTok không tới được `localhost`; HTTPS local chỉ phục vụ luồng OAuth callback (chạy trong trình duyệt người dùng).
- Server backend cũ trên :4000 (từ phiên trước) vẫn cần **khởi động lại** để nạp code HTTPS + webhook.

### Việc cần làm phiên sau 🔜
1. Chạy `gen-certs` → backend `npm run dev` (https) → frontend `npm run dev:https`, tin cert, bấm Kết nối TikTok để chạy OAuth end-to-end thật.
2. Dựng tunnel + khai webhook URL trên Partner Center, tạo đơn test nghiệm thu trừ/hoàn kho.

---

## Phiên 24/07/2026 (3) — Webhook TikTok real-time + tự động trừ kho

### Mục tiêu
Nhận webhook TikTok khi đơn đổi trạng thái, xác thực chữ ký, upsert đơn và tự động trừ/hoàn kho theo thời gian thực (idempotent).

### Đã hoàn thành ✅
- **Endpoint** `POST /api/webhooks/tiktok` (công khai, trong `routes/webhooks.ts`) — xử lý event `ORDER_STATUS_CHANGE` (type 1); loại khác ack 200.
- **Verify chữ ký** — `verifyWebhookSignature()` (client.ts): `HMAC-SHA256(app_key + rawBody, app_secret)` so khớp header `Authorization` theo kiểu hằng-thời-gian. Giữ body thô qua `express.json({ verify })` trong `app.ts` (serialize lại là sai chữ ký).
- **Lấy chi tiết đơn** — `getOrderDetail()` (client.ts, GET /order/202309/orders?ids=) vì payload webhook chỉ có order_id + trạng thái.
- **`processTiktokOrderEvent()`** (service.ts) — refactor `upsertOrder` → `upsertOrderTx(tx,…)` để GỘP upsert + tồn kho vào MỘT transaction. Trừ kho khi trạng thái đã chốt (AWAITING_SHIPMENT…COMPLETED), hoàn kho khi CANCELLED.
- **Idempotent tồn kho** — thêm cột `Order.stockDeductedAt` (migration `order_stock_deducted_at`); trừ kho một lần (guard `stockDeductedAt`, `decrement` nguyên tử, cho phép âm = phơi bày bán vượt kho); hoàn kho một lần (guard `stockRestoredAt`, mirror luồng hủy đơn thủ công ở orders.ts). Chỉ trừ dòng đã liên kết SKU (productId != null).
- **`findTiktokChannelByShopId()`** — định danh gian theo `shop_id` trong payload đã ký.

### Kiểm chứng
- Backend `tsc` ✅. Runtime: query `stockDeductedAt` OK; `verifyWebhookSignature` valid→true, tampered/missing→false.
- **Test end-to-end webhook** (instance mới port 4100, ký bằng app_secret thật): chữ ký hợp lệ + shop lạ → 200 ack; thiếu/sai chữ ký → **401**; event type khác → 200 ack. ✅
- **CHƯA test đường trừ/hoàn kho với đơn TikTok thật** (cần shop đã kết nối + đơn thật để `getOrderDetail` trả dữ liệu) — logic mirror luồng mock/hủy đơn đã kiểm chứng, có guard idempotent.
- ⚠️ Server cũ trên :4000 (từ trước) không có code mới & đang giữ DLL (gây EPERM `prisma generate`, vô hại). **Cần khởi động lại dev server backend** để nạp webhook + rawBody.

### Việc cần làm phiên sau 🔜
1. Cấu hình URL webhook trên Partner Center (`https://.../api/webhooks/tiktok`), chạy đơn test thật để nghiệm thu trừ/hoàn kho.
2. Đối chiếu tên trường payload webhook thật (type số, `data.order_id`, `data.order_status`) nếu TikTok đổi.
3. Lịch cron tự đồng bộ; bóc tách chi tiết phí đối soát.

---

## Phiên 24/07/2026 (2) — Đồng bộ dữ liệu thật TikTok Shop

### Mục tiêu
Hoàn thiện luồng kéo dữ liệu thật sau khi đã có OAuth: (1) tự refresh token, (2) `fetchOrders()` ghi thẳng DB, (3) `fetchSettlements()` cập nhật Cash Flow.

### Đã hoàn thành ✅
- **Tự refresh token** — `getValidAccessToken(channel)` (mới, trong `service.ts`): còn <5 phút hết hạn thì gọi `refreshAccessToken()` + lưu token mới xuống DB; `refresh_token` hết hạn → ném lỗi buộc uỷ quyền lại. Được gọi TRƯỚC mọi lượt đồng bộ.
- **`syncTiktokOrders()`** — phân trang `next_page_token`, **upsert idempotent** theo `(channelId, orderCode)`. Thêm migration `order_channel_ordercode_unique` (unique index; đã kiểm tra 0 bản ghi trùng trước khi áp). Map `order_status` TikTok → `ShippingStatus`; gộp `line_items` theo SKU; snapshot `costPriceAtSale` qua `ChannelProduct` mapping. **Cố ý KHÔNG trừ tồn kho** khi đồng bộ lô.
- **`syncTiktokSettlements()`** — kéo `statements` → `statement_transactions`, gom theo `order_id` trong cả lượt chạy rồi GHI ĐÈ (idempotent): cập nhật `isSettled/settledAt/actualPayout/serviceFee`. Bảng Cash Flow & Lãi/Lỗ chạy số thật.
- **`client.ts`**: types mạnh cho `fetchOrders`/`fetchSettlements` + thêm `fetchStatementTransactions()`.
- **2 route** `POST /api/channels/:id/sync-orders` + `/sync-settlements` (chỉ Admin, chỉ gian TikTok đã có `shopCipher`).
- **Frontend**: `syncTiktokOrders`/`syncTiktokSettlements` trong `api.ts`; 2 nút "Đồng bộ đơn" / "Đồng bộ đối soát" trên trang Kênh bán (chỉ hiện với gian TikTok `apiConnected`), có trạng thái loading + toast kết quả.

### Kiểm chứng
- Backend `tsc` ✅, runtime query `channelId_orderCode` chạy được (DB). Frontend `tsc`+`eslint` ✅.
- Backend boot + 2 route sync trả 401 khi chưa auth (route đăng ký đúng).
- **CHƯA test với dữ liệu TikTok thật** (cần OAuth end-to-end qua https). Tên trường payload cần đối chiếu lại khi chạy thật (parser đã defensive).
- ⚠️ `prisma generate` báo EPERM đổi tên DLL engine (do dev server đang giữ file) — **vô hại**: types đã cập nhật, engine cũ vẫn chạy.

### Việc cần làm phiên sau 🔜
1. Chạy OAuth thật → bấm "Đồng bộ đơn"/"Đồng bộ đối soát", **đối chiếu payload** thực tế, chỉnh mapping trạng thái & tên trường nếu lệch.
2. **Trừ tồn kho cho đơn TikTok mới**: webhook "đơn mới" riêng (không dùng đồng bộ lô).
3. **Lịch tự động** (cron) đồng bộ định kỳ thay vì bấm tay.
4. Bóc tách chi tiết từng loại phí khi có nguồn dữ liệu (hiện dồn vào `serviceFee`).

---

## Phiên 24/07/2026 — Kết nối TikTok Shop API (OAuth2)

### Mục tiêu
Thiết lập module tích hợp TikTok Shop thật (App "Dịch vụ tùy chỉnh" trên Partner Center, bản API `202309`): luồng lấy Access Token qua OAuth2 khi bấm kết nối gian hàng, và dựng khung hàm API để chuẩn bị kéo Đơn hàng + Dòng tiền/Đối soát.

### Đã hoàn thành ✅

**Backend**
- **Schema `Channel`** (migration `20260724022413_tiktok_oauth_channel_fields`): thêm `refreshToken`, `accessTokenExpireAt`, `refreshTokenExpireAt`, `shopCipher`, `externalShopName`.
- **`src/integrations/tiktok/config.ts`**: đọc env (`TIKTOK_APP_KEY/SECRET/SERVICE_ID/REDIRECT_URI`), `buildAuthorizeUrl(state)`, `isTikTokConfigured()`, endpoint cố định. Ném lỗi rõ ràng khi thiếu cấu hình.
- **`src/integrations/tiktok/client.ts`**:
  - `signRequest()` — **ký HMAC-SHA256** đúng thuật toán TikTok (loại `sign`/`access_token`, sort key, nối path+params+body, bọc app_secret). Đã smoke-test: hex 64 ký tự, xác định.
  - `getAccessToken(authCode)` / `refreshAccessToken(refreshToken)` — gọi máy chủ auth (không cần ký).
  - `getAuthorizedShops(accessToken)` — lấy danh sách gian + `shop_cipher`.
  - `callApi()` — helper gọi API nghiệp vụ có ký + header `x-tts-access-token`.
  - **KHUNG** `fetchOrders()` / `fetchSettlements()` — đã dựng chữ ký + endpoint, **chưa ghi DB**.
- **`src/routes/channels.ts`**: `GET /api/channels/tiktok/auth-url` + `POST /api/channels/tiktok/callback` (chỉ Admin). Callback đổi token → lấy shop_cipher → upsert `Channel` theo `externalShopId`. `GET /api/channels` đã **lọc bỏ secret** (`refreshToken`/`shopCipher`), thêm cờ `apiConnected`.
- **`.env` / `.env.example`**: thêm 4 khóa TikTok (giá trị thật KHÔNG commit).

**Frontend**
- **`lib/api.ts`**: `getTiktokAuthUrl()`, `tiktokCallback(code)`, type `TiktokConnectedChannel`; `Channel` thêm `apiConnected`/`externalShopName`/`accessTokenExpireAt`.
- **`app/channels/page.tsx`**: nhánh TikTok trong dialog kết nối → gọi auth-url, lưu `state` vào `sessionStorage`, chuyển hướng sang TikTok (ẩn ô nhập tên, nút "Tiếp tục với TikTok").
- **`app/channels/tiktok/callback/page.tsx`** (mới): nhận `?code&state`, đối chiếu state chống CSRF, gọi backend, hiển thị kết quả. Đọc qua `window.location.search` để khỏi cần Suspense (Next 16). Có `useRef` chặn StrictMode gọi 2 lần (auth_code dùng 1 lần).

### Kiểm chứng
- Backend `tsc --noEmit`: ✅ pass. Migration áp thành công.
- Frontend `tsc` + `eslint` các file đổi: ✅ pass.
- Smoke-test module TikTok (sign/authUrl/config throw): ✅ đúng.
- **CHƯA test luồng OAuth end-to-end thật** (cần điền App Key/Secret + chạy https).

### Việc cần làm phiên sau 🔜
1. **Điền `TIKTOK_APP_KEY/SECRET/SERVICE_ID`** vào `backend/.env`, chạy frontend `--experimental-https`, chạy thử uỷ quyền thật bằng shop test.
2. **Tự refresh token**: trước mỗi call API, kiểm tra `accessTokenExpireAt`, gọi `refreshAccessToken()` nếu sắp hết hạn (helper `getValidAccessToken(channel)`).
3. **Nối `fetchOrders()` vào DB**: ánh xạ đơn TikTok → model `Order`/`OrderItem` (thay webhook giả lập).
4. **Nối `fetchSettlements()`**: kéo đối soát thật cắm vào bảng Cash Flow / Lãi-Lỗ Thực Hiện (thay `mockSettlement`).
5. Cân nhắc **mã hoá secret** khi lưu (hiện lưu thô cho môi trường dev).

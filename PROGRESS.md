# TIẾN ĐỘ PHÁT TRIỂN — HUBSELL

> File ghi nhận tiến độ theo từng phiên làm việc, giữ ngữ cảnh cho các phiên sau.
> Log nghiệp vụ chi tiết (checklist Done/Todo) nằm ở [TODO.md](TODO.md); kiến trúc & hướng dẫn ở [README.md](README.md).

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

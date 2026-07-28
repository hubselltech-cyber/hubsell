# TIẾN ĐỘ PHÁT TRIỂN — HUBSELL

> File ghi nhận tiến độ theo từng phiên làm việc, giữ ngữ cảnh cho các phiên sau.
> Log nghiệp vụ chi tiết (checklist Done/Todo) nằm ở [TODO.md](TODO.md); kiến trúc & hướng dẫn ở [README.md](README.md).

---

## Phiên 28/07/2026 (tối) — Trau chuốt trang Giá vốn + sửa tận gốc kết nối Lazada từ local

### Trang Cấu hình Giá vốn (`cost-price-table.tsx`) — 3 commit ec569ef, 1432438
- **Highlight nhóm đang mở**: dòng cha `bg-muted/60` + toàn bộ dòng con `bg-muted/40` nổi thành một khối xám; tên cha tự `font-bold` khi mở làm điểm neo. Gotcha: `TableRow` gốc có `has-aria-expanded:bg-slate-50/80` nằm sau trong stylesheet đè mất màu → phải dùng modifier `!` cục bộ (đo computed style mới phát hiện).
- **Hết khuất nút "Áp dụng"**: bảng auto bị tên phân loại dài (không truncate) kéo tràn ngang 42px → chuyển `table-fixed` + chia lại cột, **Giá vốn đứng TRƯỚC Giá bán** (cột thao tác chính phải luôn thấy), truncate + title cho tên/SKU. Sửa luôn lỗi cũ: dòng cha hiển thị khoảng GIÁ VỐN dưới header "Giá bán" → nay tính đúng khoảng giá bán.
- Badge "Chưa nối kho" → **"Chưa nối kho vật lý"** (chuẩn thuật ngữ); placeholder "Nhập cho tất cả" → "Giá vốn chung" (hết cắt chữ).
- `.claude/launch.json`: frontend thêm `autoPort` để phiên Claude chạy song song không giành cổng 3000 (Next 16 vẫn khoá 2 dev server cùng thư mục — verify qua Chrome thật với server phiên khác + HMR).

### Kết nối Lazada từ app local — trạm trung chuyển code (commit c9cf70b, ĐÃ LIVE Render)
- **Chẩn đoán lỗi người dùng gặp**: callback đăng ký là URL Render; kết nối từ local → state ký secret local, Render verify fail → "Phiên uỷ quyền hết hạn hoặc không hợp lệ"; rồi redirect nhầm default `https://localhost:3000` (sai giao thức → ERR_SSL_PROTOCOL_ERROR). Màn đen Render chỉ là free tier thức dậy, vô hại.
- **Fix**: state mang thêm `fe` (APP_FRONTEND_URL môi trường ký). Callback Render `jwt.decode` không verify, thấy origin localhost (regex chặt, chống open-redirect) khác FE của nó → 302 nguyên code về `<fe>/channels?lazada=code&code=...`; FE tự mở dialog Kết nối với code điền sẵn — bấm 1 nút là backend local đổi token (ownerId từ JWT đăng nhập, không tin state). Sửa default APP_FRONTEND_URL → http.
- Test: FE prefill qua Chrome thật OK; poll callback Render bằng state giả + code TESTCODE → 302 đúng về localhost. **Người dùng đã kết nối thành công shop mới.**
- Ghi nhớ cho bản THƯƠNG MẠI: khi frontend deploy domain thật + set `APP_FRONTEND_URL` trên Render → luồng OAuth một mạch không dán code (nhánh `lazada=connected` có sẵn); cần nộp app Lazada lên status chính thức (bỏ whitelist 5 seller) + Render trả phí/cron ping cho hết cold start.

---

## Phiên 28/07/2026 — Tích hợp Lazada TRỌN GÓI + Giá vốn không cần liên kết kho

### Lazada Open Platform: từ số 0 → chạy thật production trong một phiên
- **App "Hubsell"** (Seller In-house APP, App Key 140639, status Testing): logo 120×120 tự sinh (`frontend/public/hubsell-logo-120.png`), callback `https://hubsell-backend.onrender.com/api/auth/lazada/callback` (Lazada BẮT BUỘC https → không dùng được mẹo hosts hubsell.tech như Shopee).
- **Code** `backend/src/integrations/lazada/` mirror Shopee: config (host auth + api.lazada.vn) / client (đổi-refresh token, /seller/get, /orders/get, /orders/items/get, /products/get) / service (state CSRF, tự refresh trước hạn 30', handleLazadaCallback idempotent theo seller_id, syncLazadaOrders). **Chữ ký KHÁC Shopee**: HMAC-SHA256 trên `apiPath + concat(key+value sort ASCII, gồm CẢ access_token)`, hex CHỮ HOA, timestamp MILI-giây — kiểm chứng với server thật (code giả trả InvalidCode, không phải IncompleteSignature).
- **2 luồng uỷ quyền**: production tự động qua callback Render; LOCAL dán code (Lazada không kiểm redirect_uri khi đổi token → copy `?code=` từ URL callback dán vào dialog Kết nối). Gotcha đã ăn đủ: trang authorize phải chọn **Site=Vietnam** trước khi login (kẻo "Thiếu Tham số"); app Testing phải thêm seller vào **Authorized Seller Whitelist** (nằm CUỐI trang App Overview isvconsole, phải cuộn; cần email+mật khẩu Seller Center; tối đa 5); phiên SSO console rất dễ văng khi gõ URL thẳng.
- **ĐÃ NỐI SHOP THẬT "DarkMan"** (seller 200158131632, VN33VZ685X): sync sản phẩm qua `marketplace/adapters/lazada-adapter.ts` → **980 SKU**; sync đơn → **1004 đơn / 1104 dòng hàng** (3 năm, 11 trang, idempotent kiểm chứng chạy lại 0 tạo mới). Đặc thù Lazada: mỗi dòng order item = MỘT đơn vị (tự đếm quantity); `statuses` là MẢNG theo kiện → chọn trạng thái đại diện (huỷ chỉ khi mọi kiện huỷ); field /products/get viết hoa đầu (SellerSku/Status).
- **Deploy**: 4 commit đã push, Render build xong + env LAZADA_* đã điền, callback production trả 302 chuẩn.

### Giá vốn KHÔNG cần liên kết kho gốc (quyết định kiến trúc theo yêu cầu)
- Lý do: nhiều khách không muốn quản tồn kho tập trung — liên kết kho là VIỆC TUỲ CHỌN, giá vốn phải nhập được độc lập để tính lãi/lỗ.
- `ChannelProduct.costPrice` (Decimal?, migration `20260728113155`): giá vốn cấp SKU sàn khi chưa nối kho; đã nối thì Product vẫn là nguồn chân lý. Trang Giá vốn hiện CẢ SKU chưa liên kết (badge "Chưa nối kho"); mọi đường nhập (tay / bulk / Excel / popup SKU P&L) đều lưu đúng chỗ + vá đơn cũ theo (gian, mã SKU, snapshot=0). Sync đơn 3 sàn snapshot `product.costPrice ?? cp.costPrice ?? 0`. Khi liên kết, giá vốn cấp sàn kế thừa sang Product đang 0.
- **2 công cụ mới ở Liên kết SP**: nút "Tự khớp SKU" (`POST /api/mappings/auto-match` — trùng mã không phân hoa-thường, không ghi đè liên kết tay) + nút "Tạo SKU kho (n)" trên thanh bulk (`POST /api/mappings/create-products` — sinh SP kho từ dữ liệu sàn rồi nối luôn, trùng mã dùng lại, ≤200/lần).
- **Supabase production quản schema THỦ CÔNG** (Render chỉ tsc, không migrate deploy): đã ALTER thêm cột trên SQL Editor + cập nhật `supabase-schema.sql`. Thêm cột mới lần sau NHỚ bước này.
- Verify toàn bộ trên dữ liệu DarkMan thật qua HTTP route: 986 SKU hiện ở Giá vốn, auto-match 6, nhập giá vốn SKU chưa nối vá 1 dòng đơn cũ, tạo+nối 2 SP kho (số liệu test đều đã hoàn trả).

### 🔜 Còn lại của Lazada: webhook đơn real-time + trừ tồn kho, settlements (gác chung 3 sàn); `APP_FRONTEND_URL` trên Render chờ khi nào deploy frontend.

---

## Phiên 27/07/2026 (chiều) — Trợ lý quảng cáo 3 sàn + Trợ lý thông minh GMV Max TikTok

(Sync Settlements Shopee + TikTok GÁC LẠI theo chỉ đạo — làm sau cùng Lazada rồi đẩy server một thể.)

### Khung UI Trợ lý quảng cáo (3 sàn, ADMIN-only)
- Sidebar thêm nhóm "Trợ lý quảng cáo" (icon Megaphone, dưới Kênh bán): 3 trang `/ads/{tiktok,shopee,lazada}` dùng chung `components/ads/ads-assistant-page.tsx` (chỉ khác prop platform, mock ở PLATFORM_PRESETS). 3 tab: Tổng quan (5 StatCard + danh sách chiến dịch) / Quản lý ngân sách (Switch + ô nhập, disable khi tắt) / Báo cáo (AreaChart 14 ngày + bảng). Banner Preview violet. Mock series tất định (không Math.random — SSR/CSR khớp).

### Trợ lý thông minh GMV Max (TikTok) — chống "cắn tiền vô độ"
- **Rule engine 2 lớp** port từ thiết kế đã test 13 ca PASS ở dự án tiền thân (`D:\FatherBot\AutoControlAdsTiktok\poc\rules.py`): Lớp 1 sàn dữ liệu (chưa đủ chi tiêu/giờ → KHÔNG phán xét), Lớp 2 gồm Quy tắc 1 loại thẳng tay (tiêu >X mà 0 đơn / ROAS <Y / CPA >trần, OR) + Quy tắc 2 chờ phê duyệt (≥N đơn nhưng CPA vượt % mục tiêu). Mọi cờ kèm `reasons` minh bạch + luôn khôi phục được. Logic thuần ở `components/ads/tiktok-assistant.ts` (types + engine + mock 3 tầng).
- **Override theo chiến dịch** (`CampaignRuleOverrides`): mỗi SP một biên lãi — SP 100k trần CPA 30k, SP 1 triệu trần 200k vẫn lãi. Tab "Cấu hình Trợ lý Tự động" = bộ luật MẶC ĐỊNH hệ thống; trong modal từng chiến dịch có switch "Tùy chỉnh Quy tắc riêng" (bật = seed từ mặc định rồi sửa, tắt = kế thừa). Mock sẵn tt-1/TC054 trần CPA 150k → 2 video CPA 47–50k thoát cờ, banner tụt 3→1 video review — bằng chứng override chạy. Ô nhập luật dùng chung 2 nơi: `tiktok-assistant-rule-fields.tsx`.
- **Modal "Phân tích kế hoạch quảng cáo" 3 tầng** đúng luồng TikTok (`tiktok-campaign-modal.tsx`): Tầng 1 chỉ số + LineChart; Tầng 2 bảng sản phẩm (chế độ tối ưu); Tầng 3 bảng video (ID bài đăng, badge "Kém hiệu quả — Chờ loại trừ"/"Chi phí cao — Cần xem xét"/"Chưa đủ dữ liệu", nút Loại trừ/Giữ lại/Khôi phục từng dòng + "Áp dụng" hàng loạt). Gotcha: DialogContent là grid — section phải `min-w-0` không thì bảng ép modal mọc thanh cuộn ngang.
- **Banner "Đề xuất từ Trợ lý Hubsell"** trên dashboard + chip đếm cờ trên tab; mọi số đếm/cờ cập nhật sống theo từng phím gõ cấu hình và từng quyết định.
- Verify E2E qua Chrome thật (đăng nhập sẵn): bulk exclude, giữ lại, toggle override off/on, đổi trần CPA — tất cả phản ứng đúng; tsc + ESLint sạch. Mock chỉ sống trong phiên (reload là về preset).

---

## Phiên 27/07/2026 — Test Order sandbox: ĐÓNG HỒ SƠ, chờ ticket Shopee

Kiểm chứng nốt 4 giả thuyết cuối về "request dependency fail" và loại trừ hết:
1. **model_id**: 2 sản phẩm từng thử đều có phân loại, nghi form console không gửi model → thử item ĐƠN duy nhất **TC015 (802688852, has_model=false, stock 250k)** vẫn fail; shop SG trước đó cũng fail → loại trừ.
2. **Stock = 0 / kho khoá**: gọi live get_item_base_info/get_model_list — mọi item/model tồn 50–250.000; chưa từng có đơn test nào tạo thành công nên không có kho bị giữ → loại trừ.
3. **Token/shop_id lệch** & 4. **Sign/timestamp local**: không áp dụng — Test Order tạo qua web console Shopee (session của họ, không đi qua localhost); sign phía mình đã chứng minh đúng (product sync, logistics, update_stock thật đều chạy).

→ **Chốt: lỗi backend sandbox Shopee. Ngưng đào, chờ Shopee trả lời ticket rồi tính tiếp.** Luồng đơn không bị block (đã nghiệm thu bằng payload chuẩn e2e99f4).

---

## Phiên 24/07/2026 (11) — Test đơn thật Shopee: kẹt ở tool sandbox

### Đã làm
- **Refactor khoá SKU** (`shopeeChannelSku` trong client.ts) dùng chung product & order sync: SKU riêng → theo SKU; nhiều model chung 1 SKU → gộp (đúng `@@unique`); **KHÔNG có SKU → tách theo `SPE-{item}-{model_id}`**. Thêm `model_id` vào ShopeeOrderItem. Verify data thật: TC054 (không SKU) tách đúng 4 biến thể theo model_id; mô phỏng mua từng biến thể → khớp 4/4.
- **Script `backend/scripts/shopee-sandbox-logistics.ts`**: gọi logistics API bằng token DB → kiểm địa chỉ pickup + bật kênh vận chuyển. Kết quả: shop 227774404 ĐÃ có pickup address (id 23339, VN) + cả 3 kênh (SPX/Economy Express, SPF Mart) enabled ở cả shop lẫn product.
- **Điều khiển console Shopee (Claude in Chrome)**: Test Account-Sandbox có 2 shop test Local-VN (227774404 nối Hubsell, 227775379); Create Test Order form = Shop+Item+Shipping (KHÔNG có ô buyer).

### 🔴 BLOCKER (phía Shopee, không phải code)
Create Test Order **luôn báo "request dependency fail, please try again"** dù đã đủ MỌI prerequisite (đối chiếu doc Sandbox Testing V2 https://open.shopee.com/developer-guide/644): shop authorized ✓, sản phẩm published + tồn kho ✓, 3 shipping bật ✓ (thử cả 3, cả product Tất lẫn TC054), KHÔNG cần buyer ✓. Doc không có lỗi này → **lỗi backend sandbox Shopee** (chữ "please try again" = transient). → Cần **Raise Ticket** cho Shopee.

### 🔜 CHIỀU LÀM TIẾP
1. **Nghiệm thu order-sync bằng payload chuẩn** `get_order_detail` (dựng theo schema đã lấy từ API) → chạy `syncShopeeOrders` thật → kiểm `OrderItem.channelSku` khớp biến thể model_id, bắt lỗi mapping. (Test code thật, không cần đơn live.)
2. Thử lại Create Test Order (transient?) / gửi **Raise Ticket** Shopee về "request dependency fail" (kèm: shop 227774404, đủ prerequisite). Khi có đơn live → pull payload verify.
3. (Tuỳ chọn) Viết **Sync Settlements Shopee** (mirror TikTok, dùng `getValidShopeeAccessToken`) — code-only, không cần đơn live.

### Trạng thái tổng: Hubsell Shopee = OAuth ✅ + Product sync THẬT ✅ + Order sync (code + logic biến thể) ✅. Chỉ thiếu 1 đơn LIVE để soi payload (kẹt tool Shopee).

---

## Phiên 24/07/2026 (10) — Adapter Pattern đa sàn + Sync Products Shopee thật

### Kiến trúc mới: `backend/src/marketplace/` (Adapter Pattern)
Tách logic API từng sàn khỏi logic kho nội bộ.
- `types.ts` — `NormalizedChannelProduct` (cấu trúc chuẩn trung lập) + interface `MarketplaceProductAdapter`.
- `registry.ts` — `getProductAdapter(channel)`: Shopee có refreshToken → adapter thật; còn lại → mock (giữ data demo).
- `adapters/shopee-adapter.ts` — gọi API thật + phân trang + **transformer** Shopee→chuẩn + tự refresh token.
- `adapters/mock-adapter.ts` — bọc MOCK_CATALOG cho gian chưa nối API.
- `product-sync.ts` — tầng kho TRUNG LẬP SÀN: upsert ChannelProduct, giữ productId/costPrice, delist SKU cũ.

### Shopee Product API (client.ts)
- `getItemList` (offset/has_next_page, `item_status` LẶP đủ NORMAL/UNLIST/BANNED/DELETED), `getItemBaseInfo` (≤50), `getModelList`. Refactor `callShopGet` sang mảng pair để hỗ trợ param lặp.
- `finance.ts /sync-products`: bỏ vòng lặp mock → gọi `syncChannelProducts` (adapter). Bỏ import MOCK_CATALOG/mockImageFor.

### Verify thật ✅
Trigger sync trên shop sandbox 227774404 → kéo **8 SKU thật** (Áo gió, Tất 3 màu, Túi TC015, Túi TC055 3 màu), tách model đúng; **5 mock cũ tự DELISTED**. Xử lý ca người bán đặt CHUNG 1 SKU cho nhiều model (Áo gió 9 biến thể → gộp về 1 SKU, variant null). `scanned:8` khớp.

### Việc cần làm 🔜
- Người dùng vào Liên kết SP → nối 8 SKU thật về kho gốc → tạo đơn test → đồng bộ đơn nghiệm thu trọn vòng.
- Adapter Orders/Settlements có thể gom vào marketplace/ tương tự (hiện Orders vẫn ở integrations/shopee/service).

---

## Phiên 24/07/2026 (9) — Shopee Sync Orders + OAuth chạy thật

### Cột mốc ✅
- **OAuth Shopee chạy END-TO-END**: kết nối được shop sandbox thật `OpenSANDBOX11505875978db55c3b6` (shop_id 227774404) sau khi fix host `.cn`.
- **Sync Orders Shopee** (mirror TikTok):
  - `client.ts`: `getOrderList` (get_order_list, cửa sổ ≤15 ngày + cursor), `getOrderDetail` (≤50 sn/lần, response_optional_fields), helper `callShopGet` (ký shop-API dùng chung, refactor cả getShopInfo).
  - `service.ts`: `syncShopeeOrders` — chia cửa sổ 15 ngày, phân trang cursor, batch chi tiết 50, upsert idempotent theo `(channelId, order_sn)`, map trạng thái Shopee→Hubsell, snapshot giá vốn qua mapping SKU. KHÔNG trừ kho (đồng bộ lô).
  - `routes/channels.ts`: `POST /:id/sync-orders` giờ **dispatch TikTok/Shopee** theo channelName.
  - Frontend: nút "Đồng bộ đơn" hiện cho cả Shopee (`isOAuth`); đổi tên api `syncTiktokOrders`→`syncChannelOrders` (endpoint generic); toast theo tên sàn.
- **Verify thật**: chạy `syncShopeeOrders` trên gian sandbox → `fetched:0` (shop 0 đơn) **không lỗi chữ ký** → get_order_list + auto-refresh token OK.

### Dữ liệu
- Chốt **giữ nguyên** data cũ (10 gian mock + 15 đơn mock) để nhìn UI — KHÔNG xoá.

### Việc cần làm 🔜
- Tạo đơn test trong Shopee sandbox → bấm "Đồng bộ đơn" nghiệm thu kéo đơn thật.
- Sau đó: Sync Settlements Shopee + webhook Shopee (nếu cần).

---

## Phiên 24/07/2026 (8) — FIX Shopee error_sign: host sandbox cũ bị khai tử

### Triệu chứng & chẩn đoán
Bấm kết nối Shopee → `{"error":"error_sign","message":"Wrong sign."}`. Debug rất sâu, loại trừ hết phía mình: sign scheme đúng chuẩn (HMAC-SHA256 partner_id+path+timestamp, hex lowercase), key đúng (đối chiếu Console + regenerate + tạo hẳn app mới 1239199 vẫn lỗi), clock lệch 0s, thử mọi encoding key/base-string/host. Phát hiện chốt: **`error_sign` là phản hồi CHUNG** (partner_id giả cũng bị) → không suy ra được host đúng.

### Nguyên nhân thật
**Domain sandbox `partner.test-stable.shopeemobile.com` ĐÃ BỊ KHAI TỬ.** (Con "Ask AI Assistant" của Shopee Open Platform xác nhận + đưa domain mới.) Host mới = **`https://openplatform.sandbox.test-stable.shopee.cn`** — đã kiểm chứng: chữ ký QUA (trả `invalid_code` cho code giả thay vì `error_sign`).

### Đã sửa ✅
- `shopee/config.ts`: `SHOPEE_HOSTS.sandbox` → `https://openplatform.sandbox.test-stable.shopee.cn`. Không đụng sign scheme/logic (đúng sẵn).
- `.env`: đang dùng credential app mới **Hubsell ANO 2** (partner_id 1239199).
- Verify: `token/get` trả `invalid_code` (chữ ký OK). Auth URL gen ra trỏ đúng host mới.

### Việc cần làm 🔜
- **Test luồng OAuth thật**: bấm Kết nối Shopee → uỷ quyền shop test → callback lưu Channel. (hosts hubsell.tech→127.0.0.1 + listener :80 đã sẵn.)
- Production host (`partner.shopeemobile.com`) chưa verify — xem lại lúc Go-Live.

---

## Phiên 24/07/2026 (7) — Tích hợp Shopee Open Platform OAuth (Sandbox)

### Mục tiêu
Dựng module Shopee OAuth (mirror cấu trúc TikTok): sinh URL uỷ quyền có ký, route callback, đổi code→token, lưu Channel.

### Đã hoàn thành ✅
- **`backend/src/integrations/shopee/`**: `config.ts` (env + host theo `SHOPEE_ENV`, override `SHOPEE_API_BASE`, paths), `client.ts` (`signPublic`/`signShop` HMAC-SHA256, `buildAuthorizeUrl`, `getAccessToken`, `refreshAccessToken`, `getShopInfo`), `service.ts` (`signOauthState`/`verifyOauthState` mang ownerId, `getValidShopeeAccessToken` tự refresh, `handleShopeeCallback` đổi token + upsert Channel).
- **Routes**: `GET /api/channels/shopee/auth-url` (Admin, ký + state JWT) trong channels.ts; `GET /api/auth/shopee/callback` (công khai, verify state → đổi token → lưu → redirect FE) trong auth.ts.
- **`apiConnected`** đổi từ `Boolean(shopCipher)` → `Boolean(refreshToken)` để đúng cho MỌI sàn (Shopee không có shop_cipher).
- **Env**: thêm `SHOPEE_PARTNER_ID/KEY/ENV/REDIRECT_URI` + `APP_FRONTEND_URL` vào `.env` + `.env.example`.
- **Frontend**: `getShopeeAuthUrl()`; ConnectDialog generalize `isTiktok`→`isOAuth` (TikTok+Shopee đều OAuth); toast handler đọc `?shopee=connected|error` sau redirect rồi dọn query.

### Kiểm chứng
- `tsc` backend + frontend + `eslint`: sạch ✅.
- Smoke-test: `signPublic`/`signShop` **khớp HMAC tính tay**, URL uỷ quyền chuẩn (encode redirect+state), state JWT verify OK / tampered→null ✅.
- Boot backend test (:4103): auth-url chưa auth → 401; callback thiếu param / state rác → 302 redirect FE với `shopee=error` đúng ✅.
- **CHƯA test end-to-end với Shopee thật** — cần domain `hubsell.tech` (đã đăng ký Console) trỏ về backend; redirect localhost không được Shopee chấp nhận.

### Quyết định & lưu ý
- Redirect user cho là `:3000` nhưng callback là **route backend** → đặt `:4000` (giải thích: `:3000` là Next FE, không có route này). Domain thật phải khớp `hubsell.tech`.
- Sandbox host mặc định `partner.test-stable.shopeemobile.com` (KHÁC `partner.shopeemobile.com` = production mà user tưởng là sandbox) — cho ghi đè qua `SHOPEE_API_BASE`.

### Việc cần làm phiên sau 🔜
1. Trỏ `hubsell.tech` về backend (hosts/tunnel/deploy) + đổi `SHOPEE_REDIRECT_URI` khớp domain → test OAuth end-to-end.
2. Dựng đồng bộ đơn/đối soát Shopee (dùng `getValidShopeeAccessToken`).

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

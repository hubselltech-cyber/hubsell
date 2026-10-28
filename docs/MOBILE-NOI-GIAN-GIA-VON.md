# Nối gian hàng + Cập nhật giá vốn trên app mobile (28/10/2026)

> Anh Trung 28/10/2026: "Việc không thể liên kết shop trên app đang gây khá nhiều khó khăn cho khách hàng… 2 mục này anh định để icon trên trang chủ. Em dựng trên local anh xem trước."
> Trạng thái: **anh duyệt 28/10 đêm, ĐÃ COMMIT (chưa push)**; lát 2 (nảy về app) ĐÃ LÀM cùng đêm; đi bản 1.4.1 build 01/11; còn lát 3 (phân trang) ở mục 4. Mã chỉ ở `hubsell-mobile/`, backend + web 0 thay đổi.

## 1. Phản biện trước khi làm

### 1.1 Nối gian hàng trong app — ĐỒNG Ý, và cần hơn anh nói
- Thẻ "Chưa có gian hàng nào" trên app hiện chỉ có nút mở `app.hubsell.vn/channels`. Khách tạo tài khoản trong app (Google/Apple, bản 1.3.x) bị đẩy sang trình duyệt điện thoại, phải đăng nhập lại web rồi mới ủy quyền. 25/10 có 62 chủ shop đăng ký mà chưa nối gian — phễu rụng đúng ở bước này.
- Apple từng soi link sang web (3.1.1, 08/10). Nối gian ngay trong app bỏ được link đó.

**Điểm kỹ thuật anh cần biết:** địa chỉ callback của ba sàn đăng ký CỐ ĐỊNH phía sàn (Shopee/Lazada → backend Render, TikTok → trang web `/channels/tiktok/callback`). App không nhận được redirect trực tiếp, và đổi callback = nộp lại hồ sơ ISV. Cách làm (đã đo, không đụng hồ sơ sàn):
1. App xin link ủy quyền từ backend như web (`GET /api/channels/<sàn>/auth-url`), mở bằng **phiên trình duyệt hệ thống** (`expo-web-browser.openAuthSessionAsync`: iOS ASWebAuthenticationSession, Android Custom Tabs — cách Apple khuyến nghị, không phải WebView bọc web nên không dính 4.2).
2. Sàn trả về callback như luồng web → backend xử lý xong, **nảy tiếp về `hubsellmobile://channels?shopee=connected…`** khi state mang dấu "từ app" → phiên tự đóng, app đọc kết quả. **Bước nảy này là lát 2 (backend + trang callback TikTok web), chưa làm.** Khi chưa có: phiên trình duyệt dừng ở trang Kênh bán web "Đã kết nối", khách bấm Xong → app tải lại danh sách — vẫn nối được, chỉ không tự đóng. Riêng TikTok khi chưa có lát 2: trang callback web cần phiên đăng nhập web → khách chưa đăng nhập web trên Safari sẽ phải đăng nhập — nên lát 2 làm trước khi phát hành.

### 1.2 "Nối xong phải đồng bộ đối soát, đồng bộ đơn, kéo sản phẩm" — KHÔNG LÀM NÚT, làm DẢI TIẾN ĐỘ
Từ 28/09 (danh mục) và 02/10 (đơn + đối soát) worker tự kéo ngay sau khi nối: gian TikTok "Giày Dép Đức Khải" 02/10 về 1.398 đơn + đối soát + 799 SP trong ~14 phút, khách không bấm gì. Trang Kênh bán web không cho thấy việc đó nên anh và khách vẫn giữ thói quen bấm Đồng bộ. App làm ngược lại: **một nút Kết nối, không nút Đồng bộ**, và một dải vàng "Hubsell đang kéo dữ liệu về: đơn 3 tháng + đối soát của X · danh mục sản phẩm của Y" đọc từ cờ `historyBackfillPending` + `GET /api/finance/sku-products/catalog-pending`, hỏi nhịp 15 giây, tự tắt khi xong. Thêm nút Đồng bộ trên app là thêm lối cho khách bấm trùng việc worker đang làm (và bấm dồn vào trần gọi sàn).

### 1.3 Cập nhật giá vốn trong app — ĐỒNG Ý MỘT NỬA: chỉ "nhập nhanh cái đang thiếu"
Trang web = 974 + 798 dòng, 3 tab (Nhập theo gian · Mapping theo mã · Bảng giá mẫu) + Excel + Áp giá cho đơn cũ. Chép lên điện thoại là sai công cụ. App làm đúng việc khách cần ngay sau khi nối gian:
- Tab **Cần nhập** = SKU đã bán 30 ngày gần nhất mà chưa có giá vốn, xếp theo số đơn bị loại khỏi lợi nhuận (`GET sku-products/missing-cost`, trần 5.000) — đúng dòng "N đơn chưa có giá vốn" mà Tổng quan đang hiện.
- Tab **Tất cả SKU** = tìm theo mã / tên / mã sản phẩm sàn (bỏ dấu), chỉ SKU đang bán.
- Hộp nhập: một giá, xem giá bán + biên gộp, nút "Áp cho cả N phân loại của mẫu này" (cùng gian + mã sản phẩm sàn — danh tính theo [DONG-BO-SAN-PHAM-TRUNG-MA-PHAN-LOAI.md](DONG-BO-SAN-PHAM-TRUNG-MA-PHAN-LOAI.md), không gộp theo tên).
- Luật đã chốt giữ nguyên: đơn cũ đã có giá vốn không bị áp giá mới (backend chỉ lấp dòng = 0, app báo "tính lại N dòng đơn cũ"); giá ghi là giá riêng của gian (11/10); khớp theo mã, không khớp mềm.
- Không có: Excel, Mapping, Bảng giá mẫu, Áp giá cho đơn cũ, hàng kho Offline chưa nối sàn (vẫn ở web).

**Giới hạn backend cần biết:** `GET /api/finance/sku-products` trả TOÀN BỘ danh mục không phân trang, không tìm phía máy chủ (web cũng vậy). Gian 11.316 SKU → vài MB JSON, trên 4G mất vài giây. Bản dựng này tải một lần + lọc tại máy để anh xem trước; nếu chốt phát hành thì **lát 3: thêm `?q=&page=` cho endpoint này** (web dùng chung được).

### 1.4 Icon trên trang chủ — GIỮ Ý ANH, nhưng icon phải MANG TRẠNG THÁI
**Anh chốt vị trí (28/10 đêm, sau khi xem bản đầu):** hai ô đặt CUỐI trang Tổng quan (sau thẻ đơn hoàn), không chen giữa hero và KPI; "trình bày đẹp, sang trọng, dễ nhìn". Bản hiện tại: nhãn mục "THIẾT LẬP" chữ nhỏ in hoa + "Gian hàng · Giá vốn" bên phải; hai thẻ ngang nhau, đĩa tròn 48 px tint theo trạng thái + icon đặc, nhãn 15 px, dòng trạng thái dạng viên thuốc có chấm màu (đỏ "2 mất kết nối" / vàng "Đang kéo 1 gian", "12 đơn chưa có giá" / xanh ngọc "4 đang nối", "Đủ giá vốn"), mũi tên mờ góc phải. Câu trạng thái rút ngắn để vừa 139 px.
Trang chủ chốt 13/08 là nơi XEM số (Kho là nơi LÀM việc nên 04/10 đã dời xuống tab). Hai ô mới là việc LÀM, nên để khỏi thành lối tắt chết sau ngày đầu: ô **Gian hàng** hiện "N gian mất kết nối" (đỏ, chấm đỏ) > "Đang kéo đơn N gian" (vàng) > "N gian đang nối" (xám); ô **Giá vốn** hiện "N đơn chưa có giá vốn" (vàng, cùng số với hero) > "Đủ giá vốn hôm nay" (xám). Không có gì cần làm thì hai ô xám, không chấm. Thẻ "Chưa có gian hàng nào" bấm thẳng vào màn Gian hàng.

### 1.5 Người mới đăng ký trên app → nhắc giá vốn LÚC NÀO (anh hỏi 28/10 đêm, chốt "Làm luôn")
- Thẻ "Chưa có gian hàng nào" ở Tổng quan: nút **"Liên kết gian hàng ngay"** → màn Gian hàng.
- **Không nhắc giá vốn ngay lúc nối xong**: danh mục chưa về (02/10: 14 phút), mở Giá vốn là bảng trống. Theo luật web 02/10 (hộp ở Tổng quan khi đã có đơn thiếu giá vốn, không ở bước nối gian).
- Mobile: `components/MissingCostPrompt.tsx` — hộp giữa màn, hiện khi hôm nay có đơn thiếu giá vốn (cùng số với hero), mỗi lần mở app hỏi tối đa một lần; "Nhập giá vốn" → màn Giá vốn; "Bỏ qua, không nhắc lại" / X → ghi `hubsell_missing_cost_prompt_dismissed:<uid>` vào SecureStore, **không hiện lại** ([feedback-bo-qua-la-khong-hien-lai]); chạm ngoài không đóng; không hiện khi gói khóa. Chỉ bật khi tab Trang chủ đang được nhìn (theo dõi bằng `useFocusEffect`; lần soi đầu hộp đè lên cả tab Cấu hình vì Modal của màn nằm nền vẫn phủ). Ô Giá vốn ở mục Thiết lập vẫn vàng "N đơn chưa có giá" (nhắc thụ động, không tắt được).
- Lát sau (backend, chờ anh): chuông đẩy "Đã kéo xong đơn của gian X — nhập giá vốn để thấy lợi nhuận" khi worker hạ cờ kéo 3 tháng.

### 1.6 Màn Giá vốn bản 2 (anh hỏi 28/10 đêm: bộ lọc + cha–con + tên dài; anh dặn: khách nhiều phân loại, 2–3 tầng màu–size)
- **Bộ lọc chỉ hai cái:** gian hàng (ô `ShopFilterField` mode scope, chọn gian là biết sàn) + chip "Chưa có giá" ở tab Tất cả. Bỏ lọc sàn và "đã gỡ" của web (hàng đã gỡ chỉ để tra đơn cũ — việc ngồi máy tính).
- **Danh sách = MẪU** (gian + mã sản phẩm sàn, không nhóm theo tên): ảnh, tên cắt 2 dòng, "N phân loại · k chưa có giá", gian; cột giá một số / khoảng "57 k – 157 k" / "Chưa có giá vốn" vàng. DB dev: 598 SKU → 149 mẫu. Mẫu một phân loại in luôn tên phân loại + mã SKU **không cắt**. Web xổ bảng cha–con trong danh sách; màn hẹp không có chỗ → con nằm trong hộp trượt.
- **Hộp nhập theo mẫu:** đầu hộp tên ĐỦ xuống dòng + sàn/gian; ô "Giá chung cho cả mẫu" điền mọi ô (khách chủ động gõ = muốn cả mẫu cùng giá, sửa riêng được); mỗi dòng: phân loại, mã SKU, mã sàn + sao chép, ô giá + "Bán X · biên Y%" (ô trống viền vàng). Lưu = `update-cost-bulk` khi mọi ô đổi cùng giá, còn lại từng dòng; chỉ gửi dòng có thay đổi.
- **Phân loại 2–3 tầng** (cả 3 sàn nối tầng bằng ", " — `normalizeVariantName`): mẫu ≥ 4 dòng cùng số tầng ≥ 2 → chip "Nhóm theo" (nhãn = hai giá trị đầu của tầng: "Trắng, Đen" / "L, M…"), mặc định tầng CUỐI (sàn xếp "Màu, Size", giá vốn lệch theo size nhiều hơn màu); mỗi nhóm một ô giá chung (mọi ô bằng nhau → số, khác → "Nhiều giá"), bấm tên nhóm mới mở từng dòng. Mẫu 25 phân loại (5 màu × 5 size) chỉ còn 5 ô. Lazada `Variation` là chuỗi tự do (DB dev: "AQ004-Xanh dương-13-15kg", không dấu phẩy) → không tách tầng được, về danh sách phẳng.
- Kiểm giả lập web 375: lưu thật 65.000 cho 3 phân loại Áo Thun (bulk) → toast + đếm thiếu 569→566; Chân Váy 6 phân loại nhóm theo size / theo màu, mở rộng Trắng thấy L/M/S 157.000, Đen 57.000. **Tỉ lệ màn (anh dặn):** soi 320×568 (danh sách, hộp nhập 2 tầng, hai ô Thiết lập) và 430×932 — scrollWidth = bề rộng màn, không phần tử nào tràn; ở 320 ô "Giá chung cho cả mẫu" và dòng "nhiều giá, mở để xem" gãy 2 dòng nhưng không chồng. Chưa soi máy thật / giao diện tối.

## 2. Đã dựng (hubsell-mobile, chưa commit)

| Tệp | Việc |
|---|---|
| `src/app/channels.tsx` + `src/screens/ChannelsScreen.tsx` | Màn Gian hàng: nút Kết nối → hộp chọn sàn (3 dòng, một gợi ý ngắn mỗi sàn) → `openChannelAuth`; nhóm theo sàn, trạng thái cùng câu chữ thẻ gian web (Đang hoạt động / Mất ủy quyền / Hết hạn ủy quyền / Đã ngắt kết nối / Ngủ đông, lý do đỏ theo `authLostReason`, hạn ủy quyền); nút Kết nối lại gửi `channelId` để backend đối chiếu shop_id; dải tiến độ (1.2); nhận deep link `hubsellmobile://channels?...` (Android mở thẳng màn) xử lý một lần; TikTok đối chiếu `state`. |
| `src/lib/channel-auth.ts` | `openChannelAuth` (web: tab mới; native: `openAuthSessionAsync` về `Linking.createURL("/channels")`), `parseAuthReturn` đọc đúng tham số callback web đang dùng (`shopee=connected|error|code`, `lazada=…`, `code&state` TikTok). |
| `src/api/channels.ts` | `fetchAuthUrl`, `connectShopeeCode`, `connectLazadaCode`, `connectTiktokCode`, `fetchCatalogPending`. |
| `src/app/cost-prices.tsx` + `src/screens/CostPricesScreen.tsx` | Màn Giá vốn (1.3): hai tab, tìm có chờ 200 ms, FlatList ảo hóa; dòng = ảnh · tên · phân loại · gian + mã · giá vốn / "Chưa có giá vốn"; dòng sổ cái không còn mã trong danh mục hiện mờ "nhập ở web"; hộp nhập + áp cả mẫu; danh mục gian mới chưa về → dải vàng hỏi 15 s. |
| `src/api/cost-prices.ts` | `fetchSkuProducts`, `fetchMissingCostSkus(from,to)`, `updateSkuCostPrice`, `updateSkuCostPriceBulk`. |
| `src/types/api.ts` | `ChannelListItem` thêm cờ tùy chọn; `SkuProduct`, `MissingCostSku`, `UpdateCostResult`… |
| `src/screens/OverviewPage.tsx` | Hai ô `QuickTile` dưới hero (1.4), tải thêm `GET /api/channels`; thẻ "Chưa có gian" → `/channels`, bỏ link web. |
| `src/components/MissingCostPrompt.tsx` | Hộp nhắc nhập giá vốn (1.5). |

Trần gói: gian mới chạm trần → backend 409 `PLAN_LIMIT_CHANNELS`; `api/client.ts` đã đổi mọi mã `PLAN_*` thành câu trung tính (luật Apple 08/10) nên app không nói "nâng gói".

## 3. Kiểm local 28/10 (giả lập web 375×812, backend local, admin@hubsell.vn)
- Gian hàng: 4 gian hiện đúng nhóm/trạng thái (Demo Shopee hoạt động; Hi.Bé, DarkMan Lazada ngắt → nút Kết nối lại; Offline), "2/4 đang nối"; hộp chọn sàn mở/đóng.
- Giá vốn: tab Cần nhập trống đúng (DB dev không có đơn 30 ngày thiếu giá vốn) kèm câu "còn 571 SKU đang bán chưa có giá"; tab Tất cả 598 SKU; mở hộp "Quần Short Kaki Nữ Lưng Cao" Đe,L → gõ 120.000 → biên gộp 42,9 % (giá bán 210.000) → bật "Áp cho cả 2 phân loại" → lưu → toast "Đã đặt 120.000 cho 2 phân loại", hai dòng Đe,L / Đe,M đổi giá, đếm thiếu 571 → 569 (PATCH update-cost-bulk thật trên DB dev).
- Tổng quan (bản 2, cuối trang): mục THIẾT LẬP hai ô "2 mất kết nối" (đỏ) + "Đủ giá vốn" (xanh ngọc) sau thẻ đơn hoàn, orb Trợ lý không đè khi cuộn hết; ô xếp ngang phải bọc `View` thường vì `Animated.View` trên giả lập web không nhận className (hai thẻ KPI sẵn có cũng vậy, chỉ web).
- tsc sạch; eslint chỉ còn `set-state-in-effect` cùng kiểu baseline.
- **Chưa kiểm:** vòng ủy quyền thật trên máy (cần lát 2 để phiên tự đóng), giao diện tối (giả lập web không đổi theme), máy 320 px, gian vài nghìn SKU thật.

## 4. Lát sau (nếu anh chốt)
- **Lát 2 — backend + web nảy về app: ✅ ĐÃ LÀM 28/10 đêm.** `integrations/app-return.ts` (`APP_MOBILE_SCHEME` env, mặc định `hubsellmobile`; `appChannelsUrl`; `decodeOauthStateClient` đọc dấu không cần chữ ký — chỉ chọn đích, danh tính vẫn qua verify). `signOauthState(ownerId, target?, client?)` Shopee/Lazada ký `client: "app"` khi app xin link `?client=app`; TikTok state tiền tố `app_`. Callback `/api/auth/shopee|lazada/callback` thấy dấu → 302 `hubsellmobile://channels?shopee=connected|error|code…` (cùng tham số FE web; ca dev local bật `code` về app). Trang web `/channels/tiktok/callback` thấy state `app_` → `window.location.replace("hubsellmobile://channels?tiktok=code&code&state")` + nút "Mở app Hubsell" dự phòng (`NEXT_PUBLIC_APP_MOBILE_SCHEME` tùy chọn). Mobile `fetchAuthUrl` gửi `client=app`, `channelReturnUrl` = `Linking.createURL("channels")`. Test `integrations/__tests__/app-return.test.ts` 7 ca; kiểm thật backend local: state app → Location `hubsellmobile://channels?shopee=error…` / `lazada=error…` (code giả), state web → `localhost:3000/channels`, TikTok state `app_…`. Chưa thử vòng thật trên điện thoại (cần build 1.4.1 + backend prod).
- **Lát 3 — `sku-products?q=&page=`** cho gian vài nghìn SKU (web dùng chung).
- Bản 1.4.1 build 01/11: hai màn đi JS → có thể OTA sau, nhưng deep link scheme đã có sẵn (`hubsellmobile`) nên không cần build native mới.

## 5. Chờ anh chốt
1. Hai ô trên trang chủ theo kiểu "mang trạng thái" (1.4) hay anh muốn icon tròn kiểu lối tắt?
2. Làm lát 2 (nảy về app) trước khi đưa vào 1.4.1 — em đề nghị CÓ, vì TikTok thiếu nó là khách phải đăng nhập web thêm một lần.
3. Giá vốn trên app giữ phạm vi "nhập nhanh cái thiếu" (1.3) — không Excel/Mapping?

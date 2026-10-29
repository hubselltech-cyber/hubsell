# Khảo sát: "Sao chép sản phẩm" + "Đăng hàng loạt lên sàn" — đối thủ VN làm thế nào, Hubsell nên làm gì (29/10/2026)

> Bối cảnh: sau đợt dùng thử ngắn có **4 ý kiến** đòi tính năng "Sao chép sản phẩm": chép 1 sản phẩm từ một shop
> lên các gian hàng khách chỉ định trên cả 3 sàn Shopee / TikTok Shop / Lazada, và đăng hàng loạt.
> Khảo sát 29/10/2026 bằng tài liệu công khai (trang trợ giúp, blog, YouTube) + tài liệu API 3 sàn.
> **Chưa kiểm trên tài khoản thật** của đối thủ nào — mục nào không có bằng chứng ghi "không tìm thấy".

## 1. Kết luận 1 phút

1. Thị trường chia **2 nhóm**: (a) tool "cào & đăng" (Ship Xanh, BigSeller, AutoShopee, GoSeller) — chép chéo sàn
   mạnh, đăng hàng loạt, nhưng yếu nối kho, danh mục sửa tay, thu phí theo sản phẩm; (b) phần mềm quản lý bán hàng
   (Sapo, KiotViet, Nhanh, Haravan, Pancake, Salework) — **không có hoặc rất sơ khai**: Sapo tự thừa nhận "chưa hỗ trợ
   đăng bán hàng loạt", KiotViet/Haravan "đăng hàng loạt" = xuất Excel rồi tự lên Seller Center, Salework chỉ chép sang
   **1 gian/lượt**, Nhanh/Haravan/Pancake không đẩy sản phẩm lên sàn qua API.
2. **Không bên nào** làm được trọn gói 4 ý: chọn 1 (hoặc N) sản phẩm → chọn **nhiều gian trên nhiều sàn một lượt** →
   **gợi ý danh mục + thuộc tính bắt buộc** theo sàn đích → **tự nối SKU kho** để đồng bộ tồn. GoSeller mới có gợi ý
   ngành hàng TikTok theo ngành hàng Shopee; UpBase có map ngành hàng tay rồi "áp cho các SP còn lại".
3. API 3 sàn **đủ để làm** (Shopee `add_item`/`batch_add_item`, TikTok Create Product, Lazada `/product/create`),
   quyền Hubsell đã có gần đủ (Shopee app loại ERP System; TikTok Product Modify bật 12/10; Lazada cần kiểm nhóm
   Product API). Khó không ở API mà ở **dữ liệu khác chuẩn giữa sàn**: danh mục, thuộc tính bắt buộc, ảnh phải tải
   lại, mô tả HTML/text, thương hiệu, số tầng phân loại, trần TikTok 100 SP/ngày gian mới.
4. **Nhận định (em):** nên làm, nhưng (i) **nguồn chỉ là gian đã nối Hubsell** (đọc qua API), KHÔNG cào shop người
   khác như Ship Xanh (vi phạm điều khoản sàn, rủi ro hồ sơ ISV Shopee + bản quyền ảnh); (ii) đi 2 lát: lát 1 chép
   1 SP → N gian 3 sàn, lát 2 chọn N SP; (iii) trước khi code, **hỏi lại 4 khách** 3 câu ở mục 7 — vì "sao chép sản
   phẩm" với tool cào nghĩa là "lấy hàng shop khác", với phần mềm quản lý nghĩa là "mở gian mới nhanh". Hai nhu cầu
   này ra hai sản phẩm khác nhau.

## 2. Bảng so sánh

| Bên | Chép chéo gian/sàn | Nhiều gian + nhiều sàn 1 lượt | Đăng hàng loạt qua API | Map danh mục | Tự nối SKU kho sau đăng | Sàn đích | Phí |
|---|---|---|---|---|---|---|---|
| **Ship Xanh** (tiện ích Chrome + app) | ✅ Shopee/TikTok/Lazada, cả shop người khác + 1688/Taobao | ✅ chọn nhiều sàn khi lưu; đăng theo từng sàn+shop đích | ✅ "Đăng hàng loạt" từ danh sách chờ | ❌ chỉ cảnh báo thiếu, sửa tay/hàng loạt | ❌ không thấy | Shopee, TikTok, Lazada, web, fanpage | 1.000đ/SP đăng thành công |
| **Sapo OmniAI** (app Đăng bán đa sàn) | ◐ "Sử dụng dữ liệu mẫu" từ gian đã nối hoặc kho Sapo | ✅ 1 SP → nhiều gian, nhiều sàn | ❌ **tự nhận "chưa hỗ trợ đăng bán hàng loạt"** | ❌ chọn tay ngành hàng + thuộc tính từng sàn | ✅ nếu SKU trùng; không trùng → "chờ xử lý" | Shopee, Lazada, TikTok (Tiki chưa) | gói Omni 449k có sẵn; Startup/Pro +100k/tháng |
| **KiotViet** | ❌ chỉ chiều sàn → KiotViet ("sao chép về") | ◐ "Đăng bán" từ hàng KiotViet, tích nhiều gian | ❌ "hàng loạt" = Xuất file mẫu sàn → tự lên Seller Center | ❌ chọn tay | ✅ (đăng từ hàng KiotViet) | Shopee, TikTok, Lazada | gói 270k–490k; Lazada từ gói Chuyên nghiệp |
| **Salework Kho Vận** | ✅ Shopee → Shopee/TikTok; Lazada đích chưa (2023) | ❌ 1 gian đích/lượt, chép lại từ "Danh sách sao chép" | ◐ tick nhiều SP → 1 gian | ❌ sửa tay ở màn trước đăng | ❌ nối riêng bằng "Thêm liên kết SKU" | Shopee, TikTok | không rõ |
| **UpBase** | ◐ "Sao chép sản phẩm" chỉ **cùng sàn** gian → gian | ❌ 1 gian/lượt | ✅ "Tạo SP sàn từ SP kho" 5 bước, hàng loạt | ◐ chọn tay 1 SP rồi áp cho các SP còn lại | ✅ liên kết tự động theo SKU | Shopee, TikTok, Lazada | không rõ |
| **Nhanh.vn** | ❌ | ❌ | ❌ chỉ có "tạo SP Nhanh → Shopee" không có hướng dẫn | — | ✅ luật SKU sàn = mã Nhanh | Shopee | — |
| **Haravan** | ❌ FAQ: "chưa hỗ trợ đăng sản phẩm lên sàn qua MyHaravan" | ❌ | ❌ Xuất theo mẫu sàn → tự lên | — | ✅ SKU sàn = Barcode | — | — |
| **Pancake POS** | ❌ chỉ sàn → POS | ❌ | ❌ | — | ✅ theo SKU | — | — |
| **Omisell** | ? "đăng bán từ kho lên đa kênh" (help không truy cập được) | ? | ? | ? | ? | Shopee, Lazada, TikTok, Shopify | — |
| BigSeller / AutoShopee / GoSeller | ✅ cào link shop → hộp nháp → đăng | ◐ | ✅ | GoSeller: gợi ý ngành TikTok theo ngành Shopee | ❌ | 3 sàn | mua điểm / theo gói |

✅ có · ◐ một phần · ❌ không · ? chưa xác nhận.

## 3. Luồng từng bên (chi tiết đáng học)

### 3.1 Ship Xanh — mẫu "cào & đăng" tốt nhất VN
- Tiện ích Chrome ~20.000 người dùng. Mở trang sản phẩm (shop mình hoặc shop khác) → nút Ship Xanh → chọn sàn đích
  (nhiều sàn) → "Lưu sản phẩm"/"Lưu hàng loạt" → app.shipxanh.com › Marketing › Copy sản phẩm = **danh sách chờ đăng**
  → chọn sàn + shop đích → SP hợp lệ tick xanh, thiếu dữ liệu dấu "?" cam (rê chuột xem thiếu gì) → "Sửa chi tiết" /
  "Sửa hàng loạt" → **Đăng hàng loạt**.
- Chép: tên, mô tả, ảnh, phân loại, giá (chọn giá KM hay giá gốc). Lưu từ trang mua hàng thì **không có cân nặng,
  kích thước, SKU**; lưu từ Kênh người bán mới đủ. Chép shop người khác thì "AI đoán cân nặng/kích thước".
  Hay thiếu nhất: **danh mục, cân nặng/kích thước**. Có chèn logo/khung ảnh, ChatGPT viết lại tên/mô tả.
- Video: "Sử dụng tiện ích Ship Xanh trên Chrome để copy sản phẩm Shopee sang Shopee, Tiktok, Lazada"
  https://www.youtube.com/watch?v=V3BIytSlFyA · kênh https://www.youtube.com/@ShipXanh/videos
- Bài học: **màn "danh sách chờ đăng" với tick xanh / dấu hỏi + sửa hàng loạt** là UX đáng chép. Điểm yếu: không nối
  kho, không map danh mục, thu 1.000đ/SP.

### 3.2 Sapo OmniAI — "Đăng bán đa sàn → Sử dụng dữ liệu mẫu"
- Đăng bán đa sàn → chọn gian hàng cần đăng (nhiều gian, nhiều sàn; có trạng thái "Thành công một phần") → màn nhập
  thông tin → **"Sử dụng dữ liệu mẫu"**: lấy từ (a) sản phẩm gian hàng đã nối, (b) kho Sapo → hộp **"Xác nhận ngành
  hàng"**: khách tự chọn lại ngành hàng, thuộc tính, giá, tồn → Đăng bán / Lưu nháp (nháp ở Sapo).
- Chạy nền, 5 trạng thái (Thành công / một phần / nháp / Thất bại / Đang xử lý), bấm icon lỗi xem lý do sàn trả.
  Trang lỗi liệt kê ~15 mã Shopee, ~17 mã Lazada, 4 ca TikTok — nguồn tốt để Hubsell soạn **bảng dịch lỗi sàn**:
  https://help.sapo.vn/cac-van-de-thuong-gap-khi-dang-ban-san-pham-da-san
- Nối kho: SKU trùng → tự liên kết; không trùng → "Sản phẩm chờ xử lý" (giống luật mã trùng của Hubsell).
- Nguyên văn trang trợ giúp: *"chưa hỗ trợ đăng sản phẩm lên sàn Tiki và chưa hỗ trợ đăng bán hàng loạt"*.
- Video chính thức về đăng bán: **không tìm thấy**; chỉ có thiết lập kênh (youtube.com/watch?v=87SIJFS47H0) và đồng
  bộ SP Shopee về Sapo (youtube.com/watch?v=ORpLYcEBszw).

### 3.3 KiotViet
- "Sao chép hàng hóa" = **sàn → KiotViet** (bảng ánh xạ chính thức: tên, mô tả, trọng lượng, biến thể, giá, giá KM, tồn,
  SKU, ảnh, danh mục sàn → nhóm hàng). Không có SKU → tự sinh `SPO+id`; SKU trùng mã đã có → bỏ qua.
- "Đăng bán" KiotViet → sàn: tích nhiều gian → nhập mã/tên hàng KiotViet → bổ sung bắt buộc: danh mục sàn, ảnh (TikTok
  cắt 1:1), video, giá, số lượng, SKU, cân nặng, kích thước → Đăng. Tab "Đã đăng" / "Đăng thất bại".
- "Đăng hàng loạt" = **Xuất file mẫu sàn TMĐT** (1 gian/file) → tự lên Seller Center (TikTok ≤5.000 SP/file).
- Video chính thức 30/09/2026 "Kết nối sàn TMĐT | KiotViet Retail" https://www.youtube.com/watch?v=ZMqFa18zXf0 — chỉ
  nối gian, phân bổ tồn, gom đơn; **không có phần đăng/sao chép**.

### 3.4 Salework Kho Vận
- Liên kết sàn → chọn shop nguồn → tick SP → "Sao chép SP" → chọn **1 gian đích** → màn sửa (mô tả, phân loại, danh
  mục, số lượng) → "Lưu và tải lên" / "Lưu vào hộp nháp". Hộp nháp báo "thành công" / "đẩy lên sàn thất bại (sàn
  không duyệt)", nút "Cập nhật trạng thái SP trên sàn".
- Muốn sang gian khác: vào "Danh sách sao chép" chép lại. Shopee → Lazada **chưa hỗ trợ** (blog 03/2023).
- "Tạo SP hàng loạt" của Salework là chiều **ngược** (tạo mã kho từ SKU sàn). Không có bulk listing.
- Docs: https://docs.salework.net/salework-tai-lieu/salework-kho-van/tao-va-quan-ly-san-pham/sao-chep-san-pham ·
  blog https://salework.net/copy-san-pham-tu-shopee-sang-tiktok/ (05/2023). Video YouTube về sao chép: không có.

### 3.5 UpBase — gần nhất với "trợ lý đăng hàng" từ kho
- Tick nhiều SP kho → "Tạo sản phẩm sàn từ sản phẩm kho" 5 bước: (1) ngành hàng + thương hiệu + map nhóm phân loại,
  (2) thuộc tính, (3) sửa hàng loạt giá/tồn/mô tả/kích thước/ĐVVC (Shopee: áp ĐVVC cho tất cả), (4) nháp / đăng bán.
  Mẹo: chọn ngành hàng 1 SP rồi **áp cho các SP còn lại**.
- "Sao chép sản phẩm" chỉ **cùng sàn** gian → gian, chế độ bỏ qua trùng ID, khuyến nghị lưu nháp "tránh bị khóa do
  đăng trùng lặp".
- Docs: https://upbase.gitbook.io/ups/tinh-nang-san-pham/quan-ly-san-pham-san/huong-dan/them-moi-san-pham-san

### 3.6 Nhanh.vn / Haravan / Pancake / Omisell
- Nhanh: chỉ snippet lỗi "Tạo sản phẩm từ Nhanh.vn sang Shopee: min length of item_SKU", không có hướng dẫn; TikTok chỉ
  chiều sàn → Nhanh.
- Haravan FAQ: *"chưa hỗ trợ đăng sản phẩm lên sàn TMĐT thông qua MyHaravan"*; nút "Đăng lên kênh" thực chất là
  **liên kết** SP đã có trên sàn (SKU sàn = Barcode).
- Pancake: chỉ sàn → POS + liên kết theo SKU.
- Omisell: có video "Đăng bán sản phẩm từ Omisell lên đa kênh bán" https://www.youtube.com/watch?v=dTH5y_KaRV8 nhưng
  help.omisell.com không truy cập được lúc khảo sát → chưa xác nhận luồng.

## 4. API 3 sàn — tạo sản phẩm được tới đâu (đọc trực tiếp portal 29/10/2026)

| Việc | Shopee v2 | TikTok Shop 202309+ | Lazada |
|---|---|---|---|
| Tạo SP | `product/add_item`; **`product/batch_add_item`** nền 1–100 SP/lần + `get_batch_task_result` | `POST /product/202309/products` (`save_mode` AS_DRAFT / LISTING) | `POST /product/create` (XML hoặc JSON) |
| Phân loại | `init_tier_variation` sau add_item ≥5 s (batch đã nhúng) | `skus[].sales_attributes` ngay khi tạo | `Skus.Sku[].saleProp` ngay khi tạo |
| Ảnh | `media_space/upload_image` multipart, **không nhận URL** | `POST /product/202309/images/upload`, **không nhận URL**; ảnh mô tả phải là URL TikTok | `/image/upload` hoặc **`/image/migrate` kéo từ URL ngoài** |
| Danh mục + thuộc tính | `get_category`, `get_attribute_tree` (`mandatory`), `get_item_limit` | `categories` (`category_version=v2`), `categories/{id}/attributes` (`is_required`), `categories/{id}/rules` (chứng chỉ, size chart, COD) | `/category/tree/get` (lá), `/category/attributes/get` (`is_mandatory`), `getPreQcRules` |
| Gợi ý danh mục | `category_recommend` (tên + ảnh bìa) | `categories/recommend` (tên + mô tả + ảnh + **`origin_platform_category`**) | `/product/category/suggestion/get` (chỉ tên) |
| Thương hiệu | `get_brand_list`, `brand_id 0 = No Brand` | `brands`, tùy chọn, brand chưa ủy quyền không hiển thị | `/category/brands/query`, **bắt buộc**, có No Brand |
| Vận chuyển | `logistic_info[]` ≥1 kênh enabled (bắt buộc) | `Check Listing Prerequisites` 202312 | dùng cấu hình shop |
| Trạng thái sau tạo | NORMAL bán ngay (hoặc UNLIST) | LISTING → **PENDING chờ duyệt** → ACTIVATE/FAILED (webhook) | Active; một số danh mục qua QC |
| Giới hạn phân loại | ≤2 tầng, <50 tổ hợp | ≤3 thuộc tính bán, VN ≤100 SKU | ~2 tầng, 20 option/tầng |
| Rate limit | chưa công bố; dùng batch_add_item | QPS động App×Shop, 1–3 req/s/shop; **trần 100 SP/ngày gian mới, 1.000/ngày sau** | lỗi 901/4154 khi nhanh, ~1 s |
| Quyền Hubsell | app 2040029 loại **ERP System** → add_item cho phép; thẩm định lại: chưa xác nhận | **`seller.product.write` đã bật 12/10**; token trước mốc phải nối lại gian | nhóm Product API; cần kiểm app 140639 / ISV 142085 có nhóm này chưa |

Trường bắt buộc tối thiểu để bán ngay (không nháp):
- Shopee: tên, mô tả text thuần (≤2.000 theo mẫu, HTML không), giá, cân nặng, kích thước (kênh SIZE_INPUT), ≥1 kênh
  vận chuyển, danh mục lá, 1–9 ảnh đã upload, đủ thuộc tính `mandatory`, tồn, thương hiệu nếu `is_mandatory`.
- TikTok: tên 25–255, mô tả HTML ≤10.000 (ảnh ≤30, URL TikTok), danh mục lá v2, 1–9 ảnh, `skus[]` (giá, tồn theo kho,
  seller_sku 6–50 ký tự), **cân nặng bắt buộc**, thuộc tính `is_required`, chứng chỉ nếu rules đòi (mỹ phẩm, thực phẩm).
- Lazada: danh mục lá, tên ≤255, **brand_id bắt buộc**, mô tả HTML ≤25.000 (ảnh URL Lazada), ≤8 ảnh ≤1 MB, SellerSku,
  giá, tồn, **cân nặng + 3 kích thước bắt buộc**, thuộc tính `is_mandatory`.

Tài liệu: Shopee https://open.shopee.com/documents/v2/v2.product.add_item?module=89&type=1 ·
https://open.shopee.com/documents/v2/v2.product.batch_add_item?module=89&type=1 ·
https://open.shopee.com/documents/v2/v2.product.category_recommend?module=89&type=1 ·
TikTok https://partner.tiktokshop.com/docv2/page/create-product-202309 ·
https://partner.tiktokshop.com/docv2/page/recommend-category-202309 ·
https://partner.tiktokshop.com/docv2/page/check-listing-prerequisites-202312 ·
https://partner.tiktokshop.com/docv2/page/rate-limits ·
Lazada https://open.lazada.com/apps/doc/doc?nodeId=30720&docId=120949 ·
https://open.lazada.com/apps/doc/api?path=%2Fimage%2Fmigrate ·
https://open.lazada.com/apps/doc/api?path=%2Fproduct%2Fcategory%2Fsuggestion%2Fget

## 5. Chỗ khó thật khi chép sàn X → sàn Y (và cách ISV xử lý)

1. **Danh mục không tương ứng** → gọi gợi ý của chính sàn đích (3 sàn đều có; TikTok nhận cả danh mục gốc sàn khác),
   cho khách xác nhận 1 lần, **lưu cặp danh mục nguồn → đích** theo chủ shop để lần sau tự điền.
2. **Thuộc tính bắt buộc khác nhau** → sau khi có danh mục đích, gọi attribute API, chỉ hiện form "điền thêm" cho
   trường bắt buộc còn thiếu; map tự động theo tên (Brand, Material, Origin…).
3. **Ảnh phải tải lại** → tải về 1 lần, chuẩn hóa 1:1 ≥800 px, ≤1 MB (Lazada), cache `image_id` theo gian.
4. **Mô tả**: TikTok/Lazada HTML, Shopee text → bộ chuyển HTML ↔ text giữ xuống dòng.
5. **Thương hiệu**: Shopee/Lazada có No Brand; TikTok brand phải ủy quyền.
6. **Phân loại**: nguồn 3 tầng sang Shopee/Lazada phải gộp tầng; >50 tổ hợp Shopee từ chối.
7. **Video, bảng size, chứng chỉ**: khác định dạng từng sàn → lát đầu bỏ, báo khách bổ sung trên sàn.
8. **Trần + duyệt**: TikTok 100 SP/ngày gian mới và PENDING chờ duyệt → kết quả phải báo "đang chờ sàn duyệt", không
   phải "xong"; hàng đợi theo gian 1–2 req/s, chạy nền (pg-boss, không mutex RAM — theo luật quy mô thương mại).

## 6. Nhận định cho Hubsell (em phản biện trước khi anh chốt)

**Về định vị:** đây là tính năng "quản lý bán hàng", không phải "trợ lý quảng cáo". Nhưng nó phục vụ định vị gián tiếp:
khách mở gian mới trên sàn khác nhanh hơn → có thêm tài khoản quảng cáo để trợ lý quản → đúng luật "Ads chỉ trên gian
đã nối app chính". Và 4 khách thử cùng đòi là tín hiệu thật, không phải suy đoán. **Em nghiêng về LÀM**, với 3 điều kiện:

1. **Nguồn = gian đã nối Hubsell**, đọc bằng API (`ChannelProduct` đã có sẵn: tên, mô tả, ảnh, phân loại, giá, SKU).
   **Không cào shop người khác** kiểu Ship Xanh/BigSeller: vi phạm điều khoản sàn, Hubsell là ISV Shopee đã duyệt
   (app 2040029) nên rủi ro bị thu hồi, chưa kể bản quyền ảnh. Nếu khách muốn "lấy hàng shop khác" thì đó là tool
   khác, không phải Hubsell.
2. **Khác biệt cạnh tranh** nằm ở 3 chỗ không ai có: chọn **nhiều gian nhiều sàn một lượt**; **gợi ý danh mục +
   thuộc tính bắt buộc** bằng API sàn đích (lưu cặp danh mục để tái dùng); **tự nối SKU kho** vì SKU nguồn giữ nguyên
   sang đích (đúng luật "khách phải đặt SKU giống nhau") → tồn kho đồng bộ ngay sau khi đăng, không cần bước nối tay
   như Salework/Ship Xanh.
3. **Đi 2 lát, lát 1 đủ dùng:**
   - **Lát 1 — chép 1 SP → N gian 3 sàn:** trang Hàng hóa › tab Sản phẩm trên sàn → nút "Sao chép sang gian khác" →
     hộp chọn gian đích (nhiều, cả 3 sàn) → bảng xem trước từng gian đích: danh mục gợi ý (chọn lại được), thuộc tính
     bắt buộc còn thiếu, cân nặng/kích thước, thương hiệu, kênh vận chuyển; ô thiếu tô vàng → "Đăng" → việc nền
     pg-boss theo gian → kết quả từng gian: Đã đăng / Chờ sàn duyệt / Lỗi (dịch mã lỗi sàn sang tiếng Việt, học bảng
     lỗi của Sapo) → SP mới tự nối SKU kho. Video, bảng size, chứng chỉ: bỏ, ghi chú "bổ sung trên sàn".
   - **Lát 2 — đăng hàng loạt:** tick N SP → cùng hộp chọn gian → bảng xem trước gom theo gian, "áp danh mục/thuộc tính
     cho các SP cùng loại" (mẹo UpBase), Shopee dùng `batch_add_item` 100 SP/task, TikTok tôn trọng trần 100/ngày.
   - Sau: chép từ kho Hubsell (SKU chưa lên sàn nào), nhập Excel.
4. **Khối lượng:** 3 adapter tạo SP + tải ảnh + danh mục/thuộc tính/thương hiệu/vận chuyển + hộp xem trước + hàng đợi
   + bảng lỗi ≈ 5–6 lát, khoảng 2–3 tuần làm việc — **lớn hơn mọi lát gần đây**, sẽ chen trước lát 3 định vị quảng cáo.
   Anh cân nhắc thứ tự.

## 7. Ba câu cần hỏi lại 4 khách trước khi code

1. Nguồn chép là **gian của chính anh/chị đã nối Hubsell**, hay **shop của người khác** trên sàn?
2. Đích thường là **cùng sàn** (thêm gian Shopee thứ 2) hay **sàn khác** (Shopee → TikTok/Lazada)? Mỗi lần bao nhiêu SP?
3. Sau khi đăng, anh/chị có cần Hubsell **đồng bộ tồn** cho SP mới luôn không, hay chỉ cần đăng xong?

Câu 1 quyết định có làm hay không (cào shop khác = không làm). Câu 2 quyết định lát 1 ưu tiên sàn nào. Câu 3 khẳng
định lợi thế nối SKU có đáng làm ngay ở lát 1 không.

## 8. Việc kiểm trước khi bắt tay (nếu anh chốt làm)

- [ ] Shopee: app 2040029 loại ERP System có gọi được `add_item` trên gian thật không (thử 1 SP UNLIST trên gian test,
      xóa ngay) — có cần thẩm định lại app?
- [ ] Lazada: app 140639 / ISV 142085 đã có nhóm Product API chưa (Console → App → API permissions).
- [ ] TikTok: đếm gian có `authorizedAt` trước 12/10 (phải nối lại gian mới có Product Modify) —
      `tiktokNeedsReauthForStockPush` đã có sẵn ở `integrations/tiktok/scopes.ts`.
- [ ] Số liệu prod: bao nhiêu chủ shop có ≥2 gian khác sàn (ứng viên dùng tính năng) — SQL `channels` nhóm theo owner.

## 9. Nguồn khảo sát đối thủ

- Ship Xanh: https://shipxanh.com/huong-dan-copy-dang-hang-loat-san-pham-shopee-sang-tiktok-shop-nhanh-mien-phi/ ·
  https://shipxanh.com/bang-gia-su-dung/ · https://docs.shipxanh.com/ · Chrome Store "Ship Xanh copy sản phẩm"
- Sapo: https://help.sapo.vn/huong-dan-dang-ban-da-san · https://apps.sapo.vn/marketplace-product-post ·
  https://help.sapo.vn/cac-van-de-thuong-gap-khi-dang-ban-san-pham-da-san · https://www.sapo.vn/bang-gia.html
- KiotViet: https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/retail-ban-online/ket-noi-san-tmdt/ ·
  https://www.kiotviet.vn/cach-dang-san-pham-len-tiktok-shop-tu-phan-mem-ban-hang-nhanh-nhat/
- Salework: docs + blog ở mục 3.4 · https://salework.net/copy-san-pham-tu-shopee-sang-lazada/
- UpBase: gitbook mục 3.5 · https://upbase.vn/phan-mem-quan-ly-ban-hang-shopee-lazada-tiktokshop/
- Nhanh: https://pos.manual.nhanh.vn/pos/kenh-ban/shopee/cau-hoi-thuong-gap · Haravan:
  https://help.haravan.com/docs/faqs/products/lam-sao-de-dang-san-pham-len-cac-gian-hang-san-thuong-mai-dien-tu/ ·
  Pancake: https://docs.pos.pages.fm/pos/thiet-lap-shop/kenh-ban/lien-ket-san-pham
- Tool khác: https://help.bigseller.com/vi/detailPage/2/1/5782/content ·
  https://support.autoshopee.com/autoshopee/sao-chep-da-san/tiktok/shopee-to-tiktok ·
  https://shopeelike.com/docs/goseller/dang-san-pham-len-tiktok-shop-sao-chep-tu-shopee-sang-tiktok-shop
- Video YouTube tìm được: Ship Xanh V3BIytSlFyA · KiotViet ZMqFa18zXf0 (30/09/2026) · Omisell dTH5y_KaRV8 ·
  Sapo 87SIJFS47H0, ORpLYcEBszw · Salework VU94-Q2IjH4 (đồng bộ SP về kho). Không bên nào trong Sapo/KiotViet/Salework
  có video chính thức riêng về sao chép/đăng hàng loạt.

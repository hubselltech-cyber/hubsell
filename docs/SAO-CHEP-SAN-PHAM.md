# Sao chép sản phẩm — chép 1 sản phẩm lên nhiều gian 3 sàn (thiết kế lát 1, 29/10/2026)

> Anh chốt 29/10/2026: làm cả 2 nguồn (bài trên gian đã nối + sản phẩm trong kho Hubsell), demo local trước, đặt
> làm mục con của "Trợ lý vận hành". Khảo sát đối thủ + API ở
> [KHAO-SAT-SAO-CHEP-SAN-PHAM-DANG-HANG-LOAT-29-10.md](KHAO-SAT-SAO-CHEP-SAN-PHAM-DANG-HANG-LOAT-29-10.md).

## 1. Phạm vi lát 1 (demo local)

- **Nguồn**: (a) một sản phẩm sàn trên gian đã nối (nhóm theo id sản phẩm sàn, gồm mọi phân loại), hoặc (b) một
  sản phẩm kho Hubsell (nhóm cha–con theo `groupKey`). KHÔNG cào shop người khác.
- **Đích**: nhiều gian cùng lúc, cả 3 sàn, trừ gian nguồn và gian OFFLINE.
- **Luồng một trang** (`/operations-assistant/copy-listing`): Bước 1 chọn nguồn → Bước 2 tick gian đích → "Xem trước"
  → bảng xem trước mỗi gian một dòng: danh mục gợi ý (đổi được), trường bắt buộc còn thiếu tô vàng (thuộc tính, cân
  nặng, kích thước, thương hiệu, vận chuyển), giá/tồn sửa được → "Đăng lên N gian" → kết quả từng gian: Đã đăng /
  Chờ sàn duyệt / Lỗi (câu tiếng Việt) → sản phẩm mới tự nối SKU kho.
- **Local chỉ có gian demo** (không token thật) → toàn bộ luồng chạy qua **adapter giả lập** có cây danh mục + luật bắt
  buộc mô phỏng đúng khác biệt 3 sàn (Shopee đòi kênh vận chuyển, TikTok đòi cân nặng + chờ duyệt, Lazada đòi thương
  hiệu + 3 kích thước). Adapter thật 3 sàn là **lát 1b**, kiểm trên gian thật (ANO/HPGear) sau khi anh duyệt UX.
- Bỏ ở lát 1: video, bảng size, chứng chỉ, mô tả có ảnh — kết quả ghi chú "bổ sung trên sàn".

## 2. Hợp đồng dữ liệu (`backend/src/marketplace/listing/types.ts`)

- `NormalizedListing`: `title, description, images[], categoryId?, categoryPath?, brandName?, weightGrams?,
  dimensionsCm?{length,width,height}, options[]{name, values[]}, variants[]{sku, name, price, stock, imageUrl?},
  attributes[]{name, value}` — chuẩn trung lập, cả 2 nguồn đều quy về đây.
- `ListingAdapter` (mỗi sàn một bản + mock): `fetchListing(channel, itemId)`, `recommendCategory(channel, listing)`,
  `searchCategories(channel, q)`, `getCategoryRequirements(channel, categoryId)` → thuộc tính bắt buộc + cờ cần cân
  nặng/kích thước/thương hiệu/vận chuyển + giới hạn tên/ảnh/phân loại, `getLogistics(channel)`,
  `searchBrands(channel, categoryId, q)`, `createListing(channel, draft)` → `{remoteItemId, status, variants[]}`.
- Registry `getListingAdapter(channel)`: có `refreshToken` → adapter thật của sàn (lát 1b), còn lại → mock.

## 3. Bảng

- `listing_copy_jobs`: `id, userId (chủ shop), createdById, sourceType CHANNEL|PRODUCT, sourceChannelId?, sourceItemId?,
  sourceProductGroupKey?, sourceTitle, sourceImageUrl?, source Json (NormalizedListing chụp lúc tạo), status
  DRAFT|SUBMITTED|DONE|PARTIAL|FAILED, createdAt, submittedAt?, finishedAt?`.
- `listing_copy_targets`: `id, jobId, channelId, categoryId?, categoryName?, categoryConfidence?, attributes Json,
  brandId?, brandName?, logisticIds Json, weightGrams?, dimensionsCm Json?, priceAdjustPercent (mặc định 0), stock?,
  missing Json (mã trường còn thiếu), status PENDING|QUEUED|RUNNING|LISTED|PENDING_REVIEW|FAILED, error?,
  remoteItemId?, remoteUrl?, listedAt?, attempts`.
- Cả 2 bảng ENABLE ROW LEVEL SECURITY (luật bảng mới).

## 4. Hàng đợi

- `listing.copy` policy **standard** (không stately): mỗi gian đích một việc `{targetId}`, retry 2, hết hạn 600 s. Việc
  ngắn (vài giây: tải ảnh + tạo SP) nên chạy trong handler được, không cần bộ chạy riêng như đẩy tồn.
- Hàng đợi chưa sẵn sàng (local chưa áp migration) → chạy tại chỗ bằng `setImmediate` để demo không kẹt.
- Thành công → tạo `ChannelProduct` cho gian đích (channelSku = SKU nguồn, `productId` = kho nguồn nếu có) → tồn kho
  đồng bộ ngay theo luật mã trùng.

## 5. API `/api/sao-chep-san-pham` (tránh chữ ads — adblock)

- `GET /sources?type=channel&channelId=&search=&page=` → sản phẩm sàn nhóm theo id; `type=product` → nhóm kho.
- `POST /jobs {sourceType, sourceChannelId?, sourceItemId?, sourceGroupKey?, targetChannelIds[]}` → chụp nguồn, tạo
  job + target, mỗi target gọi gợi ý danh mục + luật bắt buộc → `missing[]`.
- `GET /jobs?page=` lịch sử · `GET /jobs/:id` chi tiết.
- `PATCH /jobs/:id/targets/:tid` sửa danh mục / thuộc tính / cân nặng / kích thước / thương hiệu / vận chuyển / giá / tồn
  → tính lại `missing`.
- `GET /jobs/:id/targets/:tid/categories?q=` · `GET .../requirements?categoryId=` · `GET .../logistics` ·
  `GET .../brands?q=`.
- `POST /jobs/:id/submit` → target đủ điều kiện → QUEUED + xếp việc; target còn thiếu bị bỏ qua và báo.
- Quyền: lá `operations.copy-listing` (chủ shop mặc định có; nhân viên phải được gán).

## 6. Giao diện

- Mục con "Sao chép sản phẩm" dưới Trợ lý vận hành; trang tab `Sao chép` | `Lịch sử` (PageHeaderBand + PageTabs).
- Theo khẩu vị bảng chuẩn: mỗi gian một dòng, tên gian đứng trước nút; chip lọc; mã SKU hiện + nút sao chép; lý do
  lỗi mỗi ý một dòng.

## 7. Lát sau

- 1b: adapter thật Shopee (add_item + upload_image + category_recommend + attribute_tree + logistics), TikTok
  (Create Product + upload image + recommend + rules), Lazada (create + image/migrate + brands) — kiểm trên gian thật.
- 2: tick N sản phẩm → cùng hộp chọn gian, áp danh mục cho sản phẩm cùng loại, Shopee batch_add_item.
- 3: nhập Excel; chép từ kho có trình soạn đầy đủ (mô tả, nhiều ảnh, thuộc tính theo sàn).

## 8. Đã làm — lát 1 demo local (29/10/2026, chưa push)

- **Backend:** `prisma` 2 bảng `listing_copy_jobs` / `listing_copy_targets` + 3 enum (migration
  `20261029180000_listing_copy`, DB dev áp bằng `prisma db execute` vì kẹt bản ghi lỗi cũ `fee_audit`); hàng đợi
  `listing.copy` (policy standard, retry 2, hết hạn 600 s) + worker `workers/listing-copy-queue.ts`; hợp đồng
  `marketplace/listing/types.ts`, luật thuần `rules.ts` (+ test 7 ca), adapter giả lập `mock-listing-adapter.ts`
  (12 lá danh mục 3 tầng, thuộc tính theo lá, Shopee đòi vận chuyển, Lazada đòi thương hiệu + kích thước, TikTok
  trả "Chờ sàn duyệt", tên chứa "LỖI" → sàn từ chối), registry `registry.ts` (lát 1b trỏ gian có token sang adapter
  thật); nghiệp vụ `services/listing-copy/source.ts` (2 nguồn → NormalizedListing, nhóm theo id sản phẩm sàn /
  groupKey kho) + `service.ts` (createJob / updateTarget / updateJobSource / submitJob / processTarget / nối SKU);
  route `routes/listing-copy.ts` mount `/api/sao-chep-san-pham` với lá quyền `operations.copy-listing`.
- **Frontend:** mục con "Sao chép sản phẩm" dưới Trợ lý vận hành; trang
  `components/operations/copy-listing/copy-listing-page.tsx` (tab Sao chép | Lịch sử; bước 1 nguồn, bước 2 gian
  đích, bảng xem trước mỗi gian một dòng, ô sửa mở rộng theo dòng, poll 2 s khi đang đăng); API client trong
  `lib/api.ts` (khối `COPY_LISTING_BASE`), query key `qk.copyListing*`.
- **Đã kiểm local** (tài khoản demo@hubsell.tech, gian giả lập Shopee → Lazada): gợi ý danh mục 95 %, thiếu đúng
  5 ô Lazada; điền xong → QUEUED → worker pg-boss → LISTED, `ChannelProduct` mới trên gian đích giá +10 % và
  `productId` nối kho; đăng lại cùng SP → `sku_exists`; tên "LỖI" → FAILED kèm câu lý do, sửa tên → đăng lại OK
  (lượt 2); nguồn kho Hubsell → báo thiếu mô tả/ảnh (kho chưa có 2 trường này — lát 3).
- **Chạy thử trong app:** cert tự ký HTTPS :4000 bị Browser pane từ chối → thêm cấu hình `backend-http` (:4010,
  HTTP, vai web) + `frontend-http` (:3011, `NEXT_PUBLIC_API_URL` trỏ :4010) trong `.claude/launch.json`; backend
  HTTPS :4000 (vai all) vẫn chạy để nhận việc hàng đợi.
- **Chưa làm:** adapter thật 3 sàn (lát 1b), hộp tìm danh mục theo từ khóa (hiện NativeSelect vì cây mock nhỏ),
  tải ảnh thật, trình soạn kho (mô tả + nhiều ảnh), đăng hàng loạt (lát 2).

## 9. Lát 2 — đợt nhiều sản phẩm × nhiều gian (29/10/2026 tối, demo local, chưa push)

Anh chốt: *"Lát 2 là chọn nhiều sản phẩm và nhiều gian hàng, chọn được cả gian hàng TikTok nữa."*

- **Đợt** = N job cùng `listing_copy_jobs.batchId` (migration `20261029210000_listing_copy_batch`; job lẻ cũ có
  batchId = id). Hàng đợi vẫn từng cặp sản phẩm × gian → đợt 50 sản phẩm × 3 gian = 150 việc chạy lần lượt, sản phẩm
  thiếu thông tin đứng lại không chặn sản phẩm khác. Mỗi đợt tối đa 50 sản phẩm; tạo job theo lô 3 (mỗi job gọi gợi ý
  danh mục cho từng gian).
- **API** (`services/listing-copy/batch.ts`): `POST /batches {sourceType, sourceChannelId?, sourceKeys[],
  targetChannelIds[]}` · `GET /batches` (nhóm theo batchId, mỗi gian một chip trạng thái "xấu nhất") · `GET /batches/:id`
  · `POST /batches/:id/submit` · `POST /batches/:id/targets/:tid/apply` = **"Áp cho sản phẩm còn lại"**: chép danh
  mục / thuộc tính / thương hiệu / vận chuyển / cân nặng / kích thước / % giá / tồn của một gian sang mọi gian cùng
  gian hàng trong đợt còn chờ hoặc lỗi, rồi tính lại thiếu (mẹo UpBase).
- **UI**: bước 1 tick nhiều (ô chọn tất cả trang, đếm "Đã chọn N", giữ qua trang/tìm); bước 2 tick nhiều gian (có
  TikTok); dòng tổng "N sản phẩm × M gian = N×M lượt đăng"; bảng đợt: mỗi sản phẩm một dòng tiêu đề (sửa tên/mô tả
  mở rộng), dưới là mỗi gian một dòng; ô sửa gian có nút "Áp cho k sản phẩm còn lại"; nút "Đăng k lượt đủ điều kiện";
  chip đếm Đã đăng / Chờ sàn duyệt / Lỗi; lịch sử theo đợt.
- **Local thêm gian TikTok giả lập** cho demo@hubsell.tech (`Channel` id `cmvt_demo_tiktok_sunny01`, không token) để
  thấy đủ 3 sàn.
- **Đã kiểm qua API**: đợt 3 sản phẩm Shopee → TikTok + Lazada: 6 lượt, gợi ý danh mục đúng cả 6; sửa 1 gian TikTok +
  1 gian Lazada rồi "áp" → 2 + 2 sản phẩm còn lại nhận cấu hình; đăng lần 1: Lazada 3/3 Đã đăng, TikTok 3 đứng lại vì
  tên < 25 ký tự (đúng luật); sửa tên 3 sản phẩm → đăng lần 2: TikTok 3/3 Chờ sàn duyệt; lịch sử gom thành 1 đợt
  "3 SP × 2 gian".
- **Anh góp ý ngay trên demo (tối 29/10):** dưới bảng nguồn phải có **ô chọn số sản phẩm/trang** (10/20/50/100, mặc
  định 20) bên trái và **thanh phân trang luôn hiện** (Trang x/y · Trước · Sau) bên phải — `PagerFooter` dùng chung
  cho bảng nguồn và lịch sử.


## 10. Lát 1b — adapter thật 3 sàn (29/10/2026 tối, ĐÃ CODE, CHƯA KIỂM TRÊN GIAN THẬT, chưa push)

Anh chốt "Làm adapter thật". Local không có gian thật (chỉ gian seed không token) nên mã viết theo tài liệu API đã
đọc 29/10 (khảo sát mục 4), biên dịch sạch, hàm thuần có test; **mọi lời gọi sàn thật còn phải kiểm trên prod**.

- **Registry** (`marketplace/listing/registry.ts`): gian có `refreshToken` (TikTok thêm `shopCipher`) → adapter thật
  của sàn; gian không token → giả lập. Gian thật KHÔNG BAO GIỜ rơi vào giả lập.
- **Cờ bật**: ~~LISTING_COPY_ENABLED / NEXT_PUBLIC_LISTING_COPY~~ — anh chốt 29/10 chiều *"cứ đẩy thật lên, trên
  sidebar mở ngoặc demo"* → bỏ cờ, mục sidebar ghi **"Sao chép sản phẩm (demo)"**, prod mở ngay cho mọi chủ shop
  có lá quyền; bỏ chữ "(demo)" khi 3 sàn kiểm xong.
- **Shopee** (`integrations/shopee/listing-api.ts` + `shopee-listing-adapter.ts`): get_category (đệm 6 h) ·
  category_recommend · get_attribute_tree (mandatory → thuộc tính bắt buộc; chọn → value_id, gõ tay → value_id 0 +
  tên) · get_brand_list (is_mandatory; No Brand id 0) · logistics/get_channel_list · media_space/upload_image
  (multipart "image", scene normal) · add_item (NORMAL, giá/tồn phân loại đầu, weight kg, dimension, logistic_info)
  → chờ 5,5 s → init_tier_variation (≤2 nhóm, tier_index từ tên phân loại). Mô tả: HTML → text.
- **TikTok** (`integrations/tiktok/listing-api.ts` + `tiktok-listing-adapter.ts`): categories v2 locale vi-VN (đệm)
  · categories/recommend (title + mô tả HTML) · attributes (bỏ SALES_PROPERTY; `is_requried` docs viết sai chính tả,
  nhận cả 2) · rules (package_dimension.is_required) · brands · images/upload multipart (ký KHÔNG gồm body, field
  `data`, use_case MAIN_IMAGE) · warehouses → kho bán mặc định · products (save_mode LISTING, sales_attributes theo
  name/value_name, package_weight kg, giá chuỗi VND) → "Chờ sàn duyệt". Gian ủy quyền trước 12/10 → báo nối lại.
- **Lazada** (`integrations/lazada/listing-api.ts` + `lazada-listing-adapter.ts`): category/tree/get (đệm, duỗi lá)
  · product/category/suggestion/get · category/attributes/get (is_mandatory, is_sale_prop = khóa nhóm phân loại) ·
  category/brands/query · image/migrate từng ảnh (≤8) · product/create payload JSON (Attributes name/description
  HTML/short_description/brand = TÊN, Skus SellerSku/price/quantity/kiện/kg/saleProp) · product/item/get.
- **Hàm thuần dùng chung** `variant-map.ts` (+ test 5 ca): tách tên phân loại, tier_index, cặp nhóm–giá trị, gram→kg,
  text↔HTML. Ảnh: `lib/image-fetch.ts` tải về buffer (≤12 MB, data URI OK), chưa đổi cỡ/nén.
- **Dò thử chỉ đọc trên prod** (quản trị nền tảng, không qua cờ bật): `GET /api/sao-chep-san-pham-probe?channelId=…`
  chạy fetchListing / recommendCategory / searchCategories / getCategoryRequirements / searchBrands / getLogistics trên
  một gian thật, trả từng bước ok/lỗi + mẫu dữ liệu. Chạy trong DevTools app.hubsell.tech (tài khoản dev@hubsell.tech):
  `fetch('https://hubsell-backend-sg.onrender.com/api/sao-chep-san-pham-probe?channelId=ID',{headers:{Authorization:'Bearer '+localStorage.hubsell_token}}).then(r=>r.json()).then(d=>console.log(JSON.stringify(d,null,2)))`
  (backend prod là Render Singapore, KHÔNG phải api.hubsell.tech).

### Việc còn lại trước khi mở cho khách
1. Push → prod (cờ tắt, khách không thấy). Chạy probe trên 1 gian Shopee (ANO/HPGear), 1 gian TikTok, 1 gian Lazada;
   sửa tên trường theo phản hồi thật (chắc chắn có lệch — docs với thực tế hay khác).
2. Shopee: xác nhận app 2040029 (ERP System) gọi được add_item; thử tạo 1 sản phẩm UNLIST trên gian test rồi xóa.
   Lazada: kiểm app có nhóm Product API. TikTok: trần 100 SP/ngày gian mới + chờ duyệt.
3. Ảnh: thêm đổi cỡ/nén (Lazada ≤1 MB) khi gặp lỗi thật.
4. ~~Bật cờ~~ đã mở thật; ~~nhãn demo~~ BỎ tối 29/10 (Shopee DarkMan + TikTok ANO đăng thật thành công, anh chốt "anh sẽ test dần"); theo dõi log `[listing-copy]` + báo 4 khách đã hỏi.

## 11. Góp ý của anh sau khi thử prod lần 1 (29/10/2026 chiều) — ĐÃ SỬA

Anh gửi 2 ảnh + 4 ý: (1) lọc chọn sàn → chọn shop vì người nhiều shop rất cực; (2) giao diện nuốt chữ (ô "20 / trang"
cụt); (3) danh mục dồn vào một ô không rõ, mỗi sàn xếp danh mục khác nhau → muốn xổ dạng cha → con; (4) kênh vận
chuyển "hình như sàn phân chứ không tới lượt shop chọn".

- **(1) Lọc sàn → gian.** Bước 1: hai ô `Sàn` → `Gian` (ô gian chỉ liệt kê gian của sàn đã chọn; "Mọi sàn" thì ghi kèm
  tên sàn). Bước 2: chip `Tất cả (n) · Shopee (n) · TikTok (n) · Lazada (n)` + ô tìm tên gian (hiện khi >5 gian) +
  dòng "Chọn tất cả k gian đang hiện" + "Đã chọn N gian · Bỏ chọn".
- **(2) Nuốt chữ.** `PagerFooter` ô số/trang `w-24` → `w-32` (chữ "100 / trang" + mũi tên không còn cụt).
- **(3) Danh mục xổ cha → con theo cây của CHÍNH sàn đích.** Adapter thêm `getCategoryTree(channel)` trả TOÀN BỘ cây
  phẳng `{id, name, parentId, leaf}` (Shopee get_category parent_category_id/has_children; TikTok parent_id/is_leaf;
  Lazada duỗi `category/tree/get`; giả lập dựng từ đường dẫn mẫu). Route
  `GET /jobs/:id/targets/:tid/category-tree?parentId=` → con của một nút; `?selectedId=` → `path` + `levels` từng cấp
  để điền sẵn. FE `CategoryCascade`: mỗi cấp một ô, nút chưa phải lá có dấu `›`, dòng đường dẫn dưới ô, chọn dở →
  "còn thiếu"; đổi danh mục → thuộc tính nạp lại khi lưu. Gợi ý của Hubsell vẫn điền sẵn (ghi "Hubsell gợi ý · độ khớp
  x%"). Sửa luôn 2 lỗi: `updateTarget` kiểm danh mục qua `searchCategories` cắt 300 lá → giờ kiểm trên cả cây + bắt
  buộc lá; ô cấp bị kẹt mờ sau khi lưu (effect huỷ giữa chừng không trả `loading`) → cleanup trả về false, và chỉ xoá
  nháp SAU khi nạp lại đợt.
- **(4) Kênh vận chuyển.** Căn cứ API: Shopee `add_item` BẮT BUỘC `logistic_info` theo từng sản phẩm (Seller Centre cũng
  có mục bật/tắt kênh cho từng SP, mặc định theo cài đặt gian); TikTok và Lazada không có tham số kênh khi tạo SP —
  sàn tự phân. Nên: Shopee mặc định tick TẤT CẢ kênh gian đã bật, hiện một dòng "theo cài đặt gian — n kênh đang bật
  trên sàn · Tuỳ chỉnh" (xổ danh sách chỉ khi khách bấm hoặc đang thiếu); kênh chưa bật trên sàn không hiện nữa;
  TikTok/Lazada không có mục này. Khớp [[feedback-khach-can-don-gian]].
- **Phát hiện thêm từ ảnh 2 (thuộc tính Shopee tên tiếng Anh, toàn ô gõ tay):** `get_attribute_tree` trả giá trị dưới
  `attribute_value_list[].display_name/name` (bản cũ `display_value_name/original_value_name`) và gói
  `input_validation_type` trong `attribute_info` → trước đọc trượt nên mọi thuộc tính thành ô text. Đã nhận cả 2 dạng
  (`attrValueName`). Tên thuộc tính tiếng Anh dù đã gửi `language=vi` — Shopee tự quyết, chưa xử lý.
- Kiểm local (gian giả lập): cascade điền sẵn 3 cấp, đổi Túi ví › Túi xách › Túi tote → lưu → dòng hiện đường dẫn mới;
  Shopee hiện "3 kênh đang bật · Tuỳ chỉnh"; Lazada/TikTok không có mục vận chuyển; tsc + eslint + vitest (12 ca) sạch.

## 12. Góp ý lần 2 của anh trên prod (29/10/2026 chiều muộn, gian thật ANO → DarkMan + and.not.or) — ĐÃ SỬA

4 ý: (1) giao diện phẳng, vùng đang làm đồng màu với các gian không làm, nút sổ xuống mờ; (2) ghi hẳn "Sửa bài
đăng"; (3) mở rộng thông tin bài đăng mà vẫn đẹp, nhìn tổng quát để sửa; (4) ảnh kèm bài + ảnh chèn trong mô tả có
lấy được không.

- **(1) Phân tầng bảng đợt.** Dòng sản phẩm = dải `slate-100` + viền trên 2px + tên semibold (tách từng sản phẩm);
  dòng gian trắng; dòng ĐANG mở (gian hoặc bài đăng) nhận `ROW_ACTIVE` = vạch trái 3px `border-l-primary` (theo 3
  theme accent) + nền slate-100; khung sửa là THẺ TRẮNG nổi (`PANEL`: bo 12px, viền, bóng nhẹ) đặt trong ô nền xám
  → vùng làm việc tách hẳn các dòng còn lại. Dòng lỗi đỏ cũng nhận vạch khi đang mở.
- **(2) Nút chữ thay mũi tên.** Dòng sản phẩm: `Sửa bài đăng` (hết sửa được → `Xem bài đăng`), mở → `Thu gọn`.
  Dòng gian: còn thiếu → nút ĐẶC `Bổ sung` (bắt mắt, đúng việc cần làm); đủ → `Sửa`; đã đăng → `Xem`. Cột nút nới
  5% → 12% (bảng `table-fixed` từng tràn ngang khi đổi sang nút chữ).
- **(3) Khung "Sửa bài đăng" mở rộng.** 2 cột: trái lưới ảnh 3×3 (ảnh đầu gắn nhãn "Bìa", báo "sàn nhận n ảnh đầu"
  khi vượt trần thấp nhất của các gian đích); phải tên (đếm ký tự + khoảng cho phép = max(titleMin)–min(titleMax) của
  các sàn đích, lệch thì tô vàng) + mô tả cao 6–14 dòng kéo được (đếm ký tự + trần). Dưới: bảng phân loại (tên · mã
  SKU + copy · giá nguồn · tồn nguồn, trần 12 dòng, thiếu SKU tô vàng) + chip thuộc tính nguồn. Nút `Lưu bài đăng`.
- **(4) Ảnh — trả lời theo API:** ảnh KÈM BÀI (ảnh bìa + ảnh phụ, Shopee ≤9/TikTok ≤9/Lazada ≤8) ĐÃ chép: đọc
  `image_url_list`/`main_images`/`images` của nguồn, tải về, upload lại lên gian đích. Ảnh CHÈN TRONG MÔ TẢ chưa:
  Shopee để ở `description_info.extended_description.field_list` (type image, image_id/image_url), TikTok/Lazada là
  thẻ `<img>` trong HTML mô tả; chiều đọc lấy được, chiều ghi phải upload lại ảnh lên gian đích rồi ghép vào mô tả
  (Shopee `description_type: extended` + `field_list`, TikTok upload `use_case DESCRIPTION_IMAGE` rồi `<img src>`,
  Lazada `image/migrate` rồi `<img src>`). Video không chép (3 sàn đều phải upload riêng). → Lát tiếp theo nếu anh
  chốt; khung Sửa bài đăng đã ghi chú "Ảnh chèn trong mô tả và video chưa chép theo".
- Kiểm local gian giả lập: đợt Váy hoa nhí → mở Sửa bài đăng (ảnh, tên 20 ký tự · sàn nhận 25–255 tô vàng, mô tả,
  bảng phân loại), mở Bổ sung gian Lazada (vạch trái + thẻ trắng), không tràn ngang (bảng 1284/1285 px); tsc + eslint
  sạch.

## 13. Lát "ảnh chèn trong mô tả" (29/10/2026 tối, anh "Làm luôn") — ĐÃ CODE, CHƯA KIỂM GIAN THẬT

- **Hợp đồng:** `NormalizedListing.descriptionImages: string[]` — ảnh chèn trong mô tả của NGUỒN theo thứ tự; `description`
  vẫn là chữ thuần. Khi đăng: upload lại từng ảnh lên gian đích rồi ghép vào CUỐI mô tả (chữ trước, ảnh sau — không giữ
  vị trí xen kẽ chữ–ảnh như bài gốc; đổi lại khách sửa chữ trong một ô text mà không vỡ ảnh). Trần `MAX_DESCRIPTION_IMAGES`
  = 12 (Shopee docs extended_description ≤12; TikTok/Lazada không nêu → tự chọn cùng mức). Job cũ không có trường → `asListing`
  đặt `[]`.
- **Chiều đọc:** Shopee `description_info.extended_description.field_list` (field_type image → image_info.image_url; text gom
  phần còn lại); TikTok/Lazada mô tả HTML → `extractHtmlImages()` (variant-map.ts) tách `<img src>` (bỏ data URI + trùng) rồi
  `htmlToText`. Nguồn kho Hubsell + nguồn bảng ChannelProduct: `[]`. Giả lập: 2 ảnh mẫu để soi màn hình.
- **Chiều ghi:** Shopee `upload_image` scene `desc` → `add_item` `description_type: "extended"` + `description_info.
  extended_description.field_list = [text, image…]` (vẫn gửi `description` chữ thuần); TikTok `images/upload` use_case
  `DESCRIPTION_IMAGE` → lấy `url` trả về ghép `<p><img src></p>` cuối mô tả (không có url thì bỏ ảnh + log); Lazada
  `image/migrate` từng ảnh → `<img src>` cuối mô tả HTML. Hàm `appendHtmlImages()`.
- **Màn hình:** khung Sửa bài đăng có lưới "Ảnh trong mô tả (n) · chép theo, xếp cuối mô tả trên gian đích"; ghi chú chỉ
  còn "Video không chép theo". Probe trả thêm `descriptionImages` (số ảnh) ở bước fetchListing.
- Test `variant-map.test.ts` +1 ca (tách/ghép ảnh); tsc + vitest 13 ca + eslint sạch; local gian giả lập hiện 2 ảnh mẫu.
- ⏳ Kiểm gian thật: chạy probe xem `descriptionImages` > 0 trên 1 SP Shopee có mô tả mở rộng; thử đăng 1 SP có ảnh mô tả
  lên gian test từng sàn (Shopee extended có thể đòi text ≥ 25 ký tự mỗi ô và ảnh desc đúng cỡ — sửa theo lỗi thật).

## 14. Lỗi thật đầu tiên trên prod + Việt hóa cho người bán (29/10/2026 tối muộn) — ĐÃ SỬA, kiểm local

**Anh báo (ảnh):** khách chép TikTok → Shopee, dòng gian đích đỏ toàn tiếng Anh
`Shopee add_item lỗi: product.error_param — invalid AddItemRequest.Dimension … invalid Dimension.PackageLength: value must
be greater than 0`; khung Bổ sung thuộc tính toàn tiếng Anh (pack type, Region of Origin, Material…), khách không biết ô
nào bắt buộc.

**Gốc lỗi (đọc mã, không đoán):** TikTok `package_dimensions` trả CHUỖI `"0"` khi gian không khai kích thước; adapter
kiểm `d?.length ?` — chuỗi `"0"` là truthy → lưu `dimensionsCm {0,0,0}`; `asDims` ở service và route PATCH cũng ép
`Number(x) || 0` → `{0,0,0}`; adapter Shopee gửi `dimension` hễ object khác null → sàn từ chối cả gói. Màn hình lại
hiện ô trống (`dims[k] || ""`) nên khách không thấy gì để sửa. Shopee không bắt buộc kích thước (`dimensionsRequired
false`) nên `computeMissing` cũng im.

**Sửa 3 lớp (`rules.ts`):**
- `normalizeDims(v)` — chuẩn hóa từ MỌI nguồn (API sàn, JSON bảng, body FE): cả 3 số ≤ 0 / không phải số → `null`; có ít
  nhất một số > 0 → giữ. Dùng ở `fetchListing` 3 adapter, `asDims` (service — dòng cũ `{0,0,0}` trong bảng tự về null),
  route PATCH.
- `dimsComplete(d)` — đủ 3 số > 0 mới gửi `dimension` (Shopee) / `package_dimensions` (TikTok). Lazada vẫn bắt buộc →
  `computeMissing` chặn trước.
- `computeMissing`: điền DỞ (1–2 số) → mã `dimensions` dù sàn không bắt buộc; nhãn đổi "Kích thước kiện chưa đủ 3 số
  (Dài × Rộng × Cao)". FE: xóa hết 3 ô → gửi `null`.
- Test `rules.test.ts` +2 ca (điền dở / chuỗi "0" / bảng 0,0,0).

**Dịch lỗi sàn — `marketplace/listing/error-text.ts` (thuần, test `error-text.test.ts`):** `humanizeListingError(sàn, raw)`
khớp TỪ KHÓA trong thông điệp (không theo mã — 3 sàn 3 kiểu mã): ủy quyền → quá tải/mạng → kích thước → cân nặng → ảnh →
tên → mô tả → thương hiệu → danh mục → vận chuyển → SKU trùng → giá → tồn → thuộc tính bắt buộc → phân loại → tham số
chung. Ghi `target.error` = dòng 1 câu tiếng Việt "Shopee từ chối: … — sửa ở đâu" + `\n` + nguyên văn sàn. Câu Hubsell tự
viết (có dấu tiếng Việt sau khi bỏ tiền tố "Shopee add_item lỗi:") giữ nguyên. Không khớp → câu chung + nguyên văn.
FE `splitListingError` → dòng đỏ tiếng Việt + `<details>` "Chi tiết kỹ thuật sàn trả về" (chữ nhỏ mono, để gửi hỗ trợ).
Log worker `[listing-copy]` vẫn in nguyên văn.

**Tên thuộc tính tiếng Việt — `attribute-names-vi.ts`:** từ điển ~300 tên Anh → Việt (Region of Origin → Xuất xứ,
pack type → Kiểu đóng gói, Sleeve Length → Độ dài tay áo, Manufacturer/trader name → Tên nhà sản xuất / đơn vị kinh
doanh…); áp ở `attrDef` của 3 adapter — chỉ đổi NHÃN, id + giá trị chọn gửi sàn giữ nguyên; tên đã có dấu → giữ; lạ →
giữ tên sàn. Shopee đã gửi `language=vi` ở get_attribute_tree/get_brand_list/get_category nhưng thuộc tính vẫn về tiếng
Anh (ảnh anh gửi) → từ điển là lưới đỡ. Giá trị chọn (Cotton, Polyester…) KHÔNG dịch vì phải khớp `value_id` khi đăng.

**Khung Bổ sung (FE `copy-listing-page.tsx`):** viên đỏ nhạt "Bắt buộc" cạnh nhãn Danh mục / Cân nặng / Thương hiệu (khi
sàn đòi) / Kích thước (Lazada, TikTok theo rule) / Kênh vận chuyển (Shopee) / thuộc tính `required`; thuộc tính bắt buộc
xếp TRƯỚC; dòng dẫn "Thông tin {sàn} hỏi thêm cho danh mục này — N ô có nhãn Bắt buộc phải điền mới đăng được; ô còn lại để
trống vẫn đăng được, có thì khách dễ tìm thấy hàng hơn"; ghi chú ngắn dưới ô (cân nặng ví dụ 250, kích thước "không bắt
buộc, nhập thì đủ 3 số", % giá, tồn); placeholder "Nhập số / Nhập chữ"; "No Brand" hiện "Không có thương hiệu (No Brand)"
(`brandLabel`, giá trị gửi sàn giữ "No Brand"). Bẫy: ô nằm trong `TableCell` (whitespace-nowrap) → ghi chú + dòng lỗi phải
`whitespace-normal`, không thì tràn sang cột bên / sinh cuộn ngang (đã gặp, đã sửa).

**Kiểm:** vitest 21 ca (3 tệp), tsc BE + FE, eslint FE sạch; local (backend-http 4010 + frontend-http 3010, demo@) nhập Dài
20 bỏ Rộng/Cao → chip "Kích thước kiện chưa đủ 3 số"; gán lỗi Shopee thật vào 1 target → dòng đỏ tiếng Việt + chi tiết
mono xuống dòng, không cuộn ngang. ⏳ Prod: khách thử lại cặp TikTok → Shopee đó (kích thước nay về null → Shopee không
nhận `dimension`); nếu sàn còn từ chối vì kênh vận chuyển `fee_type SIZE_INPUT` đòi kích thước thì thêm luật
`dimensionsRequired` theo kênh đã chọn (chưa làm — chưa có bằng chứng).

## 15. Lỗi thật lần 2 trên prod (29/10/2026 ~19:51, anh thử ANO → DarkMan Shopee + ANO Official TikTok) — ĐÃ SỬA

Nguyên văn đọc từ log worker Render (`[listing-copy]`, Chrome của anh):
- **TikTok** `code 36009004: Unexpected identifier. The 'shop_cipher' query parameter is not required for this request` —
  `images/upload` là API cấp app, Hubsell gửi thừa `shop_cipher` → sàn từ chối ngay bước upload ảnh (chưa tới create
  product). Sửa: `tiktok/listing-api.ts uploadProductImage` bỏ `shop_cipher` khỏi query (chữ ký tính lại theo query mới).
  Bộ dịch lỗi trước đó dịch nhầm thành "thuộc tính bắt buộc" vì khớp chữ `required` trong "not required" → regex
  `(?<!not )required` + luật mới "Lỗi ở phía Hubsell khi gọi sàn (tham số API)… báo Hubsell" đứng đầu bảng.
- **Shopee** `product.error_busi — The merchant/shop has multi warehouse, please input location id` — gian DarkMan bật
  nhiều kho; add_item / init_tier_variation bắt buộc `seller_stock[].location_id`. Sửa: `shopee/listing-api.ts`
  `getWarehouses()` (shop/get_warehouse_detail, đệm 1 giờ) + `pickStockLocationId()` = kho LẤY HÀNG (type 1) đầu danh
  sách (docs không có cờ kho mặc định; nhiều kho lấy hàng → log cảnh báo tên+id để dò). Adapter gửi
  `{location_id, stock}` ở cả add_item lẫn model của init_tier_variation; gian một kho (không location_id) gửi stock trần
  như cũ. Luật dịch riêng "Gian Shopee bật nhiều kho nên sàn đòi mã kho…".
- Test error-text +1 ca (22 ca). ⏳ anh bấm Đăng lại 2 gian đó trên prod sau deploy; TikTok có thể lộ lỗi kế tiếp ở bước
  create product (thuộc tính 3 ô bắt buộc đã điền, kho bán chọn `is_default`); Shopee kiểm tồn vào đúng kho DarkMan muốn.

## 16. Sửa giá + tồn từng phân loại trong khung Sửa bài đăng (29/10/2026 tối muộn, anh yêu cầu) — ĐÃ CODE, kiểm local

- **Kết quả prod sau mục 15:** Shopee DarkMan ĐĂNG ĐƯỢC; TikTok ANO Official sang "Chờ sàn duyệt" (PENDING_REVIEW). Anh
  khoanh cột Giá nguồn / Tồn nguồn: "cần bổ sung phần này để cho khách quyền được sửa".
- **Thiết kế:** giá / tồn từng phân loại là thuộc tính của NGUỒN đã chụp (như tên, mô tả) → sửa ở khung Sửa bài đăng,
  áp cho MỌI gian đích của sản phẩm; "% điều chỉnh giá" và "Tồn đăng" ở dòng gian vẫn áp CHỒNG lên số nguồn đã sửa (gian
  nào muốn khác thì chỉnh ở đó). SKU KHÔNG sửa (luật khớp mã kho).
- **Backend:** `updateJobSource` nhận `variants: [{index, price?, stock?}]` theo VỊ TRÍ trong `source.variants` (SKU có thể
  trống/trùng), làm tròn ≥ 0; route PATCH `/jobs/:id` parse mảng; tính lại missing các gian chờ/lỗi như cũ (giá 0 → mã
  `price`).
- **FE:** bảng Phân loại khi còn sửa được: ô Giá (bước 1.000, viền vàng nếu ≤ 0) + ô Tồn gõ thẳng, hiện HẾT phân loại
  (không cắt 12); nháp theo vị trí, chỉ gửi dòng có đổi; nút Lưu bài đăng gộp tên + mô tả + giá/tồn; dòng chú thích nói rõ
  áp cho mọi gian và cách chỉnh riêng từng gian. Đã đăng xong → bảng chỉ đọc như cũ.
- **Kiểm local:** đổi 189.000 → 199.000, tồn 0 → 12, lưu → cả 2 dòng gian đích (TikTok, Lazada) hiện 199.000 ₫ · Tồn 12.
  tsc BE+FE, eslint sạch. ⏳ anh thử trên prod.

## 17. Bài TikTok "Chờ sàn duyệt" tự cập nhật khi sàn duyệt xong (29/10/2026 tối muộn, anh báo) — ĐÃ CODE, kiểm local

- **Anh:** "TikTok duyệt bài một lúc rồi nhưng Hubsell vẫn Chờ sàn duyệt". Gốc: trạng thái PENDING_REVIEW ghi một lần lúc
  create product, không có gì hỏi lại.
- **Hợp đồng:** `ListingAdapter.checkReviewStatus?(channel, remoteItemId) → {status: LISTED|PENDING_REVIEW|FAILED, reason?}`
  (tùy chọn — Shopee/Lazada bán ngay nên không có). TikTok: Get Product 202309 `status` → ACTIVATE / SELLER_DEACTIVATED =
  LISTED; PENDING / DRAFT = còn chờ; FAILED = FAILED kèm `audit_failed_reasons[].reasons + suggestions` (đọc phòng thủ, chưa
  thấy mẫu thật); PLATFORM_DEACTIVATED / FREEZE / DELETED = FAILED câu riêng. Hàm thuần `mapTikTokReview` có test. Giả lập:
  duyệt ở lần hỏi đầu.
- **Hai đường cập nhật (`services/listing-copy/review-check.ts`):** (1) worker `workers/listing-copy-review.ts` quét mỗi
  `LISTING_COPY_REVIEW_CHECK_SECONDS` (mặc định 600, "0" = tắt) các target PENDING_REVIEW có remoteItemId trong 14 ngày;
  (2) `getBatch` (khách mở đợt) hỏi ngay tối đa 5 target đến hạn — màn hình không cũ. Mỗi target hỏi thưa nhất 2 phút
  (`MIN_RECHECK_MS`, mốc = `updatedAt`, mọi lần hỏi đều chạm dòng; sàn lỗi cũng chạm để không dội). Kết quả: LISTED → xóa
  error, `listedAt`; FAILED → `error` = lý do sàn; rồi `rollupJob` tính lại trạng thái đợt. Log `[listing-copy] … duyệt → …`.
- **Kiểm local:** 3 gian TikTok giả lập chờ duyệt từ 14:52 → mở đợt là cả 3 sang "Đã đăng". tsc + vitest 24 ca sạch.
  ⏳ prod: bài ANO Official đang chờ duyệt sẽ tự lên khi anh mở lại đợt (hoặc ≤ 10 phút); lý do từ chối thật chưa có mẫu.

## 18. Ảnh theo phân loại (ảnh màu) chép sang gian đích (29/10/2026 tối muộn, anh báo) — ĐÃ CODE 3 SÀN, chưa kiểm gian thật

- **Anh (ảnh Seller Center Shopee):** bài TikTok → Shopee lên nhưng cột ảnh từng màu (ĐEN / XÁM / Gold) trống. Gốc: chiều
  đọc TikTok đã lấy `sku_img` vào `variants[].imageUrl`, nhưng chiều ghi Shopee dựng `tier_variation.option_list` không có
  `image`; TikTok ghi cũng không gửi `sku_img`; Lazada gửi nhầm ảnh bìa thay ảnh phân loại; Shopee chiều đọc không ghép ảnh
  tier → `imageUrl: null`.
- **Hàm thuần (`variant-map.ts`, test +3):** `optionImages(variants, options)` = ảnh theo từng GIÁ TRỊ của mỗi nhóm (lấy
  ảnh của phân loại đầu tiên mang giá trị đó) + `imageOptionIndex` = nhóm có nhiều ảnh KHÁC NHAU nhất (Size M/L cùng ảnh
  đen không tính; Màu Đen/Trắng 2 ảnh → đúng); `reorderOptionsForImages` đưa nhóm đó lên ĐẦU vì sàn chỉ nhận ảnh ở một
  nhóm (Shopee tier 1, TikTok một sales attribute).
- **Chiều ghi:** Shopee `init_tier_variation` tier 1 `option_list[].image.image_id` (upload_image scene normal từng ảnh
  màu, lỗi ảnh nào bỏ ảnh đó); TikTok `skus[].sales_attributes[0].sku_img.uri` (upload use_case ATTRIBUTE_IMAGE); Lazada
  `Skus[].Images.Image` = ảnh phân loại (image/migrate) đứng đầu + ảnh bìa, ≤ 8. Thứ tự nhóm sau khi đảo dùng chung cho
  `tierIndexes` / `variantPairs` nên model vẫn khớp.
- **Chiều đọc Shopee:** `ShopeeModel.tier_index` + `tier_variation[0].option_list[].image.image_url` → `variants[].imageUrl`
  (chép Shopee → TikTok/Lazada cũng mang ảnh màu).
- **FE:** bảng Phân loại trong Sửa bài đăng hiện ảnh nhỏ 32px cạnh tên phân loại khi có.
- tsc BE+FE, vitest 27 ca, eslint sạch. ⏳ anh chép lại SP đó TikTok → Shopee xem Seller Center có ảnh từng màu; chiều
  Shopee → TikTok chưa kiểm.

## 19. Bỏ nhãn "(demo)" (29/10/2026 tối muộn, anh chốt) — sidebar `Sao chép sản phẩm`

Anh: "Em dọn dẹp, commit và push. Anh sẽ test dần và chúng ta sửa sau. Bỏ chữ demo trên sidebar." Mục sidebar
`app-shell.tsx` và chú thích `app.ts` đổi theo. Trạng thái tính năng: mở cho mọi chủ shop có lá quyền; 3 sàn đã đăng
thật ít nhất một lần (Shopee, TikTok); Lazada + ảnh màu (mục 18) + lý do TikTok từ chối (mục 17) còn chờ ca thật.


## 20. Thư thông báo tính năng tới mọi chủ shop (29/10/2026 tối, anh yêu cầu) — ĐÃ GỬI, NHÁP ĐÃ GỠ

Anh: *"gửi email thông báo cập nhật tính năng tới tất cả các tài khoản — Sao chép sản phẩm — tạo hình ảnh hướng
dẫn bước 1 → bước 2"*, rồi *"Gửi mail xong thì xóa chứ giữ lại làm gì"*.

- **Đã gửi ~20:50 từ Render Shell worker:** 227 chủ shop có email (2 nội bộ bỏ) → **200 đã gửi, 26 chưa** vì Zoho
  SMTP chặn tạm `550 5.4.6 Unusual sending activity detected` (~200 thư/vài phút, 5 luồng); thử lại sau 10 phút vẫn
  chặn. Vé chống trùng `onboarding_reminders` kind `feature-copy-listing` còn trong DB (26 người chưa có vé).
- **Nháp đã gỡ khỏi repo** (mẫu thư `featureCopyListingEmailHtml`, test, `scripts/feature-announce-once.ts`): xem
  commit `850d1fc5` nếu cần gửi nốt 26 người (khôi phục script → `--apply`, vé tự bỏ 200 người đã nhận).
- **Giữ lại:** 2 ảnh `frontend/public/guide-assets/copy-listing-buoc-{1,2}.png` — thư chỉ chứa link, khách mở
  muộn vẫn cần ảnh.
- **Bài học:** đợt >150 thư qua Zoho phải chia lô (`--limit=100`, cách ≥1 giờ) hoặc 1 luồng.

## 21. Khách test prod báo 6 ý (30/10/2026, anh chuyển lại kèm ảnh Safari/macOS + KiotViet) — ĐÃ SỬA, kiểm local

Anh: *"(1) ô thương hiệu không tìm kiếm được, không có thanh cuộn (Windows có); (2) thiếu SKU nhưng khách không thêm/sửa
được SKU, sản phẩm 17 SKU Hubsell không lấy được; (3) KiotViet dễ dùng hơn hẳn; (4) lỗi giao diện tối; (5) sản phẩm vừa
đăng trên sàn có về ngay không; (6) em làm càng ngày càng ẩu — tỉ lệ kích thước, test giao diện đều không làm."*

- **(1) Thương hiệu → ô tìm kiếm** `copy-listing/brand-combobox.tsx` thay `<select>` gốc: gõ → hỏi `/brands?q=` (TikTok/
  Lazada tìm phía sàn, Shopee lọc trong 200 đầu — SAI, thật ra chỉ 1 trang 100 dòng → khách vẫn không tìm được, sửa ở mục 22), danh sách `max-h-64` cuộn với lớp `.scrollbar-always` (globals.css —
  macOS ẩn thanh cuộn overlay nên khách tưởng chỉ có vài dòng), ↑↓ Enter Esc, nút ✕ bỏ chọn; lưu cả `brandName`.
- **(2a) Mã SKU sửa được** trong Sửa bài đăng: cột Mã SKU thành ô nhập khi còn sửa được (`updateJobSource.variants[].sku`),
  ô trống tô vàng, dòng "n phân loại chưa có mã SKU" + nút **Tự đặt mã cho phân loại thiếu** (chữ cái đầu tên, ≤6 ký tự +
  số thứ tự, vd `TKBTDG-02`; tránh trùng mã đã có). Mã trùng nhau → `sku_duplicate` chặn đăng. Nguồn sàn không mang
  seller_sku (TikTok) là lý do "Thiếu SKU"; mã khách nhập đi lên gian đích + nối kho, nguồn trên sàn không đổi.
- **(2b) "17 SKU" = 17 màu × 3 số lượng = 51 phân loại**, Hubsell lấy đủ 51 (ảnh 5 cho thấy `+48` id); cái chặn là **trần
  Shopee 50 tổ hợp** (`PLATFORM_LISTING_RULES.SHOPEE.maxVariants`; trợ giúp Shopee: 1 nhóm ≤20, 2 nhóm ≤20/nhóm và ≤50
  tổ hợp — thêm `maxOptionValues: 20` Shopee/Lazada, mã `too_many_option_values`). Sửa để khách tự xử lý: cột **Đăng** (bỏ
  tick = `variants[].excluded`), nhãn chip nói rõ số **"Quá số phân loại (51 / tối đa 50 — bỏ bớt 1)"**; backend
  `activeVariants` + `effectiveOptions` (rút giá trị nhóm không còn ai dùng) áp ở computeMissing, existingSkus, draft gửi
  sàn; bỏ hết → `no_variants`. Test rules 13/13 (thêm 3 ca).
- **(3) KiotViet** (ảnh 3–4): một biểu mẫu dài cho MỘT sản phẩm, mục lục neo bên phải, thương hiệu có ô tìm, phần sàn
  xếp theo khối Shopee → TikTok → Lazada. Khác bản chất với bảng đợt N sản phẩm × M gian của Hubsell. Chưa đổi cấu trúc;
  đề xuất lát riêng (mục 7): khi đợt chỉ 1 sản phẩm thì mở khung sửa toàn trang có mục lục neo thay vì dòng xổ trong bảng.
- **(4) Giao diện tối:** trang dùng `bg-white` (5) + chip chọn `bg-slate-900 text-white` (2) + ô tick `bg-slate-900` —
  `.dark` map slate-900 → gần trắng nên chip chọn thành ô trắng mất chữ (ảnh 5 cạnh "1. Chọn sản phẩm nguồn"). Đổi
  `bg-card`, `bg-primary text-primary-foreground`, `accent-primary`, nhãn Bìa `bg-black/70`. Soi lại dark ở bước 1 + bảng
  đợt + khung Bổ sung + danh sách thương hiệu.
- **(5) Sản phẩm vừa đăng trên sàn:** KHÔNG về ngay — worker `product-catalog-sync` chỉ làm mới mỗi đêm 03:00–05:00 giờ
  VN (gian mới nối thì kéo ngay). Thêm nút **Lấy sản phẩm mới từ sàn** cạnh ô chọn gian nguồn → `POST
  /api/sao-chep-san-pham/sources/sync {channelId}` (quyền operations.copy-listing; gian kéo <2 phút trước thì trả luôn
  không gọi sàn; ghi lịch qua `scheduleAfterProductSync`), xong nạp lại danh sách + số SP.
- **(6) Tự soi trước khi giao — phát hiện thêm 2 lỗi tràn ngang thật ở 1280:** (a) dòng sản phẩm liệt kê 17 màu nowrap
  + chip "còn thiếu" nowrap vẽ tràn sang phải → bảng đợt cuộn ngang 555 px (bấm Sửa bài đăng là cả bảng trôi sang trái);
  sửa `whitespace-normal` cho ô sản phẩm / chip / PANEL, nhóm >4 giá trị chỉ ghi "17 giá trị"; (b) nút "Sửa bài đăng"
  ~130 px trong cột 12 % (113 px ở 1280) tràn 19 px → cột 15 %, Còn thiếu 22 %. Đo bằng JS (`scrollWidth` của khung
  `overflow-x-auto` + `td.scrollWidth > clientWidth`) ở **1280 / 1440 / 1700**, sáng + tối, với seed 51 phân loại tên dài:
  0 tràn. Seed dùng: `prisma.channelProduct` 51 dòng `externalId BIGTEST-n` trên TikTok giả lập demo (1 dòng SKU rỗng vì
  khóa unique channelId+channelSku không cho nhiều dòng rỗng).
- Chưa kiểm trên gian thật (Shopee/TikTok thật khi khách bỏ phân loại + nhập mã): ⏳ khách Bunchar thử lại; nếu Shopee vẫn
  từ chối 50 tổ hợp thì đọc `get_item_limit` của danh mục đó rồi hạ trần theo sàn.

## 22. Khách Bunchar vẫn không tìm được thương hiệu trên macOS: gõ "B" chỉ ra hãng dòng A (30/10/2026 sáng, anh chuyển ảnh) — ĐÃ SỬA, kiểm local

Anh: *"Khách dùng MacOS khi sử dụng phần tìm kiếm thương hiệu vẫn không được."* Ảnh: ô thương hiệu gõ `B` → danh sách
"Không có thương hiệu, AMBY LONDON, ANASTASIA BEVERLY HILL, ANNABELLE, ANUBIS, AOBERST, AQUALABEL". Khách: *"Gõ B cũng chỉ
có các hãng dòng A."*

- **Gốc — KHÔNG phải macOS/Safari, là backend:** Shopee `get_brand_list` **không có tham số tìm theo tên**, chỉ lật trang
  (`offset`/`page_size` ≤100, xếp A→Z). `listing-api.getBrands` chỉ đọc **1 trang đầu** (`offset 0, page_size 100`), adapter
  lọc "chứa từ khóa" trong 100 dòng đó → với danh mục "Sản phẩm dưỡng tóc" hàng nghìn hãng, 100 dòng đầu toàn chữ A/số;
  gõ `b` còn đúng các hãng dòng A **chứa chữ b** (AM**B**Y, ANASTASIA **B**EVERLY, ANNA**B**ELLE, ANU**B**IS, AO**B**ERST,
  AQUALA**B**EL) = y ảnh khách. Mục 21 (1) ghi "Shopee lọc trong 200 đầu" là sai: chỉ 100, và cả 200 cũng vô nghĩa.
  Cùng gốc: tự khớp thương hiệu nguồn lúc tạo đợt (`service.ts` `searchBrands(listing.brandName)[0]`) và tra tên theo id
  khi PATCH không kèm `brandName` đều chỉ thấy trang đầu.
- **Sửa backend (3 việc):**
  1. `integrations/shopee/listing-api.ts` `getBrands`: lật **hết trang** theo `has_next_page`/`next_offset` (hàm thuần
     `collectBrandPages` ở `marketplace/listing/brand-search.ts`, trần `MAX_BRAND_PAGES = 100` trang = 10.000 hãng, quá
     trần → `console.warn [listing-copy]` + trả phần đã có; dừng khi offset không tiến/trang rỗng). Đệm **6 giờ theo
     danh mục** (`TtlCache` sẵn có, khóa `shopee:brands:<categoryId>` — `status 1` là hãng chung toàn sàn, không theo shop,
     nên mọi gian Shopee của mọi khách dùng chung một bản; gọi trùng khi đang lật dùng chung promise). `is_mandatory` lấy ở
     trang đầu. **Số call sàn:** danh mục N hãng = ⌈N/100⌉ call `get_brand_list` một lần / 6 giờ / tiến trình backend
     (danh mục 3.000 hãng = 30 call, ~5–8 giây lần đầu, mở ô lần sau tức thì); gõ từng phím không gọi sàn thêm.
     `getCategoryRequirements` (chọn danh mục) gọi cùng hàm → làm ấm đệm trước khi khách mở ô thương hiệu.
  2. `brand-search.ts` `rankBrands(list, q, limit)`: lọc không dấu/không hoa thường rồi xếp hãng **BẮT ĐẦU bằng** từ khóa
     trước, hãng chỉ **chứa** sau (gõ `b` → BUNCHAR, Bioderma… rồi mới AMBY); Shopee + Lazada dùng chung (`No Brand` luôn
     đầu + 199 dòng). TikTok giữ tìm phía sàn.
  3. `ListingAdapter.getBrandName?(channel, categoryId, id)` (tùy chọn) — Shopee tra trong đủ danh sách đệm; `service.ts`
     PATCH `brandId` không kèm tên dùng hàm này thay vì `searchBrands("")` bị cắt 200.
- **Test:** `__tests__/brand-search.test.ts` 8 ca (lật 3 trang theo next_offset, thiếu next_offset tự cộng, chạm trần
  → truncated, offset kẹt/trang rỗng không lặp, xếp B-trước-A theo ca khách, không dấu `dong a` ↔ `Đông Á`, limit, không
  khớp) + rules 13 → 21/21; `tsc --noEmit` backend sạch. Frontend `brand-combobox.tsx` không đổi.
- **Chưa kiểm gian thật** (cần token Shopee thật để lật trang): ⏳ sau deploy, anh hoặc khách Bunchar mở Sửa bài đăng gian
  Shopee → ô Thương hiệu gõ `bun` phải ra BUNCHAR (nếu Shopee có hãng này) hoặc gõ `b` phải ra hãng dòng B; log Render
  không có dòng `[listing-copy] Shopee get_brand_list … quá … trang`.

## 23. Khách Hi.Bé: 5 phân loại cùng mã SKU JS051, Hubsell chặn "Mã SKU trùng nhau" (30/10/2026 trưa, anh chuyển ảnh) — ĐÃ HẠ THÀNH CẢNH BÁO Shopee/TikTok, kiểm local

Anh: *"Không hiểu khách đăng kiểu gì mà mã SKU giống nhau hết chỉ khác tên phân loại? Khách không muốn sửa SKU, lý do sàn
chấp nhận như vậy và không muốn trùng 2 lần khi in đơn."* Ảnh: sản phẩm Hi.Bé 5 size 4-6kg … 10-12kg, cột Mã SKU đều `JS051`,
chip vàng "Mã SKU trùng nhau giữa các phân loại", Chờ đăng.

- **Khách làm được vì Shopee cho phép:** Seller Centre bảng phân loại có nút **"Áp dụng cho tất cả phân loại"** — gõ giá/tồn/mã
  một lần rồi bấm, Shopee đổ cùng mã xuống mọi dòng; Shopee không kiểm `model_sku` trùng, TikTok cũng không (`seller_sku`
  tự do). Hi.Bé chính là khách dính sự cố 15/10 (`LT075-HONG` cho 5 size màu Hồng, docs DONG-BO-SAN-PHAM-TRUNG-MA-PHAN-LOAI.md).
- **Cái chặn là luật `sku_duplicate` Hubsell tự thêm ở mục 21 (2a)**, không phải sàn. Lý do khi thêm (nối kho khớp theo mã)
  không còn đứng: từ 15/10 danh tính dòng sàn = `externalId`, mã trùng tự thêm đuôi tên phân loại `JS051 (4-6kg)` (sku-key.ts)
  → Hubsell sống được với mã trùng. Khóa cứng việc sàn chấp nhận là trái luật "cảnh báo, không khóa cứng".
- **Sửa (anh chốt "Làm đi"):** `rules.ts` — `computeMissing` chỉ còn đẩy `sku_duplicate` cho **LAZADA** (SellerSku phải duy
  nhất trong gian theo tài liệu API — **CHƯA kiểm gian thật**, Lazada mà nhận thì hạ nốt); thêm `WarningCode` +
  `WARNING_LABELS` + `computeWarnings(platform, listing)` → Shopee/TikTok mã trùng = **cảnh báo không chặn**. Cảnh báo thuần
  theo sàn + nguồn, không cần API nên **không lưu DB, không migration**: `getJob` tính lại mỗi lần, `TargetView.warnings[]`
  (FE `CopyListingTarget.warnings`). FE: cột Còn thiếu vẽ chip xám nét đứt "Mã SKU trùng giữa các phân loại" cạnh "Đủ điều
  kiện", tooltip (`title`) ghi hệ quả: *sàn này chấp nhận, vẫn đăng được; gian đích Hubsell hiện từng phân loại kèm đuôi tên;
  muốn đồng bộ tồn riêng từng phân loại thì mã kho phải đặt y hệt đuôi đó hoặc đặt mỗi phân loại một mã riêng*. Dòng ghi chú
  trong khung Sửa bài đăng đổi "mỗi phân loại một mã riêng" → "Shopee/TikTok vẫn đăng được, Lazada từ chối; nối kho từng
  phân loại cần mã riêng". Nút "Tự đặt mã cho phân loại thiếu" giữ, chỉ cho ô trống. Nút Đăng không khóa; `submitJob` tính
  lại missing → Shopee/TikTok qua.
- **Test:** rules.test.ts thêm 8 khẳng định (Shopee/TikTok [] + Lazada [sku_duplicate]; computeWarnings 3 sàn; bỏ 1 phân
  loại trùng → hết cảnh báo) → listing 38/38; tsc backend + frontend sạch. **Chưa soi chip trên trình duyệt** (cần đợt có
  mã trùng trên gian demo local); chip nằm trong ô flex-wrap `whitespace-normal` sẵn có, dùng token `bg-muted`/
  `text-muted-foreground` nên dark theo hệ. ⏳ sau deploy: Hi.Bé bấm Đăng lại, Shopee phải nhận 5 model cùng `JS051`.
- **Nói với khách Hi.Bé:** đăng được như cũ; Lazada có thể từ chối mã trùng; trong Hàng hóa Hubsell gian mới sẽ thấy
  `JS051 (4-6kg)`… — muốn đồng bộ tồn từng size thì mã kho đặt theo đuôi đó.

## 24. KHẢO SÁT: nút "Thêm sản phẩm mới" — soạn như sàn → đẩy thẳng lên sàn + ghi Tổng kho, KHÔNG tự nối (30/10/2026 chiều, anh yêu cầu khảo sát, CHƯA CODE)

Anh: *"Làm thêm một nút thêm sản phẩm luôn. Vào thêm sản phẩm thì nhập các yêu cầu cần thiết giống như sàn, thêm xong đẩy
trực tiếp lên sàn và đồng thời đẩy vào Tổng kho, tuy nhiên không tự ý liên kết sản phẩm này giữa tổng kho với các sàn. Anh
không biết tác động thế nào và Hubsell có chịu thiệt hại về dung lượng database không."* Ảnh: thanh nguồn "Từ gian hàng
đã nối / Từ kho Hubsell" (chỗ anh khoanh = nút thứ 3), tab Tổng kho (382 SKU kho · 2.036 SP sàn chưa nối).

### 24.1 Hiện trạng liên quan (đọc mã 30/10)

- **Nguồn đăng hiện có 2:** `ListingCopySourceType` = `CHANNEL` (chụp bài sàn qua adapter `fetchListing`) và `PRODUCT` (kho).
  Nguồn kho **thiếu gần hết dữ liệu sàn đòi**: `buildListingFromProducts` trả `description: ""`, ảnh chỉ 1 `Product.imageUrl`
  mỗi phân loại, `weightGrams/dimensionsCm: null` → khách phải gõ mô tả, cân nặng… ngay trong khung Sửa bài đăng. Mục 7 lát 3
  đã ghi "chép từ kho có trình soạn đầy đủ (mô tả, nhiều ảnh, thuộc tính theo sàn)" = chính cái form anh đang nói.
- **Bảng Product (kho):** 1 dòng = 1 SKU (phân loại tách dòng, gom cha–con bằng `groupKey`), cột: skuCode, productName,
  variantName, costPrice, sellingPrice, quantityInStock, imageUrl (1 ảnh), isActive… **Không có** mô tả, nhiều ảnh, cân nặng,
  kích thước, thương hiệu, danh mục. Tạo SKU kho = `POST /api/products` (có sẵn, dùng ở Hàng hóa + Excel).
- **Nối kho ↔ sàn hôm nay KHÔNG BAO GIỜ tự chạy:** `product-sync` không gán `productId`; nối chỉ khi khách bấm
  `/mappings/link` (tay), `/link-by-sku` + `/auto-match` (khớp **trùng mã chính xác**), `/quick-link`, `/create-products`.
  → Yêu cầu "không tự ý liên kết" đã đúng với luật hiện hành; nhưng khi khách bấm "Tự khớp" sau này thì SP mới **sẽ nối**
  vì mã kho = mã sàn (đúng luật mã trùng, không phải khớp mềm).
- **Ảnh:** chưa có chỗ chứa ảnh sản phẩm do khách tải lên. Đã có `lib/supabase-storage.ts` (bucket private + signed URL,
  gọi REST, không thêm dependency): `support-attachments` (600 KB, xóa sau 7 ngày) và `hq-documents` (15 MB, giữ vĩnh viễn).
  Gói Supabase Pro đang trả có **100 GB kho tệp + 250 GB egress/tháng**, kho tệp gần như chưa dùng. Backend **chưa có
  sharp/jimp** (nén ảnh phải làm phía trình duyệt bằng canvas như ảnh hỗ trợ, hoặc thêm sharp ~30 MB vào build Render).
  Adapter sàn nhận ảnh dạng buffer tải từ URL (`fetchImageBuffer`) → signed URL Supabase dùng được cho cả 3 sàn (Lazada
  `image/migrate` cần URL công khai → signed URL hạn 1 giờ là đủ).
- **Trần sàn (docs KHAO-SAT mục 4):** TikTok 100 SP/ngày gian mới, 1.000/ngày sau, bài PENDING chờ duyệt; Shopee
  `get_item_limit` theo danh mục; đã xử lý trong luồng sao chép.

### 24.2 Dung lượng — DB KHÔNG thiệt nếu KHÔNG nhét ảnh vào Postgres

Số đo prod 28/10 (PROGRESS): đĩa Supabase 4,4 / 8 GB, DB 3,5 GB (Order 578 k dòng, `ChannelProduct` 145.158 dòng = 129 MB
≈ **0,9 KB/dòng kể cả index**). Ước lượng cho MỘT sản phẩm mới, 5 phân loại, đăng 3 gian:

| Thứ ghi vào DB | Dòng | Ước KB | Ghi chú |
|---|---|---|---|
| `Product` kho | 5 | ~5 | 1 dòng/phân loại, cùng cỡ ChannelProduct |
| `ListingCopyJob.source` Json | 1 | 5–30 | mô tả ≤ 3.000 ký tự Shopee / ≤ 25.000 Lazada + URL ảnh; chính là chỗ "nặng" nhất |
| `ListingCopyTarget` | 3 | ~3 | danh mục, thuộc tính, missing |
| `ChannelProduct` (worker kéo về sau khi đăng) | 15 | ~14 | **phát sinh với MỌI bài đăng trên sàn dù đăng bằng gì** — không phải chi phí riêng của nút này |
| **Cộng** | | **~30–50 KB/SP** | |

→ **1.000 SP mới ≈ 30–50 MB**, bằng ~1 % DB hiện tại; 10.000 SP ≈ 0,5 GB (khi đó đĩa 8 GB mới đáng bàn, và lúc đó Order đã
lớn hơn nhiều lần). Kết luận: **DB chịu được, không phải chỗ lo.** Điều kiện duy nhất: ảnh KHÔNG vào Postgres (bài học
ảnh hỗ trợ 27/09: phình WAL/backup + egress DB).

**Ảnh mới là chi phí thật, nhưng rẻ:** nén phía trình duyệt về ≤ 1.600 px / ≤ 400 KB (mặc định tự chọn, Shopee khuyên
1024×1024, TikTok ≤ 5 MB) → 9 ảnh bìa + ≤ 12 ảnh mô tả ≈ **2–4 MB/SP** (xấu nhất 8 MB). 1.000 SP ≈ 2–4 GB; gói Pro có 100 GB
→ **~25.000–50.000 SP** mới chạm; vượt thì Supabase tính 0,021 USD/GB/tháng (bảng giá Supabase, anh xác nhận ở Billing) =
thêm 100 GB ≈ 2 USD/tháng. Egress: mỗi gian đăng kéo ảnh 1 lần (3 gian × 3 MB) — 250 GB/tháng đủ cho ~25.000 lượt đăng.
Chính sách đề xuất (mặc định tự chọn, chưa có căn cứ khách): giữ ảnh gốc **vĩnh viễn** để sau này "đăng lại gian mới"
không phải tải lại (đúng mục đích mở gian nhanh), **trần theo gói** (vd Free 50 SP có ảnh, gói trả 5.000) để một khách
không nuốt kho tệp; cron xóa ảnh của job DRAFT bỏ dở > 30 ngày.

### 24.3 Tác động nghiệp vụ — chỗ em phản biện

1. **Lưu kho và nối là HAI việc khác nhau (anh chỉnh lại 30/10 chiều, em ghi nhận):** *lưu kho* = tạo dòng `Product`
   (mã, tên, phân loại, số lượng, ảnh bìa, giá vốn mặc định); *nối* = `ChannelProduct.productId`, chỉ là cầu để **tồn kho**
   chảy hai chiều (đơn sàn về trừ tồn kho; bật đồng bộ gian thì đẩy tồn kho lên sàn) và để giá vốn mặc định kho làm dự
   phòng. **Tài chính KHÔNG cần nối:** giá vốn hiệu lực của SKU sàn = `ChannelProduct.costPrice` khách nhập theo từng
   gian ở Tài chính → Mapping giá vốn (luật 11/10), kho chỉ quản số lượng. Em đã nói sai ở bản đầu rằng "không nối thì giá
   vốn/Lãi-Lỗ trống" — sai, Lãi/Lỗ chạy bằng giá vốn của gian. Không nối chỉ còn hai hệ quả: (a) tồn kho và tồn sàn của SP
   mới sống độc lập cho tới khi khách bấm Tự khớp (trùng mã chắc chắn vì cùng một mã) hoặc nối tay; (b) số "SP sàn chưa
   nối" tăng thêm đúng số SP vừa tạo. **Chốt theo anh: KHÔNG nối**; khách muốn nối thì bấm Tự khớp như mọi SP khác.
2. **Giá vốn:** khách nhập theo từng gian ở Tài chính → Mapping giá vốn sau khi SP đã lên sàn (như mọi SP sàn khác); ô
   "Giá vốn mặc định" trong form chỉ ghi vào SKU kho, tùy chọn.
3. **Phân loại:** form phải cho nhóm × giá trị (Màu × Size) → tự sinh tổ hợp, mỗi tổ hợp 1 SKU/giá/tồn/ảnh; trần theo sàn
   đã có trong `rules.ts` (Shopee 2 nhóm/50 tổ hợp, TikTok 3/100, Lazada 2/100). Mã SKU trùng → cảnh báo (mục 23).
4. **Tổng kho ghi khi nào:** đề xuất ghi **ngay khi bấm Đăng** (trước khi sàn trả lời) để khách thấy SP trong Hàng hóa
   kể cả khi sàn PENDING/lỗi; sàn từ chối thì SP kho vẫn còn, khách sửa rồi đăng lại — khỏi tạo trùng (`skuCode` unique
   theo chủ shop đã chặn).
5. **Không đụng** Vị trí kho (chốt 24/09), không đổi luật nối theo mã cho SP sàn có sẵn.

### 24.4 Cách làm nếu anh chốt — 3 lát, ước ~3 ngày công

- **Lát A — Form "Tạo mới" (~2 ngày):** nút thứ 3 trên thanh nguồn → form một trang: tên, mô tả (textarea + ảnh mô tả),
  ảnh bìa ≤ 9 (tải lên → nén canvas → `POST /api/sao-chep-san-pham/images` → bucket mới `product-images`, private, signed
  URL), nhóm phân loại × giá trị → bảng tổ hợp (SKU/giá/tồn/ảnh), cân nặng, kích thước, giá vốn tùy chọn. Bấm "Tiếp" →
  `createJob` với `sourceType: MANUAL` (enum thêm 1 giá trị = migration nhỏ, bảng listing_copy_jobs không ai khóa) và
  `source` Json như hai nguồn kia → **toàn bộ bước 2 (gian, danh mục gợi ý, thuộc tính, thương hiệu, vận chuyển, Đăng,
  hàng đợi, Chờ sàn duyệt) dùng lại 100 %**.
- **Lát B — Ghi Tổng kho (~0,5 ngày):** lúc Đăng, tạo `Product` mỗi phân loại qua lõi của `POST /products` (groupKey,
  variantName, imageUrl = bìa, giá bán, tồn, giá vốn nếu có); KHÔNG nối (anh chốt 24.3-1).
- **Lát C — Dọn + trần (~0,5 ngày):** cron xóa ảnh job DRAFT > 30 ngày, trần ảnh theo gói, HQ hiện dung lượng bucket.
- Gộp luôn mục 7 lát 3 ("chép từ kho có trình soạn đầy đủ"): nguồn kho mở cùng form này với dữ liệu điền sẵn.

**Chờ anh chốt:** (1) ~~nối hay không~~ → KHÔNG nối, đã chốt; (2) giữ ảnh vĩnh viễn + trần theo gói, hay xóa
sau khi đăng xong; (3) làm lát A ngay hay để sau khi khách Bunchar/Hi.Bé test xong đợt sao chép.

### 24.5 Giao diện + quy chuẩn sàn cho form "Tạo mới" (30/10/2026 chiều, anh hỏi; anh: "chuẩn SKU từ đầu thì sau này khách muốn liên kết rất thuận tiện")

**Nguyên tắc:** form soạn MỘT lần theo **chuẩn chung chặt nhất của 3 sàn**, không bắt khách biết sàn nào đòi gì; phần
khác nhau theo sàn (danh mục, thuộc tính, thương hiệu, vận chuyển) để nguyên ở **bước 2 hiện có** theo từng gian. Một nút
"Tiếp: chọn gian" → bước 2 → "Đăng". Khách thấy sàn nào đạt/chưa đạt qua thẻ "Đạt chuẩn sàn" sống bên phải, không phải
đọc bảng số.

**Bố cục (theo KiotViet mà khách khen ở mục 21-3, dùng PageHeaderBand + PageTabs, chữ 14 px, dark theo token):** trang
`/operations-assistant/copy-listing/new` — biểu mẫu dài một cột 720 px, **mục lục neo bên phải** (5 khối, cuộn tới khối
nào sáng mục đó) + thẻ "Đạt chuẩn sàn" dính dưới mục lục:

| Khối | Ô | Kiểm tra sống (chuẩn chung 3 sàn, số từ `rules.ts` + KHAO-SAT mục 4) |
|---|---|---|
| 1. Thông tin | Tên · Mô tả (chữ thuần, giữ xuống dòng) · Ảnh mô tả ≤ 12 | Tên **25–120 ký tự** (Shopee ≤120, TikTok ≥25; bộ đếm "87/120 · Shopee ✓ TikTok ✓ Lazada ✓"); mô tả ≥ 20, ≤ **3.000** nếu muốn Shopee (TikTok 10.000, Lazada 25.000 — quá 3.000 chỉ cảnh báo "Shopee sẽ cắt") |
| 2. Ảnh | Kéo thả ≤ **8** (Lazada ≤8, Shopee/TikTok ≤9), ảnh 1 = bìa, sắp xếp | Nén canvas ≤ 1.600 px / ≤ 400 KB (mặc định tự chọn); dưới 500×500 → cảnh báo mờ (Shopee khuyên ≥500, TikTok ≥300 — số trợ giúp sàn, chưa kiểm API) |
| 3. Phân loại | Nhóm × giá trị (≤ **2 nhóm**, ≤ **20 giá trị/nhóm**, ≤ **50 tổ hợp** cho đủ 3 sàn; nhóm 3 / >50 = "chỉ TikTok") → bảng tổ hợp: Đăng · Phân loại · **Mã SKU** · Giá · Tồn · Ảnh phân loại | Không phân loại = 1 dòng; giá > 0 làm tròn 100 đ; tồn ≥ 0 |
| 4. Vận chuyển | Cân nặng (g) · Dài × Rộng × Cao (cm) | Cân nặng bắt buộc cả 3; kích thước bắt buộc Lazada, Shopee/TikTok "điền thì đủ 3 số" (luật `dimensions` sẵn) |
| 5. Kho | Giá vốn mặc định (tùy chọn) · ghi chú "SP sẽ có trong Tổng kho, chưa nối gian" | Không nối (24.3-1) |

**Mã SKU — chỗ anh nhấn mạnh, làm chặt ngay từ form:**
- **Mã gốc** 1 ô (vd `TC113`) + tự sinh mã phân loại theo quy tắc Nối SKU nhanh đã có (`MÃ GỐC-ĐUÔI`, đuôi = chữ cái đầu
  giá trị không dấu, vd `TC113-DEN-M`), khách sửa tay từng ô được. Mã = `trim`, hoa/thường không phân biệt khi so.
- **Bắt buộc mỗi phân loại một mã riêng** (ở đây không phải sửa bài sàn có sẵn nên không áp cảnh báo mục 23 — chặn hẳn).
- **Kiểm trùng sống với kho** (`Product.skuCode` unique theo chủ shop) **và với mọi gian đã nối** (`ChannelProduct.channelSku`):
  trùng → ô đỏ "Mã đã có ở Tổng kho / gian X" + gợi ý `-2`. Nhờ vậy khi khách bấm Tự khớp sau này, SP khớp trùng mã chính
  xác, không rơi vào ca mã trùng → đuôi tên (sku-key.ts).
- Ký tự cho phép: chữ/số/`-`/`_`/`.`; dài **6–50 ký tự** (TikTok seller_sku 6–50 theo KHAO-SAT mục 4; Shopee/Lazada rộng
  hơn — lấy mức chặt). Mã < 6 ký tự (vd `JS051` = 5) → cảnh báo "TikTok đòi ≥ 6", tự gợi ý thêm đuôi phân loại.

**Thẻ "Đạt chuẩn sàn"** (bên phải, cập nhật mỗi lần gõ): 3 dòng Shopee / TikTok / Lazada, mỗi dòng ✓ xanh hoặc danh sách
ngắn "Tên < 25 ký tự · Thiếu kích thước"; tính bằng đúng `computeMissing` phần không cần danh mục (tái dùng hàm thuần, FE
gọi API `POST /sao-chep-san-pham/check` debounce 300 ms, hoặc port nhỏ sang FE). Khách chưa đạt sàn nào vẫn bấm Tiếp được
— bước 2 chặn như hiện nay (cảnh báo, không khóa cứng).

**Sau khi bấm Đăng ở bước 2:** tạo `Product` kho từng phân loại (groupKey, variantName, imageUrl = bìa, giá bán, tồn, giá
vốn mặc định) **trước** khi vào hàng đợi; job `sourceType MANUAL`; kết quả từng gian + "Chờ sàn duyệt" như cũ. Khách muốn
đăng lại gian mới sau này: mở Lịch sử → "Đăng thêm gian" (nguồn Json + ảnh Storage còn nguyên).

**Kiểm trước khi giao (luật 30/10):** seed rộng nhất = tên 120 ký tự, 2 nhóm × 20 giá trị = 50 tổ hợp, 8 ảnh, mô tả 3.000;
đo JS 1280 / 1440 / 1700 sáng + tối, không `<select>` gốc, mục lục neo không che bảng ở 1280.

**Ước công (cập nhật):** form + kiểm sống + tải ảnh ~2 ngày; ghi kho + MANUAL + hàng đợi ~0,5; dọn ảnh + trần gói ~0,5;
"Đăng thêm gian" từ Lịch sử ~0,5 → **~3,5 ngày**.

### 24.6 ĐÃ LÀM — lát A (form Tạo mới) + lát B (ghi Tổng kho) trên LOCAL (30/10/2026 chiều, anh: "Thiết kế trên local trước") — CHƯA PUSH

**Backend**
- `prisma` enum `ListingCopySourceType` thêm `MANUAL` (migration `20261030160000_listing_copy_manual_source`, `ADD VALUE IF NOT EXISTS`;
  DB dev áp bằng `prisma db execute --schema`). Job MANUAL: `sourceChannelId/sourceItemId/sourceGroupKey` null, `source = { ...NormalizedListing,
  manual: { costPrice } }` (`ManualSource`, adapter chỉ đọc phần listing).
- `services/listing-copy/manual.ts`: `parseManualListing(body)` (trần `MANUAL_LIMITS`: ảnh 9, ảnh mô tả 12, 3 nhóm, 100 tổ hợp; SKU
  `SKU_PATTERN` 6–50 ký tự chữ/số/-/_/.; mỗi phân loại một mã — chặn hẳn; số tổ hợp phải khớp nhóm × giá trị; URL ảnh phải http(s)),
  `checkManualDraft(listing)` (computeMissing 3 sàn, requirements null, bỏ mã bước 2 category/brand/logistics/sku_exists),
  `findTakenSkus(ownerId, skus)` (Product.skuCode + ChannelProduct.channelSku mọi gian của chủ shop, không phân biệt hoa thường),
  `ensureWarehouseProducts(ownerId, actorId, source, {allowCost})` (mỗi phân loại ĐANG ĐĂNG = 1 `Product`: skuCode hoa, productName,
  variantName, groupKey qua `productGroupKey`, costPrice (nhân viên → 0), sellingPrice, imageUrl = ảnh phân loại ?? bìa; tồn ban đầu qua
  `applyStockDelta` IMPORT "Tạo từ Sao chép sản phẩm (Tạo mới)"; mã đã có → bỏ qua, bấm Đăng lại không tạo trùng).
- `service.ts`: `CreateJobInput.sourceType` + `manual`; `SubmitOptions {actorId, allowCost}` cho `submitJob`/`submitBatch` (route truyền
  `req.userId` + `canSeeFinancials`); `submitJob` job MANUAL → ghi Tổng kho **trước** khi vào hàng đợi (log `[listing-copy] Tạo mới <job>: ghi
  Tổng kho N SKU`); **`linkNewListing` nguồn MANUAL → `productBySku` rỗng = KHÔNG nối** (24.3-1) — dòng ChannelProduct tạo ra `productId` null.
- `routes/listing-copy.ts`: `POST /jobs` nhận `sourceType MANUAL` + `listing` (kiểm trùng mã với kho/gian ngay, 400 "Mã SKU đã có: … (Tổng kho)");
  `POST /check` → `{byPlatform}` (form chưa đủ cấu trúc → `{byPlatform: null, reason}`); `POST /sku-check` → `{taken: [{sku, where}]}`;
  `POST /images` (express.raw image/jpeg|png|webp, trần 1 MB) → Supabase Storage bucket **công khai** `product-images` (`lib/supabase-storage.ts`
  thêm cờ `public` + `productImages.upload` trả URL bền `…/object/public/product-images/<owner>/<yyyymm>/<uuid>.jpg`); local chưa có
  `SUPABASE_URL` → ghi `backend/.local-uploads/` (gitignore) và `app.ts` phục vụ `/local-uploads` (chỉ ngoài production); `GET /manual-limits`.
- Test `__tests__/manual.test.ts` 8 ca (parse đủ trường/bỏ trùng, 3 lỗi cấu trúc, 4 ca SKU, URL/cân nặng/kích thước, chuẩn sàn 3 ca) +
  listing 45/45; tsc sạch.

**Frontend**
- `lib/compress-image.ts` tách từ hộp hỗ trợ (`compressImage` ≤ 1.600 px / ≤ 400 KB + `imageDimensions`); support-request-dialog import lại.
- `lib/api.ts`: `CopyListingManualPayload`, `createCopyListingManualJob`, `checkCopyListingDraft`, `checkCopyListingSkus`, `uploadCopyListingImage`;
  `sourceType` thêm `"MANUAL"`.
- `copy-listing/manual-product-form.tsx` (mới): grid `lg:[1fr_240px]`, 5 khối `<section id>` + mục lục neo (IntersectionObserver) + thẻ
  "Đạt chuẩn sàn" (POST /check debounce 400 ms, nhãn qua `missingLabel` với ctx trần từng sàn) + dòng blocker. Ảnh: input ẩn → nén →
  upload → lưới 80 px, "Bìa", "Đặt làm bìa", "Nhỏ" (< 500 px), bỏ; ảnh mô tả riêng; ảnh từng phân loại trong bảng. Phân loại: nhóm × chip giá
  trị (Enter/`,`/blur thêm), tổ hợp sinh tự động; mã gốc → `skuFromRoot` (chép quy tắc backend), sửa tay từng dòng, "Áp lại mã theo mã gốc";
  lỗi SKU từng dòng (trống / < 6 / > 50 / ký tự / trùng trong bài / "Đã có ở Tổng kho|gian X" qua POST /sku-check debounce 500 ms); giá
  chung + tồn chung áp dòng chưa sửa; cột Đăng bỏ phân loại. Vận chuyển: cân nặng (nhãn "Bắt buộc 3 sàn"), kích thước ("Lazada bắt
  buộc"). Tổng kho: giá vốn mặc định (ẩn với nhân viên) + ghi chú "chưa nối với gian — bấm Tự khớp".
- `copy-listing-page.tsx`: nút nguồn thứ 3 **"Tạo mới"**; `NewCopy` giữ `manual {payload, summary}`; bước 2 chọn gian dùng chung; chân
  "1 sản phẩm (N phân loại) × M gian đích" / "Sản phẩm mới: <lý do chưa gửi>"; nút "Tiếp: xem trước theo gian" → `createCopyListingManualJob`
  → BatchView như cũ (nhãn nguồn "Tạo mới trong Hubsell"; Lịch sử "Tạo mới").

**Kiểm local (30/10 14:00–14:15, backend-http 4010 + frontend-http 3010, tài khoản seed, gian "Demo Shopee" adapter giả lập):**
- Điền form bằng JS (tên 77 ký tự, mô tả, Màu × Size = 6 tổ hợp, mã gốc TC113 → `TC113-DEN-M`…, 3 ảnh bìa + 1 ảnh mô tả nạp qua
  DataTransfer → 4 tệp vào `/local-uploads`, ảnh 300 px gắn "Nhỏ"), thẻ Đạt chuẩn sàn 3 ✓, chân "1 sản phẩm (6 phân loại) × 1 gian".
- Tiếp → đợt tạo, nguồn "Tạo mới trong Hubsell · 6 phân loại · 3 ảnh", danh mục gợi ý 95 %, thiếu Chất liệu/Xuất xứ → Bổ sung + Lưu gian →
  Đăng → `[listing-copy] Tạo mới …: ghi Tổng kho 6 SKU`; DB: 6 `Product` (variantName, cùng groupKey, cost 120.000, giá 199.000, tồn 10,
  ảnh bìa), target LISTED `SP44258475`, 6 `ChannelProduct` Demo Shopee `externalId SP44258475-n`, **`productId` null** (không nối, đúng chốt).
- Kiểm trùng sống: quay lại form gõ `TC113-DEN-M` → "Đã có ở Tổng kho"; gõ `TC113` → "Ngắn hơn 6 ký tự (TikTok đòi ≥ 6)"; nút Tiếp khóa
  "Sửa mã SKU còn lỗi".
- Đo JS 1280 / 1440 / 1700 + tối (class `.dark`): 0 ô tràn sau khi sửa bảng phân loại `table-fixed` + cột 6/20/30/18/13/13 % + ô `px-2`
  (trước đó ô Giá 69 px cắt "19900|" ở 1280). Khung chính rộng hơn 32 px là `PageHeaderBand` lề âm sẵn có, không phải lỗi mới. Dưới 1024 px
  mục lục rơi xuống dưới form (grid 1 cột) — chấp nhận, trang này không dùng trên điện thoại.
- Bẫy khi test: backend `https://localhost:4000` cert tự ký bị trình duyệt pane chặn → dùng cặp `backend-http`/`frontend-http`; `backend-http`
  vai `web` KHÔNG chạy worker → bật thêm `backend` (vai all) để hàng đợi `listing.copy` xử lý.

**Chưa làm / chờ anh:** lát C (cron xóa ảnh job DRAFT > 30 ngày, trần ảnh theo gói, HQ hiện dung lượng bucket); "Đăng thêm gian" từ Lịch sử;
chưa kiểm trên gian thật (Shopee/TikTok/Lazada thật với ảnh từ Supabase Storage — bucket `product-images` tự tạo lần đầu gọi, cần
`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` trên Render, đã có cho ảnh hỗ trợ); form chưa soi trên Safari/macOS thật.

### 24.7 ĐÃ LÀM — lát C: ghi nhận ảnh + trần theo gói + cron dọn + HQ (30/10/2026 chiều, anh "Làm luôn lát C") — kiểm local, CHƯA PUSH

- **Bảng `listing_image_uploads`** (migration `20261030170000_listing_image_uploads`, RLS bật): `userId, storage ("supabase"|"local"),
  path, url (unique), bytes, jobId? (→ listing_copy_jobs ON DELETE SET NULL), createdAt`. `POST /images` ghi một dòng mỗi ảnh;
  `POST /jobs` MANUAL gắn `jobId` cho mọi URL trong listing (ảnh bìa + mô tả + ảnh phân loại) của chính chủ shop chưa gắn job khác.
- **Trần ảnh theo gói** (`services/listing-copy/images.ts` `PRODUCT_IMAGE_QUOTA`, **mặc định tự chọn, chưa có căn cứ khách**): bậc 1
  200 · 2 1.000 · 3 3.000 · 4 10.000 · 5 30.000 · 6 không giới hạn; chưa có thuê bao = không giới hạn (cùng luật plan-enforcement). Đếm
  = số dòng đang lưu của chủ shop (ảnh của lượt đã đăng giữ vĩnh viễn nên cũng tính). Chặn CỨNG tại `POST /images` → 403 "Gói hiện tại
  cho tối đa N ảnh sản phẩm, đang dùng M…". `GET /manual-limits` trả thêm `imageQuota {used, max}` → form khối Ảnh hiện "Gói của bạn:
  đã lưu 0/200 ảnh sản phẩm" (vàng khi chạm trần).
- **Cron dọn** (`cleanupListingImages`, gọi trong `workers/log-cleanup.ts` mỗi 24 giờ, log `[Log-cleanup] Ảnh sản phẩm Tạo mới: …`):
  ảnh mồ côi không gắn job quá **2 ngày** → xóa tệp (Supabase `productImages.delete` / đĩa local) + dòng; job MANUAL còn **DRAFT quá 30
  ngày** → xóa ảnh rồi xóa job (targets cascade). Mỗi lượt ≤ 200 ảnh mồ côi + 50 job nháp. Ảnh của job đã Đăng (mọi trạng thái khác DRAFT)
  **không bao giờ xóa** (anh chốt 30/10: đăng lại gian mới không tải lại).
- **HQ Sức khỏe** (`platform-health.collectInfra().productImages`): thẻ "Kho ảnh sản phẩm (Tạo mới)" — ảnh đang lưu · MB, chủ shop có
  ảnh, ảnh chưa gắn lượt tạo; backend cũ/bảng chưa migrate → null, thẻ ẩn.
- **Kiểm local:** test `images.test.ts` 3 ca (trần theo bậc, bậc lạ rơi về bậc 1, quotaExceeded) → listing-copy + listing 48/48; tsc BE+FE
  + eslint sạch. Chạy thật `cleanupListingImages` với dữ liệu giả (1 ảnh mồ côi 40 ngày + 1 ảnh mồ côi mới + 1 job DRAFT 40 ngày có 1 ảnh)
  → xóa đúng 1 ảnh mồ côi cũ + 1 job + 1 ảnh, giữ ảnh mới. Tải ảnh qua form → dòng `listing_image_uploads` storage local 4.507 byte; bấm
  Tiếp → `jobId` gắn đúng job "Áo thun nam ANO… AT207". Form hiện "0/200" (tài khoản seed gói bậc 1).
- Chưa làm: "Đăng thêm gian" từ Lịch sử; chưa kiểm gian thật + bucket Supabase thật (tự tạo public lần gọi đầu).

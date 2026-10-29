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
4. ~~Bật cờ~~ đã mở thật (nhãn demo); theo dõi log `[listing-copy]` + báo 4 khách đã hỏi; bỏ "(demo)" khi ổn.

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

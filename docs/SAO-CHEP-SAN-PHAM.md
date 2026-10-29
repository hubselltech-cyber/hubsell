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

# Hàng hóa: SKU kho có phân loại riêng, bảng cha–con, mã dự phòng đọc được (22/10/2026)

> Khách (shop váy, 302 SKU Shopee, 2 gian, anh Trung chuyển ảnh chat 22/10): "khi đồng bộ từ sàn về chỉ lấy
> id sản phẩm, 6 phân loại cùng một tên không biết cái nào là màu/size nào; hàng không còn tồn / không còn bán
> trên sàn cũng vào kho; kiểm kho là kiểm thực tế… bên Salework làm dễ quản lý hơn; muốn dạng cha con giống
> bên Giá vốn".

## 1. Chẩn đoán (soi mã 22/10)

| Hiện tượng khách thấy | Gốc trong mã |
|---|---|
| Mã SKU `SPE-56018188263-262974070538` | Khách không đặt SKU phân loại trên Shopee → `shopeeChannelSku` rơi về mã máy `SPE-{item}-{model}`; **kể cả khi khách đã điền ô "SKU sản phẩm" cấp cha** (item_sku) vì hàm chỉ nhìn `model_sku`. |
| 6 dòng cùng tên "Chân Váy Dáng A…" | Shopee trả `model_name` ("Đen,M") và adapter lưu `ChannelProduct.variantName`, nhưng `createProductsFromChannelProducts` tạo SKU kho chỉ lấy `productName`; `GET /products` không trả `variantName`; tab Sản phẩm trên sàn cũng không in → **không chỗ nào trong Hàng hóa hiện phân loại** (chỉ bảng Giá vốn có). |
| Phân loại hết hàng / ngừng bán vẫn vào kho | Trạng thái chỉ đọc cấp sản phẩm (`item_status`), Nối nhanh không lọc tồn 0; cờ Ngừng bán (`Product.isActive`) chỉ bật tay. |

Khảo sát Salework / BigSeller / Sapo / Ginee (tài liệu hướng dẫn của họ, 22/10): cả bốn đều **mỗi phân loại một
dòng kho, mã = mã gốc + phân loại, tên hiện kèm phân loại, bảng gom cha–con theo mẫu, có lọc/ẩn dòng sàn và trạng
thái Ngừng bán đặt hàng loạt**. Không bên nào bày mã số dài của sàn cho khách.

## 2. Thiết kế

### 2.1 SKU kho tách tên mẫu và phân loại
- `Product.variantName String?` — "Đen, M" (chuẩn hóa như `normalizeVariantName`: dấu phẩy + một khoảng trắng).
- `Product.groupKey String?` — khóa gom cha–con = `lower(trim(productName))` **chỉ khi có phân loại**; NULL = SKU
  đứng một mình. Tính ở MỘT nơi: `backend/src/lib/product-group.ts` (`productGroupKey`, `cleanVariantName`,
  `productDisplayName`, `skuFromRoot`). Mọi chỗ ghi tên/phân loại phải gọi: tạo từ sàn (`mappings.ts`), POST/PATCH
  `/products`, nhập Excel (cột "Phân loại", vắng cột = giữ nguyên), hộp Thêm sản phẩm (ô "Phân loại (tùy chọn)").
- Migration `20261022160000_product_variant_name_group_key`: 2 cột NULL + index `(userId, groupKey)` + **backfill
  một lần** (SKU kho có tên = tên sản phẩm sàn của dòng đã nối và dòng đó có `variantName` → nhận phân loại +
  groupKey). Khóa bảng Product có thử lại (webhook ghi tồn liên tục). Render tự áp khi deploy.
- Excel xuất thêm cột "Phân loại"; file mẫu nhập có cột này.

### 2.2 Bảng Hàng hóa cha–con (giống bảng Giá vốn)
- `GET /api/products?view=grouped`: **phân trang theo MẪU** — SQL thô gom `COALESCE(groupKey, id)`, trang =
  pageSize mẫu, rồi lấy mọi SKU của các mẫu đó (`AND [where, {groupKey in | id in}]`), xếp theo thứ tự nhóm (mẫu mới
  nhất lên đầu) + phân loại theo số tự nhiên (`Intl.Collator vi numeric`). Trả `total` = số mẫu, `skuTotal` = số SKU
  khớp bộ lọc. Chế độ phẳng (Excel, chọn SKU) giữ nguyên. Tìm kiếm quét cả `variantName`.
- `frontend/src/app/products/page.tsx`: cột **Sản phẩm lên đầu** (ảnh 36px + tên cắt ngắn, rê chuột đủ tên + phân
  loại xanh + mã sản phẩm sàn), Mã SKU lùi cột 2. Mẫu ≥ 2 phân loại = **dòng cha** (ảnh, tên, mã SP sàn, "N phân
  loại · n ngừng bán · n sắp hết", giá = khoảng, Tồn / Có thể bán = TỔNG, chip "Shopee ×6", ô tích chọn cả mẫu) bấm
  bung **dòng con** (chỉ in phân loại, thụt vào, vạch màu chủ đạo chạy suốt cụm). Mặc định thu gọn; đang tìm kiếm thì
  bung hết; nút "Bung hết / Thu gọn phân loại" cạnh phân trang. Ảnh hỏng → về ô icon (`onError`).
- Tab Sản phẩm trên sàn in phân loại dưới tên.

### 2.3 Mã dự phòng Shopee dùng mã cha (`integrations/shopee/client.ts` `shopeeChannelSku`)
Ba kiểu đặt mã trên Seller Center → ba khóa:
1. Đặt riêng từng phân loại → `model_sku` (như cũ).
2. **Chỉ đặt SKU sản phẩm cấp cha** → `{item_sku} ({tên phân loại})`, ví dụ `VAY01 (Đen, M)` — đúng luật đuôi tên
   15/10. Trước đây bị coi như không đặt.
3. Không đặt gì → `SPE-{item}-{model}` (không bịa khóa khi thiếu cả mã lẫn tên).
Hàm dùng chung 4 chỗ (adapter, đơn `service.ts`, hoàn `returns-sync.ts`); đơn/hoàn khớp theo id sàn trước nên
khóa đổi không lệch; `product-sync` đổi khóa tại chỗ theo `externalId`, giữ liên kết kho + giá vốn. Test
`integrations/__tests__/shopee-channel-sku.test.ts`.

### 2.4 Tự "Ngừng bán" khi sàn gỡ hết (`marketplace/product-sync.ts`)
Sau bước DELISTED của một lượt đồng bộ ĐẦY ĐỦ: SKU kho nối với các dòng vừa DELISTED mà **không còn liên kết
ACTIVE nào** (gian khác còn bán thì giữ) → `isActive=false`, log `[product-sync] … SKU kho tự chuyển Ngừng bán`.
Không đụng tồn / liên kết / đơn. Khách bán lại ở chip Ngừng bán; sàn đăng lại KHÔNG tự bật (tránh đè ý khách).
Test 5 trong `product-sync.test.ts`. Kết quả sync trả thêm `deactivated`.

### 2.5 Hộp "Tự khớp + tạo SKU" (`one-click-link-dialog.tsx`)
- Ô tích **"Bỏ qua phân loại đang tồn 0 trên sàn"** → `fetchChannelProducts(inStock=yes)` + `create-products
  {skipZeroStock}` (sàn không trả số vẫn tạo).
- Bước **mã gốc** (cách Salework): `GET /api/mappings/fallback-items` liệt kê sản phẩm sàn đang mang mã máy
  (`SPE-/TTK-/LZD-`), gom theo sản phẩm (ảnh, tên, gian, N phân loại); khách gõ mã gốc từng sản phẩm, xem trước
  `VAY01-DEN-M`; `create-products {rootSkus: {itemId: "VAY01"}}` → SKU kho `skuFromRoot` (bỏ dấu, chữ hoa). Dòng
  sàn giữ channelSku máy, liên kết hiện "khác mã kho". Để trống = mã máy như cũ. Tối đa 300 sản phẩm hiện trong hộp.
- `/quick-link` (Nối SKU nhanh theo gian trong hộp Cài đặt đồng bộ) nhận cùng tùy chọn, UI chưa bày.

### 2.6 Tab Sản phẩm trên sàn: nối thủ công tại dòng kiểu Salework (lát 6, anh chốt 22/10 tối)
Khách: "không cần nối tự động, nối thủ công kiểu Salework cũng được". Salework: bảng cha–con theo sản phẩm sàn,
mỗi phân loại một ô gõ mã kho + nút nối, Tạo SP kho cho cả sản phẩm, Ngắt kết nối từng dòng.
- `GET /api/mappings?view=grouped`: phân trang theo **sản phẩm sàn** (gian × id sản phẩm, SQL thô
  `split_part(externalId,'-',1)`), sản phẩm còn dòng chưa nối lên đầu; `linked/inStock/search` lọc như cũ.
- `POST /api/mappings/link-by-sku {channelProductId, skuCode}`: mã có trong kho → nối (đổi nối thì gỡ dòng cũ trước);
  chưa có → `createProductsFromChannelProducts(..., {skuById})` tạo SKU kho mang đúng mã khách gõ (tên, phân loại,
  ảnh, giá từ sàn; tồn ban đầu theo sàn; giá vốn thừa kế) rồi nối.
- `link-manager.tsx`: dòng cha = ảnh + tên + ID sàn + "N phân loại · n chưa nối" + gian + khoảng giá + tổng tồn sàn +
  nút **"Tạo SKU kho (n)"** cho mọi phân loại chưa nối (sàn không có mã → ô **Mã gốc** bắt buộc, Hubsell ghép
  `VAY01-DEN-M`; sàn có mã → lấy đúng mã sàn); dòng con = phân loại (sàn không trả tên → mã sàn) + mã sàn + tồn sàn +
  **ô "Gõ mã SKU kho…"** (Enter/nút nối; gợi ý `<datalist>` toàn bộ SKU kho; "Chọn có sẵn" mở hộp tìm theo tên) hoặc
  mã kho đã nối + nút gỡ từng dòng. Mặc định bung hết (đang gõ mã), bấm dòng cha để thu. Giữ tick nhiều dòng nối
  chung một SKU + hộp Tự khớp + tạo SKU cho khách đặt mã chuẩn.
- Bố cục bảng: `table-fixed` theo % (như bảng Giá vốn) → **không cuộn ngang**; 4 cột: tick · Sản phẩm trên sàn
  (38%, kèm chip sàn + tên gian + ID ở dòng phụ) · Giá · Tồn sàn (14%) · Mã SKU kho (phần còn lại, ô gõ co giãn +
  nút **Nối** / **Tìm** có chữ; dòng đã nối: mã kho + **Gỡ nối**). Anh chốt 22/10 tối: "kéo ngang thì mất việc",
  "nút kết nối bên cạnh giống Salework".
- **Nối thêm gian cho SKU X** (22/10 tối): từ Tồn kho bấm "Nối gian" / "Nối thêm gian cho SKU này" → tab sàn mang `targetProduct`:
  dải đích + nút một bấm "Nối vào X" (chưa nối) / "Chuyển sang X" (đang nối SKU khác) / "Đã nối"; ô tìm mồi 4 chữ đầu tên SKU kho,
  dòng trống có nút xóa từ khóa. Dòng đã nối (không có đích) có nút **Đổi** → ô gõ điền sẵn mã cũ.
- SKU kho cũ trơ lại sau khi chuyển / đổi (không còn liên kết nào) → tự **Ngừng bán** (`deactivateOrphanProducts`,
  anh chốt 22/10 tối), toast báo; tồn / đơn cũ giữ, khách bật lại ở chip Ngừng bán.
- Lọc trạng thái TRÊN SÀN (khách 22/10 tối): `GET /mappings?status=active|delisted`; chip "Đang bán trên sàn N · Sàn đã gỡ N",
  nhãn "Sàn đã gỡ" trên dòng. Dòng DELISTED giữ lại (không xóa) để không mất liên kết / lịch sử; SKU kho của nó tự Ngừng bán
  theo luật 2.4 khi mọi liên kết đều đã gỡ.
- Không có cột Combo (Hubsell chưa có SKU combo) — việc riêng nếu khách cần.

### 2.7 Chỉnh sau khi anh xem prod (22/10 tối)
- Bảng Tồn kho `table-fixed` theo % (`COL_HEAD_CLASS` trong `products/page.tsx`): Nhập · Xuất cố định 8,5rem nên không bao
  giờ bị cắt; tiêu đề xuống dòng khi hẹp; tên/mã cắt theo cột + tooltip; chip Bán trên xuống dòng. Đo 1700/1280: tràn 0.
- Sản phẩm đơn chừa chỗ bằng nút bung → thẳng hàng với sản phẩm nhiều phân loại.
- **Lọc Hết hàng** (khách xin): `GET /api/products?stock=out` = tồn ≤ 0 (áp cả SQL phân trang nhóm) + `outOfStockCount`
  (đang bán, tồn ≤ 0). Chip đỏ "Hết hàng N" đứng cạnh Đang bán / Ngừng bán, bật/tắt, kết hợp mọi bộ lọc khác. Khi lọc
  (hết hàng / tìm kiếm) backend trả thêm `groupTotals` (tổng phân loại từng mẫu) → mẫu 6 phân loại mà chỉ 1 khớp vẫn là
  dòng cha ghi "1/6 phân loại hết hàng" (tìm: "1/6 phân loại khớp"), không rơi thành sản phẩm đơn.
- Đồng bộ tồn tự động theo gian (bước 3) và Tự khớp GIỮ NGUYÊN — nối tay chỉ là đường thêm.

## 3. Việc với khách / vận hành
- Sau deploy, khách bấm **Đồng bộ từ sàn**: dòng `SPE-…` của khách đã điền SKU cha đổi khóa thành `VAY01 (Đen, M)`;
  backfill đã điền phân loại cho SKU kho cũ, bảng gom cha–con ngay.
- Lời khuyên gốc không đổi: đặt SKU riêng từng phân loại ngay trên sàn (không "Áp dụng cho tất cả phân loại").
- Kiểm prod sau deploy: log Render `[product-sync]` có dòng "SKU kho tự chuyển Ngừng bán"; SQL
  `SELECT COUNT(*) FROM "Product" WHERE "variantName" IS NOT NULL` > 0.

### 3.1 Backfill "Ngừng bán" cho SKU sàn đã gỡ TRƯỚC 22/10 (chờ anh chốt, anh dán Supabase)
Luật tự Ngừng bán chỉ bắt dòng DELISTED ở lượt sync SAU deploy. Đo 22/10 tối: toàn nền tảng **6.521** SKU đang bán mà mọi
liên kết sàn đã DELISTED (khách shop váy 104). Chạy riêng một shop trước (thay tên), xem rồi mới chạy toàn bộ:

```sql
-- Đếm trước (chỉ đọc)
SELECT COUNT(*) FROM "Product" p
WHERE p."isActive"
  AND EXISTS (SELECT 1 FROM "ChannelProduct" x WHERE x."productId" = p.id)
  AND NOT EXISTS (SELECT 1 FROM "ChannelProduct" x WHERE x."productId" = p.id AND x.status = 'ACTIVE');

-- Một shop (thay tên) — khách tự bật lại được ở chip Ngừng bán
UPDATE "Product" p SET "isActive" = false
FROM "User" u
WHERE u.id = p."userId" AND u."fullName" = 'Mạnh Nguyễn Văn'
  AND p."isActive"
  AND EXISTS (SELECT 1 FROM "ChannelProduct" x WHERE x."productId" = p.id)
  AND NOT EXISTS (SELECT 1 FROM "ChannelProduct" x WHERE x."productId" = p.id AND x.status = 'ACTIVE');
```
Toàn nền tảng = bỏ điều kiện `u."fullName"`. Không đụng tồn / liên kết / đơn; Lãi/Lỗ không đổi.

## 4. Chưa làm / cân nhắc
- Thứ tự phân loại trong mẫu theo số tự nhiên (S, M, L xếp L–M–S); muốn đúng thứ tự sàn cần lưu `tier_index`.
- Shopee `model_status` (phân loại tắt riêng) chưa đọc — chưa đối chiếu được docs open.shopee.com (JS render).
- Ngừng bán tự động chưa có nút "bật lại khi sàn đăng lại".
- App mobile chưa hiện phân loại / nhóm.

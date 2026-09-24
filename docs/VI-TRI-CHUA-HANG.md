# Vị trí chứa hàng — nhiều kho nhỏ / kệ / ô

Kế hoạch chốt với anh Trung ngày 15/09/2026. **Đợt A (nền) + Đợt B (vị trí, đợt 1) ĐÃ CODE 24/09/2026 — xem mục 8.6 / 8.7.**

## 1. Bài toán

- Seller nhỏ thường thuê **2-3 kho nhỏ gần nhau thay cho một kho lớn**. Nhu cầu thật là biết
  **còn bao nhiêu hàng ở kho nào**, không cần định tuyến đơn theo tỉnh hay theo gian hàng.
- Khách có kho rộng cần vị trí tới kệ, tầng, ô để nhặt hàng và kiểm kê.
- Khách doanh nghiệp sau này cần khu vực, sức chứa, gợi ý cất hàng, nối WMS ngoài.
- Không được đóng cửa với khách lớn, nhưng khách một kho **không được thấy gì rườm rà**.

## 2. Nguyên tắc thiết kế

1. **Kho và kệ/ô là cùng một thứ**: một bảng vị trí dạng cây cha-con. Shop nhỏ dùng một dòng,
   kho rộng dùng nhiều tầng, doanh nghiệp dùng cây sâu hơn. Khách tự đặt tên, không phải học khái niệm khu/dãy/tầng.
2. **Ẩn bằng sự vắng mặt, không công tắc cài đặt**: chưa tạo vị trí thứ hai thì giao diện y hệt hôm nay.
   Chỉ có một nút "Thêm vị trí chứa hàng" trong trang Hàng hóa. Tạo xong là cột và ô chọn tự xuất hiện.
3. **Tồn tính theo cặp SKU × vị trí**, tổng vẫn là một con số như hôm nay. Sàn chỉ nhận tổng.
4. **Mapping SKU sàn ↔ SKU kho không đổi**: vị trí nằm dưới SKU kho, sàn không biết hàng ở đâu.
5. **Không thu tiền theo số kho** (khác KiotViet 150k/kho/tháng). Vị trí không giới hạn ở mọi gói.
   Quét ô khi nhặt/kiểm kê mở từ Pro. Tầng WMS (khu, sức chứa, gợi ý cất, nối WMS ngoài) chờ khách Business/Enterprise hỏi.

## 3. Mô hình dữ liệu

```
StockLocation           -- vị trí chứa hàng, cây cha-con
  id, userId, parentId?, name, code (in tem/mã vạch), sortOrder (thứ tự ưu tiên trừ hàng),
  isDefault (vị trí gốc, mỗi shop đúng 1), sellable (đợt 2: ô hàng lỗi/hoàn không tính tồn bán),
  createdAt

ProductStockLevel       -- tồn theo vị trí
  productId, locationId, quantity        @@unique([productId, locationId])

Product.quantityInStock  GIỮ NGUYÊN = tổng quantity các vị trí sellable (số cache, bất biến phải giữ)
InventoryLog.locationId  THÊM (nullable) để hủy đơn trả về đúng vị trí đã trừ
InventoryLogType         THÊM TRANSFER (chuyển vị trí, tổng không đổi)
```

Migration: tạo vị trí gốc "Kho chính" cho mọi shop, đổ toàn bộ tồn hiện có vào đó.
**ALTER trên Supabase trước khi push** (bài học 09/08).

## 4. Luồng nghiệp vụ

| Việc | Cách làm | Hiện khi nào |
|---|---|---|
| Nhập hàng | Phiếu nhập thêm ô chọn vị trí, nhớ lần chọn cuối | ≥ 2 vị trí |
| Xem tồn | Cột "Đang ở" trong bảng Hàng hóa: `Kho 1: 40 · Kho 2: 15`, bấm mở chi tiết | ≥ 2 vị trí |
| Đơn bán trừ | Tự động theo thứ tự ưu tiên vị trí (kéo thả một lần); vị trí nào đủ cả dòng thì lấy, không thì trừ lần lượt. Không hỏi trên từng đơn | luôn |
| Hủy đơn / hoàn | Trả về đúng vị trí đã trừ (đọc `InventoryLog.locationId`); hàng hoàn nhập kho vào vị trí gốc hoặc ô chọn trên bulk "Nhập kho tất cả" | luôn |
| Chuyển vị trí | Một màn: từ đâu, sang đâu, SKU, số lượng, **xem trước số thay đổi** trước khi xác nhận. Không có trạng thái "đang chuyển" (kho gần nhau) | ≥ 2 vị trí |
| Sửa tồn tại vị trí | Sửa số ngay trong chi tiết "Đang ở" (thay kiểm kê ở đợt 1) | ≥ 2 vị trí |
| Xóa vị trí | Chặn khi còn hàng, bắt chuyển đi trước (học Shopify) | — |
| Thêm vị trí thứ hai | Mọi SKU tự có số 0 ở đó, không hỏi gì (học Shopify) | — |

Người lấy hàng đôi khi lấy ở kho khác cho tiện: không chặn, số lệch lộ ra khi kiểm kê theo vị trí (đợt 2) và chỉnh một lần.

## 5. Kết quả rà code (15/09)

- Chưa có model kho nào; tồn là cột `Product.quantityInStock`.
- **13 chỗ ghi** tồn: `integrations/order-stock.ts` (deduct/restore), `routes/inventory.ts` (adjust/set),
  `routes/koc.ts` (hàng mẫu), `routes/mappings.ts` (seed tồn theo sàn), `routes/orders.ts` (hủy/hoàn),
  `routes/products.ts` (tạo/Excel), `routes/webhooks.ts`. 2 chỗ ghi `holdQuantity`, 12 chỗ tạo InventoryLog.
- Mọi ghi đi qua `enqueueStockPush()` (`integrations/inventory-push.ts`); mọi đọc "có thể bán" qua
  `availableToPush()` và `availableInStock()` (`services/low-stock.ts`).
- ~33 chỗ đọc backend, 26 file frontend, **0 file mobile**, 5 file test.
- Chưa có tính năng kiểm kê thật (chỉ `/api/inventory/set`). Phiếu nhặt hàng không đọc tồn.
- Kết luận: giữ `quantityInStock` làm tổng cache thì **chỗ đọc và engine đồng bộ sàn không phải sửa**,
  chỉ gom 13 chỗ ghi vào một helper `applyStockDelta(tx, productId, locationId | null, delta, ...)`.

## 6. Điểm mạnh đối thủ đáng chép

| Của ai | Chép gì |
|---|---|
| Sapo | Ưu tiên kho: đủ hàng cả đơn → thứ tự cấu hình; tách Tồn / Có thể bán / Đang chuyển |
| Nhanh.vn | Vị trí 4 cấp, sinh hàng loạt cú pháp `Kệ [1-3]`, in mã vạch dán kệ, danh sách "chưa kiểm còn tồn", gộp nhiều phiếu kiểm |
| Odoo / Zoho | Một vị trí gốc mặc định, chưa mở rộng thì không hỏi vị trí |
| ShipHero | Cờ Sellable/Pickable: ô hàng lỗi/hoàn không tính tồn bán; pick-down lấy ô ít hàng trước |
| Shopify | Thêm location thứ hai → mọi SP tự có số 0; chặn tắt location khi còn việc treo |
| KiotViet | Chuyển kho có cột "Thực tế" khi nhận, lệch phải ghi chú |

Bẫy tránh: Zoho bắt điền 0 cho mọi bin khi kiểm kê; Sapo bị than "chọn nhầm chi nhánh → lệch tồn";
KiotViet thu thêm theo kho.

## 7. Kế hoạch triển khai

**Đợt 1 (một buổi):**
1. Schema + migration + SQL Supabase chạy tay trước.
2. Helper ghi tồn duy nhất, gom 13 chỗ; trừ theo ưu tiên; hủy trả đúng vị trí.
3. Trang Hàng hóa: nút "Thêm vị trí chứa hàng", cột "Đang ở", ô chọn vị trí trên phiếu nhập,
   màn chuyển vị trí có xem trước, sửa số tại vị trí.
4. Cập nhật 5 file test, chạy `npx tsc --noEmit` trước khi push (tsc Render compile cả test).

**Đợt 2:**
- In "Lấy ở Kho 2" trên phiếu nhặt hàng ghép vận đơn A6.
- Kiểm kê theo vị trí: chỉ đếm ô có hàng, đếm lại chỉ SKU lệch, gộp nhiều phiếu.
- Cờ "không bán" cho ô hàng lỗi, gắn với luồng hoàn 2 công đoạn.
- Sinh vị trí hàng loạt + in tem mã vạch.
- Quét ô trên app mobile khi nhập và nhặt.

**Sau này (Business/Enterprise, khi có khách hỏi):** khu vực, sức chứa, gợi ý cất hàng, bổ sung theo tầng,
map vị trí ↔ Shopee `location_id` (cột `channelStockLocationId` đã có), nối WMS ngoài.

## 8. Rà lại 24/09/2026 (anh Trung yêu cầu khảo sát lại một lần nữa trước khi làm)

### 8.1 Code từ 15/09 đến nay
- Các file lõi tồn kho (`order-stock.ts`, `inventory-push.ts`, `routes/inventory.ts`, `routes/products.ts`, schema Product/InventoryLog)
  **không có commit nào** ngoài TikTok đợt 2 (8eff504, 16/09): worker đẩy tồn TikTok theo `warehouse_id`
  lưu ở `ChannelProduct.channelStockLocationId` (Shopee dùng `location_id` cùng cột). Khung mục 3 vẫn đúng.
- Đếm lại chỗ ghi `quantityInStock`: 14 dòng (order-stock 2, inventory adjust/set 2, koc 1, mappings 2, orders 2,
  products tạo/Excel 4, webhooks 1) — khớp bản 15/09. `holdQuantity` 2 chỗ (order-stock). Mobile vẫn 0 màn tồn kho
  (chỉ quét hoàn). Test đụng tồn: 6 file.
- Trang Hàng hóa hôm nay: 2 tab (Tồn kho / Sản phẩm trên sàn), khối Kho trung tâm 3 bước, bảng 8 cột
  (Mã SKU · Tên · Giá vốn · Giá bán · Tồn kho sửa tại chỗ · Có thể bán · Bán trên · Nhập/Xuất), dòng bung sơ đồ
  kho ↔ gian, Thêm SP, Nhập Excel (upsert giá + SET tồn, log chênh), Xuất Excel, cài đặt SKU, hộp đồng bộ.

### 8.2 Lỗ hổng phát hiện thêm (ngoài chuyện vị trí)
1. **Không có lịch sử kho trên giao diện.** Backend có `GET /api/inventory/logs?productId` (50 dòng) nhưng
   frontend không gọi ở đâu. Khách thấy số tồn đổi mà không biết đơn nào trừ, ai sửa. `InventoryLog` cũng
   **không ghi ai làm** (không có actorId) và chỉ 3 loại IMPORT / EXPORT / SYNC.
2. **Không xóa / ngừng kinh doanh được SKU**: routes/products chỉ có GET / POST / PATCH / import; không cờ
   `isActive`. SKU tạo hàng loạt từ sàn (create-products) nằm mãi trong bảng.
3. **Nhập hàng từng SKU một popup**; nhập 30 mã từ xưởng = 30 lần bấm. Excel là lối thoát nhưng Excel là
   SET tổng, không phải cộng thêm → dễ đè nhầm tồn đang có.
4. **Chưa có kiểm kê**: chỉ sửa số trực tiếp từng ô, lý do cố định "Sửa tồn trực tiếp trên bảng".
5. Phiếu nhặt hàng A6 (`pick-list-pdf.ts`) chỉ nhận `sku / name / quantity` — chưa có chỗ in vị trí (đợt 2).

### 8.3 Đối thủ trực tiếp bổ sung (bản 15/09 thiếu BigSeller, Ginee)
| Của ai | Ghi nhận 24/09 | Rút ra cho Hubsell |
|---|---|---|
| BigSeller | Mọi tài khoản tự có "Default Warehouse"; đơn không có luật → về **kho gửi mặc định**; tách riêng **kho nhận hoàn mặc định**; push rule "1 store, nhiều kho" chọn nhiều kho nguồn → đẩy **TỔNG** lên kho sàn, công thức ×80% + 0, "sắp hết → đẩy 0"; kho kiểu "1 SKU 1 kệ" vs "1 SKU nhiều kệ"; nhập kệ hàng loạt bằng Excel; wave picking theo khu; kho 3PL là loại kho riêng | Xác nhận hướng "sàn nhận tổng" của mình. **Chép: kho nhận hoàn mặc định** (hàng hoàn về một chỗ để kiểm, không trộn kho bán) — hợp luồng hoàn 2 công đoạn |
| Ginee | Kho Ginee ↔ kho Shopee **1:1 trong cùng store**, nhiều store dùng chung một kho Ginee; chỉ đẩy tồn kho đã nhập, kho khác đẩy 0; phải bật push từng kho; sửa giá áp mọi kho | Mapping vị trí ↔ kho sàn là việc "sau này" như đã chốt; khi làm thì theo kiểu 1:1 per gian, không bắt khách bật từng kho |

Nguồn: help.bigseller.com (push rule đa kho 6855, khu vực kho 7727, thêm kho 3412), ginee.com/id/help/shopee-multiwarehouse-management.

### 8.4 Điều chỉnh khung so với 15/09
1. **Không seed vị trí gốc bằng migration.** Vị trí gốc + bảng `ProductStockLevel` chỉ sinh khi khách bấm
   "Thêm vị trí chứa hàng" lần đầu (một transaction: tạo gốc "Kho chính", đổ toàn bộ tồn vào gốc, tạo vị trí 2).
   Shop chưa dùng = bảng rỗng, không tốn dòng, không migration dữ liệu trên hàng nghìn SKU × N shop.
   Bất biến: shop có ≥ 1 vị trí thì `Σ ProductStockLevel.quantity (sellable) = Product.quantityInStock`.
2. Migration chỉ tạo bảng/cột (viết IF NOT EXISTS) → **Render tự `migrate deploy`**, không ALTER tay Supabase
   (dòng "ALTER trước khi push" ở mục 3 là bài học cũ 09/08, đã hết hiệu lực từ 06/08 và kiểm chứng lại 23/09 với backfill 90 ngày).
3. `InventoryLog` thêm **`actorId`** (ai làm) + `locationId` + loại **ADJUST** (kiểm kê / sửa số) và **TRANSFER** — cần cho cả
   lịch sử kho (8.2.1) lẫn vị trí, làm một lần.
4. `StockLocation` thêm cờ **`isReturnDefault`** (kho nhận hoàn mặc định, học BigSeller); null → vị trí gốc.
5. Helper ghi tồn duy nhất `applyStockDelta(tx, {productId, locationId?, delta, type, reason, actorId?, orderId?})`
   gom 14 chỗ; shop chưa có vị trí thì bỏ qua nhánh level.

### 8.5 Thứ tự — anh Trung chốt 24/09: **A → B** ("làm sớm, sau này thương mại đỡ sửa nhiều; có khách rồi mà sửa nhiều mất uy tín")
- **Đợt A — hoàn thiện nền — ✅ ĐÃ CODE 24/09 (xem 8.6).**
- **Đợt B — Vị trí chứa hàng đợt 1 — ✅ ĐÃ CODE 24/09 tối (xem 8.7).**
- **Đợt C (= đợt 2 mục 7) — ✅ ĐÃ CODE 24/09 khuya (xem 8.8), trừ mobile quét ô.

### 8.6 Đợt A đã làm (24/09/2026, kiểm trên local với shop reviewer@hubsell.vn)
**Schema / migration `20260924150000_product_inactive_inventory_actor`** (IF NOT EXISTS, Render tự áp; local đã áp tay):
`Product.isActive` (mặc định true), `InventoryLog.actorId` → User (SET NULL) + index `createdAt`, enum thêm `ADJUST`.

**Backend**
- `GET /api/inventory/logs` viết lại: sổ toàn shop, lọc `productId / from / to / type / q`, trang 20/50/100; mỗi dòng kèm
  SKU + tên, `actor {id, name}` (null = hệ thống), `order {orderCode, channelName, shopName}`.
- `POST /api/inventory/adjust-bulk {type, items[{productId, quantity}], reason}`: phần thuần `lib/inventory-bulk.ts`
  (gộp mã quét trùng, ≤ 200 mã, báo đích danh mã thiếu hàng) + 5 test; khoá `FOR UPDATE ... ORDER BY id`, một
  transaction, xong `enqueueStockPush`.
- Loại nhật ký: sửa tồn trực tiếp (`/set`) và Excel đè số → **ADJUST** (trước ghi IMPORT/EXPORT/SYNC gây hiểu nhầm);
  mọi thao tác tay ghi `actorId` (adjust / set / bulk / tạo SP / Excel / hủy đơn tay / nhập kho hàng hoàn / hàng mẫu KOC);
  webhook + worker để null.
- `GET /api/products?status=active|inactive|all` (mặc định active) + `inactiveCount`, `activeCount`; `PATCH` nhận
  `isActive` (chỉ ADMIN); `DELETE /:id` chỉ ADMIN và chỉ khi 0 dòng đơn, 0 liên kết sàn, 0 hàng mẫu, tồn = 0 — ngược
  lại 409 nêu lý do đích danh. `detectLowStock` + cháy hàng bỏ qua SKU ngừng bán.

**Frontend**
- Hub Hàng hóa: thanh tab chuyển sang `PageTabs` + `PageHeaderBand` (chuẩn 19/09), thêm tab **Nhật ký kho**
  (`components/products/inventory-log-table.tsx`, chỉ gọi API khi mở tab, chip loại + `DateRangePicker` + tìm SKU,
  bảng trong hộp cuộn, 20/50/100 dòng); deep-link `?tab=logs`.
- Mỗi dòng: nút **⋯** (`product-row-menu.tsx`) = Lịch sử kho (hộp `product-history-dialog.tsx` dùng lại bảng trên,
  ẩn cột SP) · Cảnh báo & tồn an toàn · Ngừng kinh doanh ⇄ Bán lại · Xóa SKU (hộp xác nhận, 409 thì hiện lý do và đóng).
  Nút chuông riêng đã bỏ (cột Tồn kho vốn ghi "≤ ngưỡng N"; nút thứ tư làm bảng tràn ngang).
- Chip **Đang bán / Ngừng bán N** chỉ hiện khi có SKU ngừng bán; xem "Ngừng bán" mà bán lại hết thì tự về "Đang bán";
  dòng ngừng bán gạch tên + nhãn; khối Kho trung tâm đếm `activeCount` không theo bộ lọc; Xuất Excel lấy `status=all`
  + cột Trạng thái.
- Trang riêng **/products/receive** "Phiếu nhiều mã": chip Nhập hàng / Xuất hàng, một ô gõ/quét mã (gợi ý 200 ms, Enter
  đúng mã thêm ngay, quét trùng cộng dồn, ↑↓ chọn), bảng SKU · tên · tồn hiện tại · số · tồn sau · bỏ dòng, lý do chung,
  một nút; xuất thiếu hàng chặn tại chỗ và báo mã.

**Chưa làm trong A (để B/C):** `balanceAfter` (tồn sau mỗi dòng nhật ký — sẽ ghi khi gom 14 chỗ ghi vào helper ở B),
mobile chưa có nhật ký, ảnh tour /guide chưa chụp lại.

### 8.7 Đợt B đã làm (24/09/2026 tối, kiểm local shop reviewer: bật → chuyển → nhật ký → rào xóa → tắt)
**Schema / migration `20260924200000_stock_locations`** (IF NOT EXISTS + FK trong `DO $$` idempotent; Render tự áp;
local áp bằng `apply-migration-local.ts` — script đã sửa để giữ nguyên khối `DO $$`):
`stock_locations` (userId, parentId, name, code unique/shop, sortOrder = ưu tiên, isDefault, isReturnDefault, sellable),
`product_stock_levels` (productId × locationId unique, quantity), `InventoryLog.locationId` + `balanceAfter`, enum `TRANSFER`.
**KHÔNG seed gốc bằng migration** — gốc "Kho chính" sinh khi shop bấm Thêm vị trí lần đầu.

**Sổ kho một cửa `services/stock-ledger.ts`** — 14 chỗ ghi cũ (order-stock deduct/restore, inventory adjust/set/bulk,
koc, mappings seed, orders hủy + hoàn, products tạo/Excel, webhooks) đều đi qua:
- `applyStockDelta(tx, {productId, delta, type, reason, actorId?, orderId?, locationId?, useReturnDefault?})`: tổng
  `quantityInStock` increment nguyên tử (mọi chỗ đọc + engine đẩy sàn KHÔNG đổi); shop có vị trí thì cộng/trừ level bằng
  `INSERT … ON CONFLICT DO UPDATE` (nguyên tử); nhập không chỉ định → gốc; trừ không chỉ định → `SELECT … FOR UPDATE`
  level rồi `lib/stock-allocation.ts allocateDeduction` (đủ cả dòng lấy trọn ở vị trí ưu tiên trước; không ai đủ trừ
  lần lượt; thiếu toàn kho dồn âm vào vị trí cuối — phơi bày bán vượt như tổng); mỗi vị trí đụng tới một dòng nhật ký
  kèm `locationId` + `balanceAfter` (tồn tổng sau bút toán).
- Hủy đơn (chưa giao) trả về ĐÚNG vị trí đã trừ (đọc `locationId` của log trừ). Hàng HOÀN: shop đặt "Nhận hoàn" thì về đó
  (kiểm trước khi trộn — học BigSeller), không thì về đúng vị trí đã trừ.
- `setStockAbsolute` (sửa số trên bảng, Excel đè, gieo tồn từ sàn), `setLevelAbsolute` (sửa số tại vị trí, ADJUST),
  `transferStockTx` (tổng không đổi, chặn khi nơi đi thiếu, 2 dòng TRANSFER), `createRootLocationTx` (INSERT … SELECT
  set-based, không lặp SKU).
- Bất biến: shop có ≥ 1 vị trí ⇒ Σ level = quantityInStock; 0 vị trí ⇒ 0 dòng level. Test tích hợp
  `stock-locations.test.ts` 7 ca kiểm bất biến sau mỗi bước; `stock-allocation.test.ts` 7 ca thuần.

**API `/api/stock-locations`** (cùng quyền Hàng hóa): `GET /` (kèm skuCount, totalQuantity, `enabled`), `GET /levels?productId`,
`POST /` (lần đầu tự sinh gốc, khoá dòng User chống 2 gốc), `PATCH /:id` (tên, mã, cha, mặc định / nhận hoàn duy nhất, sellable),
`PUT /order {ids}`, `DELETE /:id` (chặn còn con / còn hàng / đang mặc định khi còn vị trí khác; xóa vị trí cuối = TẮT tính
năng, level xóa theo, tổng giữ nguyên), `POST /transfer {from,to,items[],reason}`, `POST /set-level` (tổng đổi → đẩy sàn).
`/api/inventory/adjust` + `/adjust-bulk` nhận `locationId`; `GET /logs` trả `location` + `balanceAfter`.
`GET /api/products` trả `stockLevels[]` (chỉ vị trí ≠ 0).

**Frontend** (ẩn bằng sự vắng mặt — chưa có vị trí thì y hệt cũ):
- Nút "Thêm vị trí chứa hàng" → khi có: "Vị trí (N)" mở `stock-locations-dialog.tsx`: danh sách theo ưu tiên (mũi tên lên/xuống),
  sửa tên/mã tại chỗ, Đặt mặc định, Nhận hoàn, xóa (xóa vị trí cuối có confirm "tắt tính năng"); lần đầu chỉ một ô tên + một nút.
- Cột **Đang ở** (`stock-levels-cell.tsx`): `Kho chính 200 · Kho 2 10 (+n)`, bấm mở popover đủ vị trí, sửa số tại vị trí
  (Enter lưu), nút Chuyển vị trí → `stock-transfer-dialog.tsx` (Từ / Sang / số lượng, XEM TRƯỚC cũ → mới hai đầu, chặn thiếu).
- Hộp Nhập/Xuất từng SKU + trang Phiếu nhiều mã: ô chọn vị trí (nhập: mặc định; xuất: "Tự trừ theo thứ tự ưu tiên" hoặc chọn),
  nhớ lần chọn cuối (`lib/stock-location-pref.ts`, localStorage).
- Nhật ký kho + Lịch sử SKU: cột **Tồn sau** (mọi shop) + cột **Vị trí** (khi có vị trí), chip/loại "Chuyển vị trí".

**Để lại đợt 2 (mục 7):** in "Lấy ở Kho 2" trên phiếu nhặt A6, kiểm kê theo vị trí, cờ không bán gắn luồng hoàn, sinh vị trí
hàng loạt + tem mã vạch, quét ô trên mobile; cây cha-con đã có ở DB/API (parentId) nhưng UI đợt 1 hiện phẳng.

### 8.8 Đợt 2 đã làm (24/09/2026 khuya — anh Trung: "Làm tiếp đợt 2. Mà em phải test đủ vị trí đó nhé")
**Ô "không bán" gắn luồng hoàn** (`sellable=false`, ví dụ "Hàng hoàn chờ kiểm", "Hàng lỗi"):
- Bất biến đổi thành **`quantityInStock` = Σ level của vị trí BÁN ĐƯỢC** — mọi chỗ đọc + đẩy sàn vẫn không đổi.
  `applyStockDelta` chỉ cộng/trừ tổng phần rơi vào vị trí bán được; `transferStockTx` qua/ra ô không bán đổi tổng
  (`totalChanged` → route đẩy sàn); phân bổ trừ đơn bỏ qua ô không bán (bán vượt thì gốc âm, hàng chờ kiểm không bị đụng).
- Đặt ô không bán làm **Nhận hoàn** → hàng hoàn về đó, tồn bán KHÔNG tăng cho tới khi kiểm xong "Chuyển vị trí" sang kho bán.
- Rào: đổi cờ khi vị trí còn hàng → 409 "chuyển hàng đi trước"; vị trí mặc định luôn phải bán được.
- UI: nhãn "không bán" + nút Không bán / Cho bán trong hộp vị trí; ô Đang ở in nghiêng + header "tồn bán X · chờ kiểm Y";
  hộp Chuyển vị trí báo trước "tồn bán giảm/tăng N, sàn nhận số mới".

**Phiếu nhặt A6 in vị trí** (`services/fulfillment/pick-location.ts`): đơn đã trừ → "Lấy ở: Kho 2" hoặc "Lấy ở: Kho chính 1 ·
Kho 2 4" (đọc đúng log trừ kèm locationId, 3 truy vấn cho cả lô); chưa trừ → "Đang ở: Kho chính 40 · Kệ A1 4" (2 vị trí có hàng
theo ưu tiên); shop không dùng vị trí → phiếu y hệt cũ. Dòng in đậm ngay dưới SKU (`PickListItem.location`).

**Kiểm kê theo vị trí** — trang riêng `/products/stocktake` (nút "Kiểm kê" trên thanh công cụ):
- `GET /api/inventory/stocktake/sheet?locationId=` chỉ liệt kê mã ĐANG CÓ HÀNG ở vị trí (tránh bẫy Zoho điền 0 mọi ô);
  không vị trí → mọi SKU đang bán (trần 2.000).
- Gõ số thực đếm (Enter nhảy ô kế), ô quét mã cộng 1 / thêm dòng sổ 0 cho mã thực tế có ở đó, chip "Chỉ hiện lệch" để đếm
  lại riêng mã lệch, bản nháp nhớ localStorage theo vị trí, một nút Chốt.
- `POST /api/inventory/stocktake {locationId?, items[{productId, counted}], note?}` → mỗi mã lệch một dòng ADJUST
  "Kiểm kê dd/mm/yyyy tại X: sổ a → đếm b · ghi chú" (setLevelAbsolute / setStockAbsolute), mã khớp bỏ qua, đẩy sàn mã đổi.
  Chưa có bảng phiếu kiểm riêng / gộp nhiều phiếu (nhật ký + lý do đã đủ truy vết).

**Sinh vị trí hàng loạt + tem** (`lib/location-pattern.ts`): mẫu "Kệ A[1-5]", "Kệ [A-C][1-3]", "Ô [01-12]" (tích Descartes,
≤ 200, tên trùng bỏ qua, mã tự sinh không dấu "KE-A1"); `POST /api/stock-locations/bulk`. Tem: `POST /api/stock-locations/labels`
→ PDF A4 lưới 3×7 (`location-labels-pdf.ts`, font + Code 128 dùng chung phiếu nhặt), vị trí không có mã thì tem chỉ tên.

**Chưa làm:** quét ô trên app mobile khi nhập / nhặt (app mobile hiện 0 màn tồn kho — là việc riêng của app, làm khi có yêu cầu);
UI cây cha-con vẫn phẳng.

**Test đợt 2:** `stock-locations-sellable.test.ts` 7 ca tích hợp (chuyển vào/ra ô không bán đổi tổng, hoàn về ô không bán không
tăng tồn bán, đơn bỏ qua ô không bán, sửa số tại ô không bán, pickLocationText, tra theo đơn thật, PDF có dòng vị trí),
`location-pattern.test.ts` 5 ca; suite toàn bộ pass. **E2E local shop reviewer** (cổng 4001): sinh "Kệ [A-B][1-2]" lần đầu →
gốc + 4 kệ có mã KE-A1…; thêm "Hàng hoàn chờ kiểm" → Không bán + Nhận hoàn; chuyển 10 → Kệ A1 (tổng giữ 210), chuyển 5 →
ô không bán (tổng 205, log balanceAfter 205); đổi cờ khi còn hàng → 409; tem PDF 200 (15 KB); phiếu nhập 3 vào Kệ A2 (208);
phiếu nhặt PDF 200; ô Đang ở 3 dòng + "+1 vị trí khác"; Kiểm kê Kệ A1 sổ 10 → đếm 8 → chốt → tổng 206, log ADJUST đúng
người + vị trí; chuyển hết về gốc (tổng 211 = 210 + 3 − 2, ô không bán trả 5 về kho bán) → xóa 5 vị trí → xóa gốc → tắt,
stockLevels rỗng. Bug bắt được khi test: vị trí sinh hàng loạt lần đầu trùng sortOrder 0 với gốc → đã sửa.

### 8.9 Cây Kho › Kệ › Tầng (24/09 khuya, anh Trung thử prod: "sinh nhiều kệ thì các kệ không được gán vào Kho 2, thành kho khác")
- Mọi chỗ tạo (thêm một, sinh hàng loạt, sửa) có ô **Thuộc** (chọn kho/kệ cha; ô chọn cũng thụt lề theo cây). Hộp vị trí hiện
  cây thụt lề, mũi tên đổi chỗ chỉ trong cùng một cha. Sửa một vị trí → đổi "Thuộc" là chuyển nó (kèm con) vào kho khác — cách
  sửa các kệ anh đã lỡ tạo phẳng trên prod.
- Backend `normalizeTreeOrderTx`: sau mọi lần tạo / đổi cha / sắp lại, đánh số `sortOrder` theo duyệt cây chiều sâu (cha rồi
  tới con) → thứ tự ưu tiên trừ hàng đi theo cây, sổ kho chỉ cần ORDER BY sortOrder. `path` "Kho 2 › Kệ A1 › T2" trả trong
  danh sách; mọi ô chọn (Nhập/Xuất, Phiếu nhiều mã, Kiểm kê, Chuyển vị trí), ô Đang ở, và phiếu nhặt in đường dẫn.
- Rào: đổi cha thành con/cháu của chính nó → 400 (đi ngược lên tới gốc); xóa kho còn kệ con → 409 (đã có).
- E2E local: tạo Kho 2 → sinh "Kệ A[1-2] T[1-2]" thuộc Kho 2 → tạo Kho 3 → thứ tự 0..6 đúng cây, mã KE-A1-T1…; PATCH Kho 3 vào
  Kho 2 → tự xếp "Kho 2 › Kho 3" cuối nhánh; Kho 2 vào Kho 3 → 400 vòng lặp; xóa Kho 2 còn 5 con → 409; xóa hết → tắt.
- Chưa làm (chờ anh chốt sau khi xem): trang "Cất hàng lên kệ" quét tem, chip lọc bảng theo vị trí.


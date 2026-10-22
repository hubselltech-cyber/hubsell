# Giá vốn cho gian vài nghìn SKU: tên phân loại cạnh mã + lọc "SKU bán trong kỳ chưa có giá vốn" (22/10/2026)

> Nguồn: nhận xét khách (gian Shopee + TikTok, vài nghìn phân loại) gửi anh Trung 22/10/2026, Google Doc "FeedBack".
> Anh chốt: làm 3 ý web theo thứ tự 4 → 1 → 3; ý 2 (định nghĩa "Lợi nhuận thực tế") BỎ; mobile + gói để đại tu sau.
> Tên sản phẩm dài: **cắt theo bề rộng + tooltip đủ tên** (áp cho mọi bảng trong tài liệu này).

## 1. Ý 4 — Cấu hình giá vốn mất tên phân loại khi tìm theo mã (`3bb3a8b2`)

**Hiện trạng cũ.** API đã trả `variantName` + `imageUrl`, nhưng bảng nhóm cha–con bằng cách **đoán theo tên** (`variantGroupKey`). Dán mã
`SPE-…` vào ô tìm → còn đúng một dòng → vẽ kiểu "dòng đơn" chỉ in tên cha. Tab Mapping cũng vậy ở dòng không có cha.

**Sửa.**
- `app/finance/cost-prices/page.tsx`: khóa nhóm = **gian + mã sản phẩm sàn** (`channelId:itemId`), đúng cây của sàn; mỗi lá (đủ mọi tầng,
  "Hồng, 3-5kg") là một dòng con dưới đúng mẫu. Cùng mẫu trên hai gian = hai nhóm. Hàng kho nội bộ không có mã sàn mới rơi về đoán theo tên.
  Lý do bỏ đoán tên: sự cố Hi.Bé 15/10 ([DONG-BO-SAN-PHAM-TRUNG-MA-PHAN-LOAI.md](DONG-BO-SAN-PHAM-TRUNG-MA-PHAN-LOAI.md)) — danh tính thật là
  `externalId`, tên phân loại sàn trả về không bao giờ nằm trong tên mẫu.
- `cost-price-table.tsx`: dòng con in `variantName` (tên sàn, đủ tầng) → đoán đuôi tên (kho) → mã; **dòng đơn in thêm dòng phân loại** màu xanh
  dưới tên (đây chính là dòng khách thấy khi tìm theo mã). Tên kho trùng hệt tên phân loại thì không in hai lần.
- `cost-mapping-tab.tsx`: dòng không có cha in dòng phân loại; nhóm mã mà các gian gắn vào **phân loại khác tên** (`variantMixed`, sàn cho phép
  — sau 15/10 trong một gian mã trùng đã có đuôi tên, chỉ còn giữa các gian) liệt kê "N phân loại khác tên: A (gian 1) · B (gian 2)" thay vì lấy
  tên một dòng làm mặt nhóm; tìm được theo `externalId` (mã sản phẩm / mã phân loại sàn) của mọi gian.
- Backend `GET /api/finance/sku-products`: `variantName` **null thật** khi sàn không có (trước gán tạm = `productName`, làm Excel xuất cột
  "Phân loại" sai) + thêm `externalId`. `lib/cost-mapping.ts`: `MappingTarget.externalId`, `SkuGroup.variantMixed` (+ test).

Không thêm ảnh ở dòng con: sàn chỉ có ảnh cấp sản phẩm, lặp ở từng con là thừa.

## 2. Ý 1 — "N đơn chưa có giá vốn" không biết đơn nào (`30cc5dc2`)

**Phản biện với khách:** đơn vị để sửa là **SKU**, không phải đơn — 47 đơn có thể chỉ là 3 SKU, nhập xong 3 giá vốn là 47 đơn tự tính lại
(trang Giá vốn vốn tự vá đơn cũ). Nên link dẫn sang trang Giá vốn **lọc sẵn SKU đã bán trong kỳ chưa có giá vốn**, xếp SKU gây nhiều đơn lên đầu.

- `GET /api/finance/sku-products/missing-cost?from&to[&channelName][&channelId]` (quyền `finance.cost-prices`): một câu `GROUP BY` trên
  `order_line_ledger` — cùng phạm vi với số "N đơn" (`countsAsRevenue`: không hủy, không đang hoàn; trục ngày tạo đơn), dòng `costPriceAtSale <= 0`,
  gom theo `(channelId, externalId, channelSku)`, `count(DISTINCT orderId)`, trần 5.000 SKU (+ `truncated`), kèm `skuCount`, `orderCount`,
  `ledgerPending`. Gọi `ensureLedgerFresh` như các báo cáo khác.
- `missing-cost-note.tsx` thêm `missingCostHref(range, channel)` → `/finance/cost-prices?missing=period&from&to[&channelName][&channelId]`;
  dòng nhắc ở Báo cáo dòng tiền và hộp nhắc ở Tổng quan + Dòng tiền đều dùng. Trang Lãi/Lỗ (OverviewDashboard) không có kỳ → giữ link thường.
- Trang Giá vốn đọc query một lần lúc mount (không `useSearchParams`, cùng cách trang Hàng hóa): đặt tab sàn/gian theo link, mở "Tất cả, kể cả
  đã gỡ" (SKU đã gỡ vẫn có đơn trong kỳ), lọc "Chưa nhập giá vốn"; khớp dòng theo **gian + externalId**, không có id (đơn trước 18/10) thì
  **gian + mã** chuẩn hóa như `normalizeSkuCode`. Dải vàng: "Đang hiện SKU đã bán từ … đến …: N SKU làm M đơn chưa tính được lãi" + nút
  **Xem tất cả SKU** (xóa query, trả bộ lọc). Từng dòng (và dòng cha cộng dồn) in "· N đơn chờ giá vốn". Không còn dòng nào mà `orderCount > 0`
  → giải thích (SKU đã xóa trên sàn hoặc vừa nhập giá, bấm "Áp giá vốn cho đơn cũ").

## 3. Ý 3 — Chi tiết đơn chỉ có mã (`d407358b`)

- `OrderItem` không có trường phân loại. `lib/order-line-names.ts loadVariantNames(lines)`: **hai** `findMany` trên `ChannelProduct` cho cả
  trang đơn — khớp **gian + externalId** → **gian + mã** (không phân biệt hoa/thường) → `Product.variantName` của SKU kho đã nối → "" (in mã như cũ).
  Không bao giờ khớp chéo gian. Test `order-line-names.test.ts`.
- `loadRealizedPnl` điền `variation` cho `row.items` (ghép theo chỉ số với `o.items`, `computePnlRow` giữ nguyên thứ tự). `PNL_INCLUDE` lấy thêm
  `product.variantName`.
- Cột "Chi tiết sản phẩm" (`realized-pnl/cells.tsx ProductLines`): mỗi dòng hàng = **tên (co lại, …) · phân loại × SL** + mã sàn mono dòng dưới;
  phân loại và số lượng luôn hiện, tên nhường chỗ. Tooltip đủ.
- Kiểm toán phí (`/finance/fee-audit`, 3 bảng: truy thu ship, sàn trả thiếu, chờ sàn trả): include `items` (select gọn) + `auditItemsOf`; ô
  Mã đơn in món đầu "tên · phân loại × SL +N món", tooltip liệt kê cả đơn.

## 4. Kiểm & chưa kiểm

- tsc BE + FE sạch; vitest `src/lib/__tests__` 220 xanh (cost-mapping + order-line-names mới).
- UI soi ở 1280 bằng trang tạm giả API (đã xóa): 2 tầng + mã có đuôi, tên dài, phân loại đứng lẻ, hàng kho, nhóm khác tên; lọc theo kỳ + nút Xem
  tất cả. SQL `missing-cost` chạy thật trên DB dev (200, dòng thật).
- ⚠️ DB dev không có gian nào vừa có đơn vừa có `variantName` → đường tra tên phân loại cho dòng đơn mới có test unit, **chưa thấy trên dữ liệu
  thật** → sau deploy soi prod bảng Lãi/Lỗ, cột Chi tiết sản phẩm, gian Shopee có phân loại.
- Bỏ qua theo anh: mục 2 (Lợi nhuận thực tế âm), mobile (doanh thu trước/sau KM, bộ lọc Quảng cáo nhảy 7 ngày), gói miễn phí.

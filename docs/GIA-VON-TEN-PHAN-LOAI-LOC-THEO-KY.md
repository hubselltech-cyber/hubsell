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

## 5. 19/11/2026 — Dòng đơn mang tên phân loại + MỘT luật hiển thị cho màn quét, bảng đơn, phiếu nhặt

> Nguồn: khách không đặt SKU trên sàn (TikTok) kêu 18/11 — màn "Quét xem chi tiết đơn" của app in "SKU: 1733668291614…"
> (id sàn), tên phân loại bị cắt ở đuôi tên; bên khác khách đang dùng hiện phân loại thành dòng riêng. Anh Trung: "lên phương án
> hợp lý để thuận tiện cho cả những người có dùng SKU và những người không dùng SKU"; chốt "Làm đủ một lần"; nhắc thêm "giao
> diện cho khách xem phải đẹp vì có thể trong 1 đơn hàng khách có tới 20 sản phẩm sku".
> Đây là phần nối tiếp mục 3 (ý 3 ngày 22/10 mới làm cho Lãi/Lỗ + Kiểm toán phí; mobile hôm đó để lại).

### 5.1 Gốc

- `OrderItem` không có cột phân loại; cả 3 sàn ghép "Tên sản phẩm - Tên phân loại" vào `productName` lúc đồng bộ → phân loại nằm
  ở ĐUÔI, giao diện cắt tên 1–2 dòng là mất đúng thứ kho cần đọc.
- `channelSku` là KHÓA khớp kho. Người bán để trống mã thì nó là mã máy: TikTok = `sku_id` trần 19 số (không có tiền tố),
  Shopee = `SPE-item-model`, Lazada = ShopSku `…_VNAMZ-…` hoặc `LZD-…`.

### 5.2 Luật hiển thị (không có công tắc cài đặt)

Mỗi dòng hàng: **tên sản phẩm** (không đuôi) / **TÊN PHÂN LOẠI** đậm, không cắt / **SKU** chỉ khi là mã người bán tự đặt (mã máy
ẩn hẳn, không in "SKU: --"). Người dùng SKU thấy cả phân loại lẫn SKU; người không dùng SKU thấy phân loại, không thấy dãy id.

- Backend `lib/order-line-display.ts` (`lineDisplay`, `isMachineSku`, thuần, 17 test): trả `baseName` / `variantName` / `sellerSku`.
  - **Bất biến:** chữ phân loại hiện ra luôn là chữ CỦA CHÍNH ĐƠN. Danh mục sàn chỉ dùng để tìm ĐIỂM CẮT cho đơn cũ, không bao
    giờ lấy tên phân loại hiện tại của danh mục đè lên đơn (người bán đổi tên phân loại sau khi bán).
  - ⛔ Không cắt mò theo " - " (tên sản phẩm của khách có sẵn " - "): quét mọi vị trí " - ", so đuôi sau chuẩn hóa với phân loại
    đã biết; đơn cũ không khớp thì thử cắt theo tên sản phẩm của danh mục; vẫn không được thì giữ nguyên tên, phân loại = null.
  - Mã máy: khuôn `SPE-/TTK-/LZD-` + ShopSku Lazada + dãy toàn số ≥ 16 chữ số; có `externalId` thì so đúng id lá. Ngưỡng 16 là
    mặc định tự chọn (sku_id TikTok 19 số; mã vạch dài nhất thông dụng GTIN-14 là 14 số, mã vạch Tổng kho 13 số).
  - Khóa trùng mã có đuôi product-sync thêm ("LT075-HONG (Hồng, 3-5kg) #173…") → SKU in ra là "LT075-HONG".
- **Cột mới `OrderItem.variantName`** (migration `20261119090000_order_item_variant_name`, cột NULL, khối lấy khóa có thử lại):
  ghi nguyên văn TikTok `sku_name` / Shopee `model_name` / Lazada `variation` lúc TẠO đơn.
  - ⛔ **Không điền bù đơn cũ** (đổi so với đề xuất 18/11): điền bù lúc quét lại = mở giao dịch cho mọi đơn tạo trước hôm deploy
    ở mỗi nhịp 10 phút — đúng bệnh băng thông worker đã sửa 12/10. Đơn cũ tách tên lúc ĐỌC.
- `services/item-images.ts attachItemImages`: cùng MỘT câu `ChannelProduct` đang lấy ảnh nay trả thêm ba trường chữ; tra theo
  `externalId` trước, mã sau (khóa bị product-sync đổi vẫn ra ảnh + điểm cắt). Dùng cho `/api/orders`, `/api/orders/lookup`,
  danh sách đơn hoàn. `productName` + `channelSku` giữ nguyên trong phản hồi (client cũ, khóa gom).
- `/api/orders/pick-summary` + `lib/pick-summary.ts`: mỗi dòng kèm ba trường chữ; **khóa gom không đổi**.
- `lib/order-line-names.ts loadVariantNames` (mục 3): dòng có `OrderItem.variantName` thì dùng luôn, không hỏi danh mục — Lãi/Lỗ,
  Kiểm toán phí, Video đóng hàng được lợi theo (danh mục TikTok hay thiếu tên phân loại).

### 5.3 Giao diện cho đơn tới 20 phân loại

- Mobile `components/OrderLines.tsx` (dùng chung màn quét chi tiết đơn, hộp chi tiết đơn, phiếu quét đơn hoàn) + `lib/order-lines.ts`:
  phân loại CÙNG sản phẩm gom dưới một tên (tên dài in một lần + "12 phân loại · 17 món"), mỗi phân loại một dòng ngắn có ảnh
  riêng, số lượng thẳng một cột bên phải; **từ 2 món tô đỏ đặc**; đầu danh sách "20 dòng hàng · 28 món". KHÔNG gấp bớt dòng.
  Sản phẩm đơn trùng tên KHÔNG gom (quà tặng 0 đ là món khác).
- **Chạm ảnh nhỏ → phóng to ảnh của đúng phân loại đó** (anh Trung 19/11 sau khi xem ảnh local: "click vào avatar của phân loại
  sẽ phóng to ảnh phân loại đó lên để xem"): nền tối, ảnh `contain` (không cắt mép), dưới ảnh là tên phân loại + tên sản phẩm,
  chạm bất kỳ đâu để đóng. Dòng không có ảnh thì không chạm được. Nằm trong `OrderLines` nên có ở cả ba màn dùng nó.
  Chưa làm cho thẻ đơn ngoài danh sách, phiếu nhặt và web (anh chưa yêu cầu).
- Thẻ đơn danh sách mobile: tên 1 dòng / phân loại đậm / mã người bán.
- Phiếu nhặt hàng + thống kê Quét nhiều (`goodsRowText`): phân loại LUÔN có dòng riêng (soi local thấy tab "Sản phẩm" cắt tên 2
  dòng làm các phân loại trông y hệt nhau); tab "SKU" không có mã người bán thì tiêu đề là tên phân loại; câu "Không có mã SKU"
  chỉ còn ở dòng gom theo tên của tab SKU.
- Web: `order-products-cell.tsx` (xổ ra thì gom theo sản phẩm — đơn 20 phân loại ở 1280: cao 1.593px → 983px), `return-dialog.tsx`,
  `pick-summary-dialog.tsx` + bản in (`print-pick-summary.ts`: cột Mã SKU in mã người bán, phân loại đậm dưới tên).
- App chạy được với máy chủ cũ (không có trường mới → giữ nguyên tên, chỉ ẩn mã máy) và máy chủ mới chạy được với app cũ.

### 5.4 Kiểm & chưa kiểm

- tsc backend / frontend / mobile sạch; eslint tệp mới sạch (mobile còn lỗi cũ `set-state-in-effect` không thuộc việc này).
  Test: `order-line-display` 17, `item-images` 3, `pick-summary` +2, `order-line-names` +1 (vitest); mobile `order-lines.test.ts` 8
  (`npx tsx --test` từ backend/). Cả bộ vitest: 2.757 xanh, 8 đỏ ở 5 tệp dùng DB local (ads-rows-ledger-db, channel-delete-db,
  order-ledger-db, realized-pnl-ledger-db, pack-video retention-db). ✅ Đã chạy lại 5 tệp đó trên bản mã GỐC (worktree tạm ở
  HEAD `90dd28b9`, chưa có thay đổi nào của việc này): đỏ đúng 8 ca y hệt → có từ trước, do DB local (thiếu chỉ mục / khóa ngoại
  của sổ cái, dữ liệu thử video còn sót), không do cột mới.
- Migration đã chạy trên DB local 2 lần (chạy lại êm).
- Soi local bằng một gian thử + 4 đơn `DEMOPL-*` (20 dòng không SKU, có SKU, đơn cũ, một món — script seed chỉ để ở máy, không
  commit; dữ liệu thử đã xóa): app bản web 375 px sáng + tối — thẻ đơn, chi tiết đơn 20 dòng, đơn có SKU, đơn cũ, phiếu nhặt 2 tab,
  chạm ảnh phóng to rồi chạm đóng; web 1280 — cột sản phẩm xổ 20 dòng, không phần tử nào tràn ô.
- ❌ Chưa nhìn: màn quét bằng camera thật / phiếu quét đơn hoàn (cùng component, chưa mở); thống kê Quét nhiều; hộp phiếu nhặt +
  bản in + hộp hoàn trên web; máy thật iOS / Android (kể cả hộp phóng ảnh mở TỪ TRONG hộp chi tiết đơn — hai lớp Modal lồng
  nhau, mới thấy chạy trên bản web); dữ liệu đơn thật của khách (payload `sku_name` suy từ mã, chưa đo prod).

### 5.5 Lên prod + app có cần build không

- 19/11 anh duyệt giao diện + bảo "dọn dẹp, commit và push". Backend (migration + API) và web lên theo lượt push.
- **App KHÔNG cần build mới — chỉ cần OTA.** Phần app đổi toàn mã JS / giao diện, không thêm module native, plugin hay quyền
  (`package.json` không đổi). Nhưng OTA chỉ tới máy cài bản CÙNG `version` với `app.json` lúc đẩy (runtime = `expo.version`):
  `app.json` đang là 1.4.3 → OTA tới máy đã lên 1.4.3; máy còn ở 1.4.2 phải cập nhật app từ kho lên 1.4.3 (bản đã nộp 17/11,
  không phải dựng lại) rồi mới nhận. Giữa 1.4.2 và 1.4.3 chỉ khác đúng dòng `version` (không đổi native) nên về kỹ thuật có thể
  đẩy thêm một bản OTA cho runtime 1.4.2 — CHƯA làm, chờ anh quyết.
- Trước khi đẩy OTA: cây git trong `hubsell-mobile` phải sạch (`scripts/ota-update.mjs` từ chối nếu còn tệp chưa commit) — hiện
  còn `src/lib/scan-sounds.ts` (sửa âm báo quét 18/11) chưa commit, chờ anh duyệt.
- App cũ gặp máy chủ mới và app mới gặp máy chủ cũ đều chạy (trường mới là tùy chọn; không có thì giữ tên cũ, chỉ ẩn mã máy).
- **Đã lên 19/11 rạng sáng:** push `4a23a173` + `dd167b09`; `/health` prod đổi sang `dd167b09` sau ~5 phút (migration qua).
  OTA: anh bảo "Đẩy OTA 1.4.3" → update group `2b06e23a-97f2-49d6-9673-bfa54501cd96`, kênh production, runtime 1.4.3, iOS +
  Android, từ commit `dd167b09` — bản OTA đầu tiên của runtime 1.4.3. `scan-sounds.ts` được tạm cất lúc đẩy rồi trả lại, nên
  bản OTA không chứa sửa âm báo. Máy 1.4.2 không nhận. ❌ Chưa thấy trên máy thật; chưa mở đơn mới trên prod để nhìn dòng phân loại.
- **19/11 trưa — bản OTA đêm qua đang tới khách:** `eas update:insights` 13:20: iOS 12 máy, Android 5 máy, 0 lượt lỗi. 1.4.3 đã phát
  hành cả hai kho. Máy anh chạy TestFlight 1.5.0 (37) (kênh `thu-video`, runtime 1.5.0) nên không nhận OTA 1.4.3; bản 37 có sẵn mã
  này nhưng anh báo chưa thấy thay đổi — CHƯA tìm ra nguyên nhân, anh chốt "đơn cũ thì thôi kệ đi" (đừng soi tiếp nếu anh không gọi).
- **Chỗ hở + bản vá (`9be874e8` trên master):** dòng KHÔNG tách được phân loại (đơn cũ, danh mục sàn không khớp) vẫn bị cắt tên 2 dòng
  (thẻ đơn 1 dòng) → đuôi phân loại vẫn mất. Nay dòng không có phân loại riêng thì tên hiện tới 6 dòng ở chi tiết đơn, 4 dòng ở thẻ đơn.
- **OTA lần hai cho khách 1.4.3 (19/11 ~14:20, anh: "Em đẩy OTA cho khách bản 1.4.3 nhé"):** update group
  `949a279b-e5ab-4734-994d-d767e57b0966`, kênh production, runtime 1.4.3. ⛔ KHÔNG dựng từ master (master = 1.5.0, có Chuẩn bị hàng +
  In phiếu cần 3 gói native bản 1.4.3 không có): dựng từ nhánh local `ota/1.4.3-ten-khong-cat` = `dd167b09` + bản vá (`16701fda`),
  trong worktree tạm với `npm ci` theo lockfile 1.4.3. Vá tiếp cho khách 1.4.3 thì làm đúng cách này.

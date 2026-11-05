# Đóng gói & Bàn giao — trạng thái nội bộ "Đã đóng gói" + Biên bản bàn giao cho ship (01/11/2026)

**Nguồn yêu cầu:** khách đang dùng Ship Xanh muốn thêm trạng thái **"Đã đóng gói"** sau "Đã in phiếu". Luồng kho của họ: in phiếu → gói → **cầm điện thoại quét lại từng kiện** để biết đã gói xong đơn nào, và **đơn nào đã hủy thì vứt lại** — vì ship thường ôm cả xấp về bưu cục mới bắn mã, lúc đó mới lòi ra đơn hủy đã đi theo.

**Anh Trung chốt 01/11 (lần 2, sau khi em làm bản đầu phức tạp hơn):** *"ở Đã in, khách chỉ cần quét bằng điện thoại thì ngay lập tức đơn nhảy sang tab Đã đóng gói. Ở tab Đã đóng gói khách chỉ việc tích tất cả → Tạo biên bản bàn giao thì sẽ ra các bản PDF tương ứng với các đơn vị vận chuyển để khách tải về in hoặc mở ra in."* Bước nội bộ, không liên quan sàn; mobile nối sau.

## 1. Luồng người dùng (bản chốt)

1. Trang Đơn hàng → tab Đã xử lý → chip **Chờ đóng gói** (tên cũ "Đã in phiếu", đổi 04/11, xem mục 5) → nút "Quét đóng gói" (hoặc mở thẳng `/orders/packing` trên điện thoại).
2. Trang quét: bắn máy quét / camera từng kiện → khung to xanh "ĐÃ ĐÓNG GÓI" + bíp; đơn **đã hủy** → khung đỏ "KHÔNG ĐƯA SHIP · ĐƠN ĐÃ HỦY — bỏ kiện lại" + hai tiếng trầm. Quét nhầm → "Bỏ dấu" ngay dòng vừa quét. Chỉ có vậy, không bảng, không nút in.
3. Về trang Đơn hàng → chip **Đã đóng gói** → tích "Chọn tất cả" → thanh hàng loạt **"Tạo biên bản bàn giao (N)"** → hộp kết quả liệt kê **mỗi hãng vận chuyển một biên bản** với nút **Mở** / **Tải về**, thêm "Mở tất cả (một file)" khi ≥2 hãng. N chỉ đếm đơn đã quét và chưa bàn giao; đơn khác trong lựa chọn bị bỏ qua và hộp nói rõ số bỏ qua.
4. Sau khi tạo, dòng đơn in **"Đã bàn giao"** — bấm vào là mở lại đúng tờ PDF đó (in lại khi kẹt giấy). Đơn gói rồi mà sàn hủy sau đó hiện **"Đã gói — lấy kiện ra"** màu đỏ (tab Hủy / Hoàn) và không bao giờ vào biên bản.

Quét thêm đợt mới rồi tạo biên bản lần nữa → biên bản **mới, số khác**, chỉ gồm đơn mới; đơn đã nằm ở biên bản cũ không in lại vào tờ khác (một biên bản = một lần ký).

## 2. Thiết kế

### 2.1 Dữ liệu (migration `20261101090000_order_packing_handover_sheet`)

| Cột / bảng | Nghĩa |
|---|---|
| `Order.packingDoneAt` | mốc quét "Đã đóng gói". Null = chưa quét (seller không dùng bước này thì luôn null → không đổi gì với họ). KHÔNG đổi `shippingStatus`, KHÔNG gọi sàn. |
| `Order.handoverSheetId` | biên bản đã liệt kê đơn; null = đã gói nhưng chưa bàn giao. Mỗi đơn ở đúng MỘT biên bản. |
| `handover_sheets` (model `HandoverSheet`) | một hãng = một biên bản: `code` BG-yyMMdd-XXXX (4 ký tự cuối id, không đếm tuần tự để hai người lập cùng lúc không đụng số), `carrier`, `carrierLabel` (tên nguyên văn sàn trả), `orderCount`, `orders` JSONB **ảnh chụp** lúc lập để in lại y nguyên, `createdById`. Không khóa ngoại tới Order. RLS bật. |
| Chỉ mục một phần `Order_packing_pending_handover_idx (channelId) WHERE packingDoneAt IS NOT NULL AND handoverSheetId IS NULL` | tập "đã gói chưa bàn giao" nhỏ; route lập biên bản lọc trên tập này. |

Migration đụng bảng `Order` → khối lấy khóa có thử lại như các migration trước (gotcha deadlock Render).

### 2.2 Quyết định lúc quét — `backend/src/lib/packing-scan.ts` (hàm thuần, test 13 ca)

| Trạng thái đơn | Kết quả | Vì sao |
|---|---|---|
| CANCELLED (kể cả đã quét trước đó) | **CHẶN** `CANCELLED` — "ĐƠN ĐÃ HỦY — bỏ kiện lại, không đưa ship" | mục đích chính của bước quét |
| PENDING | CHẶN `NOT_CONFIRMED` | chưa chuẩn bị hàng với sàn, chưa có vận đơn |
| DELIVERED | CHẶN `DELIVERED` | quét nhầm tem cũ |
| đã quét + đã lên biên bản | CHẶN `ON_HANDOVER_SHEET` | kiện đã giao ship |
| đã quét, chưa lên biên bản | **TRÙNG** (không ghi lại, báo giờ quét lần đầu) | hai người cùng gói một chồng |
| PROCESSED / SHIPPING | **GHI** `packingDoneAt` | SHIPPING = shipper quét trước shop — vẫn ghi để lên biên bản |
| + `cancelRequestedAt` | ghi + cảnh báo `CANCEL_REQUESTED` | cảnh báo, không khóa cứng |
| + chưa in phiếu | ghi + cảnh báo `NOT_PRINTED` | gói mà chưa có vận đơn dán ngoài? |

Ghi bằng `updateMany WHERE packingDoneAt IS NULL` → hai máy quét cùng kiện một lúc chỉ một bên ghi.

### 2.3 API — `backend/src/routes/packing.ts`, mount `/api/orders/packing` TRƯỚC `/api/orders` (router đơn có `/:id`), cùng chuỗi gác `requireAuth + requirePermission("orders") + requireChannel`

| Endpoint | Việc |
|---|---|
| `POST /scan {code}` | tra vận đơn / mã đơn (khớp chính xác → khớp lỏng ≥6 ký tự; KHÔNG hỏi sàn khi trượt) → `{result: PACKED\|ALREADY_PACKED\|REJECTED, reason, reasonText, warnings[], warningTexts[], order}`; 404 không thấy, 409 khớp nhiều đơn |
| `POST /unmark {orderId}` | bỏ dấu (quét nhầm) — chỉ khi chưa lên biên bản |
| `POST /handover-sheets {orderIds}` | lập biên bản từ các đơn đã tích: chỉ lấy đơn đã gói, chưa bàn giao, PROCESSED/SHIPPING (đơn hủy bị loại). Mỗi hãng một biên bản. Chống lập trùng: tạo dòng rỗng → `updateMany Order WHERE handoverSheetId IS NULL` → đọc lại đúng đơn mình giành được → ghi ảnh chụp; giành 0 đơn thì xóa dòng. 409 `NO_PACKED_ORDERS` khi không có đơn nào hợp lệ. |
| `GET /handover-sheets/pdf?ids=a,b` | PDF; nhiều biên bản → MỘT file, mỗi tờ trang mới |

Danh sách đơn `GET /api/orders`: `printed=yes` nay là **đã in CHƯA gói**, thêm `printed=packed`; `counts.PROCESSED_PRINTED` theo đó, thêm `counts.PROCESSED_PACKED`. Seller không quét thì số "Đã in" không đổi. Mobile sau này gọi đúng 3 endpoint trên + `printed=packed`, không cần API mới.

### 2.4 PDF — `backend/src/services/fulfillment/handover-sheet-pdf.ts`

A4 dọc, pdf-lib + Roboto (có dấu) + Code 128 dùng chung với phiếu xuất hàng (`drawBarcode`, `loadFonts` export từ `pick-list-pdf.ts`). Đầu tờ: số biên bản, hãng, bên giao (tên tài khoản chủ shop), lập lúc + người lập, số kiện. Bảng: STT · **mã vạch mã vận đơn** (thiếu vận đơn → mã đơn + ghi chú đỏ) · mã đơn + sàn·gian (+ nhãn HỎA TỐC) · người nhận + SĐT che 3 số giữa · ô Ký nhận/Ghi chú. Cuối: tổng kiện + hai ô ký BÊN GIAO / BÊN NHẬN. ~17 dòng/trang, trang cuối chừa chỗ ký.

### 2.5 Web

- `components/shared/scan-code-box.tsx` — ô quét dùng chung tách từ ô quét hàng hoàn (máy quét = bàn phím + camera html5-qrcode nạp động); `keepCameraOpen` cho màn đóng gói (camera không tắt sau mỗi kiện, chặn bắn lặp cùng mã trong 2 s). `scan-return-box.tsx` thành vỏ mỏng, hành vi cũ giữ nguyên.
- `/orders/packing` (`components/orders/packing/packing-page.tsx`): CHỈ ô quét + khung kết quả to + tiếng bíp (`lib/beep.ts`: 1 cao = ghi, 1 giữa = trùng, 2 trầm = chặn) + danh sách lượt quét gần đây có "Bỏ dấu". Bản đầu có bảng chờ bàn giao, 3 thẻ số, tab biên bản, nút in — **anh chốt bỏ** ("đang làm phức tạp vấn đề").
- Trang Đơn hàng: chip **Đã đóng gói** + nút sang trang quét; thanh hàng loạt thêm **Tạo biên bản bàn giao (N)** (`bulk-action-bar.tsx`) → hộp `handover-sheets-dialog.tsx` (Mở / Tải về từng hãng, Mở tất cả); ô Trạng thái: "Đã đóng gói" / "Đã bàn giao" (bấm mở PDF) / "Đã gói — lấy kiện ra" (đơn hủy sau khi gói). Deep-link `/orders?tab=processed`.

## 3. Đã kiểm local 01/11 (demo@hubsell.tech, 3010 ↔ 4010)

Quét: ghi (xanh) → quét lại (vàng "KIỆN NÀY ĐÃ QUÉT RỒI · đã quét lúc …") → đơn hủy (đỏ "KHÔNG ĐƯA SHIP") → đơn Chờ xử lý (chặn) → mã lạ (404 câu rõ) → mã đơn thay vận đơn (khớp). Chip Đã đóng gói → chọn tất cả 8 đơn → nút "Tạo biên bản bàn giao (2)" (6 đơn đã bàn giao trước bị bỏ qua, hộp nói rõ) → biên bản SPX ×2 `BG-261101-3B82`; API tạo 2 hãng → 2 tờ trong một PDF (SPX ×3, Ninja Van ×2) đúng cột, mã vạch, dấu tiếng Việt, ô ký; DB mỗi đơn đúng một biên bản. Dark + 1280 px OK. tsc BE + FE, eslint sạch; test `packing-scan.test.ts` 13/13. Chưa thử máy quét / camera thật; nút Mở PDF (window.open) chưa kiểm được trong Browser pane vì pane chặn tab mới — Tải về là đường chắc.

## 4. Hạn chế / để sau

- Đơn hủy trên sàn chỉ bị chặn khi Hubsell **đã biết** (webhook / lượt quét định kỳ, trễ tới ~30'); màn quét không hỏi sàn từng kiện. Đơn hủy SAU khi gói lộ ra bằng nhãn đỏ "Đã gói — lấy kiện ra" và không vào biên bản.
- App mobile: chưa nối — gọi `/scan` là đủ cho màn quét; tạo biên bản làm trên web.
- Không có nút đánh dấu đóng gói hàng loạt (không quét) — cố ý.
- Biên bản không có cột COD (sàn thu hộ, không phải shipper thu cho shop).
- Nếu khách in biên bản sớm rồi quét thêm: hai tờ cùng hãng, ship ký cả hai; có thể thêm "in gộp nhiều biên bản" nếu có ca thật.

## 5. Chờ đóng gói + Thống kê bốc hàng (04/11/2026)

**Anh yêu cầu:** đổi chip "Đã in phiếu" thành "Chờ đóng gói"; thêm nút Thống kê cạnh "Quét đóng gói", mở popup cộng số lượng theo sản phẩm, SKU để bốc hàng.

**Đổi tên:** chip và nhãn dòng đơn đang ở Đã xử lý. Đơn đã qua Đang giao / Đã giao vẫn ghi "Đã in phiếu", vì việc gói đã qua. Lọc vẫn `printed=yes`, đếm vẫn `PROCESSED_PRINTED`; không đổi API.

**Thống kê:** `GET /api/orders/pick-summary`, dùng chung `ordersWhere` với danh sách nên số luôn khớp bảng đang xem.

| Quyết định | Vì sao |
|---|---|
| Theo bộ lọc đang xem, không cố định trạng thái | Kho bấm Thống kê ở chip nào thì tính cho chip đó; đầu popup ghi rõ tên chip + số đơn |
| Route mới, không sửa `/api/orders/stats` | `/stats` của mobile cố định Chờ xử lý, top 50, trần 20.000 dòng; mobile đang dùng nên giữ nguyên |
| Không cắt danh sách | Thiếu một dòng là kho thiếu hàng mà không biết |
| Gom bằng `groupBy` trên `OrderItem` | Số dòng về RAM = số cặp SKU + tên, không theo số đơn; hai lượt: tổng và phần hỏa tốc |
| Cùng SKU ở nhiều gian cộng làm một dòng | Khách đặt SKU giống nhau cho cùng món hàng thật |
| Dòng không SKU tách theo tên | Tránh dồn nhiều mặt hàng vào một dòng "không có SKU" như `/stats` |
| Hỏa tốc lên đầu | Kho nhặt trước, cùng luật với mobile |
| Ảnh lấy từ dòng đơn, thiếu mới tra danh mục sàn | Đỡ một lượt truy vấn khi dòng đơn đã có ảnh |
| Không có cột số đơn từng dòng | Bốc hàng chỉ cần số lượng; `groupBy` không đếm được đơn phân biệt, thà bỏ còn hơn hiện số gần đúng |

**Anh chốt 04/11:** chip **Đã đóng gói** không hiện nút Thống kê và nút Quét đóng gói, vì hàng đã gói xong; việc còn lại ở chip này là tích đơn → Tạo biên bản bàn giao trên thanh hàng loạt. Ba chip còn lại vẫn có hai nút.

**Anh chốt lại 05/11:** hai nút **chỉ hiện ở chip Chờ đóng gói**; chip Tất cả đã xử lý và Chưa in phiếu cũng bỏ ("không có nhiều ý nghĩa" — bốc hàng và quét kiện là việc của nhóm đơn đã in phiếu, chưa gói). `orders/page.tsx`: `printedFilter === "yes"`. Hệ quả: popup Thống kê nay luôn tính cho nhóm Chờ đóng gói (vẫn theo sàn / hãng / loại đơn / từ khóa đang lọc); trang `/orders/packing` chỉ còn một cửa vào là nút ở chip này (không có mục sidebar).

Popup (`components/orders/pick-summary-dialog.tsx`): tab Theo SKU / Theo sản phẩm, sắp xếp ở tiêu đề Mã SKU + Số lượng, nút sao chép mã. Sản phẩm nhiều SKU hiện "N SKU". Điện thoại: mã SKU xuống dưới tên để cột Số lượng luôn thấy. Hộp chỉ gắn lúc mở nên mỗi lần mở đều tính lại và về thứ tự hỏa tốc trước. Web chưa có bảng theo đơn vị vận chuyển như mobile.

**Xuất thống kê để in (anh chốt 04/11):** nút trong popup, luôn theo SKU, 3 cột Mã SKU · Tên sản phẩm · Số lượng, giữ thứ tự seller đang xếp.

| Quyết định | Vì sao |
|---|---|
| In ngay trên trình duyệt từ số liệu popup đã tải (`lib/print-pick-summary.ts`), không dựng PDF ở backend | Bản thử pdf-lib ở backend: 5.000 SKU mất 49 giây + 268 MB RAM máy chủ web; trình duyệt dựng cùng cỡ 3,8 giây. Không tốn thêm lượt gọi API |
| Khung ẩn `iframe srcdoc` + `print()`, `sandbox="allow-same-origin allow-modals"` | In đúng tờ bảng, không in trang app; không script nào trong khung chạy được |
| Tên và mã SKU escape HTML | Dữ liệu do seller đặt trên sàn, đã thử tên chứa `<script>` / `<img onerror>` → hiện thành chữ thường |
| Dòng phạm vi in đầu tờ: chip + gian/sàn + hãng + loại đơn + khách xin hủy + từ khóa | Tờ giấy không có thanh lọc, kho đọc là biết của nhóm đơn nào |
| Tiêu đề cột lặp mỗi trang, dòng không tách qua hai trang, tổng cộng cuối bảng, số trang x/y | Bảng dài nhiều trang vẫn đọc được từng tờ rời |
| Không có nút Tải về riêng | Hộp thoại in của trình duyệt đã có Lưu thành PDF |

Chưa thử Firefox/Safari và máy in thật.

Tệp mục này: `backend/src/lib/pick-summary.ts` (+ test 9 ca), `backend/src/routes/orders.ts`, `frontend/src/components/orders/pick-summary-dialog.tsx`, `frontend/src/lib/print-pick-summary.ts`, `frontend/src/app/orders/page.tsx`, `frontend/src/lib/api.ts`, `frontend/src/lib/query-keys.ts`.

Tệp: `backend/prisma/migrations/20261101090000_order_packing_handover_sheet/`, `backend/src/lib/packing-scan.ts` (+ test), `backend/src/routes/packing.ts`, `backend/src/services/fulfillment/handover-sheet-pdf.ts`, `backend/src/routes/orders.ts` (lọc + đếm), `backend/src/app.ts`; `frontend/src/lib/api.ts`, `lib/beep.ts`, `components/shared/scan-code-box.tsx`, `components/orders/scan-return-box.tsx`, `components/orders/packing/packing-page.tsx`, `components/orders/bulk-action-bar.tsx`, `components/orders/handover-sheets-dialog.tsx`, `app/orders/packing/page.tsx`, `app/orders/page.tsx`, `components/shell/app-shell.tsx`.

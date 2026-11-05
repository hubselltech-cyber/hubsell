# Quản lý Kho — tái cấu trúc để dễ dùng (bắt đầu 05/11/2026)

> Anh Trung 05/11/2026: "Đa số khách đang cảm thấy giao diện khó dùng… phần kho sẽ là phần giữ chân doanh nghiệp lớn."
> Tệp này là sổ của đợt nâng cấp: mỗi lát làm gì, cái gì tạm ẩn chờ quyết, và kiến trúc thông tin em đề xuất cho các lát sau.
> Mô hình kho (1 SKU kho ↔ N gian, Có thể bán, đẩy tồn) KHÔNG đổi — xem memory `hubsell-inventory-sync` và [VI-TRI-CHUA-HANG.md](VI-TRI-CHUA-HANG.md).

## 0. Nguyên tắc anh Trung chốt 05/11/2026 (đọc trước mọi lát sau)

> Anh: "Việc nối kho là việc của khách, khách không làm thì khách chịu. Việc của mình là **chuẩn hóa sản phẩm**: khách không quen quản lý SKU
> nên đăng lên sàn thường không có SKU, nên hai đường Tạo sản phẩm và Sao chép từ sàn đều **bắt buộc bổ sung SKU chuẩn**. Đặc biệt là để khách
> bán offline tại cửa hàng, xuất kho ra ngoài vẫn được **trừ tồn lên sàn**."

Hệ quả cho thiết kế:
1. **Tổng kho = hàng của mình, mã SKU chuẩn là tài sản.** Mọi cửa đưa hàng vào kho (Tạo mới, Sao chép từ sàn, Excel, Nối SKU nhanh) phải
   ra SKU đúng mẫu, không trùng; không có đường tắt "để trống mã rồi tính sau".
2. **Nối gian là việc của khách, Hubsell không gánh.** Không dựng khối hướng dẫn / nhắc nhở nặng để ép nối; chỉ cần đường nối rõ ràng ở
   Sản phẩm trên sàn và Tự khớp trùng mã chạy đúng. Em từng đề xuất chip "N SKU chưa nối" + chuông — anh không chọn; đừng đề xuất lại
   trừ khi có số liệu khách kêu.
3. **Bán offline đi qua kho:** phiếu xuất / sửa tồn / bán tại quầy trừ Tổng kho → với SKU đã nối và gian đã bật đồng bộ, số "Có thể bán"
   tự đẩy lên mọi gian (đường `enqueueStockPush` sẵn có). Vì vậy giá trị của SKU chuẩn là ở đây: khách nối một lần, bán ở đâu cũng khớp.
4. Lát kế tiếp phải phục vụ (1) và (3) trước: Nhập – Xuất – Kiểm kê thành mục riêng (bán offline hằng ngày), phiếu nhập NCC + giá vốn
   bình quân; kiểm tra lại các cửa còn cho SKU lỏng (Excel, Nối SKU nhanh với mã máy SPE-/TTK-/LZD-).

## 1. Lát 1 (05/11/2026, ĐÃ LÀM) — tách hub "Hàng hóa" thành hai mục sidebar

Anh chốt: (a) đưa tab "Tổng kho" ra sidebar, đứng ngay trên "Hàng hóa"; (b) đổi tên "Hàng hóa" thành "Sản phẩm trên sàn".

**Cách em làm (và vì sao):**

| Trước (hub 15/08) | Sau 05/11 |
| --- | --- |
| Sidebar: `Quản lý Kho → Hàng hóa` (`/products`), một trang 3 tab: Tổng kho · Sản phẩm trên sàn (đếm chưa nối) · Nhật ký kho | Sidebar: `Quản lý Kho → Tổng kho` (`/products`, tab Tồn kho · Nhật ký kho) rồi `Sản phẩm trên sàn` (`/products/marketplace`, chỉ chủ shop) |
| Khối "Kho trung tâm Hubsell" (dải Shop A/B/C + 3 bước) đầu trang | **Tạm ẩn** (mục 2) |
| Nút "Cài đặt đồng bộ tồn kho" nằm trong đầu khối 3 bước | Nút **"Đồng bộ tồn kho" + viên `bật/tổng gian`** trên thanh công cụ Tổng kho (bắt buộc thêm, nếu không chủ shop mất cửa bật gian) |

- `/products` giữ là Tổng kho vì mọi deep-link cũ (`?search=SKU` từ chuông sắp hết hàng, `?sync=1`) và các trang con `/products/new`, `/receive`, `/stocktake`, `/putaway` đều là việc của kho. Trang mới nhận phần tách ra.
- Chuyển hướng giữ bookmark: `/mappings` và `/products?tab=links` → `/products/marketplace`; `/warehouse/sync` → `/products?sync=1` như cũ.
- "Nối thêm gian cho SKU này" (menu dòng Tổng kho) nay điều hướng sang trang kia kèm `?search=&target=&targetSku=`; trang kia tìm lại SKU qua danh sách theo mã (chưa có `GET /api/products/:id`), không thấy thì vẫn mở với từ khoá.
- Sau khi nối/gỡ ở Sản phẩm trên sàn, trang gọi `invalidateQueries(["products"])` để bảng Tổng kho (đệm 30 s) không hiện chip "Bán trên" cũ.
- Sidebar: mục con sáng đèn theo **href khớp dài nhất** trong nhóm (trước so tiền tố đơn thuần → đứng ở `/products/marketplace` cả hai mục cùng sáng).
- Nhãn đi theo: lá quyền `warehouse.products` "Kho vật lý" → "Tổng kho & Sản phẩm trên sàn" (FE + BE registry); link chuông "Mở Hàng hóa" → "Mở Tổng kho" (`routes/assistant.ts`); breadcrumb các trang con; câu nhắc trong Tạo sản phẩm mới / Sao chép sản phẩm.
- Kiểm local 05/11 (demo@hubsell.tech, 1440 sáng + tối): sidebar đúng hai mục, tiêu đề đúng, hai tab Tồn kho / Nhật ký kho, nút Đồng bộ tồn kho 0/3 mở đúng hộp, trang Sản phẩm trên sàn tự lọc theo từ khoá + dải đích "Đang nối thêm gian cho SKU kho AO-LEN-M", hai redirect về đúng trang. `tsc` FE/BE + eslint sạch.

**Cùng sáng 05/11 — menu "Tạo sản phẩm kho"** (anh: "đổi tên nút, thả xuống có 2 nút"): nút đen cuối thanh công cụ Tổng kho thành Popover hai mục — **Tạo sản phẩm mới** (`/products/new`, soạn từ đầu / chỉ lưu kho) và **Sao chép sản phẩm từ sàn**. Mục sau lúc đầu em trỏ sang trang Sao chép sản phẩm (đăng sang gian khác); **anh sửa: ở Tổng kho là chép thành SKU kho ĐỘC LẬP, chưa nối, nối sau; sàn thiếu SKU đúng thì bắt đặt** → làm thành hộp chọn một sản phẩm trên gian → form Tạo sản phẩm mới đổ sẵn → "Lưu vào Tổng kho" (chi tiết [SAO-CHEP-SAN-PHAM.md mục 34](SAO-CHEP-SAN-PHAM.md)). Chỉ hiện khi có lá quyền `operations.copy-listing`. Nguyên tắc rút ra cho cả đợt: **Tổng kho = hàng của mình, độc lập; Sản phẩm trên sàn = nơi nối.**

**Cùng sáng 05/11 — thanh công cụ Tổng kho 9 món → 4 nút** (anh: "xếp một hàng khó nhìn, màn nhỏ khó thao tác; có cần chuyển bớt xuống dòng dưới không?"). Em phản biện: xuống dòng chỉ chuyển chỗ chật sang hàng bộ lọc; gom theo tần suất thì hơn. Anh chốt. Hàng 1 còn: Tìm kiếm · **Đồng bộ tồn kho** (giữ ngoài vì có viên số) · menu **Nhập – Xuất – Kiểm kê ▾** (Phiếu nhiều mã, Kiểm kê, Cất lên kệ khi bật vị trí, kẻ ngang, Vị trí chứa hàng cho chủ shop) · menu **Excel ▾** (Nhập Excel mở hộp cũ qua prop `open`/`trigger={false}`, Xuất Excel) · **Tạo sản phẩm kho ▾**. Hàng 2 bộ lọc giữ nguyên. Dưới `sm` nhãn menu kho rút thành "Kho". Tên menu trùng mục sidebar dự kiến ở mục 3 — khi tách trang riêng chỉ việc dời đi. Kiểm local 1280 + 1440 sáng/tối: một hàng không gãy ở 1280.

**Chưa đụng (ghi để khỏi quên):**
- Tour "Quản lý kho" ở `/guide` (`lib/guide-tours.ts`, 14 bước, ảnh 25/09) vẫn tả "Hàng hóa" + khối 3 bước đã ẩn → làm lại cùng lúc anh quyết mục 2 (ảnh đã lệch UI từ trước).
- Mobile (`StockPage.tsx`) còn 3 câu "trang Hàng hóa trên web" → sửa chữ khi có đợt OTA kế.
- HQ Gói dịch vụ: nhãn module `products: "Hàng hóa"` (admin/plans) giữ — là tên module, phủ cả hai trang.

## 2. ⏳ Khối "Kho trung tâm Hubsell" (3 bước) — TẠM ẨN, nhắc anh quyết ~19/11/2026

- Anh 05/11: "Tạm thời ẩn hẳn khối hướng dẫn kết nối bên tổng kho, sẽ xóa sau vì không biết có dùng nữa hay không."
- Cờ `SHOW_SETUP_GUIDE = false` đầu `frontend/src/app/products/page.tsx`. Mã khối (`components/products/setup-guide.tsx`, `hub-story-strip.tsx`, hộp `OneClickLinkDialog` trong trang) còn nguyên.
- Ba việc của khối vẫn có cửa: kéo SP về + Tự khớp + tạo SKU = trang Sản phẩm trên sàn; bật đồng bộ = nút Đồng bộ tồn kho trên thanh công cụ. Nguyên tắc "cùng mã SKU" chuyển thành một dòng đèn ở đầu trang Sản phẩm trên sàn.
- Mất đi khi ẩn: bảng số "382 SKU kho · 2.036 SP sàn chưa nối · đồng bộ 0/5 gian" ở đầu trang và tiến độ 3 bước cho seller mới. Dòng trống bảng vẫn chỉ việc kế tiếp theo ngữ cảnh.
- **Ba hướng để anh chốt:** (A) xóa hẳn (bỏ cờ + 2 tệp + state `counts/channels/syncState` chỉ còn nuôi dòng trống; làm lại tour Kho); (B) gói thành "Checklist thiết lập kho" chỉ hiện ở màn chào mừng / `/guide`, trang làm việc sạch; (C) mở lại như cũ. Em nghiêng (B): seller mới vẫn cần 3 bước, seller cũ không cần nhìn mỗi ngày.
- Lịch nhắc: memory `hubsell-quan-ly-kho-nang-cap-2026-11-05` + TODO.md mục Next.

## 4. Phiếu nhập / xuất kho in được (05/11/2026, anh: "doanh nghiệp cần nút in phiếu") — ĐÃ LÀM lát 1, kiểm local

**Hiện trạng trước đó:** Hubsell không lưu "phiếu" — Phiếu nhiều mã khi Ghi chỉ tạo N dòng `InventoryLog` cùng lý do, không số phiếu,
không gom lại được → không in lúc lập, không in lại, kế toán không tra "phiếu số mấy ai lập". Anh gật 2 điểm: số phiếu theo ngày + 4 ký tự
(không đếm 1, 2, 3 liên tục) và nhập/xuất lẻ từng SKU không sinh phiếu.

**Làm theo đúng khuôn Biên bản bàn giao (01/11):**
- **Bảng `stock_vouchers`** (model `StockVoucher`, migration `20261105070000_stock_vouchers`): `code` PN-/PX-yyMMdd-XXXX (4 ký tự cuối id, giờ
  VN — `lib/stock-voucher.ts`), `type` IMPORT|EXPORT (enum sổ kho), `reason`, `locationId/locationName`, `lineCount`, `totalQuantity`,
  `totalCost` (Σ SL × giá vốn mặc định lúc lập), `lines` JSONB **ảnh chụp** `{productId, skuCode, productName, variantName, quantity,
  unitCost, balanceAfter}` để in lại y nguyên, `createdById`. RLS bật. Cột `InventoryLog.voucherId` (NULL = bút toán lẻ) — không chỉ mục,
  không khóa ngoại; migration lấy khóa InventoryLog có thử lại (bảng bị webhook INSERT liên tục).
- **Ghi phiếu cùng giao dịch với sổ** trong `POST /api/inventory/adjust-bulk`: khóa FOR UPDATE đọc thêm tên / phân loại / giá vốn, mỗi
  `applyStockDelta` mang `voucherId`, rồi `stockVoucher.create` trong cùng `$transaction` → sổ ghi được thì phiếu có. Trả thêm
  `voucher {id, code}`. Log `[stock-voucher] PN-… : N mã, M chiếc`.
- **API đọc** `GET /api/inventory/vouchers?type&q&from&to&page&pageSize` (danh sách + tên người lập) và `GET /vouchers/:id` (đủ dòng +
  tên / SĐT / email chủ shop để in). Ai có quyền kho đều xem; `unitCost` / `totalCost` trả `null` cho tài khoản không thấy tài chính.
- **Web:** (1) Phiếu nhiều mã: sau khi Ghi, thay toast bằng **dải kết quả** "Đã ghi phiếu PN-… — N chiếc của M mã" + nút **In phiếu**
  (mở tab mới) + Ẩn; (2) tab **Phiếu kho** ở Tổng kho (`stock-voucher-table.tsx`): chip Tất cả / Phiếu nhập / Phiếu xuất, tìm số phiếu
  hoặc lý do, khoảng ngày, cột Số phiếu · Thời gian · Loại · Lý do · (Vị trí) · Số mã · Số lượng · (Giá trị) · Người lập · In; bấm dòng =
  in; (3) bản in `/print/stock-voucher/[id]` — A4 in trong trình duyệt (không PDF backend, đúng chốt 04/11), tự mở hộp in khi tải xong
  (`?preview=1` = chỉ xem), màu hex cố định nên trắng – đen kể cả khi app ở giao diện tối. Mẫu theo 01-VT / 02-VT (TT200) lược bớt: đơn
  vị + số phiếu + ngày giờ, lý do, người lập, bảng STT · Mã · Tên · Phân loại · ĐVT · SL · Đơn giá · Thành tiền, dòng Cộng, 4 ô ký (Người
  lập · Người giao/nhận · Thủ kho · Kế toán). Nhân viên không thấy tài chính: ẩn 2 cột tiền.
- **Kiểm local 05/11 (demo@hubsell.tech, cổng 4001):** phiếu nhập 2 mã AO-LEN-M + GIAY-SNK-38 → `PN-261105-0799`, 2 chiếc, giá trị
  293.000 (88.000 + 205.000) đúng; dải kết quả + nút In; bản in đúng mẫu (đã nới cột Tên hàng); tab Phiếu kho liệt kê đúng. Đã xóa dữ liệu
  thử. tsc FE/BE, eslint, vitest lib + stock-ledger 346/346 sạch. Migration áp local bằng `prisma db execute` + `migrate resolve`.
- **Chưa làm (lát 2, chờ anh):** "Biên bản kiểm kê" in được (mẫu khác: tồn sổ · tồn đếm · chênh lệch); số tiền bằng chữ trên phiếu;
  cột Số phiếu trong tab Nhật ký kho (dữ liệu `voucherId` đã có, chỉ thiếu hiển thị); phiếu cho nhập/xuất nhanh một SKU (anh chốt
  KHÔNG — bút toán lẻ).
- **Hạ tầng (anh hỏi):** mỗi lần ghi phiếu thêm 1 dòng `stock_vouchers` + cột trên dòng sổ sẵn có; đọc theo (ownerId, createdAt) có chỉ
  mục; không worker, không gọi sàn. Không đáng kể. Các thay đổi kho hôm nay toàn bộ là giao diện + 1 endpoint đọc do người bấm — không
  đổi số lượt gọi nền, không ảnh hưởng HQ Sức khỏe.

## 3. Em đề xuất kiến trúc thông tin Quản lý kho cho doanh nghiệp lớn (CHƯA LÀM — trình anh chốt từng lát)

Nguyên tắc: mỗi mục sidebar = một **việc** seller gọi tên được; trang làm việc chỉ còn bảng + lọc + thao tác; "thiết lập một lần" tách khỏi "làm hằng ngày".

1. **Sidebar `Quản lý Kho`** đề xuất: Tổng kho · Sản phẩm trên sàn · **Nhập – Xuất – Kiểm kê** (hiện là 3 nút nhỏ chìm trong thanh công cụ: Phiếu nhiều mã / Kiểm kê / Cất lên kệ — DN lớn làm việc này mỗi ngày, cần một mục riêng có lịch sử phiếu) · Đối soát đơn hoàn · Đối soát phí ship. Nhật ký kho giữ là tab của Tổng kho (tra cứu, không phải việc).
2. **Phiếu nhập có nhà cung cấp + giá nhập** → giá vốn **bình quân gia quyền** tự cập nhật; đây là gốc của chuỗi sự cố giá vốn 0 / nhập sai giá quà (04–05/11). Lát này đụng tài chính → đo trước/sau như luật `feedback-doi-tai-chinh-phai-mo-phong-quang-cao`.
3. **Đa kho vật lý theo khu vực** (DN có kho Bắc + Nam): cây vị trí hiện gom thành một số Có thể bán toàn shop; Shopee đã có `channelStockLocationId`, TikTok bắt buộc warehouse_id → đẩy tồn **theo kho ↔ kho sàn** là bước tự nhiên kế tiếp. Lớn, cần thiết kế riêng.
4. **Kiểm kê theo phiên** (người đếm ≠ người duyệt, lệch phải có lý do) và **phân quyền kho theo nhân viên/kho** — DN lớn hỏi ngay.
5. **Tồn an toàn động** khi tồn thấp + số shop nhiều (ý tưởng 05/09 chưa làm) — chặn bán vượt lúc sale.
6. **Nhập hàng loạt lớn**: Excel vài chục nghìn dòng chạy nền có tiến độ (cùng khuôn hàng đợi bền), không treo trình duyệt.

Thứ tự em đề xuất: (1) IA sidebar + mục Nhập – Xuất – Kiểm kê → (2) phiếu nhập NCC + giá vốn bình quân → (4) kiểm kê theo phiên + quyền → (3) đa kho. Trước khi làm (1) nên soi log 30 ngày xem khách bấm gì nhiều nhất ở Tổng kho (ít tốn, tránh gom theo cảm tính).

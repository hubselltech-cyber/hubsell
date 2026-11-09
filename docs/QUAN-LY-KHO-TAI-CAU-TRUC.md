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
4. **Sản phẩm kho chỉ tạo / sửa ở Tổng kho** (anh 05/11, sau khi xem trang Sản phẩm trên sàn mới: "việc kiểm soát sản phẩm kho hoàn
   toàn sẽ nằm ở bên Kho tổng"). Trang Sản phẩm trên sàn CHỈ NỐI (nút "Nối kho"), không có nút "Đưa vào kho", không ô "Tạo SKU" —
   docs/SAN-PHAM-TREN-SAN-THIET-KE-LAI.md mục 13. Đừng thêm lại đường tạo SKU kho ở ngoài Tổng kho.
5. Lát kế tiếp phải phục vụ (1) và (3) trước: Nhập – Xuất – Kiểm kê thành mục riêng (bán offline hằng ngày), phiếu nhập NCC + giá vốn
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

## 5. Nhà cung cấp + giá nhập theo sản phẩm (05/11/2026 — ĐÃ LÀM, mục 5.7 là bản đúng; ĐÃ PUSH 11:02, prod OK)

**Diễn biến:** anh hỏi "đúng chuẩn thì Tổng kho có cần nhà cung cấp không" → em: cần, gắn vào PHIẾU NHẬP chứ không gắn cứng vào sản phẩm
(một mã nhập nhiều nguồn, mỗi lần một giá); chia lát A (danh bạ + NCC trên phiếu, không đụng tài chính) và lát B (giá nhập → giá vốn bình
quân TỰ cập nhật). Anh: "chỉ làm lát A", rồi nêu ý: *"gõ một sản phẩm trong nhà cung cấp thì hiện cột sản phẩm, cột NCC 1, NCC 2 … NCC N và
cột Giá trung bình; giá trung bình phục vụ họ nhập giá vốn trong tài chính NẾU HỌ MUỐN. Đây là ý tưởng, vẫn dựa vào em thiết kế hợp lý, giao
diện dễ nhìn, chuyên nghiệp."*

**Hệ quả của ý anh:** phiếu nhập phải ghi **giá nhập từng dòng** (tùy chọn). KHÔNG tự đổi giá vốn — giá trung bình chỉ để tham khảo, khách tự
nhập ở Giá vốn. Vậy phạm vi = lát A + giá nhập trên phiếu + bảng so giá; **không đụng sổ tài chính, không cần mô phỏng quảng cáo.**

### 5.1 Tab "Nhà cung cấp" trong Tổng kho (cạnh Tồn kho · Nhật ký kho · Phiếu kho), hai chế độ
1. **Nhà cung cấp** (danh bạ): tên · SĐT · MST · số phiếu · tổng số lượng · ngày nhập gần nhất; thêm / sửa / ngừng dùng. Bấm một dòng →
   tab Phiếu kho lọc sẵn theo nhà đó (đối chiếu cuối tháng: lọc NCC + khoảng ngày, có dòng cộng, in từng phiếu).
2. **Giá nhập theo sản phẩm** (ý anh): ô tìm tên / mã SKU + chọn khoảng thời gian. Mỗi SKU kho MỘT dòng, 4 cột:
   Sản phẩm · **Giá gần nhất theo nhà cung cấp** (các viên "tên NCC + giá", viên rẻ nhất tô xanh, quá 2–3 viên thì "+N") ·
   **Giá nhập TB** (kèm tổng số lượng · số phiếu, có nút sao chép) · **Giá vốn đang dùng** (kèm "khớp" / "thấp hơn 1.822" / "chưa nhập giá vốn").
   Bấm ▸ xổ ra mỗi nhà cung cấp một dòng: giá gần nhất · ngày nhập · đã nhập (số lượng · số phiếu) · giá TB của riêng nhà đó.

**Vì sao KHÔNG làm đúng "cột NCC 1 … NCC N":** N cột chạy ngang theo số nhà cung cấp (10 nhà = 10 cột, tràn màn 1280), mà mỗi mã thường chỉ
nhập của 1–3 nhà → đa số ô trống. Gom giá các nhà vào MỘT cột viên + xổ chi tiết giữ nguyên thông tin anh cần (so giá cạnh nhau, giá trung
bình) mà bảng luôn 4 cột. Nếu anh vẫn muốn cột riêng từng nhà: chỉ khả thi khi giới hạn ≤ 4 nhà nhập nhiều nhất + cột "Khác".

### 5.2 "Giá nhập TB" tính thế nào
- **Bình quân theo số lượng**: Σ(số lượng × giá nhập) / Σ số lượng, trên các dòng phiếu CÓ giá nhập trong khoảng thời gian đang chọn.
  Không lấy trung bình cộng giá các nhà (nhà nhập 10 cái sẽ kéo lệch nhà nhập 1.000 cái).
- Mặc định khoảng thời gian **90 ngày** — số em TỰ CHỌN (giá nhập trôi theo thời gian, lấy cả đời thì lệch giá hiện tại), chưa có số liệu
  khách; có lựa chọn "Tất cả".
- Gọi là **"Giá nhập trung bình"**, KHÔNG gọi "giá vốn bình quân": đây là trung bình các lần MUA, không tính tồn đầu kỳ như kế toán.
- v1 chỉ hiện + nút sao chép + so với giá vốn đang dùng. Nút "Dùng làm giá vốn" (một bấm, hộp cảnh báo số cũ → mới) để anh quyết sau.

### 5.3 Phiếu nhập
- Thêm ô **Nhà cung cấp** (chọn / gõ tên mới tạo tại chỗ) + **Số chứng từ**, đều không bắt buộc. Phiếu xuất không có.
- Mỗi dòng thêm ô **Giá nhập** (không bắt buộc; điền sẵn giá gần nhất của đúng nhà đó cho mã đó). Dòng không có giá không vào trung bình.
- **Quyền:** giá nhập là số tài chính → chỉ người thấy tài chính mới thấy / nhập (cùng luật cắt `unitCost` của phiếu kho). Thủ kho lập phiếu
  chỉ ghi số lượng; chủ shop **bổ sung / sửa giá nhập, nhà cung cấp, số chứng từ sau** trên phiếu (KHÔNG sửa số lượng), có ghi vết —
  không có đường sửa thì một lần gõ nhầm giá làm sai trung bình mãi.
- Bản in phiếu nhập hiện tên nhà cung cấp + số chứng từ; Nhật ký kho dòng nhập hiện số phiếu + nhà cung cấp.

### 5.4 Dữ liệu + hạ tầng
- Bảng `suppliers` (ownerId, name, phone, taxCode, address, note, isActive) — RLS.
- `stock_vouchers` thêm `supplierId`, `supplierName` (ảnh chụp), `documentNo` (nullable).
- Bảng HẸP `stock_voucher_lines` (ownerId, voucherId, supplierId, productId, quantity, purchasePrice, createdAt; chỉ mục (ownerId, productId)
  và (ownerId, supplierId)) — chỉ ghi cho phiếu NHẬP. Lý do không gom từ `lines` JSONB hay InventoryLog: bảng so giá phải GROUP BY sản phẩm ×
  nhà cung cấp cho cả trang; JSONB không chỉ mục được, InventoryLog là bảng nóng lẫn hàng nghìn dòng trừ đơn mỗi mã.
- Không đụng Order / sổ tài chính / hàng đợi; migration chỉ khóa `stock_vouchers` (bảng nhỏ).

### 5.5 Lát
1. Danh bạ NCC + NCC / số chứng từ trên phiếu nhập + cột & lọc ở Phiếu kho + bản in.
2. Giá nhập trên dòng phiếu + sửa giá sau + bảng "Giá nhập theo sản phẩm".
3. (chờ anh) Nút "Dùng làm giá vốn"; NCC ở Nhật ký kho.

### 5.6 Khảo sát "chỗ khác làm thế nào" (05/11, anh: "thực ra đây là phần thống kê thôi, còn phiếu nhập thì cũng đơn giản") → RÚT GỌN thiết kế

| Nền tảng | Nhà cung cấp trên phiếu | Thống kê |
|---|---|---|
| Sapo | Đơn nhập có NCC + giá nhập | "Báo cáo nhập hàng" 6 góc nhìn: Thời gian · Nhà cung cấp · Sản phẩm · Đơn nhập · Chi nhánh · Nhân viên; lọc ngày, thêm cột, xuất file; góc NCC = số lượng + giá trị nhập |
| MISA | Chứng từ mua hàng có NCC + đơn giá | "Tổng hợp mua hàng theo mặt hàng và nhà cung cấp" — hai chiều nhưng xếp thành DÒNG (Mã hàng · Tên hàng · Mã NCC · Tên NCC · ĐVT · SL mua · Giá trị mua); không có cột đơn giá bình quân, đơn giá chỉ ở sổ chi tiết từng chứng từ |
| Zoho Inventory | Bill / PO có vendor + đơn giá | "Purchases by Item": tên hàng · số lượng mua · thành tiền · **giá trung bình** trong kỳ; "Purchases by Vendor" riêng |
| Odoo | PO có vendor; sản phẩm có danh sách giá theo vendor (mỗi vendor một DÒNG ở tab Purchase) | "Vendor costs report" = pivot nhóm Vendor rồi Product, đo Average Cost, so kỳ trước; bảng vendor đứng cạnh nhau thành cột chỉ có ở module trả tiền bên thứ ba |
| Linnworks / Sage 200 / Pickware | — | Mỗi mã hàng có tab Suppliers: mỗi nhà một DÒNG (giá mua, nhà mặc định) |
| BigSeller | PO có supplier + đơn giá, sửa có ghi vết | Quan hệ "nguồn cung" SKU ↔ supplier, supplier mặc định điền sẵn khi lập PO |
| KiotViet | CHƯA kiểm được (không tìm ra trang hướng dẫn chính thức) | — |

**Kết luận:** (1) anh nói đúng — ở đâu đây cũng là BÁO CÁO đọc từ phiếu nhập, không phải dữ liệu nhập tay riêng; (2) không nền tảng nào
mặc định bày "NCC 1 … NCC N" thành cột — nhà cung cấp luôn là dòng / nhóm dòng (cột chỉ có ở pivot tự kéo hoặc module ngoài); (3) "giá trung
bình" có tiền lệ (Zoho, Odoo), tính trong kỳ đang chọn; (4) phiếu chỉ cần NCC + đơn giá từng dòng.

**Thiết kế rút gọn (thay 5.1–5.5 chỗ nào khác):**
- **Phiếu nhập:** thêm đúng hai thứ — ô Nhà cung cấp (chọn / gõ tên mới) và ô Giá nhập từng dòng, đều không bắt buộc. Bỏ ô Số chứng từ.
  Em vẫn đề nghị giữ MỘT đường "sửa nhà cung cấp / giá nhập" trên phiếu đã lập (không sửa số lượng) vì mình chưa có hủy phiếu — anh quyết.
- **Tab "Nhà cung cấp" = báo cáo nhập hàng**, hai góc nhìn như Sapo: **Theo nhà cung cấp** (tên · SĐT · số phiếu · số lượng · giá trị nhập ·
  lần nhập gần nhất; bấm → Phiếu kho lọc theo nhà đó; thêm / sửa nhà cung cấp ngay tại đây) và **Theo sản phẩm** (ý anh: mỗi SKU một dòng,
  giá các nhà gom viên, Giá nhập TB, Giá vốn đang dùng; xổ ra từng nhà). Chung: lọc khoảng ngày, xuất Excel.
- Dữ liệu giữ nguyên 5.4 (`suppliers`, `stock_voucher_lines`, 2 cột trên phiếu — bỏ `documentNo`). Hai lát: (1) phiếu + danh sách NCC;
  (2) báo cáo hai góc nhìn.

Nguồn (đọc 05/11/2026): sapo.vn/cap-nhat-tinh-nang/bao-cap-nhap-hang · helpact.misa.vn/?p=76333 ·
zoho.com/inventory/help/reports/purchase-reports.html · odoo.com/documentation/17.0 (vendor_costs_report) · help.linnworks.com 7000064721 ·
help.bigseller.pro (Role - Purchasing, 1688 Purchase Order).

### 5.7 ĐÃ LÀM (05/11 ~11:00, anh: "Làm đi") — ĐÃ PUSH 11:02 (6f069f94), prod OK 11:05

**Schema** (migration `20261105110000_suppliers_purchase_lines`, không khóa bảng nóng, RLS bật): bảng `suppliers`; `stock_vouchers` thêm
`supplierId` + `supplierName` + chỉ mục (ownerId, supplierId, createdAt); bảng hẹp **`purchase_lines`** (model `PurchaseLine` — tên khác bản
thiết kế `stock_voucher_lines` để khỏi trùng kiểu `StockVoucherLine` của ảnh chụp JSON): ownerId, voucherId, supplierId, productId, quantity,
purchasePrice, createdAt; ghi cho MỌI phiếu NHẬP (kể cả chưa ghi nhà cung cấp / giá — bổ sung sau được).

**Backend** — `routes/inventory-suppliers.ts` (gắn vào `/api/inventory`, cùng quyền kho):
- `GET /suppliers` (`brief=1` cho ô chọn; mặc định kèm số phiếu · số lượng · giá trị nhập · lần nhập gần nhất trong khoảng ngày + `unassigned`),
  `POST /suppliers`, `PATCH /suppliers/:id` (trùng tên không phân hoa thường → 409; `isActive=false` = ngừng dùng; trần 500 nhà / shop).
- `GET /purchase-stats/products` (CHỈ người thấy tài chính, còn lại 403): trang theo SKU, sắp `recent | quantity | avg`, kèm từng nhà cung cấp
  (giá gần nhất + ngày, số lượng, số phiếu, giá TB). Cột ngày không múi giờ → so bằng chuỗi UTC `::timestamp` (`utcTimestampLiteral`).
- `PATCH /vouchers/:id` — sửa nhà cung cấp / giá nhập trên phiếu NHẬP (không sửa số lượng), chỉ người thấy tài chính; cập nhật ảnh chụp JSON +
  `purchase_lines` + `totalCost`. Phiếu lập trước khi có bảng thì dựng dòng từ ảnh chụp lúc sửa.
- `POST /adjust-bulk`: nhận `supplierId | supplierName` (tên mới tạo tại chỗ) và `items[].purchasePrice` (người không thấy tài chính gửi lên cũng bỏ).
- **Giá trị phiếu** (`sumVoucherCost`): đơn giá = giá nhập của dòng nếu có, không thì giá vốn mặc định lúc lập — MỘT luật cho cột Giá trị ở
  Phiếu kho và bản in (lúc soi thấy hai màn ra hai số: 14.350.000 và 18.440.000).
- Test `lib/__tests__/stock-voucher.test.ts` (9 ca: đọc giá, bình quân theo số lượng 51.822, giá trị phiếu, mốc ngày UTC).

**Web:**
- Phiếu nhiều mã (Nhập hàng): ô **Nhà cung cấp** (`suppliers/supplier-picker.tsx` — gõ là lọc, tên chưa có tự lưu khi ghi phiếu) + cột **Giá
  nhập** (chỉ người thấy tài chính) + tổng "giá trị nhập"; dải kết quả ghi "từ <nhà cung cấp>".
- Tổng kho thêm tab **Nhà cung cấp** (`suppliers/suppliers-tab.tsx`, `?tab=suppliers`), hai góc nhìn:
  **Theo nhà cung cấp** (tên · SĐT/MST/ghi chú · Số phiếu · Số lượng · Giá trị nhập · Lần nhập gần nhất; sắp tại tiêu đề cột; bấm dòng → tab
  Phiếu kho lọc sẵn; thêm / sửa / ngừng dùng) và **Theo sản phẩm** (`purchase-by-product.tsx`). Chung: tìm, `DateRangePicker` chuẩn, Xuất Excel.
- Phiếu kho: cột Nhà cung cấp, viên lọc "Nhà cung cấp: X ✕", tìm cả tên nhà cung cấp, nút bút chì sửa nhà cung cấp / giá nhập
  (`voucher-edit-dialog.tsx`). Bản in: dòng Nhà cung cấp (tên · ĐT · MST · địa chỉ), đơn giá = giá nhập.

**Chỉnh so với thiết kế sau khi anh xem local:**
- Anh khoanh hàng viên giá trên dòng SKU: "khu vực này có cần thiết không, mình đã tô xanh bên dưới rồi … nhường không gian để ghi rõ các phần
  như số lượng". → **Bỏ hàng viên.** Bảng Theo sản phẩm là bảng hai tầng dùng CHUNG một bộ cột có tên cho dòng SKU và dòng từng nhà:
  `Sản phẩm · Nhà cung cấp | Số phiếu | Số lượng | Giá gần nhất (kèm ngày nhập) | Giá nhập TB | Giá vốn đang dùng`. Nhà rẻ nhất: giá xanh +
  nhãn "rẻ nhất" ở dòng con; dòng SKU chỉ ghi "N nhà cung cấp" cạnh mã. Đừng thêm lại hàng viên.
- Mặc định khoảng ngày = **Toàn bộ thời gian** (không phải 90 ngày như 5.2): bộ chọn ngày chuẩn không có nút 90 ngày, tự chế thì trái luật bảng.
- CHƯA điền sẵn giá gần nhất của nhà đó vào phiếu nhập (để phiếu đơn giản); chưa có nút "Dùng làm giá vốn"; Nhật ký kho chưa hiện nhà cung cấp.

**Kiểm local (demo, cổng 4001):** 8 phiếu thử, 6 nhà cung cấp (tên dài 60 ký tự), một SKU 7 nguồn; giá TB 51.822 khớp tính tay; lập phiếu thật
trên UI (gõ mã → giá → chọn nhà → Nhập kho), sửa giá trong hộp sửa (giá trị phiếu 18.440.000 → 18.540.000, báo cáo đổi theo), bản in, hộp thêm
nhà cung cấp, trùng tên 409, ngừng dùng thì biến khỏi ô chọn; 1280 + 1440 sáng + tối không tràn; tsc FE/BE + eslint + 586 test sạch; không lớp
`dark:`. **Chưa kiểm:** tệp Excel tải về (khung trình duyệt thử không tải được tệp), tài khoản nhân viên không thấy tài chính trên UI (đã chặn ở
API), dữ liệu nghìn SKU. Dữ liệu thử trên demo ĐÃ DỌN trước khi push (trả tồn 5 SKU, xóa 8 phiếu / 13 dòng / 7 nhà cung cấp thử), env local đã trả https.

**Prod 05/11 11:05 (shop công ty, chỉ xem, KHÔNG ghi gì):** Render `/health` = `6f069f94`, migration `20261105110000_suppliers_purchase_lines` đã
chạy (tab Nhà cung cấp đọc được `suppliers` + `purchase_lines`, đang trống đúng câu); Vercel lên; Phiếu kho có cột Nhà cung cấp; trang Phiếu
nhiều mã có ô Nhà cung cấp; không tràn ngang ở 1920. **Chưa kiểm trên prod:** lập phiếu nhập thật có nhà cung cấp + giá (anh / khách lập lần
đầu thì soi log `[stock-voucher]`), hộp sửa phiếu, tệp Excel tải về, tài khoản nhân viên không thấy tài chính.

## 6. Tổng kho — bỏ dòng bung "sơ đồ kho ↔ gian", chip "Bán trên" mở hộp nhỏ (05/11/2026 chiều → tối; ĐÃ COMMIT + PUSH 05/11 đêm, anh: "dọn dẹp trước cho sạch sẽ đi rồi commit và push cả 2")

> Mục 6–6.4 ghi theo từng bước trong ngày; bản cuối cùng lên prod là: cột "Bán trên" chỉ xem (6 + 6.3A), không mã sàn trong bảng (6.1), mã vạch quản lý 13 số (6.3B), in tem (6.4). Các câu "CHƯA commit" bên dưới là trạng thái lúc ghi.

**Anh Trung:** "mình có cần giữ phần liên kết gian hàng không khi mà thao tác này vốn phải được thực hiện từ phía sản phẩm của gian hàng đó?" → em soi mã: mọi thứ trong dòng bung đã có chỗ khác, anh bấm "Dựng thử local".

| Thứ trong dòng bung cũ | Nay ở đâu |
|---|---|
| Tồn từng gian + khớp / lệch / chưa bật | Hộp nhỏ khi bấm chip "Bán trên" (dữ liệu `channelLinks` có sẵn trên dòng, không gọi thêm API) |
| Cảnh báo lệch tồn | `SyncAlertBanner` trên bảng (không đổi) |
| "Bật gian này" | Nút "Đồng bộ tồn kho" trên thanh công cụ (cùng một hộp) |
| "gỡ nối", "Nối thêm gian cho SKU này" | Trang Sản phẩm trên sàn; hộp nhỏ có một dòng "Nối thêm / gỡ nối gian" (chỉ chủ shop) dẫn sang kèm `?search=&target=&targetSku=` |
| Thẻ "Tổng kho N có thể bán" | Bỏ (lặp số của dòng); hộp nhỏ ghi một câu "Kho có thể bán N" |
| Câu "Gian nào bán 1 chiếc…" | `title` của tiêu đề cột "Bán trên" |

**Mã:** `components/products/channel-links-popover.tsx` (mới — chip + hộp nhỏ); `app/products/page.tsx` gỡ `expandedId`, `linkDetails`, `toggleExpand`, effect tải chi tiết, `handleUnlinkOne`, `renderHubDiagram`, `renderExpanded` (−300 dòng). `fetchProductChannelLinks` + kiểu `ProductChannelLink` trong `lib/api.ts` và route backend `GET /products/:id/channel-links` ĐÃ GỠ lúc dọn trước khi push (web và mobile đều không còn gọi).

**Sửa kèm (lộ ra khi đo ca rộng):** cột "Bán trên" ở 1280 chỉ 110px, đệm mặc định 16px còn 78px chữ trong khi chip có biểu tượng trạng thái cần 87–97px (trước đây chip lấn vào phần đệm). Nay ô + tiêu đề cột dùng `px-2` (`CHANNELS_CELL_PAD`), chip `px-1.5`, tên sàn tự cắt khi vẫn thiếu chỗ (chỉ gặp từ ×10 gian cùng sàn ở 1280/1366).

**Kiểm local (demo@hubsell.tech, 3010 ↔ 4010; seed 13 gian thử `cmvt_wide_*` nối vào AO-LEN-M → 15 liên kết: Shopee ×12, Lazada ×2, TikTok ×1; đủ khớp / lệch / chưa bật / sàn chưa trả số / khác mã kho; tên gian 54 ký tự; tồn sàn 1.234.567):** đo JS ở 1280 / 1366 / 1440 / 1700 — 0 ô bảng tràn, hộp nhỏ nằm trọn trong màn, 0 số bị cắt, danh sách cuộn dọc (15 dòng, cao tối đa 256px), chữ 14/12px; giao diện tối ở 1280 đọc rõ (chip, chữ trạng thái, dòng liên kết); bấm dòng cuối sang đúng trang Sản phẩm trên sàn với dải "Đang nối thêm gian cho SKU kho AO-LEN-M". `tsc` FE + eslint 2 tệp sạch, không lớp `dark:`.

**CHƯA kiểm:** tài khoản nhân viên (không có dòng "Nối thêm / gỡ nối gian"); trạng thái "đang đẩy" và "đẩy thất bại" (cần job / cảnh báo thật); cột "Đang ở" bật (bề rộng cột Bán trên là % cố định của bảng nên không đổi, nhưng chưa đo); mobile web.

**Thấy khi làm, CHƯA sửa (chờ anh):**
- Dòng CHA của mẫu nhiều phân loại xếp chip `flex-nowrap` — nối cả 3 sàn thì 3 chip (~210px) rộng hơn ô 110px. Chỉ đọc mã, chưa có dữ liệu local để đo.
- Cột Mã SKU liệt kê MỌI mã phân loại sàn: SKU nối 15 gian thành 15 dòng mã, dòng cao ~330px. Em đề xuất dời mã sàn vào hộp nhỏ (cạnh tên gian) — anh từng yêu cầu mã sàn + nút copy ở đây nên chỉ dời khi anh gật.
- Thứ tự chip đang là Lazada → TikTok → Shopee (công thức sắp xếp cũ, giữ nguyên).
- Dòng "Nối thêm / gỡ nối gian" mở trang kia ở ngăn "Cần nối"; muốn gỡ phải tự sang ngăn "Đã nối".

**Bàn cùng lượt, chưa làm:** gộp cột "Có thể bán" vào "Tồn kho" (chỉ hiện dòng nhỏ khi hai số khác nhau); in tem mã vạch bằng chính mã SKU (đã có `code128.ts`), trường mã vạch riêng để sau — khách dùng Salework gửi ảnh có cột mã vạch tự sinh 2200000001 + nút "In mã vạch"; anh không thích kiểu Salework tách nhập / xuất / vị trí thành tab riêng.

**Dữ liệu thử local:** ĐÃ XÓA trước khi push (gian `cmvt_wide_*`, sản phẩm `TESTMOI-*` / `TESTCHEP-*`, vị trí thử).

### 6.1 Nguyên tắc anh Trung chốt thêm 05/11 chiều — sản phẩm Tổng kho là sản phẩm RIÊNG, mã quản lý = mã SKU kho

**Lời anh:** "Sản phẩm trong tổng kho là sản phẩm riêng, nó dùng để điều khiển các sản phẩm trên các sàn với điều kiện các sàn liên kết vào → nên tất nhiên nó cần có mã quản lý để kho quét hàng. Việc em lấy mã của sàn để áp cho sản phẩm riêng đó có vẻ là chưa hợp lý ở Tổng kho."

**Mô hình (đọc trước khi đụng Tổng kho):**
- Sản phẩm kho đứng độc lập; danh tính của nó là **mã SKU kho** (`Product.skuCode`, không trùng trong một shop) — đây là mã quản lý: kho quét, in tem, tìm kiếm đều theo mã này.
- Sản phẩm sàn (`ChannelProduct`) có mã riêng của sàn (mã sản phẩm / mã phân loại = `externalId`). Nó chỉ dính vào sản phẩm kho qua LIÊN KẾT; sản phẩm kho điều khiển tồn của sản phẩm sàn đã nối.
- Hệ quả giao diện: ở Tổng kho KHÔNG bày mã sàn như thuộc tính của sản phẩm kho. Mã sàn chỉ hiện trong ngữ cảnh "gian nào" (hộp nhỏ Bán trên, trang Sản phẩm trên sàn).

**Rà mã 05/11 (chỗ nào mã sàn dính vào sản phẩm kho):**
| Chỗ | Hiện trạng |
|---|---|
| Bảng Tổng kho — dưới tên sản phẩm (mã sản phẩm sàn), dưới mã SKU (mã phân loại sàn), dòng cha | **Vi phạm → ĐÃ GỠ trên local** (bản 28/09 anh từng yêu cầu; nay anh đổi ý cho riêng Tổng kho) |
| Tìm kiếm Tổng kho (`GET /products?search=`) | Chỉ mã SKU + tên + phân loại — đúng |
| Quét ở Phiếu nhiều mã / Kiểm kê / Cất lên kệ | So trùng mã SKU — đúng |
| Khóa gom cha–con (`groupKey`) | Tính từ tên + phân loại, không dùng mã sàn — đúng |
| Kho trên mobile | Không hiện mã sàn — đúng |
| Bảng Cấu hình Giá vốn | VẪN hiện mã sàn (bảng đó theo từng gian) — không đụng |

**Đã làm trên local (CHƯA commit):** xóa `components/products/marketplace-codes.tsx` (hết nơi dùng) + 3 chỗ gọi; mã sản phẩm / mã phân loại sàn kèm nút sao chép chuyển vào hộp nhỏ, dưới tên từng gian (`channel-links-popover.tsx`). Cột Mã SKU: mã quản lý phải đọc đủ → đệm `px-2` + mã tự xuống dòng thay vì cắt (trước đó ở 1280–1440 cả 5/5 mã demo bị cắt "GIAY-SN…"). `CHANNELS_CELL_PAD` đổi thành bảng `CELL_PAD` theo cột.

**Kiểm local lại (cùng bộ seed 15 liên kết, TikTok mã 19 chữ số):** 1280 / 1366 / 1440 / 1700 — 0 ô tràn, 0 nút sao chép còn trong bảng, mã SKU đủ trong ≤ 2 dòng (1 dòng ở 1700), dòng AO-LEN-M từ ~330px còn 111px; hộp nhỏ 29 mã + 29 nút sao chép, 0 mã bị cắt, mã TikTok tự xuống 2 dòng; tối 1280 đọc rõ. tsc + eslint sạch. Chưa bấm thử nút sao chép trong hộp nhỏ (cùng `CopyIconButton` đang dùng nơi khác).

**Còn mở (chờ anh):**
- Khách không còn tra được sản phẩm kho bằng mã sàn ngay trên bảng Tổng kho — muốn tra theo mã sàn thì sang Sản phẩm trên sàn. (Ô tìm Tổng kho vốn không tìm theo mã sàn.)
- Mã quản lý để QUÉT: hiện quét = gõ / quét đúng mã SKU. Chưa có in tem mã vạch và chưa có trường mã vạch riêng (hàng có sẵn mã nhà sản xuất) — đề xuất: in tem bằng chính mã SKU trước.
- Backend cho ĐỔI mã SKU (`PATCH /products/:id`, giữ id nên liên kết + lịch sử đi theo); tem đã in theo mã cũ sẽ quét không ra — cần quyết khi làm in tem.
- Cột Mã SKU 9% vẫn hẹp; nếu gộp "Có thể bán" vào "Tồn kho" thì dư 7,5% cho cột này.

### 6.2 Mã vạch quản lý cho sản phẩm kho (05/11 chiều — anh yêu cầu, CHƯA LÀM, em mới đề xuất, chờ anh chốt)

**Lời anh** (kèm ảnh sản phẩm vừa tạo trên prod, SKU `TESTMOI-DEN-L`…): "Làm gì có mã quản lý đâu em, nên khách cần sinh ra cái mã vạch quản lý đó." → mã SKU KHÔNG được coi là mã quản lý; em rút lại ý "mã SKU là đủ" ở mục 6.1.

**Vì sao mã vạch riêng là đúng (em đồng ý):** mã số ngắn in vừa tem nhỏ và quét nhanh hơn mã SKU chữ dài; mã SKU đổi được nên tem đã in sẽ hỏng, mã vạch thì cố định; hàng có sẵn mã nhà sản xuất nhập thẳng vào cùng trường.

**Đề xuất của em (chưa được duyệt):**
- Trường `barcode` trên `Product` (mỗi phân loại một mã), không trùng trong một shop. Máy TỰ SINH ở mọi cửa tạo sản phẩm kho (tạo mới, sao chép từ sàn, Excel, tự khớp + tạo SKU); khách sửa tay được khi hàng đã có mã nhà sản xuất. Sản phẩm cũ: điền một lượt theo lô.
- Định dạng: số thuần, sinh từ một dãy số tăng dần của Postgres (không tranh chấp khi nhiều người tạo cùng lúc). Em nghiêng về 13 chữ số bắt đầu bằng 2 kèm số kiểm tra (theo trí nhớ, GS1 dành đầu số 2 cho mã nội bộ — PHẢI kiểm lại nguồn trước khi code); phương án kia là dãy 10 chữ số như Salework.
- Quét: Phiếu nhiều mã, Kiểm kê, Cất lên kệ, kho trên mobile nhận mã vạch HOẶC mã SKU.
- Hiển thị: dòng nhỏ dưới mã SKU ở Tổng kho, kèm nút sao chép.
- In tem: nút "In mã vạch" theo dòng và hàng loạt, số tem theo số lượng.
- Lát: (1) trường + tự sinh + điền sản phẩm cũ + hiển thị + ô quét web; (2) in tem; (3) mobile.
- ⚠️ Lát 1 có migration trên `Product` + sửa `schema.prisma` — lúc ghi mục này cây làm việc đang có thay đổi `schema.prisma` chưa commit của việc khác (lát 3.9 mốc nước danh mục); phải đợi việc đó commit rồi mới thêm.

### 6.3 ĐÃ LÀM TRÊN LOCAL 05/11 tối — nối MỘT CHIỀU + mã vạch quản lý 13 số (CHƯA commit, anh đang xem local)

**Anh chốt:** "Vậy dùng 13 số. Và anh cũng quyết định bỏ luôn phần nối gian này nữa. Việc nối sẽ dành cho sản phẩm trên sàn nối vào Tổng Kho, anh chỉ cần 1 chiều thôi cho khách dễ hình dung và quản lý. Em làm local trước nhé."

**A. Nối một chiều (sàn → Tổng kho) — ⛔ đừng thêm lại chiều ngược**
- Tổng kho: bỏ chip "Nối gian" ở SKU chưa nối (nay chỉ ghi "Chưa nối"), bỏ dòng "Nối thêm / gỡ nối gian" trong hộp nhỏ, bỏ `jumpToLinks` / `linkSeedFor`. Cột "Bán trên" chỉ để XEM — **anh chốt 05/11 tối: "Giữ để xem"** (khách cần biết số tồn đang được đẩy lên gian nào); đừng bỏ cột, đừng thêm lại nút nối vào cột.
- Trang Sản phẩm trên sàn: gỡ luồng ngược — `?target=` / `?targetSku=`, dải "Đang nối thêm gian cho SKU kho X", nút "Nối vào X", và `target` trong ngăn kéo nối (`link-drawer.tsx`). Còn `?search=`.
- Chưa đụng: hộp cũ "Tự khớp + tạo SKU" (`one-click-link-dialog.tsx`, chỉ còn mở từ khối 3 bước đang ẩn); tour Kho `/guide` còn tả nút nối ở Tổng kho.

**B. Mã vạch quản lý — lát 1**
- **DB** (migration `20261105220000_product_barcode`): dãy `product_barcode_seq` + hàm `product_new_barcode()` = "2" + 11 số thứ tự + số kiểm tra EAN-13; cột `"Product"."barcode"` có DEFAULT gọi hàm → MỌI cửa tạo sản phẩm kho tự có mã, không sửa từng nơi; chỉ mục duy nhất MỘT PHẦN `(userId, barcode) WHERE barcode IS NOT NULL` (dựng tức thời); REVOKE hàm khỏi PUBLIC / anon / authenticated; lấy khóa `Product` có thử lại. ADD COLUMN không kèm DEFAULT nên không viết lại bảng — sản phẩm cũ NULL.
- **Điền sản phẩm cũ:** `backend/scripts/backfill-product-barcode.ts` (`status` / `run --batch --pause --max`), duyệt `id > con trỏ`, mỗi lô một UPDATE, chạy lại an toàn; không chạm `costPrice` nên trigger sổ cái không chạy.
- **Backend:** `lib/product-barcode.ts` (số kiểm tra, chuẩn hóa mã gõ tay 4–32 ký tự chữ/số/._-) + test 12 ca; `GET /products` (cả `view=grouped`) và Nhật ký kho tìm thêm theo mã vạch; `PATCH /products/:id` nhận `barcode` — rỗng = sinh mã mới, chặn trùng mã vạch SKU khác và trùng MÃ SKU của SKU khác (409); phiếu kiểm kê trả kèm `barcode`.
- **Web:** cột "Mã SKU / Mã vạch" ở Tổng kho (12% + px-2; có cột Đang ở thì bảng tối thiểu 1.040px để hai cột tiền không hẹp hơn trước); mã SKU dài xuống dòng sau dấu gạch, không cắt; ô "Mã vạch quản lý" trong ⋯ › "Mã vạch, cảnh báo & tồn an toàn"; ô tìm Tổng kho nhận mã vạch; ba ô quét (Phiếu nhiều mã, Kiểm kê, Cất lên kệ) so khớp qua `lib/product-code.ts` — mã vạch HOẶC mã SKU.
- **Quyết định em tự chọn (chưa hỏi anh):** dãy số chung toàn hệ thống (đơn giản, không tranh chấp; đổi lại khách suy được tổng số sản phẩm đã tạo trên Hubsell từ mã của mình — muốn kín thì đổi sang bộ đếm theo shop TRƯỚC khi lên prod); không ép số kiểm tra với mã khách gõ tay; nhân viên cũng sửa được mã vạch (cùng quyền PATCH hiện có).

**Kiểm local (demo, 3010 ↔ 4010):**
- DB: điền 1.517 sản phẩm cũ → 0 sai định dạng, 0 trùng trong shop; tạo sản phẩm không truyền `barcode` → tự có mã hợp lệ; gán trùng → P2002.
- API (gọi thật): đặt mã nhà sản xuất 200; trùng mã vạch 409; trùng mã SKU khác 409; quá ngắn / có dấu 400; tìm theo mã vạch ra đúng SKU (phẳng + theo nhóm); xóa trắng → sinh mã mới; phiếu kiểm kê có `barcode`.
- Giao diện: 1280 / 1366 / 1440 / 1700, CẢ hai ca có và không có cột Đang ở — 0 ô tràn, mã vạch 1 dòng, mã SKU ≤ 2 dòng; tối 1280 đọc rõ; hộp Cài đặt SKU hiện đúng mã; quét mã vạch ở Phiếu nhiều mã → thêm đúng dòng AO-LEN-M (phiếu nháp, không lưu). tsc BE + FE, eslint sạch.
- **CHƯA kiểm:** ô quét Kiểm kê + Cất lên kệ trên giao diện (cùng hàm so khớp, chưa bấm thử); bấm Lưu trong hộp Cài đặt SKU (mới thử qua API); máy quét thật; tài khoản nhân viên; dữ liệu giá 7 chữ số / khoảng giá ở bề rộng cột mới (bề rộng hai cột tiền không đổi so với trước); mobile.

**⏳ TRƯỚC KHI LÊN PROD (chờ anh):**
1. Chốt dãy số chung hay theo shop.
2. Cách điền sản phẩm cũ trên prod: script chạy ở Render Shell của worker (hay bị chặn) hoặc việc chạy một lần lúc khởi động — em chưa chọn.
3. `SELECT product_new_barcode()` chạy bằng vai trò backend trên Supabase sau REVOKE — chưa thử trên Supabase thật.
4. Lát 2: in tem mã vạch (EAN-13 cần bộ vẽ riêng — `code128.ts` hiện có chỉ vẽ Code 128; mã 13 số in bằng Code 128 vẫn quét ra đúng số). Lát 3: kho trên mobile quét mã vạch; cột mã vạch trong Excel nhập / xuất.

**Dữ liệu thử còn trong DB local:** 6 gian `cmvt_wide_*` nối vào AO-LEN-M; sản phẩm `TESTMOI-*` (9 phân loại, chưa nối); GIAY-SNK-38 đã bị đổi mã vạch khi thử (2000000015194). Vị trí thử đã xóa.

### 6.4 In tem mã vạch — ĐÃ LÀM TRÊN LOCAL 05/11 tối (lát 2 của mã vạch; CHƯA commit, CHƯA in / quét thật)

**Anh chốt cùng lượt:**
- Dãy số dùng chung toàn hệ thống: "Mã này nội bộ thì dùng chung chắc cũng chẳng sao" → giữ dãy chung, KHÔNG làm bộ đếm theo shop.
- "Khi sao chép sản phẩm từ sàn vào tổng kho cũng coi như là sinh ra một sản phẩm mới" → phải có mã vạch. Đã chạy thật `POST /api/sao-chep-san-pham/warehouse-only` kèm `origin` (đúng cửa "Sao chép sản phẩm từ sàn"): 2 phân loại `TESTCHEP-M` / `TESTCHEP-L` chép về đều có mã 13 số. Ba cửa tạo trong mã (`listing-copy/manual.ts`, `routes/mappings.ts` create-products, `routes/products.ts` nhập Excel) đều `product.create` không truyền `barcode` → DEFAULT của cột lo. Mới chạy thật cửa thứ nhất; hai cửa kia đọc mã.
- "Phần in mã vạch… làm ngay bên cạnh mã vạch" → nút máy in nằm ngay sau mã vạch trong cột "Mã SKU / Mã vạch".

**Đã làm:**
- `lib/barcode.ts`: vẽ EAN-13 (mã 13 số hợp lệ) và Code 128 bộ B (mã khách tự nhập khác); bảng Code 128 chép nguyên từ `backend/…/fulfillment/code128.ts` bằng script — sửa bảng thì sửa cả hai nơi. `components/products/barcode-svg.tsx` vẽ SVG kèm vùng trắng hai bên.
- `lib/label-print.ts`: 3 khổ tem (em TỰ CHỌN, chưa in thử): cuộn 50×30 mm; cuộn 35×22 mm ×3 tem/hàng (giấy 110 mm); A4 65 tem 38,1×21,2 mm (lề 4,75 / 10,7, khe 2,5). Trần 2.000 tem/lượt (tự chọn). Ngưỡng cảnh báo vạch mảnh 0,25 mm = 2 chấm máy in nhiệt 203 dpi.
- `components/products/print-labels-dialog.tsx`: chọn khổ (nhớ lần trước), số tem từng mã, nút "Mỗi mã 1 tem" / "Theo tồn kho", cảnh báo (không chặn) khi mã quá dài so với khổ tem.
- `app/print/product-labels/page.tsx`: in bằng trình duyệt như phiếu kho — hộp ghi lệnh in vào localStorage, trang in đọc lại, dựng tem theo mm, tự gọi hộp in; `?preview=1` chỉ xem.
- Tổng kho: nút in cạnh mã vạch từng dòng + "In mã vạch (N)" trên thanh hàng loạt. Cột mã 13%, mã vạch cỡ 11px; có cột Đang ở thì bảng tối thiểu 1.040px.

**Kiểm local:**
- Bộ vẽ: EAN-13 giải mã ngược bằng bảng độ rộng gõ độc lập đúng 5/5 mã; Code 128 trùng từng mô-đun với bộ vẽ backend 8/8 chuỗi. Frontend KHÔNG có bộ chạy test → đây là kiểm một lần bằng script tạm, không có test lưu lại.
- Trang in (xem trước, 70 tem gồm tên 90 ký tự, mã tự nhập 24 ký tự, mã nhà sản xuất): 50×30 → 70 trang, tem đúng 50×30 mm; 35×22×3 → 24 trang, trang 109×22 mm; A4 → 2 trang 65 + 5, lề đo được 4,7 / 10,7 mm; 0 tem tràn. Bề rộng mô-đun mã 13 số: 0,416 / 0,283 / 0,311 mm (đều ≥ 0,25).
- Hộp in: mở từ nút cạnh mã vạch và từ thanh hàng loạt; "Theo tồn kho" điền đúng 100; lệnh in ghi đúng; sáng + tối đọc rõ (ô xem trước dùng màu cố định).
- Bảng Tổng kho có nút in: 1280 / 1366 / 1440 / 1700, có + không cột Đang ở — 0 ô tràn, mã vạch 1 dòng. Có cột Đang ở: hai cột tiền 94px (trước 95px), bảng 1.040px nên ở 1366 xuất hiện cuộn ngang 11px (trước không cuộn). tsc + eslint sạch.
- **CHƯA kiểm:** in ra giấy thật trên máy in tem / A4 và QUÉT thử tem in ra (lệch lề, vạch nhòe chỉ lộ khi in thật); hộp in của trình duyệt (trong khung xem thử em chỉ dùng `?preview=1`); tài khoản nhân viên; tem cho mã tự nhập dài (chỉ có cảnh báo).

**⏳ Trước khi lên prod:** anh in thử 3 khổ trên máy thật rồi quét; chọn cách điền mã cho sản phẩm cũ trên prod; thử hàm `product_new_barcode()` trên Supabase sau REVOKE. Còn lại: mobile quét mã vạch, cột mã vạch trong Excel.

**Dữ liệu thử thêm trong DB local:** `TESTCHEP-M` / `TESTCHEP-L` (chép qua cửa Sao chép từ sàn).

### 6.5 Push + kiểm prod (05/11 đêm)

- Commit `7aff59f6` (Tổng kho sản phẩm riêng, nối một chiều, mã vạch, in tem), push cùng commit lát 3.9 `ebbf64b2` theo lời anh ("dọn dẹp trước cho sạch sẽ đi rồi commit và push cả 2"). Render `/health` = `7aff59f6` → migration `20261105220000_product_barcode` đã áp.
- Prod shop công ty (màn 1920, chỉ xem): cột "Mã SKU / Mã vạch" có, không còn nút "Nối gian" / mã sàn trong bảng, chip "Bán trên" mở hộp nhỏ chỉ xem, trang `/print/product-labels` có. Sản phẩm cũ chưa có mã vạch (đúng thiết kế, chờ điền).
- Sửa kèm sau khi đo prod: chip ở dòng CHA tự xuống dòng + đệm px-1.5 (trước tràn 3px ở ô 168px). Mục "Thấy khi làm, CHƯA sửa" ở mục 6 về dòng cha coi như đã xong.
- ⏳ **Chờ anh:** (1) cách điền mã vạch cho sản phẩm cũ trên prod — `npx tsx scripts/backfill-product-barcode.ts run` trên Render Shell của worker, hoặc em thêm việc chạy một lần lúc khởi động với nhịp chậm; (2) in thử 3 khổ tem trên máy thật rồi quét; (3) mobile quét mã vạch + cột mã vạch trong Excel.

### 6.6 Máy tự điền mã vạch cho sản phẩm cũ — nhịp chậm (05/11 đêm, anh chọn "Máy tự điền chậm")

- **Vì sao không điền trong migration / không chạy script tay:** điền là ghi lại mọi dòng `Product` (và các chỉ mục của nó) trong lúc Supabase hụt Disk IO; Render Shell thì hay bị chặn. → worker điền dần, lô nhỏ, có nghỉ.
- **Mã:** `services/product-barcode-backfill.ts` (MỘT bước: duyệt lô theo `id > con trỏ`, một câu UPDATE cho dòng còn NULL, ghi con trỏ) · `workers/product-barcode-backfill.ts` (vòng lặp: bắt đầu sau khi worker lên 3 phút, lô 100 dòng, nghỉ 15 giây ≈ 400 dòng / phút — anh Trung giãn thêm cùng đêm: "phần này cứ làm chậm giãn cách ra cũng được, chỉ cần tức thì cho sản phẩm mới tạo"; bản đầu là 200 dòng / 3 giây; lỗi một bước nghỉ 5 phút rồi thử lại; không qua pg-boss) · bảng mới `maintenance_jobs` (migration `20261105233000_maintenance_jobs`, model `MaintenanceJob`, RLS bật): một dòng / một việc, `cursor` + `processed` + `doneAt`.
- **Hai con số 100 dòng / 15 giây là em TỰ CHỌN** (chưa đo trên prod; 100.000 sản phẩm mất khoảng 4 giờ). Sản phẩm MỚI không chờ worker: có mã ngay lúc tạo nhờ DEFAULT của cột. Chỉnh không cần deploy mã: `PRODUCT_BARCODE_BACKFILL_BATCH`, `PRODUCT_BARCODE_BACKFILL_PAUSE_MS`; tắt hẳn `PRODUCT_BARCODE_BACKFILL_OFF=1` (env của worker).
- **Tính chất:** đi MỘT lượt theo khóa chính là đủ (sản phẩm tạo sau migration luôn có mã nhờ DEFAULT); worker khởi động lại thì đi tiếp từ con trỏ; xong hẳn (`doneAt`) thì các lần khởi động sau chỉ đọc một dòng `maintenance_jobs`, không đụng `Product`. Chạy trùng hai tiến trình vẫn an toàn (UPDATE chỉ đụng dòng `barcode IS NULL`, có khóa dòng). Không chạm `costPrice` → trigger sổ cái không chạy.
- **Theo dõi:** log worker `[barcode-backfill]` (bắt đầu / mỗi 50 bước / XONG); hoặc SQL `SELECT * FROM maintenance_jobs WHERE key = 'product-barcode-backfill'`.
- **Kiểm local:** test `product-barcode-backfill-db.test.ts` (lô 2: 2 + 2 + 1 dòng, dừng giữa chừng đi tiếp, mã khách tự nhập không bị đụng, xong thì gọi lại không ghi); chạy trọn vòng với khóa thật trên DB dev: đặt NULL 1.514 sản phẩm → 8 bước, 136 ms, 0 sai / 0 trùng, 3 mã có sẵn giữ nguyên, `doneAt` có; tsc sạch; vitest `src/lib src/routes src/marketplace src/services src/workers` 98 tệp / 843 qua.
- **CHƯA kiểm:** chạy worker như một tiến trình trên máy (chỉ gọi hàm bước); tốc độ và tải Disk IO thật trên Supabase; hàm `product_new_barcode()` dưới vai trò backend trên Supabase sau REVOKE (nếu bị từ chối quyền thì worker ghi lỗi mỗi 5 phút — và khi đó TẠO SẢN PHẨM MỚI trên prod cũng lỗi, phải kiểm ngay sau deploy).
- `scripts/backfill-product-barcode.ts` ĐÃ XÓA 06/11 lúc dọn (worker là đường duy nhất điền sản phẩm cũ; hai đường cùng làm một việc là thừa).
- **Kết quả prod (05/11 ~23:45, chỉ xem):** push `3fb49c63` (worker, nhịp 200 / 3 giây) rồi `e01e99df` (giãn 100 / 15 giây); Render `/health` = `e01e99df`. Shop công ty: 405 / 418 sản phẩm ĐÃ có mã vạch (điền trong mấy phút bản đầu chạy nhịp nhanh), sản phẩm cũ nhất mang `2000000000015` = số thứ tự 1 → hàm `product_new_barcode()` chạy được dưới vai trò backend trên Supabase sau REVOKE, tức DEFAULT lúc tạo sản phẩm mới cũng chạy. 13 sản phẩm còn lại là các mã tạo gần nhất (id lớn nhất) — tới lượt khi con trỏ đi tới cuối. Bảng Tổng kho prod 1920: 57 nút in cạnh mã vạch trên trang, mã vạch một dòng, 0 ô tràn. CHƯA làm trên prod: tạo sản phẩm mới, bấm in; chưa đọc log worker / biểu đồ Disk IO.

## 7. Đồng bộ tồn theo từng sản phẩm và từng phân loại (06/11/2026 — bố cục anh duyệt, đã nối vào phần đẩy tồn ở mục 7.1; ĐÃ COMMIT + PUSH 06/11, anh: "Dọn dẹp code thừa, đảm bảo mô hình tree chuyên nghiệp, commit và push")

**Anh Trung:** "Nút đồng bộ kho hiện tại là nút tổng → anh coi đây là nút bật tổng cho các sản phẩm đã liên kết. Vậy cần nút bật cho từng sản phẩm và từng phân loại. Và phần này thì anh đang không biết sắp xếp sao cho hợp lý." → em đề xuất, anh bấm "Dựng thử local".

**Hiện trạng trước lượt này (đã đọc mã):** chỉ nối thì kho CHƯA điều khiển tồn sàn; việc đẩy tồn gác theo cờ của GIAN (`Channel.stockSyncEnabled`, mặc định tắt) ở `inventory-push.ts` (lúc xếp việc), `stock-push-worker.ts` (lúc đẩy), `stock-reconcile.ts` (đối soát 6 giờ), `routes/products.ts` (màu chip). Bật gian = ghi đè tồn mọi SKU đã nối.

**Bố cục (ở trang Sản phẩm trên sàn — Tổng kho vẫn chỉ xem):**
| Cấp | Chỗ | Ý nghĩa |
|---|---|---|
| Phân loại | công tắc trên dòng phân loại (xổ dòng sản phẩm), ở cột "Đồng bộ tồn" — ngay SAU cột "Trạng thái" (SKU kho đã nối + có thể bán) | công tắc THẬT: phân loại này có nhận tồn từ kho không |
| Sản phẩm | cột mới "Đồng bộ tồn" trên dòng sản phẩm; bật một phần hiện viên "3/6" | bật / tắt mọi phân loại ĐÃ NỐI của sản phẩm |
| Gian | nút "Đồng bộ tồn theo gian a/b" cạnh ô tìm (a/b = đang bật / đã nối của gian đang lọc) → mở hộp cài đặt + màn so sánh sẵn có | bật / tắt hàng loạt cả gian |
- **Thứ tự cột — anh Trung chốt 06/11: "Kết nối trước - đồng bộ sau thì em phải hoán đổi vị trí 2 cột đó cho nhau"** → Sản phẩm trên sàn · Phân loại · Giá · Tồn sàn · **Trạng thái (kết nối)** · **Đồng bộ tồn** · thao tác. Bản đầu em đặt công tắc trước cột Trạng thái (giữa "tồn sàn" và "SKU kho") — sai trình tự khách làm, đã đổi. Cột Trạng thái rộng 144px; ở dòng phân loại nó ghi mã SKU kho đã nối (đọc đủ, mã dài xuống dòng sau dấu gạch, không biểu tượng) + "có thể bán N" ở dòng dưới. Đo lại 1280 / 1366 / 1440 / 1700 + tối: 0 ô tràn, không cuộn ngang, mã SKU 17 ký tự vừa một dòng.
- Thanh hàng loạt (tick nhiều sản phẩm): thêm "Bật đồng bộ tồn" / "Tắt đồng bộ tồn".
- Bật mà số sàn sẽ đổi → hộp xác nhận liệt kê "sàn 20 → 13" (tối đa 8 dòng), cảnh báo riêng khi có dòng về 0; số sàn đã bằng số kho thì bật thẳng. Tắt thì làm ngay.

**Lưu trữ:** cột mới `ChannelProduct.stockSyncEnabled` cho phép NULL (migration `20261106001000_channel_product_stock_sync_override`): NULL = theo công tắc của gian, true / false = khách đặt riêng; trạng thái thật = `stockSyncEnabled ?? channel.stockSyncEnabled`. Nhờ NULL = theo gian nên KHÔNG phải điền dữ liệu cũ, hành vi hôm nay giữ nguyên. Bật / tắt cả gian (`PUT /inventory/sync-channels/:id`) xóa mọi ghi đè của gian; gỡ nối cũng về NULL. Liên kết mới để NULL → tự theo gian.

**Mã (local):** backend `routes/mappings.ts` (`POST /mappings/stock-sync`, `GET /mappings/stock-sync/summary`, danh sách kèm công tắc gian + "có thể bán" của SKU kho), `routes/inventory.ts`; web `channel-products-page.tsx`, `shared.ts` (`isStockSyncOn`, `stockSyncChanges`), `stock-sync-confirm-dialog.tsx`, `lib/api.ts`.

**(Bản dựng thử đầu chỉ lưu + hiện trạng thái — đã nối thật ở mục 7.1 bên dưới.)**

**Kiểm local (demo, seed 24 dòng sàn `7770…` + SKU kho `WSYNC-*`: áo thun 6 phân loại ở Shopee + Lazada, quần jean tên 130 ký tự 12 phân loại TikTok mã 19 số, tồn 1.234.567):** bật cả sản phẩm → hộp "1 phân loại sẽ đổi số: sàn 30 → 25" → xác nhận → 6/6; tắt một phân loại → 5/6, không hỏi; sản phẩm Lazada → hộp 3 dòng + cảnh báo về 0 → Hủy giữ nguyên; viên số theo gian 5/28 → 7/28. Đo 1280 / 1366 / 1440 / 1700: 0 ô tràn, không cuộn ngang (bảng min-w 880 → 940, vừa khung 943px ở 1280), mọi công tắc thẳng một cột; tối 1440 đọc rõ. tsc BE + FE, eslint sạch. **Chưa kiểm:** nút tổng mở hộp cài đặt theo gian (mới gắn, chưa bấm thử), thanh hàng loạt, backend chưa có test cho hai route mới, sản phẩm từ 50 phân loại.
- Bẫy gặp: đoạn chữ JSX có `&ldquo;` bị cắt khoảng trắng đầu ("3phân loại") → viết `{" "}` + ký tự ngoặc thật.

**Lát tiếp (khi anh chốt bố cục):** (1) nối bốn chỗ gác sang trạng thái theo phân loại + test, bật riêng thì xếp việc đẩy ngay; (2) chip / hộp nhỏ "Bán trên" ở Tổng kho theo phân loại; (3) dời nút "Đồng bộ tồn kho" khỏi thanh công cụ Tổng kho; (4) lịch sử ai bật / tắt.

**Dọn local:** trong `backend/` chạy bản seed ở scratchpad phiên với `--clean` (xóa SKU kho `WSYNC-*` và dòng sàn externalId `7770…`).

### 7.1 NỐI công tắc phân loại vào phần đẩy tồn (06/11/2026, anh: "Ổn, nối tiếp")

**Một nguồn điều kiện** (`integrations/inventory-push.ts`): `stockSyncOn(dòng, gian)` = `dòng.stockSyncEnabled ?? gian.stockSyncEnabled`, và `STOCK_SYNC_ON_WHERE` (điều kiện Prisma tương đương). Mọi chỗ gác dùng chung, đừng viết lại.

| Chỗ gác | Trước | Nay |
|---|---|---|
| Cửa xếp việc `writePushRows` (mọi biến động kho, đối soát, sync tay không force) | lọc gian đang bật | lọc DÒNG đang bật (`STOCK_SYNC_ON_WHERE`); `force` (bật cả gian) vẫn bỏ qua công tắc |
| Worker đẩy `stock-push-worker.ts` | job tự động hủy khi gian tắt | hủy khi dòng đang tắt; dòng bị TẮT RIÊNG thì hủy cả job forced |
| Đối soát 6 giờ `stock-reconcile.ts` | chỉ gian đang bật | VẪN chỉ gian đang bật (xem 7.2); trong gian đó dòng lệch đang TẮT RIÊNG chỉ đếm, không đẩy; câu trên dòng thời gian có ca "đẩy một phần" (`describeReconcile`) |
| Chip Tổng kho `routes/products.ts` | "off" theo gian | "off" theo dòng; `stockMismatch` cũng theo dòng |

**Bật / tắt riêng** (`POST /mappings/stock-sync`): BẬT → xếp việc đẩy ngay cho các SKU kho đó trên đúng các gian đó (không force); TẮT → `dropPendingStockPushJobs` rút MỌI việc đang chờ của các dòng đó, kể cả việc forced của lượt bật cả gian trước đó (tắt riêng là ý chí cụ thể nhất, đến sau thì thắng — worker cũng gác như vậy). Trả `queued` / `dropped`; web báo "đang đẩy tồn kho lên sàn" hoặc "chưa có gì để đẩy".
**Bật / tắt cả gian** giữ nguyên hành vi cũ + xóa mọi ghi đè của gian. **Chưa đặt riêng dòng nào = y như trước** (có test).

**Test:** `stock-push.test.ts` thêm 7 ca (stockSyncOn; gian tắt + bật riêng; gian bật + tắt riêng; không ghi đè = như cũ; force bỏ qua công tắc; rút job đúng dòng, không giật job worker đang cầm; ba câu đối soát). vitest `src/lib src/routes src/marketplace src/services src/workers` + ba tệp test đẩy tồn: 101 tệp / 877 qua; tsc BE + FE, eslint sạch.
**11 tệp test khác của `src/integrations` (sổ cái, quảng cáo, dòng tiền, xóa gian, escrow) đang ĐỎ trên DB dev** — đã chạy lại 4 tệp trên mã đã commit (stash) vẫn đỏ y hệt → có từ trước, phụ thuộc dữ liệu DB dev, không do lượt này; CHƯA tìm nguyên nhân.

**Thử trọn đường trên local** (gắn tạm token giả cho gian Shopee demo; máy chủ local vai web không chạy worker nên không gọi sàn): gian tắt, bật riêng một phân loại → đúng 1 việc đẩy "bật đồng bộ tồn theo phân loại", chip Tổng kho của SKU đó sang "đang đẩy", gian Lazada cùng SKU vẫn "chưa bật"; tắt riêng → việc bị rút, chip về "chưa bật". Bật cả gian → 6 việc forced, 0 ghi đè, 6/6; tắt riêng một dòng → rút 1, còn 5. Đã trả lại token rỗng, xóa việc đẩy + nhật ký thử.
- Bẫy gặp: chạy `vitest stock-queue.test.ts` trên DB dev sẽ NHẶT cả việc đẩy thật đang chờ của DB dev (6 việc thử bị nó xử lý, ghi 6 dòng nhật ký lỗi token) → đừng để việc đẩy thật nằm chờ khi chạy test đẩy tồn.

**CHƯA kiểm:** worker đẩy thật lên sàn với công tắc theo dòng (cửa gác của worker mới đọc mã + qua tsc, không có test tự động vì cần giả lập sàn); đối soát 6 giờ chạy thật; nút tổng theo gian và thanh hàng loạt trên giao diện (chưa bấm); gian thật có token.

**Lên prod cần biết:** migration `20261106001000_channel_product_stock_sync_override` chỉ thêm một cột NULL trên `ChannelProduct` (lấy khóa có thử lại), không điền dữ liệu; không ghi đè nào tồn tại nên ngày đầu hành vi y như cũ. Lát còn lại: lịch sử ai bật / tắt; dời nút "Đồng bộ tồn kho" khỏi thanh công cụ Tổng kho; liên kết MỚI ở gian đang tắt mặc định tắt (theo gian) — đúng ý "nối trước, đồng bộ sau".

### 7.2 Dọn trước khi push + việc còn mở (06/11/2026)

**Dọn:** bỏ trường `overrides` của `GET /mappings/stock-sync/summary` (không nơi nào dùng); xóa `backend/scripts/backfill-product-barcode.ts` (README còn 51 script); docs/README thêm mục 7; DB dev xóa dữ liệu thử `WSYNC-*` / `7770…`.

**Quyết định lúc rà rủi ro — đối soát 6 giờ KHÔNG mở rộng sang gian đang tắt.** Bản nối đầu cho vòng đối soát lấy cả "gian tắt nhưng có phân loại bật riêng". Em rút lại trước khi push vì hai lý do, đều chưa đo được trên prod:
1. Tìm các gian đó = lọc `ChannelProduct.stockSyncEnabled = true` trên cả bảng mỗi 6 giờ, chưa có chỉ mục → quét bảng lớn trong lúc Supabase hụt Disk IO. Dựng chỉ mục một phần thì phải quét bảng một lượt dưới khóa chặn ghi (dự án không dùng CONCURRENTLY vì Prisma bọc migration trong giao dịch).
2. Đối soát một gian là hỏi sàn tồn của MỌI SKU đã nối của gian đó (`refreshLinkedChannelStock`), không riêng dòng đang bật → gian 5.000 SKU chỉ bật 2 dòng vẫn tốn 5.000 SKU hạn mức gọi sàn mỗi 6 giờ.
→ Phân loại bật riêng ở gian đang tắt: được đẩy NGAY lúc bật và mỗi lần kho biến động, nhưng CHƯA có lưới đối soát định kỳ vớt lệch. Ghi rõ trong chú thích `stock-reconcile.ts`.

**⏳ Việc còn mở (theo thứ tự em đề xuất):**
1. Lưới đối soát cho phân loại bật riêng ở gian tắt: đếm dòng `ChannelProduct` trên prod → chỉ mục một phần `("channelId") WHERE "stockSyncEnabled"` + cho `refreshLinkedChannelStock` chỉ hỏi sàn các dòng đang bật.
2. Test cho cửa gác của worker đẩy (cần giả lập sàn) và cho hai route `/mappings/stock-sync*`.
3. Lịch sử ai bật / tắt (ghi vào `mapping_logs`).
4. Dời nút "Đồng bộ tồn kho" khỏi thanh công cụ Tổng kho sang hẳn trang Sản phẩm trên sàn (anh chưa chốt).
5. 11 tệp test `src/integrations` đỏ sẵn trên DB dev (sổ cái, quảng cáo, dòng tiền, xóa gian, escrow) — tìm nguyên nhân.

- **Push + kiểm prod (06/11):** commit `cad2c404`, Render `/health` = `cad2c404` → migration `20261106001000_…` đã áp. Prod shop công ty (màn 1920, CHỈ XEM, không bấm công tắc nào): trang Sản phẩm trên sàn có cột Trạng thái rồi Đồng bộ tồn, nút "Đồng bộ tồn theo gian 0/357", 0 ô tràn, không cuộn ngang; `/mappings/stock-sync/summary` 200 (2 gian, 357 phân loại đã nối, 0 đang bật); danh sách trả `stockSyncEnabled: null` + "có thể bán"; Tổng kho tải được, chip đều "chưa bật" (shop chưa bật gian nào). Chưa làm trên prod: bật / tắt thật, worker đẩy thật.
- **Chuẩn cắt tên sản phẩm (anh xem prod 06/11: "Tên sản phẩm dài quá, rút ngắn ký tự đi em. Mình đã có chuẩn rồi"):** trên màn 1920 cột tên rộng 919px nên tên dài 886px hiện trọn. Chuẩn đã có ở bảng Giá vốn (22/10: "cắt theo bề rộng + tooltip đủ tên", `max-w-[26rem] truncate`) nhưng viết rải rác bằng chữ → gom thành hằng `PRODUCT_NAME_CLAMP` trong `lib/typography.ts`, áp cho tên sản phẩm + tên phân loại ở trang Sản phẩm trên sàn, và thay 4 chỗ viết tay (bảng Giá vốn ×3, Phiếu nhiều mã ×1). Bảng mới có cột tên sản phẩm: dùng hằng này + `title` tên đủ.

## 8. Khách xin "công nợ" trong Tổng kho — khảo sát đối thủ 08/11/2026 (anh: "như vậy không khác gì phần mềm kế toán"; CHƯA LÀM, chờ anh chốt)

**Câu hỏi:** phần mềm quản lý bán hàng / kho khác có làm công nợ không, đặt ở đâu? (Đọc help chính thức bằng WebFetch; ba trang help.nhanh.vn / help.haravan.com / support.kiotviet.vn không tải được nên Haravan CHƯA xác nhận, Nhanh đọc qua bảng giá.)

| Phần mềm | Công nợ NCC (phải trả) | Đặt ở đâu | Công nợ khách (phải thu) |
|---|---|---|---|
| KiotViet | Có | Đối tác/Mua hàng → **Nhà cung cấp → tab "Nợ cần trả NCC"**: từng phiếu nhập, ô "Trả cho NCC" → tạo phiếu chi (Sổ quỹ), nút "Điều chỉnh", chiết khấu NCC | Có, ở hồ sơ Khách hàng |
| Sapo | Có | Help xếp trong **"Sản phẩm và kho hàng" → "Đơn nhập hàng và hoàn trả"**: "Khởi tạo & ghi nhận công nợ NCC", "Thanh toán công nợ đơn nhập hàng"; tổng hợp ở Báo cáo công nợ NCC; 2025 thêm app "Quản lý công nợ" riêng (KH + NCC + ĐVVC) | Có |
| MISA eShop | Có | **Nhập hàng** (ghi nợ / trả ngay, "đã trả bao nhiêu, còn nợ bao nhiêu") + hồ sơ **Nhà cung cấp**; trả hàng mua = giảm trừ công nợ | Có |
| Pancake POS | Có | Menu **Tài chính → Công nợ** (không nằm trong Sản phẩm/Kho); phải trả TỰ SINH khi phiếu nhập kho có NCC chuyển "Đã nhập hàng", phải thu tự sinh khi đơn "Đã gửi hàng" | Có |
| Nhanh.vn | Có | **Gói Kế toán** bán thêm 100k/cửa hàng/tháng: thu chi + công nợ NCC / KH / nhân viên / đối tác trả góp — module riêng | Có |
| Salework | **Không** | Kho vận → NCC chỉ có thông tin + số đơn đặt + hàng nhập; "Công nợ" nằm ở Salework Tài chính và CHỈ là phải thu từ sàn Shopee/Lazada/TikTok/Tiki | Chỉ sàn |
| UPOS | Có | Mục Nhà cung cấp ("lô hàng đã nhập → công nợ cần đối soát"), không trong kho | Có |
| Odoo | Không trong Inventory | Purchase tạo Vendor bill → **Accounting** (Aged Payable); Inventory không có số nợ | Accounting |
| Zoho Inventory | Có | Ngay trong app Inventory: Bills, Payments Made, Vendor Balance report (mục Purchases) | Có (Invoices) |
| Cin7 Core | Có | Suppliers → Supplier Deposits / Bulk Supplier Payments; có module kế toán cơ bản | Có |

**Kết luận rút ra**
1. Không ai gọi đây là "kế toán". Mọi phần mềm bán hàng VN đều có công nợ NCC, nhưng ở dạng **ĐUÔI CỦA PHIẾU NHẬP**: phiếu nhập ghi "đã trả X, còn nợ Y", hồ sơ NCC cộng dồn "còn nợ". Không có định khoản, TK 331, đối trừ chứng từ, tuổi nợ — những thứ đó mới là phần mềm kế toán (MISA SME, Odoo Accounting).
2. Hai trường phái vị trí: gắn vào **Nhập hàng / Nhà cung cấp** (KiotViet, Sapo, MISA eShop, UPOS, Zoho) hoặc tách menu **Tài chính** (Pancake, Nhanh, Salework). Đa số đặt cạnh phiếu nhập.
3. Phần mềm thuần đa sàn (Salework) KHÔNG làm công nợ NCC — nhưng Salework cũng chưa có phiếu nhập có giá nhập theo NCC như Hubsell đã làm 05/11 (mục 5.7).
4. Hubsell đã có 80 % nền: `stock_vouchers.supplierId`, `purchase_lines` giá nhập, tab Nhà cung cấp 2 góc nhìn. Thiếu đúng 2 số trên phiếu nhập (đã trả / còn nợ) + cột "Còn nợ" ở tab Nhà cung cấp + nút "Ghi trả tiền". Phải thu từ sàn đã có sẵn (Dòng tiền, ví sàn, escrow).

**Em đề xuất ranh giới nếu anh gật (chưa làm):** chỉ công nợ **phải trả NCC theo phiếu nhập**, đặt trong tab Nhà cung cấp sẵn có + phiếu nhập; KHÔNG menu "Công nợ" riêng, KHÔNG công nợ khách lẻ / nhân viên / đối tác, KHÔNG định khoản hay tuổi nợ, KHÔNG đụng Dòng tiền (tiền trả NCC đã là chi phí nhập hàng qua giá vốn — cộng thêm là đếm hai lần). Câu cần hỏi khách trước: "công nợ" khách nói là nợ NCC hay nợ khách sỉ lấy hàng? Nếu là khách sỉ offline thì đó là bán hàng/CRM, không phải kho.

### 8.1 ĐÃ LÀM (08/11/2026 đêm, anh: "Làm bản hẹp NCC") — ĐÃ PUSH 08/11, prod OK

**Nguyên tắc giữ đúng ranh giới ở trên:** công nợ = đuôi của TỪNG PHIẾU NHẬP có nhà cung cấp; không menu Công nợ, không công nợ
khách / nhân viên / đối tác, không định khoản, không tuổi nợ, KHÔNG ghi vào Dòng tiền (tiền trả NCC đã nằm trong giá vốn — cộng
thêm là đếm hai lần). Giá trị phiếu dùng CÙNG luật `sumVoucherCost` (giá nhập dòng, không có thì giá vốn lúc lập) — một con số
cho cột Giá trị, bản in và công nợ.

**Dữ liệu** (migration `20261108230000_supplier_payments`, RLS bật, không đụng bảng nóng):
- `stock_vouchers.paidAmount` (Σ đã trả) + `debtAmount` (= totalCost − paidAmount, ≥ 0, ghi sẵn để lọc / cộng). **NULL = không
  theo dõi**: phiếu xuất, phiếu không ghi NCC, phiếu lập trước 08/11, phiếu do người không thấy tài chính lập. Không gán "đã trả
  đủ" oan cho phiếu cũ — chủ shop tự ghi khi cần.
- Bảng `supplier_payments`: mỗi lần trả tiền cho MỘT phiếu một dòng (kể cả trả ngay lúc lập — ghi chú "Trả đủ / Trả một phần khi
  nhập hàng"), có người ghi. Bất biến: `paidAmount` = Σ amount của phiếu.

**Backend** (`lib/stock-voucher.ts` + 12 test mới, `routes/inventory.ts`, `routes/inventory-suppliers.ts`; chỉ `canSeeFinancials`):
- `POST /adjust-bulk` nhận `payment: {mode: full | none | partial, amount?}` — chỉ phiếu NHẬP có NCC; không gửi → không theo dõi.
  `partial` phải 0 < amount < giá trị phiếu.
- `GET /vouchers` thêm `paidAmount`, `debt`, lọc `debt=1`, `debtSummary` (số phiếu + tổng nợ theo NCC đang lọc).
  `GET /vouchers/:id` thêm `payments[]` (mới nhất trước).
- `POST /vouchers/:id/payable` = bắt đầu theo dõi "chưa trả" (ghi nợ toàn bộ) cho phiếu chưa theo dõi.
- `POST /vouchers/:id/payments {amount, paidAt?, note?}` = ghi một lần trả, khóa dòng `FOR UPDATE`, **không cho trả quá số còn
  nợ** (400 nêu số còn nợ). `DELETE /vouchers/:id/payments/:pid` = xóa lần ghi nhầm, đã trả tính lại = Σ còn lại.
- `PATCH /vouchers/:id` (sửa giá nhập) tính lại `debtAmount` theo giá trị mới (còn nợ kẹp về 0, không âm); bỏ NCC khi phiếu đã có
  lần trả → 400 "xóa các lần trả trước".
- `GET /suppliers` thêm `debt` + `debtVoucherCount` từng nhà (groupBy `debtAmount > 0`, **không theo khoảng ngày** — nợ là số dư)
  và `totalDebt`.

**Web:**
- Phiếu nhiều mã: khối **"Thanh toán nhà cung cấp"** (Segmented Đã trả đủ · Chưa trả · Trả một phần + ô tiền) chỉ hiện khi đã
  chọn NCC và có giá nhập (giá trị > 0); mặc định **Đã trả đủ** (như KiotViet / Sapo — ghi nợ là việc chủ động). Dải kết quả
  ghi "Còn nợ nhà cung cấp X đ — ghi trả tiền sau ở Tổng kho › Phiếu kho".
- Phiếu kho: cột **Thanh toán** (chip "Đã trả đủ" xanh / "Còn nợ X" vàng / "Chưa ghi" / "—"), chip lọc **"Còn nợ NCC · n"** có số
  đếm, nút **Ghi trả tiền** (icon bàn tay tiền, vàng khi còn nợ) mở `suppliers/supplier-payment-dialog.tsx`: ba ô Giá trị · Đã trả ·
  Còn nợ, ô tiền (điền sẵn số còn nợ) + ngày + ghi chú, lịch sử các lần trả (xóa 2 bước), nút "Ghi nợ toàn bộ" cho phiếu chưa theo dõi.
- Tab Nhà cung cấp: cột **Còn nợ** (vàng, tooltip số phiếu), sắp xếp được; chip **"Còn nợ · n"** + dòng "Tổng còn nợ nhà cung
  cấp"; Excel thêm cột Còn nợ. Bấm dòng NCC vẫn sang Phiếu kho lọc theo nhà đó → ghi trả tiền ở đó.
- Bản in phiếu nhập: dòng "Đã thanh toán: X · Còn nợ nhà cung cấp: Y" hoặc "Đã thanh toán đủ" (chỉ phiếu đang theo dõi).

**Kiểm local (DB dev, tài khoản reviewer@hubsell.vn "Hubsell Demo Store", backend-http :4010, web :3000 tạm trỏ http):**
- Seed qua API thật: 6 NCC (một tên 60 ký tự), 7 phiếu nhập (trả đủ 8 chữ số, chưa trả 26.650.000, trả một phần 10/24,8tr, không
  gửi payment → "Chưa ghi", không NCC → "—"); 2 lần trả + xóa 1 lần trên API; lỗi mong đợi đúng: partial ≥ tổng (400), trả quá
  số nợ (400 "chỉ còn nợ 18.650.000"), phiếu không NCC (400). Tổng nợ 45.050.000 = 21,65 + 7,92 + 14,8 + 0,68 khớp tính tay.
- UI: ghi trả 1.650.000 qua hộp → toast + ba ô đổi (6.650.000 / 20.000.000) + lịch sử 2 dòng; xóa lần trả → về 21.650.000; chip
  lọc Còn nợ 4/6 nhà; bản in có dòng Đã thanh toán / Còn nợ. Đo JS ô tràn: tab Nhà cung cấp **0** ở 1280 / 1440 / 1700; Phiếu kho
  cuộn ngang trong hộp (bảng 1.598 px, đã rộng sẵn từ trước — cột mới +144), ô tiền không tràn; dark soi bảng + hộp OK (không lớp `dark:`).
- tsc backend + frontend sạch, eslint 7 tệp sạch, vitest `stock-voucher` 18/18.
- **Chưa kiểm:** tệp Excel tải về; tài khoản nhân viên không thấy tài chính trên UI (API đã chặn 403); mobile (không đụng).
- Lập phiếu thật trên UI Phiếu nhiều mã với "Trả một phần" 1.000.000 / 2.300.000 → PN-261108-81CE, dải kết quả "Còn nợ nhà cung cấp 1.300.000 đ", DB đúng (paid 1tr, debt 1,3tr, 1 dòng supplier_payments "Trả một phần khi nhập hàng").
- **Đã dọn (anh: "Dọn seed, commit, push"):** xóa 8 phiếu / 11 dòng nhập / 5 lần trả / 6 NCC / 11 dòng nhật ký, trả tồn 10 SKU về đúng số gốc (kiểm lại từng mã); `frontend/.env.local` đã trả về https:4000.

**Anh chốt 08/11 khuya (sau khi lập phiếu thật PN-261108-2EC8 trên prod, trả 100.000 / 180.000):**
- Bản in phiếu GIỮ cột Mã SKU, KHÔNG in mã vạch 13 số, không in cả hai (mã vạch là mã nội bộ cho tem / máy quét; NCC và kế toán chỉ biết SKU; A4 không dư chỗ). Đừng đề xuất lại.
- KHÔNG chặn hộp Ghi trả tiền với phiếu chưa ghi giá nhập ("chắc không cần"): công nợ phiếu không có giá nhập tính trên giá vốn mặc định theo đúng luật một con số; khách muốn chuẩn thì gõ giá nhập.


## 9. Kiểm kê bằng máy quét — quét liên tục, con trỏ ở lại ô quét (09/11/2026; ĐÃ PUSH `8315c2f3` + `dbb672c9`, prod OK — xem 10.4)

Khách nguyenvanmanh1120@gmail.com thử Kiểm kê bằng máy quét thật (ca đầu tiên có máy quét thật — mục 6.3 ghi "CHƯA kiểm: máy quét thật") và báo: quét xong ô đếm nhảy số lạ, quét lần 2 không cộng mà ra số cam nghìn tỷ, quét mã khác thì số rơi vào dòng dưới; mỗi lần quét phải chỏ chuột lại ô quét. Khách muốn: đặt con trỏ MỘT lần, quét mã nào số mã đó nhảy.

**Gốc lỗi** (`frontend/src/app/products/stocktake/page.tsx`): sau mỗi lần quét trúng, mã cũ chuyển con trỏ sang ô "Thực đếm" của dòng đó. Máy quét là bàn phím — lần quét kế gõ nguyên 13 số mã vạch vào ô đếm (số tồn nghìn tỷ, cột Lệch màu cam), rồi phím Enter của máy quét đẩy con trỏ xuống ô đếm dòng dưới; lần quét thứ ba gõ tiếp vào dòng dưới. Hai trang quét kia (Phiếu nhiều mã, Cất lên kệ) vốn giữ con trỏ ở ô quét nên không dính.

**Đã sửa — ba lớp chặn:**
1. Quét xong con trỏ Ở LẠI ô quét; ô quét xóa ngay (trước khi tra máy chủ) để lần quét kế không nối vào mã cũ. Dòng vừa quét được cuộn vào giữa khung bảng (chỉ cuộn khung bảng, không cuộn trang) + tô nền `bg-sky-100`; dưới ô quét có dòng "Vừa quét: MÃ · đã đếm N". Mở trang là con trỏ vào sẵn ô quét (chỉ máy có chuột).
2. Con trỏ không nằm trong ô nhập nào (vừa bấm chip lọc, nút Chốt, chỗ trống) mà có phím gõ → tự về ô quét trước khi ký tự được nhập. Thiếu lớp này, Enter của máy quét sẽ "bấm" cái nút đang giữ con trỏ (kể cả nút Chốt kiểm kê).
3. Con trỏ đang ở một ô "Thực đếm" mà Enter một dãy ≥ 8 chữ số → coi là mã quét: trả ô đó về số trước khi con trỏ vào, cộng 1 cho đúng mã, con trỏ về ô quét.

**Ngưỡng 8 chữ số / trần 9.999.999** (mặc định em chọn, có căn cứ): mã vạch bán lẻ ngắn nhất là EAN-8 = 8 chữ số, mã vạch quản lý Hubsell 13 số; một mã kho không tồn ≥ 10 triệu cái. Số đếm > 9.999.999 tính là "ô sai số" (viền đỏ, khóa nút Chốt) — để bản nháp rác khách đang có không chốt nhầm; quét lại mã đó thì ô rác đếm lại từ 1. Backend `POST /inventory/stocktake` từ chối `counted > 9.999.999` (trước đây không có trần; số 13 chữ số sẽ tràn cột int và trả 500).

**Sửa kèm (lỗi có sẵn, lộ ra khi thử):** bản nháp "số đang đếm dở" bị mất mỗi lần tải lại trang — hiệu ứng lưu nháp chạy ngay lúc mở trang với bảng đếm rỗng, ghi đè bản nháp trước khi kịp đọc. Nay chỉ lưu sau khi phiếu của đúng vị trí đã nạp xong nháp cũ (`hydratedKey`). Kèm: cộng dồn dùng cập nhật hàm (quét dồn dập không mất lượt), quét hai lần liền một mã chưa có trong phiếu chỉ thêm một dòng.

**Đã thử trên local** (giả lập máy quét = gõ phím thật + Enter trong khung trình duyệt, 6 mã có mã vạch 13 số): quét cùng mã 2 lần → 2; mã khác → đúng dòng, con trỏ vẫn ở ô quét; bắn vào ô đếm trống và ô đếm đang có số → ô giữ số cũ, đúng mã +1; bấm chip "Chỉ hiện lệch" rồi quét → chip không bị bật/tắt, đúng mã +1; tải lại trang → nháp còn; nháp rác 14 chữ số → "1 ô sai số", nút Chốt khóa, quét lại → về 1; sáng + tối. `tsc` frontend + backend sạch.

**CHƯA kiểm:** máy quét thật (máy quét cấu hình hậu tố Tab thay cho Enter sẽ không chạy — chưa gặp); tem in MÃ SKU có chữ (vd `AT-DT-CT-NAU-L`) bắn nhầm vào ô đếm — ô số không nhận chữ nên lớp 3 không bắt được, chỉ lớp 1 + 2 che; mã chưa có trong phiếu (nhánh tra máy chủ, mã không đổi logic); bấm Chốt sau khi quét; trần backend (chưa gọi thử); mobile.

### 9.1 Anh xem local 09/11: bỏ dòng chú thích + thử mã không có trong Tổng kho

- **Anh: "Phần chú thích nhỏ này cũng không cần đâu"** → bỏ dòng "Cứ quét liên tục — …" dưới ô quét. Dòng "Vừa quét: MÃ · đã đếm N" GIỮ (chỉ hiện sau lần quét đầu) — đây là phản hồi của lần quét, không phải chú thích; anh chưa nói bỏ.
- **Thử trên local (gõ phím thật + Enter):**
  - Mã vạch không có trong Tổng kho (`8934567890123`) → thông báo đỏ `Không có SKU nào khớp "8934567890123"`, không thêm dòng, không đổi số nào, ô quét xóa trắng, con trỏ vẫn ở ô quét — quét tiếp được ngay.
  - Mã có trong Tổng kho nhưng không nằm trong phiếu (vị trí này sổ 0) → thêm một dòng cuối bảng, Sổ 0, đếm 1; quét lần 2 → 2 (vẫn một dòng).
  - Gõ tay mã SKU chữ thường (`vay01-den-l`) → nhận, thêm dòng, đếm 1.
- **Kẽ hở tìm ra và đã vá:** mã vạch đọc THIẾU một số (12 số) mà máy chủ tìm ra đúng một sản phẩm "gần giống" thì bản cũ cộng luôn vào sản phẩm đó (nhánh "chỉ ra một kết quả thì nhận", vốn để gõ tay một phần mã SKU). Nay dãy ≥ 8 chữ số phải trùng khít mã vạch / mã SKU mới được cộng; gõ tay mã có chữ vẫn giữ sự tiện tay cũ. Đã thử: 12 số → báo "Không có SKU nào khớp", không cộng.
- **Dòng thêm bằng quét mất khi tải lại trang — ĐÃ SỬA (anh: "Sửa luôn"):** bản nháp trước chỉ nhớ số của mã có trong phiếu. Nay các dòng thêm bằng quét còn số đếm được lưu riêng (`hubsell_stocktake_extra_<vị trí>`), tải lại trang nạp lại sau các dòng của phiếu. Luật: xóa trắng ô đếm của dòng đó = lần tải sau bỏ dòng; mã nay đã vào phiếu (vừa có hàng ở vị trí) thì dùng dòng của phiếu, giữ số đếm; Chốt xong xóa cả hai khóa nháp; Chốt báo 404 (có mã bị xóa khỏi kho giữa chừng): bản đầu thôi nhớ dòng thêm bằng quét; từ 9.4 phiếu tự tải lại và mã đã xóa tự rời phiếu. Đã thử local: quét 2 mã ngoài phiếu → tải lại còn đủ dòng + số, quét tiếp cộng đúng; xóa trắng một ô → tải lại dòng đó biến mất, dòng kia còn. CHƯA thử: bấm Chốt có dòng thêm bằng quét và nhánh 404 — em không bấm Chốt trên local vì chốt sẽ đổi tồn và xếp việc đẩy tồn lên sàn trong DB local.

### 9.2 Phân trang bảng Kiểm kê (09/11, anh: "Phần này em đã phân trang ra chưa")

Trước đó CHƯA phân trang: phiếu (tối đa 2.000 mã) vẽ hết trong một khung cuộn, mỗi phím gõ / lần quét vẽ lại cả bảng. Nay theo chuẩn bảng số liệu (20 / 50 / 100 dòng/trang, nhớ theo trình duyệt `hubsell_stocktake_page_size`):

- **Phân trang CHỈ Ở PHẦN VẼ.** Dữ liệu cả phiếu vẫn nằm trên máy: số đã đếm, số lệch, dò mã quét, "Chỉ hiện lệch", nút Chốt đều tính trên TOÀN phiếu — không gọi thêm máy chủ khi lật trang.
- **Quét mã nằm ở trang khác → tự lật tới trang đó**, cuộn dòng vào giữa khung, tô xanh; con trỏ vẫn ở ô quét. Dòng thêm bằng quét nằm cuối phiếu → lật tới trang cuối.
- Enter ở ô đếm cuối trang → sang ô đầu trang sau. Đổi chip lọc / vị trí / số dòng mỗi trang → về trang 1. Đổi số dòng xong con trỏ về ô quét (để ở ô chọn thì số máy quét bắn ra sẽ đổi lựa chọn).
- "· N ô sai số" ở chân trang thành nút: bấm là tới đúng ô sai đầu tiên (có thể đang ở trang khác) — không thì khách không biết vì sao nút Chốt khóa.
- Thanh phân trang chỉ hiện khi phiếu > 20 mã. Mặc định 50 dòng/trang (em tự chọn: kiểm kê đọc liền theo kệ, 20 thì lật quá dày; Tổng kho mặc định 20).
- **Đã thử local** (25 mã, 20 mã/trang): đang trang 1 quét mã trang 2 → sang trang 2, đúng dòng +1; đang trang 2 quét mã trang 1 → về trang 1; mã lạ → báo đỏ, không lật trang; Enter ô cuối trang 1 → con trỏ vào ô đầu trang 2; ô rác ở trang 2, đứng trang 1 bấm "1 ô sai số" → tới đúng ô; tải lại trang → nhớ 20 mã/trang. `tsc` + `eslint` sạch.
- **CHƯA:** đo độ mượt với phiếu 2.000 mã thật (local chỉ dựng được 25 dòng); trần 2.000 mã của phiếu giữ nguyên (mã thứ 2.001 trở đi vẫn quét vào được như mã ngoài phiếu, nay với số Sổ thật — mục 9.3).

### 9.3 Số Sổ thật cho mã quét ngoài phiếu (09/11, anh: "Sửa luôn")

- **Lỗi cũ:** dòng thêm bằng quét luôn ghi cứng Sổ = 0. Đúng với shop dùng vị trí (mã ngoài phiếu = vị trí đó không có), SAI với shop không dùng vị trí: mã ngừng bán / mã ngoài 2.000 dòng đầu vẫn có tồn. Hệ quả không chỉ là hiển thị: trang chỉ gửi lên mã có "đếm ≠ Sổ", nên đếm ra đúng 0 (hết hàng thật) mà Sổ hiện 0 thì mã đó KHÔNG được gửi → sót điều chỉnh.
- **Sửa:** lúc quét, Sổ lấy từ kết quả tra sản phẩm — không dùng vị trí = `quantityInStock`; dùng vị trí = tồn của mã ở đúng vị trí đang kiểm (không có thì 0). Lúc tải lại trang, các dòng thêm bằng quét hỏi lại máy chủ số Sổ hiện tại qua `POST /api/inventory/stocktake/rows` `{ locationId?, productIds[≤500] }` (chỉ đọc; POST vì danh sách id dài). Mã đã bị xóa khỏi kho thì máy chủ không trả về → trang tự bỏ dòng. Hỏi không được (mất mạng, backend chưa lên bản mới) → tạm dùng Sổ đã nhớ trong máy.
- **Đã thử local:** tài khoản demo@hubsell.tech (không dùng vị trí, 5 mã đang bán): quét mã ngừng bán VAY-HOA-S (tồn thật 140) → dòng mới Sổ 140, đếm 1, Lệch −139; tải lại trang → gọi `/stocktake/rows` 200, dòng còn với Sổ 140. Tài khoản admin (có vị trí): tải lại vẫn đủ 24 dòng, dòng thêm bằng quét Sổ 0. `tsc` hai phía + `eslint` sạch.
- **Thứ tự deploy:** frontend lên trước backend vẫn chạy (gọi `/rows` lỗi thì lùi về Sổ đã nhớ).
- **CHƯA:** bấm Chốt trên local; mã đã bị xóa giữa chừng (nhánh máy chủ không trả về); máy quét thật.

### 9.4 Đợt hai (09/11, anh: "commit phần này rồi tiếp tục sửa") — đợt một đã commit `8315c2f3`

- **Tem in MÃ SKU có chữ bắn nhầm vào ô đếm (lớp chặn 3b).** Ô số nuốt mất chữ nên lớp 3 (≥ 8 chữ số) không bắt được. Nay ở ô đếm, một phím in được KHÁC chữ số (chữ cái, gạch, chấm…) = mã quét: chuyển sang ô quét kèm phần chữ số vừa gõ vào ô đó (đầu mã), ô đếm về lại số cũ. Ca hay gặp: gõ tay một số đếm + Enter → con trỏ sang ô đếm kế → cầm máy quét bắn tiếp. Đánh đổi (không dùng ngưỡng thời gian): gõ tay số đếm mà CHƯA Enter rồi bắn tem có chữ thì số vừa gõ bị coi là đầu mã → báo đỏ "Không có SKU nào khớp", ô về số cũ.
- **Chốt phiếu > 500 mã lệch.** Máy chủ nhận tối đa 500 mã mỗi lần (`STOCKTAKE_MAX`); trước đây trang gửi hết một lần → lần kiểm kê đầu của shop vài nghìn mã (sổ 0, đếm ra hết) bị từ chối "Phiếu kiểm kê cần 1–500 mã" sau khi đã đếm xong. Nay trang gửi nối tiếp từng lượt 500 (`STOCKTAKE_SUBMIT_CHUNK` trong `frontend/src/lib/stocktake.ts`, phải khớp `STOCKTAKE_MAX`), mỗi lượt một giao dịch. Hỏng giữa chừng: báo "Đã chốt X/Y mã lệch thì gặp lỗi… bấm Chốt lần nữa cho phần còn lại", phiếu tự tải lại — mã đã ghi thành "khớp", số đếm còn lại vẫn giữ.
- **Phiếu tự tải lại tại chỗ** (`reloadTick`) sau khi chốt, chốt dở, hoặc Chốt báo 404 (có mã bị xóa khỏi kho giữa lúc đếm — tải lại là mã đó tự rời phiếu, kể cả dòng thêm bằng quét vì `/stocktake/rows` không trả về). Bỏ cờ `forgetExtras` của mục 9.1.
- **Ô quét không còn giữ chữ đang gõ trong state** (đọc / xóa thẳng trên ô nhập): trước đó mỗi phím máy quét bắn ra vẽ lại cả bảng.
- **Đo trên local, phiếu GIẢ 2.000 mã, 100 mã/trang, bản DEV** (máy chủ giả ngay trong trình duyệt — không ghi DB): bảng chỉ vẽ 100 dòng; phím gõ ở ô quét ~7 ms xử lý (không vẽ lại bảng); Enter của một lần quét ~90–100 ms, kể cả khi phải lật từ trang 1 sang trang 20; gõ một chữ số ở ô đếm ~70–130 ms. Bản dev chậm hơn bản build nhiều lần; CHƯA đo bản build / prod. Nếu prod còn ì khi gõ ô đếm: tách dòng thành component có `memo` để mỗi lần chỉ vẽ lại một dòng (chưa làm).
- **Đã thử nút Chốt với máy chủ giả:** 1.033 mã lệch → 3 lượt 500 / 500 / 33, báo "điều chỉnh 1.033 mã", phiếu tải lại với sổ mới, nháp xóa sạch, con trỏ về ô quét. Lỗi giả ở lượt 2 của 700 mã lệch → "Đã chốt 500/700…", 500 mã thành "khớp", còn 200 lệch, số đếm giữ nguyên.
- **Đã thử thật trên backend local:** `POST /inventory/stocktake` với số đếm 10.000.000 → 400, tồn không đổi.
- **CHƯA:** bấm Chốt THẬT vào DB local (sẽ đổi tồn + xếp việc đẩy tồn lên sàn; tài khoản demo có 18 sản phẩm sàn đang nối nên em không bấm); máy quét thật; đo bản build; trần 2.000 mã của phiếu giữ nguyên.

## 10. Tổng kho: cài nhanh cảnh báo / tồn an toàn cho nhiều SKU + cột Giá trị tồn + đổi tên cột "Đang ở" → "Vị trí" (09/11/2026; ĐÃ PUSH `b1a71642`, prod OK — xem 10.4)

Khách nguyenvanmanh1120@gmail.com xin (anh Trung chuyển, kèm ảnh khoanh hai chỗ): (1) "một nút cài đặt nhanh — tích vào nhiều sản phẩm và cài đặt cảnh báo, số lượng an toàn" thay vì mở ⋯ từng dòng; (2) "thêm cột tổng giá trị tồn = số lượng × giá vốn". Trong lúc làm anh nhắn thêm: **"Đang ở" đổi tên thành "Vị trí"** và **"phần này em chú ý tới tỉ lệ màn hình"**.

### 10.1 Nút "Cài cảnh báo & tồn an toàn"

- **Vị trí:** góc phải hàng chip lọc (chỗ anh khoanh), chỉ chủ shop. Luôn hiện để khách biết có tính năng; chưa tích dòng nào mà bấm → nhắc "Tích ô đầu dòng của các sản phẩm cần cài, rồi bấm lại nút này". Đã tích → nhãn kèm số "(N)". Không thêm nút thứ năm vào thanh xử lý hàng loạt ở đáy màn (thanh đó đã 4 nút).
- **Hộp** (`components/products/bulk-stock-settings-dialog.tsx`): hai ô giống hộp cài đặt một SKU — Ngưỡng cảnh báo sắp hết hàng, Tồn an toàn. **Ô nào để trống thì GIỮ NGUYÊN số đang có của từng SKU** (khác hộp một SKU, nơi để trống = về mặc định toàn shop). Hai ô cùng trống thì nút Áp bị khóa. Có nhập Tồn an toàn và có SKU đang nối sàn → dòng cảnh báo vàng "N SKU đang nối sàn sẽ được đẩy lại số Có thể bán". Áp xong bỏ tích hết, tải lại bảng.
- **Backend** `POST /api/products/bulk` thêm `action: "stockSettings"` kèm `lowStockThreshold` / `safetyStock` (số nguyên 0 … 1.000.000; `null` = về mặc định shop; không gửi = giữ nguyên), ≤ 500 SKU mỗi lần (frontend tự chia lượt 500), chỉ chủ shop. **Số lượt gọi sàn:** chỉ SKU có tồn an toàn THẬT SỰ đổi mới được xếp việc đẩy tồn (đọc trước khi ghi; trả về `pushed`); đổi riêng ngưỡng cảnh báo KHÔNG đẩy sàn (số Có thể bán không đổi), chỉ kiểm lại thẻ "sắp hết hàng". Khác đường sửa một SKU (`PATCH /products/:id`) vốn đẩy sàn cả khi chỉ đổi ngưỡng — chưa đụng đường đó.

### 10.2 Cột "Giá trị tồn" — co theo bề rộng KHUNG BẢNG

- Giá trị tồn = tồn kho × giá vốn; tồn âm tính 0; chưa có giá vốn → "—". Dòng cha của mẫu nhiều phân loại = tổng các phân loại đã có giá vốn (chú thích ghi mấy phân loại chưa tính). Chỉ người thấy giá vốn mới có.
- **Bản đầu em thêm hẳn một cột → laptop 1366–1440 phải cuộn ngang, cột Nhập · Xuất bị cắt; số 8–9 chữ số đè sang cột Bán trên.** Sau lời nhắc về tỉ lệ màn hình, đổi thành:
  - khung bảng ĐỦ rộng → cột riêng "Giá trị tồn" giữa Bán trên và Nhập · Xuất (chỗ anh khoanh), bề rộng cố định 7rem (112px) để không ăn vào % các cột đã đo; từ 1 tỷ trở lên hạ cỡ chữ;
  - khung hẹp hơn → ẩn cột, giá trị thành DÒNG NHỎ rút gọn dưới số Tồn kho ("≈ 298,4tr ₫", số đủ trong chú thích khi rê chuột) — cùng kiểu dòng "an toàn N" ở cột Có thể bán.
  - Ngưỡng theo container query trên khung bảng (`@container` ở CardContent; `STOCK_VALUE_SHOW` trong `components/products/stock-value.tsx`): 1.088px khi không có cột Vị trí, 1.152px khi có. Bề rộng tối thiểu của bảng GIỮ như cũ (1.000 / 1.040px).
- **Đo trên local** (JS đo chữ tràn khỏi ô; số bơm thử 298.400.000 và 998.888.888; dòng nhỏ "≈ 998,9tr ₫", "≈ 12,35 tỷ ₫"):

  | Màn | Có cột Vị trí (admin) | Không có cột Vị trí (demo) |
  |---|---|---|
  | 1280 | dòng nhỏ · cuộn ngang 97px (như trước khi sửa) | chưa đo |
  | 1366 | dòng nhỏ · cuộn 11px (như trước) | dòng nhỏ · không cuộn |
  | 1440 | dòng nhỏ · không cuộn | CỘT · không cuộn |
  | 1536 / 1700 / 1920 | CỘT · không cuộn | chưa đo (rộng hơn 1440 nên chắc chắn là cột) |

  Không ô nào của cột mới / dòng mới tràn sang ô bên. Cột Giá bán tràn 1,4px ở 1280–1366 có cột Vị trí — có từ trước, không do đợt này. Chế độ tối: bảng + hộp cài nhanh đọc được.

### 10.3 Đã thử / chưa thử

- **Đã thử local:** chưa tích mà bấm → nhắc; tích 2 SKU → nhãn "(2)", hộp mở, ô ngưỡng nhận con trỏ sẵn; nhập ngưỡng 7, để trống tồn an toàn → "Đã cài ngưỡng cảnh báo 7 cho 2 SKU", API đọc lại ngưỡng 7 và tồn an toàn KHÔNG đổi, bỏ tích hết (đã trả 2 SKU về như cũ). Gọi API thẳng trên 3 SKU CHƯA nối sàn: đặt tồn an toàn 2 + ngưỡng 4 → `pushed: 3`, Có thể bán 7 → 8; gửi lại y hệt → `pushed: 0`; trả về mặc định → như cũ. Thiếu cả hai trường → 400; số âm → 400. `tsc` hai phía + `eslint` sạch.
- **CHƯA thử:** bấm Áp có đổi tồn an toàn trên SKU ĐANG nối sàn (sẽ xếp việc đẩy tồn trong DB local — không bấm); > 500 SKU; tài khoản nhân viên (không thấy giá vốn → không có cột; không phải chủ shop → không có nút — theo mã, chưa mở thử); màn 1280 không có cột Vị trí; mobile (app mobile chưa có hai thứ này).
- **Chưa làm (không ai xin):** tổng giá trị tồn của CẢ kho (một con số ở đầu / cuối bảng); cột Giá trị tồn trong file Excel xuất ra; sắp xếp theo giá trị tồn.

### 10.4 Push + kiểm prod + dọn mã (09/11/2026 chiều)

**Push (anh: "Em push hết lên nhé"):** `8315c2f3` + `dbb672c9` (Kiểm kê) + `b1a71642` (Tổng kho), không có migration. **Kiểm prod:** backend `/health` = `b1a71642`; mở app prod bằng tài khoản chủ shop (chỉ xem, không lưu gì), màn 1920: Tổng kho có cột "Vị trí", cột "Giá trị tồn" (100 dòng, số dài nhất 298.400.000 ₫, không ô nào tràn, không cuộn ngang) và nút "Cài cảnh báo & tồn an toàn"; Kiểm kê 187 mã vẽ 50 dòng/trang, con trỏ nằm sẵn ô quét, hết dòng chú thích. CHƯA làm trên prod: quét thật, bấm Chốt, bấm Áp cài hàng loạt.

**Dọn mã (anh: "Dọn dẹp code thừa … đảm bảo mô hình tree chuyên nghiệp") — không đổi hành vi, đã commit + push cùng ngày:**
- Trang Kiểm kê chỉ còn điều phối giao diện: luật (mã quét ≥ 8 chữ số, trần số đếm, lượt chốt 500, cỡ trang) + đọc / ghi bản nháp trình duyệt → `frontend/src/lib/stocktake.ts`. Trang không còn gọi `localStorage` trực tiếp.
- Giá trị tồn: `stockValueOf`, `groupStockValue`, ngưỡng hiện / ẩn `STOCK_VALUE_SHOW`, ô `StockValueAmount` (dùng chung cho dòng lá và dòng cha, trước lặp hai lần), dòng nhỏ `StockValueSubline` → `frontend/src/components/products/stock-value.tsx` (luật: helper của trang ở `components/<nhóm>/`).
- Backend: một hàm `parseStockSettings` (`routes/products.ts`) đọc tồn an toàn + ngưỡng cảnh báo cho cả `PATCH /products/:id` và `POST /products/bulk` (trước mỗi nơi tự kiểm một kiểu) — hệ quả duy nhất: sửa một SKU nay cũng có trần 1.000.000 như cài hàng loạt; cài hàng loạt gọi lại `checkLowStockLater` có sẵn của `integrations/inventory-push.ts` thay vì chép đoạn nạp `ops-alerts`; `POST /inventory/stocktake/rows` bỏ ép kiểu.
- Xóa mã chết (knip + grep): `frontend/src/components/mappings/link-one-dialog.tsx` (hộp nối một SKU, không ai gọi từ 05/11 khi chuyển sang nối một chiều; thư mục `components/mappings/` hết tệp) và hai hàm `linkChannelProducts` / `linkChannelProductBySku` trong `lib/api.ts`. Route backend `/api/mappings/link*` GIỮ nguyên (chưa rà app mobile).
- Kiểm sau dọn: `tsc` hai phía + `eslint` tệp sửa sạch; chạy lại local: sửa một SKU (số âm / số lẻ → 400, đặt rồi trả về mặc định), cài hàng loạt, `/stocktake/rows` có / không vị trí, cột ↔ dòng nhỏ ở 1536 / 1366, quét + tải lại trang Kiểm kê giữ số.
- knip còn báo nhưng KHÔNG đụng (ngoài phạm vi phiên, phần lớn chỉ thừa từ khóa `export`): `startBulkConfirm` / `fetchBulkConfirmProgress` trong `lib/api.ts`, 4 hàm `exportXxxToExcel`, vài hàm ở `channel-products/shared.ts`.

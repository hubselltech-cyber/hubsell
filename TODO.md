# 📋 Nhật ký tiến độ & Việc cần làm — Hubsell

> Cập nhật lần cuối: **18/07/2026** — kết thúc phiên làm việc Module Tài chính.
> Điểm lưu Git gần nhất: `f85af22` — **hubsell-v1.1-finance-module** (46 file)
> ✅ Toàn bộ code đã được lưu an toàn vào Git.

---

## 🎯 Trọng tâm phiên này: MODULE TÀI CHÍNH (Hubsell Finance)

### Cấu trúc menu đã dựng
Sidebar → **Quản lý Tài chính** (icon Wallet, nằm ngay dưới "Đơn hàng") gồm 4 mục con:

| # | Mục con | Đường dẫn | Chức năng |
|---|---|---|---|
| 1 | Báo cáo dòng tiền | `/finance/analytics` | Biểu đồ vùng Doanh thu vs Tổng chi phí + 3 chỉ số tài chính |
| 2 | Chi phí vận hành | `/finance/expenses` | Bảng chi phí + modal thêm nhanh (Cố định / Biến đổi) |
| 3 | Cảnh báo đơn lỗ | `/finance/loss-orders` | Danh sách đơn bán lỗ để đối soát |
| 4 | Cấu hình Giá vốn | `/finance/cost-prices` | Nhập giá vốn theo từng SKU (**trọng tâm**) |

---

## ⭐ Trang Cấu hình Giá vốn (`/finance/cost-prices`) — chi tiết đầy đủ

Đây là trang được đầu tư nhiều nhất trong phiên này. Tổng hợp mọi tính năng:

### a) Bảng danh sách SKU
- Cột: **Ảnh · Tên sản phẩm · Phân loại (màu/size) · Mã SKU · Kênh bán · Giá bán · Giá vốn (VNĐ)**
- Ảnh sản phẩm hiển thị theo màu của từng sàn (Shopee cam · TikTok đen · Lazada xanh)
- SKU sàn lấy từ bảng liên kết `ProductMapping`; sản phẩm chưa liên kết sàn → xếp nhóm **Offline**

### b) Nhập giá vốn — tự động lưu
- Gõ giá vốn vào ô input → **click ra ngoài (onBlur) là tự lưu**, kèm toast "Đã cập nhật giá vốn"
- Hiện spinner khi đang lưu, dấu ✓ xanh khi lưu xong
- Ô của SKU chưa có giá vốn được tô **viền vàng** để dễ nhận ra
- 🐛 **Đã vá lỗi nghiêm trọng:** lăn chuột khi con trỏ ở trong ô số làm đổi giá trị rồi tự lưu ngầm
  → đã thêm `onWheel` để ô tự bỏ focus, không thể đổi giá ngoài ý muốn nữa

### c) Bộ lọc theo sàn
5 tab: **Tất cả · Shopee · TikTok Shop · Lazada · Offline**

### d) Nút "Đồng bộ từ sàn" (xanh ngọc, góc phải)
- Quét sản phẩm (SKU, tên biến thể, giá bán, ảnh) từ **mọi gian hàng đang hoạt động**
- Cơ chế **upsert**: SKU mới → tạo (giá vốn = 0 chờ nhập); SKU đã có → cập nhật tên/ảnh
- 🔒 **Không bao giờ ghi đè giá vốn** đã nhập
- Chạy lại nhiều lần **không tạo bản ghi trùng** (đã kiểm chứng)

### e) 🆕 Thanh Bộ Lọc Nâng Cao (vừa thêm cuối phiên)
Dành cho shop có hàng trăm/hàng nghìn SKU:

1. **Ô tìm kiếm real-time** (icon Search):
   - Tìm theo **Tên sản phẩm · Mã SKU · Tên phân loại trên sàn**
   - ✨ **Bỏ dấu tiếng Việt**: gõ `ao thun` vẫn ra `Áo thun`, `mu luoi` ra `Mũ lưỡi` (đã test 6/6 đúng)
   - Nút **✕** ở cuối ô để xoá nhanh từ khoá
2. **Dropdown lọc trạng thái giá vốn**: Tất cả sản phẩm / Chưa nhập giá vốn / Đã nhập giá vốn
3. **Bộ đếm** "Hiển thị X/Y SKU" khi đang lọc
4. Lọc chạy **client-side** → kết quả hiện ngay lập tức khi đang gõ, không giật

### f) 3 màn hình trống (Empty State) thông minh
| Tình huống | Hiển thị |
|---|---|
| Kênh chưa có SKU nào | Icon PackageSearch + gợi ý bấm "Đồng bộ từ sàn" |
| Lọc "Chưa nhập giá vốn" mà **không còn SKU nào thiếu** | ✅ **CheckCircle xanh ngọc** + *"Tuyệt vời! Toàn bộ sản phẩm của bạn đã được cấu hình giá vốn."* |
| Tìm kiếm không ra kết quả | Icon SearchX + gợi ý đổi từ khoá |

---

## ✅ Toàn bộ công việc đã hoàn thành sau mốc v1.0

### 1. Nhập/Xuất Excel
- `POST /api/products/import` — đọc Excel, validate từng dòng, **upsert** trong 1 transaction
- Modal kéo-thả file + nút tải **file Excel mẫu**
- Xuất Excel danh sách Sản phẩm và Đơn hàng (theo bộ lọc)
- Dùng thư viện `xlsx` bản đã vá bảo mật từ CDN chính thức SheetJS

### 2. Chi phí hoạt động & Lợi nhuận thuần
- Bảng `OperatingExpense` (phân loại **FIXED** cố định / **VARIABLE** biến đổi)
- Thẻ "Lợi nhuận thuần" trên Tổng quan, tự đổi màu xanh/đỏ theo lãi/lỗ

### 3. Onboarding Guard — bắt buộc kết nối gian hàng
- Middleware `requireChannel`: chưa có kênh → chặn API dữ liệu (`409 NO_CHANNEL`)
- Màn hình chào mừng với 3 nút kết nối nhanh Shopee / TikTok Shop / Lazada
- Kết nối xong là mở khoá toàn bộ hệ thống ngay

### 4. Phân quyền nhân viên theo Gian hàng (Multi-store)
- Bảng `StaffChannel` — Admin giới hạn nhân viên chỉ xử lý một số kênh nhất định
- Trang **Nhân viên** (`/staff`): thêm nhân viên, phân quyền kênh bằng checkbox, xoá
- Nhân viên bị giới hạn chỉ thấy kênh & đơn được gán; sửa đơn ngoài phạm vi → chặn 403

### 5. Module Tài chính — Backend
| API | Chức năng |
|---|---|
| `GET /api/finance/analytics` | Tổng doanh thu · Lợi nhuận gộp · Lợi nhuận thuần + chuỗi 14 ngày |
| `GET /api/finance/orders-analysis` | Quét đơn Đã giao → đơn lỗ + cảnh báo thiếu giá vốn |
| `GET/POST /api/finance/expenses` | Danh sách & thêm chi phí vận hành |
| `GET /api/finance/sku-products?channel=` | Danh sách SKU theo sàn để nhập giá vốn |
| `PATCH /api/finance/update-cost` | Cập nhật giá vốn theo `sku_id` |
| `POST /api/finance/sync-products` | Quét sản phẩm từ các sàn về (upsert) |

### 6. Cơ sở dữ liệu (9 bảng)
`User` · `Channel` · `Product` · `Order` · **`OrderItem`** · `InventoryLog` · `ProductMapping` · `OperatingExpense` · `StaffChannel`

**Công thức tài chính đang áp dụng:**
- Lợi nhuận gộp = Tổng doanh thu (đơn Đã giao) − Tổng giá vốn
- **Lợi nhuận thuần = Lợi nhuận gộp − Phí sàn − Chi phí vận hành**
- Đơn lỗ = (Doanh thu đơn − Phí sàn − Giá vốn đơn) ≤ 0
- Phí sàn tự tính: Shopee 10% · Lazada 9% · TikTok 8% · Offline 0%
- 🔑 Giá vốn dùng **`costPriceAtSale`** — ảnh chụp giá vốn tại đúng thời điểm bán, nên đổi giá vốn sau này không làm sai báo cáo đơn cũ

---

---

## 🆕 Nâng cấp mới nhất: PHÍ SÀN 2 GIAI ĐOẠN & DÒNG TIỀN TREO

### Phí sàn 2 giai đoạn (giải bài toán "chi phí ẩn")
- **GĐ1 — Tạm tính:** đơn mới về dùng % phí cấu hình của kênh (`Channel.feeRate`): Shopee 12% · TikTok 11% · Lazada 10%
- **GĐ2 — Quyết toán:** đơn chuyển "Đã giao" → bóc tách số thực tế từ sàn: **phí cố định + phí dịch vụ + phí thanh toán − trợ giá** → ghi `actualPayout`
- Báo cáo luôn ưu tiên số quyết toán; kiểm chứng thực tế: đơn 305.000đ tạm tính phí **36.600đ** nhưng quyết toán chỉ **25.875đ** (lệch 10.725đ)
- Đã chạy script `prisma/backfill-settlement.ts` quyết toán 6 đơn cũ + gán % phí cho 7 gian hàng

### Dòng tiền treo (trang Báo cáo dòng tiền)
- 🟡 Thẻ **Tiền chờ về (Dự kiến)** — đơn Đang giao/Chờ xử lý, số tạm tính
- 🟢 Thẻ **Tiền thực tế (Đã quyết toán)** — tiền sàn đã giải ngân về ví

### Bóc tách lý do đơn lỗ (trang Cảnh báo đơn lỗ)
- 🔴 **Lỗ do Giá vốn** — bán dưới giá vốn
- 🟠 **Lỗ do Chi phí sàn** — bán trên giá vốn nhưng phí sàn ăn hết lãi
- Cột Phí sàn ghi rõ đang là *(quyết toán)* hay *(tạm tính)*

---

## 🔜 KẾ HOẠCH NGÀY MAI

### ✅ 1. TRANG "ĐỐI SOÁT CHÊNH LỆCH PHÍ SHIP" — ĐÃ HOÀN THÀNH 18/07/2026
Đã làm xong: enum `ShippingDisputeStatus`, 2 trường `shippingFeeQuoted`/`shippingFeeActual`,
API `GET|PATCH /api/finance/shipping-discrepancies`, trang `/finance/shipping-alerts`
(2 thẻ chỉ số + bảng + badge trạng thái + nút đổi trạng thái nhanh + xuất Excel 5 cột khiếu nại).

<details><summary>Kế hoạch gốc (đã thực hiện)</summary>
Mục tiêu: gom các đơn bị sàn trừ nhầm/trừ thêm tiền ship, giúp chủ shop **bấm nút xuất danh sách đi khiếu nại sàn**.

**Dữ liệu đã có sẵn** (không cần migration mới):
- `Order.shippingFeeDiff` — khoản sàn trừ thêm ngoài phí ship đã thu của khách
- `Order.isSettled` / `settledAt` — chỉ đơn đã quyết toán mới có số liệu này
- `Order.orderCode`, `customerName`, `totalAmount`, `channel.channelName`, `createdAt`

**Việc cần làm — Backend:**
- [ ] API `GET /api/finance/shipping-disputes` — lọc đơn có `shippingFeeDiff > 0`
  - Hỗ trợ lọc theo kênh + khoảng thời gian
  - Trả tổng số tiền bị trừ, số đơn, và chi tiết từng đơn
  - Cân nhắc thêm trạng thái khiếu nại (chưa khiếu nại / đã gửi / đã hoàn tiền)
    → nếu cần thì thêm cột `disputeStatus` vào Order (migration nhỏ)

**Việc cần làm — Frontend:**
- [ ] Thêm mục con thứ 5 vào menu "Quản lý Tài chính": **"Đối soát phí ship"** (`/finance/shipping-disputes`)
- [ ] Bảng danh sách: Mã đơn · Khách hàng · Kênh · Ngày · Phí ship bị trừ · Trạng thái khiếu nại
- [ ] Thẻ tổng: "Tổng tiền bị trừ nhầm" + số đơn (màu cảnh báo)
- [ ] Nút **"Xuất Excel khiếu nại"** — dùng lại `src/lib/excel.ts` đã có sẵn
  - File xuất nên có đủ cột sàn yêu cầu khi khiếu nại (mã đơn, ngày, số tiền, lý do)
- [ ] (Tuỳ chọn) Nút đánh dấu "Đã gửi khiếu nại" cho từng đơn

**Lưu ý:** dữ liệu `shippingFeeDiff` hiện do `mockSettlement()` sinh ra (đơn có `hash % 7 == 0` → bị trừ 5.000–15.000đ). Hiện tại có **1 đơn** đang bị trừ 15.000đ. Nếu cần thêm dữ liệu test, tạo vài đơn mới rồi chuyển sang "Đã giao".

</details>

### 2. 🔍 Kiểm tra luồng vận hành real-time (việc tiếp theo)
Chạy thử toàn bộ chuỗi nghiệp vụ từ đầu đến cuối:
- [ ] Đơn từ sàn đổ về (webhook) → tự trừ kho → ghi `OrderItem` kèm giá vốn
- [ ] Cập nhật trạng thái đơn → giao hàng → vào báo cáo tài chính
- [ ] Hủy đơn → tự hoàn kho
- [ ] Số liệu Dashboard / Báo cáo dòng tiền / Đơn lỗ khớp nhau
- [ ] Kiểm tra khi nhiều đơn đổ về cùng lúc (tồn kho có bị lệch không)

---

## 📌 Ghi chú kỹ thuật cần nhớ

1. **Đơn cũ hiện nhãn "Chưa cấu hình giá vốn"** — 4 đơn tạo từ trước khi có bảng `OrderItem` thực sự không có dữ liệu giá vốn liên kết. Đây là cảnh báo **chính xác**, không phải lỗi. Đơn mới từ giờ luôn có snapshot giá vốn.
2. **Ảnh sản phẩm hiện là ảnh giả lập** (ô màu + chữ cái đầu) do lớp mock sàn sinh ra. Khi tích hợp API sàn thật, chỉ cần thay hàm `mockImageFor()` bằng URL ảnh sàn trả về.
3. **Dữ liệu test:** đã nhập giá vốn cho toàn bộ 18 SKU (ước tính ≈55% giá bán) để test màn hình chúc mừng — bạn nên thay bằng giá vốn thật của shop.
4. **Bài học kỹ thuật:** mọi ô `input type="number"` có tự-lưu đều phải chặn lăn chuột (`onWheel`), nếu không người dùng sẽ vô tình đổi số liệu.

---

## 💡 Ý tưởng nâng cấp tương lai (chưa làm)

- Tích hợp **API sàn thật** (Shopee / TikTok Shop / Lazada) thay lớp giả lập
- Phân trang cho trang Cấu hình Giá vốn khi vượt ~1.000 SKU (hiện lọc client-side)
- Nhập giá vốn hàng loạt bằng file Excel
- Upload ảnh sản phẩm thật
- Xuất báo cáo tài chính ra Excel/PDF, lọc theo khoảng thời gian
- Triển khai lên máy chủ thật (đổi `JWT_SECRET` + mật khẩu database)

---

## 🚀 Cách chạy lại dự án

1. Bấm đúp `start-backend.bat` → để yên cửa sổ đen
2. Bấm đúp `start-frontend.bat` → để yên cửa sổ đen thứ hai
3. Mở trình duyệt vào `localhost:3000`

**Tài khoản:**
- Chủ shop: `admin@hubsell.vn` / `hubsell123`
- Nhân viên: `staff@hubsell.vn` / `staff123`

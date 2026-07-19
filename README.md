# Hubsell — Phần mềm quản lý bán hàng đa kênh

Nền tảng quản lý bán hàng đa kênh (Shopee, Lazada, TikTok, Offline) — mô hình tương tự Salework.

> ## 🏆 Phiên bản **v1.0 — MVP hoàn chỉnh** (18/07/2026)
>
> Dự án đã **hoàn thành xuất sắc trọn vẹn 4 giai đoạn cốt lõi**, tạo nên một sản phẩm MVP (Minimum Viable Product) chạy được end-to-end: từ đăng nhập bảo mật, quản lý kho, kết nối sàn, đồng bộ đơn tự động, đến báo cáo tài chính có biểu đồ và phân quyền nhân viên — khoác trên giao diện SaaS hiện đại (Sidebar dọc).
>
> Toàn bộ mã nguồn đã được kiểm thử end-to-end trên trình duyệt và đóng gói tại commit `hubsell-v1.0-mvp-completed`.

> 📋 **Xem [TODO.md](TODO.md)** để biết nhật ký tiến độ chi tiết, việc đang làm dở và kế hoạch tiếp theo.

## Tiến độ các giai đoạn — ✅ HOÀN THÀNH 4/4

| Giai đoạn | Nội dung | Trạng thái |
|---|---|---|
| 1 | Nền móng: Monorepo, Next.js + Express + Prisma + PostgreSQL, Dashboard | ✅ Xong |
| 2 | Đăng nhập/Đăng ký (JWT + bcrypt), Quản lý Sản phẩm & Kho hàng thủ công | ✅ Xong |
| 3 | Đồng bộ đơn hàng đa kênh & Mapping sản phẩm (webhook giả lập tự trừ kho) | ✅ Xong |
| 4 | Quản lý đơn hàng tập trung, Báo cáo tài chính (Recharts), Phân quyền Admin/Staff | ✅ Xong |
| ✨ | Tái cấu trúc giao diện chuẩn SaaS (Sidebar dọc + Header mỏng + Card đổ bóng) | ✅ Xong |
| ✨ | Nhập/Xuất Excel: import sản phẩm (upsert) + export Sản phẩm & Đơn hàng (SheetJS/xlsx) | ✅ Xong |
| ✨ | Chi phí hoạt động (OperatingExpense) + Lợi nhuận thuần (Net Profit) trên Dashboard | ✅ Xong |
| ✨ | Onboarding Guard (bắt buộc kết nối gian hàng) + Phân quyền nhân viên theo Gian hàng (Multi-store) | ✅ Xong |
| ✨ | **Hubsell Finance** — Module tài chính chuyên sâu: Báo cáo dòng tiền, Chi phí vận hành (FIXED/VARIABLE), Cảnh báo đơn lỗ | ✅ Xong |

## Công nghệ

- **Frontend:** Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind CSS v4 · shadcn/ui (style base-nova / Base UI) · TanStack React Table · react-hook-form + zod · sonner (toast) · Recharts (biểu đồ) · xlsx / SheetJS (Excel)
- **Backend:** Node.js · Express 4 · TypeScript (tsx watch) · Prisma ORM 6 · JWT (jsonwebtoken) · bcryptjs · multer + xlsx (đọc Excel upload)

> ℹ️ Thư viện `xlsx` được cài từ **CDN chính thức của SheetJS** (`cdn.sheetjs.com/xlsx-0.20.3`) — bản đã vá lỗ hổng bảo mật, vì bản trên npm đã ngừng cập nhật.
- **Database:** PostgreSQL 17 (cài native trên Windows, service `postgresql-x64-17`)

## Cấu trúc dự án (Monorepo)

```
hubsell/
├── frontend/                       # Giao diện web — cổng 3000
│   └── src/
│       ├── app/
│       │   ├── page.tsx            # Tổng quan + Báo cáo tài chính (biểu đồ) — chỉ Admin
│       │   ├── login/page.tsx      # Đăng nhập / Đăng ký
│       │   ├── orders/page.tsx     # Quản lý đơn hàng tập trung (lọc, đổi trạng thái, hủy hoàn kho)
│       │   ├── products/page.tsx   # Quản lý sản phẩm & kho + Nhập/Xuất Excel
│       │   ├── channels/page.tsx   # Cấu hình kết nối gian hàng + giả lập đơn — chỉ Admin
│       │   ├── mappings/page.tsx   # Liên kết sản phẩm sàn ↔ kho gốc — chỉ Admin
│       │   ├── staff/page.tsx      # Quản lý nhân viên + phân quyền gian hàng — chỉ Admin
│       │   └── finance/            # 💰 Hubsell Finance — chỉ Admin
│       │       ├── analytics/      #   Báo cáo dòng tiền (Area Chart doanh thu vs chi phí)
│       │       ├── expenses/       #   Chi phí vận hành (bảng + modal thêm nhanh)
│       │       ├── loss-orders/    #   Cảnh báo đơn lỗ (đối soát đơn bán lỗ)
│       │       └── cost-prices/    #   Cấu hình Giá vốn (lọc theo sàn, nhập onBlur tự lưu)
│       ├── components/
│       │   ├── app-shell.tsx       # Khung chung: header + menu + đăng xuất
│       │   ├── dashboard/          # Thẻ thống kê
│       │   ├── products/           # Modal thêm SP, dialog nhập/xuất kho
│       │   └── ui/                 # Component shadcn/ui
│       └── lib/
│           ├── api.ts              # Lớp gọi API + quản lý token đăng nhập
│           ├── excel.ts            # Xuất Excel (SP, đơn hàng) + tạo file mẫu (client-side)
│           └── format.ts           # Định dạng tiền VND, số, ngày giờ
│
├── backend/                        # Máy chủ API — cổng 4000
│   ├── prisma/
│   │   ├── schema.prisma           # 9 bảng: User, Channel, Product, Order, OrderItem, InventoryLog, ProductMapping, OperatingExpense, StaffChannel
│   │   ├── migrations/             # Lịch sử thay đổi cấu trúc DB
│   │   └── seed.ts                 # Dữ liệu mẫu (admin@hubsell.vn / hubsell123)
│   └── src/
│       ├── index.ts                # Điểm khởi động server
│       ├── app.ts                  # Khai báo route + middleware
│       ├── auth.ts                 # JWT: ký token + middleware requireAuth
│       ├── prisma.ts               # Kết nối Prisma dùng chung
│       └── routes/
│           ├── auth.ts             # /api/auth: register, login, me
│           ├── dashboard.ts        # /api/dashboard/summary
│           ├── products.ts         # /api/products: GET (phân trang+tìm kiếm), POST, PATCH
│           ├── inventory.ts        # /api/inventory: adjust (transaction), logs
│           ├── orders.ts           # /api/orders: lọc, phân trang, đổi trạng thái, hủy → hoàn kho
│           ├── analytics.ts        # /api/analytics: doanh thu, giá vốn, lợi nhuận, biểu đồ — chỉ Admin
│           ├── finance.ts          # /api/finance: analytics, orders-analysis (đơn lỗ), expenses — chỉ Admin
│           ├── channels.ts         # /api/channels: kết nối, ngắt, danh mục sàn
│           ├── mappings.ts         # /api/mappings: nối SKU sàn ↔ SP gốc
│           └── webhooks.ts         # /api/webhooks/mock-order: nhận đơn từ sàn
│       └── mockMarketplace.ts      # Danh mục sản phẩm sàn giả lập
│
├── docker-compose.yml              # PostgreSQL qua Docker (tuỳ chọn, hiện dùng native)
├── start-backend.bat               # Bấm đúp chạy backend
├── start-frontend.bat              # Bấm đúp chạy frontend
└── README.md
```

## API hiện có

| Method | Đường dẫn | Mô tả | Bảo vệ |
|---|---|---|---|
| POST | `/api/auth/register` | Đăng ký (bcrypt hash mật khẩu) | Công khai |
| POST | `/api/auth/login` | Đăng nhập → trả JWT (7 ngày) | Công khai |
| GET | `/api/auth/me` | Thông tin người đang đăng nhập | 🔒 JWT |
| GET | `/api/dashboard/summary` | Số liệu tổng quan | 🔒 JWT |
| GET | `/api/products` | Danh sách SP (phân trang, tìm SKU/tên) | 🔒 JWT |
| POST | `/api/products` | Thêm SP + tồn kho ban đầu (transaction) | 🔒 JWT |
| PATCH | `/api/products/:id` | Sửa thông tin SP | 🔒 JWT |
| POST | `/api/products/import` | Nhập SP hàng loạt từ file Excel (validate + upsert trong 1 transaction) | 🔒 JWT |
| POST | `/api/inventory/adjust` | Nhập/xuất kho (transaction + khoá dòng) | 🔒 JWT |
| GET | `/api/inventory/logs` | Lịch sử xuất nhập kho | 🔒 JWT |
| GET | `/api/orders` | Danh sách đơn hàng | 🔒 JWT |
| GET | `/api/channels` | Danh sách kênh bán (kèm số đơn/mapping) | 🔒 JWT |
| POST | `/api/channels` | Kết nối gian hàng (giả lập — cấp API Token ảo) | 🔒 JWT |
| POST | `/api/channels/:id/disconnect` | Ngắt kết nối gian hàng | 🔒 JWT |
| GET | `/api/channels/:id/products` | Danh mục sản phẩm trên sàn + trạng thái mapping | 🔒 JWT |
| GET | `/api/mappings` | Danh sách liên kết SKU sàn ↔ SP gốc | 🔒 JWT |
| POST | `/api/mappings` | Tạo/đổi liên kết (upsert) | 🔒 JWT |
| DELETE | `/api/mappings/:id` | Gỡ liên kết | 🔒 JWT |
| POST | `/api/webhooks/mock-order` | Webhook giả lập nhận đơn từ sàn: tra mapping → tạo Order + trừ kho + log SYNC (transaction) | 🔑 Token kênh |
| PATCH | `/api/orders/:id/status` | Đổi trạng thái vận chuyển; CANCELLED → tự hoàn kho + ghi log (transaction) | 🔒 JWT |
| GET | `/api/analytics` | Doanh thu / Giá vốn / Lợi nhuận gộp / **Chi phí HĐ / Lợi nhuận thuần**, biểu đồ | 🔒 Chỉ Admin |
| GET/POST/DELETE | `/api/expenses` | Quản lý chi phí hoạt động (mặt bằng, lương, đóng gói, quảng cáo) | 🔒 Chỉ Admin |
| GET/POST/DELETE | `/api/staff` | Quản lý nhân viên (danh sách, tạo, xoá) | 🔒 Chỉ Admin |
| PUT | `/api/staff/:id/channels` | Gán các gian hàng nhân viên được xử lý (rỗng = tất cả) | 🔒 Chỉ Admin |
| GET/POST | `/api/finance/expenses` | Danh sách & thêm chi phí vận hành (`type`: FIXED / VARIABLE) | 🔒 Chỉ Admin |
| GET | `/api/finance/orders-analysis` | Quét đơn Đã giao → **đơn bán lỗ** (Doanh thu − Phí sàn − Giá vốn ≤ 0) + cảnh báo thiếu giá vốn | 🔒 Chỉ Admin |
| GET | `/api/finance/analytics` | Tổng doanh thu / Lợi nhuận gộp / Lợi nhuận thuần + chuỗi 14 ngày (số đầy đủ) | 🔒 Chỉ Admin |
| GET | `/api/finance/sku-products?channel=` | Danh sách SKU theo sàn (all/shopee/tiktok/lazada/offline) để nhập giá vốn | 🔒 Chỉ Admin |
| PATCH | `/api/finance/update-cost` | Cập nhật giá vốn theo `sku_id` + `cost_price` | 🔒 Chỉ Admin |
| POST | `/api/finance/sync-products` | **Quét sản phẩm từ các sàn đã kết nối** → upsert vào Product + ProductMapping | 🔒 Chỉ Admin |
| GET | `/api/finance/sku-pnl` | Báo cáo Lời/Lỗ theo từng SKU (sắp xếp lợi nhuận giảm dần) | 🔒 Chỉ Admin |
| GET | `/api/finance/shipping-discrepancies` | Đơn bị sàn trừ thừa phí ship (phân trang, lọc sàn + trạng thái khiếu nại) | 🔒 Chỉ Admin |
| PATCH | `/api/finance/shipping-discrepancies/:id/status` | Đổi trạng thái khiếu nại | 🔒 Chỉ Admin |

### 🚚 Đối soát & Khiếu nại chênh lệch phí vận chuyển (`/finance/shipping-alerts`)

Gom các đơn bị sàn trừ phí ship **cao hơn mức đã báo** để chủ shop đòi lại tiền.

- Lưu `shippingFeeQuoted` (sàn báo) · `shippingFeeActual` (thực tế bị trừ) · `shippingFeeDiff` (chênh lệch)
- Vòng đời khiếu nại `shippingDisputeStatus`: **CHO_KHIEU_NAI → DANG_KHIEU_NAI → DA_DOI_SOAT** (nút "Đổi trạng thái nhanh" chuyển sang bước kế tiếp)
- 2 thẻ chỉ số: *Tổng số đơn lệch* · *Tổng số tiền cần đòi lại*
- Nút **"Xuất file khiếu nại sàn"**: gom các đơn `CHO_KHIEU_NAI` theo bộ lọc, xuất Excel 5 cột — [Mã đơn hàng] [Sàn] [Phí ship sàn báo] [Phí ship thực tế bị trừ] [Số tiền chênh lệch]

> ⚠️ **Quy ước dấu:** database lưu `shippingFeeDiff` **dương** (số tiền bị trừ thêm — đồng bộ với các trường phí khác), còn API/giao diện trả **số âm màu đỏ** theo góc nhìn "shop bị mất tiền".

## 💰 Hubsell Finance — Module tài chính chuyên sâu

**Giá vốn chuẩn kế toán:** bảng `OrderItem` lưu `costPriceAtSale` — **snapshot giá vốn tại đúng thời điểm phát sinh đơn**. Sau này chủ shop đổi giá vốn sản phẩm, báo cáo lãi/lỗ của đơn cũ vẫn chính xác tuyệt đối. (Đơn phát sinh trước khi có bảng này sẽ fallback qua `InventoryLog` × giá vốn hiện tại.)

### Phí sàn 2 giai đoạn (Tạm tính → Quyết toán)

Giải quyết bài toán "chi phí ẩn": sàn liên tục đổi biểu phí nên số tạm tính luôn lệch số thực nhận.

| Giai đoạn | Khi nào | Số liệu dùng |
|---|---|---|
| **1. Tạm tính** | Đơn Chờ xử lý / Đang giao | `platformFee` = Doanh thu × `Channel.feeRate` (mặc định Shopee 12% · TikTok 11% · Lazada 10% · Offline 0%) |
| **2. Quyết toán** | Đơn chuyển sang **Đã giao** | Bóc tách số **thực tế** sàn trả về: `fixedFee` (phí cố định) + `serviceFee` (phí dịch vụ) + `paymentFee` (phí thanh toán) − `platformSubsidy` (trợ giá) → ghi `actualPayout` (tiền thực nhận) |

Báo cáo dòng tiền **luôn ưu tiên số quyết toán**; đơn chưa quyết toán mới dùng số tạm tính. Hàm `mockSettlement()` trong `mockMarketplace.ts` mô phỏng dữ liệu đối soát — khi tích hợp API thật chỉ cần thay hàm này.

**Công thức:**
- Lợi nhuận gộp = Tổng doanh thu (đơn Đã giao) − Tổng giá vốn
- **Lợi nhuận thuần = Lợi nhuận gộp − Phí sàn − Tổng chi phí vận hành**
- Đơn lỗ = đơn Đã giao có (Doanh thu đơn − **Phí sàn** − Giá vốn đơn) ≤ 0
- Đơn chứa SKU chưa nhập giá vốn → gắn `warning: "Chưa nhập giá vốn"` (số liệu chưa đáng tin)

### Bóc tách dòng tiền 4 cột (trang Báo cáo dòng tiền)

Khu vực chỉ số đầu trang được cấu trúc thành 4 thẻ lớn, mỗi thẻ có danh sách chi tiết kèm % và **tooltip giải thích công thức** (hover vào icon ❓):

| Cột | Số lớn | Chi tiết bên dưới |
|---|---|---|
| **1. Tổng giá trị sản phẩm** | Doanh số gốc (chưa trừ gì) | Phí nền tảng · Phí tiếp thị liên kết · Voucher trợ giá của shop · Chênh lệch phí vận chuyển · Trợ giá từ sàn (khoản cộng lại) |
| **2. Doanh thu** | Sau khi trừ khoản sàn giữ lại | Hoàn thành (đã giải ngân) · Chờ xử lý (tạm tính) · Đã hủy (kèm % tỷ lệ hủy đơn) |
| **3. Chi phí** | Giá vốn + chi phí ngoài sàn | Giá vốn sản phẩm · Chi phí quảng cáo · Chi phí vận hành khác |
| **4. Lợi nhuận** | Đã trừ toàn bộ chi phí | Lợi nhuận thực tế (đơn đã quyết toán) · Lợi nhuận dự kiến (đơn đang chờ) — % là **biên lợi nhuận** |

Phạm vi tính: đơn Đã giao + Đang giao (không tính đơn đã hủy). Đơn đã quyết toán dùng phí **thực tế**, đơn đang đi đường dùng phí **tạm tính**.
Kiểm chứng: Cột 1 − Tổng khấu trừ = Cột 2 (số liệu khớp tuyệt đối).

**Bóc tách lý do đơn lỗ** (trang Cảnh báo đơn lỗ): mỗi đơn âm tiền có nhãn rõ nguyên nhân
- 🔴 **Lỗ do Giá vốn** — bán dưới giá vốn (sai từ khâu nhập hàng/định giá)
- 🟠 **Lỗ do Chi phí sàn** — bán trên giá vốn nhưng phí sàn/voucher ăn hết lãi

**Cấu hình Giá vốn** (`/finance/cost-prices`): lọc SKU theo sàn (Tất cả / Shopee / TikTok / Lazada / Offline), nhập giá vốn vào ô input — **tự động lưu khi rời ô (onBlur)** kèm toast xác nhận. SKU sàn lấy từ bảng liên kết `ProductMapping`; sản phẩm chưa liên kết sàn nào được xếp vào nhóm Offline.

**Bộ lọc nâng cao** (dành cho shop hàng nghìn SKU): ô tìm kiếm real-time theo tên sản phẩm / mã SKU / tên phân loại — **bỏ dấu tiếng Việt** (gõ "ao thun" ra "Áo thun") kèm nút ✕ xoá nhanh; dropdown lọc trạng thái giá vốn (Tất cả / Chưa nhập / Đã nhập); bộ đếm "Hiển thị X/Y SKU". Lọc chạy client-side nên kết quả hiện ngay khi đang gõ. Khi lọc "Chưa nhập giá vốn" mà không còn SKU nào thiếu → hiện màn hình chúc mừng thay cho bảng.

**Đồng bộ sản phẩm từ sàn:** nút **"Đồng bộ từ sàn"** (góc phải thanh lọc) gọi `POST /api/finance/sync-products` để quét danh mục sản phẩm (SKU, tên biến thể, giá bán, ảnh) từ mọi gian hàng đang ACTIVE rồi **upsert**:
- SKU sàn chưa có → tạo Product mới (giá vốn = 0 để chờ nhập) + tạo liên kết
- SKU sàn đã có → cập nhật tên hiển thị / ảnh
- **Không bao giờ ghi đè `costPrice`** (dữ liệu chủ shop tự nhập). Chạy lại nhiều lần không tạo bản ghi trùng.

Nhờ vậy chủ shop vừa đăng sản phẩm mới lên sàn là bấm quét về nhập giá vốn ngay, không cần chờ phát sinh đơn hàng.

**Chi phí vận hành** phân loại 2 chiều: `type` (FIXED cố định / VARIABLE biến đổi) và `category` (Mặt bằng, Nhân viên, Đóng gói, Quảng cáo, Khác). Chi phí **VARIABLE** còn có thể gắn vào 1 mã SKU cụ thể qua `appliedSku` (tiền Ads, book KOC…) — khi thêm chi phí chọn "Biến đổi" thì giao diện hiện thêm ô chọn SKU.

### 📦 Báo cáo Lời/Lỗ theo sản phẩm (SKU P&L)

Bảng nằm dưới lưới 4 cột ở `/finance/analytics`, cho biết mã nào là "gà đẻ trứng vàng", mã nào đang gánh lỗ.

Cột: Ảnh + Tên SKU · Đã bán · Doanh thu thuần · Giá vốn · **Phí sàn & ship** · **Chi phí marketing** · Lợi nhuận · Biên LN %. Sắp xếp **lợi nhuận giảm dần**, mã lãi cao nhất gắn 👑.

**Nguyên tắc phân bổ chi phí:**
| Loại chi phí | Cách xử lý |
|---|---|
| Giá vốn | Lấy trực tiếp từ `OrderItem.costPriceAtSale` (snapshot lúc bán) |
| Phí sàn & ship của đơn | **Phân bổ** cho từng SKU theo tỷ trọng doanh thu dòng hàng trong đơn |
| Chi phí **VARIABLE** có `appliedSku` | Cộng thẳng vào đúng SKU đó |
| Chi phí **FIXED** | **Không** phân bổ vào SKU — trừ vào lợi nhuận cuối cùng toàn shop |

Cuối bảng có phần đối chiếu: *Tổng LN các SKU − Chi phí cố định = Lợi nhuận cuối cùng của shop*. SKU đã bán mà chưa nhập giá vốn được gắn nhãn vàng cảnh báo (số liệu chưa đáng tin).

**Onboarding Guard:** mọi API dữ liệu (products, orders, dashboard, analytics, expenses, inventory, mappings) đi qua middleware `requireChannel` — nếu shop **chưa kết nối gian hàng nào** → trả `409 { code: "NO_CHANNEL" }`. Frontend bắt mã này để hiện màn hình Onboarding chặn toàn bộ cho đến khi kết nối ít nhất 1 kênh. `GET /api/auth/me` trả kèm `hasChannels`.
| POST | `/api/auth/staff` | Chủ shop tạo tài khoản Nhân viên (dùng chung dữ liệu shop) | 🔒 Chỉ Admin |

## 🔠 Quy chuẩn giao diện — Responsive Typography

Toàn bộ cỡ chữ của Hubsell được khai báo tập trung tại **`frontend/src/lib/typography.ts`**. Sửa 1 file này = đổi cỡ chữ toàn hệ thống.

| Hằng số | Dùng cho | Laptop | PC lớn (≥1536px) |
|---|---|---|---|
| `TEXT_BODY` | Số liệu / nội dung trong bảng | 14px | 16px |
| `TEXT_SUB` | Dòng phụ xếp chồng dưới số liệu | 11px | 13px |
| `TEXT_TABLE_HEAD` | Tiêu đề cột (semibold, giãn chữ) | 12px | 14px |
| `TEXT_CARD_TITLE` | Tiêu đề thẻ chỉ số (IN HOA) | 12px | 14px |
| `TEXT_BIG_NUMBER` | Số lớn trên dashboard (bold) | 20px | 24px |
| `CELL_PADDING` | Khoảng đệm ô bảng | `py-3` | `py-4` |

**Cách áp dụng — ở tầng component gốc, không rải class khắp nơi.** `ui/table.tsx` đã gắn sẵn `TEXT_TABLE_HEAD`/`TEXT_BODY`/`CELL_PADDING` vào `TableHead` và `TableCell`, nên **mọi bảng trong app tự động ăn theo**: Đơn hàng, Sản phẩm, Kênh bán, Nhân viên, Mapping, Chi phí vận hành, Cấu hình giá vốn, Đơn lỗ, Chênh lệch ship, SKU P&L. Tương tự với `ui/input.tsx`, `ui/native-select.tsx` (form + ô tìm SKU), `dashboard/stat-card.tsx`, `finance/breakdown-card.tsx`, `finance/hint-icon.tsx`, `finance/sku-combobox.tsx`.

⚠️ **Khi viết bảng mới: đừng đặt `text-sm`/`text-base` vào `TableCell`/`TableHead`** — class đặt tại chỗ sẽ lấn át quy chuẩn và làm bảng đó lệch cỡ so với phần còn lại.

Breakpoint dùng là **`2xl` (≥1536px)** chứ không phải `md` (≥768px): laptop phổ biến 1366–1440px đã vượt `md` từ lâu, nếu dùng `md` thì laptop sẽ nhảy lên 16px và mất đi độ gọn gàng mong muốn.

## 📦 Trung tâm Xử lý Đơn hàng (`/orders`)

Gom đơn từ mọi sàn về một màn hình để lọc, duyệt và in phiếu hàng loạt.

**6 tab theo vòng đời đơn** — Tất cả · Chờ xử lý · **Đã xử lý** · Đang giao · Đã giao thành công · Đơn hủy/Hoàn trả, mỗi tab kèm badge số lượng.

**Quy trình kho tách làm 2 bước** (enum `ShippingStatus`):
```
PENDING --[Xác nhận & chuẩn bị]--> PROCESSED --[Bàn giao]--> SHIPPING --> DELIVERED
                                       ↑ in phiếu ở bước này
```
Tách đôi vì thực tế shop gói hàng buổi sáng nhưng shipper chiều mới tới lấy — gộp một bước thì hàng còn trong kho đã bị hiển thị là đang trên đường giao.

**Lọc theo loại đơn** — *Đơn 1 sản phẩm* / *Đơn nhiều sản phẩm*, để kho gói đơn dễ trước, đơn khó sau. Dựa trên cột `Order.itemCount` lưu sẵn (Prisma không lọc được theo số lượng bản ghi con). Đơn cũ chưa ghi chi tiết dòng hàng có `itemCount = 0` nên **cố ý không rơi vào nhóm nào**.

⚠️ **In phiếu phải đánh dấu SAU khi cửa sổ in mở thành công.** `/bulk/labels` chỉ đọc, `/bulk/mark-printed` mới ghi. Gộp hai việc vào một endpoint là lúc trình duyệt chặn pop-up, đơn bị ghi "đã in" mà chẳng có tờ phiếu nào ra giấy — đơn rơi khỏi nhóm "Chưa in" nên kho bỏ sót, không có dấu hiệu nào để phát hiện ngoài việc thiếu hàng lúc giao.

**Chống in trùng & đóng gói lặp:** trong tab "Đã xử lý" có 3 bộ lọc con kèm số đếm — *Tất cả / Chưa in phiếu / Đã in phiếu*. In phiếu xong đơn tự rơi sang nhóm "Đã in" và bảng gắn nhãn kèm giờ in, nên người sau không in lại đơn người trước đang gói. In lại vẫn được nhưng **giữ nguyên mốc lần đầu** — cái shop cần biết là phiếu đã ra giấy từ lúc nào, không phải lần in gần nhất.

⚠️ **Thêm trạng thái mới phải rà lại `finance.ts`** — "Tiền chờ về" lọc theo `shippingStatus in [PENDING, PROCESSED, SHIPPING]`. Bỏ sót một trạng thái là cả nhóm đơn đó biến mất khỏi báo cáo dòng tiền mà không có dấu hiệu gì.

**Tìm kiếm & lọc** — ô tìm đa năng (mã đơn, tên khách, SĐT, mã vận đơn; SĐT tự bỏ dấu cách nên `0901 234 567` khớp `0901234567`) + lọc theo **Sàn** và **Đơn vị vận chuyển**.

**Xử lý hàng loạt** — tích chọn đơn → thanh nổi ở đáy màn hình:
- *Xác nhận chuẩn bị hàng loạt*: Chờ xử lý → Đang giao, ghi `packedAt`. Bỏ qua có chọn lọc kèm lý do từng đơn, không fail cả mẻ.
- *In phiếu giao hàng*: dựng phiếu A5, mỗi đơn một trang, bấm một lần in cả xấp (hoặc lưu PDF).

⚠️ **Hai giới hạn do chưa có tích hợp sàn thật:**
- Phiếu giao hàng là **do Hubsell tự dựng**, không phải vận đơn chính thức của Shopee/TikTok. Muốn phiếu chính chủ phải có API thật kèm quyền in vận đơn.
- "Xác nhận chuẩn bị" mới chỉ đổi trạng thái trong Hubsell, **chưa gọi ngược lên sàn**. Chỗ nối API thật đã đánh dấu sẵn trong `POST /api/orders/bulk/confirm`.

**Bảng đơn — 4 lớp nền phân biệt:** trắng → sọc `muted/40` → rê chuột `primary/10` → đang chọn `primary/15` + vạch màu 3px bên trái.

⚠️ **Đừng dùng `bg-accent` làm màu hover** trong dự án này: token `accent` trùng đúng giá trị với `muted` (cùng `oklch 0.97`), nên hover sẽ gần như vô hình trên dòng sọc.

**Phân trang:** dropdown 20 / 50 / 100 đơn/trang ở chân bảng (trần backend 100). Khối phân trang luôn hiện kể cả khi chỉ có một trang, nếu không thì không có chỗ nào đổi cỡ trang.

**Cụm sản phẩm:** đơn nhiều SKU chỉ hiện dòng đầu kèm thumbnail, phần còn lại gấp sau nút "+N sản phẩm khác" để chiều cao các dòng gần bằng nhau.

### 🔄 Hàng hoàn về kho (RTS)

**Phân vai giữa hai trang — đừng làm lẫn:**
| Trang | Vai trò |
|---|---|
| `/warehouse/returns` (Quản lý Kho) | **Mọi hành động vật lý**: quét mã, xác nhận nhận hàng, cộng kho, đối soát quá hạn |
| `/orders` → tab Hủy/Hoàn | **Chỉ theo dõi**: badge trạng thái + bộ lọc, không thao tác |

**Đối soát quá hạn:** đếm ngày từ `Order.returnRequestedAt` (mốc sàn báo hoàn). Dưới 7 ngày = bình thường · 7–13 ngày = cảnh báo · **từ 14 ngày = "Chưa về tay"**, dòng nhuộm nền hồng, làm căn cứ khiếu nại bưu cục.

⚠️ **Đơn không có `returnRequestedAt` hiển thị "Chưa rõ", không bị tính quá hạn.** Cố ý không lấy `createdAt` lấp chỗ trống — số ngày chờ là căn cứ đòi tiền bưu cục, bịa mốc ra là đi khiếu nại bằng số liệu sai.

⚠️ **`routes/warehouse.ts` KHÔNG có endpoint cộng kho** và không được thêm. Nhận hàng vẫn gọi `POST /api/orders/:id/return`.

**Đồng bộ từ sàn:** `POST /api/warehouse/returns/sync` hiện là **bản giả lập** (chưa có API sàn thật) — bốc vài đơn đang giao và rải mốc 2/9/17 ngày. Khi có tích hợp thật chỉ cần thay ruột hàm.

#### Chi tiết thao tác

**Quét mã nhận hoàn:** ô nhập tự lấy tiêu điểm, bắn máy quét barcode/2D vào là tra ngay. Máy quét hoạt động như bàn phím (gõ chuỗi + Enter) nên **một ô input xử lý được cả mã sọc lẫn mã QR**, không cần thư viện. Nút *Bật camera quét mã* dùng `html5-qrcode` (import động, chỉ tải khi bấm) cho webcam/điện thoại — cần **HTTPS hoặc localhost**, mở qua IP nội bộ bằng http:// sẽ bị trình duyệt chặn.

**Hai nhánh xử lý:**
| Chọn | Tồn kho | Trạng thái |
|---|---|---|
| Hàng nguyên vẹn | **Cộng ngược** từng SKU + ghi InventoryLog | `RECEIVED_INTACT` |
| Hư hỏng / Mất / Tráo | **Không cộng** | `DAMAGED` → badge "Chờ khiếu nại sàn" |

⚠️⚠️ **`Order.stockRestoredAt` là chốt chặn cộng kho trùng — đừng bỏ qua khi viết luồng mới đụng tới tồn kho.** Huỷ đơn đã cộng kho sẵn; nếu luồng nhận hoàn cộng thêm lần nữa thì kho phình ảo, shop bán ra hàng không có thật. Mọi đường cộng kho phải kiểm tra mốc này trước.

⚠️ **`lookup` không đoán bừa:** mã khớp nhiều đơn thì trả `409` kèm danh sách, không tự lấy đơn đầu tiên — quét nhầm là cộng kho nhầm sản phẩm.

⚠️ **Chưa có lọc theo Kho hàng** — Hubsell chưa có khái niệm kho (mỗi sản phẩm một con số tồn duy nhất). Sẽ làm thành module đa kho riêng để không chồng chéo logic tồn kho.

## 💵 Nhập giá vốn hàng loạt (`/finance/cost-prices`)

| Tính năng | Cách dùng |
|---|---|
| **Tự định dạng số** | Gõ `52000` hiện ngay `52.000`. Dùng `<CurrencyInput>` — **đừng dùng `<input type="number">` cho tiền**: không hiện được dấu phân tách, lại dính lỗi lăn chuột làm đổi giá trị rồi tự lưu. |
| **Xuất Excel** | Xuất đúng những dòng **đang lọc**. Mẹo: lọc "Chưa nhập giá vốn" rồi xuất → file chỉ chứa mã còn thiếu. |
| **Nhập Excel** | Đọc 2 cột `Mã SKU` + `Giá vốn`. Khớp mã nội bộ trước, mã sàn sau. Tự bỏ dấu chấm người dùng gõ (`1.234.000` → `1234000`). Dòng lỗi báo rõ số dòng, không chặn dòng hợp lệ. |
| **Bảng phân cấp** | Mỗi mẫu hàng gộp thành 1 dòng cha có mũi tên xổ ra các phân loại con (size M/L/XL). Dòng cha có ô "Nhập cho tất cả" — gõ một lần, áp cho toàn bộ phân loại. |

⚠️ **Giá vốn lưu trên `Product.costPrice`, không phải trên mapping.** Nhiều SKU sàn cùng trỏ về một sản phẩm gốc thì đã dùng chung một giá vốn — sửa dòng này là dòng kia đổi theo. Nút "áp cho mọi phân loại" vì thế chỉ hiện khi mẫu hàng trải trên **từ 2 sản phẩm gốc trở lên**.

**Phân cấp chỉ ở tầng hiển thị.** Giá vốn vẫn lưu riêng cho từng SKU con, nên SKU P&L và Cảnh báo đơn lỗ vẫn lấy đúng số của từng phân loại — không gộp, không tính trung bình. Mẫu chỉ có một mã thì hiển thị phẳng như cũ, không bọc thêm tầng.

⚠️ **Trang này gọi `load()` sau mỗi lần lưu.** Đừng tháo bảng ra khi `loading` — component mất trạng thái thì mọi nhóm đang xổ sẽ tự thu lại, gõ giá xong là nhóm sập xuống. Dùng `<Refreshing>` để giữ bảng và chỉ làm mờ.

⚠️ **Không có trường "mẫu gốc" trong CSDL.** Size M/L/XL là các sản phẩm riêng biệt, phân loại nằm trong *tên*. `lib/variant-group.ts` suy ra mẫu gốc bằng cách cắt đuôi tên (`"Áo thun nam size M"` → `"Áo thun nam"`). Đây là **suy đoán**, nên nó chỉ dùng để gợi ý và luôn bắt xác nhận trước khi ghi — đoán sai thì cùng lắm nút không hiện, không bao giờ âm thầm sửa nhầm.

## 📅 Bộ lọc khoảng thời gian `<DateRangePicker>`

Mọi trang báo cáo đều có bộ chọn ngày ở góc phải trên, cạnh nút Làm mới. Dùng chung một component và một quy ước query param, nên module đối soát mới sau này chỉ cần cắm vào là chạy.

**Quy ước API:** mọi endpoint báo cáo nhận `?from=yyyy-mm-dd&to=yyyy-mm-dd`. Backend dùng `parseDateRange(req.query)` (`backend/src/date-range.ts`) — trả `undefined` khi không lọc, truyền thẳng vào Prisma `where: { createdAt: range }`. Đơn hàng lọc theo `createdAt`, chi phí theo `expenseDate`.

**Ba cái bẫy đã xử lý sẵn** (đừng tự viết lại logic ngày):
- `to` phải lấy đến **23:59:59.999**, cắt ở 00:00 là mất trọn ngày cuối.
- Frontend dùng `toDateKey()` theo lịch địa phương, **không dùng `toISOString()`** — ở múi giờ Việt Nam (UTC+7) sẽ lùi mất một ngày.
- Ngày không tồn tại (`2026-02-31`) bị chặn, vì JS tự nhảy sang tháng sau thay vì báo lỗi.

**Thêm bộ lọc cho trang mới:**
```tsx
const [range, setRange] = useState<DateRange>(defaultRange);   // mặc định 30 ngày qua
<DateRangePicker value={range} onChange={setRange} disabled={loading} />
<Refreshing active={loading}>…khối số liệu…</Refreshing>
```
Nhớ thêm `range` vào mảng phụ thuộc của `useCallback` để đổi ngày là tự tải lại.

`<Refreshing>` làm mờ vùng số liệu trong lúc tính lại, nhưng **chỉ khi tải quá 150ms** — máy chủ nội bộ trả lời ~100ms, mờ ngay lập tức sẽ thành cái nháy khó chịu. Giữ số cũ mờ đi thay vì dựng khung xương (skeleton) để mắt không mất điểm bám.

⚠️ Khối **"Hiện trạng shop"** trên trang Tổng quan cố ý **không** theo bộ lọc — "Sản phẩm: 17" hay "Kênh bán: 4" là trạng thái hiện tại, cắt theo khoảng thời gian sẽ vô nghĩa. Giao diện có ghi rõ điều này để không gây hiểu nhầm.

## 🎴 Quy chuẩn giao diện — Thẻ chỉ số `<DashboardCard>`

Mọi khối số liệu trên mọi trang đều dùng chung **`frontend/src/components/dashboard/dashboard-card.tsx`**. Không viết thẻ số liệu bằng tay nữa.

### ⚠️ Triết lý: sạch sẽ trước, trang trí sau

Đây là màn hình tài chính, không phải trang marketing. Chủ shop nhìn vào để ra quyết định, nên **ưu tiên khoảng trống và con số rõ ràng**.

> **KHÔNG dùng thanh ngang (progress bar) ở các dòng chỉ số.** Đã thử và loại bỏ: một rừng vạch màu dưới mỗi dòng làm mắt bị nhiễu và hạ thấp tính chuyên nghiệp của ERP. Tỷ lệ % hiển thị bằng **text thuần** là đủ. Component không còn prop nào để chèn thanh ngang vào thẻ.

**Phân cấp chỉ bằng 3 công cụ:**

1. **Màu chữ của số** — nghiêm ngặt 3 trạng thái, không tô màu trang trí:
   | Loại số liệu | Màu |
   |---|---|
   | Tiền vào / lãi | xanh lá `emerald-600` |
   | Tiền ra / chi phí / lỗ | đỏ sắc nét `rose-600` (không dùng 700 sẫm xỉn) |
   | Trung tính (số lượng, tham chiếu) | đen/xám mặc định |
2. **Khối nền của icon** — được phép nhiều màu (44px→48px, bo góc, nền đặc) để nhận diện loại chỉ số bằng liếc mắt.
3. **Nền + viền của cả thẻ** (`featured`) — **chỉ** cho khối Lợi nhuận và thẻ cảnh báo tiền bạc cốt lõi. Lãi → `bg-emerald-50/40`; lỗ → `bg-rose-50/40` + viền đỏ nhạt. Dùng tràn lan sẽ mất tác dụng cảnh báo, nên component chặn sẵn: chỉ tone `positive`/`negative` mới phủ được nền.

| Trang | Thẻ được phủ nền |
|---|---|
| Tổng quan | Lợi nhuận thuần |
| Báo cáo dòng tiền | Lợi nhuận |
| Cảnh báo đơn lỗ | Tổng tiền lỗ |
| Đối soát phí ship | Tổng tiền cần đòi lại |
| Chi phí vận hành | *(không có — không phải khối lợi nhuận)* |

**Sắc thái (`tone`) thay cho màu tự do** — `neutral` · `info` · `positive` · `negative` · `warning` · `accent`. Dùng `toneBySign(value)` cho chỉ số có thể lãi hoặc lỗ.

Số tổng dùng `TEXT_HERO_NUMBER` (24px→30px, extrabold). Các lớp bọc tiện dụng: `<StatCard>` cho thẻ chỉ có tiêu đề + số; `<BreakdownCard>` cho thẻ có bóc tách chi tiết từ API.

## Phân quyền (RBAC)

| Vai trò | Được phép | Bị chặn |
|---|---|---|
| **ADMIN** (Chủ shop) | Toàn quyền tất cả tính năng | — |
| **STAFF** (Nhân viên) | Đơn hàng, Sản phẩm & Kho, xem danh sách kênh (không thấy token) | Tổng quan/Báo cáo tài chính, Cấu hình kênh, Mapping, Nhân viên — hiện "Bạn không có quyền truy cập" (chặn cả UI lẫn API 403) |

**Phân quyền theo Gian hàng (Multi-store):** Admin có thể giới hạn mỗi STAFF chỉ được xem & xử lý đơn của một số kênh nhất định (bảng `StaffChannel`). Không gán kênh nào = xem tất cả (mặc định). Nhân viên bị giới hạn: danh sách kênh + đơn hàng chỉ hiện kênh được gán; sửa đơn của kênh ngoài phạm vi → `403`.

Đăng ký tài khoản mới = ADMIN của shop riêng. Admin tạo nhân viên qua `POST /api/auth/staff`.

Mọi API dữ liệu đều lọc theo user đang đăng nhập (mỗi tài khoản chỉ thấy dữ liệu của mình).

## Chạy dự án

**Cách dễ nhất:** bấm đúp `start-backend.bat`, rồi `start-frontend.bat`, sau đó mở trình duyệt vào `http://localhost:3000`.

Tài khoản dùng thử:
- Chủ shop (Admin): `admin@hubsell.vn` / `hubsell123`
- Nhân viên (Staff): `staff@hubsell.vn` / `staff123`

**Bằng dòng lệnh:**

```bash
# Backend
cd backend
npm install
npx prisma migrate dev   # tạo/cập nhật bảng trong DB
npm run db:seed          # (tuỳ chọn) nạp dữ liệu mẫu — XOÁ dữ liệu cũ!
npm run dev              # http://localhost:4000

# Frontend
cd frontend
npm install
npm run dev              # http://localhost:3000
```

## 🚀 Hướng nâng cấp tiếp theo (sau v1.0)

Các tính năng có thể bổ sung ở những giai đoạn tới:

- **Tích hợp API sàn thật** (Shopee / TikTok Shop / Lazada) thay cho lớp giả lập trong `backend/src/mockMarketplace.ts`.
- **Sửa / Xoá sản phẩm** trực tiếp trên giao diện; **trang Lịch sử kho** xem toàn bộ `InventoryLog`.
- **UI Quản lý nhân viên** (chủ shop thêm/khoá tài khoản Staff qua giao diện thay vì API).
- **Xuất báo cáo** (Excel/PDF), lọc theo khoảng thời gian.
- **Triển khai production**: đổi `JWT_SECRET` và mật khẩu database, đưa lên máy chủ/cloud cho nhiều người dùng.


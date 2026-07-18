# Hubsell — Phần mềm quản lý bán hàng đa kênh

Nền tảng quản lý bán hàng đa kênh (Shopee, Lazada, TikTok, Offline) — mô hình tương tự Salework.

> ## 🏆 Phiên bản **v1.0 — MVP hoàn chỉnh** (18/07/2026)
>
> Dự án đã **hoàn thành xuất sắc trọn vẹn 4 giai đoạn cốt lõi**, tạo nên một sản phẩm MVP (Minimum Viable Product) chạy được end-to-end: từ đăng nhập bảo mật, quản lý kho, kết nối sàn, đồng bộ đơn tự động, đến báo cáo tài chính có biểu đồ và phân quyền nhân viên — khoác trên giao diện SaaS hiện đại (Sidebar dọc).
>
> Toàn bộ mã nguồn đã được kiểm thử end-to-end trên trình duyệt và đóng gói tại commit `hubsell-v1.0-mvp-completed`.

## Tiến độ các giai đoạn — ✅ HOÀN THÀNH 4/4

| Giai đoạn | Nội dung | Trạng thái |
|---|---|---|
| 1 | Nền móng: Monorepo, Next.js + Express + Prisma + PostgreSQL, Dashboard | ✅ Xong |
| 2 | Đăng nhập/Đăng ký (JWT + bcrypt), Quản lý Sản phẩm & Kho hàng thủ công | ✅ Xong |
| 3 | Đồng bộ đơn hàng đa kênh & Mapping sản phẩm (webhook giả lập tự trừ kho) | ✅ Xong |
| 4 | Quản lý đơn hàng tập trung, Báo cáo tài chính (Recharts), Phân quyền Admin/Staff | ✅ Xong |
| ✨ | Tái cấu trúc giao diện chuẩn SaaS (Sidebar dọc + Header mỏng + Card đổ bóng) | ✅ Xong |

## Công nghệ

- **Frontend:** Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind CSS v4 · shadcn/ui (style base-nova / Base UI) · TanStack React Table · react-hook-form + zod · sonner (toast) · Recharts (biểu đồ)
- **Backend:** Node.js · Express 4 · TypeScript (tsx watch) · Prisma ORM 6 · JWT (jsonwebtoken) · bcryptjs
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
│       │   ├── products/page.tsx   # Quản lý sản phẩm & kho
│       │   ├── channels/page.tsx   # Cấu hình kết nối gian hàng + giả lập đơn — chỉ Admin
│       │   └── mappings/page.tsx   # Liên kết sản phẩm sàn ↔ kho gốc — chỉ Admin
│       ├── components/
│       │   ├── app-shell.tsx       # Khung chung: header + menu + đăng xuất
│       │   ├── dashboard/          # Thẻ thống kê
│       │   ├── products/           # Modal thêm SP, dialog nhập/xuất kho
│       │   └── ui/                 # Component shadcn/ui
│       └── lib/
│           ├── api.ts              # Lớp gọi API + quản lý token đăng nhập
│           └── format.ts           # Định dạng tiền VND, số, ngày giờ
│
├── backend/                        # Máy chủ API — cổng 4000
│   ├── prisma/
│   │   ├── schema.prisma           # 6 bảng: User (role + ownerId), Channel, Product, Order, InventoryLog (orderId), ProductMapping
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
| GET | `/api/analytics` | Doanh thu / Giá vốn / Lợi nhuận gộp (đơn Đã giao), doanh thu theo ngày, tỷ lệ đơn theo kênh | 🔒 Chỉ Admin |
| POST | `/api/auth/staff` | Chủ shop tạo tài khoản Nhân viên (dùng chung dữ liệu shop) | 🔒 Chỉ Admin |

## Phân quyền (RBAC)

| Vai trò | Được phép | Bị chặn |
|---|---|---|
| **ADMIN** (Chủ shop) | Toàn quyền tất cả tính năng | — |
| **STAFF** (Nhân viên) | Đơn hàng, Sản phẩm & Kho, xem danh sách kênh (không thấy token) | Tổng quan/Báo cáo tài chính, Cấu hình kênh, Mapping — hiện "Bạn không có quyền truy cập" (chặn cả UI lẫn API 403) |

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


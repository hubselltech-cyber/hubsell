# App mobile — nhân viên thấy đúng những gì đã được tick quyền (23/11/2026)

> Trạng thái: **ĐÃ TỚI KHÁCH bằng OTA 23/11/2026** (anh: "Duyệt, commit + OTA") — commit `c3d6ec3a` trên master (đã push 23/11),
> OTA kênh production cho cả runtime 1.5.0 và 1.4.3 (mục 6). CHƯA thử trên máy thật.
> Không đổi backend, không thêm thư viện gốc.

## 1. Anh báo gì

23/11 09:14, anh tạo nhân viên "Nguyệt Hubsell" (`admin/nguyet`) trên web, tick đủ 8 nhóm quyền (Tổng quan, Đơn hàng, Quản lý Kho,
Quản lý Tài chính, Trợ lý quảng cáo, Trợ lý vận hành, KOC, Hóa đơn & Thuế). Nhân viên đăng nhập app chỉ thấy **Kho · [QR] · Cấu hình**.
Anh: "Nhân viên anh cấp full quyền nhưng vào thì lại không đủ."

## 2. Gốc

Không phải lỗi lưu quyền, không phải lỗi máy chủ. App chia màn theo **VAI**, không theo quyền:

- `homePathFor()` (`hubsell-mobile/src/lib/permissions.ts`): `role === "ADMIN"` → khu `(admin)` 5 tab; mọi nhân viên → khu
  `(warehouse)` cố định Kho · [QR] · Cấu hình.
- `(admin)/_layout.tsx` đá mọi tài khoản không phải chủ shop ra ngoài.
- Đây là thiết kế 04/10 ("khu nhân viên cùng bố cục, bớt tài chính") lúc nhân viên trên app mới chỉ là người kho. Từ đó app có thêm
  Đơn hàng, Tài chính, Quảng cáo, Giá vốn, Chi phí vận hành nhưng cổng chia vai không đổi.
- Máy chủ thì đã gác đúng theo quyền từ 10/08 (`requirePermission` ở `backend/src/app.ts`, luật "tick gì thấy nấy") — nhân viên đủ
  quyền gọi được mọi API mà app của chủ shop gọi, trừ nhóm chỉ-chủ-shop ở mục 4.

## 3. Sửa: một khu, hiện theo quyền

Một nguồn duy nhất `accessOf(user)` (`lib/permissions.ts`) trả về người này thấy gì; thanh tab, cổng từng màn, từng khối trong màn
đều đọc từ đó. Khu `(warehouse)` bỏ hẳn; chủ shop và nhân viên dùng chung khu `(admin)` (giữ tên nhóm vì đường dẫn thông báo đẩy và
nhánh thử video trỏ vào).

| Thấy gì trên app | Quyền cần (đúng cửa API) |
|---|---|
| Tab **Trang chủ** | có ít nhất một trong ba trang dưới |
| — trang Tổng quan | Tổng quan (`dashboard`) |
| — trang Tài chính | Báo cáo dòng tiền (`finance.analytics`) |
| — trang Quảng cáo, chip từng sàn | Quảng cáo Shopee / Lazada / TikTok (`ads.*`) — chỉ hiện chip sàn được cấp |
| Tab **Đơn hàng** + nút **[QR]** + Đóng gói + Xử lý đơn | Đơn hàng (`orders`) |
| Tab **Kho** → Tồn kho | Tổng kho (`warehouse.products`) hoặc Đơn hàng |
| Tab **Kho** → Đơn hoàn + quét nhận hoàn | Đối soát đơn hoàn (`warehouse.returns`) |
| Ô Giá vốn ở Tổng quan + màn Giá vốn | Cấu hình Giá vốn (`finance.cost-prices`) |
| Ô Chi phí vận hành + màn Chi phí vận hành | Thu chi vận hành (`finance.expenses`) |
| Tab **Cấu hình** | ai cũng có |

Trong trang Tổng quan, từng khối theo quyền của API nuôi nó — thiếu quyền thì **không gọi** API đó và khối ẩn (trước đây một lời gọi
403 đẩy cả trang vào ô lỗi): khối tiền (Kết quả hôm nay + thẻ Chi phí) cần Báo cáo dòng tiền; thẻ đơn hoàn cần Đối soát đơn hoàn.
Số đơn, phễu vận hành, tỷ trọng kênh có với mọi người có quyền Tổng quan (giống trang Tổng quan web của nhân viên).

Màn mở đầu sau đăng nhập = tab đầu tiên người đó có (Trang chủ → Đơn hàng → Kho). Không có tab nào (chỉ được cấp KOC, Hóa đơn & Thuế,
Trợ lý vận hành… — các mục app chưa có) → màn "Tài khoản chưa có quyền dùng app", lời đã viết lại cho đúng.

Mỗi màn tự gác lại bằng `components/RequireAccess.tsx` (thanh tab chỉ giấu, cổng này chặn lối vòng).

**Nút QR luôn nằm chính giữa** dù số tab hai bên lệch nhau (`AppTabBar`: hai nửa trái / phải rộng bằng nhau, mỗi nửa tự chia đều).
Chủ shop 2 + 2 → từng ô rộng y như trước. Nhân viên kho: Đơn hàng · [QR] · Kho · Cấu hình, QR vẫn giữa (đo 320 / 375 / 430).

**Quyền đổi giữa phiên:** app đọc lại `/me` mỗi lần đưa từ nền lên (cách nhau ≥ 30 giây, `AuthContext`). Chủ shop tick thêm / rút
quyền trên web → nhân viên mở lại app là thanh tab đổi theo, không phải đăng xuất. Trước đây chỉ đọc lại khi mở app từ đầu.

## 4. Việc vẫn chỉ chủ shop có (không phải lỗi)

Máy chủ gác `adminOnly`, nhân viên đủ quyền vẫn không có: chuông + tin đẩy (`/api/notifications`), Trợ lý Hubsell (`/api/assistant`),
nối / gỡ gian hàng (`/api/channels` phần ghi), gói dịch vụ. Trên app: nhân viên không thấy chuông, không thấy quả cầu Trợ lý, không
thấy ô Gian hàng ở Tổng quan, không thấy mục Thông báo và Gói dịch vụ ở Cấu hình.

## 5. Đã kiểm

- `npx tsc --noEmit` sạch; eslint các tệp đã sửa không tăng lỗi nào so với bản cũ.
- `permissions.test.ts` 7 ca (bảng chéo quyền × thanh tab × màn mở đầu): `npx tsx --test ../hubsell-mobile/src/lib/permissions.test.ts`
  chạy từ `backend/`.
- Giả lập web + backend local, 8 tài khoản nhân viên tạo qua đúng `POST /api/staff`:

| Tài khoản thử | Thanh tab | Ghi chú |
|---|---|---|
| đủ 20 lá quyền | Trang chủ · Đơn hàng · [QR] · Kho · Cấu hình | 3 trang Trang chủ, mọi API 200; thiếu đúng chuông, Trợ lý, ô Gian hàng |
| mẫu "Nhân viên kho" | Đơn hàng · [QR] · Kho · Cấu hình | vào thẳng Đơn hàng |
| mẫu "Kế toán" | Trang chủ · Cấu hình | Tổng quan + Tài chính, ô Giá vốn + Chi phí vận hành |
| mẫu "Nhân viên vận hành" | đủ 5 tab | Trang chủ chỉ có Tổng quan, không khối tiền, không gọi API tài chính |
| chỉ Đối soát đơn hoàn | Kho · Cấu hình | gõ thẳng `/home`, `/orders`, `/scan`, `/cost-prices`, `/expenses` đều bị đưa về Kho |
| chỉ Quảng cáo TikTok | Trang chủ · Cấu hình | chỉ trang Quảng cáo, chỉ chip TikTok |
| chỉ Báo cáo dòng tiền | Trang chủ · Cấu hình | trang Tài chính: 4 thẻ + bảng tiền theo gian (xem mục 7) |
| chỉ KOC | — | màn "chưa có quyền" |
| chủ shop (đăng nhập bằng form) | 5 tab như cũ | chuông, Trợ lý, 3 ô Thiết lập không đổi |

- Soi 320 / 375 / 430, nền sáng + tối: không tràn ngang.
- **CHƯA kiểm:** máy thật iOS / Android (Expo Go không còn chạy app); phím Back của Android với nhân viên không có Trang chủ (đã xếp tab
  được thấy lên đầu navigator để Back về đúng tab của họ, nhưng chỉ suy từ tài liệu, chưa bấm thử); vuốt ngang Trang chủ bằng
  `PagerView` khi chỉ có 1–2 trang (giả lập web dùng lối bấm).

## 6. Phát hành — ĐÃ ĐẨY OTA 23/11/2026 (kênh production)

| Bản khách | Dựng từ | Update group |
|---|---|---|
| runtime **1.5.0** | master `c3d6ec3a` | `8e004117-df9d-43c1-bc6b-deede16f387d` |
| runtime **1.4.3** | nhánh local `ota/1.4.3-ten-khong-cat` `19157be9` (cherry-pick `c3d6ec3a`, gộp sạch) | `69e3fbda-9352-4ba0-ae8d-2585664af173` |

- Bản 1.4.3: trước khi đẩy đã kiểm kiểu sạch, `permissions.test.ts` 7 / 7 và chạy giả lập web từ chính nhánh đó (đủ quyền 5 tab,
  nhân viên kho 4 tab, chỉ đơn hoàn bị đưa về Kho, không lời gọi nào lỗi). KHÔNG thử kênh preview trên máy thật (không có máy mang
  bản preview) — khác với điều em nói lúc trình anh.
- Máy nhận khi tắt hẳn app rồi mở lại (có thể phải 2 lần); màn Cấu hình hiện "· cập nhật 23/11 …" cạnh số phiên bản là đã nhận.
- Rút lại nếu cần: `eas update:republish` nhóm trước đó — 1.4.3: `949a279b-e5ab-4734-994d-d767e57b0966`; 1.5.0 chưa có OTA nào
  trước bản này (rút = đẩy lại bản dựng từ commit `4294601b`).
- Lệnh đẩy: `node scripts/ota-update.mjs "<lời nhắn>"` trong `hubsell-mobile` (master → 1.5.0); với 1.4.3 thì
  `git worktree add <thư mục tạm> ota/1.4.3-ten-khong-cat` → cherry-pick → `npm ci` → cùng lệnh đó trong worktree → gỡ worktree.
- Hệ quả cho khách đang dùng, cần anh biết trước khi đẩy: nhân viên có quyền **Đơn hàng** của MỌI shop sẽ thấy thêm tab Đơn hàng (danh
  sách đơn, Xử lý đơn, In phiếu, trả lời khách xin hủy) — các việc họ vốn làm được trên web, và số tiền trong đó họ đã xem được qua nút QR.
  Nhân viên có quyền Tổng quan / Báo cáo dòng tiền / Quảng cáo sẽ thấy tab Trang chủ. Nhân viên chỉ có quyền kho: không đổi gì.
- Tài liệu video đóng hàng mục 17.1 / 17.2 (cách A: thêm tab Đơn hàng cho nhân viên, có rào theo chủ thí điểm; câu C3 về vị trí nút QR)
  viết trên tiền đề "nhân viên không có tab Đơn hàng" — tiền đề đó hết đúng sau thay đổi này: tab Đơn hàng của nhân viên theo quyền
  `orders`, không rào theo thí điểm; nút QR đã luôn ở giữa. Phần quay video vẫn nguyên rào riêng của nó.

## 7. Điểm lệch còn lại (chưa làm, nêu để anh biết)

1. **Chỉ có Báo cáo dòng tiền, không có Tổng quan:** trang Tài chính thiếu hai khối "Bóc tách dòng tiền" + "Cơ cấu chi phí" vì hai
   khối này đọc `/api/analytics`, máy chủ gác bằng quyền Tổng quan. Muốn đủ thì nới cửa đó cho cả `finance.analytics` (một dòng ở
   `app.ts`, cần deploy). Mẫu "Kế toán" có sẵn cả hai quyền nên không gặp.
2. **Chỉ có Cấu hình Giá vốn / Thu chi vận hành** (không Tổng quan): app chưa có lối vào hai màn đó ngoài ô ở Tổng quan → ra màn
   "chưa có quyền".
3. **Lãi/Lỗ Thực Hiện, Kiểm toán phí sàn, Đối soát phí ship, Trợ lý vận hành, KOC, Hóa đơn & Thuế:** app chưa có màn — tick quyền
   này không thêm gì trên app (chủ shop cũng không có).
4. **Thông báo đẩy cho nhân viên:** máy chủ chỉ gửi cho chủ shop.
5. Dòng tên ở Cấu hình / Tài khoản của nhân viên trước đây trống (" · Nhân viên") vì `/me` không kèm tên đăng nhập của chủ → nay hiện
   tên đăng nhập riêng của nhân viên (`nguyet · Nhân viên`), chưa phải dạng đủ `admin/nguyet`.

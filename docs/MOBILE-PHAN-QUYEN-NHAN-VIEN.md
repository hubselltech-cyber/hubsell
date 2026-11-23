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
4. **Chuông + thông báo đẩy cho nhân viên:** máy chủ chỉ mở cho chủ shop — anh báo 23/11, hướng làm ở mục 8.
5. Dòng tên ở Cấu hình / Tài khoản của nhân viên trước đây trống (" · Nhân viên") vì `/me` không kèm tên đăng nhập của chủ → nay hiện
   tên đăng nhập riêng của nhân viên (`nguyet · Nhân viên`), chưa phải dạng đủ `admin/nguyet`.

## 8. Chuông + thông báo đẩy cho nhân viên (anh báo 23/11 sau khi xác nhận "Đã thấy đủ") — đề xuất; anh duyệt "làm lát 1" → mục 9

Anh: "của khách hàng đang không nhận được chuông thông báo, không có nút chuông thông báo."

**Hiện trạng (đã đọc mã):**
- `backend/src/app.ts`: `/api/notifications` gác `adminOnly`; `notificationStream` (chuông web) trả 401 cho vai khác ADMIN.
- `services/push.ts` `sendPushToOwner`: chỉ gửi máy có `userId = ownerId` (máy của chính chủ shop).
- Web `app-shell.tsx`: chuông chỉ vẽ khi `isAdmin(user)`. → nhân viên không có chuông ở CẢ web lẫn app; không phải do bản OTA 23/11.
- Tài khoản chủ shop không đổi: `(admin)/home.tsx` + `lib/permissions.ts` ở master và nhánh 1.4.3 giống hệt nhau.
- Bảng `notifications`: mỗi dòng thuộc chủ shop, KHÔNG có cột gian hàng, KHÔNG có cột nhóm, một cột `readAt` dùng chung.
  Nhóm (22 mục, 6 nhóm) suy từ `type` bằng hàm `categoryOf` lúc chạy. Cài đặt bật / tắt nhóm lưu theo chủ shop.

**Vì sao không phải sửa một dòng:** mở cổng cho nhân viên như hiện trạng thì nhân viên chỉ có quyền Kho cũng đọc được "Báo cáo
tuần" (doanh thu, lãi), "Gói dịch vụ, thanh toán"; nhân viên bị giới hạn gian đọc được thông báo của gian khác.

**Hướng làm (em đề xuất):**

| Nhóm thông báo | Nhân viên nhận khi có quyền |
|---|---|
| Đơn hàng (đơn mới, hỏa tốc, xin hủy, giao hụt, tự chuẩn bị hàng) | Đơn hàng |
| Hoàn hàng | Đối soát đơn hoàn hoặc Đơn hàng |
| Báo cáo tuần, đơn lỗ / sai phí | Báo cáo dòng tiền |
| Hóa đơn điện tử, hạn kê khai thuế | Hóa đơn & Thuế |
| Quảng cáo (5 mục) | Trợ lý quảng cáo |
| Hết hàng, sắp hết hàng | Tổng kho |
| Mẫu KOC quá hạn | KOC |
| Mất kết nối gian, đồng bộ dừng, gói dịch vụ, hệ thống | chỉ chủ shop |

- Lát 1 (máy chủ, có migration nhỏ): thêm cột `category` + `channelId` vào `notifications` (ghi lúc `notify`), cổng theo quyền thay
  `adminOnly`, danh sách + số chưa đọc lọc theo nhóm được phép và gian được giao, tin đẩy gửi thêm máy nhân viên theo cùng luật.
- Lát 2 (app): bật chuông + đăng ký máy nhận tin đẩy cho nhân viên; đường dẫn trong tin dẫn tới đúng màn họ có quyền. Đi OTA.
- Lát 3 (web): vẽ chuông cho nhân viên.

**Ba điểm anh phải chốt:**
1. **"Đã đọc" chung hay riêng từng người.** Em nghiêng CHUNG cả shop ở lát đầu (như hộp thư chung: nhân viên mở "khách xin hủy" là
   chấm đỏ của chủ shop cũng tắt) — không thêm bảng. Riêng từng người thì thêm một bảng đánh dấu đã đọc, làm sau nếu khách kêu.
2. **Nhân viên có tự tắt nhóm thông báo không.** Em nghiêng KHÔNG ở lát đầu: nhân viên theo cài đặt của chủ shop.
3. **Thông báo cũ (trước ngày lên) không có cột gian** → nhân viên bị giới hạn gian chỉ thấy thông báo từ ngày lên trở đi; nhân viên
   được giao đủ gian thấy cả cũ.

## 9. Lát 1 (máy chủ) — LÊN PROD 23/11/2026 10:15 (`30e64dc4`), thử local đạt, chưa soi dữ liệu prod

Anh: "Duyệt, làm lát 1" (theo ba mặc định ở mục 8). Lát này một mình KHÔNG đổi gì trên màn của ai: app và web chưa gọi các đường
mới cho nhân viên (lát 2, 3). Tài khoản chủ shop không đổi hành vi.

**Đã làm:**
- Migration `20261123100000_notification_category_channels`: `notifications.category` (TEXT, null) + `notifications.channelIds`
  (TEXT[], mặc định rỗng). Chỉ sửa metadata, có khối lấy khóa + thử lại như các migration đụng bảng nóng. Không thêm chỉ mục, không
  điền bù dòng cũ.
- `services/notification-access.ts` — MỘT nguồn luật: bảng mục ↔ quyền (`CATEGORY_PERMISSIONS`), phạm vi gian, bản lọc trong bộ nhớ
  (`staffCanSeeNotification`, dùng cho tin đẩy) và bản SQL (`staffNotificationWhere`, dùng cho danh sách / số chưa đọc / đánh dấu đã
  đọc); test so hai bản trên mọi tổ hợp.
- `services/notifications.ts`: `notify()` ghi `category` + `channelIds`; mount `/api/notifications` bỏ `adminOnly`, router tự gác:
  `GET /` và `POST /read` theo phạm vi người gọi; `POST / DELETE /devices` mở cho nhân viên (đăng ký máy nhận tin đẩy);
  `GET / PUT /preferences`, `POST /test-push`, `/dev-test` vẫn chỉ chủ shop. Luồng SSE của web vẫn chỉ chủ shop (lát 3).
- `services/push.ts`: tin đẩy đi kèm một thông báo gửi thêm máy của nhân viên được thấy thông báo đó; nhân viên đã xóa thì không gửi;
  tin thử vẫn chỉ máy chủ shop. Shop không có máy nhân viên nào thì không tốn thêm câu hỏi DB.
- Gắn gian ở nơi phát đã biết gian (17 tệp): đơn mới (đợt gom ghi mọi gian có đơn trong đợt), hỏa tốc, khách xin hủy / đơn bị hủy,
  giao hụt ×3 sàn, hoàn hàng ×3 sàn, tự chuẩn bị hàng, quảng cáo TikTok (nhận định, tự xử lý, chuyển Phân phối tối đa).
  Để là "chuyện cả shop" (không ghi gian): cảnh báo điều hành (`ops-alerts`: đơn lỗ, sai phí, ví quảng cáo, hết hàng…), tổng kết
  quảng cáo ngày, báo cáo tuần, hóa đơn, thuế, KOC.

**Luật gian (chặt hơn bản em trình ở mục 8 — nói rõ để anh biết):**
1. Nhân viên thấy một thông báo khi KHÔNG gian nào của nó nằm ngoài phần được giao. Đợt "đơn mới" gom gian A + B mà nhân viên chỉ
   được giao A → không thấy cả đợt (tiêu đề + nội dung in số của cả hai gian).
2. Thông báo "chuyện cả shop" chỉ tới nhân viên được giao ĐỦ mọi gian. Hệ quả: shop nối thêm gian mà chưa giao cho nhân viên thì
   nhân viên đó thôi nhận báo cáo tuần, cảnh báo hết hàng… cho tới khi được giao gian mới.
3. Thông báo phát TRƯỚC ngày lên bản này: nhân viên KHÔNG thấy, kể cả người được giao đủ gian (mục 8 em nói người đủ gian thấy cả
   cũ). Lý do: dòng cũ không có cột mục để lọc theo quyền; điền bù là ghi hàng loạt lên bảng `notifications` trên prod, không đáng.

**Đã kiểm:**
- `npx tsc --noEmit` sạch. Vitest 19 tệp có liên quan: 195 qua, 3 bỏ qua sẵn. Test mới: `notification-access.test.ts` (13 ca) +
  3 ca gian trong `new-order-notify.test.ts`.
- Prisma sinh đúng câu `ALTER TABLE` như tệp migration (`migrate diff`). DB local kẹt một migration cũ từ 17/09
  (`20260830120000_fee_audit` FAILED) nên áp riêng tệp SQL này bằng `prisma db execute`.
- Chạy thật trên backend local, 5 nhân viên × 10 loại thông báo, 27 / 27 ca đúng:

| Người | Quyền / gian | Thấy |
|---|---|---|
| chủ shop | — | cả 10, chưa đọc 10 |
| đủ quyền, đủ gian | 20 lá | 8 (thiếu đúng "gói dịch vụ" và "mất kết nối gian") |
| mẫu Nhân viên kho, chỉ gian 1 | đơn hàng + kho | 2: đơn mới gian 1, hoàn hàng gian 1 (không đợt gom gian 1 + 2, không hết hàng cả shop) |
| mẫu Kế toán, đủ gian | tài chính + hóa đơn | 2: báo cáo tuần, hóa đơn |
| chỉ Quảng cáo TikTok | 2 gian | 1: nhận định chiến dịch |
| chỉ Phản hồi đánh giá | — | 0, danh sách rỗng |

  Nhân viên kho bấm "đọc hết" → đánh dấu đúng 2 dòng của mình, chấm đỏ chủ shop 10 → 8; đánh dấu dòng gói dịch vụ bằng id → 0 dòng;
  nhân viên gọi cài đặt / gửi thử → 403; không nhân viên nào thấy dòng cũ.
- Chọn máy nhận tin đẩy (DB local, lời gọi ra Expo thay bằng bản giả — không tin nào đi ra ngoài): 9 / 9 ca đúng, gồm nhân viên đã
  xóa không nhận, tin thử chỉ tới chủ shop.
- **Trên prod:** push 23/11 ~10:13, `/health` backend web trả `23f6ac09` lúc 10:15 — lệnh khởi động là
  `prisma migrate deploy && npm run start` nên web lên bản mới nghĩa là migration đã áp. Worker (nơi phát phần lớn thông báo) không
  có `/health` công khai, chưa xác nhận bản. Chưa đọc dòng `notifications` mới nào trên prod để soi hai cột.
- **CHƯA kiểm:** tin đẩy thật tới máy nhân viên (cần lát 2); tải của câu đếm chưa đọc trên shop có rất nhiều thông báo
  (câu của nhân viên đi cùng chỉ mục `(ownerId, createdAt)` như câu của chủ shop, thêm điều kiện lọc — chưa đo).

**Còn lại:** lát 2 (app: bật chuông + đăng ký máy cho nhân viên, đường dẫn trong tin về đúng màn có quyền, OTA) · lát 3 (web: vẽ
chuông cho nhân viên + luồng SSE theo phạm vi).

# Chuông thông báo + tin đẩy trên app mobile (bản 1.4.0, 23/10/2026)

> Anh Trung 23/10: "Thêm chuông thông báo vào app (phần nặng nhất) — khảo sát trước khi làm;
> phải có mục cài đặt bật/tắt từng hạng mục vì mỗi khách quan tâm một loại; chú ý tỉ lệ màn hình,
> kích thước và độ dài chữ trên màn thông báo." Tệp này = khảo sát + thiết kế đã làm + việc còn lại.
> Cùng bản 1.4.0: bộ lọc gian hàng dạng hộp trượt (Tài chính + Quảng cáo) và đổi nhãn cột đầu thác nước.

## 1. Khảo sát: đã có gì, thiếu gì

| Mảnh | Trước 23/10 | Kết luận |
|---|---|---|
| Bảng `Notification` + `notify()` (`backend/src/services/notifications.ts`) | Có từ Tầng 3 UI; ~20 loại sự kiện đã gọi `notify()`: `return` (3 sàn), `cancel_request`, `delivery-fail`, `ops-alert` (cảnh báo điều hành: cháy hàng, sắp hết, gian mất kết nối, đơn lỗ, sai phí, ads-*), `tiktok-ads-advice`, `tiktok-ads-auto`, `ads-daily-summary`, hóa đơn, gói, IAP | **Dùng lại nguyên**, app và web chung một bảng — khách đọc trên web rồi thì app cũng hết chấm mới. |
| Chuông web (`frontend/.../notification-bell.tsx`) | REST + SSE, mở chuông = đọc hết | App chép quy ước "mở màn = đã liếc". App không có SSE (React Native không có EventSource) → REST 60 s + push. |
| **Đơn mới** | KHÔNG có thông báo nào khi đơn về | Phải thêm; ở quy mô 1 triệu đơn/ngày không được báo từng đơn → gom đợt (mục 3). |
| **Hỏa tốc** | Chỉ có cờ `isExpressShipping` để xếp đầu danh sách | Báo ngay từng đơn (cửa sổ hành động vài giờ). |
| **Khách xin hủy** | `cancel_request` đã có từ đêm 23/10 (web) | Dùng lại; app lọc `?cancelRequested=1` ở màn Đơn hàng khi bấm thông báo. Nút Chấp nhận/Từ chối trên app: lát sau. |
| **Hoàn / trả hàng hoàn tiền** | `return` đã có; API trả lời yêu cầu hoàn: **chưa có** trên backend | Xem mục 6. |
| Tin đẩy (push) | Không có: app chưa cài `expo-notifications`, backend không lưu token | Làm mới toàn bộ (mục 4). |
| Cài đặt bật/tắt theo nhóm | Không có (web cũng không) | Làm mới; áp cho cả web lẫn app (mục 2). |

## 2. Nhóm thông báo khách bật/tắt

Một nguồn: `backend/src/services/notification-categories.ts` — `categoryOf(type)` xếp mọi `type` kỹ thuật
vào 9 nhóm; màn Cài đặt trên app đọc danh sách này (GET `/api/notifications/preferences`).

| Nhóm | Nhãn trên app | Gồm type | Mặc định |
|---|---|---|---|
| `order_new` | Đơn hàng mới | `order_new` (gom đợt) | bật |
| `order_express` | Đơn hỏa tốc | `order_express` | bật |
| `cancel_request` | Khách xin hủy đơn | `cancel_request` | bật |
| `return` | Hoàn hàng, trả hàng hoàn tiền | `return` | bật |
| `delivery_fail` | Giao không thành công | `delivery-fail`, `ops-alert:delivery-fail` | bật |
| `ads` | Quảng cáo | `tiktok-ads-*`, `ads-*`, `ops-alert:ads-*`, `ops-alert:hubsell-ads*` | bật |
| `stock` | Kho: hết hàng, sắp hết | `ops-alert:stockout`, `ops-alert:low-stock` | bật |
| `ops` | Vận hành khác | `ops-alert:*` còn lại (gian mất kết nối, đơn lỗ, sai phí, đồng bộ dừng, KOC) | bật |
| `system` | Hệ thống và gói dịch vụ | hóa đơn, gói, thanh toán, `system` | **luôn bật, không tắt được** |

- Tắt nhóm = `notify()` **không ghi gì** (chuông web, chuông app, push cùng im). Lưu ở bảng
  `notification_preferences` (`mutedCategories TEXT[]`, một dòng/chủ shop). Cache 60 s trong mỗi tiến trình
  (worker thấy thay đổi sau ≤ 60 s).
- Cảnh báo điều hành đổi type từ `ops-alert` → `ops-alert:<loại>` (`ops-alerts.ts`) để xếp nhóm được; web
  chỉ đọc `title` nên không ảnh hưởng. Bản ghi cũ `ops-alert` trần rơi về nhóm `ops`.
- Vì sao áp cả web: khách tắt "Quảng cáo" trên app mà web vẫn kêu thì họ tưởng tắt không ăn. Web chưa có
  màn cài đặt — thêm sau nếu khách hỏi (route đã sẵn).

## 3. Đơn mới: gom đợt, hỏa tốc báo ngay (`backend/src/services/new-order-notify.ts`)

Móc tại chỗ **tạo** Order của 3 sàn (`shopee/service.ts`, `tiktok/service.ts`, `lazada/service.ts` — ngay sau
`tx.order.create` + dòng hàng). Luật, có test `new-order-notify.test.ts` (7 ca):

1. Chỉ đơn khách **đặt trong 2 giờ** gần đây — lượt nạp lịch sử khi vừa nối gian (hàng nghìn đơn cũ) không nổ.
2. Hỏa tốc (`isExpressShipping(shippingCarrierName)`) → thông báo riêng **ngay**: "⚡ Đơn hỏa tốc {mã}" +
   gian, tiền, hãng; link `/orders?search={mã}`.
3. Đơn thường → **gom 45 giây** (đợi lô sync xong) → "N đơn mới" + "Shopee ANO 2 · TikTok Hi.Bé 1 · tổng 2,1 tr".
4. Trong **15 phút** kế tiếp, đợt sau **cộng dồn** vào cùng bản ghi chuông (không đẻ 20 dòng "1 đơn mới"),
   nhưng điện thoại vẫn rung mỗi đợt với "+N đơn mới". Bản ghi đã đọc → mở bản ghi mới.
5. Bộ đệm trong RAM worker: O(số chủ shop có đơn trong 45 s); restart mất tối đa một đợt (tiện ích, không
   phải dữ liệu). `notify()` thêm `dedupe:false` cho hai type này (khử trùng 24 h theo title sẽ nuốt mất).

Chưa móc: đơn tạo từ `routes/webhooks.ts` (webhook tổng quát) và đơn seed reviewer — cố ý.

## 4. Tin đẩy (push)

- **Backend `services/push.ts`**: Expo Push Service (`exp.host/--/api/v2/push/send`, ≤ 100 tin/request).
  `notify()` ghi DB xong gọi `sendPushToOwner()` (không chờ, không ném lỗi). Thiết bị ở bảng `push_devices`
  (`token` unique, `userId`, `ownerId`, `platform`, `enabled`); chỉ máy của **chính chủ shop** nhận
  (`userId = ownerId`, chuông GĐ1 chỉ chủ shop). Sàn trả `DeviceNotRegistered` → `enabled=false`.
  Tiêu đề cắt 70 ký tự, nội dung 180 (hệ điều hành cắt sớm hơn thế). Tùy chọn env `EXPO_PUSH_ACCESS_TOKEN`
  nếu bật Enhanced push security trên expo.dev. Biên nhận (receipts) chưa đọc — đợt sau nếu thấy token chết
  không tự tắt.
- **Route**: `POST /api/notifications/devices {token, platform, appVersion, deviceName}` (upsert theo token —
  đăng nhập tài khoản khác trên cùng máy thì bản ghi đổi chủ), `DELETE /api/notifications/devices {token}`.
  `GET /api/notifications?before=<ISO>` cuộn tiếp, mỗi dòng kèm `category`.
- **App `src/notifications/NotificationsContext.tsx`** (mount ở Stack gốc, tự im khi không phải chủ shop):
  xin quyền một lần sau đăng nhập → `getExpoPushTokenAsync({projectId})` → POST devices; token lưu SecureStore;
  đăng xuất gỡ token **trước** khi xóa phiên (`addBeforeSignOut` trong AuthContext, tối đa 3 s). Khách tắt công
  tắc "trên máy này" → nhớ `hubsell.pushOptOut`, không xin lại. Android tạo kênh `default` trước khi xin quyền
  (Android 13+ bắt buộc). Bấm tin (app đóng/mở) → `lib/notification-links.ts` đổi link web → màn app:
  `/orders*` → Đơn hàng (giữ `cancelRequested`, `search`), `/warehouse/returns` → Kho › Đơn hoàn, `/products` →
  Kho › Tồn kho, `/ads/tiktok/campaign?id=` → màn chiến dịch, `/ads*` → Trang chủ trang Quảng cáo (`?page=2`),
  tài chính → trang Tài chính; link không có màn (hóa đơn, gói) → mở màn Thông báo.
- **Khi app đang mở** vẫn hiện banner + tiếng (`setNotificationHandler`), badge iOS = số chưa đọc.

### 4.1 ⏳ VIỆC ANH PHẢI LÀM để push chạy thật (em không có quyền)

| Nền | Việc | Ghi chú |
|---|---|---|
| **Android** | 1) Tạo dự án Firebase (console.firebase.google.com, tài khoản dev@hubsell.vn), thêm app Android package `vn.hubsell.app`, tải `google-services.json` → đặt `hubsell-mobile/google-services.json` (đã gitignore) và khai `expo.android.googleServicesFile: "./google-services.json"` trong app.json. 2) Firebase › Project settings › Service accounts › Generate new private key → `eas credentials` › Android › production › Google Service Account › FCM V1 → upload JSON đó. | Chưa có thì bản Android: chuông REST chạy, công tắc push báo "Bản dựng này chưa bật được tin đẩy" (getExpoPushTokenAsync ném lỗi FirebaseApp). |
| **iOS** | ✅ 23/10 em đã bật capability Push Notifications trên App ID bằng `node scripts/asc-bundle-capability.mjs enable PUSH_NOTIFICATIONS` (ASC API, không cần Apple ID) và EAS đã tạo profile mới Q342UZKZCG (build 1.4.0 lần 2). ⏳ **Khóa APNs (push key) EAS đang để trống** (`pushKey: null`) → iOS nhận token nhưng Expo không gửi được. Anh chạy trong PowerShell tại `hubsell-mobile`: `npx eas-cli credentials -p ios` → chọn profile production → **Push Notifications: Set up a new push key** (có thể phải đăng nhập Apple ID hubselltech@gmail.com + 2FA; Apple cho tối đa 2 key/đội). Không cần build lại sau bước này. | Expo Go không nhận push từ SDK 53 — phải thử bằng build. |
| Cả hai | Tùy chọn: expo.dev › Project › Credentials › Push › "Enhanced push security" → đặt `EXPO_PUSH_ACCESS_TOKEN` trên Render (web + worker). | Không bắt buộc. |

## 5. Giao diện app (chữ, co giãn)

- **Chuông** trên thanh mục Trang chủ (phải), badge đỏ `9+`; dãy chấm chỉ báo trang chỉ hiện ≥ 420 px (chuông
  chiếm chỗ). Bấm → `/notifications` (trang riêng, không popover — anh chốt 04/10 mục con vào hẳn trang).
- **Màn Thông báo**: dòng = icon nhóm (ICON_TINT) + tiêu đề **≤ 2 dòng** 14 px + nội dung **≤ 3 dòng** 13 px + thời
  gian ("12 phút trước", "Hôm qua 14:05", "21/10 09:30") + "Mở ›" khi có màn đích. Mở màn = đọc hết (badge 0),
  chấm xanh giữ theo dữ liệu lúc mở; kéo xuống làm mới; cuộn hết tải trang 30 tiếp.
- **Cài đặt thông báo** (`/notification-settings`, vào từ Cấu hình › Thông báo hoặc nút ⚙ ở màn Thông báo):
  khối "Nhận thông báo đẩy trên máy này" (công tắc; bị HĐH chặn → nút Mở Cài đặt) + 9 công tắc nhóm (nhãn ≤ 32
  ký tự, chú thích ≤ 90 ký tự, 2 dòng), lưu ngay khi gạt, lỗi mạng gạt về như cũ.
- Chữ đẩy: tiêu đề backend đã có sẵn ngắn ("Khách xin hủy đơn 2510…", "3 SKU đang cháy hàng…"); push cắt
  70/180 ký tự. Nội dung đơn mới cố ý một dòng.
- Soi 320 / 360 / 390 / 430 + nền tối trên giả lập web local (ảnh ở PROGRESS phiên 23/10 chiều).

## 6. Hoàn / trả hàng hoàn tiền: trả lời sàn từ app (CHƯA LÀM — khảo sát)

Anh hỏi "API có tác động xác nhận / từ chối được không". Backend hiện chỉ **đọc** yêu cầu hoàn
(`returns-sync.ts` 3 sàn). Theo tài liệu sàn (cần đọc lại nguyên văn khi code, như đã làm với yêu cầu hủy):

| Sàn | Khả năng | Ghi chú |
|---|---|---|
| Shopee | Nhóm `v2.returns.*`: `confirm` (đồng ý hoàn tiền), `dispute` (khiếu nại), `offer` / `accept_offer` (đề nghị giải pháp), `get_return_detail` đã dùng | Đồng ý = `confirm`; từ chối = `dispute` kèm lý do + ảnh — sàn phân xử ~3 ngày. |
| TikTok | Return & Refund API 202309: `returns/{return_id}/approve`, `returns/{return_id}/reject` (cần `reason` từ `reject_reasons`), quá hạn sàn tự duyệt | Cùng họ với `cancellations/approve|reject` đã làm 23/10 → chép mẫu được. |
| Lazada | Reverse order: `getreverseordersforseller` (đã dùng), quyết định qua `/order/reverse/.../seller/decide` (cùng endpoint yêu cầu hủy `agree_cancel`), hoàn tiền cần bước xác nhận nhận hàng | Chưa thử thật. |

Đề xuất lát sau: `services/return-request-decide.ts` + `POST /api/orders/:id/return-request/decide` theo đúng
khuôn `cancel-request-decide.ts`; app thêm nút trong hộp chi tiết đơn hoàn. Chưa code vì chưa đọc nguyên văn
docs 3 sàn (nguyên tắc 23/10 với yêu cầu hủy).

## 7. Việc còn lại / rủi ro

- ⏳ Anh: Firebase + FCM V1 (mục 4.1) — push Android chỉ chạy sau bước này; iOS cần build EAS mới.
- ⏳ Thử máy thật: xin quyền lần đầu, bấm tin khi app đóng, đăng xuất rồi đăng nhập tài khoản khác không nhận
  tin cũ, công tắc tắt trên máy.
- ⏳ Nhân viên chưa có chuông (GĐ1) — mở theo cây quyền là nợ cũ.
- ⏳ Đọc biên nhận Expo (receipts) để tắt token chết muộn.
- ⏳ Web: màn cài đặt nhóm (route đã có).
- ⏳ Nút Chấp nhận/Từ chối yêu cầu hủy + trả lời yêu cầu hoàn trên app (mục 6); nhạc cảnh báo khi quét đơn
  đang bị khách xin hủy (anh chốt 23/10 làm sau).

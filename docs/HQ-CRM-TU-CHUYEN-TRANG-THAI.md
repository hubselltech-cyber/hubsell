# CRM HQ — tự chuyển trạng thái chăm sóc theo thuê bao

> 22/10/2026 — anh Trung: *"(1) khách hết dùng thử mà không gia hạn → Đã rời bỏ;
> (2) khách đã thanh toán → Đang dùng ổn định; (3) khách đã rời bỏ mà sau này quay
> lại thanh toán → Đang dùng ổn định"*. Tài liệu này là nguồn sự thật của cơ chế;
> mã ở `backend/src/services/care-auto-status.ts`, hook thanh toán ở
> `services/subscription-service.ts` (`recordPackagePaymentTx`), worker ở
> `workers/plan-hibernate.ts`.

## 1. Vì sao

Trước 22/10, `PlatformCustomerCare.status` chỉ đặt tay trong hộp thoại Chăm sóc.
Thực tế HQ 21/10: **155/160 khách (96,9 %) nằm ở "Mới đăng ký"** dù đa số đã hết
dùng thử 14 ngày từ lâu; 5 khách "Đang dùng ổn định" là do anh đặt tay. Biểu đồ
"Phân bố trạng thái chăm sóc" trên Tổng quan và chip lọc ở khu Khách hàng không
nói lên gì, Sale không biết gọi ai.

## 2. Luật

| Sự kiện | Trạng thái | Nguồn ghi (`statusSource`) | Ở đâu |
|---|---|---|---|
| Ghi nhận thanh toán **amount > 0** (HQ chuyển khoản, Ví Hubsell, payOS, Apple IAP) | → **Đang dùng ổn định** (ACTIVE) | `AUTO_PAYMENT` | trong giao dịch `recordPackagePaymentTx`, ngay sau upsert thuê bao + đánh thức gian |
| Thuê bao có `currentPeriodEnd` < now − **7 ngày** (`EXPIRED_GRACE_DAYS`, cùng mốc ngủ đông gian) | → **Đã rời bỏ** (CHURNED) | `AUTO_EXPIRED` | worker `plan-hibernate`, mỗi 6 giờ, bước 2 sau ngủ đông |
| Sale đặt trong hộp thoại Chăm sóc và trạng thái **thực sự đổi** | giữ nguyên lựa chọn | `MANUAL` | `PATCH /api/admin/customers/:userId/care` |

Luật (3) của anh không cần mã riêng: thanh toán luôn thắng, kể cả hồ sơ đang CHURNED.

### Các quyết định thiết kế (em tự chọn, nêu để anh chốt ngược nếu muốn)

- **Rời bỏ tính từ HẾT ÂN HẠN 7 ngày, không phải ngày hết dùng thử.** Trong 7 ngày
  ân hạn khách vẫn vào app được (chỉ khóa tầng giá trị gia tăng), là cửa sổ Sale gọi
  tốt nhất; đánh "Đã rời bỏ" ngày đầu sẽ làm chip lọc vô nghĩa. Mốc này trùng mốc
  ngủ đông gian → một khái niệm "đã bỏ" cho cả hạ tầng lẫn CRM.
- **Gói trả tiền hết hạn không gia hạn cũng là rời bỏ**, không chỉ dùng thử (anh nói
  "hết dùng thử" nhưng khách trả tiền rồi bỏ càng cần Sale biết). Không lọc `isTrial`,
  không lọc `status` thuê bao (CANCELLED có kỳ hạn cũng tính — giống ngủ đông).
- **Khác ngủ đông ở một điểm:** không đòi có gian hàng — khách đăng ký rồi bỏ, chưa
  nối gian nào, vẫn thành "Đã rời bỏ". Khách cũ chưa được gán thuê bao (nick test
  của anh, chốt 22/08) không có dòng → không bao giờ bị đánh nhầm.
- **Đổi gói 0đ / gói tặng (ENTERPRISE_TRIAL, nút Đổi gói HQ) KHÔNG tính là thanh toán**
  → không tự ACTIVE. "Đã thanh toán" = có tiền (amount > 0).
- **Quyết định tay SAU khi hết gói thắng tự động.** Sale kéo khách rời bỏ về "Đang tư
  vấn" thì worker không đè lại. Đặt tay TRƯỚC khi hết gói (vd "Nguy cơ rời bỏ" lúc
  còn hạn) thì tới hạn vẫn thành "Đã rời bỏ". So bằng `statusChangedAt > currentPeriodEnd`.
- **Mỗi kỳ hết hạn chỉ bắn một lần:** đã CHURNED thì bỏ qua. Khách trả tiền → kỳ mới
  ở tương lai → rơi khỏi tập ứng viên; kỳ mới hết hạn lại → bắn lại.
- **Ghi chú + người phụ trách không bao giờ bị tự động sửa.** `updatedById` = null khi
  hệ thống ghi.
- **Mọi lần tự chuyển ghi Nhật ký thao tác**, action `care.auto`, người thao tác
  "Hệ thống (tự chuyển theo thuê bao)", detail có `reason` PAYMENT/EXPIRED, `from`.
  Trạng thái không đổi (gia hạn khi đang ACTIVE) thì không ghi.

## 3. Dữ liệu

Migration `20261022000000_care_status_source` (idempotent, bảng nhỏ):

- enum `PlatformCareStatusSource { MANUAL, AUTO_PAYMENT, AUTO_EXPIRED }`
- `platform_customer_care.statusSource` default MANUAL
- `platform_customer_care.statusChangedAt` default now(); dòng cũ = `updatedAt`.
  Khác `updatedAt`: sửa ghi chú / phân công không đụng cột này.

`PATCH /care` chỉ ghi `MANUAL + statusChangedAt = now` khi trạng thái **đổi so với
hiện tại** (chưa có hồ sơ = NEW ngầm định). Hồ sơ tạo lười vì ghi chú mà trạng thái
vẫn NEW thì `statusChangedAt = user.createdAt` ("mới đăng ký" từ lúc đăng ký) — nếu
không, một dòng ghi chú trong ân hạn sẽ chặn luật rời bỏ.

## 4. Worker

`runPlanHibernation()` mỗi 6 giờ (lượt đầu 5 phút sau khi bật):

1. ngủ đông gian (như 15/10; tắt riêng bằng `PLAN_HIBERNATE_OFF=1`);
2. `churnExpiredOwners(now)`: đọc `subscriptions` có `currentPeriodEnd < cutoff`,
   chủ không phải điều hành, hồ sơ chưa CHURNED hoặc chưa có — **theo trang 200**
   (cursor id, chỉ mục `currentPeriodEnd` sẵn); lọc luật ưu tiên trong JS; mỗi trang
   MỘT giao dịch: `createMany` hồ sơ thiếu + `updateMany` hồ sơ có + `createMany`
   nhật ký. Tắt riêng bằng `CARE_AUTO_CHURN_OFF=1`.

Tập ứng viên **tự co**: mỗi chủ chỉ khớp tới khi thành CHURNED; chỉ dòng Sale giữ tay
sau hết gói còn nằm lại (ít, do người đụng). **Vì tự co nên phân trang bằng `id > cursor`
trong WHERE, KHÔNG dùng `cursor + skip 1` của Prisma**: dòng cursor vừa chuyển CHURNED
không còn khớp lọc → `skip 1` nhảy qua một ứng viên thật mỗi trang (tái hiện 22/10:
trang 1 dòng, cursor+skip xử lý 2/4, `id > cursor` 4/4). Worker ngủ đông mắc cùng bẫy,
đã sửa cùng lượt. Dây an toàn chống đua với thanh toán
ghi giữa lúc đọc và ghi: `updateMany` đòi thuê bao **vẫn** quá ân hạn; `createMany
skipDuplicates` nên hồ sơ ACTIVE thanh toán vừa tạo không bị đè.

Log: `[care-auto] Lượt quét CRM: N chủ shop hết gói quá ân hạn → Đã rời bỏ (đọc X, giữ
Y do Sale đặt tay sau hết gói)` — log cả lượt 0.

## 5. Giao diện HQ

- Khu Khách hàng: dưới huy hiệu trạng thái có dòng nhỏ "Tự động · dd/mm/yyyy hh:mm"
  (tooltip nói tự chuyển vì thanh toán hay hết gói) khi nguồn là AUTO_*.
- Hộp thoại Chăm sóc: một dòng giải thích luật + nguồn hiện tại.
- Tổng quan: chú thích dưới "Phân bố trạng thái chăm sóc".
- Nhật ký thao tác: nhãn `care.auto` = "Hệ thống tự chuyển trạng thái chăm sóc".

## 6. Lần đầu lên prod — điều sẽ thấy

Lượt worker đầu (5 phút sau deploy) sẽ đánh **"Đã rời bỏ" phần lớn 155 khách "Mới đăng
ký"** đã hết dùng thử quá 7 ngày — đúng ý, nhưng biểu đồ Tổng quan đổi hẳn màu. 5
khách anh đặt tay "Đang dùng ổn định": giữ nếu anh đặt SAU khi gói hết hạn hoặc gói
còn hạn; thành "Đã rời bỏ" nếu đặt trước khi hết hạn mà nay quá ân hạn (dòng cũ
`statusChangedAt = updatedAt`). Lần thanh toán tới của bất kỳ khách nào tự về ACTIVE.

Kiểm sau deploy (Render log worker): dòng `[care-auto] Lượt quét CRM` đầu tiên; SQL
chỉ đọc:

```sql
SELECT status, "statusSource", count(*) FROM platform_customer_care GROUP BY 1, 2 ORDER BY 1, 2;
SELECT count(*) FROM platform_audit_logs WHERE action = 'care.auto';
```

## 7. Test

- `services/__tests__/care-auto-status.test.ts` — hàm thuần: luật ưu tiên, dữ liệu
  ghi, điều kiện lọc (không đòi gian, không lọc isTrial/status).
- `services/__tests__/care-auto-status-db.test.ts` — trên DB dev: 6 chủ shop giả
  (chưa hồ sơ / đặt tay sau hết gói / đặt tay trước hết gói có ghi chú / trong ân
  hạn / điều hành / đã CHURNED tay), worker trang 2, chạy lặp, thanh toán từ CHURNED
  → ACTIVE giữ ghi chú, gia hạn khi đang ACTIVE không nhật ký, thanh toán cho khách
  chưa hồ sơ, đổi gói 0đ không đổi trạng thái. Tự dọn.

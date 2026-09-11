# payOS — Kênh thanh toán & nhận diện sản phẩm trên sao kê

Chốt 11/09/2026 (anh Trung): chuẩn bị sẵn để sau này nhiều sản phẩm của công ty
(Hubsell, Hubtax…) cùng thu tiền qua payOS vào tài khoản MB mà vẫn phân biệt được
từng đồng thuộc sản phẩm nào. Làm **đồng thời 2 lớp**:

| Lớp | Cái gì | Phân biệt ở đâu |
|---|---|---|
| 1. Kênh thanh toán riêng | Mỗi sản phẩm một "Kênh thanh toán" trên my.payos.vn → bộ Client ID / API Key / Checksum Key riêng, URL webhook riêng | Trong payOS (lọc giao dịch theo kênh, xuất Excel từng kênh); webhook tiền về gọi đúng backend của sản phẩm đó |
| 2. Tiền tố nội dung chuyển khoản | Mỗi sản phẩm một tiền tố in vào nội dung CK: Hubsell `HS`, Hubtax `HT`… | Trên **sao kê ngân hàng** (lọc `HS ` / `HT `) — kênh payOS không hiện trên sao kê |

Lớp 3 (tùy chọn, khi kế toán cần tách bạch tuyệt đối): mỗi sản phẩm một số tài
khoản MB riêng, mỗi tài khoản gắn một kênh. MB BIZ mở thêm tài khoản phụ miễn phí.

## Nội dung chuyển khoản khách thấy

payOS tự ghép mã nhận diện của họ phía trước, phần Hubsell đặt do
`buildPayosDescription` (backend/src/integrations/payos/client.ts):

| Trạng thái tài khoản MB trên payOS | `PAYOS_DESCRIPTION_MAX` | Ví dụ nội dung |
|---|---|---|
| Chưa liên kết (mặc định) | `9` | `HS GROWTH`, `HS BUSINE` (bị cắt) |
| Đã liên kết | `25` | `HS BUSINESS 00000123` (đủ tên gói + 8 số cuối mã đơn) |

Chuỗi đã gửi được lưu vào `gateway_payment_orders.description` — FE bày đúng
chuỗi này, đổi env sau đó không làm lệch đơn đang chờ.

## Việc làm khi MB liên kết xong (Hubsell)

1. my.payos.vn → Kênh thanh toán → tạo kênh **Hubsell** (chọn tài khoản MB) → lấy 3 khóa.
2. Render → env: `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`,
   `PAYOS_TRANSFER_PREFIX=HS`, `PAYOS_DESCRIPTION_MAX=25`.
3. `npx tsx scripts/payos-confirm-webhook.ts https://hubsell-backend-sg.onrender.com/api/webhooks/payos`
4. Test 1 giao dịch thật số nhỏ (payOS không có sandbox) → kiểm tra sao kê MB thấy
   nội dung `…HS <GÓI> <8 số>` và HQ Kế toán có dòng thu kèm mã GD ngân hàng.

## Việc làm khi có sản phẩm thứ hai (vd Hubtax)

1. my.payos.vn → tạo kênh **Hubtax** (cùng tổ chức, cùng tài khoản MB nếu payOS cho
   phép; nếu bắt chọn tài khoản khác → mở thêm tài khoản phụ MB). Lấy 3 khóa riêng.
2. Backend Hubtax: chép nguyên thư mục `backend/src/integrations/payos/` (không có
   chữ nào riêng Hubsell) + khuôn `services/gateway-checkout.ts` và route webhook
   `/api/webhooks/payos`. Đặt env với khóa của kênh Hubtax, `PAYOS_TRANSFER_PREFIX=HT`.
3. Đăng ký webhook của Hubtax bằng script confirm tương tự.
4. Kế toán: sao kê MB lọc `HS ` = Hubsell, `HT ` = Hubtax; đối chiếu chi tiết theo
   mã giao dịch ngân hàng (payOS trả `reference`, mỗi hệ thống lưu ở PackagePayment
   `externalRef = payos:<reference>`).

## Ràng buộc payOS đã biết

- Mọi tài khoản ngân hàng thêm vào phải đúng tên chủ tài khoản đã xác minh (công ty).
- Chưa liên kết ngân hàng thì payOS không đọc được giao dịch → không tự xác nhận tiền
  về; toàn bộ luồng chờ MB BIZ liên kết xong.
- Tài liệu payOS không ghi rõ một tài khoản ngân hàng gắn được mấy kênh — kiểm tra thực
  tế khi tạo kênh thứ hai.

# HQ — Hủy ghi nhận khoản thu gói bấm tay + cảnh báo ghi trùng (26/11/2026)

## 1. Chuyện gì đã xảy ra

26/11/2026 một khách mua gói Pro 3 tháng, tự chuyển qua payOS — máy đã tự ghi (dòng "Hệ thống (payOS)" 13:10).
Anh thấy tiền về, vào HQ → Gói dịch vụ bấm **Xác nhận đã nhận tiền** thêm một lần. Sổ quỹ có hai dòng thu
1.129.000₫ cho một lần chuyển khoản, và dòng anh ghi không có nút xóa.

Giờ 12:00 trên dòng ghi tay KHÔNG phải giờ bấm: ô "Ngày thực nhận tiền" chỉ có ngày, giao diện tự gắn 12:00.

## 2. Vì sao không xóa được, và vì sao không nên xóa lẻ

Nút thùng rác ở Sổ quỹ chỉ hiện với bút toán ghi tay ở chính Sổ quỹ. Dòng thu sinh từ "Xác nhận đã nhận tiền"
mang `packagePaymentId`, backend chặn xóa. Chặn là đúng: một lần ghi nhận (`recordPackagePayment`) sinh ra

| Thứ sinh ra | Ghi trùng thì thành |
|---|---|
| Gia hạn thuê bao | khách có 6 tháng thay vì 3 (cùng gói còn hạn → nối tiếp) |
| Chứng từ `PackagePayment` | hai chứng từ |
| Bút toán THU sổ quỹ | doanh thu đội 1.129.000₫ |
| Tờ nháp hóa đơn trên meinvoice.vn | hai tờ nháp giống hệt nhau chờ ký |
| Hoa hồng giới thiệu (nếu khách có người giới thiệu) | cộng hai lần |
| Thư "gói đã kích hoạt" gửi khách | khách nhận hai thư |

Xóa lẻ dòng sổ thì năm thứ còn lại vẫn nằm đó.

## 3. Đã làm

### 3.1. Nút "Hủy ghi nhận" (↶) trên dòng Sổ quỹ

Chỉ hiện ở dòng thu gói do HQ tự bấm xác nhận và chưa có hóa đơn. Bấm → hộp **xem trước** nói rõ sẽ đổi gì
(hạn gói trước → sau, tờ nháp hóa đơn, hoa hồng) → "Hủy ghi nhận".

Thứ tự máy làm (`backend/src/services/void-package-payment.ts`):

1. Kiểm khoản có hủy được không (mục 3.2).
2. Giành khóa hóa đơn của bút toán — vòng tự xuất hóa đơn không đẩy lại tờ nháp giữa chừng.
3. Hỏi meinvoice.vn, xóa tờ nháp, hỏi lại cho chắc tờ đã mất. Lỗi hoặc tờ đã ký → **dừng, chưa gỡ gì**.
4. Một giao dịch DB: trả hạn gói, xóa bút toán, xóa chứng từ, thu hồi hoa hồng (bút toán ví ÂM loại ADJUSTMENT).
5. Chép toàn bộ khoản bị gỡ vào Nhật ký thao tác (`subscription.payment.void`) — chứng từ đã xóa không còn ở đâu khác.

API: `GET /api/admin/finance/ledger/:id/void-payment` (xem trước, không đổi gì) và `POST` cùng đường dẫn (thực hiện).
Lá quyền `hq.finance`.

### 3.2. Khi nào máy TỪ CHỐI

| Ca | Lý do |
|---|---|
| Khoản do payOS / App Store / Ví ghi | tiền thật máy ghi, không phải bấm nhầm |
| Phí vượt, giờ quay video | chưa làm (còn phiếu phí vượt / số giờ đã cộng phải trả lại) |
| Dòng đã có số hóa đơn, hoặc tờ đã ký trên meinvoice.vn | hóa đơn đã lập phải hủy / điều chỉnh theo luật trước |
| Hạn gói hiện tại không còn khớp khoản thanh toán gần nhất | HQ đã Đổi gói / chỉnh hạn sau đó |
| Khoản mở kỳ gói ĐẦU TIÊN của khách, hoặc nối sau kỳ dùng thử, và không có khoản nào ghi sau | máy không lưu trạng thái gói trước khi ghi → không đoán |
| Khoản mở kỳ mới, sau đó khách trả tiếp gói KHÁC | không suy được khoản sau có nối kỳ cũ hay không |

Ca gốc 26/11 chạy được với cả hai thứ tự ghi (`computePeriodRollback` chạy lại đúng luật kỳ hạn):

- payOS ghi trước, HQ ghi sau → hạn gói về đúng kỳ của khoản payOS.
- HQ ghi trước, payOS ghi sau → kỳ của khoản payOS dời về tính từ ngày thu của chính nó.

Hoa hồng: ví người giới thiệu không còn đủ (đã rút) thì máy **không trừ**, báo HQ, không để ví âm.

Không gỡ được và không cố: thư "gói đã kích hoạt" đã gửi khách, yêu cầu mua gói đã tự đóng, trạng thái chăm sóc
"Đang dùng ổn định".

### 3.3. Cảnh báo ghi trùng ở hộp "Ghi nhận thanh toán"

`POST /api/admin/subscriptions/:userId/payment`: khách có một khoản mua gói ghi trong **48 giờ** gần nhất →
trả 409 `RECENT_PAYMENT` kèm câu "Khách này vừa có một khoản mua gói … lúc … (máy tự ghi từ payOS)". Giao diện
hiện hộp vàng, nút đổi thành **Vẫn ghi nhận** (gửi lại kèm `confirmDuplicate: true`). Cảnh báo, không khóa.

48 giờ là mặc định tự chọn: đủ trùm ca "tiền về hôm qua, hôm nay mới ghi"; không dựa trên số đo nào.

## 4. Đã kiểm / chưa kiểm

- **Prod 26/11:** commit `0ecf3591`, backend lên 13:31 (`/health` đúng commit), web `app.hubsell.vn` 13:32 có lời
  gọi `void-payment` trong tệp JS trang Kế toán. Không có migration. Chưa ai bấm hủy trên prod lúc ghi dòng này.

- Test `backend/src/integrations/__tests__/void-package-payment.test.ts`: 12 ca (6 ca dựng lại hạn gói, 2 ca gỡ
  thật trên DB dev theo hai thứ tự ghi, 4 ca từ chối) — xanh; bộ `subscription-payment.test.ts` cũ vẫn xanh.
- Màn local (tài khoản HQ thử, seed đúng ca): nút chỉ hiện ở dòng HQ ghi; hộp xem trước ra "26/05/2027 →
  26/02/2027" + hoa hồng 112.900₫; bấm hủy → dòng mất, dòng payOS còn; hộp cảnh báo ghi trùng nhìn rõ ở nền
  sáng và nền tối.
- **Chưa kiểm:** xóa tờ nháp trên meinvoice.vn THẬT qua đường mới. Test và local đều giả lập / không có tờ
  nháp. Hàm xóa `deleteWebDraft` là hàm prod đang dùng khi anh đánh dấu "Không cần hóa đơn", phần mới chỉ là
  hỏi lại sau khi xóa. Lần bấm đầu tiên trên prod chính là lần kiểm thật.
- **Chưa làm:** hủy khoản phí vượt / giờ quay ghi tay; lưu trạng thái gói trước khi ghi lên chứng từ (làm thì
  ca "khoản đầu tiên của khách" cũng hủy được).

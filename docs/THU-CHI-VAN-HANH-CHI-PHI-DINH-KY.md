# THU CHI VẬN HÀNH — LỖI Ô NGÀY GÕ TAY + CHI PHÍ ĐỊNH KỲ

> 26/11/2026. Anh Trung: (1) "nghiên cứu kỹ để thêm một loại chi phí nữa đó là Chi phí định kỳ… ví dụ khách muốn mặc định mỗi ngày trừ 100K tiền kho và kéo dài trong một khoảng thời gian nhất định"; (2) "nhập tay một ngày bất kỳ thì không nhận → kiểm tra và fix".
> Hiện trạng: **cả hai ĐÃ LÀM và push 26/11** — anh chốt ~10:15 "Em cứ làm và push nhé". Mục 1 = lỗi ô ngày. Mục 2–8 = bản đề xuất (giữ để biết vì sao chọn cách này). **Mục 9 = cái đã làm thật + cách thử + việc còn lại — đọc mục 9 trước.**

## 1. Lỗi ô "Ngày phát sinh" gõ tay — ĐÃ SỬA (chưa push)

### 1.1 Gốc lỗi (đã tái hiện trên local + thấy trên prod)

- Ô `<input type="date">` của trình duyệt nhận NĂM đúng từng chữ số người gõ. Gõ `15/11/26` → giá trị ô là `0026-11-15` (năm 26), không tự hiểu là 2026. Chọn bằng lịch luôn ra năm đủ 4 chữ số nên không dính — đúng hiện tượng anh thấy.
- Máy chủ chỉ kiểm `new Date(...)` có hợp lệ không; `0026-11-15` hợp lệ → trả 201, web báo "Đã thêm", nhưng khoản chi nằm ở năm 26 nên không kỳ báo cáo nào chứa nó. Khách thấy "không nhận".
- Gõ năm đủ 4 chữ số thì vẫn chạy đúng (đã thử `15/11/2026`).
- **Prod (SQL chỉ đọc, 26/11 ~09:45):** 174 dòng `OperatingExpense`, có **1 dòng năm 0026**: khoản CHI 300.000 đ nhóm Đóng gói, `expenseDate = 0026-05-11`, khách tạo 10/11/2026 20:43 (giờ VN). Không có dòng năm quá xa, không có dòng ngày tương lai.

### 1.2 Đã sửa gì

| Chỗ | Việc |
|---|---|
| `frontend/src/lib/date-input.ts` (mới) | `fixTypedYear` (năm 00–99 → 20yy), `isPlausibleDay` (năm 2000 … hết năm sau), `setInputValue` |
| `frontend/src/components/ui/input.tsx` | MỌI ô `type="date"` dùng `<Input>`: rời ô là năm 2 chữ số đổi thành 20yy ngay trên ô (người dùng thấy trước khi lưu). Áp cho cả 13 ô ngày khác (Sổ quỹ HQ, thanh toán NCC, kỳ kế toán…) |
| `frontend/src/components/finance/add-txn-dialog.tsx` | Lúc gửi đổi năm thêm lần nữa (ca bấm Enter khi con trỏ còn trong ô); năm gõ dở / gõ thừa (`0202`, `20261`) báo đỏ "Năm chưa đúng — nhập đủ 4 chữ số, ví dụ 2026"; toast nói rõ khi khoản vừa lưu nằm NGOÀI khoảng ngày đang lọc (trước đây bảng không đổi, khách tưởng chưa lưu) |
| `backend/src/lib/expense-date.ts` (mới) + `routes/expenses.ts` | Hàng rào cuối cho web, app và bản web cũ còn trong bộ đệm: năm ngoài 2000 … hết năm sau → 400 kèm câu chỉ cách sửa, không lưu |
| `backend/src/lib/__tests__/expense-date.test.ts` | 6 ca |

Hai mốc năm (2000, hết năm sau) là **mặc định em tự chọn** để bắt gõ nhầm, không có căn cứ nghiệp vụ nào khác.

### 1.3 Đã kiểm / chưa kiểm

- Đã kiểm trên local (trình duyệt trong app, DB local): gõ `20/11/26` + Tab → ô thành `20/11/2026`, lưu, dòng hiện trong bảng; gõ `01/09/26` + Enter ngay trong ô → lưu ngày 01/09/2026, toast báo ngoài khoảng đang lọc; gõ năm `202` → báo đỏ, không gửi; gọi thẳng API với `0026-11-15` → 400. Test 6/6 qua, kiểm kiểu hai phía qua. Các khoản thử đã xóa khỏi DB local.
- Chưa kiểm: Firefox / Safari (hai trình duyệt này không có lỗi năm 2 chữ số theo cùng cách, hàng rào máy chủ vẫn che); app mobile (app tự dựng ngày từ nút chọn, không có ô gõ năm).

### 1.4 Việc còn lại của mục 1

- ⏳ Dòng prod năm 0026: em không ghi prod. Câu sửa (đổi đúng 1 dòng về 11/05/2026) để anh chạy nếu đồng ý:
  `update "OperatingExpense" set "expenseDate" = "expenseDate" + interval '2000 years' where "expenseDate" < '0100-01-01' returning id, "expenseDate";`
  Lưu ý: theo ô ngày thì khách gõ 11/05/26 = ngày 11 tháng 5; nếu khách thật ra muốn 05/11 thì khách tự xóa nhập lại.
- Khoảng hở có sẵn, KHÔNG sửa đợt này: khoản nhập tay ghi ngày tương lai (trong hạn hết năm sau) vẫn lưu được nhưng bộ lọc ngày của trang không cho chọn tương lai → tới ngày đó mới thấy. Toast mới có báo.

## 2. Chi phí định kỳ — hiện trạng liên quan

- Bảng `OperatingExpense` chứa cả thu lẫn chi; mỗi dòng một ngày phát sinh (`expenseDate`), `type` FIXED / VARIABLE, `category` 5 nhóm, ba mức gắn nguồn tiền (gian / sàn / toàn shop).
- **14 chỗ** trong backend đọc bảng này theo `expenseDate` (Báo cáo dòng tiền, Tổng quan, Lãi/Lỗ, Trợ lý, biểu đồ theo ngày, tách cố định / biến đổi). App mobile đọc cùng API, kiểu `"FIXED" | "VARIABLE"`.
- Prod 26/11: 174 dòng, 24 chủ shop dùng; 111 cố định, 59 biến đổi, 4 khoản thu; 0 dòng gắn SKU. Có 7 cụm "cùng tên + cùng số tiền lặp từ 3 lần" (29 dòng, 4 chủ shop, nhiều nhất 5 lần) — tức đã có người nhập tay lặp lại, nhưng chưa nhiều. (Chưa tách tài khoản demo — worker `reviewer-demo-topup` tự thêm chi phí hằng ngày cho tài khoản demo nên con số này có thể gồm demo.)

## 3. Thuật ngữ

- Tên gọi cho khách: **"Chi phí định kỳ"** (kế toán quản trị cũng gọi vậy; tiếng Anh *recurring expense*). Khái niệm gần: "phân bổ chi phí" — trả một cục 3 triệu / tháng rồi chia đều 100 nghìn / ngày. Hai cách nhập ra cùng một kết quả trên báo cáo.
- "Định kỳ" là **cách ghi** (lặp theo lịch), KHÔNG phải một phân loại thứ ba cạnh Cố định / Biến đổi. Tiền kho 100 nghìn / ngày là chi phí CỐ ĐỊNH được ghi định kỳ.

## 4. Hai hướng làm — em chọn A

| | A. Sinh dòng thật mỗi ngày | B. Chỉ lưu luật, báo cáo tự nhân ngày |
|---|---|---|
| Cách chạy | Lưu "luật định kỳ"; mỗi ngày máy tự thêm 1 dòng `OperatingExpense` thường | Không thêm dòng; mỗi báo cáo tự tính số ngày × số tiền |
| Sửa báo cáo | **Không** — 14 chỗ đọc + app mobile giữ nguyên | Phải sửa cả 14 chỗ + mobile, mỗi chỗ gom một kiểu (theo ngày, theo nhóm, theo gian) → dễ hai trang ra hai số |
| Khách bỏ 1 ngày (kho nghỉ) | Xóa dòng ngày đó như khoản thường | Phải thêm bảng "ngày loại trừ" |
| Đổi số tiền giữa chừng | Ngày cũ giữ số cũ, từ mai số mới | Phải lưu lịch sử luật, không thì số quá khứ tự đổi |
| Số dòng | Mỗi luật 365 dòng / năm | 0 |
| Việc nền | 1 câu SQL gộp mỗi giờ | Không |

Lý do chọn A: đúng nguyên tắc "mỗi khái niệm một định nghĩa" — báo cáo không biết và không cần biết khoản chi sinh từ đâu, nên không thể lệch nhau. Giá phải trả là số dòng, tính ở mục 6.

Em **phản đối** cách thêm giá trị thứ ba vào enum `ExpenseType` (FIXED / VARIABLE / RECURRING): các báo cáo đang chia đôi cố định – biến đổi (`off-order-costs.ts` coi mọi thứ không phải FIXED là biến đổi), app mobile đang chạy ngoài kho chỉ biết hai giá trị → khoản định kỳ sẽ rơi nhầm cột hoặc làm app lỗi.

## 5. Thiết kế đề xuất (hướng A)

### 5.1 Dữ liệu

- Bảng mới `recurring_expenses` (bật RLS): `userId`, `name`, `category`, `type` (mặc định FIXED), `amount` (mỗi lần), `cadence` (`DAILY` / `MONTHLY` / `YEARLY` — mục 5.3b; tuần để sau), `startDay`, `endDay` (null được với tháng / năm), nguồn tiền (3 cột như `OperatingExpense`), `note`, `status` (ACTIVE / STOPPED), **`generatedThrough`** (đã sinh tới hết ngày nào), `createdAt`.
- `OperatingExpense` thêm cột `recurringId` (null = khoản nhập tay) để bảng hiện nhãn "Định kỳ" và để dừng / xóa theo luật.

### 5.2 Luật sinh dòng

- Ngày tính theo giờ Việt Nam (`lib/date-range.ts`). Chỉ sinh tới **hôm nay**, không sinh trước ngày tương lai → không có dòng "tàng hình".
- Tạo luật có ngày bắt đầu trong quá khứ → sinh bù ngay trong cùng giao dịch (một câu `INSERT … SELECT generate_series`).
- Việc nền mỗi giờ: MỘT câu SQL gộp cho mọi luật còn hiệu lực có `generatedThrough < hôm nay`, sinh các ngày còn thiếu rồi đẩy mốc, trong một giao dịch, theo lô luật có giới hạn. Không vòng for tuần tự từng khách, không khóa trong RAM, không dùng pg-boss. Worker ngừng 3 ngày thì lượt kế tự sinh bù 3 ngày (đi theo mốc `generatedThrough`, không theo "hôm nay có chạy chưa").
- Vì đi theo mốc nên dòng khách đã xóa tay KHÔNG bị sinh lại.

### 5.3 Giao diện web (một hộp, thêm một lựa chọn)

- Hộp "Thêm chi phí vận hành" thêm dòng **Lặp lại: Một lần · Hằng ngày**. Chọn "Hằng ngày" thì ô "Ngày phát sinh" đổi thành "Từ ngày – Đến ngày", ô số tiền ghi "mỗi ngày", dưới hiện câu tính sẵn: "100.000 đ × 30 ngày = 3.000.000 đ".
- Trang Thu chi vận hành thêm tab **Chi phí định kỳ**: tên, số tiền / ngày, từ – đến, đã ghi bao nhiêu, trạng thái; hai nút **Dừng** (thôi từ ngày mai, giữ các ngày đã ghi) và **Xóa** (hỏi rõ: xóa luật + mọi khoản đã ghi của luật).
- Dòng do luật sinh trong bảng chính có nhãn "Định kỳ"; vẫn xóa từng ngày được.
- Nhân tiện: bỏ chữ `(FIXED)` / `(VARIABLE)` trong ô Phân loại (anh khoanh trong ảnh) — chỉ còn "Cố định" / "Biến đổi".

### 5.3b Chu kỳ hằng tháng / hằng năm (bổ sung 26/11 ~10:10, anh hỏi "họ muốn lặp lại hàng tháng, hàng năm thì sao?")

Cùng một bảng luật, cùng một việc nền — chỉ khác cách tính "ngày tới hạn". Em đề xuất làm luôn trong bản đầu: ô Lặp lại có 4 lựa chọn **Một lần · Hằng ngày · Hằng tháng · Hằng năm**.

- **Hằng tháng:** mỗi tháng ghi MỘT khoản đủ số tiền vào đúng "ngày trong tháng" của ngày bắt đầu (bắt đầu 05/12 → ngày 5 hằng tháng). Tháng không có ngày đó (bắt đầu ngày 31, gặp tháng 2 / tháng 30 ngày) → ghi vào **ngày cuối tháng**; tháng sau có ngày 31 thì quay lại ngày 31.
- **Hằng năm:** mỗi năm ghi một khoản vào đúng ngày – tháng đó; bắt đầu 29/02 thì năm thường ghi 28/02.
- **Kỹ thuật:** ngày tới hạn thứ n = `startDay + n × 1 tháng` (hoặc `n × 1 năm`) tính TỪ NGÀY GỐC, không cộng dồn từ kỳ trước — cộng dồn thì 31/01 → 28/02 → 28/03 và lệch luôn về sau (`generate_series` của Postgres với bước 1 tháng chính là kiểu cộng dồn, không dùng trực tiếp). Mốc `generatedThrough` và luật sinh bù giữ nguyên như hằng ngày.
- **Ngày kết thúc:** hằng tháng / hằng năm cho ĐỂ TRỐNG = lặp tới khi bấm Dừng (tiền thuê, lương, phần mềm thường không biết trước ngày hết; mỗi luật chỉ 12 hoặc 1 dòng / năm nên không cần trần). Hằng ngày vẫn bắt buộc ngày kết thúc, trần 366 ngày.
- **Hộp nhập hiện câu xác nhận** thay cho phép nhân: "Ghi 9.500.000 đ vào ngày 5 hằng tháng, từ 05/12/2026" + ngày ghi kế tiếp.
- **Điều khách cần hiểu (ghi ở dòng phụ trong hộp):** khoản hằng tháng dồn cả cục vào MỘT ngày — xem "7 ngày qua" trúng ngày đó thì lợi nhuận tụt hẳn, y như nhập tay hôm đó; cột Ngân hàng trừ đúng ngày đó (sát với tiền thật rời tài khoản). Muốn lợi nhuận từng ngày mượt thì chọn Hằng ngày và nhập số đã chia (3 triệu / tháng → 100 nghìn / ngày); khi đó cột Ngân hàng lại trừ rải từng ngày, không khớp ngày chuyển khoản thật. Hai cách cho cùng tổng tháng, khác nhau ở từng ngày.
- **Chưa làm bản đầu:** hằng tuần; "nhập tổng tháng rồi máy tự chia đều theo ngày" (tháng 28 / 30 / 31 ngày ra số lẻ khác nhau, phải chốt luật làm tròn — để sau khi có khách hỏi).

### 5.4 Ảnh hưởng số liệu

- Công thức tài chính KHÔNG đổi: dòng sinh ra là `OperatingExpense` thường, vào Dòng tiền / Tổng quan / Lãi-Lỗ / Trợ lý theo đúng đường cũ, trừ cột Ngân hàng của gian đã chọn mỗi ngày.
- Chỉ shop tự tạo luật mới thấy số đổi. Quảng cáo (ROI / ROAS hòa vốn) không đọc bảng này.

## 6. Quy mô

- Hiện tại: 24 chủ shop, 174 dòng.
- Mốc thiết kế 50.000 khách: giả định 10 % dùng định kỳ, mỗi shop 2 luật hằng ngày → 10.000 dòng / ngày ≈ 3,65 triệu dòng / năm (mỗi dòng ~150 byte ≈ 0,5 GB / năm chưa kể chỉ mục). Hai tỉ lệ 10 % và 2 luật là **em tự giả định**, chưa có số đo.
- Cần thêm chỉ mục `(userId, expenseDate)` trên `OperatingExpense` (hiện chỉ có `userId`) trước khi bảng lớn — bảng đang nhỏ nên dựng trong migration được.
- Trần mỗi luật: đề xuất tối đa 366 ngày (hết thì tạo luật mới) — mặc định tự chọn, để một luật gõ nhầm không sinh hàng nghìn dòng.

## 7. Việc anh chốt

1. Đồng ý "định kỳ" là cách ghi (ô **Lặp lại**), không phải phân loại thứ ba? (em đề xuất: đồng ý)
2. Chu kỳ bản đầu: **hằng ngày + hằng tháng + hằng năm** (mục 5.3b; đổi từ đề xuất cũ "chỉ hằng ngày" sau khi anh hỏi tháng / năm); hằng tuần để sau?
3. Ngày kết thúc: hằng ngày **bắt buộc**, trần 366 ngày; hằng tháng / hằng năm cho **để trống** = lặp tới khi bấm Dừng? (em đề xuất: đúng vậy)
3b. Khoản hằng tháng ghi **cả cục vào một ngày** (không tự chia đều theo ngày) — đồng ý? (em đề xuất: đồng ý; ai muốn chia đều thì dùng Hằng ngày)
4. Chỉ khoản **chi**, hay khoản thu cũng định kỳ? (em đề xuất: chỉ chi)
5. Có cho nhập "tổng cả kỳ rồi chia đều mỗi ngày" (3 triệu / 30 ngày) cạnh cách nhập "mỗi ngày 100 nghìn"? (em đề xuất: bản đầu chỉ nhập mỗi ngày, hộp tự hiện tổng)
6. Dòng prod năm 0026 (mục 1.4): anh chạy câu sửa hay để nguyên?

## 8. Lát làm (sau khi anh chốt)

- **Lát 1 — backend:** migration (bảng + cột + chỉ mục + RLS), hàm sinh dòng gộp, API tạo / liệt kê / dừng / xóa luật, test (sinh bù, qua nửa đêm giờ VN, dừng giữa chừng, xóa tay không sinh lại, chạy hai lần không trùng).
- **Lát 2 — web:** ô Lặp lại trong hộp thêm chi phí, tab Chi phí định kỳ, nhãn "Định kỳ"; soi màn 1280–1700 + dark.
- **Lát 3 — worker:** việc nền mỗi giờ + dòng đèn ở HQ Sức khỏe (luật trễ mốc quá 1 ngày).
- **Sau:** app mobile tạo luật (dòng sinh ra thì app đã thấy sẵn, không cần OTA).

## 9. ĐÃ LÀM 26/11/2026 (anh: "Em cứ làm và push nhé")

Làm theo các mặc định ở mục 7: định kỳ là cách ghi (ô Lặp lại), ba chu kỳ ngày / tháng / năm, hằng ngày bắt buộc ngày kết thúc + trần 366 ngày, tháng / năm cho để trống ngày kết thúc, chỉ khoản chi, chỉ nhập "mỗi lần bao nhiêu", bỏ chữ `(FIXED)` / `(VARIABLE)`.

### 9.1 Tệp

| Lớp | Tệp | Việc |
|---|---|---|
| DB | `prisma/migrations/20261126150000_recurring_expenses` | bảng `recurring_expenses` (RLS bật), cột `OperatingExpense.recurringId`, duy nhất `(recurringId, expenseDate)`, chỉ mục `(userId, expenseDate)` |
| Phép tính ngày | `backend/src/lib/recurring-expense.ts` | ngày tới hạn thuần (kẹp cuối tháng tính từ ngày gốc), kiểm lịch, hai trần `DAILY_MAX_DAYS = 366`, `MAX_ACTIVE_RULES = 200` (đều tự chọn) |
| Ghi dòng | `backend/src/services/recurring-expense.ts` | `generateRecurringExpenses` — một câu SQL: khóa lô luật `FOR UPDATE SKIP LOCKED` → bung ngày tới hạn → chèn `ON CONFLICT DO NOTHING` → đẩy mốc `generatedThrough`, luật tới ngày kết thúc thành `ENDED` |
| Đầu vào chung | `backend/src/services/expense-input.ts` | luật "nguồn tiền ba mức + ép Ngân hàng" tách khỏi `routes/expenses.ts` để hai cửa nhập dùng chung |
| API | `backend/src/routes/recurring-expenses.ts` (gắn ở `/api/expenses/recurring`, cùng quyền `finance.expenses`) | `GET /` · `POST /` (ghi bù ngay trong cùng giao dịch) · `POST /:id/stop` · `DELETE /:id` |
| Worker | `backend/src/workers/recurring-expense.ts` | mỗi giờ một lượt (lượt đầu 3 phút sau khi bật); tắt bằng `RECURRING_EXPENSE_OFF=1` |
| Web | `components/finance/add-txn-dialog.tsx` | ô **Lặp lại** (Một lần · Hằng ngày · Hằng tháng · Hằng năm), Từ ngày – Đến ngày, câu tính sẵn, hộp cuộn trong khung khi màn thấp |
| Web | `components/finance/recurring-expenses-tab.tsx` + `app/finance/expenses/page.tsx` | thanh tab `Thu chi` / `Chi phí định kỳ` (PageHeaderBand + PageTabs), bảng luật, hộp hỏi lại Dừng / Xóa, nhãn "Định kỳ" ở bảng thu chi |

Tên API phía web có chữ `Shop` (`fetchShopRecurringExpenses`…) vì `lib/api.ts` đã có sẵn bộ `fetchRecurringExpenses` của **Sổ quỹ HQ** ("chi phí cố định hàng tháng", bảng khác, việc khác) — đừng nhầm hai bộ.

### 9.2 Hành vi chốt

- Tạo luật có ngày bắt đầu ≤ hôm nay → ghi bù ngay, toast báo số khoản đã ghi. Ngày bắt đầu ở tương lai → chưa ghi gì, toast báo ngày ghi đầu tiên.
- Chỉ ghi tới HÔM NAY giờ VN. Khoản của ngày mới được worker ghi muộn nhất khoảng 01:00 (lượt mỗi giờ).
- **Dừng** = ghi nốt khoản của hôm nay (nếu worker chưa kịp) rồi thôi; các khoản đã ghi giữ nguyên. **Xóa** = bỏ luật và MỌI khoản luật đã ghi (hộp hỏi lại nêu số khoản + tổng tiền).
- Xóa tay một khoản (ngày kho nghỉ) ở bảng Thu chi: không bị ghi lại, vì máy đi theo mốc chứ không dò ngày thiếu.
- Luật không sửa được (đổi số tiền = Dừng luật cũ, tạo luật mới từ ngày mai) — số quá khứ không bao giờ tự đổi.
- Gian bị xóa → luật và các khoản tự về "khoản chung" (khóa ngoại `SET NULL`, như khoản nhập tay).
- App mobile: các khoản luật ghi ra hiện trong app như khoản thường (cùng API, không cần OTA). Tạo luật từ app chưa có.

### 9.3 Đã kiểm

- `recurring-expense.test.ts` 11 ca (phép tính ngày + kiểm lịch), `recurring-expense-db.test.ts` 9 ca chạy câu SQL thật trên DB local và so với phép tính thuần (hằng ngày, đã hết kỳ, ngày 31, 29/02, chưa tới ngày bắt đầu, chạy lại không trùng, ghi bù sau khi ngừng, xóa tay không ghi lại, luật đã dừng, lọc theo chủ shop), `expense-date.test.ts` 6 ca.
- Cả bộ backend: 3.074 qua, 21 đỏ — cùng 10 tệp `*-ledger-db` / `ads-*-db` / `channel-delete-db` và cùng số 21 ca đỏ có sẵn ghi ở PROGRESS sáng 26/11 (em không chạy lại trên mã gốc lần này). Kiểm kiểu hai phía + eslint các tệp web đã sửa: sạch.
- Màn local (trình duyệt trong app): tạo "Thuê kho 100.000 ₫ / ngày 01–30/11" → ghi 26 khoản tới 26/11, Báo cáo dòng tiền 01–26/11 ra `totalOperatingExpense` 2.600.000; luật tháng bắt đầu 31/01 ghi đúng 31/01, 28/02, 31/03, 30/04 … 31/10; Dừng, Xóa chạy đúng; bảng luật không tràn ngang ở 1280 với dữ liệu cố tình rất rộng (9,5 tỷ / tháng, tên dài), đã nhìn ở 1700 + giao diện tối. Dữ liệu thử đã xóa.

### 9.4 Chưa làm / chưa kiểm

- **Đèn ở HQ Sức khỏe cho luật trễ mốc**: CHƯA làm (đề xuất ở mục 8 lát 3) — worker chỉ ghi log `[recurring-expense]`. Câu soi tay: `select count(*) from recurring_expenses where status = 'ACTIVE' and "generatedThrough" < (now() at time zone 'Asia/Ho_Chi_Minh')::date - 1;` (khác 0 kéo dài = worker không chạy).
- Chưa nhìn màn prod bằng tài khoản thật; chưa thấy worker prod chạy lượt đầu qua một lần sang ngày.
- Hằng tuần, "nhập tổng tháng rồi máy chia đều", tạo luật từ app mobile, sửa luật tại chỗ: chưa có.
- Dòng prod năm 0026 (mục 1.4): vẫn chờ anh chạy câu sửa.

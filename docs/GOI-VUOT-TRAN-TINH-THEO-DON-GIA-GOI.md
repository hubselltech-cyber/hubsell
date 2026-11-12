# Vượt trần đơn = tính theo đơn giá của chính gói — bản khảo sát TRÌNH ANH (11/11/2026 tối)

> Trạng thái: **ĐÃ CODE, ĐÃ COMMIT + PUSH 11/11/2026 khuya** (mục 9; anh: "Dọn dẹp sạch code thừa… commit rồi push nhé").
> Anh chốt "tính thẳng" (mục 3a). Gói thường bắt đầu bị tính từ tháng 12/2026 — TRƯỚC ngày đó phải sửa chữ landing +
> Điều khoản + Quy chế và báo khách đang trả tiền (mục 9, "CHƯA LÀM").
> Lời anh lúc mở đầu, 11/11 tối: "Khảo sát lại một lần nữa. Anh đang muốn triệt để giải
> quyết câu hỏi của khách hàng là 'Lỡ đang dùng mà vượt thì sao' ⇒ nếu vượt thì sẽ tính theo giá tiền của gói
> tương ứng, ví dụ gói 300 đơn là 99K vậy vượt là tính 99K/300 × số đơn vượt."
> Bản này MỞ RỘNG `docs/ENTERPRISE-TU-PHUC-VU-PHAN-VUOT.md` (phần vượt chỉ cho Enterprise) ra MỌI gói.
> Các điều anh đã chốt cho Enterprise giữ nguyên: thu tháng sau, hạn hết mùng 5, khóa từ mùng 6, trả = "mua
> thêm N đơn hàng", hóa đơn lúc tiền về, đơn giá không giảm theo kỳ, đếm cả đơn hủy.

## 1. Hôm nay khách vượt thì sao (mã thật)

`plan-enforcement.ts`: 80 % chuông → 100 % đỏ + popup → **vượt 120 % hoặc 7 ngày trên trần thì khóa tính năng
nâng cao cho tới khi NÂNG GÓI** (đầu tháng sau tự mở). Nâng gói = trả trọn giá gói trên, kỳ mới tính từ ngày trả,
ngày còn lại của gói cũ mất. Riêng Enterprise (từ chiều 11/11) không khóa. Đúng câu khách sợ: vượt 50 đơn cũng
phải trả gấp đôi hoặc mất tính năng.

Chữ đang hứa với khách theo luật cũ (phải sửa cùng lúc): landing `pricing.tsx:633-647` ("7 ngày ân hạn để nâng
gói"), `faq-cta.tsx:44`, `bang-gia/page.tsx:12`, **Điều khoản `terms/page.tsx:149`**, **Quy chế `quy-che/page.tsx:297`**.

## 2. Công thức anh nêu, áp vào thang giá thật

`đơn giá vượt = giá 1 tháng của gói ÷ trần đơn của gói` (không dùng giá kỳ dài — khớp "65 đ không giảm theo kỳ").

| Gói | Giá tháng | Trần | Đơn giá vượt | Vượt bao nhiêu đơn thì bằng tiền nâng gói trên |
|---|---|---|---|---|
| Starter | 99.000 | 300 | **330 đ** | 303 đơn (tức tại 603 đơn) |
| Growth | 199.000 | 1.000 | **199 đ** | 1.005 đơn (tại 2.005) |
| Pro | 399.000 | 3.000 | **133 đ** | 2.256 đơn (tại 5.256) |
| Business | 699.000 | 10.000 | **69,9 đ** | 7.153 đơn (tại 17.153) |
| Scale | 1.199.000 | 20.000 | **59,95 đ** | không bao giờ (rẻ hơn Enterprise 65 đ) |
| Enterprise | 1.300.000 | 20.000 (khách chọn N) | **65 đ** | — |

Điểm đẹp: Enterprise ra đúng 65 đ từ cùng công thức → **một luật cho mọi gói**, bỏ được nhánh riêng
`pricePerOrder` cho phần vượt. Đơn giá giảm dần theo bậc nên ai vượt nhiều tự thấy nâng gói rẻ hơn.

## 3. Ba chỗ em phản biện (cần anh chốt)

**(a) Hóa đơn sốc ở gói nhỏ.** Khách Starter tháng đó nổ 1.500 đơn: vượt 1.200 × 330 = 396.000 đ, cộng gói =
495.000 đ, trong khi gói Pro (3.000 đơn) chỉ 399.000 đ. Khách ít vào app (ghi nhớ `khach-it-vao-app`) nên không
thấy dải nhắc nâng gói → mùng 2 nhận phiếu đắt hơn cả gói trên → mất lòng đúng chỗ mình định lấy lòng.
**Em đề xuất thêm trần phí vượt: không bao giờ đắt hơn chênh lệch lên gói vừa với số đơn thực tế.**
`phí vượt = min(số đơn vượt × đơn giá gói, giá tháng gói vừa − giá tháng gói đang dùng)`; trên 20.000 đơn thì
"gói vừa" = Enterprise 65 đ × số đơn. Ví dụ trên: min(396k, 399k − 99k = 300k) = 300k → tổng đúng bằng giá Pro.
Câu bán hàng: *"Vượt thì tính đúng đơn giá gói của bạn, và không bao giờ đắt hơn gói vừa với bạn."* Khách mua
12 tháng cũng được lợi: tháng nào vượt trả như gói vừa tháng đó, không phải bỏ kỳ đang chạy để nâng.

**➜ ANH CHỐT 11/11 tối (thay đề xuất trên):** "phải đảm bảo điều kiện là vượt tối đa bao nhiêu đơn cho mỗi gói,
vì tới một nấc cao hơn thì khách phải trả gói cao hơn." → mỗi gói có **NẤC VƯỢT TỐI ĐA**; qua nấc thì tháng đó
tính như gói trên (và leo tiếp theo đơn giá của gói trên). Nấc tự tính từ bảng giá, không nhập tay:
`nấc = phần nguyên((giá tháng gói trên − giá tháng gói này) ÷ đơn giá vượt gói này)`.

| Gói | Vượt tối đa | Tức tới đơn thứ | Phí vượt lớn nhất ở gói này | Qua nấc thì |
|---|---|---|---|---|
| Starter (300) | 303 đơn | 603 | 99.990 đ | tính như Growth: tổng 199k, trần tháng đó 1.000 |
| Growth (1.000) | 1.005 đơn | 2.005 | 199.995 đ | tính như Pro: tổng 399k, trần 3.000 |
| Pro (3.000) | 2.255 đơn | 5.255 | 299.915 đ | tính như Business: tổng 699k, trần 10.000 |
| Business (10.000) | 7.153 đơn | 17.153 | 499.995 đ | tính như Scale: tổng 1.199k, trần 20.000 |
| Scale (20.000) | không có nấc | — | — | cứ theo đơn giá vượt (mục b) |

Ví dụ khách Starter: 450 đơn → vượt 150 × 330 = 49.500 đ. 800 đơn → qua nấc, thu 100.000 đ (bằng chênh lên
Growth), không tính thêm tới 1.000 đơn. 1.500 đơn → 100.000 + 500 × 199 = 199.500 đ (tổng 298.500 đ, vẫn dưới
Pro 399k). Đường tiền đi lên đều, không có chỗ nào vượt thêm một đơn mà tiền nhảy vọt hay tụt xuống.
Phiếu vẫn một dòng "mua thêm N đơn hàng" với N = số đơn vượt thật, thành tiền theo bậc thang.

⏳ **Còn một câu:** qua nấc thì (1) máy TỰ tính như gói trên cho tháng đó, thu đầu tháng sau, thuê bao giữ
nguyên gói cũ, không khóa gì giữa tháng — em đề xuất; hay (2) BẮT khách mua gói trên ngay lúc chạm nấc, chưa
mua thì khóa tính năng nâng cao — đúng nghĩa đen "phải trả gói cao hơn" nhưng mang lại cảnh khóa giữa tháng mà
anh đang muốn gỡ, và khách mua kỳ dài mất ngày còn lại của gói cũ.

**➜ ANH NGHĨ LẠI 11/11 tối (CHƯA CHỐT):** "có cần thiết phải siết trần số đơn vượt không? Vì nếu tính từng đơn
theo gói thấp thì họ phải trả nhiều tiền hơn nếu không nâng gói." Em cân lại và **nghiêng theo anh: BỎ nấc, tính
thẳng**, vì một điều em bỏ sót ở trên: có nấc thì mua Starter 99k rồi để máy tự leo bậc luôn bằng tiền với mua
đúng gói → không ai còn lý do trả trước gói lớn; mọi khách thành trả sau, mình gánh rủi ro quỵt một tháng. Tính
thẳng thì đơn giá cao của gói thấp chính là lực đẩy khách mua đúng gói từ đầu. Nấc chỉ bảo vệ khách không đọc
thông báo (Starter 3.000 đơn: 99k + 891k = 990k so với Pro 399k). Bỏ nấc thì cần hai thứ đi kèm:
(1) báo đúng lúc tiền vượt chạm mức chênh lên gói trên (chuông + thư + báo sale), có một nút Nâng gói;
(2) nâng gói TRONG tháng thì trần gói mới áp cho cả tháng đó (phần vượt tạm tính của tháng tự hết) — ⏳ chờ anh
gật. Ca khách kêu sau khi đã chốt phiếu: HQ bấm Miễn / giảm tay.

**✅ ANH CHỐT 11/11 tối: "Chốt tính thẳng".** KHÔNG có nấc vượt tối đa, không leo bậc: phí vượt = số đơn vượt ×
đơn giá gói đang dùng, bao nhiêu cũng vậy. Nâng gói trong tháng thì trần gói mới áp cho cả tháng đó. Báo khách +
báo sale khi tiền vượt tạm tính chạm mức chênh lên gói trên (Starter đơn thứ 603 · Growth 2.005 · Pro 5.255 ·
Business 17.153 — tính từ bảng giá, không nhập tay). Bảng nấc + đề xuất trần ở trên chỉ còn là tư liệu.
⛔ Đừng đề xuất lại nấc / trần phí vượt.

**(b) Scale vượt 59,95 đ rẻ hơn Enterprise 65 đ.** Scale 30.000 đơn = 1.199k + 600k = 1.799k; Enterprise 30.000
= 1.950k. Khách biết tính sẽ mua Scale rồi cứ để vượt; Enterprise tự phục vụ vừa làm chỉ còn hơn ở "không giới
hạn gian / nhân viên" (Scale 40 gian). Hai lối: (1) chấp nhận — đúng tinh thần anh nói sáng nay "gặp khách biết
tính toán thì phải chịu, mình vẫn lãi là được" (60 đ vẫn trên chi phí 24–60 đ/đơn nhưng mỏng); (2) đặt sàn
đơn giá vượt = 65 đ cho gói có đơn giá thấp hơn (chỉ Scale dính). Em nghiêng (2): giữ thang giá một chiều, chênh
5 đ/đơn khách không cãi.

**(c) Doanh thu nâng gói sẽ giảm ở vùng vượt ít.** Growth 1.200 đơn: luật cũ ép lên Pro (+200k) hoặc khóa; luật
mới thu 200 × 199 = 39.800 đ. Đổi lại: hết lý do từ chối lúc mua, hết cảnh khóa giữa tháng. Em đồng ý đổi, chỉ
nói rõ cái giá. **Chưa đo prod** có bao nhiêu khách đang ở vùng 100–150 % trần (câu SQL ở mục 7).

## 4. Các luật kèm theo (mặc định em chọn, anh gạt được)

| Việc | Đề xuất | Vì sao |
|---|---|---|
| Khóa 120 % / 7 ngày | **BỎ cho mọi kỳ đã trả tiền**; thay bằng khóa `OVERAGE_UNPAID` từ mùng 6 nếu chưa trả | đúng ý "triệt để"; một luật với Enterprise |
| Đang DÙNG THỬ mà vượt | **giữ luật cũ** (khóa mềm, mua gói là mở) | chưa có quan hệ thanh toán, không có gì để thu; trần thử mặc định Scale 20.000 nên hiếm chạm |
| Mua / đổi gói giữa tháng | trần tháng = Σ (trần gói × phần tháng kỳ đó phủ); chỉ đếm đơn phát sinh trong kỳ đã trả; đơn giá = gói đang phủ lúc cuối tháng | nếu đếm cả tháng như hiện nay thì khách thử Scale 5.000 đơn rồi mua Growth ngày 20 sẽ bị tính vượt 4.000 đơn — sai |
| Chụp đơn giá | lưu trần + đơn giá vượt trên TỪNG khoản thanh toán (`package_payments`) lúc mua | HQ sửa bảng giá sau không đổi điều đã bán |
| Khách đang trả tiền (mua theo luật cũ) | áp luật mới **từ tháng 12** cho mọi người, báo một lần (chuông + thư) | có trần ở (a) thì luật mới không bao giờ tốn hơn luật cũ; điểm khác duy nhất: nợ vượt treo tới khi trả hoặc HQ Miễn, luật cũ thì sang tháng tự mở |
| Rủi ro quỵt | mua Starter 99k chạy 20.000 đơn rồi không trả: mất chi phí hạ tầng một tháng (8–28 đ/đơn ≈ 160–560k), khóa từ mùng 6 | không thêm khóa giữa tháng (trái ý "triệt để"); báo HQ khi tạm tính vượt > 500k để anh gọi (ngưỡng em tự chọn) |
| Trần gian / nhân viên | **giữ chặn cứng** — phí vượt chỉ áp cho số đơn | khách hỏi "vượt" là hỏi đơn; gian thì nâng gói |
| iOS | app vẫn không nhắc giá / phí vượt (câu trung tính có sẵn); trả trên web | rủi ro 3.1.1 không đổi so với Enterprise hôm nay; khách mua gói qua IAP rồi vượt sẽ phải lên web trả — chấp nhận |
| "Gói mua thêm 1.000 đơn ~90k" (hoãn 19/09) | **thôi hẳn** — luật này thay thế | |

## 5. Khách thấy gì

- Lúc mua (bảng giá, landing, FAQ): một dòng dưới mỗi gói "Vượt: 330 đ/đơn, tính đầu tháng sau" + ô cam kết đổi
  chữ: "Vượt trần? Vẫn dùng đủ mọi tính năng. Phần vượt tính theo đúng đơn giá gói của bạn, thanh toán trước
  hết mùng 5 tháng sau."
- Trong tháng khi vượt: dải vàng "Đang vượt N đơn ≈ X đ" + MỘT nút; khi nâng gói đã rẻ hơn thì nút là "Nâng lên
  Pro (rẻ hơn)", chưa thì không có nút nào (chỉ thông tin).
- Mùng 2: chuông + thư "Tháng 11 vượt N đơn × 330 đ = X đ — hạn hết 05/12" + một nút Thanh toán (payOS / QR Hubsell).
- Mùng 6 chưa trả: khóa tính năng nâng cao, cùng nút đó; trả hoặc HQ Miễn là mở ngay.

## 6. Ảnh hưởng tới việc tối nay

- Việc 1 (3 bước yêu cầu mua gói dễ thấy): không đổi, làm được ngay.
- Việc 2–3 (thu phần vượt + khóa quá hạn): **may chưa code** — nay dựng chung cho mọi gói ngay từ đầu thay vì chỉ
  gói tính theo đơn. Schema ở ENTERPRISE doc mục 3 dùng lại, thêm 2 cột chụp trên `package_payments`
  (`orderCap`, `overageUnitPrice`); câu SQL chốt mùng 2 gom mọi kỳ đã trả thay vì lọc `minOrdersPerMonth`.
- Việc 5 (chữ nhỏ) phình ra: landing + FAQ + Điều khoản + Quy chế phải đổi cùng ngày bật.
- Phiếu đầu tiên vẫn là 02/12 → còn 3 tuần, không gấp bằng việc 1.

## 7. Chưa kiểm

- Prod: bao nhiêu thuê bao đã trả tiền đang ≥ 100 % trần tháng này (SQL chỉ đọc, gõ một dòng):
  `SELECT p.code, count(*) FILTER (WHERE o.n >= p."maxOrdersPerMonth") AS vuot, count(*) AS tong FROM subscriptions s JOIN service_plans p ON p.id = s."planId" JOIN LATERAL (SELECT count(*) AS n FROM orders o JOIN channels c ON c.id = o."channelId" WHERE c."userId" = s."userId" AND o."createdAt" >= date_trunc('month', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh') o ON true WHERE s."isTrial" = false AND s."currentPeriodEnd" > now() GROUP BY p.code;`
  (tên bảng / cột theo schema Prisma, chưa chạy thử.)
- Giá gói trên prod em lấy từ landing `pricing.tsx:65-99` + ghi nhớ 19/09, chưa mở HQ đối chiếu.
- Điều khoản đổi cách tính tiền với khách đã mua kỳ dài: nên hỏi nhanh bên pháp lý / kế toán một câu.

## 9. ĐÃ CODE (11/11 tối — commit + push 11/11 khuya)

Anh: "Chốt tính thẳng" → "Em thiết kế local trước nhé" → "Làm theo đề xuất" (3 câu còn lại lấy theo đề xuất
của em, đều là chỗ đổi được — xem bảng cuối mục).

**Lõi tính tiền — `backend/src/services/plan-overage.ts`**
- `overageUnitPrice(plan, floor)`: giá tháng ÷ trần; gói tính theo đơn = giá công bố. `overageAmount`: tròn tới đồng.
- **MỘT câu SQL** `overageRowsSql` cho cả tạm tính (`monthOverageFor`) lẫn chốt (`closeMonthOverage`: `INSERT … SELECT
  … ON CONFLICT DO NOTHING`, không vòng for). Luật của tháng: chỉ xét kỳ ĐÃ TRẢ TIỀN (`package_payments` kind PLAN)
  có phần nằm trong tháng; gói áp cho tháng = kỳ có **trần cao nhất** (nâng gói giữa tháng → trần mới áp cả tháng);
  trần tháng = trần × phần tháng được phủ (làm tròn lên); chỉ đếm đơn trong phần được phủ, kể cả đơn hủy;
  KHÔNG đếm đơn gian OFFLINE (bán tại quầy).
- Mỗi lần mua gói chụp `orderCap` + `overageUnitPrice` lên chứng từ (HQ sửa giá sau không đổi điều đã bán); khoản cũ
  chưa chụp thì lúc chốt đọc bảng giá hiện hành.
- `upgradeBreakEvenOrder`: mốc BÁO "nâng gói rẻ hơn" (603 / 2.005 / 5.255 / 17.153) — chỉ báo, không đổi cách tính.

**Schema — migration `20261111210000_plan_overage_charges`** (chỉ thêm): bảng `plan_overage_charges` (ENABLE RLS,
unique chủ shop + tháng, trạng thái NONE / OPEN / PAID / WAIVED); `package_payments.kind` (PLAN / OVERAGE) +
`orderCap` + `overageUnitPrice` + `overageChargeId`; `gateway_payment_orders.overageChargeId`.

**Chốt đầu tháng — `workers/plan-overage-close.ts`**: từ 06:00 mùng 2 giờ VN chốt tháng trước, thử mỗi giờ (chủ đã
có phiếu bị bỏ qua trước khi đếm đơn nên lượt thừa gần như không tốn gì; worker ngừng vài ngày bật lại tự chốt bù).
Chủ không vượt nhận dòng NONE. Có phiếu → chuông cho khách + một thư tổng cho HQ. Tắt: `PLAN_OVERAGE_CLOSE_OFF=1`.

**Khóa — `plan-enforcement.ts`**: kỳ đã trả tiền thì KHÔNG còn khóa 120 % / 7 ngày; phiếu OPEN quá `dueAt` (00:00
mùng 6) → `OVERAGE_UNPAID`, ưu tiên EXPIRED > OVERAGE_UNPAID > ORDERS; đơn + tồn vẫn đồng bộ. `/me` thêm khối
`overage` (đơn giá, tạm tính, mốc nâng gói, phiếu chờ trả) và `orders.planCap`; mỗi gói trên bảng giá có
`overageUnitPrice`. Nợ đi theo chủ shop: hạ gói / hết hạn vẫn còn.

**Rào khi lên prod (thêm lúc dọn 11/11 khuya)**: không bao giờ tính lùi trước `OVERAGE_FIRST_MONTH` = 11/2026; gói
tính theo đơn chỉ tính kỳ CÓ ghi số đơn đã chọn (kỳ mua từ khi tự phục vụ lên sóng, khách đã đọc câu báo phần vượt) —
khoản Enterprise HQ ghi tay kiểu cũ thì không; bảng giá ghi "· vượt 330 ₫/đơn (từ 12/2026)" cho tới khi gói thường
thật sự được tính (`/me` trả `overageStartMonth`).

**Trả tiền — `plan-overage-payment.ts` + `gateway-checkout.ts`**: `recordOveragePayment` = chứng từ kind OVERAGE →
sổ quỹ ("Thu phí mua thêm N đơn hàng tháng mm/yyyy") → HĐĐT (`hqItemNameFor` ra đúng **"Gói phần mềm Hubsell - mua
thêm N đơn hàng"**) → hoa hồng 10 %, KHÔNG gia hạn thuê bao. Giành phiếu bằng một câu UPDATE có điều kiện nên webhook
bắn lặp / HQ ghi tay sau cổng không thu đôi. payOS: `POST /api/subscription/overage/:id/checkout`, nội dung CK
`HS VUOTmmyy <mã đơn>`; phần mở đơn + link tách thành `openGatewayOrder` dùng chung với mua gói. Phiếu đã miễn mà
tiền vẫn về → đơn MISMATCH + thư HQ, không ghi chứng từ. `waiveOverageCharge` bắt buộc lý do + nhật ký.

**Giao diện**
- Khách: dải dưới header (phiếu chờ trả → nút Thanh toán; đang vượt → "Đang vượt N đơn ≈ X ₫ (tạm tính)", tới mốc
  thì nút "Nâng lên <gói trên>", chưa tới thì "Xem chi tiết" — hết nút "Nâng gói" vô nghĩa của gói tính theo đơn);
  `/settings/plan` khối `#phi-vuot` (`components/settings/overage-panel.tsx`) một nút Thanh toán; bảng giá ghi
  "300 đơn / tháng · vượt 330 ₫/đơn"; màn khóa riêng cho nợ phí vượt với một nút "Thanh toán phần vượt"; hộp payOS
  đổi chữ "Mua thêm N đơn hàng". Mobile để nguyên (câu trung tính có sẵn).
- Tệp: `components/shell/overage-charge-popup.tsx` (popup), `components/settings/overage-panel.tsx` (khối trả tiền),
  `components/admin/overage-charges-section.tsx` (HQ), `lib/overage.ts` (chữ + mốc dùng chung).
- **Popup phiếu phí vượt** (anh 11/11: "Thêm popup"): một lần cho mỗi phiếu khi chủ shop mở app, một lần nữa khi
  phiếu sang quá hạn; một nút "Thanh toán <số tiền>" mở thẳng mã QR tại trang đang đứng. Gạt đi là thôi (dải nhắc
  vẫn còn); không đè lên hộp khác của trang (đợi hộp kia đóng). Trong tháng đang vượt thì KHÔNG có popup, chỉ dải.
- Nội dung chuyển khoản: `HS VUOT<mm><yy> <8 số cuối mã đơn>` (vd `HS VUOT1026 62868206`); mã đơn payOS 16 chữ số như
  mua gói. Cần `PAYOS_DESCRIPTION_MAX=25` — ✅ prod đang là 25: ảnh anh chụp 11/11 ~22:00 hiện nội dung
  `HS ENTERPRISE 08172704` (22 ký tự, có đuôi mã đơn) nên phí vượt sẽ ra đủ `HS VUOT1126 <8 số>`.
- Dev: cổng payOS giả lập `backend/scripts/dev-payos-mock.mjs` + cấu hình `backend-http-payos` (`.claude/launch.json`);
  `GET http://localhost:4099/mock/pay/<mã đơn>` = giả lập tiền về.
- HQ `/admin/plans`: khối "Phí vượt trần đơn" (`components/admin/overage-charges-section.tsx`, tự ẩn khi chưa có
  phiếu) — Ghi nhận chuyển khoản tay + Miễn; bảng Thanh toán gần đây ghi rõ khoản phí vượt.
- Báo sale (thư HQ, mỗi mốc một lần mỗi tháng): gói tính theo đơn chạm 80 % / vượt; gói thường tới mốc nâng gói rẻ hơn.

**Kiểm**: vitest `plan-overage` 22 ca + `overage-checkout` 4 ca (cổng giả lập) + `per-order-plan`, `plan-enforcement`,
`subscription-payment` → xanh; tsc 2 phía + eslint tệp sửa sạch. Local: tài khoản thử Enterprise 25.000 đơn mua
11/11 → trần tháng 11 = 16.177, seed 16.877 đơn → "đang vượt 700 đơn × 65 ₫ ≈ 45.500 ₫"; phiếu tháng 10 thử
80.210 ₫ → dải vàng + khối trả; cho quá hạn → API tài chính 403 `OVERAGE_UNPAID` + màn khóa; HQ Ghi nhận → phiếu
"Đã trả", khách mở khóa ngay, kỳ hạn gói không đổi.

**Ba mặc định em tự chọn (anh "Làm theo đề xuất") — đổi ở đâu**
| Việc | Đang đặt | Đổi ở |
|---|---|---|
| Scale vượt | sàn = giá công bố của gói tính theo đơn (65 ₫) | `overageFloorPrice()` trả null là bỏ sàn |
| Khách đang trả tiền | gói thường tính từ tháng **12/2026**; gói tính theo đơn tính từ tháng mua | `OVERAGE_START_MONTH` |
| Dùng thử vượt | giữ khóa mềm 120 % / 7 ngày | nhánh `overageEligible` trong `plan-enforcement.ts` |

**CHƯA LÀM / CHƯA KIỂM**
- Chưa chạy nút Thanh toán với payOS thật (local không bật cổng — đường tiền mới kiểm bằng cổng giả lập trong test).
- Thư cho KHÁCH khi có phiếu (hiện chỉ chuông); thư HQ khi phiếu quá hạn; hiện các mốc báo sale ở HQ Khách hàng.
- Chữ landing + FAQ + **Điều khoản** + **Quy chế** (đang ghi luật khóa 120 % / 7 ngày) — phải sửa cùng ngày bật.
- Thẻ Enterprise ở HQ còn ghi "bán bằng tư vấn"; hộp SĐT ở giao diện sáng.
- ~~Đơn của gian OFFLINE (bán tại quầy) có tính vào trần không~~ ✅ Anh chốt 11/11 tối: **"Không tính"**. Đã sửa cả
  ba chỗ đếm cho cùng một định nghĩa "đơn của gian trên sàn": câu SQL phí vượt, thanh mức dùng + luật khóa mềm
  (`plan-enforcement.ts`), cột "Đơn tháng này" ở HQ Gói dịch vụ. Hệ quả: khách có bán tại quầy thấy số đơn tháng
  THẤP hơn trước (không ai bị siết thêm).
- Thông báo trước cho khách đang trả tiền về luật mới từ 12/2026 (chưa soạn).

## 8. Anh chốt giúp 4 câu

1. ~~Có trần "không đắt hơn gói vừa" / nấc vượt tối đa không?~~ ✅ Anh chốt 11/11 tối: **KHÔNG — tính thẳng**;
   nâng gói trong tháng thì trần mới áp cả tháng.
2. ~~Scale vượt 59,95 đ hay nâng sàn 65 đ?~~ ✅ Anh 11/11: "Làm theo đề xuất" → sàn 65 đ.
3. ~~Khách đang trả tiền: áp từ tháng 12 cho tất cả, hay chỉ từ kỳ họ gia hạn?~~ ✅ "Làm theo đề xuất" → tháng 12 cho tất cả.
4. ~~Dùng thử vượt: giữ khóa mềm như cũ?~~ ✅ "Làm theo đề xuất" → giữ.
5. ✅ Đơn bán tại quầy (gian OFFLINE): anh "Không tính". ✅ Popup khi có phiếu: anh "Thêm popup".

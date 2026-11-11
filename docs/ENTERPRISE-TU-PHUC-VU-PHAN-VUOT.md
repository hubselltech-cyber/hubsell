# Enterprise tự phục vụ + phần vượt trần — bản thiết kế TRÌNH ANH (11/11/2026)

> Trạng thái (cập nhật 11/11/2026 tối): **lát 1 — mua Enterprise tự phục vụ — ĐÃ LÊN PROD** (commit `85add773`, mục 9).
> **Phần vượt (mục 4, 5, 5b, lát 2–3 ở mục 7) ĐÃ ĐƯỢC THAY** bằng luật "tính thẳng" cho mọi gói — đọc
> `docs/GOI-VUOT-TRAN-TINH-THEO-DON-GIA-GOI.md`; các mục đó ở đây chỉ còn là tư liệu lúc khảo sát.
> Bối cảnh: khách Tran Văn Long chốt Enterprise qua Zalo 11/11, muốn tự trả trên app (memory
> `hubsell-yeu-cau-mua-goi-bi-lot-2026-11-11`). Giá gốc: `docs/GIA-ENTERPRISE-THEO-DON.md`.
> Anh chốt: (1) khách tự nhập số đơn (tối thiểu 20.000) → ra tiền; (2) phần vượt: tới khoảng
> mùng 3–4 tháng sau phải trả, không trả thì dừng tính năng nâng cao.

## 1. Chỗ hướng sáng nay SAI / THIẾU (tìm thấy khi đọc mã thật)

| # | Phát hiện | Bằng chứng | Hệ quả nếu làm theo hướng cũ |
|---|---|---|---|
| 1 | **Khóa trần đơn hiện có sẽ khóa khách Enterprise giữa tháng** | `plan-enforcement.ts:228-231` khóa khi ≥ 120 % hoặc 7 ngày sau khi chạm 100 % | Lấy số cam kết làm trần → khách vượt 20 % là bị khóa ngay, trái lời hứa "vượt thì tháng sau trả". Gói tính theo đơn phải TẮT nhánh khóa ORDERS, chỉ giữ chuông. |
| 2 | **Số cam kết không được lưu trên Subscription** | Thuê bao chỉ có một kỳ hiện tại; `recordPackagePaymentTx` nối tiếp kỳ khi gia hạn cùng gói (`subscription-service.ts:176-182`) | Khách gia hạn sớm với số mới thì số mới đè luôn kỳ đang chạy. Phải lưu số cam kết **trên từng khoản thanh toán (PackagePayment)** — kỳ nào số nấy, "đổi số áp từ kỳ sau" tự đúng, không cần cột hẹn. |
| 3 | **Mua giữa tháng: đếm cả tháng là sai** | Đếm đơn theo tháng dương lịch từ mùng 1 (`plan-enforcement.ts:175-177`) | Mua 28/11 kỳ 1 tháng sẽ được trọn 20.000 cho tháng 11 + trọn 20.000 cho tháng 12 = 40.000 đơn cho 1 tháng tiền. Ngược lại, đơn từ 1–27/11 (lúc chưa mua) lại bị tính. → **chia theo thời gian phủ kỳ** (mục 4). |
| 4 | **Backfill không làm phồng tháng** (hướng cũ đúng) | `Order.createdAt` = giờ sàn, mọi luồng upsert ghi đè (`plan-enforcement.ts:24-28`) | Đơn tháng trước kéo về không rơi vào tháng này. Nhưng **đơn về trễ** (đồng bộ chậm, gian ngủ đông vét bù ≤ 90 ngày) tới sau lúc chốt → chốt lúc **06:00 mùng 2** chứ không phải nửa đêm mùng 1; con số đã chốt là cuối cùng (đơn về sau nữa không tính thêm — khách có lợi). |
| 5 | **Cổng payOS đang chặn Enterprise cứng** | `gateway-checkout.ts:127-129`; giá lấy `planPriceFor(plan, cycle)` | Phải thêm số đơn vào đơn cổng (`GatewayPaymentOrder`) và máy chủ tính giá; khách không gửi giá lên. |
| 6 | **Bật "Đang bán" cho Enterprise sẽ làm nó hiện như gói thường** | `/me` trả mọi gói `isActive` vào `upgradePlans` (`routes/subscription.ts:258-275`); payOS lại đòi `isActive` | Phải loại gói tính theo đơn khỏi `upgradePlans`, nếu không ma trận giá có hai hàng Enterprise. |
| 7 | **Phần vượt không lọt vào khuôn PackagePayment hiện có** | `RecordPaymentInput` bắt buộc gói + kỳ + gia hạn (`subscription-service.ts:140-236`) | Cần một loại khoản thu thứ hai (cột `kind` = PLAN / OVERAGE) dùng chung chứng từ → sổ quỹ → HĐĐT → hoa hồng, nhưng KHÔNG gia hạn thuê bao. HĐĐT tự động chỉ chạy khi bút toán có `packagePaymentId` (`hq-auto-invoice.ts:102-112`) — đi chung PackagePayment là tự có hóa đơn. |
| 8 | **Khách Tran Văn Long trả Enterprise đắt hơn Scale cho cùng trần** | SQL 11/11: 1 gian, ≈ 13.000 đơn/tháng; Scale 20.000 đơn = 1.199.000; Enterprise tối thiểu 20.000 = 1.300.000 | Khách được thêm: không giới hạn gian/nhân viên, vượt không bị khóa. Nhưng với 1 gian + 13k đơn, Scale rẻ hơn 101k/tháng (12 tháng: 11,99 tr so với 12,99 tr). Ghi nhớ cũ "Enterprise ≈ 850k rẻ hơn Scale" chỉ đúng khi không có mức tối thiểu. **Anh quyết có nói với khách không.** |
| 9 | Mobile: lý do khóa mới tự rơi vào chữ "vẫn đồng bộ" | `hubsell-mobile/src/plan/plan-ui.ts:61` chỉ tách EXPIRED; `client.ts:114-116` thay mọi lỗi PLAN_* bằng một câu trung tính | Phần vượt chưa trả đúng là vẫn đồng bộ → chữ mobile đúng sẵn, **không cần build/OTA**. |
| 10 | iOS: Enterprise không có sản phẩm IAP | `apple-iap/products.ts:28-30` loại ENTERPRISE; app không có chữ/link ra web | Không thêm gì vào iOS. Rủi ro 3.1.3(b) (gói mua ngoài phải mua được trong app) đã tồn tại từ trước với Enterprise bán tư vấn; giữ nguyên: app không nhắc Enterprise, không nhắc phí vượt, không link web. |

## 2. Luồng khách (web, một nút)

1. `/settings/plan` → hàng **Enterprise** trong bảng giá có ô **"Số đơn mỗi tháng"** (điền sẵn 20.000; gợi ý = số đơn tháng trước của shop làm tròn lên nghìn nếu > 20.000).
2. Chọn kỳ bằng 4 ô giá như các gói khác → giá sống ngay dưới ô (máy chủ tính, kèm "≈ X đ/đơn").
3. Bấm **Thanh toán ngay** → popup payOS như gói thường → tiền về là mở gói.
4. Câu nhỏ dưới nút: "Tính mọi đơn phát sinh trên sàn trong tháng. Vượt số đã chọn: 65 đ/đơn, Hubsell báo ngày mùng 2 tháng sau, thanh toán trước hết ngày mùng 4."
5. Nhập < 20.000 → nút tắt, chữ đỏ "Tối thiểu 20.000 đơn". Nhập > 50.000 → nút đổi thành **Đăng ký tư vấn** (mục 5).

Phần vượt: mùng 2 chuông + thư "Tháng 11 vượt 1.234 đơn × 65 đ = 80.210 đ — hạn 04/12" → `/settings/plan` có dải vàng với **một nút Thanh toán** (QR payOS). Quá hạn → dải đỏ + màn khóa tính năng nâng cao, cùng nút đó.

## 3. Thay đổi schema (một migration, mọi bảng mới ENABLE RLS)

- `service_plans.minOrdersPerMonth Int?` — khác null = **gói tính theo đơn** (Enterprise = 20.000). Bốn cột giá có sẵn = giá ở mức tối thiểu (1,3 tr / 3,69 tr / 6,99 tr / 12,99 tr). `pricePerOrder` (65, có sẵn) = đơn giá phần vượt.
- `package_payments.kind` enum `PLAN | OVERAGE` (mặc định PLAN) + `committedOrders Int?` + `overageChargeId String?`.
- `gateway_payment_orders.committedOrders Int?` + `overageChargeId String?`.
- Bảng mới `plan_overage_charges`: ownerId, month `yyyy-MM`, committedCap (đã chia theo thời gian), ordersCounted, overOrders, unitPrice, amount, status `OPEN | PAID | WAIVED`, dueAt, paidAt, packagePaymentId, waivedBy/Note; `@@unique([ownerId, month])`.
- KHÔNG thêm cột vào `subscriptions`: số cam kết hiện hành = `committedOrders` của khoản thanh toán đang phủ thời điểm này (null → `minOrdersPerMonth`, để khoản ghi tay trước khi lát 1 lên vẫn đúng).

## 4. Công thức

**Giá kỳ:** `Giá(N, kỳ) = làm tròn tới nghìn( giá_kỳ_ở_mức_tối_thiểu × N ÷ 20.000 )`

| Kỳ | N = 20.000 (đã báo khách) | Kiểm | N = 30.000 |
|---|---|---|---|
| 1 tháng | 1.300.000 × 1 = **1.300.000** | = 20.000 × 65 ✓ | 1.950.000 |
| 3 tháng | 3.690.000 × 1 = **3.690.000** | hệ số 0,946 (−5,4 %) ✓ | 5.535.000 |
| 6 tháng | 6.990.000 × 1 = **6.990.000** | hệ số 0,896 (−10,4 %) ✓ | 10.485.000 |
| 12 tháng | 12.990.000 × 1 = **12.990.000** | hệ số 0,833 (≈ tặng 2 tháng) ✓ | 19.485.000 |

Vì sao không dùng hệ số: 4 con số đã báo là số làm tròn kiểu "…990"; nhân tỷ lệ trên chính 4 ô giá thì ra đúng y ở 20.000, giá vẫn là DATA sửa ở HQ, không có hằng số mới trong mã.

**Trần tháng M (chia theo thời gian phủ kỳ):** `trần_M = Σ_kỳ committedOrders × (thời gian kỳ nằm trong M ÷ độ dài M)`; chỉ đếm đơn có `createdAt` nằm trong các khoảng kỳ đã trả. Ví dụ khách trả 11/11 18:00, kỳ 1 tháng: tháng 11 trần ≈ 20.000 × 19,25/30 ≈ 12.833, chỉ đếm đơn từ 11/11 18:00.

**Phần vượt:** `max(0, đơn_đếm − trần_M) × 65`, không giảm theo kỳ. Đếm **cả đơn hủy** (đúng định nghĩa trần đang hiển thị cho mọi gói).

**Chốt:** worker 06:00 mùng 2 giờ VN, MỘT câu `INSERT … SELECT … GROUP BY ownerId … ON CONFLICT (ownerId, month) DO NOTHING` cho mọi khách gói theo đơn (không vòng for, chạy lại vô hại, chỉ 1 worker vì có unique). Đếm đơn bằng chỉ mục `(channelId, createdAt)` có sẵn.

## 5. Luật phần vượt + các mặc định em tự chọn

| Luật | Giá trị | Nguồn |
|---|---|---|
| Hạn trả | ~~hết mùng 4~~ → **hết 23:59 mùng 5; khóa từ 00:00 mùng 6** (hằng số `OVERAGE_DUE_DAY` trong `per-order-plan.ts`, /me trả `overageDueDay`) | anh chốt lại 11/11 chiều: "tính 65đ/1 đơn vượt và thanh toán vào mùng 5 của tháng tiếp theo" |
| Khóa | lý do mới `OVERAGE_UNPAID` qua `requirePlanUnlocked`, cùng nhóm API nâng cao; đơn + tồn vẫn đồng bộ, không ngủ đông | anh chốt; thứ tự ưu tiên EXPIRED > OVERAGE_UNPAID > ORDERS |
| Trần tự phục vụ | **50.000 đơn**; trên mức đó chuyển Đăng ký tư vấn | căn cứ `GIA-ENTERPRISE-THEO-DON.md`: 65 đ là giá niêm yết vùng 20–50k; từ 50k đắt gấp 1,5–2,2 lần đối thủ, giá sàn HQ 45/33 đ — khách lớn tự mua 65 đ là trả đắt rồi bỏ đi |
| Khoản nhỏ | ~~miễn dưới 20.000 đ~~ **BỎ** — anh 11/11: "vượt thêm 100 đơn ⇒ yêu cầu thanh toán 100 đơn đó vào tháng tiếp theo" (6.500 đ vẫn thu). Kỳ 3/6/12 tháng vẫn tính và thu TỪNG THÁNG; trần không cộng dồn tháng thiếu sang tháng sau | anh chốt |
| Chốt lúc | 06:00 mùng 2 | **em tự chọn** — cho đơn về trễ 1 ngày kịp vào số |
| Tăng số giữa kỳ | KHÔNG làm; muốn tăng thì số mới áp từ kỳ gia hạn | **em tự chọn** — vượt đã tính 65 đ = đúng giá tháng, khách không thiệt khi kỳ tháng |
| Đang dùng thử mà trả Enterprise | kỳ bắt đầu lúc trả (giữ luật chung) | **em tự chọn**; khách Long muốn dùng hết thử thì trả 21/11 |
| Hạ gói / hết hạn khi còn nợ vượt | vẫn cho mua/gia hạn; nợ vẫn treo, khóa vẫn áp tới khi trả hoặc HQ Miễn | **em tự chọn** — tiền vào luôn được nhận |
| Hoa hồng giới thiệu 10 % | **có** áp trên phần vượt | căn cứ: luật "hoa hồng vĩnh viễn mọi lượt thanh toán" (`subscription-service.ts:306-337`) + `GIA-ENTERPRISE-THEO-DON.md` mục 2 đã tính 6,5 đ/đơn |
| HĐĐT phần vượt | "Gói phần mềm Hubsell - mua thêm N đơn hàng", xuất lúc tiền về (mục 5b) | anh chốt 11/11 |
| Nội dung CK payOS | gói: `HS ENTERPRISE 12345678` (22 ký tự ≤ 25); vượt: `HS VUOT1126 12345678` | `PAYOS_DESCRIPTION_MAX=25` đã bật |
| HQ | danh sách phí vượt (tháng, khách, số, trạng thái) + nút **Miễn** (ghi lý do, audit) + Ghi nhận tay chuyển khoản | anh chốt sáng nay |

## 5b. Hóa đơn phần vượt — ANH CHỐT 11/11: coi như KHÁCH MUA THÊM một gói

> Bản trước (xuất hóa đơn chậm nhất ngày 07 dù khách chưa trả, công nợ, worker ngày 06) **ĐÃ BỎ** —
> anh: "rất khó khăn và đang làm phức tạp vấn đề".

- Khách trả phần vượt = **mua thêm gói N đơn hàng** tại thời điểm trả. Hóa đơn xuất **lúc tiền về**, y như
  mua gói: không công nợ, không xuất trước khi thu, Miễn ở HQ = không thu, không có hóa đơn.
- Dòng hàng giữ khuôn có sẵn (`issue-hq.ts` một dòng, ĐVT Gói, số lượng 1), chỉ đổi tên:
  **"Gói phần mềm Hubsell - mua thêm 100 đơn hàng"**, đơn giá = thành tiền = 6.500 đ, thuế suất theo cấu
  hình HQ như mọi gói.
- Thay đổi mã chỉ còn: `hqItemNameFor` rẽ nhánh khi `kind = OVERAGE`. Không thêm worker xuất hóa đơn.

## 6. Rủi ro

- **Khách cãi "đơn hủy cũng tính tiền".** Giữ được vì chi phí API như nhau và đúng định nghĩa trần, nhưng phải ghi rõ trước lúc mua (bước 4 mục 2). Anh muốn bỏ đơn hủy thì đổi một điều kiện SQL, nhưng khi đó thanh mức dùng ở trang phải đếm khác các gói khác.
- **Hạn mức số tiền một lệnh payOS/ngân hàng chưa kiểm** — 50.000 đơn × 12 tháng ≈ 32,5 tr. Kiểm bằng giao dịch thật đầu tiên trên mức 10 tr.
- **Apple 3.1.3(b)**: không đổi so với hôm nay (Enterprise vốn mua ngoài app). Không thêm chữ nào vào iOS.
- **Bộ nhớ đệm 60 giây** (`getOwnerPlanState`): khách trả xong mở ngay vì `invalidatePlanState` đã gọi sau thanh toán; HQ bấm Miễn cũng phải gọi. Web nhiều máy thì chậm tối đa 60 giây — chấp nhận.
- **Tháng có cả Enterprise lẫn gói khác** (hạ xuống Scale giữa tháng): phí vượt chỉ tính trên phần thời gian Enterprise; phần Scale theo luật trần cũ. Hiếm, chấp nhận.
- **Prod chưa kiểm**: gói ENTERPRISE trên prod đang để trần gian/nhân viên/đơn bao nhiêu (đã báo khách không giới hạn gian + nhân viên) — kiểm ở HQ trước khi bật.

## 7. Chia lát

| Lát | Nội dung | Ước lượng | Phải xong trước |
|---|---|---|---|
| **1. Mua Enterprise tự phục vụ** | migration (3 cột gói + 2 cột chứng từ + 1 cột đơn cổng); hàm giá + test ra đúng 4 số; payOS nhận số đơn; `/me` tách gói theo đơn khỏi `upgradePlans`; trần hiển thị = số cam kết; TẮT khóa ORDERS cho gói theo đơn; ô nhập số đơn trong `plan-pricing-matrix.tsx`; HQ Ghi nhận tay có ô số đơn | ~5 giờ kể cả test + soi màn | khi khách Long trả |
| **2. Tính + thu phần vượt** | bảng `plan_overage_charges` + RLS; worker mùng 2; `kind OVERAGE` qua chứng từ → sổ quỹ → HĐĐT → hoa hồng; dải vàng + nút trả trên `/settings/plan`; HQ danh sách + Miễn | ~1 buổi | 02/12 (phiếu đầu tiên) |
| **3. Khóa khi quá hạn** | `OVERAGE_UNPAID` ở backend + chữ web (banner, màn khóa, /settings/plan) | ~2–3 giờ | 05/12 |
| 4. Landing | `hubsell-landing` pricing: Enterprise "Tự tính giá trong app" thay "Đăng ký tư vấn" | ~1 giờ | không gấp |

**Cho khách Long trả sớm nhất:** tối nay nếu lát 1 chưa push → khách chuyển khoản, anh Ghi nhận tay ở HQ: gói Enterprise, kỳ khách chọn, số tiền gõ tay (cách chốt deal 22/08 vẫn chạy). Khoản này không có số đơn → mã lát 1 hiểu là 20.000. Khách khoảng 13.000 đơn/tháng nên tháng 11 gần như chắc không vượt; phiếu vượt đầu tiên sớm nhất 02/12 → lát 2 + 3 làm trong tuần là kịp.

## 8. Tránh đụng phiên 20:00 (3 bước "yêu cầu mua gói dễ thấy")

Phiên đó sửa hộp để lại SĐT trên `/settings/plan/page.tsx` và rút khối yêu cầu ở `/admin/plans/page.tsx`. Lát 1 cũng đụng `/admin/plans/page.tsx` (ô số đơn trong hộp Ghi nhận) và một chỗ props ở `page.tsx`. Đề xuất: lát 1 chỉ sửa `plan-pricing-matrix.tsx` + thêm thành phần mới, còn phần HQ của lát 1 làm SAU khi phiên 20:00 xong.

## 9. Lát 1 — ĐÃ CODE trên local (11/11 chiều, CHƯA commit/push, CHƯA đụng prod)

Anh: "Trước mắt em thiết kế trên local, mục tiêu chiều nay là để khách thanh toán được. Còn việc chặn gói,
thanh toán mua thêm, cảnh báo cho sale biết… thì tối mình làm."

- **Migration `20261111140000_enterprise_tu_phuc_vu`** (chỉ thêm 3 cột null): `service_plans.minOrdersPerMonth`,
  `package_payments.committedOrders`, `gateway_payment_orders.committedOrders`.
- **`backend/src/services/per-order-plan.ts`**: `perOrderPlanPrice` (tròn nghìn(giá kỳ × N ÷ mức tối thiểu)),
  `validateCommittedOrders` (≥ tối thiểu, số nguyên, lưới an toàn 1.000.000).
- **payOS** (`gateway-checkout.ts`): gói tính theo đơn nhận `committedOrders`, máy chủ tự tính tiền; nội dung CK
  `HS ENTERPRISE <8 số>`; dòng hàng payOS "Gói Enterprise 25.000 đơn/tháng — 3 tháng". Tiền về →
  `recordPackagePayment` lưu số cam kết trên chứng từ + diễn giải sổ quỹ + tên dòng hóa đơn điện tử
  ("Phần mềm Hubsell - gói Enterprise 25.000 đơn/tháng, 3 tháng (…)").
- **Trần** (`plan-enforcement.ts`): gói tính theo đơn → trần = số cam kết của khoản thanh toán đang phủ hôm nay
  (không có = mức tối thiểu); **không bao giờ khóa vì vượt**, không ân hạn; chuông 80/100 % đổi chữ "phần vượt
  tính thêm, báo đầu tháng sau". Banner web: vàng, tắt được, không tự bật popup nâng gói.
- **`/me`**: `enterprisePlan` thêm `selfServe` + mức tối thiểu + 4 giá + trần gian/nhân viên; `committedOrders`;
  gói tính theo đơn tách khỏi `upgradePlans`.
- **Giao diện** (anh duyệt hình 11/11: "thiết kế lại cho khách dễ nhập… sau này nhân rộng cho các gói bên trên"):
  thành phần dùng lại `components/settings/order-volume-picker.tsx` — 4 chip gợi ý (×1/×1,5/×2,5/×5 mức tối thiểu
  = 20k/30k/50k/100k), nút − / + (bước 1.000 dưới 50k, 5.000 tới 200k, 10.000 trên), ô gõ tự chấm nghìn, báo đỏ
  dưới mức. Desktop: dải rộng dưới hàng giá Enterprise đi một mạch trái → phải theo 3 cột đánh số: (1) số đơn,
  (2) "Thanh toán mấy tháng?" — 4 nút 1/3/6/12 tháng kèm "Tiết kiệm N%" (`CyclePicker`, cùng file; anh 11/11:
  "có nên để số tháng bên dưới để khách dễ dùng không?" → có, chung lựa chọn với 4 ô giá trên bảng), (3) tổng tiền
  to + "≈ X ₫/đơn" + MỘT nút Thanh toán ngay. Cột (2) giãn theo màn: 2 × 2 tới 1535px, 4 nút một hàng từ 1536px.
  Anh chốt thêm 11/11: Enterprise **bỏ hẳn 4 ô giá + danh sách tick trong bảng** — hàng Enterprise chỉ còn tên +
  dải 3 bước; "Không giới hạn gian hàng / nhân viên / Đầy đủ tính năng" là một hàng tick DƯỚI dải; nhập dưới
  20.000 hiện đỏ "Gói Enterprise chỉ áp dụng từ 20.000 đơn/tháng", tổng tiền thành "—", nút tắt. Điện thoại cùng
  thứ tự: tên → số đơn → số tháng → tổng + nút → quyền lợi.
  Thông báo phần vượt (anh hỏi 11/11 "có thêm thông báo… 65đ/1 đơn vượt và thanh toán vào mùng 5 tháng tiếp
  theo không") = ô xanh nổi dưới dải: "Vượt số đơn đã mua: tính 65 ₫ cho mỗi đơn vượt, thanh toán trước hết ngày
  mùng 5 tháng sau" + "quá hạn chưa thanh toán thì tính năng nâng cao tạm dừng" + "tính cả đơn hủy". Cùng một câu
  (`overageNotice`) ở thẻ gói, thanh cảnh báo vượt (kèm "Đang vượt N đơn ≈ X ₫") và chuông. Thanh cảnh báo vượt
  còn nút "Nâng gói" mở hộp nâng gói chung — để phiên tối xử lý cùng thu phần vượt. Điện thoại: ô chọn trên 4 ô kỳ, tổng + nút dưới cùng. Câu ghi rõ "tính mọi đơn phát sinh
  trên sàn (kể cả đơn hủy)".
- **HQ Sửa gói**: ô "Số đơn tối thiểu (gói khách tự chọn số đơn)".
- **Kiểm:** vitest `per-order-plan.test.ts` (4 số đúng y, 30k, số lẻ, nhập sai, chứng từ, trần không khóa, gia
  hạn sớm số mới áp kỳ sau, khoản ghi tay = tối thiểu) + plan-enforcement + hq-auto-invoice: 42/42; toàn bộ
  backend 2409 qua, 8 đỏ ở 5 tệp sổ cái/xóa gian (chạy riêng thì qua — đụng nhau trên DB dev khi chạy song song,
  không dính tệp sửa); tsc 2 phía sạch. Chạy trọn luồng local bằng payOS giả lập: 25.000 đơn × 3 tháng →
  4.613.000 ₫ → tiền về → gói Enterprise 11/11/2026 → 11/02/2027, trần 25.000, sổ quỹ đúng số. Soi 1280 / 1440 /
  1700 (không tràn ngang), tối, 375.

### Việc để bật trên prod (cần anh gật push)
1. Push → Render tự áp migration.
2. HQ prod → Sửa gói Enterprise: Đang bán; giá 1/3/6/12 tháng = 1.300.000 / 3.690.000 / 6.990.000 / 12.990.000;
   Số đơn tối thiểu 20000; Giá công bố 65; trần gian / nhân viên để trống (= không giới hạn như đã báo khách);
   trần đơn để trống.
3. Kiểm `/settings/plan` prod bằng tài khoản khách → khách Long tự thanh toán.

### Còn lại (tối nay theo lời anh)
Tính + thu phần vượt (mua thêm gói N đơn), khóa khi quá mùng 4, báo sale/HQ, landing.

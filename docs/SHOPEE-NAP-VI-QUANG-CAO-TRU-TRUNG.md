# Shopee trích tiền đơn nạp ví quảng cáo — hết trừ quảng cáo hai lần (10/11/2026)

## 1. Ca gốc

Khách gian Shopee "Mẹ mua đi, Bố trả tiền Store" báo: trả tiền quảng cáo bằng 8 % GMV cấn thẳng trong đơn, nhưng Báo cáo dòng tiền vẫn trừ thêm dòng "Chi phí quảng cáo sàn (Ads)". Kiểm prod (SQL chỉ đọc): **khách đúng**.

## 2. Gốc lỗi

- Shopee có tính năng shop tự bật: trích một phần tiền mỗi đơn để nạp ví quảng cáo. Khoản này là trường `ads_escrow_top_up_fee_or_technical_support_fee` trong `order_income` của `get_escrow_detail` (API Hubsell vẫn gọi cho mọi đơn), đã trừ sẵn trong `escrow_amount`.
- Trước 10/11 Hubsell không đọc trường này (`mapShopeeEscrowFields` để `adWalletTopup` = 0). Hệ quả: khoản trích làm giảm Doanh thu (hiện ở "Lệch quyết toán khác"), rồi `AdSpend` (tiền TIÊU từ chính ví đó, đọc từ Ads API) lại cộng vào cột Chi phí.
- Không phải phí Pay Per Sale (`pay_per_sale`) — trường đó ở gian này vẫn 0.

## 3. Số prod (10/11/2026, chỉ đọc)

- Đơn 261106KHPHJ67F giá bán 185.000 đ: ước tính trích 5.994 (3 % × 1,08), quyết toán trích 15.984 (8 % × 1,08) → mức trích có thể tăng giữa ước tính và quyết toán (suy đoán: shop đổi mức % ở giữa; chưa kiểm).
- Trường có từ 07/2026 và tăng nhanh: 07: 46 đơn / 0,16 tr · 08: 444 / 1,77 tr · 09: 1.336 / 4,08 tr · 10: 9.644 / 17,18 tr · 01–10/11: 3.687 / 19,14 tr.
- Giá trị nhỏ nhất = 0, không có số âm; luôn là kiểu số.
- "technical support fee" trong tên trường: nhớ là tên cho thị trường khác, CHƯA đối chiếu tài liệu Shopee.

## 4. Luật mới — anh Trung chốt 10/11 "làm theo hướng A"

Cùng luật đang chạy cho TikTok GMV Max (20/10):

- Khoản trích vào cột `Order.adWalletTopup` → dòng **"Nạp ví quảng cáo"** ở thác nước Dòng tiền, bảng Lãi/Lỗ Shopee, Tổng quan (khung có sẵn, trước giờ luôn 0).
- Dòng "Chi phí quảng cáo sàn" của gian = `max(0, Σ AdSpend − Σ đã trích trong đơn)` trong kỳ, kèm ghi chú "Shopee đã trích một phần tiền đơn để nạp ví quảng cáo, ở đây chỉ cộng phần còn lại".
- Doanh thu (tiền về ví) và lãi từng đơn KHÔNG đổi; công thức sổ cái KHÔNG đổi (không tăng `LEDGER_FORMULA_VERSION`). Trigger sổ đã theo dõi `adWalletTopup` nên đơn đổi cột này tự tính lại.
- ROI/ROAS hòa vốn và biên lãi quảng cáo không đọc cột này → không đổi.

**Giới hạn đã báo anh:** tiền Shopee là NẠP ví, không phải tiêu. Kỳ nào nạp nhiều hơn tiêu thì chi phí tính theo số nạp (cao hơn thực, không bao giờ thấp hơn). Hướng B (cộng ngược tiền nạp vào doanh thu, trừ đủ AdSpend) chính xác theo kỳ nhưng phải đổi công thức sổ — anh không chọn.

## 5. Mã

- `integrations/shopee/client.ts` — khai trường trong `ShopeeOrderIncome`.
- `integrations/shopee/settlements.ts` — `mapShopeeEscrowFields` ghi `adWalletTopup`; `INCOME_COMPONENTS` thêm dòng "Nạp ví quảng cáo (trích từ tiền đơn)" không buộc tội (hết rơi vào "Chênh lệch chưa bóc tách được"); `ESCROW_ESTIMATE_SELECT` thêm cột.
- `lib/finance-definitions.ts` — `adsChargedInOrder` (một định nghĩa cho cả TikTok lẫn Shopee).
- `services/ads-spend.ts`, `services/off-order-costs.ts`, `lib/cash-flow-totals.ts`, `lib/overview-totals.ts`, `services/order-ledger.ts` (2 câu GROUP BY), `routes/finance.ts`, `routes/analytics.ts`, `routes/assistant.ts` — đổi tên `gmvMax…` thành `adsCharged…` và cộng cả khoản Shopee.
- Frontend: chữ chú thích bảng Lãi/Lỗ Shopee; tooltip dòng "Nạp ví quảng cáo".
- **Sửa kèm:** `ESCROW_ESTIMATE_SELECT` thiếu ba cột "trên giỏ" thêm 29/10 → `rowDiffers` luôn thấy thiếu khóa, mọi lần hỏi lại ước tính đều ghi DB dù số không đổi (2 ca test `escrow-estimate-sweep` đỏ từ đó). Đã bổ sung, test xanh lại.

## 6. Bù số đơn cũ — không gọi sàn

- Đơn hỏi sàn sau khi deploy: tự có số.
- Đơn quyết toán trong 7 ngày gần nhất: nhịp giờ của worker đọc lại escrow và ghi số THẬT (hành vi sẵn có).
- Còn lại: `backend/scripts/shopee-ad-wallet-topup-backfill.ts` chép từ bản ước tính đang lưu (`expectedIncome`), mặc định chỉ xem trước, `--apply` mới ghi; mỗi gian một câu UPDATE. Đo prod: phần chốt muộn chưa bóc được của đơn quyết toán cũ hơn 7 ngày ≤ 265 nghìn / 31,6 triệu (dưới 1 %) nên không đáng đọc lại sàn.

## 7. Mô phỏng trước/sau trên prod (đơn tạo 11/10 → 10/11, 46 gian có khoản trích trên đơn tính doanh thu)

| | Trước | Sau |
|---|---|---|
| Σ dòng Ads cộng vào Chi phí | 425,15 tr | 399,02 tr |
| Σ "Nạp ví quảng cáo" (thác nước) | 0 | 31,63 tr |
| Phần trừ trùng được gỡ | | 26,13 tr (6,1 %) |

- 10 gian có khoản trích nhưng AdSpend = 0 (chưa nối Hubsell Ads): lợi nhuận không đổi, chỉ đổi tên dòng (5,5 tr chuyển từ "Lệch quyết toán khác" sang "Nạp ví quảng cáo").
- 2 gian trích nhiều hơn tiêu trong kỳ → dòng Ads về 0 (ca giới hạn ở mục 4).
- Gian ca gốc: trích 533 nghìn, AdSpend 957 nghìn → dòng Ads còn 424 nghìn.
- Lớn nhất: "Shop Nghi 85" trích 10,78 tr / AdSpend 35,52 tr.

## 8. Kiểm

- vitest: `ads-spend` (thêm ca Shopee), `fee-audit-shortfall` (thêm 2 ca theo đơn thật), `cash-flow-totals`, `overview-totals`, `escrow-estimate-sweep`, `cash-flow-ledger-db`, `overview-ledger-db` xanh; `order-ledger-db` còn 1 ca đỏ sẵn (đếm dọn, không liên quan). `tsc` backend + frontend sạch.
- Đầu-cuối DB local (gian demo, 01–07/11, gắn thử 10.000 đ × 40 đơn rồi trả lại): Nạp ví 0 → 400.000; Lệch quyết toán khác 692.000 → 292.000; dòng Ads 948.000 → 548.000; Doanh thu giữ nguyên 32.707.563; lợi nhuận +400.000; trả lại thì về đúng số cũ.
- CHƯA soi giao diện web/mobile bằng mắt; CHƯA chạy trên prod.

## 9. Còn mở

- `expense` của Ads API Shopee đã gồm VAT 8 % chưa (tiền nạp ví thì có VAT) — chưa biết.
- Mức % shop đang cài: chưa biết có API không; việc sửa không cần.
- Mobile: dòng "Nạp ví quảng cáo" và ghi chú đi theo dữ liệu backend, chưa soi trên app.

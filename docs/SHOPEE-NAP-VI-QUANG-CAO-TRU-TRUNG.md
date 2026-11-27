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

## 10. Tiền ưu đãi "Hỗ trợ Kinh phí Hiệu suất" + Voucher Thông Minh — Hubsell CHƯA lấy, sàn KHÔNG có API (20/11/2026, chỉ khảo sát, chưa sửa gì)

**Ca gốc:** anh Trung gửi 3 ảnh Seller Center của một gian khách: (1) Voucher Thông Minh "100 % tài trợ bởi nền tảng" (gian này đang 0 đ); (2) hộp "Chi tiết tiền ưu đãi" của Hỗ trợ Kinh phí Hiệu suất — tuần 09–15/11 "Đã phân phối tiền ưu đãi" 214.728 đ, tuần 02–08/11 không được xét vì lượt chuyển đổi < 25; (3) Lịch sử giao dịch ví quảng cáo — dòng 18/11 "Tiền ưu đãi từ Hỗ trợ Kinh phí Hiệu suất + 214.728", hết hạn 23:59 17/05/2027. Anh hỏi: Hubsell có lấy khoản này về không, về đâu, có nằm trong cột Tổng giá trị sản phẩm không.

**Trả lời (đọc mã 20/11):**

- KHÔNG lấy. Hubsell chỉ lấy 3 thứ về tiền quảng cáo Shopee: `expense` theo ngày → `AdSpend` (dòng "Chi phí quảng cáo sàn"); `total_balance` → `Channel.adsWalletBalance` (Trợ lý quảng cáo, cảnh báo ví); khoản trích từ đơn → `Order.adWalletTopup`. Không đường gọi nào đọc lịch sử giao dịch ví quảng cáo.
- KHÔNG nằm trong Tổng giá trị sản phẩm: cột đó = Σ `revenueGross` (giá món hàng trong giỏ của từng đơn), khoản này không gắn đơn nào. Voucher Thông Minh là tiền sàn trả thay người mua → shop vẫn nhận đủ giá trong giỏ, Hubsell không tách thành số riêng.
- Hệ quả: khi khách tiêu khoản ưu đãi, sàn vẫn ghi "Khấu trừ" như thường → Hubsell cộng vào chi phí quảng cáo dù khách không bỏ tiền. Chi phí quảng cáo của gian cao hơn thực chi đúng bằng tiền ưu đãi (rải theo ngày tiêu). Đây là suy từ ảnh + mã, CHƯA đối chiếu số prod của gian.

**Tài liệu Shopee Open Platform (đọc 20/11/2026 qua Chrome, open.shopee.com/documents/v2):**

- Nhóm **Ads có 24 API**: get_total_balance, get_shop_toggle_info, get_recommended_keyword_list, get_recommended_item_list, get_all_cpc_ads_hourly_performance, get_all_cpc_ads_daily_performance, create_auto_product_ads + edit_auto_product_ads (ghi "coming offline soon"), get_product_campaign_daily_performance, get_product_campaign_hourly_performance, get_product_level_campaign_id_list, get_product_level_campaign_setting_info, create_manual_product_ads, edit_manual_product_ad_keywords, edit_manual_product_ads, get_create_product_ad_budget_suggestion, get_product_recommended_roi_target, get_ads_fácil_shop_rate, check_create_gms_product_campaign_eligibility, create_gms_product_campaign, edit_gms_product_campaign, list_gms_user_deleted_item, edit_gms_item_product_campaign, get_gms_campaign_performance, get_gms_item_performance. **Không API nào trả lịch sử giao dịch ví quảng cáo, tiền ưu đãi, hay Voucher Thông Minh.**
- `get_total_balance` — nguyên văn: "seller's ads credit balance, including paid credits and free credits" → tiền ưu đãi ĐÃ nằm trong `adsWalletBalance`, nhưng gộp một số, không tách được.
- `expense` (get_all_cpc_ads_daily_performance) — tài liệu chỉ ghi "Ad Expenditure", KHÔNG nói có gồm phần tiêu bằng free credit hay không.
- Nhóm Payment: `get_billing_transaction_info` chỉ cho người bán xuyên biên giới (CB). `get_wallet_transaction_list` (ví shop, Hubsell đang gọi nhưng chỉ lọc lệnh rút) có loại `PAID_ADS_CHARGE` (450) / `PAID_ADS_REFUND` (451) = tiền ví shop nạp sang quảng cáo và hoàn lại — KHÔNG phải tiền ưu đãi (ưu đãi vào thẳng ví quảng cáo).

**Vì sao không tự suy ra được:** biến động số dư = tiền nạp + tiền ưu đãi − tiền tiêu; tiền nạp thẳng bằng thẻ / ngân hàng không có API nào trả → không tách được ưu đãi khỏi tiền nạp một cách chắc chắn.

**Nháp ticket hỏi Shopee (20/11/2026, CHƯA GỬI — anh bảo soạn trên Chrome; đường vào: Console → Raise Ticket → AI Assistant → "Still having problems? Raise Ticket" → form; L1 Feature APIs / L2 Ads / V2-Ads, app Hubsell Ads 2044679):**

> Subject: Ads API – how to get ads credit transaction history / free credits (Performance Funding Support rebate, Smart Voucher)
>
> Hello Shopee Open Platform team,
>
> We are an ISV serving sellers in Vietnam (region VN). Our sellers need the correct advertising cost in their profit reports.
>
> In Seller Centre > Shopee Ads > Ads Credit > Transaction History, sellers see entries such as "Tiền ưu đãi từ Hỗ trợ Kinh phí Hiệu suất" (free ads credit granted weekly by the Performance Funding Support program, with an expiry date), "Nạp tiền tự động" (auto top-up) and "Khấu trừ cho Dịch vụ Hiển thị Sản phẩm" (deduction). There is also "Voucher Thông Minh" (Smart Voucher, 100% funded by the platform) with "voucher value" and "sales with voucher".
>
> We checked all APIs under v2.ads and v2.payment and could not find any API returning this data. v2.ads.get_total_balance returns one number only (paid credits and free credits combined).
>
> Questions:
> 1. Is there an Open API (available or planned) to get the ads credit transaction history of a shop (top-up, deduction, free credit / rebate granted, expiry)? If yes, which API and which permission?
> 2. Is there any API to get the free credit granted by the Performance Funding Support program (amount, review period, distribution date), or to split total_balance into paid credits and free credits?
> 3. Does the "expense" field of v2.ads.get_all_cpc_ads_daily_performance and v2.ads.get_product_campaign_daily_performance include spending paid by free credits, or paid credits only?
> 4. For Smart Voucher: is there an API for "voucher value" and "sales with voucher"? In v2.payment.get_escrow_detail, in which field does this platform-funded voucher amount appear (voucher_from_shopee)?
> 5. If no such API exists, could you please forward this as a feature request?
>
> Thank you.

**Trạng thái trên Chrome 20/11 (CHƯA vào được form, CHƯA gửi):** đường cũ 23/10 không còn — hỏi AI Assistant ở Console → Raise Ticket thì bị chuyển sang `/ai-chat-bot/chat`, cuối câu trả lời KHÔNG còn nút "Still having problems? Raise Ticket" (nút ngón tay chỉ xuống chỉ mở hộp góp ý; menu Support Center → Raise Ticket quay lại đúng màn AI Assistant; trang `/console/raise-ticket/<type_id>` trắng, kể cả type 2061 = Feature APIs / Ads lấy từ danh mục của chính trang). AI Assistant của Shopee trả lời câu hỏi 1–2: tài liệu KHÔNG có API lịch sử giao dịch ví quảng cáo, `total_balance` gộp paid + free credits, không có trường tách. → cần anh mở form (hoặc chỉ đường vào), em điền nội dung trên rồi anh bấm gửi.

**★ 20/11 ~11:15 — ĐÃ TÌM RA ĐƯỜNG VÀO + ĐÃ ĐIỀN XONG FORM, CHƯA BẤM GỬI (anh: "em tự mở và điền đi"):** đường mới = mở thẳng `https://open.shopee.com/console/raise-ticket/2005?category_name=Feature%20APIs` (2005 = `category_id` của nhóm Feature APIs, KHÔNG phải type_id; màn Raise Ticket giấu vùng chọn nhóm khi cờ `force_chatbot` bật) → cột trái chọn **Ads** → nút **Raise a Ticket** góc dưới phải → form mở ở TAB MỚI (open-platform.cs.shopee.com/portal/webform/…). Đã điền: email (có sẵn), VN / Feature APIs / Ads (có sẵn), Question Subject, Question Description (bản nháp trên + một dòng ghi chú "không có request_id thật, hai ô dưới là giữ chỗ", 1.859 ký tự), Partner ID 2044679, API Category "V2 - Ads", API Name `v2.ads.get_total_balance`, Request ID "N/A - API consultation, no failed request", Request Time 2026/11/20 11:14. Để trống: Shop ID, File, Request, Response. Form không báo lỗi ô nào. Nút 提交 CHƯA bấm — chờ anh.

**✅ 20/11/2026 ~11:23 — TICKET ĐÃ GỬI: Enquiry ID `2123633047348785173`** (webform 2123633046065553487, tiêu đề hiện "Feature APIs 问题", status In Progress; My Enquiries ghi giờ cập nhật 2026/11/20 12:22 — lệch 1 giờ so với giờ VN). Anh bảo "Gửi đi" → tab form lần đầu rời nhóm tab nên em mở + điền lại form mới (Request Time 2026/11/20 11:21), bấm 提交, anh kéo CAPTCHA mảnh ghép → "已成功提交 … you can expect a reply via email". My Enquiries chỉ có MỘT ticket mới (không trùng). Theo dõi: `https://service.open-platform.cs.shopee.com/` (zing4teen@gmail.com) + thư từ openapi@support.shopee.com. **Trả lời của Shopee ghi ngay dưới đây:**
- **Shopee trả lời 23/11/2026 14:23 (giờ trên My Enquiries, lệch +1 giờ so với giờ VN), em đọc 27/11, status "Your Action Required":** nguyên văn: "We're sorry, the API does not support this feature at the moment. To help us evaluate a possible optimization, please provide the following information: 1. API involved (e.g. /api/v2/order/get_order_detail) 2. Current situation (your use case and why optimization is needed [pain points/examples]) 3. Impact scope (who or what is affected, and the scale of the impact) 4. Expected outcome (the function you hope to achieve and the business effect you expect)". → Xác nhận chính thức KHÔNG có API; Shopee nhận xét làm tính năng nếu mình gửi 4 mục trên. Không trả lời riêng ý 3 (`expense` có gồm phần tiêu bằng free credit không) và ý 4 (Voucher Thông Minh nằm trường nào của escrow).
- ⚠️ Ticket 429 trước đó ở trạng thái "Your Action Required" đúng 5 ngày thì Shopee tự đóng (19/11 19:11 → 24/11 19:11). Suy ra ticket này tự đóng khoảng **28/11 14:23** nếu không trả lời (suy từ MỘT ca, chưa có tài liệu Shopee xác nhận). 27/11 em soạn nháp trả lời 4 mục đưa anh trong chat → **anh chốt 27/11: "Để tự đóng"** — không gửi, để Shopee tự đóng. Ca xong: sàn không có API, mình không xin làm tính năng.

**Hướng (chưa làm, chờ anh):** (a) hỏi Shopee qua ticket xem có / sắp có API lịch sử giao dịch ví quảng cáo; (b) trong lúc chờ, khách ghi tay một khoản Thu ở Thu chi vận hành (`OperatingExpense.direction = INCOME`) — lãi ròng đúng, dòng "Chi phí quảng cáo sàn" giữ số cũ; chưa chạy thử trên báo cáo.

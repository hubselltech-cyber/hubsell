# Khảo sát cột "Tổng giá trị sản phẩm" — Shopee và TikTok đang đo hai thứ khác nhau (29/10/2026)

> Anh Trung báo 29/10: thẻ "Tổng giá trị sản phẩm" của Báo cáo dòng tiền cộng Shopee theo giá
> SAU giảm giá sản phẩm của shop, còn TikTok theo giá TRƯỚC giảm giá → số tổng là số lai, sai.
> Tài liệu này ghi: đường đi của cột, trường API từng sàn, số thật đo trên prod, cách tính đơn hủy,
> ba cách định nghĩa có thể chọn và đề xuất. **Chưa sửa mã** — chờ anh chốt mục 6.

## 1. Cột này đi từ đâu ra

| Tầng | Mã | Việc làm |
|---|---|---|
| Mapper đơn | `integrations/shopee/service.ts` `aggregateShopeeItems` | `OrderItem.price = model_discounted_price ?? model_original_price` |
| | `integrations/tiktok/service.ts` `aggregateLineItems` | `OrderItem.price = sale_price` (đã trừ CK shop **và** CK sàn) |
| | `integrations/lazada/service.ts` | `OrderItem.price = paid_price ?? item_price` |
| Bản kê | `integrations/shopee/settlements.ts` `mapShopeeEscrowFields` | **không** ghi giá gốc / giảm giá sản phẩm; chỉ voucher_from_seller + seller_coin_cash_back → `sellerVoucher` |
| | `integrations/tiktok/settlements.ts` | `grossSales = subtotal_before_discount_amount`, `sellerDiscount = seller_discount_amount` |
| Công thức | `lib/pnl-formula.ts` `computePnlRow` | `revenueGross` = Σ `OrderItem.price × qty`; **TikTok có bản kê** thì ghi đè = `grossSales`, `sellerVoucher = |sellerDiscount|`; Lazada cộng ngược voucher từ `totalAmount`/sao kê |
| Sổ cái | `order_ledger.revenueGross` | ghi kết quả computePnlRow |
| Báo cáo | `/api/finance/analytics` → `lib/cash-flow-totals.ts` | thẻ 1 = Σ `revenueGross` đơn tính doanh thu; dòng "Đã hủy" = Σ `revenueGross` đơn CANCELLED; Tổng quan `/api/analytics` cùng số; mobile `FinancePage` đọc cùng endpoint |
| Bảng Lãi/Lỗ | tab Shopee cột "Tổng giá trị SP" = `revenueGross`; tab TikTok 3 cột "Tổng phụ trước giảm giá / Giảm giá của người bán / Tổng phụ sau giảm giá" | cùng `revenueGross` / `sellerVoucher` |

→ Đúng như anh đoán: Báo cáo dòng tiền cộng dồn **cột đầu tiên của bảng Lãi/Lỗ**; cột đó ở Shopee
là giá sau khuyến mãi sản phẩm, ở TikTok là giá gốc. Mỗi tab tự nó đúng với sàn của nó; cái sai là
hai sàn không chung một định nghĩa.

## 2. Trường API từng sàn (docs chính thức đọc 29/10 qua trình duyệt)

### Shopee
- `get_order_detail.item_list[]`: `model_original_price` = "The original price of the item";
  `model_discounted_price` = "The after-discount price… If there is no discount, same as
  model_original_price" (bundle deal trả 0, phải sang escrow). `promotion_type` cho biết
  product_promotion / flash_sale / bundle / add_on.
- `get_escrow_detail.order_income`:
  - `order_original_price` = "original price of the item **before ANY promotion/discount**";
  - `order_selling_price` = Σ đơn giá sau khuyến mãi sản phẩm (= `order_original_price` khi không bundle);
  - `order_discounted_price`, `order_seller_discount`, `seller_discount` = "Final sum of each item seller discount",
    `shopee_discount` = phần sàn giảm rồi bù lại shop; `voucher_from_seller`, `seller_coin_cash_back`,
    `coins`, `voucher_from_shopee` (sàn chịu, không vào ví shop).
  - `items[]`: `original_price`, `discounted_price`, `seller_discount`, `shopee_discount`,
    `discount_from_voucher_seller`, `discount_from_coin`…
  - Công thức escrow của chính Shopee: `escrow_amount = original_cost_of_goods_sold − original_shopee_discount
    + seller_return_refund + shopee_discount − voucher_from_seller − seller_coin_cash_back + …` → sổ của
    Shopee xuất phát từ **giá gốc**, giảm giá sản phẩm của shop là một dòng trừ riêng (đúng như màn
    Chi tiết thu nhập Seller Center: Giá gốc → Giảm giá sản phẩm của Shop → Mã giảm giá của Shop…).
- Hubsell **đang không lưu** `order_original_price` / `seller_discount` vào cột nào; nhưng
  `Order.expectedIncome` (snapshot JSON toàn bộ trường số của `order_income`, ghi mỗi lần ước tính)
  **đã có sẵn** hai trường này cho mọi đơn đã qua ước tính escrow.

### TikTok
- Đơn (`/order/202309/orders`, `line_items[]`): `original_price`, `sale_price` (sau CK shop + CK sàn),
  `seller_discount`, `platform_discount`; `payment.original_total_product_price`, `sub_total`,
  `seller_discount`, `platform_discount`. (Bảng trường trên docs hôm nay không bóc được bằng JS — định
  nghĩa lấy từ docs JSON tải 16/09 ghi trong `tiktok/client.ts` + payload thật.)
- Bản kê (`202501` / unsettled `202507`, `revenue_breakdown`): `subtotal_before_discount_amount` = giá gốc,
  `seller_discount_amount` = **chiết khấu của nhà bán hàng gộp cả giảm giá sản phẩm lẫn voucher shop**
  (sàn không tách), `revenue_amount` = sau chiết khấu shop. Ảnh anh gửi: 500.000 − 151.000 = 349.000.

### Lazada
- Order Items: `item_price`, `paid_price` (sau voucher shop), `voucher_seller`, `voucher_platform`;
  sao kê "Item Price Credit". **Chưa thấy trường giá niêm yết trước khuyến mãi sản phẩm** trong API đơn
  → phải kiểm thêm khi có gian Lazada thật (tài khoản anh 30 ngày qua 0 đơn Lazada).

## 3. Số thật trên prod (tài khoản anh, 30/09–29/10, Chrome anh đăng nhập; SQL Supabase chỉ đọc)

### 3a. Báo cáo dòng tiền đang hiện (`/api/finance/analytics`, lọc `channelName`)

| | Đơn tính DT | Tổng giá trị SP | Dòng "Voucher trợ giá của shop" | Doanh thu | Đã hủy |
|---|---|---|---|---|---|
| Tất cả | 1.838 | 514.925.215 | 65.938.409 (12,8 %) | 301.981.623 | 468 đơn · 130.889.832 |
| Shopee | 1.161 | 271.698.215 | **0** | 174.243.784 | 295 · 70.082.975 |
| TikTok | 677 | 243.227.000 | **65.938.409** (27 %) | 127.737.839 | 173 · 60.806.857 |

→ Dòng "Voucher trợ giá của shop" 65,9 triệu là **100 % TikTok** và thực chất là *giảm giá sản phẩm*
(TikTok gộp), còn Shopee ra 0 vì giảm giá sản phẩm của ANO đã bị trừ sẵn trong giá dòng hàng.

### 3b. Shopee — snapshot `order_income` so với cột đang dùng (đơn không hủy, 1.196 đơn)

| Trường | Σ 30 ngày |
|---|---|
| Σ `OrderItem.price × qty` (cột đang dùng) | 280.924.715 |
| `order_original_price` (giá gốc) | **359.308.000** |
| `seller_discount` (giảm giá sản phẩm của shop) | **77.031.285** (21,4 % giá gốc) |
| `order_selling_price` = `order_discounted_price` | 275.276.715 |
| `voucher_from_seller` / `seller_coin_cash_back` | 0 / 0 |
| `coins` / `voucher_from_shopee` (sàn chịu) | 1.245.900 / 47.076.890 |
| `shopee_discount` | 0 |

Giá gốc − giảm giá shop = 282.276.715, lệch 1,35 triệu (0,5 %) so với cột đang dùng — nghi bundle/
add-on (model_discounted_price = 0) hoặc đơn đổi số lượng; kiểm ở lát 1. Đơn hủy Shopee (295 đơn):
cột đang dùng 70.082.975, giá gốc 89.875.000; các trường selling/discounted trong escrow của đơn hủy
gần 0 → với đơn hủy phải lấy giá gốc từ `order_original_price` hoặc `model_original_price`, không
dùng selling.

### 3c. TikTok — theo có/không bản kê

| Nhóm | Đơn | Σ `sale_price` (dòng hàng) | `grossSales` (giá gốc) | `sellerDiscount` | `revenueAmount` |
|---|---|---|---|---|---|
| Không hủy, chưa có bản kê | 1 | 279.000 | — | — | — |
| Không hủy, bản kê thật | 550 | 133.542.370 | 199.732.000 | −54.873.118 | 141.411.434 |
| Không hủy, bản kê ước tính | 145 | 34.377.425 | 50.636.000 | −13.245.833 | 37.390.167 |
| Hủy, chưa có bản kê | 13 | 3.718.857 | — | — | — |
| Hủy, bản kê thật | 155 | 37.358.661 | 55.438.000 | −15.321.795 | 0 |
| Hủy, bản kê ước tính | 5 | 1.173.513 | 1.650.000 | −371.470 | 0 |

Hai phát hiện phụ:
1. Đơn TikTok **chưa có bản kê** (dòng "tạm tính" trong ảnh anh: 279.000, không có giảm giá) dùng
   `sale_price` — thấp hơn cả `revenue_amount` của đơn đã có bản kê (133,5 vs 141,4 triệu ở 550 đơn,
   −5,6 %): `sale_price` còn trừ cả phần sàn giảm, bản kê thì sàn bù lại. Đơn mới vài giờ đầu bị
   hiện thấp rồi nhảy lên khi có bản kê.
2. **Đơn hủy** cũng lai y hệt: TikTok hủy có bản kê (160/173 đơn) tính theo giá gốc, Shopee hủy theo giá
   sau khuyến mãi → dòng "Đã hủy" 130,9 triệu cũng là số lai.

## 4. Ba cách định nghĩa và vì sao chọn

| | A. Giá gốc trước mọi giảm giá của shop | B. Giá bán sau KM sản phẩm, trước voucher (= Shopee hiện nay) | C. Sau mọi giảm giá của shop |
|---|---|---|---|
| Shopee | `order_original_price` (escrow) / `model_original_price` (đơn) | `order_selling_price` / `model_discounted_price` | selling − voucher − xu hoàn |
| TikTok | `subtotal_before_discount` / `original_price` | **không làm được** — bản kê gộp giảm giá SP + voucher | `revenue_amount` |
| Lazada | chưa thấy trường giá niêm yết | `item_price` | `paid_price` |
| Khớp Seller Center | ✅ cả Shopee ("Giá gốc") lẫn TikTok ("Tổng phụ trước giảm giá") | chỉ Shopee | không sàn nào in dòng này |
| Thác nước | thêm dòng "Giảm giá của shop" → chủ shop thấy mình đang giảm bao nhiêu (ANO: 21 % Shopee, 27 % TikTok) | TikTok không bóc được | mất hẳn dòng giảm giá |
| Nhược | thẻ 1 phồng (ANO Shopee +32 %) nhưng Doanh thu không đổi | — | ẩn mức giảm giá — con số trợ lý quảng cáo cần |

**Đề xuất: A.** Đây là cách duy nhất có dữ liệu sạch ở cả hai sàn và trùng dòng đầu tiên của cả hai
Seller Center. Nhãn thẻ giữ "Tổng giá trị sản phẩm", tooltip "giá niêm yết trước mọi giảm giá của
shop"; dòng "Voucher trợ giá của shop" đổi thành **"Giảm giá của shop (sản phẩm + voucher/xu)"** vì
TikTok không tách được hai phần (Shopee tách được thì ghi chú trong tooltip). Doanh thu, Chi phí,
Lợi nhuận không đổi một đồng — chỉ thẻ 1 và các dòng khấu trừ đổi.

Phản biện em đã cân: thẻ 1 phồng lên có thể làm chủ shop "tưởng bán được nhiều" — nhưng số đó chính là
số sàn in, và % Doanh thu/giá trị SP trên thẻ 2 sẽ phản ánh đúng mức giảm giá; cách C "gọn" hơn nhưng
giấu đi 77 + 68 triệu giảm giá/tháng của ANO, là thứ anh đang muốn khách nhìn thấy ở Trợ lý.

## 5. Nếu chốt A — các lát (chưa làm)

1. **Lát 1 Shopee (backend):** `Order` thêm `grossOriginal` + `sellerProductDiscount`;
   `mapShopeeEscrowFields` ghi `order_original_price` + `seller_discount` (cả ước tính lẫn thật);
   `OrderItem` thêm `originalPrice` (mapper ghi `model_original_price`) làm dự phòng cho đơn chưa có
   escrow; `computePnlRow` Shopee: `revenueGross = grossOriginal ?? Σ originalPrice×qty ?? Σ price×qty`,
   `sellerVoucher += sellerProductDiscount` (không có thì Σ(original − discounted)×qty); tăng
   `LEDGER_FORMULA_VERSION` → worker tính lại nền. **Backfill** đơn cũ bằng MỘT câu SQL từ
   `expectedIncome` JSON (30 ngày: 1.196/1.196 đơn có snapshot; tỷ lệ với đơn cũ hơn kiểm trước);
   đơn không có snapshot giữ như cũ (ghi rõ).
2. **Lát 2 TikTok đơn chưa có bản kê:** `OrderItem` ghi `original_price` + `seller_discount` dòng;
   `computePnlRow` dùng khi chưa có settlement để đơn "tạm tính" cùng định nghĩa với đơn có bản kê.
3. **Lát 3 giao diện:** nhãn + tooltip thẻ 1 và dòng giảm giá (web + mobile, cùng endpoint); bảng Lãi/Lỗ
   tab Shopee thêm cột "Giảm giá SP của shop" cho giống tab TikTok 3 cột; Tổng quan `/api/analytics`
   dùng cùng `revenueGross` nên tự theo.
4. **Lazada:** giữ `item_price` + ghi chú tooltip "Lazada: giá bán trên sàn"; kiểm trường giá niêm yết
   khi có gian thật.

Kiểm sau khi lên: thác nước đóng từng đồng (`grossValue − totalDeduction = Doanh thu`); so 30 ngày ANO:
Shopee thẻ 1 ≈ 359 triệu, dòng giảm giá Shopee ≈ 77 triệu; TikTok không đổi; Doanh thu 301.981.623 giữ nguyên.

## 6. Chờ anh chốt
- Chọn A (đề xuất) / B / C.
- Nếu A: một dòng "Giảm giá của shop" gộp (đề xuất) hay hai dòng "Giảm giá sản phẩm" + "Voucher/xu"
  (TikTok sẽ dồn hết vào dòng đầu).
- Backfill đơn lịch sử từ snapshot (đề xuất) hay chỉ áp cho đơn từ ngày lên.

## 7. ANH CHỐT 29/10 (trưa): Tổng giá trị sản phẩm = "Tổng phụ SAU giảm giá của người bán" (cột 3 tab TikTok)

Ví dụ anh đưa: niêm yết 200, shop tự khuyến mãi 50, bán 150 → **lấy 150**. Khuyến mãi là chuyện định giá
của shop, không phải khấu trừ của sàn. Cách A (giá gốc) BỎ. Shopee thêm 2 cột đứng trước giống TikTok,
cột 3 của cả hai sàn là "Tổng giá trị sản phẩm".

| Cột | Shopee | TikTok |
|---|---|---|
| 1. Tổng phụ trước giảm giá | `order_income.order_original_price`; đơn chưa có escrow / đơn hủy (escrow đơn hủy trả selling ≈ 0): Σ `model_original_price` × qty | `subtotal_before_discount_amount`; chưa bản kê: Σ `line_items.original_price` |
| 2. Giảm giá của người bán | `seller_discount` + `voucher_from_seller` + `seller_coin_cash_back` (gộp để cùng nghĩa với TikTok — bản kê TikTok gộp KM sản phẩm + voucher); chưa có escrow: Σ (`model_original_price` − `model_discounted_price`) × qty | `seller_discount_amount`; chưa bản kê: Σ `line_items.seller_discount` |
| 3. **Tổng giá trị sản phẩm** = 1 − 2 | | `revenue_amount` (sàn trả sẵn); chưa bản kê: 1 − 2 từ dòng hàng |

Hệ quả bắt buộc: dòng "Voucher trợ giá của shop" trong thẻ 1 Báo cáo dòng tiền **không còn là khấu
trừ** (đã nằm trên cột 3, trừ nữa là trừ hai lần) → chuyển thành dòng tham khảo "Shop đã giảm giá: X"
(không cộng vào Tổng khấu trừ) hoặc bỏ — chờ anh chọn. Đẳng thức thẻ: cột 3 − (phí + thuế + hoàn +
chênh ship + nạp ví − trợ giá) = Doanh thu. Tổng quan `/api/analytics` dùng cùng `revenueGross` nên tự theo.

## 8. TƯ DUY THIẾT KẾ ANH CHỐT 29/10 (sửa lại mục 7 — áp cho Báo cáo dòng tiền)

> **Tổng giá trị sản phẩm = giá trị món hàng khi nó nằm trong giỏ của khách** (giá bán hiển thị, đã gồm
> chương trình giảm giá sản phẩm/flash sale của shop — đó là định giá, không phải khấu trừ: niêm yết 200,
> khuyến mãi 50, bán 150 → lấy 150). **Mọi công cụ ép khách bấm thanh toán** (voucher shop, xu hoàn,
> combo "mua 2 giảm 10 %", add-on deal…) = các dòng KHẤU TRỪ âm ngay dưới thẻ, để chủ shop thấy tháng này
> đã "cắt máu" bao nhiêu cho kích cầu. Doanh thu bên dưới không đổi.

Soi lại hiện trạng theo định nghĩa này:
- **Shopee ĐÚNG sẵn:** `model_discounted_price` = giá trong giỏ; khấu trừ = `voucher_from_seller` +
  `seller_coin_cash_back`. Thiếu: dòng combo/bundle (escrow `order_selling_price − order_discounted_price`,
  ANO 30 ngày = 0) và dòng add-on deal — kiểm khi có shop dùng.
- **TikTok SAI:** thẻ 1 đang lấy `subtotal_before_discount` (giá niêm yết, TRƯỚC giảm giá sản phẩm) và dòng
  "Voucher trợ giá của shop" = `seller_discount_amount` gộp cả giảm giá sản phẩm lẫn voucher (bản kê không
  tách) → 66 triệu "voucher" của ANO phần lớn là giảm giá sản phẩm, không phải kích cầu.

**Nguồn API để tách cho TikTok (docs đọc 29/10 qua JSON docs partner.tiktokshop.com):** `GET Get Order
Price Details 202407` (`/order/202407/orders/{id}/price_detail`), từng dòng hàng:
`sku_list_price` (MSRP) · `subtotal_deduction_seller` (giảm giá sản phẩm shop) · `subtotal_deduction_platform`
· `sku_sale_price = list − deduction_seller − deduction_platform` (= giá trong giỏ) · `voucher_deduction_seller`
(voucher shop) · `voucher_deduction_platform` · `seller_funded_product_promotions[] {activity_id, discount_amount,
discount_type: COUPON | ACTIVITY}`. Order detail 202309 chỉ có `sub_total = original_total_product_price −
seller_discount − platform_discount` (seller_discount gộp). **Chưa kiểm trên đơn thật**: voucher có nằm ngoài
`sku_sale_price` không, và `subtotal_deduction_seller + voucher_deduction_seller` có = `seller_discount_amount`
bản kê không → lát 0 = probe ~20 đơn TikTok thật (script trên worker), ghi kết quả vào đây trước khi code.
Chi phí: thêm 1 lượt gọi/đơn TikTok (hạn mức sàn — xem memory reference-tiktok-rate-limits).

**Hai cột thêm cho tab Shopee (anh hỏi "API hay bịa"): API thật, không bịa** — `order_income.order_original_price`
+ `seller_discount` (escrow, có cả ước tính lẫn thật; 30 ngày ANO 1.196/1.196 đơn có snapshot: 359,3 tr / 77,0 tr),
dự phòng `model_original_price` − `model_discounted_price` từ `get_order_detail`. Theo tư duy mục này, hai cột
đó là THÔNG TIN "trên giỏ" (niêm yết → giảm giá sản phẩm → giá trong giỏ) cho bảng Lãi/Lỗ đối soát với bảng
thu nhập Seller Center; **không** vào Tổng khấu trừ của thẻ 1 Báo cáo dòng tiền.

Mục 7 (cột 3 TikTok) chỉ còn đúng ở ý "TikTok phải lấy giá sau giảm giá sản phẩm"; phần "gộp voucher vào
cột 2" BỎ — voucher là khấu trừ riêng.

## 9. KẾ HOẠCH LÁT SỬA (anh yêu cầu tổng kết 29/10 chiều — chưa code lát nào)

Nguyên tắc: số lên báo cáo = trường sàn trả, không công thức ước; "hiệu hai cột" chỉ dùng làm test chéo.

| Lát | Việc | Nguồn số | Kiểm |
|---|---|---|---|
| **1. TikTok về giá trong giỏ** | `computePnlRow`: đơn TikTok có bản kê → `revenueGross = revenueAmount` (cột 3 "Tổng phụ sau giảm giá của người bán"); đơn hoàn/hủy mà sàn đưa revenue về 0 → lấy số sàn hoàn (`refund_subtotal_before_discount + seller_discount_refund`, = cột "Doanh thu hoàn trả"); `sellerVoucher` TikTok = 0 (không trừ nữa vì đã nằm trên thẻ 1); đơn chưa bản kê giữ `sale_price` ("tạm tính"). Tăng `LEDGER_FORMULA_VERSION`. Web + mobile: tooltip thẻ 1 "giá món hàng trong giỏ", dòng "Voucher trợ giá của shop" → "Voucher & xu của shop". | bản kê 202501 / unsettled 202507 | test chéo `grossSales − |sellerDiscount| = revenueAmount` (đơn thường) và `= |refund|` (đơn hoàn/hủy), lệch → báo đỏ; prod ANO: TikTok thẻ 1 243,2 → ≈178,8 tr, Đã hủy TikTok 60,8 → ≈45 tr, Doanh thu 301.981.623 không đổi |
| **2. Phí quảng cáo mới TikTok** | Docs 29/10 KHÔNG có trường tên "gmv_max_pro"; các phí quảng cáo/kích cầu mới trong `fee_tax_breakdown.fee`: `cps_shop_ads_commission_tax_amount` (thuế trên phí GMV Max), `smart_promotion_fee_amount` (+`_tax_amount`), `seller_growth_fee_amount`, `new_customer_growth_package_fee`, `target_product_gmv_growth_package_fee`, `store_gmv_growth_package_fee` (+ 3 thuế), `tap_shop_ads_commission`, `brand_amplification_program_commission`, `campaign_period_fee_sp/cfp_amount`. Hiện tất cả rơi vào `feeOther` (chốt chặn `fee_tax_amount − đã bóc`) → không mất tiền nhưng không có cột. Bước 1: đọc log `describeTiktokFeeTax` 3 gian anh trên prod xem phí nào THẬT SỰ xuất hiện; bước 2: thêm cột cho phí xuất hiện, gom nhóm "Phí quảng cáo sàn trừ trong đơn" (cùng `feeGmvMax`) để Báo cáo dòng tiền không cộng đôi AdSpend. | bản kê | Σ cột mới + cột cũ + thuế = `fee_tax_amount` từng đơn |
| **3. Tách voucher TikTok** | Probe ~20 đơn thật `GET /order/202407/orders/{id}/price_detail`: `sku_sale_price`, `subtotal_deduction_seller`, `voucher_deduction_seller`, `seller_funded_product_promotions[].discount_type COUPON/ACTIVITY`; nếu `subtotal_deduction_seller + voucher_deduction_seller = |seller_discount_amount|` bản kê → lưu `voucher_deduction_seller` → dòng "Voucher & xu của shop" có TikTok, thẻ 1 TikTok = `sku_sale_price`. Thêm 1 call/đơn → tính hạn mức. | Price Details 202407 | kết quả probe ghi vào docs trước khi code |
| **4. Shopee đủ dòng** | Tab Shopee thêm 2 cột THÔNG TIN "Giá gốc" (`order_original_price`; đơn hủy/chưa escrow: Σ `model_original_price`×qty) và "Giảm giá SP của shop" (`seller_discount`; dự phòng original − discounted) — không vào khấu trừ. Dòng khấu trừ mới "Combo / mua kèm" = `order_selling_price − order_discounted_price` (ANO = 0, kiểm shop có bundle). | escrow + get_order_detail | 2 cột − giá trị SP = 0 từng đơn |
| **5. Lazada** | kiểm trường giá niêm yết khi có gian thật; tạm giữ `item_price`. | — | — |

Thứ tự: 1 → 2 (bước 1 chỉ đọc log) → 3 → 4 → 5. Mỗi lát: test thuần + test DB + so prod bằng `?from/to&channelName` trước/sau, push riêng.

## 10. LÁT 1 ĐÃ CODE 29/10 (chưa push — anh push)

- `lib/pnl-formula.ts`: đơn TikTok có bản kê → `revenueGross = grossSales + sellerDiscount` (có dấu) =
  `revenue_amount` dòng ORDER = giá món hàng trong giỏ; `sellerVoucher = 0`. Không đọc cột `revenueAmount`
  đã lưu vì cột đó là Σ mọi dòng (ORDER + REFUND) → đơn hoàn/hủy về 0 trong khi tiền hoàn đã có cột riêng.
  Đơn chưa bản kê giữ `sale_price` ("tạm tính"). Shopee/Lazada không đổi.
- `integrations/tiktok/settlements.ts` `tiktokRevenueIdentityGap` + gọi ở `writeTiktokSettlement`
  (`tiktok/service.ts`): mỗi lượt đồng bộ kiểm `revenue_amount(ORDER) = subtotal_before_discount +
  seller_discount`; lệch > 1đ → `console.warn [TikTok] Bản kê đơn <id>: revenue_amount dòng ORDER lệch…`
  (số vẫn ghi như sàn, không tự sửa). Soi log worker sau deploy: 0 dòng cảnh báo = đẳng thức đúng trên đơn thật.
- `lib/order-ledger.ts` `LEDGER_FORMULA_VERSION = 2` → worker đánh bẩn + tính lại nền (`markFormulaVersionStale`
  5.000/lượt, lô 100 mỗi 2 s ≈ 50 dòng/giây → prod ~42k+ dòng ≈ 15–20 phút); báo cáo gọi `ensureLedgerFresh`
  tự tính inline ≤ 2.000 dòng của kỳ đang xem, dải "đang tính lại" hiện trong lúc chờ. Deploy giờ vắng để
  khỏi dồn IO Supabase (sự cố 28/10).
- Nhãn: thẻ 1 web có tooltip "giá món hàng trong giỏ…"; dòng "Voucher trợ giá của shop" → **"Voucher & xu của
  shop"** (backend `cash-flow-totals.ts` + donut web `app/page.tsx` + mobile `FinancePage.tsx`, đi 1.4.1).
  Bảng Lãi/Lỗ tab TikTok giữ nguyên 3 cột bản kê.
- Test: `lib/__tests__/pnl-formula-tiktok.test.ts` (đơn thường 333.200, đơn hủy ảnh anh 350.000, đơn chưa bản
  kê 279.000, thác nước đóng, netRevenue vẫn = payout 232.200); `tiktok-settlements.test.ts` thêm 3 ca đẳng
  thức (ORDER docs, unsettled est_, dòng lạ/−3.200, chỉ điều chỉnh → null). 102 ca thuần qua; tsc BE + FE sạch.
  DB dev: đánh bẩn 318.482 dòng v1 → drain 335.778 dòng (~3.000 dòng/giây, máy em) → 29/31 ca sổ ↔ đơn qua;
  2 ca đỏ sẵn từ 14/10 (chỉ mục trigram cục bộ, cascade xóa chủ shop) — kiểm bằng git stash: đỏ y hệt khi
  chưa có lát 1.
- **Kiểm prod sau deploy (anh hoặc em qua Chrome):** `/api/finance/analytics?from=2026-09-30&to=2026-10-29`
  `&channelName=TIKTOK`: gross ≈ 178,8 tr (trước 243,2), voucher 0 (trước 65,9 tr), revenue 127.737.839 KHÔNG
  đổi, cancelled ≈ 45 tr (trước 60,8); tất cả: gross ≈ 450 tr, revenue 301.981.623 không đổi; thác nước
  `gross − totalDeduction = revenue`. Log worker không có `[TikTok] Bản kê đơn … lệch`.

**✅ PROD 29/10 09:58 VN (58e82360 Live web 09:45; worker tính lại nền):** sổ prod có **587.000 dòng** (không phải
42k — đã gồm đơn backfill từ 10/2026), worker đánh bẩn 5.000/2 s + tính ~290–385 dòng/giây → 32k (09:50) →
170k (09:58), ước xong ~10:25. Trong lúc chờ, kỳ đang xem tự tính inline (ensureLedgerFresh) nên tài khoản anh
30 ngày đã pending 0 ngay lượt gọi đầu. **Số 30/09–29/10 sau lát 1:** Tất cả gross 449.950.316 (trước
514.925.215), voucher 0, Doanh thu 302.624.025 (sáng 301.981.623 — chênh 642k là đơn/bản kê mới trong ngày:
Shopee 174,24 → 174,67 tr, TikTok 127,74 → 127,95 tr, cả hai cùng tăng), Đã hủy 115.196.567 (trước 130.889.832);
TikTok gross **177.605.101** (dự kiến ≈178,8 tr ✓, trước 243,2 tr), voucher 0, Đã hủy **45.113.592** (dự kiến ≈45 tr ✓);
Shopee gross 272.345.215 (logic không đổi, +647k đơn mới). Thác nước `gross − deduction − revenue = 0` ở cả 3 bộ lọc.
**Log worker 10:00 (Render, đọc được):** ~20 dòng "[TikTok] Bản kê đơn … lệch −119.200 / −227.998 / −110.999 /
−164.449" — TOÀN đơn HỦY: sàn ghi hoàn **ngay trong dòng ORDER** (`refund_subtotal_before_discount` −188.000 +
`seller_discount_refund` +68.800, `revenue_amount` 0) chứ không tách dòng REFUND như ví dụ docs → hàm kiểm bản đầu
báo lệch oan đúng bằng số hoàn. Sửa `tiktokRevenueIdentityGap` cộng cả hai trường hoàn của dòng ORDER (test
thêm ca đơn hủy prod 586756220458927563: lệch 0, giá trong giỏ 119.200 = refundedAmount 119.200).
**★ CHỨNG MINH TRÊN TOÀN PROD (SQL 10:01):** 372.305 bản kê TikTok — nhóm không hoàn 305.298 dòng: `grossSales +
sellerDiscount = revenueAmount` lệch **0**; nhóm có hoàn 67.007 dòng: `+ refundGross + sellerDiscountRefund =
revenueAmount` lệch **0** → "giá trong giỏ" của computePnlRow = đúng số `revenue_amount` sàn ghi ở mọi đơn
từng lưu, không có đơn ngoại lệ. ⏳ v1 còn ~417k dòng lúc 09:58 (worker tính nền).

## 11. LÁT 2 BƯỚC 1 — PHÍ TIKTOK ĐANG RƠI VÀO "PHÍ KHÁC" (đọc log prod 29/10 10:12, CHƯA CODE)

SQL `tiktok_order_settlements` tài khoản anh (theo tháng tạo đơn): and.not.or `feeOther` = 0 (T8, 1.141 đơn),
0 (T9, 868 đơn), **−1.665.925 ở T10 trên 115/779 đơn**; ANO Official −8.085 (3 đơn), DARKMAN −345 (1 đơn);
`feeGmvMax` = 0 cả 3 gian 3 tháng (không chạy GMV Max trừ trong đơn). → phí mới xuất hiện từ tháng 10.

Log `[TikTok] Phí/thuế thật dòng` (Render, 1 giờ) — tên trường thật trong `fee_tax_breakdown.fee` chưa có cột:
| Trường | Ví dụ thật | Docs (29/10) | Ghi chú |
|---|---|---|---|
| `bonus_cashback_service_fee_amount` | −22.481 trên đơn 1.498.762 (1,5 %); −1.328 trên 300.000 (sau CK) | "service fee charged for participation in the bonus cashback program" | % theo doanh thu sau CK; chương trình Bonus Cashback (seller growth) |
| `shipping_fee_guarantee_service_fee` | −1.620 cố định (2 đơn) | "flat service fee charged for each order under the Shipping Fee Guarantee Program" | phí dịch vụ ship, nằm trong fee |
Không thấy trường nào tên "gmv_max_pro"; docs cũng không có. Các phí quảng cáo mới khác trong docs
(`cps_shop_ads_commission_tax_amount`, `smart_promotion_fee_amount`, 3 `*_growth_package_fee`,
`seller_growth_fee_amount`, `tap_shop_ads_commission`) CHƯA thấy trên 3 gian anh.

**Đề xuất bước 2 (chờ anh gật vì có migration prod):** thêm 2 cột `feeBonusCashback`, `feeShipGuarantee` vào
`TiktokOrderSettlement` (migration chỉ đụng bảng này, không đụng Order), mapper + `FEE_KNOWN`, cột trong bảng
Lãi/Lỗ TikTok (nhóm Phí dịch vụ), test chốt chặn Σ = `fee_tax_amount`. Bản kê cũ đã lưu không có dòng thô →
số cũ vẫn nằm ở "Phí khác" (đúng tổng, chỉ thiếu tên); muốn tách lùi phải đọc lại bản kê tháng 10 qua API
(statementIds đã lưu) — làm thêm nếu anh cần. Đồng thời đặt lưới: phí lạ ≠ 0 → log tên 1 lần/ngày/gian (đang có
`describeTiktokFeeTax` theo dòng).

**✅ LÁT 2 BƯỚC 2 ĐÃ CODE 29/10 10:20 (anh "Làm đi"):** migration
`20261029110000_tiktok_settlement_fee_bonus_cashback_ship_guarantee` (chỉ `tiktok_order_settlements`, khóa có thử lại)
thêm `feeBonusCashback` + `feeShipGuarantee`; mapper `tiktok/settlements.ts` bóc 2 trường, vào `FEE_KNOWN`, cột gộp
`serviceFee` (phí dịch vụ sàn, cùng nhóm Voucher Xtra) — tổng payout/Lãi/Lỗ KHÔNG đổi, chỉ tách tên; `computePnlRow`
trả 2 khóa mới trong `tiktok`; FE `pnl-mappers.ts` 2 cột nhóm Phí trong bảng Lãi/Lỗ TikTok + tooltip "Phí khác" ghi rõ
bản kê trước 29/10 còn gộp. Test: ca đơn prod 586613690914604995 (Bonus Cashback −22.481, Bảo đảm phí VC −1.620,
Phí khác 0, Σ = fee_tax_amount, serviceFee = 29.101). 22 ca TikTok + merge-db qua; tsc BE/FE + eslint sạch. DB dev:
`prisma migrate deploy` kẹt vì migration cũ `20260830120000_fee_audit` hỏng từ 17/09 (máy em) → áp bằng
`prisma db execute --file`. ⏳ sau deploy: SQL `sum(feeBonusCashback)` trên bản kê mới đồng bộ > 0; bản kê cũ giữ ở Phí khác.

**✅ PROD 10:22 29/10:** lát 1 — sổ v1 còn **0** dòng (587k dòng tính xong ~35 phút, 09:48 → 10:22); lát 2 — migration
`20261029110000` đã áp, **1.649 bản kê** đã có số ở `feeBonusCashback`/`feeShipGuarantee` (lượt đồng bộ bản kê sau deploy
ghi đè bản kê gần đây). Lát 3 bước probe: `backend/scripts/tiktok-price-detail-probe.ts` (chỉ đọc, in không dấu; kiểm
3 đẳng thức list = gross, dedS + vS = |disc|, list − dedS = giá trong giỏ; chạy `npx tsx scripts/tiktok-price-detail-probe.ts
[shopName] [limit]` trên Shell worker).

## 12. LÁT 3 — PROBE "Get Order Price Details" 202407 TRÊN ĐƠN THẬT (29/10 10:30–10:40, Shell worker, chỉ đọc)

Script `backend/scripts/tiktok-price-detail-probe.ts` (commit 543809fd), chạy 3 lượt: and.not.or 20 đơn; mọi gian
TikTok ACTIVE 8 đơn/gian (ước tính + thật); mọi gian 6 đơn ĐÃ GIAO + bản kê THẬT (`settled`).

**Kết quả (đọc màn Shell):**
- (a) `sku_list_price` = `grossSales` bản kê: **đúng mọi đơn** (0 lệch, cả 3 lượt).
- (c1) `sku_list_price − subtotal_deduction_seller` = giá trong giỏ của bản kê (`grossSales + sellerDiscount`): **đúng mọi đơn**.
- (c3) `sku_sale_price` (= list − deduction_seller − deduction_platform) = Σ `OrderItem.price` (sale_price đơn hàng):
  **đúng mọi đơn** → giá dòng hàng của API đơn đã trừ cả phần SÀN giảm (`subtotal_deduction_platform` = `voucher_deduction_platform`
  ở mọi đơn thấy), vì thế đơn "tạm tính" thấp hơn bản kê đúng bằng phần sàn giảm (giải thích lệch ~5,6 % mục 3c).
- (b) `subtotal_deduction_seller + voucher_deduction_seller` so với |`seller_discount_amount`| bản kê: **LỆCH đúng bằng
  `voucher_deduction_seller` ở MỌI đơn có voucher** (Zestech 26.400 / 3.320 / 585.000; Vo Chuyen 50.000; DEFENIKSA
  20.000; Dao Em 9.000; đơn ĐÃ GIAO thật 586778701907264518: dedS 355.920, vS 71.114, |disc| 355.920; 586773575986039616
  dedS 674.677, vS 100.000) và có đơn **vS = dedS** (586814133689157552: 33.272 = 33.272). → `voucher_deduction_seller`
  là PHẦN NẰM TRONG `subtotal_deduction_seller`, không cộng thêm. Tức **chiết khấu của nhà bán hàng trên bản kê =
  giảm giá sản phẩm + voucher shop (gộp)**, và price_detail cho biết phần voucher bên trong.
- Payload VN **không có** `seller_funded_product_promotions` (COUPON/ACTIVITY) → không cần, `voucher_deduction_seller` đủ.
- Hình dạng dòng hàng VN: `sku_list_price, sku_sale_price, subtotal, subtotal_deduction_seller, subtotal_deduction_platform,
  voucher_deduction_seller, voucher_deduction_platform, shipping_list_price, shipping_sale_price, shipping_fee_deduction_*,
  payment, net_price_amount, total, tax_amount, subtotal_tax_amount, sku_gift_original_price`.
- Lỗi API: 0 (and.not.or 20/20); hạn mức: 1 read/đơn qua `callApi` (làn gian).

**Thiết kế lát 3 (đề xuất, chờ anh gật):** số lên báo cáo = trường sàn, không công thức:
- Lưu `voucher_deduction_seller` của đơn vào cột mới `Order.tiktokVoucherSeller` (null = chưa đọc) + `tiktokPriceDetailAt`;
  đọc 1 lần/đơn khi ghi bản kê (ước tính hoặc thật) và bù nền cho đơn có bản kê trong ~90 ngày (nhịp qua cổng rate-limit,
  ~4k đơn/ngày toàn hệ thống).
- `computePnlRow` TikTok: Tổng giá trị SP = `grossSales + sellerDiscount + tiktokVoucherSeller` (= list − giảm giá sản phẩm
  shop, đúng "giá trong giỏ" trước voucher); `sellerVoucher = tiktokVoucherSeller` → dòng "Voucher & xu của shop" có TikTok;
  đơn chưa đọc price_detail giữ như lát 1 (voucher 0, nhãn tạm). Tăng `LEDGER_FORMULA_VERSION` → 3 (tính lại ~35 phút —
  nên gộp cùng lát 4 Shopee để chỉ tính lại một lần).
- Bảng Lãi/Lỗ TikTok: thêm cột "Voucher của shop (trong chiết khấu)" từ cột mới; Doanh thu/payout không đổi.

## 13. LÁT 3 + 4 ĐÃ CODE 29/10 (anh "Làm lát 3+4") — sổ cái v3

**Lát 3 (TikTok voucher):** `integrations/tiktok/price-detail.ts` — `fetchOrderPriceDetail` (GET
`/order/202407/orders/{id}/price_detail`, làn đọc qua rate-gate), `voucherSellerFromPriceDetail` (ưu tiên số cấp đơn,
thiếu → Σ dòng, không trường → null không ghi), `backfillTiktokPriceDetails(channel, {limit})`: đơn có bản kê, 90 ngày,
`tiktokPriceDetailAt` null, mới nhất trước, ≤200 đơn/lượt, dừng sau 5 lỗi. Gọi ở worker `order-auto-sync.ts` (sau ước tính
unsettled, trước quét bù hoàn) và nút tay `/channels/:id/sync-settlements` (300 đơn). Cột `Order.tiktokVoucherSeller` +
`tiktokPriceDetailAt`; `computePnlRow`: `revenueGross = grossSales + sellerDiscount + voucher`, `sellerVoucher = voucher`
(null → 0 như lát 1); `LEDGER_FORMULA_VERSION = 3`; trigger đánh bẩn thêm cột `tiktokVoucherSeller` (bù nền tự tính lại).
Bảng Lãi/Lỗ TikTok thêm cột "Trong đó: voucher của shop" (— khi chưa đọc). Tooltip dòng "Voucher & xu của shop" ghi TikTok.

**Lát 4 (Shopee "trên giỏ", CHỈ hiển thị, không đổi công thức):** SQL prod 30 ngày 22.203 đơn Shopee không hủy có snapshot
escrow: `order_original_price − order_seller_discount` = Σ `OrderItem.price` ở 21.547 (97 %) = đúng mức `order_selling_price`
= Σ items (21.534); 213 đơn có bundle (selling ≠ discounted); đơn HỦY escrow rỗng (33/2.947 khớp). → Giữ `revenueGross`
Shopee = Σ `model_discounted_price` (đang đúng "giá trong giỏ" 97 %, khớp Seller Center); thêm 3 cột HIỂN THỊ ở tab Shopee:
Giá gốc (`shopeeOriginalPrice` ← `order_original_price`), Giảm giá SP của shop (`shopeeSellerDiscount` ←
`order_seller_discount`), Combo/mua kèm (`shopeeBundleDiscount` ← `order_selling_price − order_discounted_price`), ghi ở
`mapShopeeEscrowFields` (ước tính + thật); đơn hủy/chưa escrow: FE cộng từ `OrderItem.originalPrice` (mapper Shopee ghi
`model_original_price`, TikTok ghi `original_price` — từ 29/10, đơn cũ null → "—"). **Chưa đưa combo vào Tổng khấu trừ** của
Báo cáo dòng tiền: với bundle Shopee trả `model_discounted_price = 0` nên Σ items đã thiếu phần đó (rơi vào "Lệch quyết toán
khác"); cộng combo nữa là trừ hai lần — cần escrow `items[]` (chưa lưu) mới làm đúng; 213/22k đơn, ANO 0. Backfill 3 cột
Shopee cho đơn cũ: SQL từ `expectedIncome` (không đụng trigger sổ):
```sql
UPDATE "Order" SET "shopeeOriginalPrice" = ("expectedIncome"->>'order_original_price')::numeric,
  "shopeeSellerDiscount" = ("expectedIncome"->>'order_seller_discount')::numeric,
  "shopeeBundleDiscount" = ("expectedIncome"->>'order_selling_price')::numeric - ("expectedIncome"->>'order_discounted_price')::numeric
WHERE "shopeeOriginalPrice" IS NULL AND "expectedIncome" ? 'order_original_price' AND "shippingStatus" <> 'CANCELLED'
  AND "createdAt" >= '2026-MM-01' AND "createdAt" < '2026-MM+1-01';   -- chạy theo tháng
```
Migration `20261029130000_order_tiktok_voucher_shopee_original` (Order + OrderItem, khóa có thử lại, trigger sửa WHEN).
Test: `pnl-formula-tiktok` thêm ca Zestech (voucher 26.400 → gross 330.000, voucher 26.400, actualRevenue 303.600 không đổi;
null → như lát 1), `tiktok-price-detail.test.ts` 3 ca; 138 ca thuần + 27/29 DB (2 đỏ sẵn) qua; tsc BE/FE + eslint sạch;
DB dev tính lại 338k dòng v3.

**Sau deploy (prod):** migration áp → sổ tính lại ~35 phút; worker đọc price_detail 200 đơn/gian/giờ → chạy tay
`backfillTiktokPriceDetails` cho 3 gian anh (limit 2.000) để thấy ngay; SQL backfill Shopee theo tháng; kiểm: TikTok thẻ 1 =
177,6 tr + Σ voucher, dòng voucher TikTok > 0 ở gian có voucher, Doanh thu 302,6 tr không đổi, thác nước 0.

**⚠️ SỰ CỐ 11:00 29/10 (sổ v2 → v3) + SỬA GỐC:** anh báo "lỗi hết cả báo cáo dòng tiền" — API 200 nhưng `ledgerPending`
1.031, thẻ 1 chỉ 256,8 tr (đúng 451 tr), bảng gian hàng treo "Đang tải": dòng sổ còn v2 bị loại khỏi tổng tới khi worker
đánh bẩn (5.000 dòng/2 s, 587k dòng → shop lớn chờ hàng chục phút) vì `ensureLedgerFresh` chỉ nhặt dòng ĐÃ bẩn.
**Sửa `services/order-ledger.ts` (807d2fab):** lượt nhặt CÓ PHẠM VI (báo cáo đang xem) nhặt cả dòng `formulaVersion` cũ
chưa bẩn; `ensureLedgerFresh` coi "còn dòng phiên bản cũ" là chưa sạch. Deploy 11:12 → gọi lại: pending 0, thẻ 1
451.728.316, Doanh thu 303.728.185, thác nước 0, 0,25–0,36 s/lượt. Từ nay đổi version công thức không còn cộng thiếu ở
báo cáo khách đang mở (worker vẫn tính phần còn lại nền).
**Backfill Shopee (11:25, thay SQL tay):** anh gửi ảnh tab Shopee còn "—" ở đơn tạo trước deploy → chuyển thành bước bảo
trì khởi động của worker sổ cái: `services/shopee-escrow-columns-backfill.ts` `backfillShopeeEscrowColumns` chép 3 cột từ
`expectedIncome` theo từng NGÀY tạo (150 ngày, đi chỉ mục createdAt, nghỉ 800 ms giữa ngày có dòng, bỏ đơn hủy, idempotent,
không đánh bẩn sổ); gọi sau `sweepFormulaVersion` (commit 8ec70634). Đơn chưa từng có snapshot escrow (trước khi có ước tính)
vẫn "—". Cột voucher TikTok "—" tới khi worker đọc price_detail (200 đơn/gian/giờ).

## 14. Anh hỏi 11:20: "Thuế TNCN trong Lãi/Lỗ thực hiện tưởng 0,5%?" — cột trống ở đơn ƯỚC TÍNH

SQL prod (3 gian anh, đơn tạo từ 01/10, revenue > 0):
| | n | TNCN/DT | GTGT/DT | Phí giao dịch/DT | Phí khác/DT | Hoa hồng/DT |
|---|---|---|---|---|---|---|
| and.not.or đã quyết toán | 514 | **−0,50 %** | −1,00 % | −3,60 % | 0,00 % | −14,83 % |
| and.not.or ước tính | 117 | 0 | −1,00 % | −5,19 % | **−5,50 %** | −14,88 % |
→ TNCN 0,5 % có đủ ở mọi đơn đã quyết toán. Đơn ước tính: docs API 202507 (đọc 29/10) khối `tax` KHÔNG có `pit_amount`
(chỉ 202501 có); log `[TikTok] Phí/thuế ước tính dòng 586846943983732399` (web, 11:21, kích đồng bộ ước tính and.not.or):
`fee=[platform_commission −40.350, transaction_fee −16.236, vn_fix_infrastructure −3.000] tax=[vat −2.690]`, còn
`est_fee_tax_amount = −77.071` → **sàn báo tổng phí ước tính cao hơn phần bóc tách 14.795 = 5,50 % doanh thu, không nêu
tên** (gian khác 4,25 % / 1,65 % / 0,50 % / 0) → đúng chỗ chốt chặn "Phí khác", biến mất khi quyết toán (settled: 0 %).
Hubsell không tự ước TNCN 0,5 % (luật không bịa). Đã sửa tooltip 2 cột (`pnl-mappers.ts`): TNCN trống ở đơn ước tính +
lý do; Phí khác ước tính = tổng sàn báo − phần bóc tách. Lợi nhuận đơn ước tính vẫn = settlement ước tính của sàn (đã gồm
khoản này) nên không lệch khi quyết toán theo chiều xấu đi.

## 15. RÀ LẠI 18/11 (anh: khách dùng Thuế bổ sung 1% × Tổng giá trị SP trả đội vận hành thuê ngoài — "xem lại công thức đã đúng chưa vì mình có lần thay đổi")

**Mã:** công thức `revenueGross` (lib/pnl-formula.ts) KHÔNG đổi từ v3 29/10; v4 04/11 chỉ đổi cờ thiếu giá vốn. Sổ prod 30 ngày
(đơn tính doanh thu): Shopee 28.762 đơn 6,16 tỷ · TikTok 197.627 đơn 51,07 tỷ · Lazada 694 đơn 0,23 tỷ; 0 dòng phiên bản cũ.
Định nghĩa vẫn đúng chốt mục 8 (giá món hàng trong giỏ = sau KM sản phẩm của shop, trước voucher/xu/combo, trước phí sàn).

**SQL chỉ đọc prod 18/11 (Supabase, 30 ngày, mọi gian) — 3 chỗ lệch:**
1. **Shopee combo / mua kèm: Tổng giá trị SP = 0 cả đơn.** 340 đơn có `revenueGross = 0` (mọi dòng hàng `price = 0`, sàn trả
   `model_discounted_price = 0` cho hàng trong combo); `totalAmount` 114,2 tr, escrow có `order_original_price`/`seller_discount`/
   bundle (vd 180.000 − 82.800, combo 10.800). Thêm 18 đơn combo thiếu một phần (ours 4,46 tr vs escrow 15,0 tr). → thiếu
   ~110–125 tr/30 ngày ≈ 1,8–2 % Shopee, dồn vào gian bán combo. Đây là bẫy mục 13 đã ghi ("Σ items thiếu phần đó") nhưng
   mức thật là MẤT CẢ ĐƠN chứ không chỉ phần giảm.
2. **TikTok đơn không có bản kê nào (thật hay ước tính):** 10.783 đơn 1,88 tỷ (10.012 đã giao, phần lớn 15–30 ngày tuổi) dùng
   dự phòng Σ `sale_price` (đã trừ cả giảm giá sàn). Đơn có bản kê thật: `revenueGross` cao hơn Σ sale_price **20,13 %** → nhóm
   này đang thiếu ~350 tr (≈0,7 % TikTok), dồn ở vài gian (gian nhiều nhất 33 % đơn 30 ngày không bản kê). Gốc chưa tra: vì sao
   đơn đã giao lâu vẫn không có bản kê ước tính 202507.
3. **TikTok voucher shop chưa đọc price_detail:** 9.675 đơn có bản kê nhưng `tiktokPriceDetailAt` null (8.731 ở MỘT gian, dừng
   từ ~08/11) → Tổng giá trị SP thiếu phần voucher (~1,4–2 % giá trị nhóm, ~13 tr). Nghi lượt bù nền gian đó dừng vì lỗi.

**Không phải lỗi (theo thiết kế):** 394 đơn Shopee hoàn tiền (REFUND_ONLY / PARTIAL_REFUND) — escrow ghi giá gốc − giảm giá
= 0 sau hoàn, Hubsell giữ giá trong giỏ và trừ hoàn ở dòng hoàn tiền riêng. Nghĩa là Tổng giá trị SP GỒM đơn hoàn tiền không
trả hàng (chỉ loại đơn hủy + đơn đang hoàn/trả) — khách đối chiếu với đội vận hành cần biết.

Chưa sửa gì; chờ anh chốt (định nghĩa giá trong giỏ của đơn combo: escrow `order_original_price − order_seller_discount`
có đã gồm combo hay chưa — cần đọc lại docs Shopee trước khi code).

## 16. ĐỀ XUẤT SỬA THEO SAO KÊ (19/11 chiều, lượt chạy theo lịch — anh chốt hướng: "đơn nào sàn đã trả sao kê / bản kê thì cột lấy số sao kê, API đơn hàng chỉ dùng tạm") — CHỈ ĐỀ XUẤT, CHƯA code

### 16.0 Đã kiểm / CHƯA kiểm ở lượt này (nói thẳng)

- **Đã làm:** đọc lại mã `lib/pnl-formula.ts`, `lib/order-ledger.ts` (phân bổ dòng), `shopee/settlements.ts` + `shopee/client.ts`
  (escrow), `tiktok/service.ts` (`syncTiktokSettlements`, `syncTiktokUnsettledEstimates`), `tiktok/price-detail.ts`,
  `workers/order-auto-sync.ts` (tầng nhịp giờ), `scripts/sql/ads-margin-impact.sql`.
- **CHƯA làm được (lượt tự chạy, không có anh bấm duyệt):**
  1. **Đọc lại docs escrow Shopee** — trình duyệt trong app không mở được `open.shopee.com`, Chrome treo ở hộp "Allow", WebFetch bị chặn.
  2. **SQL chỉ đọc trên prod** — Chrome cũng treo "Allow" ở `supabase.com`.
  3. **SQL chỉ đọc trên DB dev cục bộ** — bị lớp phân quyền từ chối.
  → Mọi con số dưới đây là số ĐÃ GHI ở mục 13 + 15 (29/10, 18/11), **không có số mới**. Các kết luận về Shopee là SUY LUẬN
  từ số cũ, chưa đối chiếu đơn thật hôm nay. Câu SQL để kiểm đã soạn sẵn ở 16.5 — cần anh mở Chrome bấm Allow (hoặc gọi em
  chạy lại khi anh ngồi máy).

### 16.1 Shopee — công thức "giá trong giỏ" từ escrow

**Câu phải chốt: `order_seller_discount` đã gồm phần combo chưa?** Chưa đọc lại được docs. Suy luận từ đơn mẫu mục 15
(giá gốc 180.000, `order_seller_discount` 82.800, combo = `order_selling_price − order_discounted_price` = 10.800):
- Nếu **đã gồm combo**: giảm giá sản phẩm = 82.800 − 10.800 = 72.000 = đúng **40 %** giá gốc → giá trong giỏ 108.000; combo 10.800 =
  đúng **10 %** của 108.000 (kiểu "mua 2 giảm 10 %"). Hai tỷ lệ tròn.
- Nếu **chưa gồm**: giảm giá sản phẩm 46 %, combo 11,11 % của 97.200 — hai tỷ lệ lẻ.

→ **Nghiêng mạnh về "đã gồm combo"**, tức với đơn combo `giá gốc − order_seller_discount` = giá SAU combo, KHÔNG phải giá trong
giỏ. Mức chắc: suy luận từ MỘT đơn, chưa phải docs, chưa phải nhiều đơn.

**Công thức đề xuất — không phụ thuộc câu trên:** dùng thẳng **`order_selling_price`** (Σ giá sau KM sản phẩm của shop, TRƯỚC
combo; mục 13 đã đo = Σ `model_discounted_price` × SL ở 97 % đơn không combo).

```
Shopee, đơn KHÔNG hủy, đã có escrow (ước tính hoặc thật), refundedAmount = 0, order_selling_price > 0:
    Tổng giá trị SP (revenueGross)   = order_selling_price
    Khấu trừ "Voucher & xu của shop" = voucher_from_seller + seller_coin_cash_back   (như cũ)
    Khấu trừ MỚI "Combo / mua kèm"   = order_selling_price − order_discounted_price  (cột shopeeBundleDiscount đã có)
Còn lại (đơn hủy, chưa có escrow, đơn có hoàn tiền): Σ model_discounted_price × SL như hiện nay.
```
- Vì sao loại đơn có hoàn tiền: mục 15 ghi escrow của đơn hoàn về 0 sau hoàn; Hubsell giữ giá trong giỏ và trừ hoàn ở dòng
  riêng — lấy escrow là trừ hoàn hai lần. **Lỗ còn lại:** đơn combo CÓ hoàn tiền vẫn = 0 (chưa đếm được bao nhiêu đơn).
- Vì sao lần này cộng combo vào khấu trừ được (mục 13 từng chặn): lúc đó Σ dòng hàng đã thiếu sẵn phần combo nên cộng là trừ
  hai lần; khi gốc là `order_selling_price` thì không còn thiếu.
- Đúng định nghĩa mục 8: sau KM sản phẩm của shop, trước voucher / xu / combo.
- **Giả định phải kiểm (K1, 16.5):** `selling − discounted` đúng là combo chứ không lẫn `shopee_discount` (sàn giảm rồi bù).

**Việc mã (khi anh duyệt):** thêm cột `Order.shopeeSellingPrice` ← `order_selling_price` trong `mapShopeeEscrowFields` (ghi ở cả
luồng ước tính lẫn quyết toán → đúng "lấy số sao kê"); bù đơn cũ bằng bước bảo trì khởi động worker sổ cái chép từ
`expectedIncome` (mẫu `backfillShopeeEscrowColumns` 29/10, không SQL tay); `computePnlRow` thêm nhánh Shopee; trigger đánh bẩn sổ
thêm cột mới; `LEDGER_FORMULA_VERSION` 4 → 5; web + mobile thêm dòng khấu trừ "Combo / mua kèm".

**★ Điểm em tìm thêm khi đọc `order-ledger.ts` — đơn combo đang VÔ HÌNH với quảng cáo:** dòng hàng chia theo `SL × price`; đơn
combo mọi dòng price = 0 → `lineGross` = 0 → (a) hòa vốn / biên lãi quảng cáo bỏ qua cả đơn (`WHERE lineGross > 0`), (b) cờ thiếu
giá vốn không bao giờ bật, (c) Lãi/Lỗ theo SKU chia đều theo số dòng. Sửa cấp ĐƠN không tự sửa cấp DÒNG. Muốn dòng đúng: khi
Σ price = 0 thì chia theo `OrderItem.originalPrice × SL` (đã lưu từ 29/10, 0 lần gọi sàn). Tách thành lát S2 vì nó làm đơn combo
BƯỚC VÀO hòa vốn quảng cáo.

### 16.2 TikTok (2) — đơn đã giao lâu vẫn không có bản kê nào: giả thuyết + cách kiểm (KHÔNG vá số)

Đọc `syncTiktokUnsettledEstimates` (`tiktok/service.ts`):
- **H1 (nghi nhất) — trần trang cắt đuôi:** mỗi lượt đọc tối đa `MAX_PAGES = 50` trang × 100 dòng = **5.000 dòng**, xếp
  `order_create_time` MỚI NHẤT TRƯỚC, lượt nào cũng bắt đầu lại từ đầu (không con trỏ). Gian có > 5.000 dòng chưa quyết toán
  trong 45 ngày → phần đơn CŨ NHẤT không bao giờ được đọc, và mã KHÔNG ghi log khi chạm trần. Khớp triệu chứng mục 15: dồn ở vài
  gian lớn, đơn 15–30 ngày tuổi.
- **H2 — bản kê thật bị cắt 5.000 dòng:** `syncTiktokSettlements` đọc mỗi bản kê tối đa 50 trang × 100 dòng, cũng không log khi
  còn trang. Bản kê ngày của gian rất lớn > 5.000 dòng → đơn phần đuôi không nhận số thật; cửa sổ nhịp giờ chỉ 7 ngày nên quá
  7 ngày là không đọc lại.
- **H3 — sàn lỗi 36009003 giữa chừng:** trang sau lỗi 3 lần thì "dừng êm, giữ N dòng" → đuôi mất; CÓ log
  `Unsettled "…": trang N bị 36009003`.
- **H4 — lượt giờ ném lỗi trước khi ghi:** 429 ở `statement_transactions` (log 08/11 đã thấy 2 dòng) làm `syncTiktokSettlements`
  ném lỗi, lô đang gom trong RAM mất. Một mình H4 chỉ giải thích "đơn giữ số ước tính mãi", không giải thích "không có bản kê nào".

**Cách kiểm (0 lần gọi sàn):**
1. Render Logs worker, lọc `Ước tính TikTok "<gian>"`: số "(N dòng" lượt nào cũng ≈ 5.000 → H1 đúng.
2. SQL K2 (16.5): đếm đơn không bản kê theo NGÀY TẠO của một gian — H1 cho hình VÁCH ĐỨNG (mới hơn mốc X gần như đủ, cũ hơn X
   gần như trống); H2 cho hình rải theo ngày quyết toán.
3. Log `trang N bị 36009003` → H3; log `Lỗi đối soát TikTok` lặp theo giờ → H4.

**Hướng sửa nếu H1 đúng (thiết kế, không chỉnh số 50):** đọc hết bằng cách cắt lát theo ngày tạo, hoặc luân phiên phần đuôi theo
con trỏ lưu ở `Channel`; chạm trần phải ghi log + đèn HQ. **Tốn lượt gọi sàn (không phải 0):** gian có T dòng chưa quyết toán
cần ⌈T/100⌉ trang/lượt thay vì 50 — phải đo `total_count` (trang đầu sàn đã trả sẵn) rồi mới chọn nhịp cho phần đuôi (ví dụ đuôi
6 giờ/lần). Đường này đi làn RAM `tiktok/rate-limit.ts` — cùng làn với sự cố hàng đợi bền (đại tu 5e); thêm lượt gọi cho gian lớn
là thêm áp lực lên đúng làn đó → phải cân với thứ tự đại tu anh đã chốt.

### 16.3 TikTok (3) — lượt bù price_detail kẹt ở một gian: giả thuyết + cách kiểm

Đọc `backfillTiktokPriceDetails`: lấy 200 đơn MỚI NHẤT chưa đọc, đơn lỗi và đơn "thiếu trường" đều KHÔNG được đóng dấu → lượt sau
lấy lại đúng những đơn đó. Từ đó:
- **G1 — đầu hàng bị nhiễm độc:** ≥ 5 đơn mới nhất lỗi cố định (sàn báo không tìm thấy / không có quyền) → lượt nào cũng gọi 5 lần,
  dừng, không tiến. Có log `price_detail "<gian>" đơn …` + dòng tổng "lỗi 5".
- **G2 — kẹt IM LẶNG vì "thiếu trường":** payload không có `voucher_deduction_seller` → `noField`, không đóng dấu, và dòng log tổng
  chỉ in khi có ghi hoặc có lỗi → 200 đơn đầu hàng đều thiếu trường thì mỗi giờ đốt 200 lượt gọi mà không để lại dấu vết.
- **G3 — thông lượng:** 200 đơn/giờ = 4.800 đơn/ngày; gian bán nhiều hơn mức đó thì hàng chờ dài mãi (không "dừng" nhưng trông như kẹt).
- **G4 — tầng giờ của gian không chạy tới bước này** (token, gói hết hạn / ngủ đông, tiến trình chết giữa lượt). Mốc ~08/11 trùng
  ngày sự cố hàng đợi bền lần 4 — có thể chỉ là trùng hợp, chưa có căn cứ.

**Cách kiểm (0 lần gọi sàn):** SQL K3 (16.5): `max(tiktokPriceDetailAt)` của gian + min/max ngày tạo của đơn chưa đọc. Dấu mới nhất
đứng im từ 08/11 → G1/G2/G4; vẫn nhích mỗi giờ mà hàng chờ tăng → G3. Rồi Render Logs lọc `price_detail "<gian>"`: có "lỗi 5" lặp →
G1; KHÔNG có dòng nào mà `Ước tính TikTok` của gian vẫn chạy → G2; không có cả hai → G4.

**Hướng sửa (thiết kế):** đơn lỗi cố định / thiếu trường phải được đóng dấu "đã thử" (số lần + lần cuối) để rời đầu hàng; log cả
lượt chỉ có `noField`; trần mỗi lượt theo hạn mức gian thay vì số cứng 200. Lượt gọi sàn: vẫn 1 lượt/đơn như thiết kế 29/10, còn
GIẢM được phần gọi lặp vô ích.

### 16.4 Tác động phải nêu trước khi code

| | Lát S1 (Shopee cấp đơn) | Lát S2 (Shopee cấp dòng) | T2 | T3 |
|---|---|---|---|---|
| Sổ cái | `LEDGER_FORMULA_VERSION` 4 → 5, tính lại nền ~40' (587k dòng), báo cáo đang mở tự đủ (đã sửa 807d2fab) | đi chung v5 nếu làm cùng | không đổi công thức; đơn nhận bản kê tự đánh bẩn | không đổi; `tiktokVoucherSeller` tự đánh bẩn |
| Gọi sàn thêm | **0** (`order_selling_price` nằm sẵn trong `order_income` đã kéo; đơn cũ lấy từ `expectedIncome`) | **0** | **> 0**, phải đo `total_count` trước | 0 thêm, giảm gọi lặp |
| Tổng giá trị SP (số 18/11, 30 ngày) | Shopee +110–125 tr (≈ +1,8–2 %), dồn gian bán combo | không đổi tổng | TikTok +~350 tr (≈ +0,7 %) khi đủ bản kê | +~13 tr |
| Doanh thu / hòa vốn ads | Doanh thu đơn combo từ 0 → giá trong giỏ − combo − voucher; `lineGross` vẫn 0 nên biên lãi quảng cáo DỰ KIẾN không đổi — vẫn phải đo | đơn combo BƯỚC VÀO hòa vốn + cờ thiếu giá vốn → biên lãi chiến dịch có SP combo sẽ đổi | đơn có bản kê thật mới vào mẫu TikTok → đổi dần | voucher không đổi `actualRevenue` |
| Thuế bổ sung 1 % của khách | tăng theo Tổng giá trị SP (gian combo) | — | tăng (gian thiếu bản kê) | tăng nhẹ |

**Bắt buộc trước khi push bất kỳ lát nào đổi `revenueGross` / `actualRevenue` / `lineGross`:** chạy `scripts/sql/ads-margin-impact.sql`
(viết thêm biểu thức thay "lai" / "dt" cho luật mới vì script mặc định chỉ đo luật CHỌN ĐƠN) + mô phỏng trợ lý quảng cáo trước / sau
từng chiến dịch, đưa anh bảng `doi2d` / `sang_am` rồi mới push.

### 16.5 SQL chỉ đọc đã soạn (CHƯA chạy) — thay `<gian>` bằng id kênh, không đưa tên / email khách vào

```sql
-- K1 Shopee: đơn combo 7 ngày của MỘT gian — quan hệ các trường escrow
SELECT right(o."orderCode",4) ma, o."totalAmount" tong, o."refundedAmount" hoan,
  (o."expectedIncome"->>'order_original_price')::numeric goc,
  (o."expectedIncome"->>'order_seller_discount')::numeric giam_sp,
  (o."expectedIncome"->>'order_selling_price')::numeric selling,
  (o."expectedIncome"->>'order_discounted_price')::numeric discounted,
  (o."expectedIncome"->>'shopee_discount')::numeric san_giam,
  (o."expectedIncome"->>'voucher_from_seller')::numeric voucher
FROM "Order" o
WHERE o."channelId" = '<gian>' AND o."createdAt" >= now() - interval '7 days'
  AND o."shippingStatus" <> 'CANCELLED' AND o."shopeeBundleDiscount" > 0
ORDER BY o."createdAt" DESC LIMIT 20;
-- Đọc: goc − giam_sp = discounted → seller_discount ĐÃ gồm combo; = selling → CHƯA gồm.
--      selling − discounted = san_giam → phần chênh là sàn giảm, KHÔNG phải combo (giả định 16.1 sai).

-- K2 TikTok: đơn không bản kê theo ngày tạo, MỘT gian, 45 ngày (tìm vách đứng)
SELECT o."createdAt"::date ngay, count(*) don, count(*) FILTER (WHERE s."orderId" IS NULL) khong_ban_ke,
       count(*) FILTER (WHERE s."estimated") uoc_tinh, count(*) FILTER (WHERE NOT s."estimated") that
FROM "Order" o LEFT JOIN "tiktok_order_settlements" s ON s."orderId" = o.id
WHERE o."channelId" = '<gian>' AND o."createdAt" >= now() - interval '45 days' AND o."shippingStatus" <> 'CANCELLED'
GROUP BY 1 ORDER BY 1;

-- K3 TikTok: hàng chờ price_detail của MỘT gian
SELECT max(o."tiktokPriceDetailAt") doc_cuoi,
       count(*) FILTER (WHERE o."tiktokPriceDetailAt" IS NULL) cho,
       min(o."createdAt") FILTER (WHERE o."tiktokPriceDetailAt" IS NULL) cho_cu_nhat,
       max(o."createdAt") FILTER (WHERE o."tiktokPriceDetailAt" IS NULL) cho_moi_nhat
FROM "Order" o JOIN "tiktok_order_settlements" s ON s."orderId" = o.id
WHERE o."channelId" = '<gian>' AND o."createdAt" >= now() - interval '30 days';
```

### 16.6 Đề xuất theo lát (chờ anh duyệt)

| Lát | Việc | Trước → sau (30 ngày, số 18/11) | Điều kiện |
|---|---|---|---|
| **K (kiểm)** | Chạy K1–K3 + đọc docs escrow + đọc Render Logs | — | anh bấm Allow trên Chrome |
| **S1** | Shopee: Tổng giá trị SP = `order_selling_price` khi có escrow; dòng khấu trừ "Combo / mua kèm"; sổ v5 | 340 đơn từ 0 → ~114 tr + 18 đơn 4,46 → ~15 tr | sau K1; đo ads trước push |
| **S2** | Shopee: chia dòng theo giá niêm yết khi Σ giá = 0 → đơn combo vào Lãi/Lỗ SKU + hòa vốn ads + cờ thiếu giá vốn | tổng không đổi; biên lãi chiến dịch có SP combo đổi | anh chốt có cho combo vào hòa vốn không |
| **T3** | price_detail: đóng dấu đơn đã thử, log lượt im lặng | 9.675 đơn chờ → 0; +~13 tr | sau K3 |
| **T2** | Bản kê ước tính: đọc hết đuôi + log chạm trần | 10.783 đơn không bản kê; +~350 tr | sau K2 + đo số lượt gọi; cân với đại tu 5e |

Thứ tự em khuyên: K → S1 → T3 → (S2, T2 chờ anh chốt riêng). S1 đúng hướng anh chốt, 0 lần gọi sàn, sửa khoản thiếu rõ nhất của
khách đang dùng Thuế bổ sung 1 %. T2 lớn tiền nhất nhưng tốn lượt gọi và đụng làn nhịp gian lớn nên không nên đi trước khi có số đo.

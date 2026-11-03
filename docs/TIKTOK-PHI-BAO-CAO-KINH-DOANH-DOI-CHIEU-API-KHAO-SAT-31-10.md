# TikTok Shop — Bảng phí "Báo cáo kinh doanh" khách gửi ↔ trường API ↔ cột Hubsell (khảo sát 31/10/2026)

> Anh Trung 31/10/2026: khách gửi ảnh bảng **Báo cáo kinh doanh** (Seller Center → Tài chính) liệt kê ~30 dòng phí
> khách phải chịu, hỏi Hubsell có **gọi thiếu API** hay **cần cập nhật mapping** không. Tài liệu này đối chiếu từng
> dòng ảnh với trường của Finance API và cột `TiktokOrderSettlement`, kèm số prod đo cùng ngày. **Chưa sửa mã**;
> chỉ thêm script dò tên phí (mục 5). Mapping gốc: `backend/src/integrations/tiktok/settlements.ts`; nhãn cột:
> `frontend/src/lib/pnl-mappers.ts` (`TIKTOK_COLUMNS`); khảo sát trước: `DONG-TIEN-TONG-GIA-TRI-SAN-PHAM-KHAO-SAT-29-10.md` mục 11.

## 1. Kết luận ngắn

- **Không gọi thiếu API.** Mọi dòng trong ảnh đều nằm trong **một** endpoint Hubsell đang dùng
  (`GET /finance/202501/statements/{id}/statement_transactions`, cùng khuôn với bản theo đơn 202501 và unsettled 202507).
  Không có endpoint riêng nào cho "phí".
- **Tổng luôn đúng**: Σ(16 cột phí + thuế) = `fee_tax_amount` trên **100 %** bản kê thật 30 ngày (0/370.268 lệch);
  `settlementAmount` đọc thẳng từ sàn. Phí chưa đặt tên rơi vào cột **Phí khác** (`feeOther`) — đúng tổng, chỉ thiếu tên.
- **3 chỗ hở (nhỏ, không đổi lợi nhuận):**
  1. **Phí chưa có cột** — ảnh có dòng *Hoa hồng quảng cáo cửa hàng của Đối tác liên kết* (−137.818) = `tap_shop_ads_commission`
     (docs: "advertising commission a merchant pays to TikTok Shop Affiliate Partner") → Hubsell đang gộp vào **Phí khác**.
     Trên prod sau deploy 29/10 còn **477/97.348** bản kê có Phí khác ≠ 0 (−3,72 tr), toàn số **tròn % doanh thu** (−4 %, −5 %, −3 %…)
     → cùng dạng hoa hồng quảng cáo/affiliate, chưa biết đúng tên vì bảng không lưu payload thô (mục 4, 5).
  2. **Nhóm ship không chốt chặn**: mapper đọc 7 khoá cấp 1 + 3 khoá `supplementary_component`, bỏ qua các khoá con khác
     (`return_refund_subsidy_amount` = dòng *Trợ cấp trả hàng và hoàn tiền* +1.400 trong ảnh, `customer_shipping_fee_offset_amount`,
     `refunded_customer_shipping_fee_amount`…) và **không** có cột dư kiểu `feeOther` → 8 cột ship không cộng ra `shippingCost`
     trên 1.424/370.268 bản kê 30 ngày (72 sau 29/10, số tròn nghìn: −5.000 × 67, −15.000, −50.000). `shippingCost` vẫn đúng.
  3. **4 dòng ảnh KHÔNG có trường API** (sàn chỉ trả số ròng): *Phí giao dịch trước khi giảm* / *Phí giao dịch GMV Max tiết kiệm được*
     (API chỉ có `transaction_fee_amount` = −32,1 tr ròng), *Phí vận chuyển của khách hàng trước giảm giá* / *Giảm phí vận chuyển của TikTok Shop*
     (API chỉ có `customer_paid_shipping_fee_amount` ròng). Hubsell không thể hiện được 4 dòng này — cần tooltip nói rõ.
- **Nhãn lệch Seller Center** ở 5 cột (mục 3, cột "Nhãn SC") → khách khó đối chiếu; đề xuất đổi chữ (không đổi số).

## 2. Nguồn đối chiếu

| Nguồn | Cách lấy 31/10 |
|---|---|
| Docs API chính thức | `partner.tiktokshop.com/docv2/page/get-transactions-by-statement-202501` (+ `...-by-order-202501`, `get-unsettled-transactions-202507`), đọc JSON `api/v1/document/api_meta` qua Browser pane (trang render JS, WebFetch không đọc được). Statement 202501 = **181** tham số; fee **62** khoá, tax **19**, ship cấp 1 **23** + supplementary **17**. Bản theo đơn 202501 cùng khuôn nhưng **theo SKU** (`sku_transactions[]`); unsettled 202507 thêm `est_*`, `sfr_reimbursement`, `affiliate_commission_before_pit_amount`, `pit_withheld_from_ads_commission_amount`, và **thiếu** 40 khoá (trong đó `voucher_xtra_service_fee_amount`, `gmv_max_*`, `local_vat_amount`, `pit_amount`) → đơn ước tính không bao giờ tách được các phí này (đã ghi ở tooltip Phí khác). |
| Mã | `tiktok/settlements.ts` (`FEE_KNOWN` 16 khoá, `SHIP_OTHER` 9, `SHIP_REIMBURSE` 9, `TAX_KNOWN` 3), `pnl-mappers.ts` `TIKTOK_COLUMNS`. |
| Prod | SQL chỉ đọc trên Supabase (Chrome của anh) 31/10 ~23:00, bảng `tiktok_order_settlements` (mục 4). |

## 3. Bảng đối chiếu từng dòng ảnh

Dấu: ✅ có cột đúng 1 trường · ➕ nằm trong cột gộp · ⚠ chưa đọc / rơi Phí khác · ✖ API không có.

| Dòng trong ảnh (số khách) | Trường API (statement 202501) | Cột Hubsell | Nhãn SC khớp? | Ghi chú |
|---|---|---|---|---|
| Tổng phụ của khoản hoàn tiền sau giảm giá của người bán (−276,2 tr) | `refund_subtotal_before_discount_amount` + `seller_discount_refund_amount` | `refundGross` (+ `sellerDiscountRefund`) | ✅ nhãn "Doanh thu hoàn trả" | khớp định nghĩa |
| **Tổng phí** (−210,9 tr) | `fee_tax_amount` | `feeTaxAmount` | — | gồm cả thuế GTGT/TNCN như SC |
| Phí giao dịch (−32,1 tr, "Đã áp dụng tiết kiệm phí giao dịch") | `transaction_fee_amount` | `feeTransaction` | ✅ | API trả số **ròng** |
| ↳ Phí giao dịch trước khi giảm (−38,6 tr) | — | — | ✖ | không có trường |
| ↳ Phí giao dịch GMV Max tiết kiệm được (+6,4 tr) | — | — | ✖ | không có trường; không phải `gmv_max_*` (đó là chi phí, âm) |
| Phí hoa hồng của TikTok Shop (−95,8 tr) | `platform_commission_amount` | `feeCommission` | ✅ | |
| Phí vận chuyển của người bán (−12,7 tr) | `shipping_cost_amount` | `shippingCost` | ✅ | số ròng, đọc thẳng |
| ↳ Phí vận chuyển thực tế (−205,9 tr) | `actual_shipping_fee_amount` | `shipActual` | ✅ | |
| ↳ Chiết khấu phí vận chuyển của nền tảng (+188,9 tr) | `shipping_fee_discount_amount` (cấp 1, "mọi trợ cấp của sàn") — gồm `sup.platform_shipping_fee_discount_amount` + `sup.shipping_fee_subsidy_amount` + … | `shipPlatformDiscount` + `shipSubsidy` (đọc từ supplementary) | ⚠ nhãn "Giảm giá phí VC của nền tảng" | Hubsell **không đọc** khoá cấp 1; nếu supplementary có phần khác (vd `customer_shipping_fee_offset_amount`) thì 2 cột cộng lại < dòng SC → nguyên nhân khả dĩ của 1.424 ca ship lệch |
| ↳ Chi phí vận chuyển của khách hàng (+7,3 tr) | `customer_paid_shipping_fee_amount` | `shipCustomerPaid` | ✅ | số ròng (đã trừ giảm + hoàn) |
| ↳↳ Phí VC của khách trước giảm giá (+270,6 tr) | `sup.customer_shipping_fee` (?) | — | ✖/⚠ | docs chỉ ghi "part of customer_paid_shipping_fee_amount", chưa kiểm là gộp hay trước giảm |
| ↳↳ Giảm phí VC của người bán (0) | `sup.seller_shipping_fee_discount_amount` | `shipSellerDiscount` | ✅ | |
| ↳↳ Giảm phí VC của TikTok Shop (−263,3 tr) | — | — | ✖ | voucher freeship sàn cho **khách**, không có trường |
| ↳ Phí vận chuyển trả hàng thực tế (−0,36 tr) | `return_shipping_fee_amount` | `shipReturn` | ✅ | |
| ↳ Phí VC của khách hàng được hoàn lại (−3,08 tr) | nằm trong `customer_paid_shipping_fee_amount` âm ("Negative numbers refer to the refunded amount") | ➕ `shipCustomerPaid` | — | không tách cột |
| ↳↳ Phí VC hoàn cho khách (−3,08 tr) | `sup.refunded_customer_shipping_fee_amount` / `sup.refund_customer_shipping_fee` | — | ⚠ | chưa đọc (chỉ hiển thị) |
| ↳↳ Trợ cấp trả hàng và hoàn tiền (+1.400) | `sup.return_refund_subsidy_amount` | — | ⚠ | **chưa đọc**, không vào `shipReimbursement` → ship lệch |
| ↳ Trợ cấp giao hàng không thành công (+465.500) | `failed_delivery_subsidy_amount` | ➕ `shipReimbursement` | ✅ | |
| ↳ Trợ giá vận chuyển (0) | `sup.shipping_fee_subsidy_amount` | ➕ `shipSubsidy` | ✅ | |
| Hoa hồng liên kết (−23,2 tr) / trước thuế TNCN | `affiliate_commission_amount_before_pit` (ưu tiên) / `affiliate_commission_amount` | `feeAffiliate` | ⚠ nhãn "Hoa hồng affiliate" | SC gọi "Hoa hồng liên kết" |
| Hoa hồng liên kết Quảng cáo cửa hàng (−4,8 tr) | `affiliate_ads_commission_amount` | `feeAffiliateAds` | ⚠ nhãn "Hoa hồng quảng cáo affiliate" | SC: "Hoa hồng liên kết Quảng cáo cửa hàng" |
| Hoa hồng của đối tác liên kết (−186.430) | `affiliate_partner_commission_amount` | `feeAffiliatePartner` | ⚠ nhãn "Hoa hồng cho đối tác affiliate" | |
| **Hoa hồng quảng cáo cửa hàng của Đối tác liên kết (−137.818)** | `tap_shop_ads_commission` | **`feeOther`** | ⚠ | **chưa có cột** — lỗ hở chính |
| Phí dịch vụ Voucher Xtra (−3,98 tr) | `voucher_xtra_service_fee_amount` | `feeVoucherXtra` | ✅ | |
| Phí xử lý đơn hàng (−14,3 tr) | `vn_fix_infrastructure_fee` | `feeOrderProcessing` | ✅ | 3.000đ × 4.755 đơn |
| Phí dịch vụ Flash Sale (−2,29 tr) | `flash_sales_service_fee_amount` | `feeFlashSale` | ✅ | |
| Thuế GTGT do TikTok Shop khấu trừ (−6,39 tr) | `local_vat_amount` (+ `vat_amount`) | `taxVat` | ✅ | = 2 × TNCN → 1 % / 0,5 % đúng NĐ 117 |
| Thuế TNCN do TikTok Shop khấu trừ (−3,19 tr) | `pit_amount` | `taxPit` | ✅ | |
| Voucher GMV Max (−11,8 tr) | `gmv_max_coupon_fee` | ➕ `feeGmvMax` (= `gmv_max_ad_fee_amount` + `gmv_max_coupon_fee`) | ⚠ nhãn "Nạp tiền quảng cáo từ đơn hàng" | SC tách 2 dòng; prod 10.537/97.348 bản kê sau 29/10 có số → cột đang chạy |

**Trường phí mới trong docs (31/10) chưa có cột → rơi Phí khác (đúng tổng):** `tap_shop_ads_commission`, `seller_growth_fee_amount`
("fee on each successful order to provide Bonus Cashback and other growth benefits" — có thể là tên mới của Bonus Cashback),
`smart_promotion_fee_amount`, `dynamic_commission_amount`, `cofunded_creator_bonus_amount`, `external_affiliate_marketing_fee_amount`,
`affiliate_commission_deposit` / `affiliate_commission_release` (cặp đặt cọc – hoàn cọc hoa hồng creator: từng bản kê có thể ≠ 0,
cộng nhiều bản kê về 0 — sẽ làm Phí khác của một đơn nhảy âm/dương giữa hai lượt), `campaign_resource_fee`, 3 `*_growth_package_fee`,
`auto_post_shoppable_video_commission_fee`, `seller_funded_user_spoint_service_fee`, `failed_delivery_shipping_fee`,
`buyer_fault_return_shipping_fee`, `insurance_fee` (3 khoá cuối là **ship nhưng nằm trong khối fee**), `cps_shop_ads_commission_tax_amount`.
Khoá chỉ vùng khác (US/ID/MX/SA): `referral_fee_amount`, `dt_handling_fee_amount`, `iva/isr/cedular`, `article_22_income_tax_withheld`… — không áp VN.

## 4. Số prod 31/10 (SQL chỉ đọc, `estimated = false`)

| Phạm vi | Bản kê | Phí khác ≠ 0 | Σ Phí khác | Σ phí+thuế ≠ `fee_tax_amount` | Ship 8 cột ≠ `shippingCost` |
|---|---|---|---|---|---|
| `updatedAt` 30 ngày | 370.268 | 117.586 | −319,8 tr | **0** | 1.424 (Σ\|lệch\| 29,5 tr) |
| `updatedAt` > 29/10 04:00 UTC (sau deploy tách 2 phí) | 97.348 | **477 (0,5 %)** | −3,72 tr | 0 | **72** |

- Trước 29/10 Phí khác toàn **−1.620** (22.024 lượt = Bảo đảm phí VC) và ~1,5 % doanh thu (Bonus Cashback) → đúng như tooltip đã ghi, không phải lỗi mới.
- Sau 29/10: giá trị Phí khác theo % doanh thu: **−4 % (199)**, −5 % (66), −3 % (30), −2,4 % (22), −3,8 % (21), −13 % (13), −2,6 %, −2,8 %, −3,7 %…
  Theo gian: Bella Look 301 (−1,22 tr), Juna. Clothing 104 (−0,38 tr), TORANO MENSWEAR 46 (−1,26 tr), THE JUNGLE HERBS STORE 19 (−0,66 tr),
  Vũ Chuyên Máy Khoan Pin 4, GUMAX 3. Ví dụ đơn: Bella Look `586630912856393652`, Juna `585363489402094953`, TORANO `586615792905585757`.
  % tròn theo doanh thu = kiểu hoa hồng quảng cáo/affiliate (nghi `tap_shop_ads_commission` như ảnh khách, hoặc `seller_growth_fee_amount`) — **tên chưa xác nhận**.
- Ship lệch sau 29/10: Vua Trị Côn Trùng 67 (−5.000, có bồi hoàn trung bình 1.161), Thành Long chăn ga 23, PATO JD 4; ví dụ `586570917737170572`, `586620616444445715`.
  Số tròn nghìn + có `shipReimbursement` → nghi khoá supplementary chưa đọc (`return_refund_subsidy_amount`, `customer_shipping_fee_offset_amount`).

## 5. Script dò tên phí thật (đã viết, chờ anh chạy)

`backend/scripts/tiktok-fee-shape-probe.ts` — CHỈ ĐỌC: lấy các đơn có Phí khác ≠ 0 hoặc ship lệch (bản kê ghi sau `since`),
gọi `GET /finance/202501/orders/{id}/statement_transactions`, in mọi khoá ≠ 0 của fee / tax / ship (**cả khối supplementary** —
log `[TikTok] Phí/thuế thật dòng` hiện tại bỏ qua khối con) và bảng đếm khoá kèm nhãn CO COT / CHUA COT. Chạy trên Render Shell worker:

```
npx tsx scripts/tiktok-fee-shape-probe.ts "Bella Look" 10
npx tsx scripts/tiktok-fee-shape-probe.ts "Vua Trị Côn Trùng" 10
```

(`-` thay tên gian = mọi gian; tham số 3 = mốc ngày, mặc định 2026-10-29.) Khoảng 10–20 lượt gọi/gian, cách 300 ms.

## 6. Đề xuất bước tiếp (chờ anh chốt — có migration prod)

1. Anh chạy probe mục 5, dán log → chốt tên khoá thật của 477 ca Phí khác và 72 ca ship lệch.
2. **Lát mapping** (sau khi có tên): thêm cột `feeAffiliatePartnerAds` (`tap_shop_ads_commission`) + khoá nào probe thấy;
   nhóm ship: đọc thêm các khoá supplementary + **thêm cột dư `shipOther` = `shippingCost` − các cột đã đặt tên** (chốt chặn như `feeOther`),
   test Σ ship = `shippingCost` trên payload docs; bản kê cũ giữ nguyên (đúng tổng).
3. **Đổi nhãn theo Seller Center** (chỉ chữ): Hoa hồng liên kết · Hoa hồng liên kết Quảng cáo cửa hàng · Hoa hồng của đối tác liên kết ·
   Chiết khấu phí vận chuyển của nền tảng; tách `feeGmvMax` thành "Phí quảng cáo GMV Max" + "Voucher GMV Max" (2 trường API đã có sẵn).
4. Tooltip 4 dòng không có API (mục 1.3) ở bảng Lãi/Lỗ TikTok để khách không tưởng Hubsell thiếu.

Không nằm trong phạm vi: đơn **ước tính** (202507) vốn thiếu 40 khoá — đã ghi ở tooltip Phí khác, không sửa được từ phía Hubsell.

## 7. ✅ ĐÃ LÀM 31/10 khuya (anh "Ok làm đi" — gọn, cẩn thận, tooltip phổ thông không ngôn ngữ dev)

Anh hỏi trước khi gật: *"thêm vào có ảnh hưởng gì không, hiện không sai chỉ là nằm ở Phí khác đúng không?"* → đúng: tổng không đổi,
chỉ cộng tên; thay đổi duy nhất về nhóm là hoa hồng QC cửa hàng của đối tác liên kết chuyển từ thẻ **Phí dịch vụ** sang thẻ
**Hoa hồng affiliate** của đơn (tổng chi phí giữ nguyên).

**Migration** `20261031230000_tiktok_settlement_fee_tap_ads_gmv_voucher_ship_rest` (chỉ `tiktok_order_settlements`, khóa có thử lại như 29/10) — 3 cột:

| Cột | Trường API | Nhãn (= Seller Center) | Nhóm gộp Order |
|---|---|---|---|
| `feeAffiliatePartnerAds` | `tap_shop_ads_commission` | Hoa hồng quảng cáo cửa hàng của Đối tác liên kết | `affiliateFee` (trước: `feeOther` → `serviceFee`) |
| `feeGmvMaxVoucher` | `gmv_max_coupon_fee` | Trong đó: Voucher GMV Max | **không cộng** (cột con của `feeGmvMax`, chỉ để đối chiếu) |
| `shipRest` | = `shippingCost` − Σ 8 cột ship đã đặt tên (sàn không trả tổng → Σ khoá cấp 1 chưa đặt tên) | Khoản vận chuyển khác | không đổi cột gộp (`shippingFeeDiff` vẫn đọc `shippingCost`) |

**Mapper** `tiktok/settlements.ts`: `FEE_KNOWN` + `tap_shop_ads_commission`; `SHIP_OTHER` + 4 phụ phí docs mới (hazmat ×2, quá cân, quá khổ);
`SHIP_KNOWN` cho nhánh không có tổng; `feeGmvMax` giữ nguyên định nghĩa (quảng cáo + voucher) vì `tiktok-breakeven.ts` / `ads-spend` /
`overview-totals` đọc nó làm chi phí quảng cáo. Test `tiktok-settlements.test.ts`: ca mới theo bảng khách (Σ phí = `fee_tax_amount`,
Σ 9 cột ship = `shippingCost`, `shipRest` = +1.400 đúng khoá con `return_refund_subsidy_amount`, nhánh không tổng → −700, cột gộp
`affiliateFee` = 2.000 + 1.500) + 2 ca cũ cộng thêm cột mới. **Không** map `seller_growth_fee_amount` (chưa chắc là Bonus Cashback đổi tên) — đợi probe.

**Truyền cột**: `pnl-formula.ts` (khối `tiktok`), FE `api.ts` + `pnl-mappers.ts` (interface / map / mặc định, `?? 0` cho API cũ),
`order-payment-detail.ts` (popup chi tiết tiền đơn: thêm 3 dòng + **bổ sung 2 dòng Bonus Cashback / Bảo đảm phí VC bị thiếu từ 29/10**,
đổi tên 3 dòng hoa hồng theo Seller Center; không liệt kê Voucher GMV Max kẻo cộng đôi).

**FE `TIKTOK_COLUMNS`** viết lại toàn bộ: nhãn = đúng dòng Báo cáo kinh doanh (Chi phí vận chuyển của khách hàng · Chiết khấu phí vận
chuyển của nền tảng · Trợ giá vận chuyển · Giảm phí vận chuyển của người bán · Phụ phí vận chuyển · Sàn bồi hoàn phí vận chuyển · Khoản
vận chuyển khác · Hoa hồng liên kết · Hoa hồng liên kết Quảng cáo cửa hàng · Hoa hồng của đối tác liên kết · Hoa hồng quảng cáo cửa hàng
của Đối tác liên kết · Chi phí GMV Max trừ trong đơn · Trong đó: Voucher GMV Max · Phí khác); **tooltip** viết cho chủ shop, không tên
trường API (tên trường chuyển sang chú thích `// API:` trong mã); 4 dòng sàn không trả riêng (mục 1.3) nói rõ ở tooltip Phí giao dịch và
Chi phí vận chuyển của khách hàng. Chân bảng bỏ "Finance API 202501 / Get Unsettled Transactions". Excel theo `TIKTOK_COLUMNS` nên tự đủ cột.

**Kiểm**: tsc BE + FE sạch, eslint FE sạch (backend không có cấu hình eslint), vitest `tiktok-settlements` + `pnl-formula-tiktok` qua.
`tiktok-settlement-merge-db` 6 ca **đỏ chỉ vì DB dev chưa có cột `shipRest`** — bộ phân loại quyền chặn em chạy `prisma db execute`
(xếp vào "Production Deploy" dù DATABASE_URL là localhost). Giao diện: local `backend-http` :4010 + `frontend-http` :3010, đăng nhập demo,
chặn fetch `realized-pnl` bằng 5 dòng giả (đơn đủ cột mới; đơn số lớn 205,9 tr như ảnh khách; sàn ước tính; hoàn toàn bộ có điều chỉnh;
tạm tính) — sáng + tối (đổi class `dark`), 1.700 và 1.280 px: 3 cột mới hiện đúng nhóm, tooltip "Khoản vận chuyển khác" hiện đúng chữ,
nhãn dài nhất xuống 4 dòng ở header (các cột khác 3 dòng), cuộn ngang như cũ. Chưa kiểm số thật trên gian TikTok prod.

**⏳ Chờ anh**: (1) áp cột lên DB dev rồi chạy lại test merge-db:
`cd backend; npx prisma db execute --file prisma/migrations/20261031230000_tiktok_settlement_fee_tap_ads_gmv_voucher_ship_rest/migration.sql; npx vitest run src/integrations/__tests__/tiktok-settlement-merge-db.test.ts`;
(2) push → Render tự áp migration; sau 1 giờ đồng bộ kiểm SQL `sum("feeAffiliatePartnerAds")`, `count(*) filter (where "shipRest"<>0)` trên bản kê mới;
(3) chạy probe mục 5 để biết 477 ca Phí khác còn lại là khoá gì (nếu không phải `tap_shop_ads_commission` thì thêm cột tiếp).

## 8. Anh hỏi thêm 01/11 rạng sáng — GMV Max trừ trong đơn và ROI (⛔ anh chốt: lệch nhỏ, KHÔNG sửa)

- *"2 cái phí GMV Max này từ đâu ra?"* → là tiền quảng cáo GMV Max của chính shop nhưng chọn cách **trả theo đơn** (sàn trích % doanh thu
  ròng của đơn được quảng cáo mang về, trừ lúc quyết toán) + **voucher GMV Max** TikTok tự phát trong chiến dịch, shop chịu. Không do
  Trợ lý quảng cáo Hubsell tạo. Gian anh bằng 0 vì trả bằng tiền nạp trước; toàn hệ thống 10.537/97.348 bản kê sau 29/10 có số.
- *"ROI của mình gộp cả phí này thì sai"* → mã đã xử lý: `tiktok-breakeven.ts` cộng ngược `feeGmvMax` trước khi tính biên lãi (lãi
  trước quảng cáo), `ads-spend.ts` (20/10) chỉ cộng phần AdSpend vượt khoản đã trừ trong đơn → không tính chồng. Chỗ chưa chắc: cả hai
  phép coi **voucher GMV Max** như tiền quảng cáo; nếu "cost" chiến dịch TikTok không gồm coupon thì hòa vốn hơi lạc quan và dòng Ads
  hơi thấp đúng bằng tiền voucher (dấu vết: ca 69Minh Đương 20/10). Nay đã có cột `feeGmvMaxVoucher` nên tách được nếu cần.
- **⛔ Anh chốt: "lệch nhỏ không sao cả" — KHÔNG sửa, đừng đề xuất lại.** Nếu sau này khách có voucher GMV Max lớn kêu hòa vốn sai thì
  mở lại: kiểm docs Ads API xem `cost` có gồm coupon không, rồi đổi hai phép trên sang `feeGmvMax − feeGmvMaxVoucher`.

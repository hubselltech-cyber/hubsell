# Đối soát phí vận chuyển — khảo sát cột "Nguyên nhân" + vì sao không thấy đơn Shopee (31/10/2026)

> Anh Trung 31/10: trang `/warehouse/shipping-alerts` thiếu cột **Nguyên nhân** (ví dụ: Khách hoàn hàng, Chênh lệch phí vận chuyển); không thấy đơn Shopee nào; khách hỏi "đây là cái gì" nhiều → khảo sát để thêm cột, kèm icon copy sau mỗi mã.
> Số trong tài liệu này đọc **thật trên prod** (Supabase SQL chỉ đọc, 31/10/2026, cửa sổ 30 ngày theo `Order.createdAt`). Chỗ nào chưa kiểm được ghi rõ.

## 1. Trang hiện làm gì (mã)

| Lớp | Tệp | Việc |
|---|---|---|
| Trang | `frontend/src/app/warehouse/shipping-alerts/page.tsx` | bảng 8 cột: Mã đơn · Sàn · Ngày quyết toán · Phí dự kiến · Phí thực tế · Chênh lệch · Trạng thái · Thao tác |
| API | `backend/src/routes/finance.ts` → `GET /api/finance/shipping-discrepancies` | `where shippingFeeDiff > 0`, trả `shippingFeeQuoted / shippingFeeActual / discrepancy (âm) / status` — **không có lý do** |
| Excel | `frontend/src/lib/excel.ts` `exportShippingDisputesToExcel` | 6 cột, chỉ đơn `CHO_KHIEU_NAI` |

`shippingFeeDiff` mỗi sàn ghi một kiểu — đây là gốc của việc khách không hiểu:

| Sàn | `shippingFeeQuoted` ("Phí dự kiến") | `shippingFeeActual` | `shippingFeeDiff` | Nguồn |
|---|---|---|---|---|
| Shopee | `estimated_shipping_fee` (cước sàn báo lúc đặt) | `actual_shipping_fee` | `max(cước thật − (khách trả + sàn trợ + 3PL giảm), 0)` | `integrations/shopee/settlements.ts` `mapShopeeEscrowFields` |
| TikTok | **`customer_paid_shipping_fee` (KHÁCH TRẢ, không phải "dự kiến")** | cước thật + ship hoàn + phụ phí | `shipping_cost_amount` ròng (= "Phí vận chuyển của nhà bán hàng" trên bản kê) + điều chỉnh ship | `integrations/tiktok/settlements.ts` `mapTiktokBreakdownToSettlement` |
| Lazada | tổng dòng ship DƯƠNG (khách trả / sàn bù) | tổng dòng ship ÂM | `max(âm − dương, 0)` | `integrations/lazada/service.ts` ~1512 |

Hệ quả nhìn thấy ngay trong ảnh anh gửi: đơn TikTok in **Phí dự kiến 0đ** — vì khách được miễn ship, không phải vì sàn "báo 0 rồi trừ 35.500". Nhãn cột sai nghĩa với TikTok.

Ngoài ra `writeTiktokSettlement` (`integrations/tiktok/service.ts` ~1100) tự đánh mọi đơn TikTok lệch sang **DA_DOI_SOAT** ngay khi có bản kê thật, với ghi chú "phí ship shop chịu trên TikTok là CHÍNH SÁCH, không phải sàn trừ nhầm". Tức là trang tự biết TikTok không khiếu nại được, nhưng không nói điều đó cho khách — khách thấy "Đã đối soát" + nút "→ Chờ khiếu nại" rồi hỏi.

## 2. Số thật prod 30 ngày (31/10/2026)

### 2a. Theo sàn

| Sàn | Đơn đã quyết toán | Đơn lệch (`diff > 0`) | Tỉ lệ | Tổng lệch | Trong đó đơn hủy | Đơn có trục hoàn | Còn CHO_KHIEU_NAI |
|---|---|---|---|---|---|---|---|
| TikTok | 145.106 | **5.049** | 3,5 % | **156,4 tr** | 1.872 | 820 | 119 |
| Shopee | 29.420 | 158 | 0,5 % | 0,95 tr | 0 | 2 | 155 |
| Lazada | 528 | 77 | 14,6 % | 0,42 tr | 0 | 2 | 77 |

→ 99 % tiền lệch toàn hệ thống là TikTok. Shopee **có** đơn lệch nhưng hiếm và nhỏ (trung bình 6.000đ/đơn).

### 2b. Vì sao tài khoản trong ảnh không thấy Shopee

Tài khoản trong ảnh là chủ gian `and.not.or`. Gian của tài khoản đó 30 ngày:

| Gian | Đơn 30 ngày | Đơn lệch |
|---|---|---|
| Shopee / ANO Official Store | 1.233 | **0** |
| Shopee / DarkMan Store | 271 | **0** |
| TikTok / and.not.or | 846 | 25 |
| TikTok / ANO Official | 21 | 0 |
| TikTok / DARKMAN STORE | 25 | 1 |

Kết luận: **không phải lỗi nối Shopee** — 1.504 đơn Shopee của tài khoản đó đều được khách + sàn phủ đủ cước (`shipBorne = 0`). Lý do nghiệp vụ: Shopee thu tiền ship của shop qua **phí dịch vụ Freeship Xtra** (cột `serviceFee`, hiện ở Kiểm toán phí), không trừ thẳng cước; TikTok thì trừ thẳng cước vào từng đơn ở các ca hủy / hoàn / miễn ship. Hai sàn hai triết lý, trang đang gộp làm một.

> Chưa kiểm: 158 đơn Shopee lệch có phải sàn trừ sai thật không. Mẫu 5 đơn đều DELIVERED, không hoàn, `estimated 31.500 → actual 37.500`, `shopee_shipping_rebate = 0` — đúng dạng "cân nặng/kích thước thực tế khác khai báo" mà shop khiếu nại được trên Seller Center.

### 2c. Phân loại nguyên nhân TikTok (5.049 đơn lệch, đọc `tiktok_order_settlements`)

Phân loại **loại trừ dần theo thứ tự** (một đơn một nhãn):

| # | Điều kiện (cột sao kê chi tiết) | Đơn | Tiền | Còn CHO_KHIEU_NAI |
|---|---|---|---|---|
| 0 | chưa có sao kê (`tiktok_order_settlements` null) | 67 | 0,36 tr | 67 |
| 1 | `shippingStatus = CANCELLED` và không có trục hoàn | **1.838** | **60,5 tr** | 3 |
| 2 | `returnStatus ≠ NONE` hoặc `shipReturn < 0` | 835 | 28,4 tr | 3 |
| 3 | `shipOther < 0` (bảo hiểm, ký nhận, vùng xa, cồng kềnh…) | 417 | 16,5 tr | 11 |
| 4 | `shipSellerDiscount < 0` (voucher freeship của shop) | 456 | 4,6 tr | 17 |
| 5 | khách trả 0 **và** sàn trợ 0 (`shipCustomerPaid = shipPlatformDiscount = shipSubsidy = 0`) | **1.189** | **42,3 tr** | 18 |
| 6 | sàn có trợ (`shipPlatformDiscount > 0` hoặc `shipSubsidy > 0`) nhưng không đủ | 233 | 3,5 tr | 0 |
| 7 | khác | 14 | 0,22 tr | 0 |

Mẫu đơn thật từng nhóm (số có dấu như sao kê):

- Nhóm 1 — `586570309098309429` CANCELLED, hoàn khách 61.500, `shipActual −30.200`, khách trả 0, sàn trợ 0 → shop chịu 30.200. Nhóm này là **giao không thành công / hủy khi đang giao**: sàn thu hồi trợ giá ship và tính cước chiều đi cho shop. Một số đơn có `shipReimbursement` dương (vd `586734006843442670`: +14.800) — sàn bù một phần.
- Nhóm 2 — `586684327050839210` DELIVERED → AWAITING, `shipActual −30.200` + `shipReturn −15.100` = 45.300.
- Nhóm 4 — `586443174431851769`: `shipActual −27.000`, sàn trợ +20.000, **shop voucher −7.000** → lệch 7.000.
- Nhóm 5 — `586760074401318566`, `586430535584417395`: DELIVERED, `shipActual −40.000`, khách 0, sàn 0, shop voucher 0 → shop chịu trọn 40.000. ⚠ **Chưa rõ chính sách**: đây là mẫu vận chuyển "người bán trả phí" shop tự cài, hay chương trình sàn? Cần anh mở 1 trong 2 đơn này trên Seller Center → Chi tiết thanh toán để đặt tên nhóm cho đúng. `feeSfp = 0` ở cả 5.049 đơn nên không phải Freeship Xtra kiểu phí dịch vụ.
- Nhóm 6 — `586393620169328061`: cước thật 272.170 (hàng cồng kềnh), khách 13.800 + sàn 255.000, shop chịu 3.370.

### 2d. Shopee / Lazada có gì để phân loại

- Shopee: Order chỉ còn `shippingFeeQuoted / Actual / Diff / shipSubsidyPlatform` — **không lưu** `buyer_paid_shipping_fee`, `reverse_shipping_fee`, `shipping_fee_discount_from_3pl` (có trong `order_income`, xem `shopee/client.ts` ~1567). Nên hôm nay chỉ tách được 2 nhãn: có trục hoàn → "Khách trả hàng", còn lại → "Cước thực tế cao hơn cước báo".
- Lazada: `lazada_order_settlements` có `shipFeeReturn`, `feeShipSeller`, `shipFeeAdjustment`, `shipDiscountSeller` → tách được như TikTok.

## 3. Phản biện trước khi thêm cột

1. **Tên trang hứa sai với 97 % số tiền.** Câu dẫn "sàn trừ phí vận chuyển cao hơn mức đã báo — xuất danh sách để khiếu nại đòi lại tiền" chỉ đúng với Shopee/Lazada (1,4 tr / 157,8 tr). Phần TikTok là **chi phí ship shop chịu theo chính sách**, mã đã tự đánh DA_DOI_SOAT. Thêm cột Nguyên nhân mà giữ nguyên câu dẫn thì khách vẫn hỏi "sao không đòi được".
2. **Cột "Phí dự kiến" sai nghĩa với TikTok** (= khách trả). Nên đổi 3 cột tiền thành **Khách trả · Cước thực tế · Shop chịu** — đúng cho cả 3 sàn (Shopee `estimated` thì để tooltip "cước sàn báo lúc đặt").
3. "Mã vận đơn" anh nhắc: trang này in **mã đơn hàng**, không có cột mã vận đơn. Em hiểu là copy mã đơn; nếu anh muốn thêm cột Mã vận đơn (`trackingCode` có sẵn trên Order) thì thêm được luôn, cũng có nút copy.

## 4. Đề xuất

### 4a. Bộ nhãn khách đọc (chốt chữ trước khi code)

| Mã | Nhãn (chip) | Tooltip một câu | Khiếu nại được? |
|---|---|---|---|
| `CANCELLED_AFTER_SHIP` | Đơn hủy sau khi gửi | Khách hủy / giao không thành công sau khi kiện rời kho → sàn thu cước chiều đi, có thể cả chiều về. | Không (chính sách); nếu lỗi do đơn vị vận chuyển, khiếu nại ở mục Giao hàng của sàn |
| `CUSTOMER_RETURN` | Khách trả hàng | Phí ship chiều hoàn của đơn Trả hàng/Hoàn tiền. | Không |
| `LOGISTICS_SURCHARGE` | Phụ phí vận chuyển | Bảo hiểm, ký nhận, vùng xa, cồng kềnh… sàn tính thêm. | Có nếu không đăng ký dịch vụ đó |
| `SHOP_FREESHIP` | Shop tự trợ giá ship | Voucher freeship do shop phát. | Không |
| `SHOP_BEARS_SHIPPING` | Shop chịu cước | Khách được miễn ship, sàn không trợ giá đơn này. *(tên tạm — chờ anh xem Seller Center)* | Không |
| `OVER_PLATFORM_SUBSIDY` | Cước vượt mức sàn trợ | Sàn trợ ship có trần, phần dư shop chịu. | Không |
| `FEE_MISMATCH` | Cước thực tế cao hơn cước báo | Cân nặng / kích thước thực tế khác khai báo. **Đây là ca đòi lại được.** | **Có** — xuất file khiếu nại |
| `AWAITING_STATEMENT` | Chờ sao kê | Sàn chưa trả bản kê, số đang là ước tính. | — |

### 4b. Cách làm (1 lát, không migration)

- Backend `routes/finance.ts`: hàm thuần `classifyShippingDiff(order, tiktokSettlement?, lazadaSettlement?) → { reason, claimable }`, chạy lúc đọc (include thêm `tiktokSettlement` / `lazadaSettlement` vào `AUDIT_ITEMS_INCLUDE` — cùng một truy vấn, không gọi sàn). Trả thêm `reason`, `claimable`, `trackingCode`, và đổi tên trường theo nghĩa: `customerPaid`/`actualFee`/`shopBears` (giữ tên cũ 1 bản cho mobile nếu mobile có dùng — kiểm `hubsell-mobile` trước). Vitest cho hàm phân loại bằng 8 bộ số mục 2c.
- Thứ tự ưu tiên = thứ tự bảng 2c (hủy → hoàn → phụ phí → voucher shop → shop chịu → vượt trợ giá → lệch cước).
- Lọc `?reason=` + đếm theo nhãn trong `summary` để thẻ "Tổng số tiền cần đòi lại" chỉ cộng `claimable` (hôm nay thẻ cộng cả 156 tr TikTok không đòi được — số đỏ to gây hiểu nhầm nhất trang).
- Frontend: cột **Nguyên nhân** (chip + tooltip) sau cột Sàn; bộ lọc Nguyên nhân; đổi nhãn 3 cột tiền; `CopyIconButton` (có sẵn `components/ui/copy-icon-button.tsx`) cạnh mã đơn (và mã vận đơn nếu thêm cột); câu dẫn trang đổi: "Các đơn shop phải chịu phí vận chuyển. Dòng **Cước thực tế cao hơn cước báo** là ca khiếu nại đòi lại được — xuất file gửi sàn."; Excel thêm cột Nguyên nhân + Mã vận đơn.
- Shopee lát sau (tùy anh): lưu thêm `buyer_paid_shipping_fee` / `reverse_shipping_fee` từ escrow để tách "Khách trả hàng" đúng như TikTok. Không bắt buộc cho lát 1.

### 4d. Ràng buộc anh chốt 31/10 tối: "mục đích chính vẫn là ĐỐI SOÁT phí ship"

Không biến trang thành bảng "chi phí ship shop chịu". Điều chỉnh đề xuất 4b theo đó:

- **Giữ tên trang, giữ nút Xuất file khiếu nại, giữ vòng đời khiếu nại.** Cột Nguyên nhân chỉ để trả lời "dòng này vì sao lệch, có đòi được không" — không đổi trục trang.
- **Mặc định lọc "Cần đối soát"**: ca khiếu nại được (`FEE_MISMATCH`, `LOGISTICS_SURCHARGE`) + `AWAITING_STATEMENT`. Các ca chính sách TikTok (hủy sau gửi, khách hoàn, voucher shop, shop chịu cước, vượt trợ giá) vẫn xem được qua bộ lọc Nguyên nhân = "Theo chính sách sàn", chip in rõ "không khiếu nại" để khách khỏi hỏi — nhưng không chiếm màn hình mặc định.
- **Thẻ 2 "Tổng số tiền cần đòi lại" = chỉ ca khiếu nại được**; dòng phụ "Shop chịu theo chính sách sàn: X đ (xem lọc)". Thẻ 1 giữ tổng đơn lệch.
- **3 cột tiền giữ đúng tinh thần đối soát "đã báo ↔ thực tế → lệch"**, nhưng cột 1 phải nhất quán 3 sàn: hiện với TikTok `quoted = khách trả` nên dòng in `0 · 27.000 · −7.000` không cộng trừ ra nhau. Đề xuất cột 1 = **"Được phủ (khách trả + sàn trợ)"** = `actual − diff` (đúng cho cả 3 sàn, tooltip Shopee thêm "cước sàn báo lúc đặt: 31.500"); cột 2 "Cước thực tế"; cột 3 "Shop chịu / lệch" — khi đó mọi dòng đều `cột1 − cột2 = cột3`.

### 4c. Chờ anh chốt

1. Bộ nhãn 8 dòng ở 4a — chữ nào đổi?
2. Đổi "Phí dự kiến / Phí thực tế / Chênh lệch" → "Khách trả / Cước thực tế / Shop chịu"?
3. Thẻ "Tổng số tiền cần đòi lại" chỉ cộng ca khiếu nại được (Shopee/Lazada lệch cước), còn tổng ship shop chịu đưa sang thẻ riêng?
4. Anh mở đơn `586760074401318566` trên TikTok Seller Center → mục phí vận chuyển ghi gì, để đặt tên nhóm "Shop chịu cước" cho đúng.
5. Có thêm cột Mã vận đơn không, hay copy mã đơn là đủ?

## 6. ĐÃ LÀM 31/10/2026 tối (anh: "Làm luôn", giữ khung 4d)

| Lớp | Tệp | Việc |
|---|---|---|
| Phân loại | `backend/src/lib/shipping-diff-reason.ts` | `classifyShippingDiff()` thuần, 9 mã `ShippingDiffReason`, `isClaimableReason()` (FEE_MISMATCH · LOGISTICS_SURCHARGE · AWAITING_STATEMENT). Thứ tự luật = bảng 2c. Đã quyết toán mà thiếu dòng bản kê (dữ liệu cũ/seed) → xếp theo trạng thái đơn, không báo "chờ sao kê" |
| Test | `backend/src/lib/__tests__/shipping-diff-reason.test.ts` | 12 ca = 8 bộ số prod mục 2c + Shopee/Lazada/offline — 12/12 |
| API | `routes/finance.ts` `GET /shipping-discrepancies` | thêm `?reason=` (`CLAIMABLE` \| `POLICY` \| mã \| rỗng); 2 bước: đọc cột nhẹ mọi đơn khớp bộ lọc DB (`SHIP_REASON_SELECT` gồm 6 cột ship bản kê TikTok + 4 cột sao kê Lazada) → phân loại → lọc/phân trang trong bộ nhớ → đọc đủ cột + dòng hàng cho đúng trang. Trả thêm `reason`, `claimable`, `coveredFee = actual − diff`, `trackingCode`; `summary.totalDiscrepancy` chỉ cộng ca khiếu nại được, thêm `policyDiscrepancy`, `reasonCounts` (hai số này KHÔNG theo bộ lọc nguyên nhân) |
| Trang | `frontend/src/app/warehouse/shipping-alerts/page.tsx` | bộ lọc Nguyên nhân (mặc định **Cần đối soát**; Theo chính sách sàn; Tất cả; từng mã kèm số đơn); cột **Nguyên nhân** chip + tooltip (`HintText`), xanh teal = đòi được, xám = chính sách; 3 cột tiền **Được phủ · Cước thực tế · Shop chịu** (Shopee tooltip cước sàn báo lúc đặt); `CopyIconButton` cạnh mã đơn + dòng "VĐ <mã vận đơn>" có copy; thẻ 2 dòng phụ "Shop chịu theo chính sách sàn: X"; empty-state theo bộ lọc; ngày quyết toán 2 dòng cho gọn |
| Excel | `lib/excel.ts` | thêm Mã vận đơn · Nguyên nhân · Khiếu nại được; "Phí ship sàn báo" → "đã được phủ"; xuất theo bộ lọc nguyên nhân đang chọn |
| Nhãn | `frontend/src/lib/shipping-diff-reason.ts` | `SHIPPING_DIFF_REASON_META` (label + hint + claimable) — một nguồn cho chip, lọc, Excel |

Kiểm local (demo@hubsell.tech, backend-http 4010 + frontend-http 3010): 35 đơn lệch, Shopee → "Cước thực tế cao hơn cước báo", Lazada seed (không có sao kê chi tiết) → cùng nhãn, 10 đơn chưa quyết toán → "Chờ sao kê"; tổng cần đòi 333.500 = tổng cũ vì seed không có ca chính sách; dark OK; bảng 9 cột **vừa 1.622 px** (1.285/1.285), ở **1.280 px sidebar mở vẫn cuộn ngang trong thẻ** (1.152/943 — bản cũ 8 cột cũng đã 1.025/943, không mới). Chưa kiểm số thật trên gian TikTok (ca chính sách) — cần prod.

⏳ Còn lại: (1) tên nhóm "Shop chịu cước" chờ anh xem Seller Center; (2) thẻ "Truy thu phí ship" ở Kiểm toán phí (`/finance/fee-audit`, cùng `shippingFeeDiff`) vẫn cộng cả ca chính sách — lát sau nếu anh muốn đồng bộ; (3) Shopee lưu thêm `reverse_shipping_fee`/`buyer_paid_shipping_fee` để tách "Khách trả hàng" (mục 2d).

## 5. SQL đã chạy (chỉ đọc, chạy lại được)

```sql
-- phân loại nguyên nhân TikTok + gian của một chủ shop, 30 ngày
with l as (
  select o."shippingStatus", o."returnStatus", o."shippingFeeDiff" d, o."shippingDisputeStatus" ds, t.*
  from "Order" o join "Channel" c on c.id=o."channelId"
  left join tiktok_order_settlements t on t."orderId"=o.id
  where c."channelName"='TIKTOK' and o."createdAt" > now() - interval '30 days' and o."shippingFeeDiff" > 0
), cls as (
  select d, ds, case
    when "orderId" is null then '0_chua_co_sao_ke'
    when "shippingStatus"='CANCELLED' and "returnStatus"='NONE' then '1_huy_sau_gui'
    when "returnStatus"<>'NONE' or "shipReturn"<0 then '2_khach_hoan'
    when "shipOther"<0 then '3_phu_phi_logistics'
    when "shipSellerDiscount"<0 then '4_shop_tro_gia_ship'
    when "shipCustomerPaid"=0 and "shipPlatformDiscount"=0 and "shipSubsidy"=0 then '5_shop_chiu_toan_bo_cuoc'
    when "shipPlatformDiscount">0 or "shipSubsidy">0 then '6_cuoc_vuot_tro_gia_san'
    else '7_khac' end k
  from l)
select k, count(*), sum(d), count(*) filter (where ds='CHO_KHIEU_NAI') from cls group by k order by 1;
```

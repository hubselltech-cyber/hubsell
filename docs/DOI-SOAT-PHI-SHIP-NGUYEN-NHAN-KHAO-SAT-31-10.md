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

⏳ Còn lại: (1) tên nhóm "Shop chịu cước" chờ anh xem Seller Center; (2) thẻ "Truy thu phí ship" ở Kiểm toán phí (`/finance/fee-audit`, cùng `shippingFeeDiff`) vẫn cộng cả ca chính sách — 10/11/2026 đã sửa chữ gợi ý cho đúng nghĩa + thêm bảng theo sản phẩm (mục 7), con số thẻ GIỮ là tổng shop chịu thêm; (3) Shopee lưu thêm `reverse_shipping_fee`/`buyer_paid_shipping_fee` để tách "Khách trả hàng" (mục 2d).

## 7. Kiểm toán phí › Truy thu phí ship › THEO SẢN PHẨM + xuất Excel (10/11/2026)

> Khách bán sữa (TikTok, ~4.700 đơn/tháng) thấy thẻ "Truy thu phí ship" 29,6 tr nhưng trang chỉ liệt kê từng đơn — không biết sản phẩm nào gây ra, nhân viên phải chép tay. Em bóc bằng SQL (hubsell-marketing/so-lieu/KET-QUA-2026-11-10-TRUY-THU-SHIP.md) mới ra: phụ phí từ 12/10 dồn vào MỘT sản phẩm (thùng sữa nước, 20 % đơn dính so với 1 % ở sản phẩm khác), hơn nửa đơn trả hàng dồn vào hai mã sữa bột. Anh Trung: đưa bảng đó vào app ("khảo sát và code thật chuẩn"), rồi thêm "xuất file excel… chọn thời gian và xuất được ra file".

### 7.1 Khách thấy gì

- Tab **Truy thu phí ship** có nút chuyển **Theo đơn | Theo sản phẩm** (đường dẫn `?tab=ship&view=product`). Mặc định vẫn là Theo đơn. Trang Đối soát phí ship của kho KHÔNG có góc nhìn này (giữ ràng buộc 4d: trang kho là để đối soát / khiếu nại).
- Bảng theo sản phẩm, 6 cột: **Sản phẩm** (ảnh, tên cắt theo chuẩn, sàn + gian, mã sản phẩm trên sàn + nút chép) · **Shop chịu thêm** · **Đơn lệch** · **TB mỗi đơn** · **Tỷ lệ đơn lệch** (đơn lệch / tổng đơn của sản phẩm trong kỳ) · **Nguyên nhân chính** (viên nhãn; trỏ chuột hoặc bấm ra đủ các nguyên nhân kèm tiền + số đơn và lời giải thích). Sắp xếp tại tiêu đề 3 cột tiền / đơn; 20 / 50 / 100 sản phẩm mỗi trang.
- **Chip lọc nguyên nhân** xếp theo tiền, in tiền rút gọn (số đơn ở tooltip). Số trên chip không đổi theo chip đang chọn.
- Dòng tổng của bảng ("N sản phẩm · M đơn lệch · shop chịu thêm X") **bằng số trên thẻ** khi không lọc nguyên nhân.
- Nút **Xuất Excel** (cả hai góc nhìn): một tệp `hubsell_truy_thu_phi_ship_<từ>_<đến>_<giờ xuất>.xlsx` theo gian + khoảng ngày đang chọn, hai trang tính — "Theo don" (mọi đơn: mã đơn, vận đơn, sàn, gian, ngày đặt, ngày quyết toán, sản phẩm, nguyên nhân, khiếu nại được, được phủ, cước thực tế, shop chịu thêm, trạng thái khiếu nại) và "Theo san pham" (mỗi sản phẩm một dòng + mỗi nguyên nhân có phát sinh một cột tiền). Tệp là bản đầy đủ của kỳ, không theo bộ lọc trạng thái / chip nguyên nhân.
- Sửa chữ gợi ý của thẻ và của cột "Bị trừ thêm": trước ghi "Khiếu nại được", sai với phần lớn số tiền (ca chính sách sàn).

### 7.2 Luật tính (một chỗ: `backend/src/lib/shipping-diff-products.ts`, thuần, 13 test)

| Điểm | Quyết định | Vì sao |
|---|---|---|
| Đơn vị gom | sản phẩm trên sàn của một gian = (gian + `itemId`), `itemId` cắt từ `OrderItem.externalId` bằng `ledgerItemIdOf` | việc cần làm tiếp (xem cân nặng khai báo, lý do trả) nằm ở sản phẩm trên Seller Center; gom theo phân loại sẽ xé vụn shop thời trang 17 màu. Cùng id với cột `itemId` của sổ dòng hàng nên mẫu số tra thẳng chỉ mục |
| Dòng chưa có id sàn | gom theo (gian + mã SKU sàn, giữ nguyên chữ) | đơn cũ trước 18/10, Lazada |
| Đơn nhiều sản phẩm | chia tiền theo tỷ trọng giá trị dòng (số lượng × giá) bằng `allocateByWeight` của sổ cái | một luật phân bổ cho cả app; quà tặng 0 đ không gánh và không thành dòng |
| Số lẻ | mỗi phần là số đồng chẵn; phần lẻ dưới một đồng của chính đơn dồn về dòng giá trị lớn nhất; cộng bằng xu | tiền Việt không có số lẻ; Σ dòng = Σ đơn đúng từng xu |
| Đơn không có dòng hàng | một dòng "Đơn chưa rõ sản phẩm" cho mỗi gian | giữ Σ bảng = thẻ |
| Nguyên nhân | dùng nguyên `classifyShippingDiff` (mục 6), lọc bằng `shippingDiffReasonMatcher` chung với danh sách đơn | không có bản phân loại thứ hai |
| Tỷ lệ đơn lệch | mẫu số = đơn KHÔNG hủy của sản phẩm trong kỳ (đếm ở `order_line_ledger`) + đơn hủy có phát sinh cước; mẫu số < tử số (sổ chưa kịp có dòng) thì in "—" | đơn hủy trước khi gửi không tốn cước; không in tỷ lệ sai |

Hạn chế biết trước: (a) đơn có 2 sản phẩm mà phụ phí do món nặng gây ra thì món nhẹ vẫn gánh phần theo giá trị (Hubsell không lưu cân nặng khai báo); (b) nhãn "Phụ phí vận chuyển" vẫn nằm trong nhóm khiếu nại được — số của khách 10/11 cho thấy có thể là phí theo chính sách (mức cố định 27k / 39k / 65k từ 12/10), ⏳ chờ anh xem tên dòng phí trên Seller Center rồi mới đổi nhóm; (c) cột Tỷ lệ không sắp xếp được (mẫu số chỉ đếm cho sản phẩm của trang đang xem).

### 7.3 Mã

| Lớp | Tệp | Việc |
|---|---|---|
| Phần thuần | `backend/src/lib/shipping-diff-products.ts` + `__tests__/shipping-diff-products.test.ts` | khóa gom, chia tiền, gom dần (`createShipDiffProductFold`), sắp xếp, tỷ lệ |
| Bộ lọc nguyên nhân | `backend/src/lib/shipping-diff-reason.ts` `shippingDiffReasonMatcher` | CLAIMABLE / POLICY / mã / tất cả — danh sách đơn và bảng sản phẩm dùng chung |
| Đọc DB | `backend/src/services/shipping-diff.ts` (mới) | `shipDiffWhere` (thẻ, danh sách đơn, bảng sản phẩm cùng một bộ lọc), `SHIP_REASON_SELECT` + `shipReasonOf` (dời từ `routes/finance.ts`), `loadShipDiffByProduct` |
| Test DB | `backend/src/services/__tests__/shipping-diff-db.test.ts` | Σ dòng sản phẩm = `aggregate(shippingFeeDiff)`; CLAIMABLE + POLICY = tất cả; gian lạ → rỗng |
| API | `routes/finance.ts` `GET /api/finance/shipping-discrepancies/by-product` — `reason`, `sort` (amount, orders, avg), `dir`, `page`, `pageSize` + bộ lọc gian / ngày chung | quyền `warehouse.shipping-alerts` hoặc `finance.fee-audit` (router.use sẵn có) |
| Trang | `frontend/src/app/finance/fee-audit/page.tsx` | nút chuyển góc nhìn, nút Xuất Excel, chữ gợi ý |
| Bảng | `frontend/src/components/finance/ship-diff-by-product.tsx` (mới), `ship-diff-reason-chip.tsx` (mới — trang kho dùng chung) | DataTable chung của trang; không lớp `dark:` |
| Dùng chung | `frontend/src/components/shared/sort-header.tsx` | dời từ `products/suppliers/` vì nay 2 nhóm cùng dùng |
| Excel | `frontend/src/lib/excel.ts` `exportShipDiffAudit` + `downloadSheets` (tệp nhiều trang tính) | gom mọi trang 100 dòng của hai API rồi dựng tệp ở trình duyệt, như các nút xuất khác |

Cách đọc (`loadShipDiffByProduct`): bước 1 MỘT câu đọc đầu đơn lệch của phạm vi (cột phân loại, không dòng hàng — cùng dạng câu với danh sách đơn, đi `Order_channelId_idx`); bước 2 dòng hàng theo lô 1.000 mã đơn (`OrderItem.orderId`), gom dần rồi bỏ → bộ nhớ theo số đơn lệch (cột nhẹ) + số sản phẩm; bước 3 chỉ với sản phẩm của trang đang xem: đếm mẫu số ở sổ dòng hàng + tra ảnh (`loadSkuImages`). Bản đầu em viết đọc theo khóa `id > con trỏ … LIMIT 1000` — đã bỏ: không có chỉ mục (gian, id) cho tập lệch nên mỗi lô quét lại toàn bộ đơn của gian, và `ORDER BY id LIMIT` trên bảng đơn nhiều chủ dễ khiến planner chọn quét khóa chính.

### 7.4 Đo

- **Prod, tài khoản khách trên (chỉ đọc, 10/11):** 14.071 đơn, 1.023 đơn lệch, 17 sản phẩm có tiền. Bước 1: quét chỉ mục gian 23 ms (13.050 dòng bị lọc bỏ), nối bản kê TikTok 0,39 s lúc bộ đệm nguội. Mẫu số 17 sản phẩm trên `order_line_ledger` (toàn bộ thời gian, mọi phân mảnh tháng): 1,28 s nguội → 85 ms nóng. Chọn khoảng ngày thì Postgres cắt phân mảnh, nhanh hơn.
- Chi phí bước 1 tỷ lệ với TỔNG số đơn của gian (không có chỉ mục cho `shippingFeeDiff > 0`) — đúng như thẻ và danh sách đơn đang chạy từ trước. Nếu sau này shop vài trăm nghìn đơn thấy chậm: thêm chỉ mục một phần `Order(channelId, createdAt) WHERE shippingFeeDiff > 0` (một migration, dùng chung cho cả ba nơi). CHƯA làm vì chưa đo thấy cần và migration trên bảng đơn có rủi ro riêng.
- Xuất Excel gọi lần lượt các trang 100 dòng; mỗi lần gọi máy chủ phân loại lại cả tập lệch (như nút "Xuất file khiếu nại sàn" sẵn có). Khách trên: 11 + 1 lượt gọi.
- **Local** (tài khoản thử tạo riêng cho lượt soi, đã xóa khỏi DB dev sau khi xong; seed ca rộng: 1.965 đơn, 475 đơn lệch 23.211.680 đ, 30 sản phẩm, đủ 9 nguyên nhân, tên 130 ký tự, tiền 8 chữ số, đơn 2 sản phẩm + quà 0 đ, đơn không dòng hàng, đơn Shopee không id sàn): thẻ = dòng tổng bảng = tổng cột Excel; lọc Tháng trước 306 đơn 14.377.466 đ khớp cả ba; tràn ô = 0 và không cuộn ngang ở 1280 / 1366 / 1440 / 1520 / 1700 / 1920; giao diện tối đã soi (chip lọc, viên nguyên nhân, ô mở); trang kho vẫn hiện viên nhãn đúng. Tệp Excel mới đọc nội dung trong trình duyệt (chặn lượt tải), chưa mở bằng Excel thật.

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

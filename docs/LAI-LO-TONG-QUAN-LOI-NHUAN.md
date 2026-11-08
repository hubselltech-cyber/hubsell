# Lãi/Lỗ thực hiện → tab "Tổng quan Lợi nhuận" — thiết kế lại (08/11/2026)

Trạng thái: **ĐÃ LÀM, anh Trung chốt "dọn dẹp và push" chiều 08/11/2026 — đã push master** (mục 7). Việc bắt đầu từ câu hỏi của khách "số Lãi/Lỗ khác Báo cáo dòng tiền" (mục 1) và yêu cầu của anh: "giữ, sửa nhãn; trình bày mấy biểu đồ cho đẹp và có giá trị hơn, kiểu phân tích chuyên sâu, ví dụ top sản phẩm kèm % tăng giảm; khảo sát chuẩn báo cáo hiện đại trong và ngoài nước".

## 1. Vì sao Lãi/Lỗ ≠ Báo cáo dòng tiền (đo prod 08/11/2026)

Tài khoản Chủ Shop Hubsell, cùng kỳ 10/10–08/11 (hai trang dùng chung `defaultRange` = 30 ngày qua):

| Khoản | Số |
|---|---|
| Lãi/Lỗ thực hiện, chip Tất cả (Σ `profitAfterTax` 2.386 đơn) | 92.028.975 |
| Báo cáo dòng tiền, thẻ Lợi nhuận ròng | 53.132.779 |
| Chênh | 38.896.196 |
| = Chi phí quảng cáo sàn (AdSpend) | 20.009.899 |
| + Chi phí cố định nhập tay (Thu chi vận hành) | 18.385.000 |
| + Đơn hủy (444 đơn, −961.400) và đơn đang hoàn — Lãi/Lỗ "Tất cả" cộng cả, Dòng tiền chỉ cộng đơn tính doanh thu | 501.297 |

Khớp từng đồng. Theo thiết kế: `realized-pnl` chỉ cộng sổ cái đơn (tiền về ví − giá vốn, đã trừ phí/thuế sàn); ba khoản ngoài đơn (AdSpend, thu chi nhập tay, thu khác) chỉ có ở `/api/finance/analytics` (docs/SO-CAI-DON.md mục 8 bước 4 đã ghi phép bù này từ 30/09). Lỗi là **nhãn**: thẻ ghi "Lợi nhuận ròng thực nhận" trong khi bản chất là lãi đơn hàng trước chi phí ngoài đơn — lặp đúng bài học 26/10 (hai số cùng tên "lợi nhuận ròng" trên hai màn = khách bỏ gói). **Anh chốt 08/11: giữ tab, sửa nhãn.**

## 2. Khảo sát chuẩn báo cáo (agent đọc web 08/11, chỉ văn bản, không nguồn nào xem được ảnh màn hình)

Nguồn đã đọc: Shopify Analytics (Overview, Compare, heatmap Weekly Sales Patterns 10/2025, Gross profit by product), sellerboard (Tiles, P&L, Trends), Triple Whale (Summary), TrueProfit, Polar, Metorik (Compare Products), TikTok Shop Product Analytics (Pricing, Diagnosis), Shopee Business Insights, Lazada Business Advisor, Sapo (báo cáo lợi nhuận, dashboard sàn), Haravan (KQKD dạng dòng), KiotViet, Nhanh.vn, Pancake, BigSeller, Salework, Omisell; nguyên tắc NN/g, IBM Carbon, datascale, Stephen Few. Upbase/Ginee không tìm thấy tài liệu báo cáo lợi nhuận; Material không fetch được.

**Mẫu số chung (≥ 3 sản phẩm):** (1) thẻ KPI + % so kỳ trước đặt ngay cạnh số; (2) bảng sản phẩm sort mọi cột: doanh thu, giá vốn, lãi, % biên, SL hoàn; (3) đường xu hướng theo ngày; (4) P&L dạng dòng/thác doanh thu → giá vốn → phí sàn → ship → ads → lãi ròng; (5) bóc theo sàn/gian; (6) top đi kèm bottom ("cần cải thiện", top bị trả); (7) bấm số → chi tiết.

**Ý khác biệt đáng học:** sellerboard Trends sort theo % đổi (đúng câu "top sản phẩm kèm % tăng giảm"); TrueProfit xếp sản phẩm theo LÃI chứ không theo doanh thu; TikTok nhãn hai cấp Need attention / Can improve; Shopify heatmap giờ × thứ; TikTok Pricing giá vs units/ngày; sellerboard Tiles Hôm nay / Hôm qua / Tháng này / Dự báo cạnh nhau.

**Chuẩn % so kỳ trước:** kỳ trước = kỳ liền trước cùng độ dài (Shopify, TikTok, Polar; tùy chọn cùng kỳ năm trước cho mùa vụ); màu theo TỐT/XẤU chứ không theo hướng (hoàn tăng phải đỏ) + hình ▲▼; chỉ số dạng tỷ lệ đổi theo điểm %; không nguồn nào nêu ngưỡng → mặc định tự chọn: |Δ| < 1 % xám, kỳ trước quá mỏng thì ghi "mới" / số đơn thay vì "+900 %".

**7 khối agent đề xuất:** dải KPI có kỳ trước; cầu lợi nhuận waterfall; top sản phẩm tăng/giảm theo lãi; lãi theo sàn × gian; giờ vàng heatmap; lãi vs ads theo ngày; thất thu hoàn bar ngang + top SKU thất thu. Em lấy 6/7 (bỏ "lãi vs ads theo ngày": AdSpend theo gian/ngày chưa phân bổ được xuống đơn khớp lọc; để khi tab lọc theo gian có ý nghĩa).

## 3. Thiết kế đã làm

Mọi khối là một câu SUM/GROUP BY trên sổ cái với **đúng bộ lọc của bảng** (chip trạng thái, Hoàn/Trả, Lợi nhuận âm, tìm mã đơn, tab sàn); kỳ liền trước cùng độ dài gọi cùng câu với range khác. Không kéo đơn lên RAM (trụ 1 KIEN-TRUC-QUY-MO-TRIEU-DON).

| # | Khối | Trả lời | Dạng | Ghi chú |
|---|---|---|---|---|
| 1 | Dải KPI: **Lãi đơn hàng** · Doanh thu thực nhận · Biên lãi đơn hàng · Thất thu do đơn hoàn | kỳ này hơn/kém kỳ trước? | `DashboardCard` + huy hiệu Δ + sparkline theo ngày | "Lãi đơn hàng" thay "Lợi nhuận ròng thực nhận"; tooltip nói rõ đã trừ gì, chưa trừ gì. 2 × 2 tới 1536 px (ở 1280 vùng nội dung 945 px, chia 4 thì ô số còn 46 px) |
| 2 | **Từ lãi đơn hàng đến lợi nhuận ròng** | vì sao khác Dòng tiền? | danh sách bậc + thanh ngang | Lãi đơn hàng → bỏ đơn hủy & đang hoàn → − quảng cáo → − chi phí vận hành → + thu khác → − thuế dự phòng = **Lợi nhuận ròng** (= thẻ Dòng tiền, cùng `cashFlowNetProfit`). Chỉ hiện khi bộ lọc "trơn" (Tất cả, không tìm, không chỉ lỗ); link sang Báo cáo dòng tiền |
| 3 | **Lãi đơn hàng theo ngày** | ngày nào lãi/lỗ, so kỳ trước | cột theo dấu + đường xám kỳ trước, MỘT trục | Bản cũ gộp trục % tỷ lệ hoàn (hai thang đo một hình) → bỏ; thất thu/ngày còn trong tooltip |
| 4 | **Top sản phẩm theo lãi** | mã nào kéo lãi lên/xuống | 4 chip: Lãi cao nhất · Đang lỗ · Tăng mạnh · Giảm mạnh; bảng 8 cột | Lãi theo mã = Σ `profitAfterTax` dòng hàng (đã phân bổ theo giá trị dòng), khóa = mã kho nếu đã nối, không thì mã sàn (cùng `ledgerSkuAgg`). Xếp hạng bằng window trong DB, FULL JOIN hai kỳ để mã biến mất vẫn vào "Giảm mạnh"; mã ≥ 3 đơn mới được xếp tăng/giảm; kỳ trước < 3 đơn thì ghi "kỳ trước N đơn" thay %; Δ kẹp ±999 %; tên cắt `PRODUCT_NAME_CLAMP` (15 rem dưới 1536 px) |
| 5 | **Lãi theo sàn** | sàn nào gánh lãi | thanh mảnh tỷ trọng + bảng 8 cột | thay 3 biểu đồ cột nhỏ (mỗi cái 3 cột) |
| 6 | **Phân bố đơn theo biên lãi** | đơn lãi dày hay mỏng, bao nhiêu đơn lỗ | cột 6 bậc (Lỗ, 0–10, 10–20, 20–30, 30–50, >50 %) + nút "Xem N đơn lỗ" bật chip Lợi nhuận âm | bậc theo % để shop bán 50 k hay 5 tr cùng một thang; đơn không có doanh thu thực nhận (hủy/hoàn đủ) đếm riêng. Luật bậc ở `marginBucketKey` = câu CASE SQL (test khóa) |
| 7 | **Thất thu do đơn hoàn** | hoàn ăn vào đâu | 3 thanh ngang xếp hạng + Δ | thay donut (NN/g: ba lát gần nhau khó so) |
| 8 | **Giờ vàng** | khi nào nên live / đẩy ads | lưới 7 × 24 CSS, một màu sky nhạt → đậm (`color-mix` với token nên tự đúng dark) | giờ VN (`createdAt + 7h`), câu kết luận thứ + khung giờ đông nhất, 3 ô đông nhất có viền |

Thứ tự trên trang: 1 → (3 | 2) → 4 → 5 → (6 | 7) → 8.

## 4. Mã

**Backend**
- `lib/realized-pnl-insights.ts` (thuần): `previousRangeOf`, `rangeDays`, `deltaPercent`, `MARGIN_BUCKETS` + `marginBucketKey`, `alignDaily`, kiểu trả về, `TOP_PRODUCT_LIMIT = 10`, `TOP_PRODUCT_MIN_ORDERS = 3`. Test `lib/__tests__/realized-pnl-insights.test.ts` (9 ca; bậc biên lãi so với bản SQL trên 2.000 điểm ngẫu nhiên; số prod 08/11 cho `cashFlowNetProfit`).
- `services/order-ledger.ts`: `ledgerPnlWhere` nhận bí danh bảng; thêm `ledgerPnlPeriodTotals`, `ledgerPnlDaily` (có `netRevenue`), `ledgerPnlByPlatform`, `ledgerPnlMarginBuckets`, `ledgerPnlHeatmap`, `ledgerPnlTopProducts` (CTE cur/prev FULL JOIN + 4 `row_number()`, trả ≤ 40 dòng).
- `services/off-order-costs.ts` MỚI: `loadOffOrderCostInputs` = chi phí/thu nhập nhập tay + AdSpend + gian ads; `/api/finance/analytics` đổi sang dùng chung (số không đổi — test `cash-flow-ledger-db` vẫn xanh).
- `lib/net-profit.ts`: `cashFlowNetProfit` — một phép tính Lợi nhuận ròng cho Dòng tiền lẫn cầu nối.
- `routes/finance.ts`: `GET /api/finance/realized-pnl/insights` (quyền `finance.realized-pnl` sẵn có), `pnlFilterFromQuery`; trả `current/previous/daily/byPlatform/marginBuckets/heatmap/topProducts/bridge/missingCost/ledgerPending`. DB dev 7 câu song song 276 ms (1.055 đơn kỳ này).

**Web**
- `lib/api.ts` kiểu + `fetchRealizedPnlInsights`; `query-keys.ts` `realizedPnlInsights`; trang `finance/realized-pnl/page.tsx` gọi thêm khi mở tab Tổng quan, truyền `lossOnly` + `toggleLossOnly`.
- `components/finance/realized-pnl/OverviewDashboard.tsx` viết lại = bố cục; khối con trong `overview/`: `delta-badge`, `kpi-row`, `profit-bridge-card`, `profit-trend-chart`, `top-products-card`, `platform-compare-card`, `margin-distribution-card`, `return-loss-card`, `order-heatmap`. Không lớp `dark:` nào (globals.css lật thang).

## 5. Kiểm trên local (08/11)

- Tài khoản thử DB dev `reviewer@hubsell.vn` (mật khẩu local đặt lại ngẫu nhiên, không ghi ở đâu), HTTP 3010 ↔ 4010. Seed **dữ liệu rộng** thẳng vào sổ cái (260 đơn `seedwide-*`, gian TikTok): tên 120–160 ký tự, giá 7 chữ số, mã mới / mã ngừng bán, đơn lỗ, hủy, hoàn, giờ dồn 20–22 h. Đã dọn 08/11 chiều (`DELETE … WHERE "orderId" LIKE 'seedwide-%'`, 260 đơn / 339 dòng, còn 0). Lưu ý: mật khẩu LOCAL của reviewer@hubsell.vn đã bị đặt lại ngẫu nhiên khi soi — cần thì đặt lại.
- Đo JS 1280 / 1440 / 1700: 0 ô `td/th` tràn, không cuộn ngang trang; ở 1280 lượt đầu KPI 4 cột ô số 46 px → đổi 2 × 2 tới 2xl; bảng top 10 cột cuộn ngang 319 px → gộp cột (Đã bán + đơn, Doanh thu + vốn) + tên 15 rem → vừa. Giao diện tối soi 4 khung (KPI, bảng, thanh, heatmap) bằng nút đổi giao diện của app. Chip Đang lỗ / Giảm mạnh, nút "Xem N đơn lỗ" bật/tắt chip Lợi nhuận âm (cầu nối tự ẩn), đều chạy.
- tsc backend + frontend, eslint sạch; vitest backend 646 qua, 3 đỏ có sẵn (chỉ mục trigram / đếm dọn trên DB dev).

## 6. Chưa làm / để sau (chưa trình anh)

- "Lãi vs chi quảng cáo theo ngày" (khối 6 của khảo sát) — cần AdSpend theo gian khớp bộ lọc.
- Tùy chọn so "cùng kỳ năm trước" (mùa vụ) — hiện chỉ kỳ liền trước.
- Top 5 SKU thất thu hoàn kèm nguyên nhân đối soát; nhãn "Cần xem" hai cấp kiểu TikTok.
- Mobile chưa có tab này (web trước, anh xem rồi tính).

## 7. Kết

Anh Trung xem local rồi chốt "Dọn dẹp và push đi em" (08/11 chiều): giữ nguyên 8 khối + tên "Lãi đơn hàng", đã push master (hash ghi ở PROGRESS). Việc để sau ở mục 6.

# Khảo sát 02/11/2026 — "Đơn thiếu giá vốn coi giá vốn = 0" trong tài chính + loại khỏi ROI/ROAS hòa vốn

> Anh Trung đặt 02/11/2026 chiều: (1) tài chính đang LOẠI đơn chưa có giá vốn khỏi lợi nhuận → đổi thành coi giá vốn = 0;
> (2) sau đó thuật toán ROI/ROAS hòa vốn phải LOẠI đơn không có giá vốn / giá vốn = 0. Yêu cầu: khảo sát, phản biện,
> khoanh vùng tác động, đưa phương án khả thi (có thể đề xuất không làm). Tệp này là kết quả khảo sát, CHƯA sửa mã.
> Bối cảnh cũ: anh chốt 30/09/2026 "loại khỏi lợi nhuận, vẫn tính doanh thu" (docs/KIEN-TRUC-QUY-MO-TRIEU-DON.md 9a #7, #8);
> 30/10 em đã nêu lý do không coi = 0 và anh bỏ dòng phụ "lãi tạm tính".
>
> **Trạng thái 04/11/2026 20:00 (lượt tự động):** anh chốt làm theo mục 8 → **ĐÃ CODE** thành 2 commit (Lát B `ab4d62c9` +
> mobile câu chữ; Lát A sổ v4 = commit kế tiếp), chưa push, chưa OTA — xem **mục 9**. Mục 1–8 giữ nguyên làm hồ sơ khảo sát.

## 1. Kết luận ngắn

| # | Việc anh nêu | Hiện trạng trong mã | Đề xuất |
|---|---|---|---|
| 2 | ROI/ROAS hòa vốn loại đơn không có giá vốn | **ĐÃ CÓ từ 28/09/2026** ở cả 3 sàn (`lib/ads-margin.ts` Shopee/Lazada, `lib/tiktok-breakeven.ts` TikTok, SQL `ledgerMarginByGroup` / `ledgerTiktokBreakevenByGroup`): đơn mang cờ `missingCostPrice` bị loại khỏi cả tử lẫn mẫu, doanh thu dồn vào `missingCostRevenue`, độ phủ `costCoveragePct` < 90 % → không kết luận (hòa vốn null, luật tự động không chạy, UI "chưa đủ giá vốn"). Quảng cáo đọc cờ của chính nó từ sổ, **không đi qua phép loại của báo cáo tài chính** → đổi (1) không làm (2) lệch. | **Không cần làm thêm.** |
| A | (phát hiện khi đo) Cờ "thiếu giá vốn" dính cả **quà tặng 0 đ** | `orderCost` gắn cờ khi BẤT KỲ dòng nào `costPriceAtSale ≤ 0`, kể cả dòng giá bán 0 đ (quà). 60 ngày prod: **28.732 đơn / 44 chủ shop / 801 tr lợi nhuận bị loại oan**; với quảng cáo, gian tặng quà kèm mọi đơn bị kéo độ phủ xuống dưới 90 % → mất hòa vốn (suy từ mã + số đơn, chưa mở trang gian). | **Lát A — nên làm bất kể quyết định (1):** cờ chỉ xét dòng có giá bán > 0. Cần tăng `LEDGER_FORMULA_VERSION` 3 → 4 (cờ nằm trong sổ), worker tính lại nền như 29/10. |
| 1 | Tài chính coi giá vốn = 0 | Khả thi về kỹ thuật, việc vừa (~1 ngày), **không cần tính lại sổ** (lợi nhuận từng đơn trong sổ đã tính với giá vốn 0; phép loại nằm ở tầng cộng). | **Em nghiêng về KHÔNG đổi** (mục 4). Nếu anh vẫn chốt đổi: làm theo mục 5, kèm 3 điều kiện. |

## 2. Số thật prod (Supabase SQL chỉ đọc qua Chrome anh, 02/11 ~14:30; 60 ngày, đơn tính doanh thu, sổ v3)

| Chỉ số | Số |
|---|---|
| Đơn tính doanh thu | 409.701 |
| Đơn mang cờ thiếu giá vốn | **225.005 (55 %)** |
| Doanh thu gốc | 64,86 tỷ — phần của đơn thiếu giá vốn **38,94 tỷ (60 %)** |
| Lợi nhuận đang hiện (đơn có giá vốn) | **5,60 tỷ** |
| Phần lợi nhuận đang bị loại (= tiền về − phí, chưa trừ vốn) | **26,48 tỷ** |
| Chủ shop có đơn thiếu giá vốn | 117 / 139 |
| Đơn thiếu giá vốn mà vẫn âm (đã là đơn lỗ) | 5.066 |

Tách theo dòng hàng (`order_line_ledger`):

| Nhóm | Đơn | Chủ shop | Lợi nhuận đang bị loại |
|---|---|---|---|
| **Thiếu thật** — có dòng giá bán > 0 mà giá vốn 0 | 196.273 | 117 | 25,68 tỷ |
| **Chỉ thiếu ở quà 0 đ** — mọi dòng giá vốn 0 đều có giá bán 0 | 28.732 | 44 | 0,80 tỷ |

Trong nhóm thiếu thật, giá trị dòng thiếu = 31,09 tỷ trên 31,21 tỷ giá trị đơn → **gần như cả đơn thiếu**, không phải "thiếu một dòng nhỏ trong đơn". Coi = 0 nghĩa là in "lãi" 25,7 tỷ trên 31,2 tỷ doanh thu (biên 82 %).

Phân bố theo chủ shop (tỷ lệ đơn thiếu giá vốn trong 60 ngày):

| Nhóm chủ shop | Chủ | Đơn | Đơn thiếu | LN đang bị loại |
|---|---|---|---|---|
| 0 % | 22 | 43.933 | 0 | — |
| < 10 % | 36 | 97.998 | 1.720 | 119 tr |
| 10–50 % | 22 | 25.716 | 8.070 | **−466 tr** (nhóm này coi = 0 thì lợi nhuận GIẢM) |
| 50–90 % | 14 | 136.961 | 110.811 | 8,52 tỷ |
| ≥ 90 % (gần như chưa nhập giá vốn) | **45** | 105.100 | 104.405 | 18,31 tỷ |

Ví dụ lớn: TORANO 23.676 đơn / 100 % thiếu / 7,05 tỷ sẽ thành "lãi"; vutientu91 98.275 đơn / 86 % / 5,92 tỷ.
Quà 0 đ: khanhdrop 59 % đơn chỉ thiếu ở quà (7.701/13.054), ledinhhieua 65 %, thanhtracovua 42 %, thanhthong 33 % (4 gian TikTok).

## 3. Cách mã đang làm (đọc 02/11)

- Cờ sinh ở `backend/src/lib/pnl-formula.ts orderCost`: `missingCostPrice = items.some(costPriceAtSale ≤ 0)`; đơn cũ không có dòng thì theo log kho. `cost` cộng `quantity × costPriceAtSale` → dòng thiếu đã góp **0 đ vốn** vào `profitAfterTax`. Tức là sổ cái (`order_ledger.profitAfterTax`) **đã là số "giá vốn = 0"**; cờ chỉ dùng ở tầng cộng.
- Tầng cộng LOẠI: `lib/net-profit.ts` (trừ `excludedProfit`), `lib/cash-flow-totals.ts` (`withCost`), `lib/overview-totals.ts`, `lib/realized-pnl-totals.ts` (`profit = missing ? 0 : …`), `lib/tax-totals.ts`, `routes/finance.ts summarizePnlRows` + cột Lợi nhuận dòng tiền (`profitAfterTaxWithCost`), `routes/analytics.ts`, `routes/tax.ts` (`additionalTaxMissingCost`), `routes/assistant.ts` (3 chỗ, cả câu chữ), SQL `services/order-ledger.ts`: `ledgerSummary` (đếm + Σ theo nhóm), `ledgerPnlSummary`, `ledgerTaxReportTotals` (`FILTER (WHERE NOT "missingCostPrice")`).
- KHÔNG loại (giữ nguyên dù đổi): Đơn lỗ (`isLoss` = lãi < 0 trên số đã tính với vốn 0; đơn thiếu giá vốn hiện kèm nhãn "Chưa nhập giá vốn"), chuông đơn lỗ (`ops-alerts` chỉ bỏ đơn thiếu giá vốn khỏi danh sách mã tham chiếu), Lãi/Lỗ theo SKU (cờ theo SKU, tab riêng), trang Giá vốn lọc "SKU bán trong kỳ chưa có giá vốn", hộp nhắc `MissingCostPrompt` (Bỏ qua = không hiện lại).
- Quảng cáo: `marginOverRows` / `ledgerMarginByGroup` (Shopee, Lazada), `tiktok-breakeven.ts` / `ledgerTiktokBreakevenByGroup` (TikTok) — loại đơn có cờ khỏi tử và mẫu, `costCoveragePct = revenue ÷ (revenue + missingCostRevenue [+ unlinkedRevenue])`, rào `MARGIN_MIN_COST_COVERAGE_PCT` = `BREAKEVEN_MIN_COVERAGE_PCT` = 90 (anh duyệt 18/09). Gợi ý chạy quảng cáo đếm "sản phẩm đang bán chưa có giá vốn" theo DÒNG (`unitsNoCost`, cũng dính quà 0 đ).
- Web đọc `missingCost {orderCount, excludedProfit}`: `app/page.tsx` (bậc thác nước "Thiếu vốn" + phụ đề thẻ Lợi nhuận), `app/finance/analytics/page.tsx`, `realized-pnl/OverviewDashboard.tsx`, `MissingCostNote` dùng chung; bảng Lãi/Lỗ 3 sàn gắn nhãn từng đơn. Mobile: `FinancePage.tsx` bậc "Thiếu vốn" + câu "không được tính vào lợi nhuận" (1.4.1 đang chờ duyệt → sửa bằng OTA).

## 4. Phản biện điểm (1) — vì sao em nghiêng về giữ cách loại

Điều đúng trong ý anh:
- Đẳng thức khách nhìn gọn hơn: Doanh thu − Chi phí = Lợi nhuận, bỏ bậc "Thiếu vốn" khó hiểu trên thác nước (web + mobile).
- Shop chưa nhập giá vốn hiện thấy Lợi nhuận ≈ 0 kèm một dòng chữ — dễ tưởng app hỏng/không có số. 45 chủ shop (≈ 1/3) đang ở tình trạng này.
- Đơn thiếu một dòng nhỏ bị loại cả đơn là quá tay — nhưng số đo cho thấy ca này gần như không có (31,09/31,21 tỷ), trừ ca quà 0 đ (Lát A xử lý riêng).

Điều em lo, bằng số:
1. **Lãi ảo lớn và trông như thật.** Toàn nền tảng lợi nhuận 60 ngày 5,6 tỷ → 32,1 tỷ; shop chưa nhập giá vốn thấy "lãi" = tiền về − phí (TORANO 7,05 tỷ). Anh vừa chốt 01/11 số thẻ "nhìn khá dối" là không được — đây là dạng dối lớn hơn nhiều.
2. **Mất động lực nhập giá vốn.** Hôm nay số "xấu" (0) ép khách nhập; số "đẹp" thì không ai nhập nữa → hòa vốn quảng cáo (cần giá vốn, đã loại đúng) càng lâu có, mà Trợ lý quảng cáo là định vị chính (15/10).
3. **Không đúng hơn, chỉ đổi loại sai.** Thiếu giá vốn = lợi nhuận CHƯA BIẾT; 0 và "tiền về" đều sai, nhưng "tiền về" sai xa hơn (biên 82 %) và sai theo hướng làm khách yên tâm giả.
4. **Thuế bổ sung** (shop DN tính trên lợi nhuận): dự phòng nhảy theo lãi ảo. Hướng này "dè dặt" (trích dư) nên chấp nhận được, nhưng là số tiền khách để riêng thật.
5. Nhóm 22 chủ shop 10–50 %: phần bị loại đang ÂM (−466 tr) → coi = 0 làm lợi nhuận của họ giảm — không ai kêu nhưng là đổi số hai chiều.
6. Ca khách gần nhất kêu "đơn chưa có giá vốn" (Nguyệt Ký 02/11, KTNstore/TOVO/CT BOOT) đều là **cờ sai hoặc giá vốn nhập sai**, không phải vì cách loại. Em chưa có ca khách kêu vì bị loại — nếu anh có ca cụ thể, cho em biết để soi đúng gốc.

→ Đề xuất của em: **giữ cách loại**, làm Lát A (quà 0 đ) để bớt loại oan và cứu độ phủ quảng cáo; câu chữ "N đơn chưa có giá vốn nên không được tính vào lợi nhuận" giữ nguyên. Nếu anh chốt ngược (anh có quyền, và có lý do khách), em làm theo mục 5 hết mình.

## 5. Nếu anh chốt coi giá vốn = 0 — phạm vi làm (ước ~1 ngày, không tính lại sổ)

Nguyên tắc: **một chỗ đổi định nghĩa** (`lib/finance-definitions.ts`), các nơi khác chỉ gọi; cờ `missingCostPrice` GIỮ để nhắc nhập giá vốn.

1. Backend tầng cộng: bỏ phép trừ `excludedProfit` / `withCost` / `profit = 0 if missing` ở 8 lib + route liệt kê mục 3; SQL bỏ `FILTER (WHERE NOT "missingCostPrice")` ở `ledgerPnlSummary`, `ledgerTaxReportTotals` (giữ cột đếm `missingCostCount`). Sổ cái **không đổi phiên bản**.
2. API giữ `missingCost.orderCount`; `excludedProfit` trả **0** để web/mobile cũ (1.4.0/1.4.1 chưa OTA) không trừ hai lần; thêm trường mới `profitAtZeroCost` (= Σ lãi của đơn thiếu) nếu cần hiện tham khảo — nhưng anh đã bỏ dòng "lãi tạm tính" 30/10 nên mặc định KHÔNG hiện.
3. Câu chữ (web `MissingCostNote`, `page.tsx`, mobile `FinancePage`, Trợ lý 2 câu): "N đơn chưa có giá vốn — lợi nhuận đang tính như giá vốn 0 đ. Nhập giá vốn" (một câu, có link). Bỏ bậc "Thiếu vốn" trên thác nước web + mobile (OTA).
4. Thuế: đi theo cùng số (bỏ loại) để một đẳng thức; cảnh báo "N đơn chưa có giá vốn" giữ.
5. Đơn lỗ, chuông, SKU, trang Giá vốn, hộp nhắc, quảng cáo: **không đụng**.
6. Test: 6 tệp dùng `excludedProfit`/`missingCostExcludedProfit` + `finance-definitions.test.ts` đổi kỳ vọng; test "đẳng thức Doanh thu − Chi phí = Lợi nhuận" thay cho đẳng thức 3 vế. So prod bằng javascript fetch trước/sau cho 1 shop ≥ 90 % thiếu + 1 shop 0 %.
7. Docs: KIEN-TRUC 9a #7/#8 ghi ngày đổi, SO-CAI-DON, chú thích `finance-definitions.ts`, memory `hubsell-dinh-nghia-tai-chinh`.

Ba điều kiện em xin kèm nếu làm: (a) câu chú thích ở mục 3 phải có mặt mọi nơi in Lợi nhuận; (b) hộp nhắc nhập giá vốn giữ; (c) Lát A làm trước hoặc cùng lượt.

## 6. Lát A — cờ thiếu giá vốn bỏ qua dòng giá bán 0 đ (đề xuất làm, chờ anh gật)

- Sửa `orderCost`: `missingCostPrice = items.some(costPriceAtSale ≤ 0 && price > 0)`; dòng sổ `order_line_ledger` ghi cùng luật; `salesPaceByItem.unitsNoCost` + SQL `noCost` cùng luật (quà 0 đ không đếm "sản phẩm chưa có giá vốn"). Lãi/Lỗ theo SKU: SKU giá bán 0 không vào tab "chưa có giá vốn".
- Đánh đổi nói rõ: quà có vốn thật mà shop không nhập → lãi đơn cao hơn thật một chút (giá quà); shop muốn đúng thì nhập giá vốn cho SKU quà (trang Giá vốn vẫn liệt kê SKU đã bán). Hợp với ý anh 26/10 "giá vốn là của khách".
- `LEDGER_FORMULA_VERSION` 3 → 4: worker tính lại nền toàn sổ (29/10 v2→v3 đã làm 2 lần cùng ngày: ~587k dòng, kỳ đang xem tự tính inline, đã sửa lỗi cộng thiếu khi đổi phiên bản `807d2fab`). Chạy giờ thấp điểm, theo dõi Disk IO Supabase (sự cố 28/10).
- Tác động mong đợi: tài chính +28.732 đơn / +801 tr lợi nhuận cho 44 shop; quảng cáo: gian tặng quà kèm đơn lấy lại độ phủ ≥ 90 % → có hòa vốn + luật tự động chạy. Kiểm sau deploy: khanhdrop / ledinhhieua / thanhthong độ phủ trước–sau.
- Việc vừa–nhỏ: 1 hàm + 2 câu SQL + test 4 ca (đơn chỉ quà; quà kèm hàng có vốn; quà kèm hàng thiếu vốn; dòng giá bán 0 không phải quà). Ca cuối bị coi "không thiếu" → chấp nhận vì doanh thu dòng đó = 0 nên không thổi lãi.

## 7. Việc còn / chờ anh

- ⏳ Anh chốt: (1) giữ cách loại (em đề xuất) hay coi = 0 (mục 5); (2) Lát A làm không.
- Nếu anh có ca khách cụ thể kêu về lợi nhuận bị loại → gửi em mã đơn/gian để soi đúng gốc trước khi đổi định nghĩa.

## 8. PHƯƠNG ÁN HOÀN CHỈNH (trình anh 02/11 chiều, theo yêu cầu "xây dựng phương án hoàn chỉnh")

Anh đã làm rõ: điều anh cần là **tài chính coi đơn thiếu giá vốn như giá vốn 0, còn ROI/ROAS hòa vốn vẫn gạt những đơn đó ra**. Trả lời ngắn: gạt được, vì quảng cáo đọc cờ `missingCostPrice` riêng từ sổ cái, không đọc tổng lợi nhuận của báo cáo tài chính. Phương án dưới đây làm đúng điều đó, gồm 3 lát, theo đúng thứ tự.

### 8.1. Định nghĩa sau khi đổi (mỗi khái niệm một câu — sẽ ghi vào `lib/finance-definitions.ts`)

| Khái niệm | Trước (30/09) | Sau |
|---|---|---|
| Lợi nhuận một đơn | Doanh thu thực − giá vốn − khấu trừ (dòng thiếu giá vốn góp 0 đ vốn) | **Không đổi** — sổ cái đã là số này |
| Lợi nhuận kỳ (Tổng quan, Dòng tiền, Lãi/Lỗ, Trợ lý) | Σ lợi nhuận đơn **có giá vốn**; đơn thiếu bị trừ ra | **Σ lợi nhuận mọi đơn tính doanh thu** (đơn thiếu = giá vốn 0). Đẳng thức: Doanh thu − Chi phí = Lợi nhuận |
| Đơn chưa có giá vốn | Có dòng hàng `costPriceAtSale ≤ 0` (kể cả quà 0 đ) | **Có dòng hàng giá bán > 0 mà `costPriceAtSale ≤ 0`** (Lát A). Vẫn đếm, vẫn nhắc nhập giá vốn, không còn loại |
| Thuế bổ sung (cơ sở lợi nhuận) | Trên lợi nhuận đơn có giá vốn | Trên cùng lợi nhuận kỳ ở trên; cảnh báo "N đơn chưa có giá vốn" giữ |
| Đơn lỗ | Lãi < 0 | **Không đổi** |
| ROI/ROAS hòa vốn, biên lãi, luật tự động, Lãi/lỗ ước tính | Gạt đơn có cờ khỏi tử và mẫu; độ phủ < 90 % → không kết luận | **Không đổi** (chỉ hưởng lợi từ Lát A: quà 0 đ không còn kéo độ phủ) |

### 8.2. Ba lát và thứ tự

| Lát | Nội dung | Tính lại sổ? | Ước lượng | Khi nào |
|---|---|---|---|---|
| **B — Tài chính coi giá vốn 0** | Tầng cộng backend + API + web; mobile nhờ API tự ẩn bậc "Thiếu vốn" | Không | 0,5–1 ngày | Push 1, ban ngày |
| **C — Mobile OTA + Trợ lý + docs** | Câu chữ app, Trợ lý, docs, memory | Không | 1–2 giờ | Ngay sau push 1 (OTA ≤ 30') |
| **A — Cờ thiếu giá vốn bỏ quà 0 đ** | `orderCost` + 2 câu SQL + SKU; `LEDGER_FORMULA_VERSION` 3 → 4 | Có, nền ~40' (29/10: 587k dòng, ~300 dòng/giây) | 0,5 ngày | Push 2, giờ thấp điểm (≥ 22:00) |

Vì sao B trước A: B không đụng sổ nên lên là thấy ngay; A kéo theo tính lại nền, tách riêng để nếu Disk IO Supabase có vấn đề (sự cố 28/10) thì biết do đâu và dừng được riêng.

### 8.3. Lát B — chi tiết từng tệp

**Backend — tầng cộng (bỏ phép trừ, giữ phép đếm):**

| Tệp | Đổi |
|---|---|
| `lib/finance-definitions.ts` | Chú thích định nghĩa 4 đổi theo 8.1 (ghi ngày anh chốt). `summarizeMissingCost` giữ (đếm + Σ lãi đơn thiếu) nhưng tên trường `excludedProfit` → `profitAtZeroCost` (không còn "bị loại") |
| `lib/net-profit.ts` | Bỏ tham số `excludedProfit` khỏi `netProfitAfterProvision` (xóa hẳn để chỗ nào còn truyền thì tsc báo) |
| `lib/cash-flow-totals.ts` | `withCost` → lấy thẳng `profitAfterTax`; `settled/pending.profitAfterTaxWithCost` đổi tên `profitAfterTax`; đường rows bỏ `profitWithCost = missing ? 0 : …` |
| `lib/overview-totals.ts`, `lib/realized-pnl-totals.ts`, `lib/tax-totals.ts` | Bỏ nhánh `missing ? 0 : profit`; trường `missingCostExcludedProfit` đổi tên `missingCostProfit` (giữ đếm `missingCostCount`) |
| `services/order-ledger.ts` | `ledgerPnlSummary`: `profit` bỏ `FILTER (WHERE NOT "missingCostPrice")`; `ledgerTaxReportTotals`: `profitWithCost` → `profit` không FILTER; `ledgerSummary`: alias `__missingCostExcludedProfit` giữ ở SQL, đổi tên khi map ra TS |
| `routes/finance.ts` | `summarizePnlRows` (đường rows/oracle) bỏ nhánh 0; cột Lợi nhuận "Thực tế/Dự kiến" của Báo cáo dòng tiền dùng `settled.profitAfterTax`; response `missingCost` theo hợp đồng 8.4 |
| `routes/analytics.ts` | `netProfitAfterProvision` không còn `excludedProfit`; response `missingCost` theo 8.4 |
| `routes/tax.ts` | `profit = t.profit`; `additionalTaxMissingCost` giữ hình dạng, ý nghĩa đổi thành "đơn đang tính với giá vốn 0" |
| `routes/assistant.ts` | `netOf` bỏ `− missingCostExcludedProfit`; `net = revenue − cost − fee − opex − ads`; 2 câu "không được tính vào lợi nhuận" → "đang tính với giá vốn 0 đ"; dòng bảng "Không tính N đơn…" → "N đơn chưa có giá vốn (giá vốn tạm 0 đ)" không kèm số tiền |
| `services/ops-alerts.ts`, `lib/finance-views.ts` (Đơn lỗ) | **Không đụng** |

**API — hợp đồng giữ tương thích mobile cũ (1.4.0 trên kho, 1.4.1 đang duyệt):**

- `missingCost: { orderCount, excludedProfit }` giữ tên trường ở `/api/analytics`, `/api/finance/analytics`, `/api/finance/realized-pnl`, `/api/tax/report`; **`excludedProfit` luôn trả 0**. Mobile cũ dựng bậc "Thiếu vốn" với amount 0 → `WaterfallChart` bỏ qua bậc 0 (`if (st.amount === 0) continue`) → thác nước cũ **tự đóng đúng**, không cần OTA để số đúng; chỉ câu chữ "không được tính vào lợi nhuận" còn sai tới khi OTA (mục C).
- Không thêm trường "lãi tạm tính" (anh bỏ 30/10). Số Σ lãi đơn thiếu vẫn có trong totals backend (đặt tên `profitAtZeroCost`) để Trợ lý / HQ dùng khi cần, không in ra màn khách.

**Web:**

| Tệp | Đổi |
|---|---|
| `components/finance/missing-cost-note.tsx` | Câu: "**N đơn chưa có giá vốn — đang tính với giá vốn 0 đ.** Nhập giá vốn" (link lọc kỳ giữ) |
| `app/page.tsx` | Bỏ bậc thác nước `missingCost`; phụ đề thẻ Lợi nhuận: "N đơn đang tính với giá vốn 0 đ" thay "không được tính vào lợi nhuận" |
| `app/finance/analytics/page.tsx`, `components/finance/realized-pnl/OverviewDashboard.tsx` | Chỉ dùng `MissingCostNote` mới, không đổi bố cục |
| `app/invoicing/history/page.tsx` (thuế) | "N đơn chưa có giá vốn **đang tính với giá vốn 0 đ** trong thuế bổ sung" |
| `components/finance/missing-cost-prompt.tsx` | Chú thích + câu hộp giữ ý nhắc nhập; không đổi điều kiện hiện/Bỏ qua |
| Bảng Lãi/Lỗ 3 sàn, `sku-pnl-table`, trang Giá vốn | Không đổi (nhãn từng đơn / tab SKU vẫn đúng) |
| `lib/api.ts` | Chú thích đẳng thức mới; kiểu `MissingCostSummary` giữ |

**Test (14 tệp đụng cờ; sửa kỳ vọng, không bỏ ca):** `net-profit.test`, `cash-flow-totals.test`, `overview-totals.test`, `realized-pnl-totals.test`, `tax-totals.test`, `finance-definitions.test`, `finance-views.test`, `order-ledger.test` + DB: `order-ledger-db`, `realized-pnl-ledger-db`, `tax-ledger-db`, `finance-views-ledger-db`. Thêm 1 ca mới: fixture có đơn thiếu giá vốn → **Doanh thu − Σ chi phí = Lợi nhuận** đúng từng đồng ở Tổng quan và Dòng tiền (thay ca đẳng thức 3 vế). `ads-margin.test`, `tiktok-breakeven.test`, `ads-rows-ledger-db` **phải xanh không sửa** — chứng minh quảng cáo không đổi.

### 8.4. Lát C — mobile OTA, Trợ lý, docs

- `hubsell-mobile/src/screens/FinancePage.tsx`: bỏ bậc `missingCost` trong `waterfallSteps`; câu ở thẻ Lợi nhuận → "N đơn chưa có giá vốn — đang tính với giá vốn 0 đ". Publish OTA kênh production (runtime 1.4.1, như 01/11), nhãn "· cập nhật" ở Cài đặt.
- Trợ lý hỏi đáp: 2 câu đã liệt kê ở 8.3.
- Docs: `KIEN-TRUC-QUY-MO-TRIEU-DON.md` 9a #7 #8 ghi "đổi 0x/11/2026 theo anh chốt"; `SO-CAI-DON.md` mục báo cáo đọc sổ; đầu tệp này; memory `hubsell-dinh-nghia-tai-chinh`.

### 8.5. Lát A — cờ thiếu giá vốn bỏ quà 0 đ (sổ v4)

| Tệp | Đổi |
|---|---|
| `lib/pnl-formula.ts orderCost` | `missingCostPrice = items.some(it => Number(it.costPriceAtSale) <= 0 && Number(it.price) > 0)`; nhánh đơn cũ theo log kho giữ nguyên |
| `lib/order-ledger.ts` | Chú thích v4 trong lịch sử `LEDGER_FORMULA_VERSION`; dòng sổ chép cờ cấp đơn (không đổi mã) |
| `services/order-ledger.ts ledgerMarginByGroup` | `noCost` = `l."costPriceAtSale" <= 0 AND l."lineGross" > 0` (đếm "sản phẩm chưa có giá vốn" của Gợi ý chạy quảng cáo) |
| `lib/ads-margin.ts salesPaceByItem` | `unitsNoCost` cùng luật (`costPriceAtSale ≤ 0 && price > 0`) để hai đường rows/SQL bằng nhau |
| `routes/finance.ts` Lãi/Lỗ theo SKU | `missingCost = quantitySold > 0 && cogs <= 0 && revenue > 0` (SKU quà không vào tab "chưa có giá vốn") |
| Trang Giá vốn lọc "bán trong kỳ chưa có giá vốn" | Kiểm câu lọc trong `routes/finance.ts` / `order-ledger.ts`: nếu lọc theo `costPriceAtSale ≤ 0` thì thêm `lineGross > 0` để danh sách khớp số đơn trên màn |
| `LEDGER_FORMULA_VERSION` | 3 → 4 |

Test: `pnl-formula` thêm 3 ca (đơn chỉ quà 0 đ → không cờ; quà kèm hàng có vốn → không cờ; quà kèm hàng thiếu vốn → cờ); `ads-margin.test` + `tiktok-breakeven-sql-db` (đã có ca "quà giá 0 riêng và kèm hàng") đổi kỳ vọng; `ads-recommend` ca `unitsNoCost`.

Vận hành: push ≥ 22:00; worker sổ cái tự nhặt dòng v3 (`claimDirtyLedgerRows` đã nhặt cả phiên bản cũ từ 29/10 `807d2fab`), kỳ đang xem tự tính inline nên khách không thấy thiếu số; theo dõi Supabase Disk IO + `scripts/ledger-backfill.ts status` tới khi v3 = 0 (~40').

### 8.6. Nghiệm thu bằng số thật (trước/sau, javascript fetch 2 nguồn như 30/09)

| Kiểm | Kỳ vọng |
|---|---|
| Toàn nền tảng 60 ngày (SQL) sau B | Lợi nhuận hiện 5,60 tỷ → ≈ 32,08 tỷ (= `profit_all` đã đo mục 2) |
| TORANO (100 % thiếu) sau B | Lợi nhuận 60 ngày ≈ +7,05 tỷ; câu "23.676 đơn chưa có giá vốn — đang tính với giá vốn 0 đ" |
| Chủ Shop Hubsell demo (0 % thiếu) sau B | Mọi thẻ **không đổi một đồng** (đối chứng) |
| Thác nước web + mobile 1.4.1 chưa OTA | Đóng 0 ở 3 bộ lọc; không còn bậc "Thiếu vốn" |
| Quảng cáo and.not.or / ANO sau B | Hòa vốn, biên lãi, độ phủ **giữ nguyên số** (đối chứng quảng cáo không đổi) |
| Sau A (v3 = 0) | Đơn cờ thiếu 60 ngày 225.005 → ≈ 196.273; khanhdrop / ledinhhieua / thanhthong độ phủ hòa vốn lên ≥ 90 % → có hòa vốn; 44 shop thêm tổng ≈ 801 tr lợi nhuận (sau B thì phần này đã nằm trong lợi nhuận, A chỉ đổi số đếm + độ phủ) |

### 8.7. Rủi ro và đường lui

- **Lát B:** revert một commit, không migration, không đổi sổ. Rủi ro nghiệp vụ là rủi ro đã nêu mục 4 (lãi ảo, mất động lực nhập giá vốn) — anh đã cân nhắc và chốt; em giữ câu nhắc + hộp nhắc để bù.
- **Lát A:** dòng v4 đã ghi thì không quay về v3 bằng cách hạ số; đường lui = revert mã + tăng v5 (tính lại lần nữa ~40'). Disk IO: nhịp worker mặc định 100 dòng/2 giây, giờ thấp điểm.
- **Mobile cũ:** số đúng nhờ `excludedProfit = 0`; câu chữ cũ sai 1–2 giờ tới khi OTA.
- **Trợ lý / HQ:** không còn dòng tiền "bị loại"; nếu anh muốn HQ vẫn nhìn được Σ lãi đơn thiếu toàn nền tảng, trường `profitAtZeroCost` có sẵn trong totals.

### 8.8. Ba điểm xin anh chốt trước khi code

1. **Thuế bổ sung** đi theo cùng lợi nhuận (đề xuất: có, một đẳng thức) hay giữ loại riêng?
2. **Câu chữ** "N đơn chưa có giá vốn — đang tính với giá vốn 0 đ. Nhập giá vốn" — anh duyệt chữ này?
3. **Lát A** làm cùng đợt (đề xuất: có, push 2 giờ thấp điểm) hay để sau?

## 9. ĐÃ LÀM 04/11/2026 (lượt tự động 20:00, lịch anh đặt 02/11 — commit lịch `5cf8230f`)

Trước khi code em kiểm `git log` + đầu PROGRESS: sau `5cf8230f` anh không ghi quyết định nào khác về 3 điểm 8.8 và không đổi ý → làm theo mặc định: **thuế bổ sung đi theo cùng lợi nhuận; câu chữ như 8.3; Lát A cùng đợt.** Không mở trình duyệt prod/Supabase (không có anh); nghiệm thu số thật 8.6 để anh làm sau push.

### 9.1. Commit 1 — Lát B + mobile câu chữ (`ab4d62c9`, chưa push)

| Nơi | Đã đổi |
|---|---|
| `lib/finance-definitions.ts` | Chú thích định nghĩa mới theo 8.1 (ghi ngày anh chốt 02/11, áp 04/11, nhắc bản cũ 30/09 → 04/11). `summarizeMissingCost` trả `{ orderCount, profitAtZeroCost }` (đổi tên từ `excludedProfit`). Thêm `missingCostApiSummary(orderCount)` = hợp đồng API `{ orderCount, excludedProfit: 0 }` — một chỗ, 4 route gọi |
| `lib/net-profit.ts` | Bỏ hẳn tham số `excludedProfit` (chỗ nào còn truyền thì tsc báo — đã sạch) |
| `lib/cash-flow-totals.ts` | `settled/pending.profitAfterTaxWithCost` → `profitAfterTax` (Σ mọi đơn); `active.missingCostExcludedProfit` → `missingCostProfit` (đếm + tham khảo); bỏ `withCost` |
| `lib/overview-totals.ts`, `lib/order-ledger.ts` (`LedgerGroupTotals`) | `missingCostExcludedProfit` → `missingCostProfit` |
| `lib/realized-pnl-totals.ts` | `profitWithCost` → `profit` = Σ profitAfterTax mọi đơn khớp lọc; bỏ nhánh `missing ? 0 : …` |
| `lib/tax-totals.ts` | `profitWithCost` → `profit` cộng mọi đơn không hủy; đếm thiếu giữ |
| `services/order-ledger.ts` | `ledgerSummary` alias `__missingCostProfit`; `ledgerPnlSummary` + `ledgerTaxReportTotals` bỏ `FILTER (WHERE NOT "missingCostPrice")`, cột `profit`; `diffLedgerSummaries` đổi tên chỉ số |
| `routes/finance.ts` | `summarizePnlRows` (mốc test) bỏ nhánh 0; tổng kết Lãi/Lỗ dùng `t.profit`; cột Lợi nhuận Thực tế/Dự kiến của Dòng tiền dùng `settled/pending.profitAfterTax`; `missingCost` = `missingCostApiSummary(...)` |
| `routes/analytics.ts` | `netProfitAfterProvision` không còn `excludedProfit`; `missingCost` theo hợp đồng |
| `routes/tax.ts` | `profit = t.profit`; `additionalTaxMissingCost` giữ hình dạng (excludedProfit = 0), ý nghĩa "đang tính với giá vốn 0" |
| `routes/assistant.ts` | `netOf` bỏ trừ; 2 câu "⚠️ N đơn chưa có giá vốn — đang tính với giá vốn 0 đ, nhập giá vốn để số đúng."; dòng bảng "N đơn chưa có giá vốn (giá vốn tạm 0 đ)" → "Nhập giá vốn" (không in số tiền) |
| Web | `MissingCostNote`: "N đơn chưa có giá vốn — đang tính với giá vốn 0 đ. Nhập giá vốn"; `app/page.tsx` bỏ bậc "Thiếu vốn" + phụ đề thẻ Lợi nhuận; `invoicing/history` câu thuế; `MissingCostPrompt` câu mô tả "đang tính các đơn này với giá vốn 0 đ (cao hơn thật)" (điều kiện hiện/Bỏ qua KHÔNG đổi); `lib/api.ts` chú thích |
| Mobile (chưa OTA) | `FinancePage.tsx` bỏ bậc `missingCost` + câu thẻ Lợi nhuận; **thêm ngoài kế hoạch** `OverviewPage.tsx` câu "N đơn chưa có giá vốn — tạm tính giá vốn 0 đ" (cũng đang nói "không tính lợi nhuận"); `types/api.ts` chú thích |
| Không đụng | Đơn lỗ (`finance-views`), `ops-alerts`, `ads-margin`, `tiktok-breakeven`, SQL gom quảng cáo, trang Giá vốn, hộp nhắc (logic), `LEDGER_FORMULA_VERSION` |

Lệch nhỏ so với 8.3: tên nội bộ dùng `missingCostProfit` / `profit` / `profitAfterTax` (ngắn hơn `profitAtZeroCost`, chỉ `summarizeMissingCost` giữ tên `profitAtZeroCost` theo bảng); SQL `ledgerSummary` đổi alias luôn thay vì "giữ alias, đổi khi map" (map là vòng lặp theo tên trường nên đổi một chỗ là đủ).

Test commit 1 (23 tệp: 12 thuần + 11 DB dev): **210 qua / 2 đỏ**, 2 đỏ **đúng 2 ca đỏ sẵn trước khi sửa** (chạy baseline cùng bộ lúc 20:04 trên `55943924`: 201 qua / 2 đỏ) — `order-ledger-db` "xóa chủ shop cascade" đếm 2 ≠ 0 và `realized-pnl-ledger-db` thiếu chỉ mục GIN trigram trên DB dev. `ads-margin.test`, `tiktok-breakeven.test`, `ads-rows-ledger-db`, `ads-margin-sql-db`, `tiktok-breakeven-sql-db` **xanh không sửa** → quảng cáo không đổi. Test mới `lib/__tests__/missing-cost-zero-equation.test.ts` (6 ca): fixture 2 đơn thiếu giá vốn → Tổng quan `Doanh thu − Giá vốn − Sàn khấu trừ` = Dòng tiền `thực tế + dự kiến` = Lãi/Lỗ tổng = Σ sàn = Σ ngày = Σ profitAfterTax mọi đơn, thuế cộng cả đơn thiếu, API `excludedProfit = 0`. `net-profit.test` viết lại theo đẳng thức mới (228.000 / thuế 22.800 / ròng 205.200) + ca "đơn thiếu giá vốn góp trọn 170.000 tiền về". tsc backend + frontend + mobile sạch.

### 9.2. Commit 2 — Lát A, sổ v4 (commit ngay sau `ab4d62c9`, chưa push)

| Nơi | Đã đổi |
|---|---|
| `lib/pnl-formula.ts orderCost` | `missingCostPrice = items.some(cost ≤ 0 && price > 0)`; nhánh đơn cũ theo log kho giữ nguyên; chú thích lý do + đánh đổi |
| `lib/order-ledger.ts` | `LEDGER_FORMULA_VERSION` 3 → **4** + dòng lịch sử v4 |
| `services/order-ledger.ts ledgerMarginByGroup` | `noCost = costPriceAtSale ≤ 0 AND lineGross > 0` |
| `lib/ads-margin.ts salesPaceByItem` | `unitsNoCost` cùng luật (`!(cost > 0) && price > 0`) |
| `routes/finance.ts` Lãi/Lỗ theo SKU | `missingCost = quantitySold > 0 && cogs ≤ 0 && revenue > 0` |
| `routes/finance.ts` `/sku-products/missing-cost` (trang Giá vốn lọc "bán trong kỳ chưa có giá vốn") | thêm `AND l."lineGross" > 0` — trước đó lọc `costPriceAtSale ≤ 0` nên quà 0 đ lọt danh sách, lệch số "N đơn" |
| Test | `pnl-returns.test` thêm 4 ca (đơn chỉ quà → không cờ; quà kèm hàng có vốn → không cờ, vốn 131.000; quà kèm hàng thiếu vốn → cờ; quà có nhập vốn trừ như thường) |

Test commit 2 (cùng 23 tệp): **214 qua / 2 đỏ** (đúng 2 ca đỏ sẵn). **Không tệp test quảng cáo nào phải đổi kỳ vọng**: `ads-margin-sql-db` quà "G" có vốn 5.000 (unitsNoCost 0 từ trước); `tiktok-breakeven-sql-db` S9 (chỉ quà 0 đ, vốn 0) trước mang cờ, nay không — nhưng dòng `lineGross = 0` không "paid" nên không vào doanh thu/độ phủ/tự kiểm ở cả hai bản, số đếm giữ nguyên; `ads-margin.test` dòng B giá 300 vốn 0 vẫn đếm 3 món. Các test DB dev so sổ ↔ đơn (`realized-pnl-ledger-db`, `tax-ledger-db`, `cash-flow-ledger-db`, `overview-ledger-db`, `ads-rows-ledger-db`, `finance-views-ledger-db`) qua với v4 — tức DB dev đã tính lại được bằng công thức mới trong lượt test.

### 9.3. Việc còn (chờ anh)

1. **Push commit 1 (Lát B) ban ngày** — không migration, không đổi sổ; Render deploy backend, Vercel dựng frontend. Sau đó nghiệm thu 8.6 phần "sau B": TORANO ≈ +7,05 tỷ/60 ngày, demo 0 % thiếu không đổi một đồng, and.not.or hòa vốn giữ nguyên, thác nước web + mobile 1.4.1 chưa OTA đóng 0.
2. **Push commit 2 (Lát A) ≥ 22:00**: worker tự nhặt dòng v3 (`claimDirtyLedgerRows` nhặt cả phiên bản cũ), kỳ đang xem tự tính inline; theo dõi Supabase Disk IO + `npx tsx scripts/ledger-backfill.ts status` tới khi v3 = 0 (~40', 29/10 ~300 dòng/giây). Sau đó kiểm 8.6 phần "sau A": đơn cờ thiếu 60 ngày 225.005 → ≈ 196.273; khanhdrop / ledinhhieua / thanhthong độ phủ ≥ 90 %.
3. **OTA mobile** kênh production (runtime 1.4.1) sau khi anh duyệt câu chữ — em chưa publish.
4. Chưa chạy **cả bộ test backend** (chỉ 23 tệp liên quan); chưa soi giao diện trên trình duyệt (trang Tổng quan, Dòng tiền, Lãi/Lỗ, Thuế) — anh mở local hoặc em soi ở lượt có anh.
5. Đường lui như 8.7: B = revert một commit; A = revert mã + tăng v5.

### 9.4. Dọn mã sau hai lát (04/11 ~21:00, anh: "dọn sạch code thừa, cấu trúc chuyên nghiệp")

Rà bằng grep toàn bộ tên liên quan + `tsc --noUnusedLocals` trên các tệp đã đụng:

| Thừa | Xử lý |
|---|---|
| `missingCostProfit` (trước là `missingCostExcludedProfit`) trong 5 bộ tổng (`LedgerGroupTotals`, `OverviewTotals`, `CashFlowTotals`, `PnlSummaryTotals`, `TaxReportTotals`) + 3 câu SQL (`ledgerSummary` 7 nhóm × 1 cột, `ledgerPnlSummary`, `ledgerTaxReportTotals`) | **Bỏ hẳn**: không màn nào đọc, anh đã bỏ dòng "lãi tạm tính" 30/10 nên không có lý do giữ; `ledgerSummary` bớt 7 cột SUM FILTER. Muốn xem lại Σ lãi đơn thiếu thì một câu SQL trên sổ là ra |
| `summarizeMissingCost` (chỉ còn oracle test gọi) | **Bỏ**; `lib/finance-definitions.ts` chỉ còn `MissingCostSummary` + `missingCostApiSummary(orderCount)` — một hợp đồng API, 4 route gọi |
| `summarizePnlRows` nằm trong `routes/finance.ts` nhưng mã chạy thật không gọi từ 30/09 (mốc test) | **Dời** sang `integrations/__tests__/pnl-rows-oracle.ts` (nơi đã chứa đường đối soát cũ cho test DB); 2 test đổi import. Route file bớt 85 dòng |
| Câu chữ cũ "bị loại khỏi lợi nhuận" còn sót ở phần SKU thiếu giá vốn: `lib/api.ts` (3 chú thích), `cost-price-table.tsx`, mobile `api/cost-prices.ts`, `CostPricesScreen.tsx` (2 chú thích + **1 câu khách thấy** ở tab Cần nhập), `types/api.ts` | Đổi thành "đang tính với giá vốn 0 đ" |
| Giữ nguyên (không thừa) | `missingCostCount` ở mọi bộ tổng (nguồn số "N đơn"); `MissingCostSummary.excludedProfit` phía web/mobile (hợp đồng API cho app cũ); re-export `computePnlRow`… ở `routes/finance.ts` (test cũ import, có từ 30/09 — ngoài phạm vi hôm nay) |

Không đổi công thức, không đổi sổ, không đổi API. Kiểm: tsc backend/frontend/mobile sạch; `--noUnusedLocals --noUnusedParameters` trên 7 tệp đụng sạch; bộ test 23 tệp chạy lại (kết quả ở PROGRESS 04/11 ~21:10).

### 9.5. Theo dõi sau push (04/11 20:25 → 21:33, anh chốt push cả B lẫn A cùng lúc, rồi "Theo dõi luôn")

- Render lên `16e1d843` 20:27:10; bản dọn mã `c6915f94` lên 21:10:05. `/health` 0,17–0,4 giây suốt kỳ; CPU DB 21–36 % tức thời, 21–32/90 kết nối.
- **Sổ v3 → v4** (SQL chỉ đọc Supabase qua Chrome, mỗi ~5–10'): 20:33 50.383 → 20:37 134.292 → 20:41 191.671 → 20:52 375.606 → 20:58 477.244 → 21:03 539.036 → 21:08 561.093 (hàng đợi bẩn cạn, worker tự nhặt dòng v3 chậm hơn ~80 dòng/giây) → deploy dọn mã 21:10 làm worker khởi động lại và quét đánh dấu nốt → 21:15 589.276 → 21:19 631.974 → 21:26 711.727 → **21:31:28 xong: 738.650/738.656 dòng v4, hàng đợi 0** (6 dòng còn lại là đơn mới chờ ghi lần đầu). Tổng ~64 phút, nhịp 170–310 dòng/giây (29/10 ước ~40' cho 587k dòng — cùng cỡ).
- **Số đếm 8.6 "sau A" (21:31:42, 60 ngày theo ngày tạo VN, đơn tính doanh thu):** 433.717 đơn, **201.757 đơn cờ thiếu giá vốn**, 118 chủ shop. Kỳ vọng ≈ 196.273 (đo 02/11 trên 409.701 đơn): chênh ~5.500 do cửa sổ 60 ngày trượt 2 ngày + đơn mới về, tỷ lệ cờ 46,5 % so với 55 % trước Lát A — đúng hướng (quà 0 đ không còn gắn cờ). Độ phủ hòa vốn khanhdrop / ledinhhieua / thanhthong chưa mở trang kiểm.
- **Đính chính Disk IO:** trong lúc theo dõi em đọc nhầm nhãn trục biểu đồ ("25 %") thành giá trị và báo anh "61 % → 25 %". Đọc lại bằng ảnh biểu đồ Supabase Infrastructure lúc 21:33: **Disk IO balance = 0 % liên tục từ 28/10 tới nay** (đường đỏ nằm đáy cả tuần, chưa từng hồi — con số "61 %" lúc 20:40 là MEMORY). Tức DB đã chạy ở băng thông đĩa nền suốt tuần, lượt tính lại tối nay không làm nó tụt thêm vì không còn gì để tụt; app vẫn chạy được vì nền gp3 đủ cho tải hiện tại. Biểu đồ CPU tuần: ~40 % → 45 % → 65 % (03–04/11) → ~100 % nấc cuối ngày 04/11 (trùng giờ tính lại sổ). WAL 2,1 → 1,8 GB sau khi xong.
- ⏳ Việc còn: nghiệm thu 8.6 phần số tiền (TORANO 60 ngày, demo tháng 8 đã khớp 37.790.374 ở Tổng quan = Dòng tiền = Doanh thu − Chi phí), độ phủ 3 gian quà 0 đ, OTA mobile, soi giao diện 4 trang; **Disk IO balance 0 % cả tuần là việc riêng** (memory `hubsell-su-co-disk-io-supabase-2026-10-28` mục ⏳) — tìm gốc tiêu IO trước khi nói chuyện nâng gói (feedback 03/11).

## 10. Sau khi đổi: ca Hellokityhh "Lỗ sẵn" (04/11/2026 khuya, kiểm SQL prod, chỉ đọc)

Lát A làm lộ giá vốn sai có sẵn trên dòng quà, không phải lỗi công thức.

**Gốc.** Tin quà `1736978348605802179` được khách đổi thành Kẹo Sâm từ ~02/10 và giữ nguyên sku_id. 2.682 đơn 11/08–01/10 có 4 dòng quà giá 0 đ mang giá vốn Kẹo Sâm (32k + 80k + 128k + 490k = 730k/đơn, ~1,96 tỷ; 60 ngày ~1,09 tỷ). Lá thứ 5 `…895619` không còn trong danh mục nên giá vốn 0.

**Cơ chế.** Trước v4, lá giá vốn 0 bật cờ thiếu giá vốn nên cả đơn đứng ngoài biên lãi. Từ v4, dòng quà 0 đ không bật cờ nữa nên đơn vào biên lãi kèm 730k.

| Biên lãi trước quảng cáo | Luật cũ (v3) | Luật mới (v4) | v4 bỏ giá vốn quà ảo |
|---|---|---|---|
| Product GMV Max | 40,4 % (hòa vốn 2,47, độ phủ 57 %) | −153 % | +42,1 % |
| KẸO SÂM 2 | 29,7 % | 29,7 % | 29,7 % |
| Toàn gian | 39,9 % | −151,7 % | +41,7 % |

**Diện ảnh hưởng của đợt đổi.** 22 gian có đơn lật cờ, 18/183 chiến dịch TikTok đang chạy. Chỉ Hellokityhh sập; chiến dịch kế tiếp lệch tối đa 3 điểm. Chưa đo cấp chiến dịch cho Shopee/Lazada; cấp gian không có ca nặng.

**Cùng triệu chứng, không do đợt đổi (0 đơn lật cờ, chưa xác minh quà thật hay nhập sai).** Vua Trị Côn Trùng (chiến dịch "5 MuoI" −537 %, bỏ quà +34 %) và Tạp Hoá Dép 668 (−79,5 %, bỏ quà +16,8 %).

**Trạng thái.** Chưa vá dữ liệu, chờ anh chốt.

## 11. Hướng sửa giá vốn quà 0 đ: đo phương án trên prod (05/11/2026, SQL chỉ đọc, chưa code)

Phạm vi đo: đơn không hủy 60 ngày. Giá vốn trên dòng quà 0 đ toàn nền tảng ~2,32 tỷ.

**Hai kiểu lỗi, hai nguồn khác nhau**

| Kiểu | Ca | Nguồn | Luật so tên bắt được không |
|---|---|---|---|
| 1. Mã quà đổi thành hàng khác, giữ id lá | Hellokityhh ~1,09 tỷ | Hubsell chép giá hiện tại của lá vào dòng quà cũ | Có |
| 2. Nhập giá quà sai | Vua Trị Côn Trùng: thẻ 686.868 đ, đơn 23–27/10, 1.425 dòng, lá nay 100 đ. Tạp Hoá Dép 668: thẻ 70.000 đ, lá nay vẫn 70.000 đ, chưa hỏi khách | Giá của lá lúc đó sai (Vua Trị đã tự sửa lá; Tạp Hoá chưa rõ) | Không |

**Phép thử cho đề xuất cũ "dòng 0 đ không tự điền giá":** bị bác. 487 lá / 57 gian vừa tặng vừa bán cùng một món, cùng tên, 166,6 tr giá quà thật. Đề xuất này còn không chạm kiểu 2.

**Phép thử so tên, cùng id lá:** tách đúng nhóm đổi hàng.

| Lá vừa là quà vừa bán | Tên quà trùng tên bán | Tên khác |
|---|---|---|
| Hết quà rồi mới bán | 65 lá, 7,7 tr | 13 lá / 5 gian, **1.119,2 tr** |
| Cùng thời gian | 487 lá, 166,6 tr | 15 lá, 1,3 tr |

So tên dòng quà với tên lá hiện tại: khác tên 1.167,5 tr (ngoài Hellokityhh ~50 tr), trùng tên 1.137,1 tr, chỉ đổi phân loại 18,5 tr. Dòng có giá bán KHÔNG áp luật này vì đổi tên hàng bán là chuyện thường.

**Phép thử rào đầu ra "giá vốn quà > doanh thu đơn" (ngưỡng tự chọn theo lý lẽ, chưa có số của sàn):** 2.221 đơn / 11 gian; 3 gian lỗi chiếm 2.197 đơn (99 %). Mô phỏng hòa vốn, loại đơn đó như đơn thiếu giá vốn, 183 chiến dịch TikTok đang chạy:

| Chiến dịch | Biên hiện tại | Biên sau rào | Độ phủ sau rào |
|---|---|---|---|
| Hellokityhh Product GMV Max | −155,6 % | +40,4 % | 56 % |
| Vua Trị Côn Trùng "5 MuoI" | −537,1 % | +33,8 % | 89 % |
| Tạp Hoá Dép 668 Product GMV Max | −79,5 % | +6,2 % | 6 % |

Chỉ 3/183 chiến dịch đổi từ 2 điểm trở lên, chiến dịch kế tiếp đổi 1,9 điểm. Chiến dịch biên âm 12 → 9; 9 còn lại không do giá quà vượt doanh thu. Cả 3 độ phủ dưới 90 % nên sẽ báo chưa đủ căn cứ, không còn "Lỗ sẵn". Chưa mô phỏng Shopee/Lazada; chưa đo tốc độ câu SQL thật.

**Phương án đã bỏ**
- Quay lại Lát A: không sửa tài chính vì Lát B vẫn cộng các đơn đó kèm giá vốn; đơn vẫn đứng ngoài hòa vốn mãi.
- Hòa vốn bỏ hẳn giá quà: giấu giá quà thật.
- Lưu lịch sử giá theo thời gian: không biết giá của giai đoạn trước khi nối gian; không cứu dữ liệu đã có.

**Đề xuất 4 phần (chờ anh chốt).** (1) Vá dữ liệu: Hellokityhh 10.728 dòng về 1 đ, Vua Trị 1.425 dòng về 100 đ, Tạp Hoá hỏi khách trước. (2) Chặn nguồn: dòng giá bán 0 đ mà tên khác tên lá thì không nhận giá tự động, ở mọi đường (tạo đơn 3 sàn, các hàm vá ở lib/cost-price.ts). (3) Cảnh báo lúc nhập, có nút Bỏ qua: mã đang là quà 0 đ mà giá vốn nhập cao. (4) Rào đầu ra cho hòa vốn, không đổi tài chính.
Đơn cũ nhập nhầm về sau vẫn vá tay theo chốt 26/10.

## 12. Đã code 3 lớp chặn (05/11/2026, chưa commit, chưa push; dữ liệu prod chưa vá)

Anh duyệt phương án 3 lớp. Thứ tự làm: lớp 3, lớp 2, lớp 1. Mục 11 là số đo lúc chọn; khác biệt so với mục 11 ghi ở lớp 1.

**Lớp 3, đo trước khi push.** `backend/scripts/sql/ads-margin-impact.sql`: dán vào Supabase SQL Editor, chỉ sửa hai dòng luật cũ/mới, ra biên lãi từng chiến dịch đang chạy theo hai luật. Bắt buộc khi đổi `LEDGER_FORMULA_VERSION`, cờ thiếu giá vốn, cách tính tiền hoặc luật chọn đơn của biên lãi. Đây là kỷ luật quy trình, không có gì tự chặn nếu quên chạy. Chạy thử với luật lớp 2: 453 chiến dịch, 5 đổi từ 2 điểm, 0 từ dương sang âm.

**Lớp 2, không báo lỗ oan.** `giftCostExceedsRevenue` (lib/ads-margin.ts) và CTE `suspect` trong hai câu gom (services/order-ledger.ts): đơn có `Σ giá vốn × số lượng` trên dòng giá bán 0 đ lớn hơn doanh thu đơn thì đứng ngoài biên lãi, kéo độ phủ xuống, đếm riêng `suspectGiftOrders` / `suspectGiftRevenue`. Áp cho cả TikTok, Shopee, Lazada; đơn hủy cùng kiểu cũng ra khỏi mẫu số TikTok. Tài chính không dùng luật này. Màn hình nói đúng lý do thay vì "thiếu giá vốn" (popover hòa vốn TikTok, nhận định, ghi chú + nhãn trang Shopee). Không đổi sổ, không cần tính lại nền.
- Đường SQL = đường duyệt mảng: test `ads-gift-guard-db`, đã đưa trường mới vào `breakeven-compare` và `ads-margin-compare`.
- Tốc độ đo prod: CTE `suspect` ~0,32 giây trên gian nhiều quà nhất (Giống Cây Top, 30.844 dòng quà). Chưa đo cả câu gom sau khi thêm.
- Mobile chưa đổi: API thêm trường, mobile vẫn hiện theo độ phủ, chưa có câu lý do riêng.

**Lớp 1a, không tự gắn giá sai vào quà.** `giftLineMatchesLeaf` + `costAtSaleForLine` + `LINE_MAY_TAKE_LEAF_COST` (lib/cost-price.ts): dòng giá bán 0 đ chỉ nhận giá của lá khi còn là món đó, ở mọi đường: tạo đơn 3 sàn, `backfillOrderLinesByProducts`, `backfillOrderLinesByChannelProducts`, `backfillOwnerCostPrices`, `repairZeroCostLinesForChannel`. Dòng có giá bán giữ nguyên.
- **Khác mục 11:** so cả chuỗi tên chặn nhầm (khách đổi tên sản phẩm giữ phân loại; TikTok ghi "… - Mặc định" cho lá không tên phân loại; "Xanh Than , 40" so với "Xanh Than, 40"). Đổi thành so theo phân loại, sau khi bỏ khoảng trắng: lá có tên phân loại thì dòng phải kết thúc bằng phân loại đó; lá không có thì dòng phải bắt đầu bằng tên sản phẩm.
- Số đo trước khi bỏ khoảng trắng, 60 ngày: chặn đúng 4 lá Hellokityhh 1.118 tr, giữ 5 lá quà 1 đ của gian đó; ngoài gian đó chặn 78 lá / 12,7 tr, giữ 683 lá / 1.192 tr. Số chặn sau khi bỏ khoảng trắng chưa đo lại, chỉ có thể thấp hơn.
- Luật này KHÔNG sửa dòng đã có giá. Dữ liệu sai sẵn vẫn phải vá.
- Đi kèm: "còn dòng chưa có giá vốn" ở nút Áp giá vốn cho đơn cũ không đếm dòng giá bán 0 đ nữa, cùng luật cờ sổ v4.

**Lớp 1b, hỏi lại lúc nhập.** `checkGiftCost` + `POST /api/finance/cost-prices/gift-check` + `components/finance/gift-cost-guard.tsx`: mã TOÀN dòng 0 đ trong 60 ngày mà giá mới làm giá vốn quà vượt doanh thu ít nhất một đơn thì hỏi lại, có Sửa lại / Vẫn lưu; phép kiểm lỗi thì cho lưu. Đã soi thật trên web local (sáng + tối): quà 90.000 đ hỏi lại "12/12 đơn", Sửa lại không lưu, Vẫn lưu lưu và tính lại 24 dòng; hàng bán không hỏi.
- **Mới phủ:** ô giá vốn từng SKU và "Giá vốn chung" trên trang Nhập giá vốn.
- **Chưa phủ:** nhập file Excel, tab Mapping giá vốn, dải áp giá theo ô tìm, popup giá vốn ở bảng Lãi/Lỗ theo SKU, mobile. Các đường này vẫn có lớp 2 đỡ ở trang quảng cáo.
- Tạp Hoá Dép 668 nếu nhập từng thẻ 70.000 đ một sẽ không bị hỏi vì mỗi thẻ thấp hơn doanh thu đơn; nhập chung cả nhóm thì có.

**Test.** Bộ `src/integrations/__tests__`: 23 ca đỏ, đúng 23 ca đó cũng đỏ trên mã gốc chạy song song (DB dev còn dòng bẩn, trigram...), không có ca đỏ mới. Test mới: `ads-gift-guard-db`, `cost-gift-rule-db`, thêm ca trong `ads-margin.test`, `tiktok-breakeven.test`, `cost-per-shop.test`. `tsc` backend + frontend sạch.

**Dữ liệu prod.** Lệnh UPDATE bị bộ phân loại quyền chặn 05/11, chưa dòng nào đổi (đã đọc lại). Sao lưu + cách hoàn tác: `backend/scripts/out/quatang-costprice-backup-2026-11-05.txt` (tệp cục bộ, không vào git).

## 13. Rà lại theo yêu cầu anh (05/11/2026 rạng sáng): thuật toán, mã, phương án khác

**Lớp 2, so lại hai đường cộng bằng mắt.** Thứ tự ưu tiên giống nhau ở cả hai: chưa có kết cục → chờ; thiếu giá vốn → thiếu; quà bất thường → bất thường; hủy cùng lứa → mẫu số; còn lại → tử số. Đơn hủy có quà bất thường ra khỏi mẫu số ở cả hai đường. Phần chưa nối id (`unlinkedRevenue`) cộng cả ba loại đơn đã chốt ở cả hai đường. Khác nhau duy nhất: đường thuần bỏ qua dòng `price > 0`, SQL bỏ qua `lineGross > 0`; dòng giá dương số lượng 0 đóng góp 0 ở cả hai nên không lệch. Cột `multi` 15 cột đúng thứ tự `parts` (test DB có đơn hai dòng có giá xác nhận).

**Lớp 2, ngưỡng.** Đo 60 ngày, đơn không hủy có giá vốn trên dòng quà:

| Luật | Đơn | Gian | Giá vốn quà |
|---|---|---|---|
| A, đang dùng: giá vốn quà > doanh thu đơn | 2.221 | 11 | 2.099 tr |
| B, thêm nếu đổi sang: giá vốn quà > giá vốn hàng bán trong đơn | +285 | 8 | +8 tr |
| C, thêm nếu đổi sang: giá vốn quà > 50 % doanh thu đơn | +33 | 6 | +4 tr |

A bắt 99,4 % tiền quà bất thường. B và C bắt thêm rất ít nhưng dễ bắt oan (mua 1 tặng 1, quà bằng giá hàng). Giữ A.

**Lớp 1a, luật so tên.** Đổi thêm: không phân biệt hoa thường (JS `toLowerCase`, SQL `lower`). Đo lại 60 ngày với luật cuối: chặn đúng 4 lá Hellokityhh 1.118 tr; ngoài gian đó chặn 42 lá / 15 gian / 7,9 tr, giữ 719 lá / 64 gian / 1.197 tr (mục 12 ghi 78 lá / 12,7 tr là số trước khi bỏ khoảng trắng và hoa thường).

**Đường gắn giá còn lại.** `routes/webhooks.ts /mock-order` (đơn giả lập GĐ1, không phải sàn thật) và `workers/reviewer-demo-topup.ts` (gian demo reviewer) vẫn chụp giá kho thẳng: không đụng vì không có đơn khách thật.

**Câu chữ.** Lý do "chưa tính" của TikTok nay nói cả hai phần (đơn nghi sai giá quà + phần thiếu giá vốn / chưa nối id) thay vì chỉ một; popover hòa vốn hiện cả dòng nghi sai giá quà lẫn dòng độ phủ. Nhãn Shopee "Nghi sai giá vốn quà" chỉ khi số đơn nghi ≥ số đơn thiếu giá vốn.

**Chưa làm được trong lượt rà.** Chưa đo thời gian cả câu gom TikTok sau khi thêm CTE trên gian lớn (chỉ đo CTE riêng 0,32 giây). Mobile để sau theo anh.

## 14. Tạp Hoá Dép 668: hòa vốn 26,35 do 3 thẻ tặng kèm mang giá vốn 70.000 đ (05/11/2026 ~09:57, ĐÃ VÁ dữ liệu, không đổi mã)

**Triệu chứng (ảnh anh).** Trợ lý quảng cáo TikTok của gian `cmvv5k27y01zxlq3pnoneq6wd` (phamgiathang30101987@gmail.com, nối 30/10): cột Hòa vốn 26,35 ở hầu hết 45 chiến dịch, một chiến dịch 18,78. Khách yêu cầu sửa.

**Gốc.** Tin quà SPU `1736418802480350665` "Thẻ cảm ơn Dép Lê…" có 3 phân loại (Thẻ hướng dẫn sử dụng, Thẻ hướng dẫn chọn size, Thẻ cảm ơn), TikTok gắn cả 3 vào mỗi đơn với giá bán 0 đ. Ba lá này mang giá vốn 70.000 đ, bằng giá vốn của 483 lá dép / 14 sản phẩm trong gian (nghi nhập giá hàng loạt, chưa kiểm đường nhập). Mỗi đơn gánh 210.000 đ giá vốn ảo: 1.173 đơn 01/08–31/10, 3.519 dòng, 246,33 tr. Ví dụ đơn `586880374352610829`: dép 146.280 đ giá vốn 70.000 đ + 3 thẻ, doanh thu 159.000 đ, lợi nhuận −167.837 đ.

**Vì sao ra 26,35 dù đã có lớp 2.** Lớp 2 gạt 380 đơn đã đối soát + 121 đơn hủy (giá vốn quà > doanh thu đơn). Còn lại 22 đơn đã đối soát + 7 đơn hủy = 7 % doanh thu, trong đó 4 đơn mua nhiều đôi (doanh thu > 210.000 đ) vẫn mang giá vốn thẻ → biên 3,80 %, hòa vốn 26,35. Chiến dịch 18,78 là chiến dịch đủ đơn riêng. Luật tự động không dùng số này (độ phủ < 90 %) và cột Nhận định đã ghi "Chưa kết luận được"; riêng ô Hòa vốn vẫn hiện số màu xanh.

**Sửa (anh chốt: khách đã xóa hộp carton và thẻ quà, coi là 0 đ).** Supabase SQL Editor, hai UPDATE thuần: `ChannelProduct.costPrice` 3 lá 70.000 → 0 (phải sửa cả lá, nếu không lượt vá dòng 0 sẽ ghi lại 70.000 vì tên dòng trùng tên lá); `OrderItem.costPriceAtSale` 3.519 dòng 70.000 → 0. Hộp carton (12 dòng, giá bán 5.000 đ, giá vốn 3.000 đ) không đụng: dòng có giá bán, về 0 sẽ bật cờ thiếu giá vốn ở hòa vốn quảng cáo.

| Sổ cái gian (từ 06/09) | Trước | Sau |
|---|---|---|
| Lợi nhuận | −66,31 tr | +15,14 tr |
| Đơn lỗ | 410 / 566 | 39 / 566 |
| Hòa vốn toàn gian (luật đang chạy) | 26,35, độ phủ 7 % | **5,97**, độ phủ 100 %, 0 đơn nghi |
| Lợi nhuận toàn bộ sổ | −149,91 tr | +39,57 tr |

Chiến dịch có đơn riêng (Product GMV Max đang tạm dừng, mục tiêu 5,4): 382 đơn đã đối soát, biên 16,7 %, hòa vốn 5,97. Sổ tự tính lại, dirty 0. Màn khách đổi sau tối đa 30 phút (đệm RAM). Sao lưu + hoàn tác: `backend/scripts/out/tapdep668-costprice-backup-2026-11-05.txt` (tệp cục bộ).

**Kẽ còn lại của lớp 2 (chưa sửa, chờ anh chốt).** Đơn có giá vốn quà sai nhưng thấp hơn doanh thu đơn vẫn vào biên lãi; khi phần lớn đơn bị gạt, số còn lại vừa ít vừa lệch.

**Đính chính (anh nhắc "nhãn đó mình có rồi").** Màn TikTok ĐÃ có nhãn khi độ phủ < 90 %: cột Nhận định ghi "Chưa kết luận được" kèm lý do (campaign-advice `no_breakeven`, chỉ với chiến dịch có tiêu tiền trong kỳ; chiến dịch tạm dừng / chưa tiêu hiện "—"), tab Hòa vốn sản phẩm ghi "Thiếu giá vốn", popover ô Hòa vốn nêu độ phủ. Phần còn lệch nhau trong cùng một dòng: ô Hòa vốn vẫn màu xanh, ô ROI thực vẫn tô đỏ "Dưới ROI hòa vốn", ô Lãi/lỗ ước tính vẫn nhân biên lãi đó, cả ba không xét độ phủ (`tiktok-ads-page.tsx`, `tiktok-breakeven.tsx`). Chưa sửa.

**Anh hỏi lại "hòa vốn đã bỏ đơn hủy rồi mà?" (05/11).** Luật từ 18/09 (commit `1f2e5675`, ADS-TIKTOK-GMV-MAX mục 8): LỢI NHUẬN chỉ lấy đơn đã đối soát (giao thành công + hoàn xong) đúng như anh chốt; đơn hủy cùng lứa góp 0 đ lãi nhưng doanh thu vẫn nằm trong MẪU SỐ, vì ROI của TikTok chia trên doanh thu đơn ĐẶT. Điểm thứ hai là giả định của em, không có ghi nhận anh chốt riêng. Đo thêm trên gian này (29 ngày có số quảng cáo, 28/09–03/11): TikTok ghi 183 đơn / 29,83 tr; Hubsell mọi đơn đặt 198 đơn / 31,50 tr (TikTok = 94,7 %); Hubsell bỏ đơn hủy 148 đơn / 23,50 tr (TikTok = 126,9 %). TikTok không rút đơn hủy khỏi doanh thu GMV Max → giả định đứng được ở gian thứ hai (gian đầu and.not.or 18/10). Nếu bỏ đơn hủy khỏi mẫu số, hòa vốn gian này ra 4,52 thay vì 5,97; khách đặt ROI theo 4,52 trên số của TikTok sẽ lỗ. **Anh chốt 05/11: GIỮ NGUYÊN đơn hủy trong mẫu số.** Không đổi mã. Kiểm lại 10:12: 3 lá 0 đ, 3.519 dòng 0 đ, dirty 0.

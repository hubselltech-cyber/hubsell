# Trợ lý quảng cáo Shopee — khảo sát đủ 26 endpoint Ads API và lộ trình khai thác

Viết 17/09/2026, ngay sau khi app **Hubsell Ads** (Ads Service, partner riêng)
được Shopee duyệt Go-Live. Nguồn: đọc TRỰC TIẾP từng trang docs
`open.shopee.com/documents/v2/v2.ads.*` (không đoán endpoint), đối chiếu với
code đang chạy production. Góc nhìn: thiết kế như senior + tính toán như người
chạy ads chuyên nghiệp — chỉ đề xuất việc đổi ra tiền cho seller, có số call
cụ thể.

Trạng thái (chốt cuối phiên 17/09/2026): **ĐỢT A + ĐỢT D ĐÃ LÊN PRODUCTION**; đợt B, C và các
việc treo của D **GÁC LẠI** theo chốt của anh Trung ("khách yêu cầu thì làm thêm sau") — danh sách đầy
đủ ở **mục 7**. Bản gốc tham mưu giữ nguyên bên dưới làm căn cứ.

---

## 1. Bản đồ 26 endpoint nhóm Ads — dùng / chưa dùng

| # | Endpoint | Loại | Hubsell | Ghi chú nghiệp vụ |
|---|---|---|---|---|
| 1 | `get_total_balance` | đọc | ✅ xung 30' → ví ads DB | |
| 2 | `get_shop_toggle_info` | đọc | ❌ | trả `auto_top_up` (ví tự nạp) + `campaign_surge` (bật/tắt) — 1 call/gian |
| 3 | `get_recommended_keyword_list` | đọc | ❌ | theo `item_id`: từ khóa Shopee gợi ý kèm `search_volume` 30 ngày, `quality_score`, `suggested_bid` |
| 4 | `get_recommended_item_list` | đọc | ❌ | SKU Shopee gắn tag best selling / best ROI / top search + `ongoing_ad_type_list` (đang chạy search/discovery/boost) |
| 5 | `get_all_cpc_ads_hourly_performance` | đọc | ❌ | cấp shop, 1 ngày, theo giờ |
| 6 | `get_all_cpc_ads_daily_performance` | đọc | ✅ AdSpend | tối đa 1 tháng/call, lùi 6 tháng |
| 7 | `create_auto_product_ads` | ghi | ❌ | **sắp offline** — bỏ qua |
| 8 | `edit_auto_product_ads` | ghi | ❌ | **sắp offline** — bỏ qua |
| 9 | `get_product_campaign_daily_performance` | đọc | ✅ | ≤100 campaign/call |
| 10 | `get_product_campaign_hourly_performance` | đọc | ❌ (client đã bọc) | ≤100 campaign, 1 ngày, đủ expense/order/gmv từng giờ |
| 11 | `get_product_level_campaign_id_list` | đọc | ✅ | |
| 12 | `get_product_level_campaign_setting_info` | đọc | ✅ info_type 1,3 | **chưa lấy info_type 2** = `manual_bidding_info`: từ khóa đã chọn (keyword, match_type, bid, status), enhanced_cpc, vị trí discovery + bid; info_type 4 = SP trong auto ads kèm trạng thái learning/ongoing |
| 13 | `create_manual_product_ads` | ghi | ❌ | tạo campaign 1 SP: budget, ngày, auto/manual bidding, roas_target, từ khóa + bid, vị trí discovery |
| 14 | `edit_manual_product_ad_keywords` | ghi | ❌ | add / delete / restore / change_bid_price / change_match_type từng từ khóa |
| 15 | `edit_manual_product_ads` | ghi | ✅ pause/resume | enum đầy đủ: start, pause, resume, stop, delete, **change_budget**, change_duration, change_smart_creative, change_location, change_enhanced_cpc, **change_roas_target** |
| 16 | `get_create_product_ad_budget_suggestion` | đọc | ❌ | ngân sách gợi ý min/recommended/max cho cấu hình định tạo |
| 17 | `get_product_recommended_roi_target` | đọc | ❌ | ROAS mục tiêu Shopee gợi ý theo SP: lower (percentile 80) / exact (50) / upper (20) |
| 18 | `get_ads_fácil_shop_rate` | đọc | ❌ | chỉ Brazil |
| 19 | `check_create_gms_product_campaign_eligibility` | đọc | ❌ | shop có được tạo **GMS = GMV Max cấp shop** không (whitelist, đủ SKU, 1 GMS active/shop) |
| 20 | `create_gms_product_campaign` | ghi | ❌ | daily_budget + roas_target (0 = Auto Bidding, >0 = Custom ROAS) |
| 21 | `edit_gms_product_campaign` | ghi | ❌ | change_budget / change_duration / pause / resume / start / change_roas_target |
| 22 | `list_gms_user_deleted_item` | đọc | ❌ | SP seller đã loại khỏi GMS |
| 23 | `edit_gms_item_product_campaign` | ghi | ❌ | thêm/loại SP khỏi GMS |
| 24 | `get_gms_campaign_performance` | đọc | ❌ | hiệu suất GMS theo khoảng ngày (không theo ngày lẻ) |
| 25 | `get_gms_item_performance` | đọc | ❌ | hiệu suất **từng SP** trong GMS, phân trang 100 |
| 26 | (AMS/affiliate là module riêng, không thuộc Ads) | | | |

**Không tồn tại** (đừng tìm nữa): hiệu suất theo TỪ KHÓA (Lazada có, Shopee
không), lịch chạy theo giờ (dayparting), API đọc lịch sử thao tác.

Kết luận đọc docs: mọi endpoint ads đều ghi "APP types: Seller In House,
Marketing, Ads Service…" — app Hubsell Ads gọi được hết, không cần xin thêm.

---

## 2. Nhìn từ người chạy ads: 4 câu hỏi seller trả tiền để được trả lời

| Câu hỏi | Hubsell hôm nay | Thiếu gì |
|---|---|---|
| Tôi đang lỗ hay lãi ở campaign nào? | ✅ ROAS hòa vốn từng campaign/SP từ P&L thật | — |
| Cái nào đang cắn tiền, ai tắt giúp tôi? | ✅ 4 quy tắc + tự dừng/bật lại + sổ | chỉ có **tắt hẳn**, chưa có nấc **hạ ngân sách** (người chạy ads chuyên nghiệp tránh tắt vì mất học máy + thứ hạng) |
| Tôi đặt ROAS mục tiêu / ngân sách bao nhiêu là đúng? | ✅ bảng hòa vốn SP → seller tự mang sang Seller Center | campaign auto-bidding đang đặt **roas_target THẤP HƠN hòa vốn** thì Shopee sẽ tối ưu đúng về mức lỗ — Hubsell đã có cả 2 số trong DB mà chưa so |
| Nên chạy ads SP nào tiếp? | ✅ bảng hòa vốn phủ cả SP chưa chạy | chưa có góc nhìn của Shopee (tag best ROI / top search, SP chưa chạy ads) |

---

## 3. Lộ trình đề xuất — 4 đợt, xếp theo tiền/công

### Đợt A (1 buổi, KHÔNG call mới, không SQL) — "Mục tiêu ROAS đang lỗ"

> **17/09 trưa — ĐÃ CODE trên local, anh Trung xem trước khi push.** Hàm thuần
> `assessRoasTarget` (ads-assistant-rules.ts: below / tight / ok, safeTarget = hòa
> vốn × dangerFactor làm tròn LÊN 0,1) gắn vào `CampaignInsight.roasTargetCheck` và
> `ProductBreakevenRow.roasTargetCheck` (mục tiêu THẤP NHẤT trên campaign chạy có SP).
> UI: cột **Mục tiêu** (đỏ/vàng) cạnh Hòa vốn, dải vàng "N chiến dịch đặt mục tiêu
> dưới hòa vốn", khối đỏ trong modal + nút **Nâng lên X**, cột **Đang đặt** ở tab hòa
> vốn SP. Lệnh: `POST /api/ads/shopee/campaigns/:id/roas-target` →
> `setRoasTargetByOwner` (edit_manual_product_ads `change_roas_target`, sổ mode
> manual, chỉ campaign biddingMethod auto). ⚠️ `change_roas_target` CHƯA probe sống —
> lần bấm đầu trên campaign thật là lần xác minh; lỗi sàn ghi nguyên văn vào sổ.
> Tự thực thi (executor) cho việc này chưa làm — chờ probe OK + anh chốt.

- **Luật Q5 — ROAS mục tiêu dưới hòa vốn**: campaign `biddingMethod = auto` có
  `roasTarget` > 0 và `roasTarget < breakeven × dangerFactor` → badge vàng riêng
  "Mục tiêu đang lỗ" + căn cứ: "Shopee được lệnh tối ưu về ROAS 4x, hòa vốn của
  SP là 6,6x → mỗi đồng ads sẽ về đúng mức lỗ". Đây KHÔNG phải ngưỡng tay (bài
  học 10/08) mà là so **số seller đã đặt trên sàn** với **hòa vốn thật**.
- Hành động đề xuất: "Nâng mục tiêu lên X" với X = max(hòa vốn × dangerFactor,
  làm tròn 0,1). Tự thực thi (khi bật live): `edit_manual_product_ads`
  edit_action `change_roas_target` — enum có trong docs, cần **probe 1 lần**
  trên campaign test như đã làm với pause/resume.
- Cột "Mục tiêu (sàn)" cạnh "Hòa vốn" trong bảng campaign; bảng hòa vốn SP
  thêm cột "Đang đặt" cho SP có campaign auto.
- Chi phí: 0 call thêm (roasTarget đã sync mỗi 30').

### Đợt B (1–2 buổi) — "Hạ ngân sách trước, tắt sau" + ví tự nạp

- **Nấc hành động mới `cut_budget`** trong executor: verdict `review` (vùng
  vàng) hoặc `pause_now` cửa sổ 3d lần đầu → giảm `budget` về max(50% hiện
  tại, chi tiêu TB ngày × 0,7, sàn tối thiểu Shopee); lần sau vẫn lỗ → pause.
  Người chạy ads gọi đây là "bleed control": giữ campaign sống để không mất
  learning, nhưng khóa trần tiền mất. Campaign `budget = 0` (không giới hạn)
  mà ROAS dưới hòa vốn → **luôn** đặt trần trước khi làm gì khác.
  Gọi `change_budget` (docs có, cần probe). Cờ Hubsell mở rộng: ghi ngân sách
  gốc để "bật lại" trả đúng số cũ.
- **`get_shop_toggle_info` trong xung** (1 call/gian/30'): `auto_top_up = false`
  + ví < 24h → thẻ ví cạn nâng lên **high** kèm câu "ví KHÔNG tự nạp — quảng
  cáo sẽ ngừng hiển thị"; `auto_top_up = true` → hạ xuống medium (Shopee tự
  nạp, chỉ cần biết). Cắt được cảnh báo giả cho shop đã bật tự nạp.
- Chi phí: +1 call/xung → Shopee 5 → 6 call/xung, 240 call/gian/ngày (vẫn xa
  trần ước tính, xem ADS-NHIP-CANH-BAO.md mục 4).

### Đợt C (2 buổi) — Từ khóa: đọc được gì thì hiện, gợi ý có số

- `setting_info` thêm **info_type 2**: modal campaign manual hiện bảng từ khóa
  đã chọn (từ khóa, khớp chính xác/rộng, bid, trạng thái) — như Lazada, nhưng
  **không có hiệu suất từng từ khóa** (Shopee không cung cấp) → ghi rõ trên UI,
  đừng để seller tưởng có.
- Nút "Từ khóa Shopee gợi ý" trong modal (`get_recommended_keyword_list` theo
  item, gọi khi bấm, cache 24h): bảng search_volume / quality_score /
  suggested_bid, đánh dấu từ khóa **chưa có trong campaign** + từ khóa đang
  đặt bid **cao hơn suggested_bid > 30%** (đang trả giá hớ).
- Ghi (`edit_manual_product_ad_keywords`) để đợt sau — chỉ khi có seller thật
  dùng bảng đọc; tránh xây nút không ai bấm.
- Chi phí: info_type 2 = 0 call thêm; gợi ý từ khóa = 1 call/campaign khi mở.

### Đợt D (3+ buổi, sau thương mại) — Tạo campaign từ Hubsell + GMS

- **Tạo campaign 1 SP từ bảng hòa vốn**: SP có biên tốt + chưa chạy ads →
  nút "Chạy ads SP này": `get_product_recommended_roi_target` +
  `get_create_product_ad_budget_suggestion` → form 3 ô đã điền sẵn (ngân
  sách gợi ý, ROAS mục tiêu = max(hòa vốn × 1,2; Shopee lower_bound)) →
  `create_manual_product_ads` bidding auto. Một nút, số đã tính — đúng triết
  lý "khách cần đơn giản".
- `get_recommended_item_list` (1 call/gian/ngày) → cột "Shopee gợi ý" (best
  ROI / top search) + "Đang chạy?" trên bảng hòa vốn SP → danh sách "nên chạy
  ngay" = tag tốt ∧ biên cao ∧ chưa chạy.
- **GMS (GMV Max cấp shop)**: probe `check_create_gms_product_campaign_eligibility`
  trên 3 shop nhà trước — nếu shop có GMS thì chi tiêu GMS hiện đang **không
  vào bảng campaign** (chỉ có trong số cấp shop `AdSpend`) → seller thấy tổng
  chi lớn hơn tổng campaign mà không biết vì sao. Cần đọc
  `get_gms_campaign_performance` + `get_gms_item_performance` thành một dòng
  campaign đặc biệt "GMV Max shop" + bảng SP bên trong; hành động
  pause/change_budget/change_roas_target qua `edit_gms_product_campaign`.

### Không làm (có lý do)

- Hourly performance cho luật spike: luật spike hiện so tổng ngày và mới đo
  được 1 sự cố (14/09) là do cửa sổ today, không phải do thiếu số giờ. Chỉ
  bật khi đo lag thấy số ngày trễ hơn số giờ (ADS-NHIP-CANH-BAO.md mục 6).
- Auto product ads create/edit: Shopee ghi "coming offline soon".
- Tự động sửa từ khóa: không có hiệu suất từng từ khóa thì máy không có căn
  cứ để bỏ/giảm bid — chỉ người nhìn Seller Center mới quyết được.

---

## 4. Ngân sách call sau đủ 4 đợt (gian ≤100 campaign)

| Nhịp | Hôm nay | Sau đợt A–D | Ghi chú |
|---|---|---|---|
| Xung 30' | 5 | 6 (+toggle_info) | 288 call/gian/ngày |
| Lịch sử 6h | 2 | 2 | |
| Theo ngày | 0 | 1 (recommended_item_list) | |
| Khi mở modal | 0 | ≤1 (recommended_keyword_list, cache 24h) | không tính vào nền |
| Ghi | ≤5/ngày (pause/resume) | ≤5/ngày gộp cả cut_budget / roas_target | trần `maxActionsPerDay` giữ nguyên |

Tổng nền ≈ 300 call/gian/ngày → 1.000 gian chạy ads ≈ 3,5 call/s, đúng trần
token bucket `ADS_APP_QPS = 3` hiện tại → khi qua 800 gian chạy ads phải có số
trần thật từ Shopee (ticket 2098790879624904785 đang chờ vòng 2).

---

## 5. Việc vận hành ngay hôm nay (app đã Live) — checklist

1. Console → App List → Hubsell Ads → lấy **Live Partner ID / Partner Key**.
2. Render (service backend) → Environment: đặt `HUBSELL_ADS_PARTNER_ID`,
   `HUBSELL_ADS_PARTNER_KEY`; **xóa** `HUBSELL_ADS_ENV` (theo `SHOPEE_ENV=production`);
   `HUBSELL_ADS_REDIRECT_URI` để trống (mặc định
   `https://hubsell-backend-sg.onrender.com/api/auth/hubsell-ads/callback`, đúng
   domain đã khai Go-Live). Save → Render deploy lại.
3. Từ lúc env có: worker **bỏ qua** xung ads của mọi gian Shopee chưa nối (log
   một dòng/gian); trang Trợ lý hiện thẻ "Kết nối Hubsell Ads"; Trung tâm điều
   hành + chuông có thẻ cho gian **đang chạy ads** (17/09, `ads-app-not-linked`).
4. 3 shop nhà: mở /ads/shopee, chọn gian, bấm **Kết nối Hubsell Ads**, đăng
   nhập đúng tài khoản gian đó → Đồng ý → về trang, toast "Đã kết nối". Worker
   nhặt trong ≤20s → xung ngay, lịch sử 30 ngày lượt kế.
5. Kiểm: log Render `[Ads-pulse]` gian đó, thẻ Trung tâm điều hành tự đóng,
   ví ads hiện số. Xong 3 shop thì tắt sandbox local (`backend/.env`
   HUBSELL_ADS_* sandbox giữ cho dev, không ảnh hưởng prod).

---

## 6. Đợt D — mô hình gợi ý "SP nào nên chạy ads, đặt thế nào" (bản tham mưu 17/09, anh Trung chọn làm D trước)

Nguyên lý người chạy ads: **ROAS = giá trị đơn × tỉ lệ chuyển đổi ÷ giá mỗi click**, còn
**lãi = ROAS × biên lãi − 1**. CTR KHÔNG nằm trong công thức lãi — nó chỉ quyết định lượng hiển thị
và điểm chất lượng, là chỉ số CHẨN ĐOÁN sau khi chạy (ảnh bìa/tiêu đề), không phải tiêu chí chọn SP
(SP chưa chạy thì chưa có CTR; CTR tự nhiên API không cấp).

**Nguồn số đã xác minh docs:** biên lãi/hòa vốn (P&L Hubsell) · tồn kho + tốc độ bán (Hubsell) ·
`product.get_item_extra_info` (app chính, 50 SP/call: sale, views, likes, rating_star, comment_count)
· `ads.get_recommended_item_list` (tag best selling/best ROI/top search, trạng thái đủ điều kiện,
loại ads đang chạy) · `ads.get_product_recommended_roi_target` (lower p80 / exact p50 / upper p20 —
dải ROAS của quảng cáo tương tự trên sàn) · `ads.get_create_product_ad_budget_suggestion` ·
`ads.get_recommended_keyword_list` (search_volume 30 ngày, quality_score, suggested_bid) · lịch sử
campaign 1-SP của chính item trong AdsCampaignDailyPerf.

### Tầng 1 — CỔNG LOẠI (trượt một cổng = không gợi ý, nói rõ vì sao + việc cần làm trước)
1. **Hòa vốn khả thi so với thị trường:** hòa vốn × hệ số an toàn > `upper_bound` của Shopee → mức
   ROAS cần có cao hơn cả nhóm 20% khắt khe nhất trên sàn → "chưa chạy được có lãi, xem lại giá/giá vốn".
2. **Biên lãi tin được:** có giá vốn, ≥ 5 đơn P&L 30 ngày (không thì dùng biên shop + gắn cờ).
3. **Tồn kho:** đủ ≥ 14 ngày bán ở tốc độ hiện tại × 1,5 (ads đẩy lượng; hết hàng giữa chừng mất thứ hạng).
4. **Sàn cho phép:** item không bị khóa/hết hàng, chưa chạy loại ads tương ứng.
5. **Bằng chứng xã hội:** ≥ 10 đánh giá và ≥ 4,5 sao; SP mới → "gom đánh giá trước" (click đắt mà không ai dám mua).

### Tầng 2 — ĐIỂM XẾP HẠNG (SP qua cổng; hiện thành 3 mức Nên chạy ngay / Thử nhỏ / Chưa nên, kèm lý do)
| Yếu tố | Cách đo | Vai trò |
|---|---|---|
| **Dư địa lãi** | ROAS thị trường (`exact`) ÷ hòa vốn của SP | trọng số lớn nhất — trả lời thẳng "chạy có lãi không" bằng số của sàn, không bằng hằng số tự chế |
| **Sức chuyển đổi tự nhiên** | sale ÷ views, SO VỚI TRUNG VỊ CỦA CHÍNH SHOP | SP tự nó bán được thì click ads mới ra đơn; chỉ dùng tương đối (views trọn đời nhiễu với SP lâu năm) |
| **Cầu** | tổng search_volume top từ khóa gợi ý + tag top search | trần lưu lượng — cầu thấp thì ROAS đẹp cũng không ra tiền |
| **Giá click chịu được** | suggested_bid trung bình so với giá bán × biên lãi × CVR tương đối | click đắt hơn mức SP gánh nổi → hạ hạng |
| **Đà bán** | tốc độ 7 ngày so với 30 ngày | đang lên thì ads khuếch đại, đang rơi thì ads không cứu |
| **Lịch sử ads của chính SP** | ROAS 30 ngày của campaign 1-SP cũ vs hòa vốn | bằng chứng mạnh nhất — ĐÈ mọi ước tính ở trên |

### Tầng 3 — CẤU HÌNH ĐỀ XUẤT (form một nút)
- Đấu thầu **tự động theo ROAS mục tiêu** (seller nhỏ không quản từ khóa; lợi thế của Hubsell là biết đúng mục tiêu).
- 3 mức mục tiêu: **Đẩy số** = hòa vốn × hệ số an toàn · **Cân bằng** = giữa mức an toàn và `exact` (mặc định) ·
  **Giữ lãi** = `exact`. Không bao giờ dưới mức an toàn.
- Ngân sách ngày = gợi ý của Shopee, CHẶN TRẦN bởi (a) tiền thử tối đa 7 ngày ≤ 10% lãi 30 ngày của SP,
  (b) lượng hàng còn trong kho; không thấp hơn `min_budget` của sàn.
- Tạo xong: Trợ lý gác bằng luật hiện có (ngưỡng tiền, dưới hòa vốn, tự dừng/bật lại).

### Code chờ cho B/C
- C: phần ĐỌC `get_recommended_keyword_list` được kéo vào D làm đầu vào (cầu + giá click); phần hiện/sửa từ khóa vẫn gác.
- B: đứng độc lập, không cần code giữ chỗ. Chỗ chờ DUY NHẤT nên làm ngay trong D: campaign tạo từ Hubsell ghi
  nguồn tạo + ảnh chụp đề xuất lúc tạo (mục tiêu, ngân sách, điểm) → B biết ngân sách gốc, và có dữ liệu chấm
  "gợi ý đúng/sai" như bảng điểm diễn tập.

### Chi phí call
Nền: `recommended_item_list` 1 call/gian/ngày + `item_extra_info` 1 call/50 SP/ngày (app chính). Khi seller mở
thẻ một SP: ROI target + budget suggestion + keyword list = 3 call, cache 24h. Tạo campaign: 1 call ghi.

### Bước 0 trước khi code
Probe ĐỌC trên gian ANO (đã nối Hubsell Ads 17/09): `recommended_item_list`, và với 3 SP bán chạy:
ROI target + budget suggestion + keyword list → xem dải số thật (đặc biệt dải ROAS so với hòa vốn thật của ANO)
rồi mới chốt ngưỡng cổng và trọng số.

### Trạng thái code đợt D (17/09 chiều — local, chờ anh Trung chốt push)
- **Khung + bộ chấm:** `ads-recommend.ts` (thuần, 13 test) · `ads-recommend-data.ts` (gom DB + lệnh tạo) · tab
  `ads-recommend-tab.tsx` (4 ô lọc, bảng stickyHeader, hộp thoại Điều kiện / Chấm điểm / 3 mức mục tiêu + ngân sách +
  MỘT nút). Bảng mới `ads_item_signals` + 2 cột `AdsCampaign.createdByHubsellAt/hubsellProposal`
  (migration `20260917140000_ads_item_signals`, Render tự `migrate deploy`).
- **Pha 2 — số thật của sàn:** `ads-item-signals.ts`: lượt NỀN 1 lần/ngày/gian ăn theo lượt lịch sử ads của worker
  (`adsItemSignalsDue`), gồm extra_info (app chính, 50 SP/call) + recommended_item_list + 3 call/SP cho TOP 30 ứng
  viên (biên lãi dương, chưa chạy ads, doanh thu lớn nhất). Nút **"Lấy / Cập nhật số của sàn"** trên tab
  (`POST recommendations/sync`, chạy nền, FE hỏi lại 10s/lần, chống bấm dồn 10'). Mở hộp thoại một SP chưa có dải
  ROAS → tự lấy riêng SP đó (`POST recommendations/refresh-item`, 3 call) rồi chấm lại.
- **Bước 0 — probe đọc thuần** (sau khi lên prod, đăng nhập app rồi mở URL này trên trình duyệt):
  `GET /api/ads/shopee/recommendations/probe?channelId=<gian ANO>&itemId=<item_id SP bán chạy>` → in nguyên văn 5
  endpoint. Việc cần soi: shape thật của `recommended_item_list` (mảng hay bọc `item_list`), giá trị thật của
  `item_status_list`, dải ROI so với hòa vốn thật của ANO, đơn vị `suggested_bid`/`budget` (₫). Chốt xong mới tin
  ngưỡng cổng "khả thi" và trọng số "dư địa".
- **CHƯA xác minh sống:** `create_manual_product_ads` (lần bấm Tạo chiến dịch đầu tiên trên gian thật), 5 endpoint
  đọc ở trên (probe), enum `item_status_list`.

### Kết quả probe thật trên ANO (17/09 ~12h20, prod) — đã chỉnh code theo
- `get_item_extra_info`: OK. **`views` KHÔNG phải trọn đời** (SP 870 lượt bán trọn đời mà views 2.464) → tỉ lệ chuyển
  đổi tự nhiên = số bán 30 ngày của Hubsell ÷ views; trên ANO ra 1,9–5,6% (hợp lý).
- `get_product_recommended_roi_target`: OK, vd lower 6,8 / exact 9,8 / upper 11,8; 30 ứng viên ANO đều quanh 6–11x.
- `get_create_product_ad_budget_suggestion`: đơn vị ₫; **min_budget = 100.000₫/ngày**, recommended ~249k,
  `max_budget = 9999999999` = không giới hạn (bỏ). Mức tối thiểu 100k thường cao hơn "mức thử an toàn" của SP nhỏ →
  ghi chú ngân sách nói thẳng điều đó.
- `get_recommended_item_list`: mảng phẳng, ANO 27 SP; `item_status_list` thấy "normal";
  `ongoing_ad_type_list` thật là `"product_ads"` | `"no_ongoing_promotion"` (gạch dưới — bản đầu lọc sai, đã sửa);
  `sku_tag_list` rỗng ở mẫu.
- `get_recommended_keyword_list`: **trả 0 từ khóa** cho mọi SP ANO đã thử (không kèm `input_keyword`) → yếu tố Cầu và
  Giá click đang ở mức trung tính. Việc treo: thử gọi kèm `input_keyword` = vài chữ đầu tên SP.
- **Thực tế ANO:** 65/67 SP đang bán thiếu giá vốn → cả bảng "Chưa nên" với lý do "Nhập giá vốn" (đúng: hòa vốn 1,6–1,8x
  là ảo). Thêm dải vàng "N sản phẩm đang bán chưa có giá vốn" + nút sang /finance/cost-prices. Thiếu giá vốn xét theo
  chính dòng hàng của SP (>20% lượng bán), không theo cờ cấp đơn.

---

## 7. VIỆC GÁC LẠI — làm khi khách yêu cầu (chốt 17/09/2026)

Mỗi việc ghi đủ: làm gì · đã có gì sẵn · bước đầu tiên khi mở lại.

### Từ đợt D (Gợi ý chạy ads) — đã live, còn treo
1. **Lệnh tạo chiến dịch chưa bắn sống.** `createCampaignFromRecommendation` →
   `create_manual_product_ads` viết theo docs. Bước đầu: nhập giá vốn cho 1 SP ANO bán chạy để qua cổng →
   bấm "Tạo chiến dịch" với ngân sách tối thiểu 100k → soi Sổ hành động + Seller Center → dừng campaign test.
2. **Từ khóa gợi ý trả rỗng** cho mọi SP ANO (gọi không kèm `input_keyword`) → yếu tố Cầu + Giá click đang
   chấm trung tính. Bước đầu: probe lại với `input_keyword` = 2–3 chữ đầu tên SP; có số thì nối vào
   `syncAdsItemProposal`.
3. **Rút gọn giao diện cho seller nhỏ** (đã trình, anh chốt "như hiện tại ok"): bảng 4 cột, ẩn mặc định 5 cột
   số, "Chưa nên" gom sau ô đếm, hộp thoại gấp Điều kiện/Chấm điểm sau "Xem căn cứ". Làm khi khách kêu rối.
4. **Chấm lại gợi ý đúng/sai:** `AdsCampaign.createdByHubsellAt + hubsellProposal` đã ghi sẵn lúc tạo —
   chưa có màn hình so "đề xuất lúc tạo" với "kết quả 14 ngày sau".
5. **DarkMan chưa nối Hubsell Ads** (việc của anh, 1 phút trên trang Trợ lý quảng cáo).

### Từ đợt A (Mục tiêu ROAS đang lỗ) — đã live, còn treo
6. **`change_roas_target` chưa bắn sống.** Nút "Nâng lên X" gọi lệnh thật; lần bấm đầu trên campaign đấu
   thầu tự động của ANO/DarkMan là lần xác minh (lỗi sàn ghi nguyên văn vào Sổ hành động).
7. **Máy tự nâng mục tiêu** (executor) chưa làm — chỉ làm sau khi việc 6 xác minh OK và anh chốt luật.

### Đợt B — chưa code
8. ✅ ĐÃ CODE 24/09 (mục 10) — **Hạ ngân sách trước, tắt sau** (`change_budget`, nấc `cut_budget` trong executor; campaign không giới hạn
   ngân sách mà lỗ thì đặt trần trước). Cần probe `change_budget` + mở rộng cờ Hubsell ghi ngân sách gốc
   (campaign tạo từ Hubsell đã có số gốc trong `hubsellProposal`).
9. ✅ ĐÃ CODE 24/09 (mục 10) — **Cờ ví tự nạp** (`get_shop_toggle_info`, +1 call/xung): ví cạn mà không tự nạp → báo đỏ; đã bật tự nạp →
   hạ mức. Cắt cảnh báo ví cạn giả.

### Đợt C — chưa code
10. ✅ ĐÃ CODE 24/09 (mục 11) — **Bảng từ khóa đã chọn trong modal campaign thủ công** (`setting_info` info_type 2, 0 call thêm) — chỉ
    đọc, ghi rõ Shopee không cấp hiệu suất từng từ khóa.
11. **Sửa từ khóa/giá thầu** (`edit_manual_product_ad_keywords`) — chỉ làm khi có seller thật dùng bảng đọc.

### Khác
12. **GMS = GMV Max cấp shop:** chi tiêu GMS hiện KHÔNG vào bảng chiến dịch (chỉ nằm trong tổng chi cấp shop).
    Bước đầu: probe `check_create_gms_product_campaign_eligibility` trên 3 shop nhà. Đây cũng là nơi duy nhất
    tính được hòa vốn theo đúng rổ ads (có `get_gms_item_performance` từng SP).
13. **Trần gọi API theo app:** ticket Shopee 2098790879624904785 chờ vòng 2; khi qua ~800 gian chạy ads phải
    có số thật để nâng `ADS_APP_QPS` (hiện 3 call/s).
14. **Thẻ nhắc trong tour kết nối Shopee** ("có chạy quảng cáo thì sang Trợ lý bấm Kết nối Hubsell Ads") — anh
    chốt không cần ("có hiện là được rồi").

Công cụ sẵn có khi mở lại: route đọc thử `GET /api/ads/shopee/recommendations/probe?channelId=&itemId=`,
`POST /api/ads/shopee/write-probe`, seed demo `npx tsx scripts/seed-ads-demo.ts [--many] [--clean]` (6 kịch bản
gợi ý + ca mục tiêu dưới hòa vốn), cách soi UI local ghi trong memory `hubsell-local-test-chrome`.


## 8. Bộ lọc khoảng ngày chuẩn cho trang Trợ lý quảng cáo Shopee/Lazada (24/09/2026)

Anh Trung 24/09: "bộ lọc sẵn cơ bản quá" — 4 nút cứng Hôm nay / 7 / 14 / 30 ngày thay bằng
`DateRangePicker` dùng chung của app (Hôm nay · Hôm qua · 7 ngày qua · 30 ngày qua · Tháng này ·
Tháng trước + lịch kép chọn tay), cùng khuôn trang Quảng cáo TikTok và các trang báo cáo.

**Backend (`routes/ads.ts`, lõi `ads-insights.ts`):**
- `resolveAdsDateRange(query)` — nguồn duy nhất đọc `?from=&to=` (ngày sàn, giờ VN) hoặc `?days=`
  (đường cũ, mobile/khách cũ vẫn chạy): chọn ngược tự đảo, ngày cuối tương lai cắt về hôm nay,
  dài quá trần thì kéo ngày đầu lên + cờ `clamped`. Test `__tests__/ads-date-range.test.ts` (13 ca).
- Trần `ADS_RANGE_MAX_DAYS = 90`: MẶC ĐỊNH TỰ ĐẶT theo ngân sách RAM sau sự cố OOM 09/2026 (gian
  150 campaign × 90 ngày ≈ 13.500 dòng Decimal một lượt mở trang), KHÔNG phải giới hạn của sàn.
  Số hiệu suất trong DB không bị dọn (xung ads chỉ ghi đè) nên "Tháng trước" có số thật kể từ ngày
  gian bắt đầu kéo; sync lần đầu chỉ lùi 30 ngày nên trước mốc đó không có gì.
- `computeChannelAdsInsights(channel, { perfFromKey })` nạp `dailyPerf` rộng hơn 30 ngày khi bộ lọc
  xem xa hơn; các cửa sổ rule engine (today/3d/7d/30d) so theo mốc ngày nên verdict không đổi;
  executor / ops-alerts gọi không truyền → y như cũ.
- Dashboard cắt campaign + chart + AdSpend theo `from→to` (so bằng mốc ngày UTC = cách cột
  `@db.Date` lưu); payload thêm `from, to, days (số ngày trong khoảng), rangeClamped, rangeMaxDays,
  perfSince (ngày sớm nhất gian có số)`.
- Bảng điểm Trợ lý (`assistant-scorecard`) và soi sống Lazada (`live-detail`) nhận cùng `from/to`;
  soi sống Lazada: sàn chấp nhận khoảng dài bao nhiêu CHƯA xác minh (lỗi nếu có trả nguyên văn về modal).

**Frontend:** `shopee-ads-page.tsx` state `range: DateRange` (mặc định 7 ngày qua), `formatRangePhrase`
/ `capitalizePhrase` / `rangeDayCount` thêm vào `lib/date-range.ts` cho câu chữ ("7 ngày qua",
"tháng này", "từ 10/07/2026 đến 20/07/2026"); dòng vàng dưới thanh công cụ khi khoảng bị cắt theo trần
hoặc chọn trước ngày gian bắt đầu kéo số ("Hubsell chỉ có số quảng cáo của gian này từ dd/mm/yyyy").
Lazada dùng chung component nên được luôn.

**Kiểm local (DB dev, seed demo + bồi 60 ngày hiệu suất, đã dọn):** request đúng `from/to`; Tháng trước
→ 01/08–31/08 có số; chọn tay 10/07–20/07 (trước mốc kéo 26/07) → 0đ + dòng vàng nói rõ; API:
01/06→hôm nay bị cắt 90 ngày (`rangeClamped: true`), tương lai co về hôm nay, `days=14` cũ vẫn chạy.


## 9. Đợt E — Rổ thứ tư "ĐANG LÃI NHƯNG BỊ CHẶN PHÂN PHỐI" (24/09/2026, anh Trung: "làm đi em")

### 9.1 Vì sao
Anh hỏi "Shopee dựa vào đâu đánh giá hiệu quả, tối ưu kiểu gì". Câu trả lời đã trình (24/09 đêm):
- Shopee chỉ có MỘT thước: ROAS = GMV quy cho ads (7 ngày sau click, trực tiếp + gián tiếp) / tiền ads.
  Shopee không biết giá vốn — với sàn ROAS 3x là "hiệu quả", với SP biên 20% là lỗ. Đấu thầu tự động chỉ
  tiêu hết ngân sách trong phạm vi ROAS mục tiêu seller đặt.
- Nút vặn Shopee cho: ngân sách ngày, ROAS mục tiêu (auto bidding), từ khóa + giá thầu (manual), vị trí
  Khám phá, chọn SP, bật/tắt. KHÔNG có lịch giờ, KHÔNG có hiệu suất từng từ khóa qua API.
- Định vị Hubsell: "Shopee tối ưu để tiêu hết tiền, Hubsell tối ưu để còn lãi" — không làm bot giá thầu.
- Vòng tối ưu chuẩn 4 rổ: lỗ nặng → tắt (Q1/Q3 đã có); lỗ nhẹ → hạ ngân sách / nâng mục tiêu (đợt A có
  nút, đợt B chưa); lãi mỏng → giữ (Q2/Q4 đã có); **lãi tốt nhưng bị chặn → nới (ĐỢT E, mới)**.

### 9.2 Số thật trước khi code (đọc prod qua Chrome anh, 7 ngày trọn 17–23/09)
- DarkMan: 142 campaign, 0 đang chạy, chưa nối Hubsell Ads.
- ANO: 71 campaign, **1 đang chạy** "Túi Đeo Chéo Nam" — manual ad, đấu thầu TỰ ĐỘNG, ngân sách KHÔNG giới
  hạn, chi 1.716.678đ/7 ngày (≈245k/ngày), 63 đơn broad, ROAS 9,44x, hòa vốn 6,9x, mục tiêu đang đặt 12,2x.
  → rơi đúng ca "mục tiêu bó": lãi, nhưng sàn đấu tới 12,2x không tới nên phân phối dè dặt.
- Kết luận: mẫu shop nhà quá mỏng để rút ngưỡng từ số; mọi mốc phải lấy từ tài liệu sàn hoặc ghi rõ là
  mặc định tự đặt.

### 9.3 Luật (`assessDelivery` trong `ads-assistant-rules.ts`, thuần, 12 test `ads-delivery.test.ts`)
Chỉ xét khi: campaign `ongoing` ∧ verdict Trợ lý = `healthy` ∧ có hòa vốn ∧ **≥ 3 ngày trọn có tiêu tiền
trong 7 ngày trước hôm nay** (bài học 14/09: bỏ hôm nay, không phán trên mẫu mỏng) ∧ ROAS 7 ngày ≥ hòa vốn ×
dangerFactor (cùng mốc vùng an toàn đợt A) ∧ mục tiêu (nếu có) đã ở vùng `ok`.
- `budget_capped`: ngân sách > 0 ∧ chi tiêu TB của ngày CÓ tiêu ≥ **90%** ngân sách ngày. 90% là MẶC ĐỊNH
  TỰ ĐẶT (Shopee không công bố; TikTok dùng 80% cho tự tăng ngân sách GMV Max, Shopee lấy chặt hơn).
- `target_binding`: đấu thầu tự động ∧ ROAS 7 ngày < mục tiêu đang đặt (chưa đạt) — cơ chế Shopee mô tả ở
  `get_product_recommended_roi_target` (lower bound = nhiều hiển thị hơn). Ngân sách chặn được ưu tiên nếu
  cả hai cùng xảy ra.
- Không thì `null` — không có gì để nới, nhãn "Ổn" như cũ.
- CHỈ GỢI Ý: Hubsell không tự tăng ngân sách / hạ mục tiêu (cùng chốt "chỉ gợi ý" của TikTok 23/09).

### 9.4 Hiển thị
- Cột Trợ lý: nhãn xanh dương "Ngân sách đang chặn" / "Mục tiêu đang bó" thay "Ổn" (chỉ khi healthy).
- Dải xanh trên trang: "N chiến dịch đang lãi nhưng bị chặn phân phối — có thể thêm đơn" (`assistant.deliveryCount`).
- Modal: khối xanh — dữ kiện từng dòng (ROAS 7 ngày trọn · hòa vốn; % ngân sách hoặc mục tiêu đang đặt) rồi
  kết luận + mốc KHÔNG nên hạ dưới (`safeTarget` = hòa vốn × 1,1 làm tròn lên 0,1) + "sửa trên Seller Center".
- Payload: `campaigns[].delivery` (DeliveryCheck | null), `assistant.deliveryCount`. Lazada dùng chung.

### 9.5 Còn treo sau đợt E (không tự làm)
1. `get_product_recommended_roi_target` (+1 call/campaign khi mở modal): ROAS mục tiêu Shopee gợi ý lower/exact/upper
   cho SP — đặt cạnh `safeTarget` của Hubsell để seller có hai mốc.
2. Đợt B (hạ ngân sách trước khi tắt) — nấc người chạy ads chuyên nghiệp đòi đầu tiên.
3. Xác minh sống `change_roas_target` + `create_manual_product_ads` trên ANO (mục 7 việc 1, 6).
4. Đợt C từ khóa chỉ đọc; GMS (mục 7 việc 12).


## 10. ĐỢT B ĐÃ CODE (24/09/2026 đêm, anh Trung: "Em làm đợt B đi") — hạ ngân sách trước, tắt sau + cờ ví tự nạp

### 10.1 Căn cứ docs Shopee (đọc lại bằng Chrome anh 24/09)
- `edit_manual_product_ads` với `edit_action = "change_budget"`: tham số **`budget`** (float) = ngân sách NGÀY. Sàn tự
  chặn mức không hợp lệ bằng `ads.campaign.error_daily_budget_range` → Hubsell KHÔNG đoán mức tối thiểu, lỗi ghi
  nguyên văn vào Sổ hành động. Enum đầy đủ: start, pause, resume, stop, delete, change_budget, change_duration,
  change_smart_creative, change_location, change_enhanced_cpc, change_roas_target.
- `get_shop_toggle_info` (GET, không tham số): `auto_top_up` (bool), `campaign_surge` (bool), `data_timestamp`.
  App types: Seller In House, Marketing, Ads Service… → app Hubsell Ads gọi được.

### 10.2 Nấc `cut_budget` trong executor (`ads-auto-execute.ts`)
- `planAutoAction` (thuần, test `ads-budget-cut.test.ts` 13 ca): spike → pause; pause_now + cờ
  `autoExecute.cutBudgetFirst` (mặc định BẬT) + sàn có lệnh đổi ngân sách (Shopee) → chưa hạ trong ván → `cut_budget`;
  đã hạ HÔM NAY → không làm gì (một nấc/ngày, đợi đơn về); đã hạ hôm trước → pause. Lazada: tắt như cũ.
- Mức hạ `planBudgetCut`: max(50% ngân sách, 70% chi tiêu TB ngày 7 ngày trước), làm tròn 1.000; KHÔNG giới hạn →
  trần = 70% chi tiêu TB (không có chi tiêu → không hạ, tắt như cũ). Hai tỷ lệ = MẶC ĐỊNH TỰ ĐẶT (docs mục 3 đợt B).
- Trạng thái nấc: live đọc cờ campaign (`hubsellBudgetCutAt/On`), diễn tập đọc SỔ (dòng cut_budget PLANNED cùng ván
  `-c{cycle}`) → diễn tập cũng đi đúng trình tự hạ → ngày sau tắt.
- Cờ trên `AdsCampaign` (migration `20260924230000_ads_budget_cut_auto_topup`): `hubsellBudgetCutAt`,
  `hubsellBudgetBefore` (số gốc, 0 = không giới hạn), `hubsellBudgetCut`, `hubsellBudgetCutLogId`, `hubsellBudgetCutOn`.
- Trả ngân sách gốc (`restore_budget`): máy tự bật lại (ROAS đạt) → trả ngay sau resume; chủ shop bấm Bật lại trong
  Hubsell → trả; chủ shop bấm **Trả lại ngân sách** (route `POST /campaigns/:id/restore-budget`, campaign vẫn chạy).
  Sàn từ chối → giữ cờ, sổ có dòng FAILED.
- Người tự đổi ngân sách trên Seller Center: sync thấy `budget ≠ hubsellBudgetCut` → `reconcileHubsellBudgetFlags`
  xóa cờ, dòng hạ thành OVERRIDDEN, nhật ký "↩️ … Trợ lý thôi giữ số gốc". Người luôn thắng máy.
- Mọi lệnh tính vào quota `maxActionsPerDay`; live ghi nhật ký vận hành "✂️ Trợ lý hạ ngân sách…".

### 10.3 Ví tự nạp
- Xung Shopee bước 6 (+1 call/gian/xung): `get_shop_toggle_info.auto_top_up` → `Channel.adsAutoTopUp`.
- Thẻ "ví sắp cạn" (ops-alerts): auto_top_up true → severity **medium** + câu "sàn sẽ tự bù, chỉ cần chắc nguồn tiền
  nạp"; false → high + "KHÔNG bật tự nạp — hết ví là quảng cáo ngừng hiển thị"; null → như trước. Dải vàng trên trang
  Trợ lý cùng câu chữ (`wallet.autoTopUp`).

### 10.4 UI
- Cấu hình Trợ lý: công tắc "Hạ ngân sách trước, tắt sau" (chỉ Shopee) trong khối Tự thực thi.
- Bảng: nhãn tím "Hubsell đã hạ ngân sách" dưới trạng thái; modal: khối tím số gốc → mức đã đặt + nút "Trả lại ngân
  sách"; Sổ hành động: "Máy đã hạ ngân sách" / "Diễn tập hạ ngân sách" / "Seller đã đổi ngân sách" / "Máy đã trả ngân sách".

### 10.5 Kiểm chứng
- Diễn tập trên DB dev (gian demo, mode dry_run): lượt 1 → DEMO-5 pause (spike) + DEMO-3 `cut_budget` PLANNED
  "200.000₫ → 109.000₫ = 70% chi tiêu TB (155.000₫)"; lượt 2 cùng ngày → không thêm dòng (skippedDone 1). UI: nhãn +
  khối modal + nút Trả lại (bấm → lỗi thật "Gian chưa ủy quyền Hubsell Ads", đúng vì demo không có token).
- 626 test backend pass (+13 mới), tsc + eslint sạch.
- **CHƯA BẮN SỐNG** `change_budget` trên shop thật: lần đầu ở mode live trên ANO/DarkMan là lần xác minh (lỗi sàn
  ghi nguyên văn). ANO/DarkMan hiện dry_run → sổ sẽ hiện "Diễn tập hạ ngân sách" trước khi anh chuyển live.


## 11. ĐỢT C ĐÃ CODE (24/09/2026 đêm, anh Trung: "Làm tiếp đợt C đi em") — từ khóa: đọc được gì thì hiện, gợi ý có số

### 11.1 Căn cứ docs Shopee (đọc lại bằng Chrome anh 24/09)
- `get_product_level_campaign_setting_info` info_type **2** = `manual_bidding_info`: `enhanced_cpc`, `selected_keywords[]`
  (keyword, status ∈ deleted|normal|reserved|blacklist, match_type ∈ exact|broad, bid_price_per_click),
  `discovery_ads_locations[]` (location ∈ daily_discover|you_may_also_like, status active/inactive, bid_price).
  Cùng call với info_type 1,3 → hỏi "1,2,3" trong xung = **0 call thêm**.
- `get_recommended_keyword_list`: item_id (bắt buộc) + `input_keyword` (tùy chọn, "keyword seller typed in the manually
  add keyword window"); trả `suggested_keywords[]` (keyword, quality_score, search_volume 30 ngày, suggested_bid);
  docs ghi "only return the highly recommended keywords" → không kèm input_keyword có thể rỗng (probe ANO 17/09).
- **Không tồn tại** hiệu suất từng từ khóa qua API (Lazada có) → máy không có căn cứ tự sửa từ khóa; đợt C CHỈ ĐỌC + đối chiếu.

### 11.2 Code
- Xung: `upsertShopeeCampaignSettings` hỏi info_type "1,2,3", lưu nguyên văn `AdsCampaign.manualBidding` (JSON, null khi
  auto/trống). Migration `20260925000000_ads_keywords` (+ `ads_item_signals.kwSuggestions/kwSuggestionsAt`).
- `ads-keywords.ts` (thuần + service, test `ads-keywords.test.ts` 8 ca):
  `parseManualBidding` → khối gọn; `mergeKeywordSignals(selected, suggestions)` → gợi ý ∩ đang chọn = `inCampaign`,
  bid đang đặt > suggested_bid × **KEYWORD_OVERPAY_FACTOR 1,3** = `overpaid` (MẶC ĐỊNH TỰ ĐẶT, docs mục 3 "> 30%"),
  xếp hớ trước → gợi ý chưa có theo lượt tìm → đang có; từ khóa đã xóa/blacklist không tính; từ khóa đang chạy mà
  Shopee không gợi ý liệt kê riêng (không có số để so). `getCampaignKeywordSuggestions`: cache 24h
  (`SIGNAL_FRESH_HOURS`), hết hạn → gọi sàn không kèm input_keyword, rỗng → gọi lại kèm 2–3 chữ đầu tên SP
  (`inputKeywordFromName`), giữ tối đa 60 từ; tối đa 2 call/lượt bấm.
- Route `GET /api/ads/shopee/campaigns/:id/keyword-suggestions` (chỉ Shopee). Payload dashboard thêm `campaigns[].keywords`.
- Modal: khối "Từ khóa trong chiến dịch" (campaign thủ công): bảng từ khóa đang chọn (khớp, giá thầu, trạng thái) + dòng
  vị trí Khám phá + câu nói thật "Shopee KHÔNG cấp hiệu suất từng từ khóa qua API"; nút **Từ khóa Shopee gợi ý** → thêm cột
  "Shopee gợi ý" (hớ N%) vào bảng đang chọn + bảng gợi ý (lượt tìm, điểm CL, bid gợi ý, Có/Chưa có). Vàng = hớ, xanh = chưa có.

### 11.3 Kiểm chứng
- Soi local (DB dev, gian demo, manualBidding + cache gợi ý đặt tay): bảng 3 từ khóa đang chạy (deleted ẩn), hớ 43%
  (2.000₫ vs 1.400₫), gợi ý "ví da"/"balo nam" chưa có, "túi riêng" không có số để so; route fromCache=true.
- 633 test backend pass (+8), tsc + eslint sạch (backend + frontend).
- **CHƯA bắn sống** get_recommended_keyword_list kèm input_keyword trên shop thật — lần bấm đầu trên ANO là lần xác minh
  (rỗng cả hai lần thì UI nói rõ). manual_bidding_info sẽ về ở xung kế tiếp sau deploy (30').

### 11.4 Còn treo
- Ghi từ khóa (`edit_manual_product_ad_keywords`: add/delete/change_bid) — chỉ làm khi có seller thật dùng bảng đọc.

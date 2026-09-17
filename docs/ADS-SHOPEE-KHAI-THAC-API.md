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
8. **Hạ ngân sách trước, tắt sau** (`change_budget`, nấc `cut_budget` trong executor; campaign không giới hạn
   ngân sách mà lỗ thì đặt trần trước). Cần probe `change_budget` + mở rộng cờ Hubsell ghi ngân sách gốc
   (campaign tạo từ Hubsell đã có số gốc trong `hubsellProposal`).
9. **Cờ ví tự nạp** (`get_shop_toggle_info`, +1 call/xung): ví cạn mà không tự nạp → báo đỏ; đã bật tự nạp →
   hạ mức. Cắt cảnh báo ví cạn giả.

### Đợt C — chưa code
10. **Bảng từ khóa đã chọn trong modal campaign thủ công** (`setting_info` info_type 2, 0 call thêm) — chỉ
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

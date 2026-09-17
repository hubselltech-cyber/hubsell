# Trợ lý quảng cáo Shopee — khảo sát đủ 26 endpoint Ads API và lộ trình khai thác

Viết 17/09/2026, ngay sau khi app **Hubsell Ads** (Ads Service, partner riêng)
được Shopee duyệt Go-Live. Nguồn: đọc TRỰC TIẾP từng trang docs
`open.shopee.com/documents/v2/v2.ads.*` (không đoán endpoint), đối chiếu với
code đang chạy production. Góc nhìn: thiết kế như senior + tính toán như người
chạy ads chuyên nghiệp — chỉ đề xuất việc đổi ra tiền cho seller, có số call
cụ thể.

Trạng thái: **BẢN THAM MƯU** — anh Trung duyệt từng đợt rồi mới code (bài học
14/09: đụng luật Trợ lý phải tính rõ một lần trước).

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

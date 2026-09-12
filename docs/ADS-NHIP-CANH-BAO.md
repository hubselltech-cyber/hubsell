# Nhịp đồng bộ & cảnh báo quảng cáo — thiết kế 3 tầng (12/09/2026)

Trạng thái: **BẢN THIẾT KẾ CHỜ ANH TRUNG CHỐT, CHƯA CODE.** Viết sau khi đọc lại
toàn bộ module ads (rules, insights, executor, ops-alerts, sync 2 sàn, FE) và
tra tài liệu Shopee trong Console. Mục tiêu: một lần quyết định có tính toán,
không đổi số lung tung nữa.

---

## 1. Mục tiêu và ràng buộc

| # | Yêu cầu | Số cụ thể |
|---|---|---|
| M1 | Cảnh báo **cắn tiền** (spike) và **ví sắp cạn** tới chuông nhanh nhất sàn cho phép | ≤ 30 phút + độ trễ báo cáo của sàn |
| M2 | Không bao giờ để app bị Shopee khóa vì 429 (FAQ 570: vượt ngưỡng kéo dài = khóa API, mở lại phải ticket) | 0 lần retry dồn dập khi vượt trần theo app |
| M3 | Chịu được hàng chục ngàn gian, nhiều worker | tải tỉ lệ với số gian **đang chạy ads**, không phải tổng gian |
| M4 | Không đổi ngưỡng cảnh báo seller đã chỉnh (`AdsAssistantConfig`) | giữ nguyên schema config |
| M5 | Nhịp nằm ở **một** nguồn cấu hình, có ghi vì sao | `config/ads-cadence.ts` |

Ràng buộc từ sàn (đã xác minh 12/09, memory `hubsell-api-quota-san`):

- Shopee **không công bố** con số. Mọi endpoint ads có 3 mã: `ads.rate_limit.exceed_partner_api` (theo app), `exceed_shop_api` (theo shop), `exceed_api` (toàn hệ thống). Trần theo app là thật.
- Shopee có endpoint **theo giờ**: `get_all_cpc_ads_hourly_performance` (cấp shop, 1 ngày) và `get_product_campaign_hourly_performance` (≤100 campaign, 1 ngày). Client đã bọc hàm cấp campaign, chưa dùng.
- Lazada: code ghi "~10.000 call/ngày/app" (`lazada/ads-campaigns.ts:18`), nguồn chưa xác minh lại. Lazada **không có API số dư ví**, chỉ có cờ `adAccountBalanceStatus`.

---

## 2. Hiện trạng (đọc code 12/09)

**Rule engine** (`ads-assistant-rules.ts`): verdict `spike` chỉ dùng cửa sổ `today`
(spend hôm nay ≥ `dayMultiple` × TB 7 ngày trước, ≥ `minTodaySpend`, ROAS hôm nay
< hòa vốn). `pause_now/review/grace` dùng 3d/7d/30d nhưng cũng duyệt `today`
trước. "Hôm nay" theo giờ VN (`vnDateKey`).

**Nguồn số**: bảng `AdsCampaignDailyPerf` (1 dòng/campaign/ngày) + `AdSpend`
(cấp shop/ngày). Ví Shopee gọi **sống** `get_total_balance` ở 2 chỗ: mỗi lần mở
trang Trợ lý và mỗi lượt `scanOpsAlerts` (1 call/gian/lượt).

**Đường chuông**: `scanOpsAlerts(ownerId)` → detector `detectShopeeAdsAssistant`
(+ `detectAdsSpike` cũ cho gian chưa có campaign) → `OpsAlert` dedupe theo
`(ownerId, type, channelId)` → `notify()` dedupe 24h chưa đọc. `scanOpsAlerts`
được gọi ở cuối **tầng nhịp giờ** của worker (60') + khi mở Trung tâm điều hành,
throttle 10'/chủ shop.

**Executor GĐ3**: chạy ngay sau sync ads trong tầng ADS; chỉ PAUSE verdict
`pause_now`/`spike`; quota `maxActionsPerDay` (5) tính theo ngày VN; idempotent
`pause-{rowId}-{ngày}`. Mode mặc định `off`.

**Chi phí call mỗi lượt đầy đủ** (gian ≤100 campaign):

| Sàn | Call | Chi tiết |
|---|---|---|
| Shopee | 4 | 1 `get_all_cpc_ads_daily_performance` (cả cửa sổ) + 1 id list + 1 setting info + 1 daily perf (cả cửa sổ) |
| Lazada | ~58 (7 ngày) / ~81 (30 ngày) | report **phải gọi từng ngày** + adgroup ≤50 |

**Giả định "mỗi giờ" còn nằm ở 6 chỗ** sau khi 12/09 đổi sang 6h: `ops-alerts.ts:539, 861`,
`ads-auto-execute.ts:22`, `lazada/ads-campaigns.ts:19`, `HUBSELL-ADS.md:80`, và
**dòng seller nhìn thấy** `shopee-ads-page.tsx:836` ("worker cũng tự chạy mỗi giờ").

**Độ trễ cảnh báo hiện tại** = tuổi số ads = tới 6h khi không ai mở trang. Sai
với thiết kế gốc GĐ2 (10/08: "spike dùng dailyPerf sync mỗi giờ").

---

## 3. Thiết kế 3 tầng

### Tầng A — XUNG CẢNH BÁO (pulse), mỗi 30 phút, chỉ gian đang tiêu tiền

**Chọn gian** (query DB, không gọi sàn): gian ACTIVE có quyền Ads API **và** có ≥1
`AdsCampaign.status = ongoing` **và** tổng spend hôm nay hoặc hôm qua > 0. Gian có
campaign chạy nhưng 2 ngày không chi → xung giãn **120'**. Gian không có campaign
chạy → không xung (chỉ tầng B).

**Shopee, mỗi xung 4 call** (sửa 12/09 khuya sau câu hỏi của anh Trung "giữ 6h có
đảm bảo tức thì không?" — cấu hình campaign PHẢI nằm trong xung, vì seller tạm
dừng/nâng ngân sách trên Seller Center mà Hubsell hiện cũ 6h là sai, và rule
engine sẽ báo cắn tiền cho campaign đã dừng):

| # | Call | Mục đích |
|---|---|---|
| 1 | `get_product_level_campaign_id_list` (1 trang) | bắt **campaign mới tạo** trong ngày (chính là ca cắn tiền hay gặp) |
| 2 | `get_product_level_campaign_setting_info` (≤100 id) | **trạng thái chạy/tạm dừng, ngân sách, ROAS mục tiêu** tươi ≤30' — rule engine chỉ đánh giá campaign thật sự đang chạy |
| 3 | `get_product_campaign_daily_performance` với `start=end=hôm nay` | cập nhật dòng `today` của ≤100 campaign — đúng dòng rule spike đọc |
| 4 | `get_total_balance` | số dư ví → **ghi DB** `Channel.adsWalletBalance` + `adsWalletSyncedAt` |

**Xung nhẹ 120', 1 call** (`campaign_id_list`) cho gian đã nối Ads API nhưng
**chưa có campaign chạy** trong DB — để gian vừa tạo campaign đầu tiên không phải
đợi lượt 6h mới được xung đủ.

Không dùng endpoint theo giờ ở nhịp này: rule spike hiện so **tổng ngày**; endpoint
giờ chỉ đáng dùng nếu sau đo lag (mục 6) thấy số ngày trễ hơn số giờ.

**Lazada, mỗi xung 2 call:** report ngày hôm nay (`useRtTable=true`, đã có) +
trang 1 `searchCampaignList` (đã mang trạng thái + ngân sách + campaign mới + cờ
hết tiền ví — không cần call cấu hình riêng).

**Sau xung, ngay trong cùng lượt:** `computeChannelAdsInsights` → `runAdsAutoExecute`
(nếu bật) → `scanOpsAlerts(ownerId)`. Throttle 10' của scan không cản vì xung 30'.

**Ví ads đổi nguồn**: detector và trang Trợ lý đọc số dư **từ DB** (tươi ≤30')
thay vì gọi sống. Bỏ 2 call sống hiện tại → tổng call ví **giảm**, không tăng.

### Tầng B — LƯỢT LỊCH SỬ, mỗi 6 giờ (chỉ còn số quá khứ)

Sau khi cấu hình + số hôm nay đã về xung, tầng này **chỉ kéo lại 7 ngày gần nhất**
(sàn chỉnh số vài ngày đầu: đơn hủy sau click, Lazada attribution 30 ngày ghi về
ngày click) + backfill 30 ngày khi nối / lần đầu. Shopee 2 call (spend + perf 7
ngày), Lazada ~7 call report + adgroup. Không có gì seller "cần tức thì" ở đây —
6h là vì rẻ, hạ 24h cũng được. Nút Làm mới và nudge >30' khi mở trang kích **xung**
(không phải tầng này).

### Tầng C — VAN AN TOÀN THEO APP (chưa có, bắt buộc)

1. **Token bucket theo app** trong worker (Shopee app chính, Hubsell Ads, Lazada):
   trần call/giây cấu hình được (`ADS_APP_QPS`, mặc định thận trọng **3/s** tới khi
   Shopee trả lời ticket). Mọi call ads đi qua bucket.
2. **Cầu dao chung trong DB** (`ApiThrottleState{app, pausedUntil, reason}`): gặp
   `exceed_partner_api` / HTTP 429 → **không retry**, đặt `pausedUntil = now + 5'`
   (nhân đôi tới 60'); mọi worker đọc trước khi gọi. Gặp `exceed_shop_api` → chỉ
   gian đó lùi xung 15'.
3. **Sửa retry của client**: `client.ts` hiện retry 3 lần 1.5s→6s cho mọi
   "rate limit" — đúng cho lỗi thoáng, **sai** cho vượt trần theo app (FAQ: đừng
   retry). Tách: partner-level → ném `ApiBudgetError`; shop-level → 1 retry sau 3s.
4. **Ưu tiên khi thiếu ngân sách**: xung (cảnh báo tiền) > lượt đầy đủ > backfill.

### Một nguồn nhịp: `backend/src/config/ads-cadence.ts`

| Hằng | Giá trị | Vì sao |
|---|---|---|
| `PULSE_MIN` | 30 | M1; env `ADS_PULSE_MINUTES` |
| `PULSE_IDLE_MIN` | 120 | gian có campaign nhưng 2 ngày không chi |
| `FULL_HOURS` | 6 | cấu hình campaign đổi chậm; env `ADS_SYNC_HOURS` |
| `WINDOW_DAYS` | 7 | sàn chỉnh số vài ngày đầu |
| `BACKFILL_DAYS` | 30 | lần đầu / nối lại |
| `STALE_NUDGE_MIN` | 30 | mở trang |
| `REFRESH_GAP_MIN` | 2 | chống spam nút Làm mới |
| `WALLET_LOW_HOURS` | 24 | giữ (ops-alerts) |

Xóa các hằng rải rác tương ứng ở `sync-schedule.ts`, `order-auto-sync.ts`.

---

## 4. Tính toán tải

Gọi **G** = số gian đang chạy ads (không phải tổng gian). Mỗi gian/ngày:

| Sàn | Xung | Đầy đủ | Tổng/gian/ngày |
|---|---|---|---|
| Shopee | 4 × 48 = 192 | 2 × 4 = 8 | **200** |
| Lazada | 2 × 48 = 96 | ~57 × 4 = 228 | **324** |

| G | Shopee call/ngày | QPS trung bình | Lazada call/ngày |
|---|---|---|---|
| 300 | 60.000 | 0,7 | 97.000 |
| 3.000 | 600.000 | 6,9 | 972.000 |
| 10.000 | 2.000.000 | 23 | 3.240.000 |

Kết luận số:

- **Shopee**: 6,9 QPS ở 3.000 gian là mức phải hỏi Shopee. Token bucket 3/s mặc định
  tự động giãn xung khi G lớn (xung 30' thành ~55' ở 3.000 gian) — chậm hơn nhưng
  **không bao giờ khóa app**. Có số chính thức thì nâng bucket.
- **Lazada**: nếu quota 10.000/ngày/app là thật, xung 30' chỉ nuôi **~30 gian**; hạ
  lượt đầy đủ về 1 lần/ngày + xung 60' cũng chỉ ~65 gian. → Lazada mặc định **xung
  60'**, và **bắt buộc** hỏi quota ISV trước khi bán rộng. Bucket Lazada đặt theo
  ngày (call/ngày) thay vì theo giây.
- Nặng DB hơn nặng API: mỗi lượt đầy đủ upsert N×7 dòng perf tuần tự
  (`ads-campaigns.ts:172`). Xung chỉ upsert N dòng `today`. Khi G > 1.000 phải đổi
  upsert tuần tự thành `createMany … onConflict` theo lô (việc riêng, không thuộc tầng này).

---

## 5. Độ trễ kỳ vọng sau khi làm

| Cảnh báo | Hiện tại | Sau | Thành phần |
|---|---|---|---|
| Cắn tiền (spike) | ≤ 6h | ≤ 30' + lag sàn | xung 30' + tick 20s + scan |
| Trạng thái / ngân sách campaign seller đổi trên Seller Center | ≤ 6h | ≤ 30' | cấu hình nằm trong xung |
| Campaign mới tạo | ≤ 6h | ≤ 30' (gian đang chi) / ≤ 2h (gian chưa có campaign) | id list trong xung |
| Ví sắp cạn | ≤ 1h (số spend cũ tới 6h) | ≤ 30' | số dư + spend cùng tươi |
| Trợ lý tự thực thi | ≤ 6h | ≤ 30' + lag sàn | chạy ngay sau xung |
| 0 đơn / dưới hòa vốn (3d/7d) | ≤ 6h | ≤ 30' cho cửa sổ today, ≤ 6h cho 3d+ | đủ vì cửa sổ dài |

"Lag sàn" là ẩn số phải đo (mục 6). Nếu sàn trễ ~1h thì xung 30' đã sát trần;
15' không có ích.

---

## 6. Phải xác minh TRƯỚC khi code

1. **Ticket Shopee** (gửi kèm Go-Live app Hubsell Ads): trần QPS/ngày của nhóm Ads
   API theo partner và theo shop; có khác nhau giữa app loại Ads Service và ERP
   không. Lưu câu trả lời vào memory `hubsell-api-quota-san`.
2. **Hỏi Lazada** quota app ISV/ERP System khi tạo app mới (Basic info đã duyệt 11/09).
3. **Đo lag báo cáo sàn** trên shop nhà: script probe gọi daily perf hôm nay mỗi 15'
   trong 1 ngày (DarkMan/ANO/Hi.Bé), anh chụp Seller Center 3 mốc (10h, 15h, 21h);
   so lệch. Kết quả quyết định 30' hay 60'. Script để `.claude-tmp/tools`, không
   commit.

---

## 7. Dọn rác khi code

- 6 chỗ "mỗi giờ"/"10 phút" liệt kê ở mục 2 → đổi theo `ads-cadence.ts`, dòng FE đổi
  thành "Hubsell tự kiểm tra mỗi 30 phút khi campaign đang chạy".
- `ADS_SYNC_HOURS`, `ADS_PULSE_MINUTES`, `ADS_APP_QPS` vào `backend/.env.example`.
- Gỡ 2 call ví sống (routes/ads.ts, ops-alerts.ts) → đọc DB.
- Test bổ sung: chọn gian xung (có/không chi), tính hạn xung giãn 30'→120', cầu dao
  app đóng/mở theo mã lỗi, retry client tách partner/shop, ví đọc từ DB, quota
  executor theo ngày VN (đang thiếu).

---

## 8. Thứ tự làm (sau khi anh chốt và có kết quả đo lag)

1. `config/ads-cadence.ts` + dọn hằng rải rác (không đổi hành vi).
2. Tầng C van an toàn (bucket + cầu dao + tách retry) — làm **trước** tầng A vì A tăng call.
3. Tầng A xung (4 call Shopee / 2 call Lazada, xung nhẹ 120' cho gian chưa có
   campaign): cột `nextAdsPulseAt`, `adsWalletBalance`, `adsWalletSyncedAt` trên
   Channel; hàm `runAdsPulse(channel)` trong `order-auto-sync.ts`; ví đổi nguồn;
   tầng B rút về chỉ kéo lại 7 ngày.
4. Dọn 6 chỗ giả định cũ + FE text + docs + env example.
5. Chạy thật trên shop nhà 1 ngày, đối chiếu thời điểm chuông với Seller Center.

Mỗi bước một commit, không gộp.

---

## 9. Ba điểm cần anh chốt

1. Xung Shopee **30'** (đề xuất) — hay 15' nếu đo lag cho phép.
2. Lazada mặc định **xung 60'** tới khi có quota ISV — chấp nhận cảnh báo Lazada chậm hơn Shopee.
3. Ví ads chuyển sang **đọc từ DB** (tươi ≤30') thay vì gọi sống mỗi lần mở trang.

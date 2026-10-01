# Nhịp đồng bộ & cảnh báo quảng cáo — thiết kế 3 tầng (12/09/2026)

Trạng thái: **ĐÃ CODE 12/09 tối** (anh Trung chốt xung Shopee 30'; Lazada 60' và ví đọc DB theo đề xuất). Bản gốc dưới đây giữ nguyên làm căn cứ; mục 10 ghi những gì đã làm khác so với thiết kế. Viết sau khi đọc lại
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
`pause_now`/`spike`; quota `maxActionsPerDay` (5) tính theo ngày VN (đã gỡ 01/10/2026 — mục 12.3); idempotent
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
   `exceed_partner_api` / `exceed_api` → **không retry**, đặt `pausedUntil = now + 5'`
   (nhân đôi tới 60'); mọi worker đọc trước khi gọi. Gặp `exceed_shop_api` **hoặc
   HTTP 429 trần (không mã)** → chỉ gian đó lùi xung 15'.
   **★ Sửa 28/09/2026 (sự cố thật):** thiết kế cũ coi mọi HTTP 429 là tầng app →
   Hubsell Ads (2044679) gọi 1 call/gian/30' vẫn dính 429 lẻ trên từng gian
   (7 lần/ngày, 7 gian khác nhau) → cầu dao đóng cả app, bậc nhân đôi tới 40',
   Trợ lý quảng cáo mọi khách đứng số. Nay client đọc THÂN 429 (mã + request_id,
   đúng "call log" Shopee đòi ở ticket quota) và chỉ mã partner mới đóng cầu dao;
   `api-budget.ts` đếm **bão 429**: ≥ 3 lần tầng shop trong 10' (`RATE_LIMIT_STORM`)
   → coi là trần app, đóng cầu dao như cũ.
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

---

## 10. Đã code (12/09 tối) — khác biệt so với thiết kế

- **Xung Shopee 5 call** thay vì 4: thêm `get_all_cpc_ads_daily_performance` cho
  HÔM NAY để `AdSpend` (báo cáo dòng tiền + detector ads-spike cũ) cùng tươi.
  Tải Shopee/gian/ngày = 5×48 + 8 = **248** (3.000 gian ≈ 8,6 QPS trung bình).
- Files: `config/ads-cadence.ts` (nguồn nhịp), `services/api-budget.ts` (bucket +
  cầu dao `ApiThrottleState`), `integrations/shopee/ads-pulse.ts`,
  `integrations/lazada/ads-pulse.ts`, `ads-campaigns.ts` tách 3 bước dùng lại +
  `syncShopeeAdsPerfWindow`, worker `runAdsPulseTier` / `runAdsTier` (lịch sử),
  `sync-schedule.ts` nudge/Làm mới → xung, ví đọc DB ở `ops-alerts.ts` + `routes/ads.ts`.
- Cột Channel mới: `nextAdsPulseAt`, `adsWalletBalance`, `adsWalletSyncedAt`
  (migration 20260912233000); bảng `api_throttle_states` (20260912230000).
- Client: mã `ads.rate_limit.exceed_partner_api` / `exceed_api` → đóng cầu dao,
  KHÔNG retry; `exceed_shop_api` / HTTP 429 trần → lùi gian 15' (28/09, xem Tầng C
  mục 2; bão ≥3 gian/10' mới đóng cầu dao). Retry cũ (3 lần) chỉ còn cho
  `error_rate_limit` của API đơn/kho.
- 14/09: Lazada thêm `AdSpend` theo ngày từ tổng perf chiến dịch (`lazada/ads-spend.ts`,
  0 call sàn, chặn tính đúp gian trả tiền ads qua doanh thu — xem HUBSELL-ADS.md) và
  dải đỏ "ví hết số dư" trên trang Trợ lý Lazada (`walletEmpty` từ cờ sàn).
- Chưa làm: đo lag báo cáo sàn (mục 6.3) — đọc từ log `[Ads-pulse]` trên Render
  sau deploy; endpoint theo giờ vẫn để dành. Ticket quota Shopee/Lazada: nháp ở
  mục 11, anh Trung gửi.

## 11. Nháp ticket hỏi quota (anh gửi, câu trả lời lưu memory hubsell-api-quota-san)

**Shopee (Console → Raise Ticket, kèm lúc nộp Go-Live app Hubsell Ads):**

> Subject: Rate limit thresholds for Ads API (partner-level / shop-level)
>
> We are an ISV (ERP System app partner_id 2040029, Ads Service app "Hubsell Ads")
> preparing to serve thousands of Vietnamese sellers. The Ads API error codes
> list ads.rate_limit.exceed_partner_api, exceed_shop_api and exceed_api but the
> thresholds are not documented. Could you share: (1) the per-partner and
> per-shop limits (requests per second / per minute / per day) for
> get_product_level_campaign_id_list, get_product_level_campaign_setting_info,
> get_product_campaign_daily_performance, get_all_cpc_ads_daily_performance and
> get_total_balance; (2) whether these limits differ between an Ads Service app
> and an ERP System app; (3) whether limits can be raised for approved ISVs and
> the process to request it. We currently plan ≤5 calls per shop every 30
> minutes for shops with active campaigns, throttled to 3 requests/second per
> app with automatic back-off on any rate-limit error.

**Lazada (Open Platform → ticket, khi tạo app ISV mới):**

> Subject: API call quota for Sponsored Solutions (ads) endpoints — ISV app
>
> Our app (Hubsell, App Key 140639, ERP System category approved 11/09/2026) will
> serve thousands of sellers. Please confirm the daily/per-second call quota per
> app for sponsor/solutions/campaign/searchCampaignList,
> report/getDiscoveryReportCampaign and adgroup/searchAdgroupList, whether the
> quota is per app or per seller, and how an ISV can request a higher quota.

---

## 12. Sửa 01/10/2026 — nhóm quảng cáo: ba việc treo + ba việc phát sinh + dọn dẹp

| Mục | Việc | Commit |
|---|---|---|
| 12.1 | Bảng điểm Trợ lý xem 90 ngày nạp đủ hiệu suất | `0c765e9` |
| 12.2 | Ngày gửi lên Shopee Ads tính theo ngày VN | `596c490` |
| 12.3 | Bỏ trần lệnh mỗi ngày + thứ tự lệnh | `ce7a1d2` |
| 12.4 | Sàn báo quá nhịp thì xung kế thử lại; thẻ diễn tập gom theo gian | `2f6b95b` |
| 12.5 | Máy tự trả ngân sách gốc khi chiến dịch hết lỗ | `cbd5901` |
| 12.6 | Dọn dẹp: mỗi khái niệm một nguồn, cây module | commit dọn dẹp cùng ngày |

Còn treo duy nhất: kiểm số thật mục 12.2 trên prod trong khung 0h–7h VN.

### 12.1 Bảng điểm Trợ lý xem 90 ngày nạp đủ hiệu suất

Route `assistant-scorecard` gọi lõi insights không kèm `perfFromKey` nên chỉ có 30
ngày hiệu suất, trong khi bộ lọc trang cho xem tới 90 ngày (`ADS_RANGE_MAX_DAYS`).
Lần diễn tập cũ hơn 30 ngày vì thế luôn ra "chưa đủ số" (prod 30/09: một gian có 2
dòng diễn tập từ 15/08). Nay phần nạp tách ra `ads-scorecard-data.ts`
(`loadAssistantScorecard`), hiệu suất nạp từ đúng ngày đầu khoảng đang xem. Chỉ đổi
số hiển thị trên bảng điểm; luật và lệnh của Trợ lý không đổi. Test trên DB:
`ads-scorecard-db.test.ts`.

### 12.2 Ngày gửi lên Shopee Ads tính theo ngày VN (lệch 0h–7h sáng)

**Lỗi:** `toShopeeDate(new Date())` lấy `getDate()` theo giờ máy chủ. Render chạy UTC
nên từ 0h tới 7h sáng VN, "hôm nay" của máy chủ vẫn là hôm qua của sàn: xung chỉ kéo
lại dòng hôm qua, `AdsCampaignDailyPerf` và `AdSpend` không có dòng hôm nay suốt 7
tiếng. Luật vọt chi và cửa sổ Hôm nay (đều đọc `vnDateKey(0)`) mù đúng khung 0h–2h
ngày sale. Dính: `syncShopeeAdsSpend` (xung, lượt lịch sử, nút tay) và hiệu suất
chiến dịch (`upsertShopeeCampaignPerf` ở xung, lịch sử, backfill). Không dính: Lazada,
TikTok, GMS Shopee (vốn đã đi qua `vnDateKey`).

**Sửa:** một nguồn ngày ở `lib/ads-dates.ts`:

- `vnDayWindow(daysBack)` → `{ startKey, endKey }` theo ngày sàn (giờ VN), tính cả hôm nay.
- `shopeeDateParam("YYYY-MM-DD")` → `"DD-MM-YYYY"` của Shopee Ads API (hàm thuần trên chuỗi,
  không phụ thuộc múi giờ máy).

`toShopeeDate(Date)` và `perfWindow` đã gỡ hẳn để không ai gọi lại; GMS và lệnh tạo
chiến dịch từ gợi ý cũng đi qua `shopeeDateParam`. `upsertShopeeCampaignPerf` nhận khoảng
ngày dạng khóa thay cho hai `Date`.

**Xung vẫn chỉ kéo đúng hôm nay** (ngày VN). Hệ quả có chủ đích: sau 0h VN xung không còn
cập nhật dòng hôm qua nữa; số hôm qua sàn chỉnh muộn do lượt lịch sử 6 giờ kéo lại (cửa
sổ 7 ngày). Không thêm call nào lên sàn.

**Test:** `lib/__tests__/ads-dates.test.ts` (mốc 0h30, 6h59, 23h59 VN) và
`ads-shopee-vn-day.test.ts` (đặt đồng hồ 0h30 sáng 10/10 VN, đọc tham số ngày thật của
từng call: xung gửi `10-10-2026`, lịch sử 7 ngày gửi `04-10-2026 → 10-10-2026`).

**Kiểm trên prod:** chỉ kiểm được trong khung 0h–7h VN sau khi lên. Đúng thì trong khung
đó `AdsCampaignDailyPerf` và `AdSpend` của gian đang chạy quảng cáo có dòng mang ngày VN
hôm đó, `updatedAt` sau 17:00 UTC.

### 12.3 Bỏ trần lệnh mỗi ngày + thứ tự lệnh trong một lượt

**Anh Trung chốt 30/09:** chủ shop đã tự đặt điều kiện, chiến dịch vi phạm là xử lý —
không có trần riêng của máy.

**Trước:** `autoExecute.maxActionsPerDay` (mặc định 5 lệnh/gian/ngày). Chiến dịch lỗ thứ
6 trở đi chạy tiếp, không thẻ, không chuông (`skippedQuota` chỉ vào log máy chủ). Thao
tác tay của chủ shop cũng bị tính vào trần. Lệnh bật lại chạy trước lệnh dừng.

**Căn cứ của trần cũ không có nguồn.** Chú thích trong mã ghi "đệm dưới giới hạn sàn ~10
thao tác/sản phẩm/ngày". Đọc lại tài liệu Shopee Open Platform 01/10/2026 (5 trang API
ghi của nhóm Ads: `edit_manual_product_ads`, `edit_manual_product_ad_keywords`,
`create_manual_product_ads`, `edit_gms_product_campaign`, `edit_auto_product_ads`; mục
FAQ không có nhóm Ads): không trang nào nêu giới hạn số lần sửa theo sản phẩm hay theo
ngày. Thứ duy nhất liên quan là mã lỗi `ads.rate_limit.campaign_level` ("Too many
requests at the moment, please try again later") — giới hạn nhịp gọi theo chiến dịch,
không kèm con số. Ghi chú gốc nằm trong danh sách "chưa xác minh" của lần khảo sát
10/08 (lần đó đọc qua một bản SDK không chính thức), sau đó được chép vào chú thích mã
như một căn cứ.

**Nay:**

- Gỡ `maxActionsPerDay` khỏi executor, kiểu cấu hình, `normalizeAssistantConfig` (bản lưu
  cũ còn trường này thì bỏ qua) và ô "Tối đa hành động/ngày" trên trang cấu hình. Gỡ
  `skippedQuota` khỏi kết quả + log worker.
- Một lượt xử lý hết mọi chiến dịch vi phạm; diễn tập ghi sổ đủ mọi chiến dịch.
- Thứ tự một lượt: **dừng vọt chi → hạ ngân sách / dừng chiến dịch lỗ (chi 7 ngày nhiều
  trước) → bật lại**. `selectAutoActionCandidates` xếp vọt chi lên đầu.
- Trả ngân sách gốc sau khi máy bật lại không còn bị trần chặn.
- Giới hạn còn lại là theo từng chiến dịch (không đổi): mỗi ván mỗi ngày một lệnh mỗi
  loại, máy bật lại hôm nào thì hôm đó không tắt lại → tối đa 4 lệnh/chiến dịch/ngày.

### 12.4 Hai điểm rà ra sau khi gỡ trần (anh Trung duyệt 01/10, đã làm)

Cả hai chỉ lộ khi một gian có nhiều chiến dịch vi phạm cùng lúc — đúng tình huống mà
trần cũ che đi.

**a) Sàn báo gọi quá nhịp thì dừng lượt, xung kế thử lại.**

- Trước: lệnh thật bị trả `ads.rate_limit.*` ghi sổ FAILED và giữ khóa
  `{loại}-{chiến dịch}-{ngày}-c{ván}` → lượt sau thấy khóa là bỏ qua, chiến dịch vi
  phạm chạy tiếp tới hôm sau, kèm thẻ "sàn từ chối" sai nghĩa.
- Nay: `isAdsWriteRateLimited` nhận ra lỗi quá nhịp (Shopee: mọi mã `ads.rate_limit.*`
  + HTTP 429; Lazada: cùng bộ nhận diện với luồng đọc). Dòng sổ chuyển trạng thái
  **DEFERRED**, máy **dừng lượt** (không gọi tiếp chiến dịch kế, bỏ cả vòng bật lại —
  FAQ 570 của Shopee: gọi dồn khi đã bị chặn là lý do khóa app). Các chiến dịch còn lại
  chưa ghi sổ nên xung kế xử lý bình thường.
- Xung kế (Shopee 30', Lazada 60'): thử lại trên **chính dòng sổ đó**, không sinh dòng
  mới. Mã `reference_id` gửi lên sàn đổi đuôi `-r…` vì chưa kiểm được Shopee có giữ mã
  của lệnh bị từ chối vì quá nhịp hay không; khóa chống bắn trùng vẫn là dòng sổ.
- Từ chối nghiệp vụ (`ads.edit.invalid_action`…) giữ nguyên: FAILED, không thử lại
  trong ngày, thẻ "sàn từ chối".
- `editManualProductAdsRaw` (Shopee) và `updateAdsCampaignSwitchRaw` (Lazada) trả
  envelope lỗi khi gặp HTTP 429 không kèm thân JSON, thay vì vỡ ở `res.json()`.
- Thẻ điều hành `ads-auto-deferred` (mức cao, một thẻ mỗi gian): "sàn đang giới hạn
  nhịp gọi — N lệnh chưa gửi được, Trợ lý tự thử lại"; tự đóng khi lệnh gửi được. Sổ
  hành động hiện nhãn "Sàn bận — sẽ thử lại".
- Chỉ ảnh hưởng chế độ Thật. Lệnh **trả ngân sách gốc** ngay sau khi máy bật lại mà bị
  quá nhịp: xem mục 12.5 (đã xử lý cùng ngày).

**b) Thẻ diễn tập gom một thẻ mỗi gian mỗi ngày.**

- Trước: `detectAdsAutoActions` sinh một thẻ + một chuông cho mỗi chiến dịch; trần cũ vô
  tình giữ ≤5 thẻ/gian/ngày.
- Nay: `buildAdsPlannedGroupAlert` — type vẫn `ads-auto-planned`, khóa
  `{channelId}|{ngày VN}`. Một chiến dịch thì giữ câu chữ + căn cứ cũ và mở thẳng chiến
  dịch; nhiều chiến dịch thì "Trợ lý ĐỊNH xử lý N chiến dịch", đếm theo loại lệnh (tạm
  dừng / hạ ngân sách — trước đây diễn tập hạ ngân sách không có thẻ), 3 tên đầu + số
  còn lại, mở bộ lọc "cần xử lý". Trong ngày có thêm chiến dịch thì thẻ cập nhật số,
  không chuông lại; hôm sau là thẻ mới.
- Thẻ lệnh thật giữ riêng từng chiến dịch (đã tạm dừng có nút Bật lại, sàn từ chối, đã
  bật lại). Thẻ diễn tập kiểu cũ theo từng chiến dịch tự đóng ở lượt quét đầu sau deploy.

**Test:** `ads-auto-execute-deferred-db.test.ts` (lệnh thứ 2 quá nhịp → chiến dịch thứ 3
không gọi; lượt sau thử lại đúng dòng, mã gửi sàn mới; từ chối nghiệp vụ không thử lại),
`ads-auto-execute.test.ts` (nhận diện mã lỗi), `ops-alerts-shopee-ads.test.ts` (40 chiến
dịch → một thẻ).

### 12.5 Máy tự trả ngân sách gốc khi chiến dịch hết lỗ (anh Trung duyệt 01/10)

**Trước:** lệnh trả ngân sách gốc chỉ đi kèm lệnh bật lại (máy bật, chủ shop bấm Bật lại)
hoặc nút "Trả lại ngân sách". Hai lỗ:

1. Chiến dịch bị hạ ngày 1, ngày 2 tự hồi (không bị dừng) → không có lệnh bật lại nào →
   ngân sách nằm ở mức đã hạ cho tới khi chủ shop tự bấm. Chiến dịch đang lãi bị bó
   tiền mà chủ shop không tự tay hạ nên dễ không biết.
2. Máy bật lại xong, lệnh trả ngay sau bị sàn báo quá nhịp → FAILED, không ai gửi lại.

**Nay** (`shouldAutoRestoreBudget` + vòng "trả ngân sách" cuối mỗi lượt, chỉ chế độ Thật):

- Điều kiện trả: chiến dịch **đang chạy**, còn **cờ hạ của Hubsell** (người tự đổi ngân
  sách trên sàn thì cờ đã bị xóa lúc đồng bộ → máy không đụng), **không phải hôm vừa hạ**
  (một nấc mỗi ngày, đợi đơn về), và luật chấm **Ổn thật**: verdict `healthy`, có hòa
  vốn, không kèm ghi chú "dưới hòa vốn nhưng chưa tiêu đủ ngưỡng". Tức mọi cửa sổ đủ dữ
  liệu đã qua vùng vàng — cùng mức đòi hỏi với lệnh tự bật lại (hòa vốn × hệ số an
  toàn). Không thêm con số mới nào.
- Còn sát hòa vốn / công thần / chưa đủ dữ liệu → giữ mức đã hạ. Vẫn lỗ ngày sau → tạm
  dừng như cũ.
- Thứ tự một lượt giờ là: dừng vọt chi → hạ ngân sách / dừng chiến dịch lỗ → bật lại →
  **trả ngân sách**.
- Khóa sổ của lệnh trả do máy gửi đổi thành `restore-{chiến dịch}-{ngày}` (bỏ số ván):
  mỗi ngày tối đa một lệnh trả cho một chiến dịch, và lệnh trả bị quá nhịp ngay sau khi
  bật lại (ván đã +1) vẫn được xung kế tìm thấy.
- Sàn báo quá nhịp → dòng `restore_budget` DEFERRED, dừng lượt; xung kế gửi lại **dù lúc
  đó luật chấm gì** (lệnh đã quyết, chỉ là chưa gửi được). Qua ngày mà vẫn chưa gửi
  được thì quay về điều kiện "Ổn thật" ở trên.
- Sàn từ chối nghiệp vụ → FAILED, cờ giữ, thẻ "Trợ lý không trả ngân sách gốc được…"
  (câu chữ thẻ sàn từ chối giờ nói đúng loại lệnh), hôm sau thử lại; nút tay vẫn còn.
- Trả thành công ngoài lệnh bật lại → ghi nhật ký vận hành "💰 Trợ lý trả ngân sách
  ngày … — chiến dịch đã hết lỗ". Sổ hành động: "Máy đã trả ngân sách".

**Test:** `ads-auto-restore-budget-db.test.ts` (tự hồi → trả; ba trường hợp chưa đủ điều
kiện; lệnh trả quá nhịp → xung kế gửi lại; quá nhịp ngay sau khi máy bật lại; sàn từ
chối nghiệp vụ), `ads-budget-cut.test.ts` (điều kiện thuần).

### 12.6 Dọn dẹp — mỗi khái niệm một nguồn, cây module (anh Trung 01/10: "dọn code thừa, đảm bảo mô hình tree xuyên suốt")

Không đổi hành vi. 956 test giữ nguyên kết quả, `tsc` + `--noUnusedLocals` sạch trên các
tệp đã đụng.

**Cây phụ thuộc của nhóm quảng cáo — tầng dưới không biết tầng trên, cùng tầng không chép
của nhau:**

```
lib/ads-dates.ts      ngày sàn (giờ VN): vnDateKey, vnDateKeyOf, vnDayWindow, vnDayStart/End,
                      shopeeDateParam, dateKeyToDbDate, bộ lọc from/to            ← THUẦN
lib/ads-format.ts     vndText, roasText (câu chữ ghi sổ, thẻ, nhật ký)            ← THUẦN
lib/ads-margin.ts     luật biên lãi + nhóm SKU                                    ← THUẦN
        │
integrations/shopee/  client.ts (gọi sàn, nhận diện lỗi quá nhịp, đọc thân 429)
integrations/lazada/  client.ts
        │
integrations/shopee/  ads-assistant-rules.ts   luật chấm + mức hạ ngân sách       ← THUẦN
                      ads-scorecard.ts         luật bảng điểm                     ← THUẦN
                      ads-recommend.ts         luật gợi ý chạy ads                ← THUẦN
        │
                      ads-insights.ts          ghép số thành kết luận (đọc DB)
                      ads-scorecard-data.ts    nạp bảng điểm (đọc DB)
                      ads-campaigns / ads-spend / ads-pulse / ads-gms   kéo số từ sàn
                      ads-pause-flag.ts        cờ nguồn dừng / cờ hạ ngân sách
                      ads-auto-execute.ts      executor: lệnh của máy + lệnh chủ shop bấm
        │
services/ops-alerts.ts        thẻ Trung tâm điều hành + chuông (đọc sổ, cờ, insights)
routes/ads.ts, ads-tiktok.ts  API cho giao diện
workers/order-auto-sync.ts    nhịp xung / lịch sử gọi các tầng trên
```

**Bản chép đã gỡ:**

- *Ngày theo giờ VN* có 3 bản (`vnDateKey` ở lib, `vnDateStr` ở `lazada/ads-campaigns.ts`,
  bản sao trong `lazada/ads-spend.ts` "để tránh import vòng") + 4 chỗ tự cộng 7 giờ
  (`ads-scorecard.ts`, `ops-alerts.ts` ×2, `routes/ads-tiktok.ts` ×2). Nay chỉ còn
  `lib/ads-dates.ts`. TikTok không còn mượn hàm ngày từ module Lazada. `dateFromStr` (2 bản)
  → `dateKeyToDbDate`. Bí danh `toShopeeDay` ở GMS → gọi thẳng `shopeeDateParam`.
- *Định dạng tiền / ROAS* có 4 bản (`ads-assistant-rules`, `ads-auto-execute`,
  `ads-recommend`, `ops-alerts`) → `lib/ads-format.ts`.
- *Lệnh trả ngân sách gốc* có 2 bản (đường chủ shop và đường của máy) → một lõi
  `sendBudgetRestore` + `budgetRestoreReason`; đường chủ shop là `restoreBudgetManual`
  (lấy token trước khi ghi sổ để lỗi token không để lại dòng treo).
- *Deep-link + danh sách tên chiến dịch trên thẻ* có 2 bản trong `ops-alerts.ts` → dùng
  chung `adsDeepLink` + `campaignListText`.
- *Đọc thân phản hồi HTTP 429 của Shopee* có 2 bản → `readRateLimitBody`.

**Chưa đụng (ngoài phạm vi nhóm quảng cáo hôm nay):** tham số `scope` không dùng ở
`tiktok-ads/auto-run.ts` `applyAutoPlan`; các hàm định dạng tiền riêng của mail / thanh
toán / trợ lý hỏi đáp.

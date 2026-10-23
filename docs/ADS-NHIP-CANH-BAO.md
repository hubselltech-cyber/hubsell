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
   trần call/giây cấu hình được (`ADS_APP_QPS`, mặc định thận trọng **3/s** — con số
   TỰ CHỌN; Shopee trả lời 10/10/2026 là KHÔNG công khai ngưỡng, xem mục 11). Mọi
   call ads đi qua bucket.
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
   **★ Sửa 16/10/2026 (sự cố thật lần 2):** HQ báo cầu dao ĐÓNG `shopee:2044679`
   khi mới vài gian ủy quyền (anh Trung: "sao mới vài shop đã vượt ngưỡng"). Gốc:
   bão 429 đếm theo **lần**, giả định "mỗi gian 1 call/30' nên 3 lần = 3 gian" sai —
   xung Shopee (`ads-pulse.ts`) gọi 5–7 call liền cho MỘT gian và 3 bước cuối (ví,
   GMS lần đầu, cờ ví tự nạp) nuốt `ApiBudgetError` rồi gọi tiếp → gian đã bị sàn
   chặn tầng shop sinh 3 lần 429 trong vài giây → cầu dao đóng cả app. Sửa: (1) bão
   = ≥ 3 **gian khác nhau** trong 10' (`withApiBudget` nhận khóa gian: shop_id Shopee /
   access_token Lazada); (2) xung gặp `ApiBudgetError` ở bất kỳ bước nào thì ném tiếp
   → gian lùi 15' (`order-auto-sync`), không gọi thêm; (3) thẻ Cầu dao trên HQ hiện
   lý do sàn trả + mở lại lúc nào (giờ VN) + bậc + số lần, thay vì chỉ tên app.
   **Đối chiếu prod 16/10 11:40 VN (SQL chỉ đọc `api_throttle_states`):** `shopee:2044679`
   `tripCount = 102` (từ 28/09 → ~3 lần/ngày), bậc 0, nghỉ 5' (11:30→11:35 VN), `reason` =
   "Bão 429: ≥3 gian vượt trần trong 10' — Shopee get_all_cpc_ads_daily_performance lỗi:
   HTTP 429 — vượt trần gọi API (**error_rate_limit** Too many requests. You have reached
   the rate limit…)". Tức thân 429 là mã chung `error_rate_limit`, KHÔNG phải
   `exceed_partner_api` → đúng là bão tầng shop, không phải trần app. Gian nối Hubsell
   Ads lúc đó: 29 ACTIVE + 2 DISCONNECTED (không phải "vài gian"). App chính
   `shopee:2040029` chỉ đóng 14 lần, lần cuối 15/09 (trước khi tách tầng).
   **★ Sửa 17/10/2026 (lần 3 — ngưỡng không theo quy mô):** sau bản 16/10 cầu dao vẫn
   đóng ~8 lần/ngày (lần 102 → 114 trong ~35 giờ), lý do đúng "≥3 gian khác nhau". Gốc:
   429 mã chung `error_rate_limit` của Shopee rơi LẺ TẺ, ngẫu nhiên lên từng gian (có từ
   28/09); 7 gian hiếm khi 3 gian trùng 10', 29 gian thì thường xuyên, 50.000 gian thì
   đóng liên tục. Sửa: (1) bão = ≥ 3 gian **và** ≥ 20 % số gian ĐÃ GỌI trong cùng 10'
   (`RATE_LIMIT_STORM.ratio`, số **tự chọn**, chưa có căn cứ sàn; trần app thật Shopee
   trả `exceed_partner_api` → vẫn đóng ngay); (2) lý do ghi "Bão 429: x/y gian đã gọi …
   (tên gian)"; (3) thẻ HQ: bão bậc 0 (tự mở sau 5') = VÀNG, đỏ khi bậc ≥ 1 hoặc vượt
   trần app thật (`breakerSignalLevel`); (4) khóa gian Lazada trước đây là nguyên
   access_token và bị in ra log `[ApiBudget]` → nay băm `lazadaShopKey`.
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
| `WINDOW_DAYS` | 7 | Lazada (report 1 call/ngày) |
| (Làm mới Shopee) | từ 19/10/2026 nút Làm mới đặt cả `nextAdsSyncAt = now` → kéo hôm nay + lịch sử 30 ngày cùng lượt (van 2' giữ nguyên); Lazada chỉ xung | anh Trung: "ấn lại đối soát lên luôn không?" |
| `WINDOW_DAYS_SHOPEE` | 30 (19/10/2026) | Shopee: perf campaign + chi cấp shop nhận ≤ 1 tháng/call → 30 ngày cùng số call; Shopee trừ lại đơn hủy nhiều ngày sau (ANO 01–18/10: Hubsell 217 đơn vs Seller Center 210, chi khớp từng đồng) |
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

**★ KẾT QUẢ Shopee (10/10/2026, email openapi@support.shopee.com, ticket 2098790879624904785, sau 2 vòng):** "The specific rate-limit thresholds for Ads APIs are not publicly available. At the shop level, calling once per minute should generally be allowed. If you encounter a rate-limit error, please retry at a different time." → Không có con số theo partner/app, ticket ĐÓNG. Hệ quả: `ADS_APP_QPS = 3` giữ nguyên với tư cách mặc định tự chọn; qua ~800 gian chạy ads thì đo mã `exceed_partner_api` thật trên worker rồi mới chỉnh. Cấp shop: xung 5–6 call liền nhau mỗi 30' giữ nguyên (429 ngày 28/09 xảy ra ngay cả với 1 call/30' nên "1 call/phút" không giải thích được); lùi gian 15' đúng tinh thần "retry at a different time". Lazada #58082 chưa có trả lời.

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


### 11.2 Ticket Shopee LẦN 2 — 23/10/2026 — ✅ ĐÃ GỬI 11:11, Enquiry ID 2113468448421310539 (In Progress)

**Đã gửi 23/10/2026 11:11** (em điền qua Chrome, anh bấm 提交): Enquiry ID **2113468448421310539**, webform 2113468448136294418, app 2044679, L1 Feature APIs / L2 Ads / API Category V2-Ads / API Name v2.ads.get_all_cpc_ads_daily_performance / Shop ID mẫu 1359898174 / Request ID mẫu e3e3e7f35e74662c33951aca17f32500 / Request Time 23/10 04:18 VN. Mô tả gửi = phần A dưới đây rút còn 8.037 ký tự (form giới hạn 9.999) + 57 dòng request_id dạng ngắn (mã ALLCPC/SETTING/BALANCE/ROI/BUDGET có chú giải). Theo dõi: My Enquiries  (zing4teen@gmail.com) + email openapi@support.shopee.com. Lịch nhắc kiểm 27/10 08:30. Trả lời của Shopee ghi ngay dưới đây.

**Trả lời Shopee:** ⏳ chưa có.

**Gửi ở đâu:** Shopee Open Platform Console → Raise Ticket, L1 Feature APIs / L2 Ads / API Category V2-Ads, chọn app **Hubsell Ads partner_id 2044679** (ticket 12/09 gửi dưới app 2040029 — lần này đúng app dính lỗi). Anh kéo CAPTCHA; trả lời về hộp thư đăng ký Console. Nhắc ticket cũ 2098790879624904785 (Shopee 15/09: "provide complete and specific API call logs"; 10/10: "shop level once per minute should generally be allowed"). Dán phần A vào thân ticket, phần B (bảng request_id) vào ô mô tả hoặc đính kèm .txt. Câu trả lời ghi vào memory `hubsell-api-quota-san` + mục này.

**A. Thân ticket (tiếng Anh):**

> **Subject:** Persistent HTTP 429 `error_rate_limit` on `v2.ads.get_all_cpc_ads_daily_performance` at ~1 call per shop per 30 min — 168 request_ids in 24 h attached (follow-up to ticket 2098790879624904785)
>
> Hello Shopee Open Platform team,
>
> We are an approved ISV. Ads Service app **Hubsell Ads, partner_id 2044679** (live), ERP System app partner_id 2040029. About 50 Vietnamese shops have authorized the Ads app.
>
> In ticket 2098790879624904785 (Sept/Oct 2026) you asked us to provide complete and specific API call logs when we hit rate limits, and told us that at the shop level one call per minute should generally be allowed. We are now well below that and still receive HTTP 429, so here are the logs.
>
> **How we call the API**
> - `GET /api/v2/ads/get_all_cpc_ads_daily_performance?partner_id=2044679&shop_id=…&access_token=…&timestamp=…&sign=…&start_date=DD-MM-YYYY&end_date=DD-MM-YYYY` (GET, as documented; one window per call: either today only, or a 7-day window once every 6 hours per shop).
> - Per shop: **at most 1 call to this endpoint every 5 minutes**, in practice 1 call per 30 minutes plus 1 call per 6 hours. Other Ads endpoints per shop per 30 minutes: `get_product_level_campaign_id_list` (1–3 pages), `get_product_level_campaign_setting_info` (1–3 pages of 100), `get_product_campaign_daily_performance` (1–3 pages), `get_total_balance` (1).
> - App-wide: about **2 calls per minute** in total across all shops for `get_all_cpc_ads_daily_performance`, never more than 1 request per second for this endpoint, at most 2 shops processed concurrently.
> - On any HTTP 429 we stop calling that shop+endpoint for at least 5 minutes with exponential back-off (60 s × 2ⁿ), and we never retry immediately.
>
> **What we observe (22 Oct 2026 03:07 UTC → 23 Oct 2026 02:45 UTC, ~24 h)**
> - **168 responses HTTP 429** with body `{"error":"error_rate_limit","message":"Too many requests. You have reached the rate limit. Please try again later.","request_id":"…"}`: 151 on `get_all_cpc_ads_daily_performance`, 12 on `get_product_level_campaign_setting_info`, 3 on `get_total_balance`, 1 on `get_product_recommended_roi_target`, 1 on `get_create_product_ad_budget_suggestion`.
> - Spread over **41 different shops**; the worst shop got 8 × 429 out of ~48 calls in the day. 21 times, three or more *different* shops received 429 within the same 60 seconds.
> - The error code is the generic `error_rate_limit`, not `ads.rate_limit.exceed_partner_api` / `exceed_shop_api` / `exceed_api`, so we cannot tell which tier is being exceeded.
> - The rate is strongly **time-of-day dependent** with an unchanged calling pattern: 65 of the 168 errors occurred between **17:00 and 19:00 UTC** (00:00–02:00 Vietnam time), 22 more around 21:00 UTC; during the day we see only 1–8 per hour.
> - In the previous 24 h, before we added the per-shop 5-minute spacing, we saw 106 errors in 7.7 h in the same night window — the same rate. So slowing down per shop did not change anything, which suggests the limit is not per shop.
>
> **Questions**
> 1. From the request_ids below, which rate-limit tier was hit (partner / shop / global), and what is the effective limit and time window for `get_all_cpc_ads_daily_performance` at the partner level?
> 2. Is there a scheduled window around 17:00–19:00 UTC where the Ads reporting service throttles more aggressively (e.g. daily aggregation at day change)? If so, what time window should ISVs avoid?
> 3. What calling pattern do you recommend for an ISV that will serve thousands of shops (calls per minute per partner for this endpoint)? Is `get_product_campaign_daily_performance` or `get_all_cpc_ads_hourly_performance` subject to a higher limit, so we could switch?
> 4. Can the partner-level limit for app 2044679 be raised, and what is the process?
>
> We can provide the full list of 168 request_ids with timestamps, or any other log detail you need.
>
> Thank you,
> Hubsell (CÔNG TY TNHH CÔNG NGHỆ HUBSELL), partner_id 2044679

**B. Bảng request_id (lần 429 GẦN NHẤT của từng cặp shop × endpoint từ 03:07Z 22/10, 57 dòng; cột cuối = tổng số lần 429 của cặp ấy trong 24 h; mốc giờ UTC; nguồn `api_rate_keys.lastError`, log Render có đủ 168 dòng nếu Shopee đòi):**

| Time (UTC) | shop_id | endpoint | request_id | 429 count 24 h |
|---|---|---|---|---|
| 2026-10-22 04:12:48Z | 1384641433 | get_product_level_campaign_setting_info | e3e3e7f35e66139cfc1c39c1f8331d00 | 1 |
| 2026-10-22 04:27:49Z | 1065581055 | get_product_level_campaign_setting_info | e3e3e7f35e664941d8a6843e85c77f00 | 1 |
| 2026-10-22 04:52:48Z | 1250096431 | get_product_level_campaign_setting_info | e3e3e7f35e66a2a9dfa31025b0e10d00 | 1 |
| 2026-10-22 09:22:10Z | 73552250 | get_product_level_campaign_setting_info | e3e3e7f35e6a65fb73c7e67cc41af100 | 1 |
| 2026-10-22 10:22:10Z | 205206314 | get_product_level_campaign_setting_info | e3e3e7f35e6b3c9063ee9229ddc04300 | 1 |
| 2026-10-22 12:22:10Z | 18571602 | get_product_level_campaign_setting_info | e3e3e7f35e6ce9b7e849170e51ad4c00 | 1 |
| 2026-10-22 12:31:10Z | 1870873805 | get_total_balance | e3e3e7f35e6d09e556b70e7c3f9db400 | 1 |
| 2026-10-22 14:06:07Z | 1585463900 | get_all_cpc_ads_daily_performance | e3e3e7f35e6e5d738588ab63b3027c00 | 1 |
| 2026-10-22 15:46:40Z | 1384641433 | get_create_product_ad_budget_suggestion | e3e3e7f35e6fc511d6e8c0e763409700 | 1 |
| 2026-10-22 16:24:14Z | 1575931172 | get_all_cpc_ads_daily_performance | e3e3e7f35e704b64e086b4d1aa6b9600 | 2 |
| 2026-10-22 17:01:05Z | 1930291391 | get_all_cpc_ads_daily_performance | e3e3e7f35e70cf34119d183383cf8200 | 1 |
| 2026-10-22 17:55:05Z | 876556081 | get_all_cpc_ads_daily_performance | e3e3e7f35e7190500193bd6897e20d00 | 3 |
| 2026-10-22 17:55:45Z | 1397861848 | get_all_cpc_ads_daily_performance | e3e3e7f35e7192b2816224a4476ee800 | 4 |
| 2026-10-22 18:00:45Z | 1926744479 | get_all_cpc_ads_daily_performance | e3e3e7f35e71a493ce290effd74bd000 | 3 |
| 2026-10-22 18:12:43Z | 1652546671 | get_all_cpc_ads_daily_performance | e3e3e7f35e71cf614ed770b195b77b00 | 5 |
| 2026-10-22 18:16:03Z | 1930588674 | get_all_cpc_ads_daily_performance | e3e3e7f35e71db483365290b035e4000 | 3 |
| 2026-10-22 18:22:03Z | 1931400145 | get_all_cpc_ads_daily_performance | e3e3e7f35e71f0c43dd40baabaf3df00 | 2 |
| 2026-10-22 18:31:04Z | 1575931172 | get_total_balance | e3e3e7f35e7210fbcc9a938a4e9e6a00 | 1 |
| 2026-10-22 18:34:23Z | 1883811931 | get_all_cpc_ads_daily_performance | e3e3e7f35e721cdf1e7a47e027823700 | 8 |
| 2026-10-22 19:04:03Z | 1235396119 | get_all_cpc_ads_daily_performance | e3e3e7f35e7286f56e3e4fe11478a900 | 1 |
| 2026-10-22 19:06:03Z | 1913686550 | get_all_cpc_ads_daily_performance | e3e3e7f35e728e1d34fb27f741576200 | 3 |
| 2026-10-22 20:12:05Z | 311994642 | get_product_level_campaign_setting_info | e3e3e7f35e737a46d9cf2d7250a38f00 | 1 |
| 2026-10-22 20:30:03Z | 45215540 | get_all_cpc_ads_daily_performance | e3e3e7f35e73ba85681af6b62bc9e200 | 3 |
| 2026-10-22 20:31:04Z | 73552250 | get_total_balance | e3e3e7f35e73be27b289df83c87f5200 | 1 |
| 2026-10-22 20:42:03Z | 1651509470 | get_all_cpc_ads_daily_performance | e3e3e7f35e73e5718b481897924bc000 | 6 |
| 2026-10-22 21:06:16Z | 36477688 | get_all_cpc_ads_daily_performance | e3e3e7f35e743c0acaf4b75753b07000 | 2 |
| 2026-10-22 21:07:43Z | 1563500543 | get_all_cpc_ads_daily_performance | e3e3e7f35e74413b03d67d6bf9de6500 | 5 |
| 2026-10-22 21:08:23Z | 1814992595 | get_all_cpc_ads_daily_performance | e3e3e7f35e74439eb0a2ccf5c2a4b200 | 4 |
| 2026-10-22 21:10:23Z | 1065581055 | get_all_cpc_ads_daily_performance | e3e3e7f35e744ac0b7177491357d7e00 | 4 |
| 2026-10-22 21:10:43Z | 251437239 | get_all_cpc_ads_daily_performance | e3e3e7f35e744bf664914124677f5000 | 1 |
| 2026-10-22 21:12:03Z | 71717550 | get_all_cpc_ads_daily_performance | e3e3e7f35e7450b6e6142b9ac4ab8800 | 3 |
| 2026-10-22 21:14:23Z | 1870873805 | get_all_cpc_ads_daily_performance | e3e3e7f35e7459129106684ffedc7000 | 2 |
| 2026-10-22 21:18:03Z | 1359898174 | get_all_cpc_ads_daily_performance | e3e3e7f35e74662c33951aca17f32500 | 7 |
| 2026-10-22 21:18:03Z | 1604677622 | get_all_cpc_ads_daily_performance | e3e3e7f35e746630abc8b32d8a08f000 | 5 |
| 2026-10-22 21:24:03Z | 1527159701 | get_all_cpc_ads_daily_performance | e3e3e7f35e747ba61bd4f699f58ff000 | 5 |
| 2026-10-22 21:48:03Z | 1932588402 | get_all_cpc_ads_daily_performance | e3e3e7f35e74d17a0f9831b9ddce7e00 | 6 |
| 2026-10-22 21:48:03Z | 331545740 | get_all_cpc_ads_daily_performance | e3e3e7f35e74d17ad41d3930a3dfb100 | 7 |
| 2026-10-22 21:51:45Z | 453810830 | get_all_cpc_ads_daily_performance | e3e3e7f35e74deb5cb2061c364e80e00 | 7 |
| 2026-10-22 21:51:46Z | 311994642 | get_all_cpc_ads_daily_performance | e3e3e7f35e74debdec7c5e4d3ce5b900 | 4 |
| 2026-10-22 22:00:03Z | 1231083004 | get_product_level_campaign_setting_info | e3e3e7f35e74fc637f68cc974944e800 | 1 |
| 2026-10-22 22:01:23Z | 1384641433 | get_all_cpc_ads_daily_performance | e3e3e7f35e750129e4ec6f790ca63e00 | 2 |
| 2026-10-22 22:05:29Z | 1359898174 | get_product_recommended_roi_target | e3e3e7f35e750fd1734f157d04f0e700 | 1 |
| 2026-10-22 22:22:43Z | 338432799 | get_product_level_campaign_setting_info | e3e3e7f35e754d72b9f196ac6e32c900 | 1 |
| 2026-10-22 22:23:03Z | 1932588402 | get_product_level_campaign_setting_info | e3e3e7f35e754ea3595d090a41ae7000 | 1 |
| 2026-10-22 22:25:03Z | 1613456688 | get_product_level_campaign_setting_info | e3e3e7f35e7555cc036b24a9bd628500 | 1 |
| 2026-10-22 22:28:23Z | 876556081 | get_product_level_campaign_setting_info | e3e3e7f35e7561b7287c7ef173bcb100 | 1 |
| 2026-10-22 22:31:43Z | 1250096431 | get_all_cpc_ads_daily_performance | e3e3e7f35e756da0cbf3c3f3ca601600 | 6 |
| 2026-10-22 23:03:44Z | 1613456688 | get_all_cpc_ads_daily_performance | e3e3e7f35e75e0253758d959bce00200 | 5 |
| 2026-10-22 23:04:04Z | 239068349 | get_all_cpc_ads_daily_performance | e3e3e7f35e75e14fe3903f5288aa3b00 | 2 |
| 2026-10-22 23:31:03Z | 1528599948 | get_all_cpc_ads_daily_performance | e3e3e7f35e7641d45945a649c352c600 | 4 |
| 2026-10-23 00:05:43Z | 55694502 | get_all_cpc_ads_daily_performance | e3e3e7f35e76bdcd12618a0ab221cf00 | 1 |
| 2026-10-23 00:12:04Z | 73552250 | get_all_cpc_ads_daily_performance | e3e3e7f35e76d486600b995e120d5200 | 3 |
| 2026-10-23 00:24:04Z | 338432799 | get_all_cpc_ads_daily_performance | e3e3e7f35e76ff6777a0da057f3e1700 | 5 |
| 2026-10-23 00:24:04Z | 1921831240 | get_all_cpc_ads_daily_performance | e3e3e7f35e76ff689dd34ea546c16600 | 3 |
| 2026-10-23 00:55:04Z | 18571602 | get_all_cpc_ads_daily_performance | e3e3e7f35e776e4b14fde98fff53c700 | 2 |
| 2026-10-23 01:04:04Z | 1231083004 | get_all_cpc_ads_daily_performance | e3e3e7f35e778e785f19deee57279600 | 5 |
| 2026-10-23 01:04:24Z | 321467988 | get_all_cpc_ads_daily_performance | e3e3e7f35e778faca16f7ced23d1a700 | 6 |

Khóa app × endpoint `get_all_cpc_ads_daily_performance` (không có shop): request_id `e3e3e7f35e74531d45a62d10a446d600` lúc 2026-10-22 21:12:43Z — 117 lần tích lũy từ 21/10.

**Ghi chú cho mình (không gửi):** phương thức GET đúng docs (`callShopGet`), loại khả năng Shopee hay viện "sai HTTP method"; mọi dòng 429 đều có request_id (client đọc thân 429 từ 28/09). Trong lúc chờ trả lời: KHÔNG chỉnh số, KHÔNG mở C2/D/C3; C1 thẻ HQ (chỉ đọc) vẫn làm được khi anh gọi.

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

## 13. Chống lỗi dây chuyền ở quy mô lớn — 4 lát (anh Trung chốt 17/10/2026, BẮT ĐẦU 18/10)

### 13.1 Vì sao

- Cầu dao bật/tắt theo app: 429 lẻ tẻ của vài gian → dừng Ads của MỌI gian 5–60'.
  Đã vá ngưỡng (Tầng C, sửa 17/10) nhưng bản chất vẫn là "chạy hết tốc hoặc đứng hẳn".
- **Đường lan sang đơn hàng (đọc mã 17/10, CHƯA ĐO):** xung Ads chạy CHUNG slot với
  đồng bộ đơn (`order-auto-sync.ts`: quét đơn → xung Ads → đối soát giờ → Ads lịch sử,
  trong `AUTO_SYNC_CONCURRENCY` = 3 slot). Ads chờ token / bị chặn = giữ slot → đơn và
  đối soát của gian khác xếp sau. Sự cố quảng cáo có thể làm chậm đơn hàng.
- **Sức chứa:** 50.000 gian × xung 30' × ~5 lệnh ≈ 12 triệu lệnh/ngày ≈ 140 lệnh/giây
  (riêng Ads Shopee). `ADS_APP_QPS = 3` ≈ 260.000 lệnh/ngày ≈ **~1.000 gian** ở nhịp hiện
  tại. Hàng chờ chỉ dàn đều đợt dồn, KHÔNG tạo thêm quota → quota là trần thật.
- **Đầu mối gốc 429 lẻ tẻ:** Shopee trả lời 10/10 "cấp shop ~1 call/phút là được", còn
  xung gọi 5–7 lệnh liền nhau cho một gian trong vài giây, và lệnh dính 429 luôn là
  `get_all_cpc_ads_daily_performance` = lệnh thứ 4 của xung. Giả thuyết, chưa đo.

### 13.2 Nguyên tắc

1. **Tách khoang:** Ads hỏng không được chạm đơn / tồn / dòng tiền.
2. **Cách ly theo gian:** một gian bị chặn chỉ gian đó lùi.
3. **Chậm dần thay vì đứng hẳn:** điều tốc, không bật/tắt (trừ mã vượt trần app thật).
4. **Hàng chờ phải có gộp + ưu tiên + hạn chót + đồng hồ đo tồn** — không xếp vô hạn.
   Hàng chờ = các cột lịch `next*At` trên Channel (mỗi gian một dòng, gộp sẵn). KHÔNG
   dùng pg-boss cho từng lệnh API (12 triệu việc/ngày, bẫy gộp theo khóa).
5. **Logic tách khỏi thông số:** mọi số ở 13.4 nằm trong `config/ads-cadence.ts` (đọc env,
   có mặc định), mã không rải số. Đo xong chỉ đổi env / một dòng cấu hình.

### 13.3 Bốn lát (làm theo thứ tự)

| Lát | Việc | Kết quả cho seller |
|---|---|---|
| 1 | **Tách làn Ads** khỏi vòng đồng bộ đơn: vòng nhặt việc riêng (gian có `nextAdsPulseAt` / `nextAdsSyncAt` đến hạn), khóa riêng, số luồng riêng. Có thể cần cột `adsLockedAt` → trình SQL trước. | Ads sập / bị chặn hẳn thì đơn, tồn, dòng tiền vẫn chạy bình thường |
| 2 | **Cách ly theo gian, lưu DB:** 429 → gian đó lùi theo bậc, có xáo trộn; bậc lưu DB (khởi động lại / nhiều worker vẫn đúng). Kèm **giãn lệnh trong một xung** của cùng gian (thử nghiệm giả thuyết 13.1). | Một gian bị chặn không ảnh hưởng gian khác |
| 3 | **Điều tốc thích ứng (AIMD)** thay cầu dao bật/tắt: tỷ lệ 429 tăng → hạ tốc; khỏe → tăng dần tới trần. Cầu dao dừng hẳn chỉ còn cho `exceed_partner_api`. | Số chậm hơn chút, không bao giờ đứng hẳn |
| 4 | **Ưu tiên + hạn chót + đo nhu cầu/quota** (gộp lát 3.4 GĐ3 — chia quota giữa worker): nhóm 1 gian bật Trợ lý tự thực thi + đang tiêu tiền, nhóm 2 có chiến dịch chạy, nhóm 3 không ads; xung trễ > hạn chót thì bỏ chờ xung kế; nhu cầu vượt ngưỡng → tự giãn nhóm 3 rồi nhóm 2; thẻ HQ "Nhu cầu / Quota Ads". | Gian cần cảnh báo tiền luôn được phục vụ trước |

### 13.4 Thông số — TẤT CẢ là số TỰ CHỌN tới khi đo

| Thông số (env) | Khởi điểm | Lát | Nguồn | Đo lại ở mốc |
|---|---|---|---|---|
| `ADS_STORM_RATIO` (tỷ lệ gian dính 429 → bão) | 0,2 | đã có (17/10) — lát 3 thay bằng ngưỡng AIMD | tự chọn | Đ1 |
| `ADS_CONCURRENCY` (số luồng làn Ads) | 2 | 1 | tự chọn | Đ1, Đ2 |
| `ADS_SHOP_BACKOFF_MIN` / `_MAX_MIN` (lùi gian) | 15' → 120' | 2 — ĐÃ CÓ 19/10 (13.8) | 15' có từ 28/09; 120' tự chọn | Đ1 |
| `ADS_SHOP_CALL_GAP_SEC` (giãn lệnh trong xung một gian) | 0 (tắt) → thử 5 | 2 — ĐÃ CÓ 19/10 (13.8), mặc định TẮT | Shopee 10/10 "~1 call/phút cấp shop" là hướng dẫn chung | Đ1 (so 429 bật/tắt) |
| `ADS_AIMD_DECREASE` (hạ tốc) | × 0,5 | 3 | tự chọn (kiểu TCP) | Đ2 |
| `ADS_AIMD_INCREASE_PCT` (tăng mỗi phút) | +10 % | 3 | tự chọn | Đ2 |
| `ADS_AIMD_TRIGGER` (tỷ lệ 429 / lệnh để hạ tốc) | 5 % | 3 | tự chọn | Đ1, Đ2 |
| `ADS_APP_QPS` (trần) | 3 | có sẵn | tự chọn (Shopee không công khai) | Đ3 (ticket) |
| `ADS_DEMAND_STRETCH_PCT` (nhu cầu / quota → giãn nhịp) | 80 % | 4 | tự chọn | Đ4 |
| `ADS_PULSE_DEADLINE_X` (hạn chót = x × nhịp) | 2 | 4 | tự chọn | Đ2 |

### 13.5 Lịch đo lại (đếm **gian Shopee ACTIVE nối app Hubsell Ads**, vì quota tính theo app)

| Mốc | Khi nào | Đo gì | Việc |
|---|---|---|---|
| Đ0 | Sáng 18/10, trước lát 1 | tripCount/ngày, log `[ApiBudget] 429` (gian, lệnh, giờ), thời gian giữ slot của xung | Mốc gốc để so |
| Đ1 | **7 ngày sau lát 3 lên prod** (cỡ 30–60 gian) | tỷ lệ 429/gian/ngày, lệnh/xung thật, 429 khi bật/tắt giãn lệnh | Chỉnh 15', `CALL_GAP`, `AIMD_TRIGGER`, `CONCURRENCY` |
| Đ2 | **200 gian** (~20 % sức chứa) | tốc độ AIMD có dao động không, độ trễ xung nhóm 1 | Chỉnh hạ/tăng, hạn chót |
| Đ3 | **500 gian** (~50 % sức chứa) | nhu cầu / quota thật, log 429 kèm request_id | **Mở ticket Shopee xin nâng quota** (lần trước 12/09 → 10/10 mới trả lời ≈ 4 tuần, nên phải mở ở nửa đường) |
| Đ4 | **800 gian** (~80 %) | giãn nhịp tự động có kích hoạt đúng, nhóm 1 giữ nhịp | Chỉnh `DEMAND_STRETCH_PCT`; quota chưa nâng thì báo anh |

Chưa chạm mốc gian thì vẫn đo theo thời gian: Đ1 xong thì 30 ngày/lần đọc lại 13.4.

### 13.6 Nhắc nhở

- **Trên HQ (làm trong lát 1):** thêm chỉ số `shopeeAdsShops` vào `GrowthMetrics`
  (`config/capacity-plan.ts`) và các mốc Đ2/Đ3/Đ4 có checklist → HQ tự hiện "sắp chạm
  mốc" + ngày dự kiến như các mốc hạ tầng M1…, không phụ thuộc trí nhớ.
- **Memory** `hubsell-cau-dao-ads-bao-429-theo-gian` ghi lịch đo, mỗi phiên đọc lại.

### 13.7 LÁT 1 ĐÃ LÀM (19/10/2026 chiều) — tách làn Ads khỏi vòng đồng bộ đơn

**Đ0 lúc làm lát 1 (Supabase, 19/10 14:40 VN):** `shopee:2044679` tripCount **135** (17/10 tối 114 → 18/10 20:10 125 → 19/10 135, ≈ +10/ngày
dù đã có ngưỡng tỷ lệ), lần đóng gần nhất 19/10 11:18 VN bậc 1 (10') lý do "Bão 429: 3/15 gian đã gọi trong 10' bị chặn";
lúc đọc không đóng. `shopee:2040029` (app chính) 14, lần cuối 15/09. → Mốc gốc để so sau lát 2–3.

**Đã code (commit cùng ngày):**

| Việc | Ở đâu |
|---|---|
| Hàm hai tầng ads (xung Shopee/Lazada/TikTok, lịch sử, lượt ngày TikTok, `nextPulseDelayMin`) tách khỏi `order-auto-sync.ts` — KHÔNG đổi logic | `workers/ads-tiers.ts` (`runAdsPulse`, `runAdsHistory`) |
| Worker làn Ads: tick 20 s, nhặt gian `nextAdsPulseAt` null/đến hạn HOẶC `nextAdsSyncAt` đến hạn, claim bằng UPDATE có điều kiện trên **`Channel.adsLockedAt`** (cột mới), chạy xung rồi lịch sử, ghi hạn + nhả vé. Hàm thuần `dueAdsTiers`, `adsCandidateWhere`, `nextAdsSchedule` có test | `workers/ads-lane.ts` |
| Vòng đồng bộ đơn: query nhặt vé bỏ 3 điều kiện ads, `dueTiers(..., adsHere)` trả ads/pulse = false khi làn Ads bật; chỉ còn tầng nhanh + tầng giờ | `workers/order-auto-sync.ts` |
| Đường lui `ADS_LANE=0`: worker ads-lane không chạy, vòng đơn nhặt lại cả hai tầng như trước 19/10 (`adsInOrderSync()`) | `config/ads-cadence.ts` `LANE` |
| Thông số lát 1 qua env: `ADS_CONCURRENCY` (2), `ADS_LOCK_STALE_MINUTES` (30 — lượt ngày TikTok dài), `ADS_STORM_RATIO` (0,2 — chuyển từ hằng `RATE_LIMIT_STORM.ratio` theo yêu cầu 17/10) | `config/ads-cadence.ts` |
| Migration: `Channel.adsLockedAt`, chỉ mục `(status, nextAdsSyncAt)`, `platform_health_snapshots.adsShops`; khóa Channel có thử lại | `prisma/migrations/20261019150000_channel_ads_lane` |
| HQ (13.6): `GrowthLayer.channelsHubsellAds` (gian Shopee ACTIVE nối Hubsell Ads), `GrowthMetrics.shopeeAdsShops`, chuỗi mốc **`ADS_QUOTA_MILESTONES` D2/D3/D4** (200/500/800, Đ3 = mở ticket) với ETA theo snapshot; thẻ "Quota Ads Shopee" dưới timeline `/admin/health`; xung ads trễ / vé mồ côi đọc theo `adsLockedAt` | `config/capacity-plan.ts`, `services/platform-health.ts`, `routes/admin-health.ts`, FE `admin/health/page.tsx` |

**Kiểm:** 104 test liên quan xanh (ads-lane 11 ca mới, schedule, no-module-state, capacity 5 ca mới, api-budget, platform-health);
toàn backend 1.429 pass / 5 tệp DB-drift cũ (GIN sổ cái, channel-delete, delivery-fail-park, log-cleanup, order-ledger — không liên
quan); tsc backend + frontend + eslint sạch; `scripts/health-smoke.ts` trên DB dev: channelsHubsellAds 0, D2 0/200, M1 → M2.
**Chưa chạy sàn thật** — kiểm sau deploy: log worker có `[Ads-lane] BẬT — làn Ads riêng: song song 2 gian…` và `[Auto-sync] BẬT … hai tầng
ads do làn riêng ads-lane nhặt`; `[Ads-pulse]`/`[Ads-GMS]` vẫn xuất hiện; HQ Sức khỏe không tăng "xung ads trễ".

**Hệ quả cần nhớ:** gian được nhặt vì ads đến hạn KHÔNG còn "tiện vét đơn luôn" (tầng nhanh vốn chạy mọi lượt của vòng cũ) — đơn
vẫn theo `nextFastSyncAt` 10'–60' riêng, webhook lo real-time; đây đúng là mục tiêu tách khoang. Số luồng tổng tăng 3 → 3 + 2
(hai vòng) → đo RAM worker ở Đ1. Lát 2 (cách ly theo gian, bậc lùi lưu DB + giãn lệnh trong xung) nối vào `ads-lane.ts`.

### 13.8 LÁT 2 ĐÃ LÀM (19/10/2026 chiều, ngay sau lát 1 theo anh Trung "làm luôn lát 2") — cách ly 429 theo gian

**Trước:** 429 tầng shop ở xung → gian lùi cố định 15' (RAM, không bậc); ở lịch sử → chỉ bỏ lượt, 6 h sau thử lại; xung dính 429
vẫn gọi tiếp lịch sử trong cùng lượt. Một gian bị sàn chặn liên tục vẫn gõ đều mỗi 15' và vẫn góp vào tỷ lệ bão.

**Sau:**

| Việc | Ở đâu |
|---|---|
| Bậc lùi riêng của gian LƯU DB: `Channel.adsBackoffLevel` (0 = không lùi) + `adsBackoffUntil`; migration khóa Channel có thử lại | `prisma/migrations/20261019170000_channel_ads_backoff` |
| Hàm tầng trả cờ bị chặn: `AdsPulseResult.rateLimited` / `AdsHistoryResult.rateLimited` = "shop" (429 tầng shop) · "app" (cầu dao app đang đóng) · null; lịch sử Shopee gom cờ từ mọi khối catch (spend, campaign, GMS, signals), "shop" thắng "app" | `workers/ads-tiers.ts` |
| Làn Ads: (1) không nhặt gian có `adsBackoffUntil > now` (`adsCandidateWhere`); (2) xung dính "shop" → KHÔNG gọi tiếp lịch sử trong lượt; (3) `nextAdsSchedule`: "shop" ở xung hoặc lịch sử → `adsBackoffUntil = now + shopBackoffMs(bậc)`, bậc +1 (trần log2(120/15) = 3), hạn xung đẩy tới hết lùi; lượt kéo được số và không bị chặn → bậc 0; "app" → không đổi bậc (không phải lỗi của gian); log `[Ads-lane] … lùi riêng bậc N tới …` / `… khỏe lại — bậc lùi về 0` | `workers/ads-lane.ts` (`shopBackoffMs`, `nextBackoffLevel`) |
| Giãn lệnh trong một xung của cùng gian: `withApiBudget` chờ tới `mốc gọi cuối của gian + ADS_SHOP_CALL_GAP_SEC` (mốc đã có sẵn cho tỷ lệ bão) — áp cả Shopee lẫn Lazada Ads; mặc định 0 = tắt, bật bằng env để thử giả thuyết 13.1 | `services/api-budget.ts` (`shopCallWaitMs`) |
| HQ: `worker.adsBackingOff` (gian đang lùi riêng) + dòng gợi ý trên dải KPI | `services/platform-health.ts`, FE `admin/health/page.tsx` |
| Đường lui `ADS_LANE=0` giữ hành vi cũ (lùi 15' cố định, không bậc DB) | `workers/ads-tiers.ts` |

**Kiểm:** 115 test liên quan xanh (ads-lane 20 ca, api-budget +2), tsc BE+FE + eslint sạch, `health-smoke.ts` DB dev OK.
**Chưa chạy sàn thật.** Sau deploy đọc log worker: `[Ads-lane] BẬT … lùi riêng gian dính 429 15'→120', giãn lệnh trong xung 0s`,
rồi vài ngày sau đếm `[Ads-lane] … lùi riêng bậc` theo gian (gian nào lặp bậc 2–3 = bị sàn siết thật) và so tripCount
`shopee:2044679` (Đ0 = 135 lúc 14:40 19/10) — kỳ vọng tốc độ +10/ngày giảm vì gian bị chặn không còn gõ lại mỗi 15' trong lúc
bị chặn. Giãn lệnh: bật `ADS_SHOP_CALL_GAP_SEC=5` trên worker ở lượt đo Đ1 (so 429/gian/ngày bật vs tắt), chưa bật mặc định.

**Chưa làm (lát 3):** cầu dao app vẫn bật/tắt theo bão; AIMD thay ngưỡng tỷ lệ; `exceed_partner_api` giữ cầu dao dừng hẳn.
**Lịch nhắc đã đặt (anh Trung 19/10: "lát 3 chưa làm thì đặt lịch không lại quên"):** tác vụ `hubsell-nhac-2310-cau-dao-ads-lat-3-aimd`
chạy **23/10/2026 08:30** — đọc tripCount vs Đ0 135 + SQL gian đang lùi riêng + log `[Ads-lane]`, rồi TRÌNH lát 3 AIMD (chưa code
tới khi anh chốt). Lát 4 đặt lịch sau khi lát 3 lên prod (Đ1 = 7 ngày sau lát 3).

### 13.9 THIẾT KẾ LẠI (21/10/2026 đêm) — một hệ thống cho MỌI gian, không vá theo gian

**Vì sao phải thiết kế lại chứ không làm tiếp lát 3–4 như 13.3.** Anh Trung 21/10: "không muốn vá lẻ cho từng shop
khi gặp vấn đề, phải có một hệ thống đảm bảo cho tất cả các shop mới liên kết". Nhìn lại 28/09 → 21/10 có 4 lần sửa
cùng một chỗ (đếm theo lần → theo gian → thêm tỷ lệ → cách ly gian) và tripCount vẫn ~12/ngày (135 → 162 từ 19/10 trưa
tới 21/10 đêm). Mỗi lần sửa đều đúng với số gian lúc đó rồi sai khi gian tăng, vì bản chất thiết kế là:

| Thiết kế hiện tại | Vì sao không chịu được khi N gian tăng |
|---|---|
| Nhịp cố định 30'/gian, số luồng cố định | Nhu cầu gọi = N × lệnh/xung ÷ 30', tăng tuyến tính theo N; không ai so với sức chứa |
| Token bucket trong RAM từng tiến trình (`ADS_APP_QPS=3`) | Không khớp hình dạng trần thật của sàn (app × endpoint ~1 lệnh/giây — H4); hai luồng cùng gọi một endpoint trong một giây là chuyện thường |
| Cầu dao bật/tắt theo "bão" với ngưỡng tay (3 gian, 20 %) | Ngưỡng đúng ở N = 7, sai ở N = 29, sai kiểu khác ở N = 40; 429 lẻ của một endpoint làm đứng số mọi gian |
| Lùi theo gian (lát 2) | Chữa gian trong khi bệnh là khóa app × endpoint — gian không có lỗi gì |
| Chỉ biết sập khi HQ đỏ | Không có số "nhu cầu / sức chứa" để thấy trước |

**Cái đã có và đúng (Pha B, 19/10, docs CUNG-HOA-LOP-GOI-SAN 5b):** cổng gọi sàn `services/marketplace-gateway.ts`
+ `lib/rate-gate.ts` + bảng `api_rate_keys` (GCRA trong Postgres, dùng chung mọi tiến trình), khóa `(app)`,
`(app, gian)`, `(app, endpoint)`, AIMD hạ nhịp theo khóa khi 429, lùi full jitter + Retry-After, "dừng app" chỉ cho
lỗi cứng (`exceed_partner_api`, Lazada ApiCallLimit). Đã có trần cho đúng endpoint `get_all_cpc_ads_daily_performance`
(1/s, burst 2). **Đường Ads chưa đi qua cổng** — vẫn `withApiBudget` cũ. Thiết kế dưới đây KHÔNG viết thêm bộ điều tốc
nào; nó nối Ads vào cổng và bổ phần còn thiếu: nhu cầu tự co theo sức chứa, ưu tiên, bằng chứng bằng test.

#### 13.9.1 Bất biến hệ thống phải giữ với MỌI N (đây là "hợp đồng", test phải chứng minh từng dòng)

| # | Bất biến | Cơ chế | Có sẵn? |
|---|---|---|---|
| I1 | Tổng nhịp gửi lên mỗi khóa (app / app×gian / app×endpoint) không vượt sức chứa đã biết, **trước khi gọi**, chung cho mọi worker | GCRA Postgres (`api_rate_take`) | ✅ cổng |
| I2 | Sức chứa là số **học được**, không phải ngưỡng tay: 429 → nhịp khóa × 0,5, hồi tuyến tính; trần cấu hình chỉ là trần trên | AIMD theo khóa (`api_rate_penalize`) | ✅ cổng; ⚠️ khóa chưa có trần thì AIMD không tác dụng (hệ số nhân với 0) → **mọi endpoint Ads phải có trần khởi điểm** (13.9.3) |
| I3 | Một khóa bị 429 không bao giờ làm khóa khác chờ; "dừng cả app" chỉ khi sàn nói đúng mã cứng | phân loại lỗi 3 sàn trong cổng | ✅ cổng; ⛔ bỏ luật "bão" + `ApiThrottleState` |
| I4 | **Nhu cầu tự co theo sức chứa:** nhịp xung của từng lớp gian là HÀM của (số gian, lệnh/xung, sức chứa khóa), giữ nhu cầu ≤ 80 % sức chứa; gian mới nối = nhu cầu tăng = nhịp lớp thấp tự giãn, không ai sửa env | `services/ads-demand.ts` (thuần) — 13.9.2 | ❌ mới |
| I5 | Ưu tiên + hạn chót: gian đang tiêu tiền và bật Trợ lý được phục vụ trước; xung trễ quá hạn chót thì bỏ, chờ xung kế, **không xếp hàng vô hạn** | làn Ads sắp theo (lớp, hạn); hạn chót = 2 × nhịp lớp | ❌ mới (lát 4 cũ) |
| I6 | Mỗi số chỉ hỏi sàn **một lần** mỗi chu kỳ mỗi gian | gộp `daily_performance` xung + lịch sử; cờ ví tự nạp sang tầng 6 h | ❌ mới |
| I7 | Không dồn cục: mọi lịch có xáo trộn; gian mới nối rải lịch đầu trong một chu kỳ; sau khi khóa mở lại, gian gọi theo thứ tự hạn qua GCRA, không "xả" | jitter có sẵn + cổng | ✅ phần lớn |
| I8 | Thấy trước khi thiếu: HQ hiện mỗi khóa **sức chứa hiện tại × hệ số AIMD, nhu cầu, % dùng, tỷ lệ 429, hệ số giãn từng lớp, số gian trễ hạn**; lớp 1 phải giãn = đỏ = mở ticket Shopee (Đ3 không còn đếm gian mà đếm % dùng) | thẻ HQ mới thay thẻ "Cầu dao" | ❌ mới |
| I9 | **Bằng chứng bằng test, không bằng prod:** sàn giả trần app×endpoint 1/s, N = 1.000 và 10.000 gian, đồng hồ giả → 0 lần dừng app, 429 < 1 % lệnh, độ trễ xung lớp 1 ≤ hạn chót, nhu cầu ≤ 80 % | mở rộng `fake-marketplace.ts` cho Ads | ❌ mới |

#### 13.9.2 Bài toán sức chứa (I4) — công thức, không ngưỡng

Với khóa K có sức chứa `c_K` lượt/giây (= trần cấu hình × hệ số AIMD hiện tại), lớp gian p có `N_p` gian, mỗi xung cần
`n_{K,p}` lệnh trên K, nhịp xung `T_p` (giây): nhu cầu `D_K = Σ_p N_p · n_{K,p} / T_p`. Điều kiện: `D_K ≤ u · c_K`,
`u = 0,8`. Bộ tính (chạy mỗi 5' trong làn Ads, thuần, mọi worker tính ra cùng kết quả từ cùng số đếm DB):

1. `T_p` = nhịp gốc (30' Shopee / 60' Lazada, TikTok) cho mọi lớp.
2. Nếu vượt: giãn lớp 3 (nối Ads, không chiến dịch chạy) tới trần 24 h; vẫn vượt → giãn lớp 2 (có chiến dịch chạy,
   không bật Trợ lý) tới 6 h; vẫn vượt → giãn lớp 1 (đang tiêu tiền + Trợ lý tự thực thi) tới 2 h.
3. Lớp 1 phải giãn → tín hiệu đỏ HQ "thiếu quota, mở ticket" (I8). Hệ thống **không tạo thêm quota**; nó bảo đảm không
   sập và báo trước khi thiếu.

Số hôm nay để thấy ý nghĩa: `get_all_cpc` 1/s = 86.400 lượt/ngày; mỗi gian 48 xung + 4 lịch sử = 52 lượt/ngày sau khi
gộp (I6) → ~1.330 gian ở 80 %. 40 gian hiện tại = 2,4 % — tức 429 hôm nay **không phải thiếu quota mà là dồn cục**
(hai luồng cùng giây), đúng việc GCRA giải quyết. Tới ~1.300 gian nhịp lớp 3 mới bắt đầu giãn; tới 50.000 gian thì
lớp 1 cũng không đủ ở 30' → phải có quota theo app cao hơn (ticket Đ3) hoặc trần thật là theo gian (khi đó không thiếu).
Thiết kế này làm con số ấy hiện ra trên HQ hàng ngày thay vì phát hiện khi sập.

#### 13.9.3 Thay đổi mã (thứ tự làm = thứ tự rủi ro thấp → cao; mỗi bước có đo + tiêu chí trước khi bước sau)

| Bước | Việc | Đo / tiêu chí qua |
|---|---|---|
| **A. Nối Ads Shopee vào cổng** (1 ngày) | `shopee/client.ts` `callShopGet/Post`: `isAdsPath` → `callMarketplace({platform:"SHOPEE", app: partner_id, shop: shop_id, endpoint: path})` thay `withApiBudget`; **trần khởi điểm cho 7 endpoint Ads Shopee** trong `RATE_LIMITS.endpoint` (TỰ CHỌN 2/s burst 2, riêng `get_all_cpc` 1/s đã đo) để AIMD có tác dụng; làn Ads bắt `GatewayDeferError` → `nextAdsPulseAt = now + waitMs` (+jitter), **không bậc**; đường lui `ADS_GATEWAY=0` về `withApiBudget`. Lát 2 (`adsBackoff*`) ngừng ghi. | 24 h log `[gateway] 429` theo khóa + `api_rate_keys.failures`: kỳ vọng 429 trên `get_all_cpc` → ~0 (từ ~30/ngày); **0 lần "dừng app"**; nếu 429 còn ≥ 5/ngày trên khóa đó → trần thật thấp hơn 1/s, AIMD đã hạ — đọc `factor` để biết số thật, KHÔNG sửa tay |
| **B. Nhu cầu tự co + ưu tiên + hạn chót + gộp lệnh** (2 ngày) | `services/ads-demand.ts` (thuần: `computeCadence(classes, capacities)`), lớp gian = hàm thuần từ `AdsCampaign`/`Channel` (3 lớp 13.3 lát 4), làn Ads sắp theo (lớp, hạn), bỏ xung quá hạn chót; gộp `daily_performance` xung/lịch sử (một lệnh 30 ngày khi lịch sử đến hạn), cờ ví tự nạp sang 6 h; mọi số chính sách (nhịp gốc, trần nhịp từng lớp, u = 0,8, hạn chót ×2) trong `config/ads-cadence.ts`; **xóa** `STORM_RATIO`, `SHOP_BACKOFF_*`, `SHOP_CALL_GAP_SEC`, `CONCURRENCY` chỉ còn là số luồng worker (cổng mới là van) | Test I9 trên sàn giả: N = 40 / 1.000 / 10.000, trần 1/s: 0 dừng app, 429 < 1 %, trễ lớp 1 ≤ hạn chót, D ≤ 0,8 c; prod 3 ngày: lớp 1 không trễ, `[gateway] 429` không tăng |
| **C. HQ + gỡ cũ** (1 ngày) | Thẻ "Quota Ads theo khóa" (I8) thay thẻ Cầu dao; mốc Đ2–Đ4 đổi điều kiện từ "số gian" sang "% dùng khóa"; gỡ `api-budget.ts` token bucket + bão + `ApiThrottleState`, cột `Channel.adsBackoffLevel/Until` (migration bỏ cột sau 7 ngày chạy ổn) | HQ hiện đúng số cổng; không còn log `[ApiBudget]` |
| **D. Lazada + TikTok Ads cùng cổng** (1 ngày) | `lazada/client.ts` Ads → `callMarketplace` (khóa app, app×gian băm); `tiktok-ads/client.ts` bỏ `acquireApiToken` RAM → khóa `(app, advertiser)` (trần 240/phút theo docs TikTok) | như A cho từng sàn |

**Gian mới nối** đi đúng đường này không cần việc riêng: lượt nạp 30 ngày đầu đi làn backfill lớp 3 qua cổng (GCRA dàn
đều), lịch xung đầu rải ngẫu nhiên trong một chu kỳ, lớp gian tự xếp theo dữ liệu. Không có bước "cấu hình cho gian".

#### 13.9.4 Điều chưa chắc — nói rõ để anh quyết

1. Hình dạng trần `get_all_cpc` 1/s suy từ **một** quan sát (2 gian 429 cùng giây 17:58:25 ngày 18/10). Thiết kế không
   phụ thuộc số đúng: AIMD hạ về số thật, HQ hiện `factor`. Bước A đo 24 h là kiểm chứng.
2. Sáu endpoint Ads còn lại chưa thấy 429 bao giờ → trần khởi điểm 2/s là tự chọn; cổng học xuống nếu sai.
3. Cổng thêm một vòng đi-về Postgres mỗi lệnh (H5 đo p50 4,4 ms; 1.755 lệnh/giây). 50.000 gian × 6 lệnh/30' ≈ 170
   lượt xin/giây → DB chịu được, nhưng là chi phí có thật, phải có trong HQ (số lượt xin/giây).
4. Ở quy mô ≥ ~1.300 gian Shopee, nhịp lớp 3 giãn là **tính năng**, không phải lỗi: seller không chạy ads thấy số ads chậm
   hơn; tới lớp 1 giãn là lúc phải xin quota — thiết kế làm ngày đó hiện trước trên HQ.
5. Lịch nhắc 23/10 "trình lát 3 AIMD" → thay bằng thiết kế này; lát 3–4 của 13.3 coi như gộp vào bước B.

#### 13.9.5 BƯỚC A ĐÃ LÀM (21/10/2026 đêm, anh Trung chốt 13.9 "làm bước A ngay") — Ads Shopee qua cổng gọi sàn

| Việc | Ở đâu |
|---|---|
| `callShopGet/Post` với path `/api/v2/ads/` → `callAdsApi()`: `ADS_GATEWAY` bật (mặc định) → `callMarketplace({platform:"SHOPEE", app: partner_id, shop: shop_id, endpoint: path})`; cổng ném `GatewayDeferError` → `budgetErrorFromDefer()` thành `ApiBudgetError` scope **`gateway_defer`** (giữ `waitMs`, `deferReason`) để MỌI chỗ đang bắt `isApiBudgetError` (xung, lịch sử, GMS, keywords, signals, route) không phải đổi. `ADS_GATEWAY=0` = đường lui `withApiBudget` y như cũ. | `integrations/shopee/client.ts`, `services/api-budget.ts` |
| Trần khởi điểm cho MỌI endpoint Ads Shopee: `RATE_LIMITS.endpointPrefix["SHOPEE /api/v2/ads/"]` = 2/s burst 2 (env `GATEWAY_SHOPEE_ADS_PER_SEC`, TỰ CHỌN); `get_all_cpc` giữ dòng riêng 1/s (H4). `endpointLimit()` = dòng riêng thắng, không có thì tiền tố dài nhất. | `config/marketplace-read.ts`, `services/marketplace-gateway.ts` |
| Tầng ads: `AdsPulseResult/AdsHistoryResult.deferMs`; `gateway_defer` KHÔNG vào `rateLimited` (không phải lỗi gian, không phải cầu dao); lịch sử giữ chờ dài nhất trong lượt. | `workers/ads-tiers.ts` |
| Làn Ads: xung bị hoãn → `nextAdsPulseAt = now + max(waitMs, 1')` (jitter), **không bậc**; lịch sử bị hoãn → `nextAdsSyncAt = now + max(waitMs, 1')` thay vì 6 h; xung bị hoãn thì không gọi lịch sử trong lượt (hạn giữ nguyên); log `[Ads-lane] … cổng bảo quay lại sau N s — xếp lại, không bậc`; log BẬT ghi "QUA CỔNG GỌI SÀN". | `workers/ads-lane.ts` |
| Cờ `ADS_CADENCE.GATEWAY` (env `ADS_GATEWAY`, mặc định 1); `.env.example`. | `config/ads-cadence.ts` |
| Trợ lý tự thực thi: lệnh ghi (tạm dừng / đổi ngân sách) bị cổng hoãn → `isAdsWriteRateLimited` nhận tiền tố "Cổng gọi sàn:" → sổ ghi DEFERRED, xung kế thử lại đúng dòng (không FAILED). | `integrations/shopee/ads-auto-execute.ts` |

**Kiểm:** vitest ads-lane + api-budget + marketplace-gateway + ads-auto-execute: 78 ca xanh (mới: 3 ca trần tiền tố, 2 ca
`budgetErrorFromDefer`, 4 ca `nextAdsSchedule` với deferMs, 1 ca lệnh ghi bị cổng hoãn); `tsc --noEmit` (cả test) sạch (backend không có cấu hình eslint).
**Chưa chạy sàn thật.** Không migration (bảng `api_rate_keys` + hàm SQL có từ Pha B 19/10).

**Đo 24 h sau deploy (tiêu chí 13.9.3 A):**
1. Log worker ngay sau boot: `[Ads-lane] BẬT — làn Ads riêng: Ads Shopee QUA CỔNG GỌI SÀN …`.
2. Log `[gateway] 429 …` (thay `[ApiBudget] 429 …`) — đếm theo khóa; log `[Ads-lane] … cổng bảo quay lại sau` = số lần hoãn.
3. SQL Supabase (chỉ đọc):
   ```sql
   SELECT "key", "hits" AS lan_phat, "failures" AS loi_lien_tiep, round("factor"::numeric, 2) AS he_so_nhip,
          to_timestamp("blockedUntilMs" / 1000) AT TIME ZONE 'Asia/Ho_Chi_Minh' AS lui_toi,
          left("lastError", 120) AS loi_cuoi, "updatedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh' AS cap_nhat
     FROM "api_rate_keys" WHERE "key" LIKE 'SHOPEE:2044679%' ORDER BY "hits" DESC, "key";
   SELECT app, "tripCount", level, reason, "pausedUntil", "updatedAt" FROM "api_throttle_states" WHERE app LIKE 'shopee:%';
   ```
   Kỳ vọng: `hits` khóa `|ep:/api/v2/ads/get_all_cpc_ads_daily_performance` ≤ 5/ngày (trước ~30 lần 429/ngày suy từ
   12 lần đóng × ≥ 3 gian); `tripCount` shopee:2044679 **đứng yên ở 162** (đường Shopee không còn đóng cầu dao);
   `factor` < 1 trên khóa nào = trần thật thấp hơn trần khởi điểm → đọc số, KHÔNG sửa tay.
4. Trợ lý quảng cáo Shopee: số hôm nay vẫn tươi ≤ 30' (HQ `overduePulse` không tăng).
Qua → bước B (13.9.3). Không qua (hits vẫn ≥ 20/ngày trên get_all_cpc dù factor đã hạ) → trần thật không phải app × endpoint
đơn thuần, đọc lại `lastError` + request_id, mở ticket Shopee kèm log như họ đòi 15/09.

**22/10 08:40–09:10 — SỐ ĐO THẬT (lịch nhắc nổ 08:40 chưa đọc được; 09:00 anh bật Chrome, em đọc Supabase + Render; mới ~9 h sau
deploy B 23:44 nên quy đổi ra ngày):**

| Tiêu chí 13.9.3 A | Kỳ vọng | Đo được | Đạt? |
|---|---|---|---|
| Boot | `[Ads-lane] BẬT … QUA CỔNG … nhịp tự co` | A boot 21/10 23:19:52 (tdqdj), B boot 23:44:29 (n64jk) đúng dòng | ✅ |
| `[Ads-demand]` | một dòng sau boot | 23:44:29: lớp 1: 0 · lớp 2: 48 · lớp 3: 0, xung 30' cả ba, chặt nhất **4 %** mức cho phép trên get_all_cpc (lúc boot mọi gian mặc định lớp 2) | ✅ |
| `Channel.adsPriority` sau ~9 h | đủ 3 lớp | **1 = 5 · 2 = 45 · 3 = 28** (78 gian Shopee ACTIVE, lớp 3 gồm gian chưa nối Hubsell Ads) | ✅ |
| `[ApiBudget] CẦU DAO ĐÓNG` | 0 | **0** sau 23:19 21/10 (lần cuối 22:46:11 gkwmf); `api_throttle_states` shopee:2044679 tripCount **162 đứng yên**, pausedUntil 23:06 21/10 | ✅ |
| `[gateway] 429` 24 h | ≤ 5/ngày trên get_all_cpc | **106 lần** từ 00:31 → 08:15 (7,7 h) ≈ 14/giờ ≈ **330/ngày quy đổi**; theo khóa endpoint: get_all_cpc **95**, get_product_level_campaign_setting_info 6, còn lại 5 (có get_shop_toggle_info); 49 khóa gian có hits, cao nhất shop 1575931172 = 8 | ❌ |
| `factor` | < 1 = trần thật thấp hơn | get_all_cpc **0,10 = SÀN AIMD** (cổng chỉ còn cho 0,1 lệnh/s toàn app, hồi +0,1 mỗi 6'), setting_info 0,11, mọi khóa gian 1,00 — hạ 10 lần vẫn 429 | ❌ |
| Trợ lý còn tươi | overduePulse không tăng | CHƯA kiểm (HQ cần đăng nhập điều hành); gián tiếp: gian 429 vẫn xếp lại 1' và qua được sau ≤ 4 lần | ⏳ |
| `[Ads-lane] … cổng bảo quay lại sau` | = số lần hoãn | không thấy dòng này; thay vào đó `[Ads-pulse] "<gian>" lùi lịch (gateway_defer): … chờ 1–2 s` **1:1 với mỗi `[gateway] 429`** (xung tự bắt rồi trả deferMs) | ghi nhận |

**KẾT LUẬN: KHÔNG ĐẠT, và hỏng kiểu khác hẳn giả định H4.** Trần thật KHÔNG phải app × endpoint. Bằng chứng trong log (giờ VN, instance n64jk):
1. **Một gian dính liên tiếp, gian khác xen giữa qua được**: HPGear VN (shop 1384536068) 429 lúc 04:12:29 → 04:13:29 → 04:14:49 → 04:15:49
   (4 lần, cách 60–80 s, request_id e3e3e7f35e603470…, …6037ffd8…, …603cc428…, …6040577a…), rồi im tới 08:15:10. Trong 4' đó các tick
   :09/:29/:49 khác (làn 2 luồng, TICK 20 s) vẫn chạy gian khác mà gian khác chỉ 429 lúc 04:10:22 và 04:26:49. Trần theo app thì
   mọi gian cùng dính; đây là **trần theo GIAN** (shop/token). Lặp y hệt ở 1904780402 (05:00:09 → 05:01:29 → 05:02:35 → 05:03:49),
   1250096431 (06:15:49 → 06:16:49 → 06:18:09), 1359898174 (04:05:29 → 04:06:49 → 04:08:09).
2. **Trần gian không chỉ một endpoint**: 1904780402 lần 3 dính ở bước 2 `get_product_level_campaign_setting_info` (05:02:35), Xbuy Tech
   dính `get_shop_toggle_info` (07:30:49) → một **xô theo gian cho cả nhóm Ads**, cửa sổ dài hơn 1' (lùi 60–80 s vẫn dính, qua sau ~4').
3. "2 gian 429 cùng giây" của H4 (18/10) giải thích được bằng 2 luồng cùng tick, không cần trần app. Hạ AIMD khóa app × endpoint về
   0,1 là **hạ oan cả app** (sức chứa ảo 6 lệnh/phút → khi gian tăng, nhịp tự co sẽ giãn oan).
4. **Cơ chế nuôi 429**: xung bị hoãn → xếp lại `now + max(waitMs, 1')` với waitMs chỉ 1–2 s (SHOP_BACKOFF gốc 1 s) → 1' sau chạy lại
   **từ bước 1** (3 lệnh nữa cùng gian) rồi dính ở bước 4 → mỗi đợt 3–4 lần 429 + 9–12 lệnh phí. Lát 2 cũ (lùi riêng gian 15') là đúng
   TẦNG nhưng sai chỗ (ngoài cổng, bậc cứng); bước A tắt nó mà cổng chưa có trần gian cho Ads.

**→ Chưa mở ticket Shopee** (ticket chỉ khi đã tôn trọng trần gian mà vẫn ≥ 20/ngày). Đề xuất bước A2 ở 13.9.8, chờ anh chốt; bước C lùi sau A2.

**22/10 09:30–09:45 — ĐỌC LẠI NGAY TRƯỚC / SAU DEPLOY A2 (lịch nhắc tự động lượt hai; Chrome anh bật; chỉ đọc, không sửa mã, không sửa số):**
anh push A2 `05971e95` lúc 09:27, worker Render instance `7frss` boot **09:31:14** đúng dòng `[Ads-lane] BẬT … QUA CỔNG GỌI SÀN (GCRA app×endpoint +
GIAN×endpoint, 13.9 bước A/A2) … sàn 429 xếp lại ≥ 5' + chạy tiếp từ bước dở (A2, mốc tươi 15')`; `[Ads-demand]` 09:31:15: lớp 1: 5 · lớp 2: 37 ·
lớp 3: 6 gian, xung 30' cả ba, chặt nhất 4 % trên get_all_cpc, **mỗi gian dùng 23 % trần gian×endpoint** (đúng số test ads-demand).

| Số | 09:10 | 09:30 (≈ 1' trước boot A2) | Ghi chú |
|---|---|---|---|
| `[gateway] 429` | 106 (00:31 → 08:15) | **+5** (08:15 ×3 gian, 09:18 EQ TECH Kids, 09:22 Ghiền 3D Store – setting_info) = 111 từ boot B; 67' cuối chỉ 2 lần | chậm lại KHÔNG phải vì hết dồn mà vì AIMD app×endpoint đã kìm CẢ APP (factor 0,10 = 6 lệnh/phút) — đúng cái "hạ oan" ở điểm 3 bên trên |
| hits / factor khóa app×endpoint get_all_cpc | 95 / 0,10 | **96 / 0,50** (tự hồi +0,1 mỗi 6') | setting_info 7 / 0,50 · get_product_recommended_roi_target 4 / 0,32 (lần cuối 01:05) · get_shop_toggle_info 1 / 0,50 · 10 endpoint còn lại 0 / 1,00 |
| khóa gian (app×gian) có hits | 49 | 36 gian hits > 0, tổng 108, cao nhất 8 (shop 1575931172) | failures = 0 mọi khóa (không mã cứng) |
| tripCount shopee:2044679 | 162 | **162**, pausedUntil 21/10 23:06 | ✅ đứng yên — 0 `CẦU DAO ĐÓNG` |
| adsPriority Shopee ACTIVE | 5 / 45 / 28 | **5 / 45 / 28** (78 gian) | ✅ |
| overduePulse | chưa kiểm | **0** qua SQL cùng điều kiện HQ (`adsLockedAt IS NULL AND nextAdsPulseAt < now() − 2 h`, 3 sàn); Shopee lớp 1–2 = 0; 38/50 gian lớp 1–2 hẹn xung trong 35' | ✅ Trợ lý còn tươi. HQ web không đọc được: tài khoản đang đăng nhập trong Chrome anh không phải điều hành |
| Sau boot A2 (09:31 → 09:45) | — | `adsPulseStep` = 0 cho cả 78 gian (migration 20261022030000 đã chạy); **17 khóa gian×endpoint đã sinh, hits = 0**; 0 `[gateway] 429` mới; `adsLockedAt` 0 | mới 14' — chưa kết luận; đọc 24 h theo 13.9.8 "Đo" (lịch nhắc 23/10 09:30) |

Kết luận lượt này: A+B **không đạt** tiêu chí 13.9.3 A (như 09:10, không đổi); A2 lên prod đúng dòng boot, chưa đủ số. Bước C (13.9.7) vẫn chờ số A2 24 h.

#### 13.9.6 BƯỚC B ĐÃ LÀM (21/10/2026 đêm, anh Trung "push luôn và tiếp tục làm") — nhu cầu tự co + ưu tiên + gộp lệnh + bằng chứng I9

| Việc | Ở đâu |
|---|---|
| **Lớp ưu tiên** `Channel.adsPriority` (1 = đang tiêu tiền + Trợ lý tự thực thi bật · 2 = có chiến dịch theo dõi · 3 = không chiến dịch / chưa ủy quyền); xung Shopee tính `adsPriorityOf()` từ số đã đếm (+ 1 dòng JSON cấu hình Trợ lý) và trả về, làn ghi lại sau lượt. Migration khóa Channel có thử lại. | `services/ads-demand.ts`, `workers/ads-tiers.ts`, `prisma/migrations/20261021230000_channel_ads_priority` |
| **Nhịp tự co theo sức chứa** `computeCadence()` (thuần, tất định): `D_e = Σ_p N_p·lệnh_{e,p}/T_p + Σ_p N_p·lịch-sử_{e,p}/T^hist_p ≤ u·c_e`; vượt → giãn lớp 3 → 2 → 1 tới trần từng lớp (120'/360'/1440'); `c_e` = trần cấu hình × hệ số AIMD thấp nhất trên khóa (`shopeeAdsCapacity()` đọc `api_rate_keys`). `refreshAdsDemand()` đếm gian theo lớp + đọc hệ số mỗi 5', cache, mọi worker tính ra cùng số; log `[Ads-demand] …` khi đổi. Xung lấy `pulseMinFor(lớp)` làm SÀN của nhịp (chỉ dài hơn nhịp nghiệp vụ 30'/120', không ngắn hơn). | `services/ads-demand.ts`, `config/ads-cadence.ts` (`DEMAND_*`, `DEADLINE_X`) |
| **Ưu tiên nhặt vé**: `adsCandidateOrder()` = lớp tăng dần → gian chưa từng xung → hạn cũ nhất. | `workers/ads-lane.ts` |
| **Hạn chót = ĐO, không bỏ xung** (khác 13.3 lát 4): hàng chờ vốn đã bị chặn ở MỘT dòng/gian (`nextAdsPulseAt`), không có hàng vô hạn để cắt; bỏ xung trễ chỉ vứt số tươi. Nên `pulsePastDeadline()` + `snapshot.overdue[lớp]` (gian trễ > nhịp lớp × 2) chỉ để HQ/log thấy lớp nào đang đói. | `services/ads-demand.ts` |
| **Gộp lệnh (I6)**: khi lịch sử đến hạn, làn chạy LỊCH SỬ TRƯỚC (cửa sổ 30 ngày có hôm nay, cả Nhóm) rồi xung với `skipToday` → bỏ `get_product_campaign_daily_performance` + `get_all_cpc` "hôm nay" (bớt 2 lệnh/lượt-lịch-sử, trong đó có khóa chặt nhất); cờ ví tự nạp `get_shop_toggle_info` chuyển từ xung 30' sang lịch sử (bớt 1 lệnh/xung, 44 lệnh/gian/ngày). Xung lớp 1–2 còn 5 lệnh, lớp 3 1 lệnh. | `workers/ads-lane.ts`, `integrations/shopee/ads-pulse.ts` (`syncShopeeAutoTopUpFlag`), `workers/ads-tiers.ts` |
| **Lịch sử theo lớp**: lớp 3 mỗi 24 h (`ADS_SYNC_HOURS_NO_CAMPAIGN`) thay vì 6 h — test I9 chỉ ra 20.000 gian lớp 3 × 6 h một mình đã nghẽn `get_all_cpc` (56 lệnh/phút > 48 cho phép) dù chúng không có gì để kéo. | `workers/ads-lane.ts` (`nextAdsSchedule` nhận `priority`), `config/ads-cadence.ts` |

**Bằng chứng I9 — `services/__tests__/ads-scale.test.ts`** (sàn giả trần THẬT `get_all_cpc` 0,7/s < 1/s cổng tin → cổng phải tự học AIMD; đồng hồ giả, mô phỏng tuần tự):

| N gian (lớp 1/2/3) | Giờ mô phỏng | Khẳng định đã xanh |
|---|---|---|
| 40 (10/25/5) | 6 h | 0 lần dừng app · 429 < 1 % lệnh · không lớp nào giãn · lớp 1 p99 trễ ≤ hạn chót · ≥ 90 % số xung kỳ vọng |
| 1.000 (100/700/200) | 3 h | 0 dừng app · 429 < 1 % · chưa đỏ · lớp 1 giữ 30' và không trễ hạn chót (lớp 2 có thể giãn) |
| 10.000 (3.000/5.000/2.000) | 2 h | **ĐỎ** (lớp 1 giãn tới 120' vẫn vượt — thiếu quota thật) NHƯNG 0 dừng app · 429 < 1 % · lớp 1 trễ ít hơn lớp 3 (lớp 3 bị nhường chỗ, kể cả gian đang chờ) |

`ads-demand.test.ts`: 40 gian ≈ 2,6 % mức cho phép; ~1.300 gian lớp 2 vừa chạm 80 %; thêm gian → chỉ lớp 2 giãn, lớp 1 giữ 30'; 20.000 gian lớp 3 → chỉ lớp 3 giãn (~216') vì `id_list`; 10.000 gian lớp 1 → đỏ; hệ số AIMD 0,5 → giãn sớm hơn; tất định.
**Kiểm:** 93 ca xanh (ads-demand 12, ads-scale 3, ads-lane +3, cùng các bộ bước A), `tsc --noEmit` cả test sạch. **Chưa chạy sàn thật.**

**Chưa làm / còn lại:** HQ thẻ "Quota Ads theo khóa" + gỡ `api-budget`/`ApiThrottleState`/`adsBackoff*`/`STORM_RATIO`/`SHOP_CALL_GAP_SEC` (bước C — các biến này vẫn là đường lui `ADS_GATEWAY=0` và đường Lazada tới khi bước D xong); Lazada + TikTok Ads qua cổng (bước D). Lớp gian Lazada/TikTok giữ 2.

**Đo sau deploy B (cộng vào 13.9.5):** log boot `[Ads-lane] BẬT … nhặt theo lớp ưu tiên + nhịp tự co theo sức chứa` + một dòng `[Ads-demand] lớp 1: N gian, xung 30' · lớp 2 … · chặt nhất x % của mức cho phép trên get_all_cpc…`; SQL `SELECT "adsPriority", count(*) FROM "Channel" WHERE "channelName"='SHOPEE' AND status='ACTIVE' GROUP BY 1` sau 1 h (lớp đã được ghi); `hits` của khóa `get_all_cpc` trong `api_rate_keys` còn thấp hơn bước A (bớt 2 lệnh mỗi lượt lịch sử).

#### 13.9.7 BƯỚC C ĐỀ XUẤT (22/10/2026 sáng, CHỜ ANH CHỐT — chưa code) — HQ "Quota Ads theo khóa" + gỡ cầu dao cũ

Điều kiện mở bước C: số đo 24 h ở 13.9.5 đạt (hits `get_all_cpc` ≤ 5/ngày, tripCount đứng 162, 0 dòng `[ApiBudget] CẦU DAO ĐÓNG`).
**22/10 09:10: KHÔNG ĐẠT (106 lần 429/7,7 h) → bước C LÙI sau A2 (13.9.8).** Nội dung C giữ nguyên để làm sau.
Tách làm 2 lát để lát gỡ không kéo lát HQ:

| Lát | Việc | Ở đâu | Tiêu chí |
|---|---|---|---|
| **C1. HQ thẻ "Quota Ads theo khóa" (I8)** — ~1 ngày, KHÔNG gỡ gì | `platform-health.ts`: thay `breakersDetail/breakerTrips24h` (đọc `ApiThrottleState`) bằng `gatewayKeys[]` đọc `api_rate_keys` khóa `SHOPEE:2044679*` (trần cấu hình, `factor`, sức chứa = trần × factor, `hits`/`failures` 24 h, `blockedUntilMs` nếu mã cứng) + `adsDemand` lấy từ `refreshAdsDemand()` (N gian/lớp, nhịp từng lớp, % dùng khóa chặt nhất, `overdue[lớp]`). Dấu hiệu `worker.breaker` → `worker.adsQuota`: xanh < 60 % · vàng ≥ 60 % · cam = có lớp đang giãn · đỏ = lớp 1 giãn HOẶC khóa bị chặn mã cứng (số 60 % TỰ CHỌN, anh chốt). Trang `/admin/health`: thẻ Cầu dao → bảng khóa (endpoint · trần · hệ số · % dùng · 429 24 h · lùi tới) + dòng nhịp 3 lớp; chip "CẦU DAO ĐÓNG" trên băng tóm tắt chỉ còn hiện khi khóa bị chặn mã cứng. | `services/platform-health.ts`, `frontend/src/app/admin/health/page.tsx`, `services/ads-demand.ts` (xuất snapshot) | HQ hiện đúng số cổng, khớp SQL 13.9.5; test platform-health xanh |
| **C2. Mốc Đ2–Đ4 theo % dùng khóa** — cùng ngày C1 | `config/capacity-plan.ts`: `ADS_QUOTA_MILESTONES` đổi điều kiện từ `shopeeAdsShops ≥ 200/500/800` sang metric mới `adsQuotaUsePct` (Đ2 ≥ 50 % = chuẩn bị hồ sơ · Đ3 ≥ 80 % = MỞ TICKET Shopee xin nâng quota, đúng ý anh 17/10 · Đ4 = lớp 1 bắt đầu giãn); số gian giữ làm thông tin phụ. ETA 7 ngày tính trên % dùng. | `config/capacity-plan.ts`, `platform-health.ts` (metric) | Thẻ "Quota Ads Shopee" hiện mốc theo % |
| **C3. Gỡ cầu dao cũ** — SAU 7 ngày C1 chạy ổn VÀ SAU bước D (Lazada còn đi `withApiBudget`) | Gỡ `ADS_GATEWAY` đường lui; gỡ lát 2 (`Channel.adsBackoffLevel/Until`, `SHOP_BACKOFF_*`, `SHOP_CALL_GAP_SEC`, `STORM_RATIO`, nhánh "lùi riêng" trong `ads-lane.ts`, `worker.adsBackingOff`); gỡ `withApiBudget` + bão + bảng `ApiThrottleState` khi Lazada đã qua cổng (bước D). GIỮ `ApiBudgetError`/`isApiBudgetError` (9 tệp đang bắt, giờ là vỏ của `GatewayDeferError`). Migration 2 pha: pha 1 mã thôi đọc/ghi cột, pha 2 (deploy sau) bỏ cột + bảng. | `api-budget.ts`, `ads-lane.ts`, `ads-cadence.ts`, `schema.prisma` (2 migration) | Không còn log `[ApiBudget]`; tsc + test xanh; HQ không mất số |

**Điều chưa chắc:** (1) ngưỡng vàng 60 % tự chọn; (2) Đ4 "lớp 1 giãn" là sự kiện, không phải %; (3) D nên đi trước C3 để gỡ một lần — thứ tự đề xuất: C1+C2 → D → C3.

#### 13.9.8 BƯỚC A2 ĐÃ LÀM (22/10/2026 sáng, anh Trung chốt "code luôn") — cổng học TRẦN THEO GIAN × ENDPOINT cho nhóm Ads Shopee

Không phải vá ngưỡng: mô hình trần sai tầng (13.9.5) nên sửa mô hình trong cổng, mọi số vẫn do AIMD học. Vẫn 9 bất biến 13.9.1.
Khác đề xuất sáng: khóa là **gian × ENDPOINT** (không phải gian × nhóm Ads) vì log 22/10 cho thấy 3 lệnh đầu của xung qua rồi
get_all_cpc dính ở MỌI lần thử — xô theo từng endpoint của gian; và giữ "bão theo gian khác nhau" vì test I9 N = 1.000 chứng
minh bỏ hẳn hạ nhịp app × endpoint thì cổng không còn học được trần app thật (7 % 429).

| Việc | Ở đâu | Số khởi điểm (TỰ CHỌN — cổng tự học, HQ sẽ hiện) |
|---|---|---|
| **Khóa gian × endpoint** `SHOPEE:<app>|shop:<id>|ep:<path>` — lệnh có gian VÀ cấu hình `RATE_LIMITS.shopEndpoint`/`shopEndpointPrefix` khớp mới lấy khóa (nhóm Ads Shopee; đơn hàng, Lazada, TikTok không đổi). GCRA riêng từng gian từng endpoint. | `marketplace-gateway.ts` (`keyOf.shopEndpoint`, `shopEndpointLimit`, `gatewayLimits`), `config/marketplace-read.ts` | get_all_cpc **1 lệnh/5', không dồn** (env `GATEWAY_SHOPEE_ADS_SHOP_ALLCPC_PER_MIN=0.2`); endpoint Ads khác **1 lệnh/phút, không dồn** (`GATEWAY_SHOPEE_ADS_SHOP_PER_MIN=1`, Shopee 10/10 "cấp shop ~1 call/phút") |
| **429 không rõ tầng trên lệnh có khóa gian × endpoint** → phạt ĐÚNG khóa ấy: gốc **60 s × 2^(lần−1)** không xáo trộn (làn đã xáo trộn), trần 15', **hạ nhịp AIMD khóa ấy** (× 0,5, sàn 0,1 = get_all_cpc 1/50', hồi +0,1 mỗi 6'). KHÔNG đụng khóa gian chung (đơn hàng vẫn đi). Log `[gateway] 429 shop×ep …`. | `callMarketplace` nhánh rate_limit, `GATEWAY.SHOP_ENDPOINT_BACKOFF` (`GATEWAY_SHOP_EP_BACKOFF_SEC=60`) | — |
| **Bằng chứng tầng app = GIAN KHÁC NHAU**: `DistinctShopStorm` đếm gian khác nhau dính 429 cùng khóa endpoint trong 60 s; ≥ 3 gian mới hạ nhịp khóa app × endpoint (AIMD, hồi 60'). Một gian dính 4 lần liền = 1 gian → không hạ app (bài học 16/10 đếm theo lần). Bộ đếm trong tiến trình (worker Ads một tiến trình). Log thêm `+ bão app (N gian/60 s → hạ nhịp …)`. | `marketplace-gateway.ts`, `GATEWAY.UNKNOWN_429_STORM` (`GATEWAY_STORM_SHOPS=3`) | 3 gian / 60 s |
| **Làn: sàn 429 → xếp lại ≥ 5'** (`deferFloorMs`: rate_limit → max(waitMs, DEFER_AFTER_429_MIN); throttled/hard_app → đúng waitMs, sàn 1' như cũ). | `workers/ads-tiers.ts`, `config/ads-cadence.ts` (`ADS_DEFER_AFTER_429_MIN=5`) | 5' (đo 22/10 gian qua sau ~4') |
| **Xung chạy TIẾP từ bước dở** (I7): xung Shopee chia 6 bước (`SHOPEE_PULSE_STEP`: 1 id_list · 2 setting · 3 hiệu suất hôm nay · 4 chi hôm nay · 5 ví · 6 GMS); cổng hoãn ở bước k → `ApiBudgetError.pulseStep = k` → tầng trả `resumeStep` → làn ghi `Channel.adsPulseStep` + `adsPulseStepAt`; lượt sau `pulseResumeFrom()` (mốc ≤ `ADS_PULSE_RESUME_TTL_MIN=15`) → `pulseShopeeAds({ resumeFrom })` bỏ qua bước đã có số (bước ≥ 3 lấy dòng chiến dịch sống từ DB, chiến dịch Nhóm không hỏi setting_info). Xung xong → 0. Lịch sử chưa có chạy tiếp (lịch sử bị hoãn đã xếp lại đúng waitMs của cổng, cổng pace nên không sinh 429). | `integrations/shopee/ads-pulse.ts`, `workers/ads-tiers.ts`, `workers/ads-lane.ts`, migration `20261022030000_channel_ads_pulse_step` (khóa Channel có thử lại) | TTL 15' |
| **Nhu cầu tự co đọc cả trần gian**: `computeCadence` nhận `shopEndpointPerMin` → sàn nhịp từng lớp độc lập số gian (lệnh/xung ÷ T + lịch sử ÷ T^hist ≤ 0,8 × trần gian × endpoint); kết quả thêm `shopUtilization[lớp]`, log `[Ads-demand] … mỗi gian dùng x % trần gian×endpoint`. Hôm nay get_all_cpc 1/5' với xung 30' ≈ 23 % → không ảnh hưởng; trần gian tụt tới 1/50' (sàn AIMD) → lớp 1–2 giãn 76' (test). Nhịp lớp đọc trần CẤU HÌNH (hệ số AIMD của từng gian là của riêng gian ấy). | `services/ads-demand.ts` | — |

**Bằng chứng — test (139 ca liên quan xanh, `tsc --noEmit` cả test sạch):**
- `marketplace-gateway.test.ts` (18 ca, 7 mới): khóa thứ 4 chỉ ở nhóm Ads có gian; 429 gian A → chỉ khóa A × get_all_cpc lùi 60 s + hệ số 0,5, khóa app × endpoint / gian chung / app KHÔNG đụng; gian B cùng endpoint và gian A endpoint khác đi ngay; gian A gọi lại trong lúc lùi → cổng trả về làn, không gọi sàn; 429 liên tiếp 60 → 120 → 240 s, thành công xóa đếm; nhịp 1/5' → lần 2 trong 5' là "chờ lượt" không phải 429; bão 2 gian chưa hạ app, gian thứ 3 hạ 0,5, một gian nhiều lần không tính; mã cứng vẫn dừng cả app.
- `ads-lane.test.ts` (+4 ca): sàn 5' cho rate_limit, đúng waitMs cho throttled/hard_app; ghi/xóa `adsPulseStep`; `pulseResumeFrom` theo TTL; config.
- `ads-demand.test.ts` (+3 ca): 23 % hôm nay; trần gian 1/50' → lớp 1–2 giãn 76', lớp 3 giữ 30', đỏ; không truyền → như cũ.
- **I9 `ads-scale.test.ts`** sàn giả thêm trần THẬT theo gian × endpoint (cửa sổ trượt đếm lệnh được nhận: get_all_cpc **1/6'** chặt hơn 1/5' cổng tin; endpoint khác 2/phút lỏng hơn) + trần app 0,7/s; làn giả làm đúng A2 (≥ 5' sau 429, ≥ 1' chờ lượt, chạy tiếp từ lệnh dở ≤ 15'): N = 40 → 0 dừng app, 429 < 1 %, **0 gian 429 hai lượt liền**, không lớp nào giãn; N = 1.000 / 10.000 → 0 dừng app, 429 < 1 % (bão app ≥ 3 gian/60 s nhận ra → khóa app học), < 2 % gian 429 hai lượt liền (pha học tầng app), lớp 1 trước lớp 3; **ca tái hiện HPGear VN**: xung sớm 5' sau xung trước → 429 ở lệnh thứ 4 → chỉ khóa HPGear × get_all_cpc hạ 0,5, khóa app không, gian khác gọi ngay; 5' sau chạy tiếp 2 lệnh còn lại → tổng 1 lần 429, 0 lệnh phí (trước: 4 lần 429 + 9 lệnh phí).
- Test DB dev: 5 ca đỏ CÓ SẴN (sổ cái / xóa gian — DB dev thiếu trigger/chỉ mục vì `db push` không chạy migration SQL thô), không liên quan A2; 1.841 ca xanh.

**Chưa chạy sàn thật.** Migration thêm 2 cột Channel (khóa có thử lại).

**Đo 24 h sau deploy A2 (cộng vào 13.9.5):**
1. Log boot `[Ads-lane] BẬT … GCRA app×endpoint + GIAN×endpoint, 13.9 bước A/A2 … sàn 429 xếp lại ≥ 5' + chạy tiếp từ bước dở`.
2. Đếm `[gateway] 429` ≤ 5/ngày (so 106/7,7 h); KHÔNG còn chuỗi cùng gian cách 60–80 s; có dòng `lượt sau chạy tiếp từ bước k` / `(chạy tiếp từ bước k)`.
3. SQL (chỉ đọc):
   ```sql
   SELECT "key", "hits", "failures", round("factor"::numeric,2) AS factor, "updatedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh' AS cap_nhat
     FROM "api_rate_keys" WHERE "key" LIKE 'SHOPEE:2044679%' AND "updatedAt" > now() - interval '24 hours' ORDER BY "hits" DESC LIMIT 30;
   SELECT count(*) FILTER (WHERE "key" LIKE '%|shop:%|ep:%') AS khoa_gian_ep, sum("hits") FILTER (WHERE "key" LIKE '%|shop:%|ep:%') AS hits_gian_ep,
          max("hits") FILTER (WHERE "key" LIKE '%|shop:%|ep:%') AS hits_max_mot_gian
     FROM "api_rate_keys" WHERE "key" LIKE 'SHOPEE:2044679%';
   SELECT "adsPulseStep", count(*) FROM "Channel" WHERE "channelName"='SHOPEE' AND status='ACTIVE' GROUP BY 1;
   ```
   Kỳ vọng: factor khóa app × endpoint get_all_cpc về ~1 (tự hồi +0,1/6', không cần sửa tay; muốn về ngay thì anh dán
   `UPDATE "api_rate_keys" SET "factor"=1,"failures"=0,"blockedUntilMs"=0 WHERE "key" LIKE 'SHOPEE:2044679|ep:%';`);
   `hits` khóa gian × endpoint phân tán, không gian nào > 2/ngày; `adsPulseStep` đa số 0 (mốc dở chỉ sống ≤ 15').
4. tripCount shopee:2044679 vẫn 162; Trợ lý còn tươi ≤ 30' (lớp 1–2).
Qua → C1+C2 (13.9.7) → D → C3. Không qua (≥ 20/ngày dù factor gian × endpoint đã xuống sàn) → ticket Shopee kèm request_id 13.9.5.

**Điều chưa chắc:** (1) cửa sổ thật của trần gian (1' theo Shopee vs ~4' quan sát, get_all_cpc có thể dài hơn) — AIMD học, HQ (C1) hiện `factor` theo khóa gian × endpoint; (2) 1 lệnh/phút không dồn cho endpoint Ads khác là tự chọn — lô > 1 lệnh cùng endpoint (gian > 100 chiến dịch, chiến dịch Nhóm mỗi id một lệnh ở lịch sử) tự dàn 1'/lệnh qua hoãn + chạy tiếp, lịch sử có thể kéo dài vài phút cho gian Nhóm nhiều; (3) có thể trần tính theo access_token thay vì shop (cùng kết quả với một app); (4) bão 3 gian/60 s: giờ đầu sau deploy vài gian có get_all_cpc gọi < 5' trước (mã cũ) có thể dính → hạ app × endpoint 0,5 một lần, hồi trong 30' — chấp nhận.

#### 13.9.9 ĐỌC SỐ THẬT 22/10 09:40–10:00 (Chrome anh) — A2 lặp hoãn 60 s ở gian > 100 chiến dịch → A3 "khóa gian × endpoint chỉ đo"

**Số đo (Supabase + Render, 25' sau deploy A2 09:35):**

| Chỉ số | Kết quả |
|---|---|
| `[Ads-lane] BẬT` 09:31 | "QUA CỔNG GỌI SÀN (GCRA app×endpoint + GIAN×endpoint, 13.9 bước A/A2) … nhịp tự co … sàn 429 xếp lại ≥ 5' + chạy tiếp từ bước dở" ✅ |
| `[Ads-demand]` 09:31 | lớp 1: 5 gian · lớp 2: 37 · lớp 3: 6, xung 30' cả ba; chặt nhất 4 % mức cho phép trên get_all_cpc; mỗi gian dùng 23 % trần gian×endpoint ✅ |
| `[gateway] 429` giờ qua | 2 lần (09:18, 09:22 — TRƯỚC A2); 0 lần từ 09:35 ✅ (mới 25', chưa kết luận) |
| `api_rate_keys` từ 02:35 UTC | 52 khóa gian×endpoint được chạm, `sum(hits)` = 0; khóa app×endpoint get_all_cpc hits 96 factor 0,50 (trước A2), setting_info 7, toggle 1 |
| `api_throttle_states` | shopee:2044679 tripCount **162 đứng yên** (từ 21/10 22:46) ✅ |
| `adsPriority` | 5 / 45 / 28 ✅ |
| **`[Ads-lane] … cổng bảo quay lại sau 60 s`** | **~50 dòng / 12 phút**, cùng ~12 gian lặp mỗi ~80 s: BESI FOOD, TAROT ĐỒNG TÂM, Thuốc Nhuộm Tóc Kirei Hair, TIỆM BUÔN HOÀI NIỆM, Tổng kho … đaklak, Cây Giống Chuẩn Top Nông, Kanji (dở ở **bước 1** id_list); Thế Giới Xuyên Thấu, ANO (dở ở **bước 3** daily_performance); Allen Scott (GMS) ❌ |

**Gốc (log `throttled SHOPEE:…|shop:X|ep:get_product_level_campaign_id_list — chờ 60 s` + SQL đếm chiến dịch):** mọi gian lặp đều có
> 100 chiến dịch (Sổ sách cho HKD 980, Cây Giống 336, Siêu thị 8686 243, Kanji 198, TIỆM BUÔN 175, BESI 169, An Nhiên 144, DarkMan 142,
Quang Nhật 133, đaklak 128, Kirei 110, TAROT 106) hoặc có chiến dịch Nhóm (ANO). Một BƯỚC xung gồm nhiều lệnh cùng endpoint (lô 100 →
2+ trang; Nhóm mỗi id một lệnh). Khóa gian × endpoint A2 đặt 1 lệnh/phút không dồn → trang 2 bị chặn trước (chờ 60 s > 2 s trong dòng)
→ làn xếp lại 60 s → lượt sau chạy lại bước ấy **từ trang 1** → trang 2 lại bị chặn → vòng lặp vô hạn, xung không bao giờ xong, mỗi
vòng tốn thêm lệnh thật. Lỗi THIẾT KẾ của A2: đơn vị của van (một lệnh HTTP) không khớp đơn vị của việc (một bước nhiều trang); và
chặn trước 1 lệnh/phút cho các endpoint ngoài get_all_cpc KHÔNG có căn cứ đo (429 theo gian 22/10: get_all_cpc 95, setting_info 7,
toggle 1, còn lại 0).

**A3 (10:05, sửa mô hình, không chỉnh số):** `RateLimit.perSec = 0` nghĩa là **khóa CHỈ ĐO + LÙI KHI 429, không chặn trước**
(`limitOf` → emissionMs 0). `shopEndpointPrefix["SHOPEE /api/v2/ads/"]` = 0 (env `GATEWAY_SHOPEE_ADS_SHOP_PER_MIN`, > 0 mới chặn
trước); `shopEndpoint[get_all_cpc]` giữ 1 lệnh/5' (một lệnh/gian/lượt theo đúng cấu trúc xung + lịch sử, có căn cứ 95/106). Khóa gian ×
endpoint vẫn có mặt cho mọi endpoint Ads → 429 vẫn phạt đúng khóa ấy 60 s × 2^n và bão theo gian khác nhau vẫn hạ app × endpoint (A2
giữ nguyên phần đúng). `shopeeShopEndpointPerMin` bỏ khóa chỉ đo khỏi sàn nhịp. Test mới: 10 trang id_list cùng gian đi liền (chỉ
chờ app × endpoint vài trăm ms), trang 11 bị 429 → phạt đúng gian × id_list, gian khác không ảnh hưởng, app × endpoint không hạ.
**Bài học thiết kế (I1):** van chặn trước chỉ đặt ở nơi (a) có số đo tầng ấy và (b) đơn vị van = đơn vị việc; chỗ khác để cổng ĐO
rồi lùi theo 429 — đúng nguyên tắc "trần chỉ bật nơi có bằng chứng" của Pha B mà A2 đã vi phạm.

**5c (bóng đọc sàn, 3 ngày từ ghi danh 19/10 13:12):** ANO 213/213 đơn có webhook đều được bóng thấy, Siêu Thị 8686 2.560/2.560;
`chi_cu` rỗng, `chi_moi` 0; cả hai `caught_up`, trễ 11–12', 1 trang/lượt, cửa sổ 60'; không khóa đơn hàng nào bị 429. (Chạy cửa sổ
3 ngày thô ra 122 + 23 "chi_cu" — toàn đơn có sự kiện 09:51–12:34 ngày 19/10, TRƯỚC khi bóng bắt đầu 12:42 → không phải sót.) → ĐẠT
tiêu chí 5c; đề xuất bật lát 2 trên một gian nhỏ ghi ở docs CUNG-HOA-LOP-GOI-SAN 5c mục Kiểm 22/10 — chờ anh chốt.

**CRM care-auto:** 19 thuê bao hết gói quá 7 ngày ân hạn (trong 44 hết gói / 158 thuê bao / 165 user) = 19 dòng CHURNED AUTO_EXPIRED
+ 19 audit `care.auto` lúc 23:13 ngày 21/10; 5 ACTIVE MANUAL giữ nguyên. Khớp. Docs HQ-CRM mục 6 ước "phần lớn 155 khách" là sai: đa
số chưa hết gói hoặc chưa quá ân hạn.

**A3 ĐÃ PUSH 99691473 lúc 10:01, boot 10:07:28 (instance mới) — theo dõi 30' tới 10:37 (Chrome anh, Render + Supabase):**

| Chỉ số | Trước A3 (bản A2, 09:35–10:08) | Sau A3 (10:07–10:37) |
|---|---|---|
| Dòng `cổng bảo quay lại sau 60 s` lặp ở gian > 100 chiến dịch | ~50 dòng / 12', 12 gian lặp mỗi ~80 s, xung không xong | **0** — dòng cuối 10:08:14 thuộc instance cũ |
| Xung hoàn tất ở các gian từng kẹt | không có | trong 4' đầu: đaklak 26, ANO 14 (tiếp bước 3), BESI 46, Siêu thị 8686 55, Quang Nhật 128, Xuyên Thấu 52 (tiếp bước 3), TIỆM BUÔN 37, An Nhiên 32, TAROT 49, Kirei 9, Cây Giống 148; TIỆM BUÔN xung lần 2 đúng 10:36 (nhịp 30' bình thường) |
| Hoãn còn lại | — | chỉ ở bước 4 theo trần gian × get_all_cpc 1/5' (HANA NAIL_BOX 286 → 260 s, Mọ Mẫm 286 s, Lucin Home 437 s vì khóa gian ấy vừa 429 lúc 10:05 → nhịp ×0,5) và vài lần "1–47 s" (chờ app × endpoint quá 3 vòng ngủ trong dòng — xem việc kế); dòng cuối 10:20:28 |
| `[gateway] 429` | 2 lần 10:00 + 10:05 (get_all_cpc, phạt đúng khóa gian × endpoint, không hạ app) | **0** |
| `api_rate_keys` chạm từ 10:07 | — | 23 khóa, `sum(hits)` 0 |
| `tripCount` shopee:2044679 | 162 | 162 |
| Gian dở bước / trễ xung > 60' | — | 0 / 0 |

→ Vòng lặp hết ngay sau boot; A2 giữ phần đúng (429 → phạt đúng gian × endpoint, chạy tiếp từ bước dở — HANA, Lucin, Biocare đều
"chạy tiếp từ bước 4" thành công). Lịch nhắc 23/10 09:30 đọc 24 h giữ nguyên tiêu chí 13.9.8 "Đo".

**Việc kế nhỏ ghi lại (chưa làm):** `callMarketplace` ném Defer khi `attempt >= 3` dù mỗi lần chờ chỉ vài trăm ms (app × endpoint 2/s,
hai luồng song song) → làn xếp lại tối thiểu 1' cho một việc đáng ra chờ 1 s (log "quay lại sau 1 s"). Sửa đúng chỗ: giới hạn theo TỔNG
thời gian ngủ trong dòng (≤ MAX_INLINE_WAIT_MS) thay vì số vòng. Đưa vào bước C cùng thẻ HQ.

#### 13.9.10 ĐỌC SỐ 24 h SAU A2/A3 — 23/10/2026 09:30–09:50 (lịch nhắc tự động, Chrome anh: Supabase + Render; CHỈ ĐỌC) — KHÔNG ĐẠT, trần KHÔNG theo gian

Mốc: A2 `05971e95` boot 09:31 22/10, A3 `99691473` boot 10:07 22/10 → cửa sổ đo 10:07 22/10 → 09:45 23/10 (≈ 23,6 h). Tiêu chí 13.9.8 "Đo".

| Chỉ số | Kỳ vọng | Kết quả | |
|---|---|---|---|
| `[gateway] 429` 24 h (log Render, khớp `sum(hits)` khóa gian×endpoint) | ≤ 5 | **168** — get_all_cpc 151 · setting_info 12 · get_total_balance 3 · budget_suggestion 1 · roi_target 1; **41 gian khác nhau**; gian cao nhất 8 lần (1359898174, 1883811931), 7 lần (331545740, 453810830, 1250096431, 1932588402) | ❌ |
| Chuỗi 429 cùng gian cách 60–80 s (lỗi 22/10) | 0 | **0** — gian lặp cách ≥ 5'–30' (làn hoãn sàn 5' + chạy tiếp từ bước dở) | ✅ |
| `+ bão app (3 gian/60 s → hạ nhịp …)` | hiếm | **21 lần** → khóa app×ep get_all_cpc `hits` 96 → 117, `factor` **0,10 (sàn)**, lùi tới 04:12 23/10 — KHÔNG tự hồi về 1 | ❌ |
| Phân bố theo giờ (UTC) | đều | 03h 2 · 04h 7 · 06h 1 · 07h 5 · 08h 2 · 09h 4 · 10h 5 · 11h 6 · 12h 5 · 13h 1 · 14h 3 · 15h 8 · 16h 2 · **17h 26 · 18h 39** · 19h 5 · 20h 7 · **21h 22** · 22h 8 · 23h 3 · 00h 5 · 01h 2 → **00:00–02:00 VN = 65 (39 %)**, 04:00 VN = 22; ban ngày 1–8/h | ⚠ |
| So đêm 22/10 TRƯỚC A2 (A+B, không pace theo gian) | giảm | 106 / 7,7 h = 13,8/h (01:30–09:10 VN) **vs** đêm nay cùng khung 91 / 7,7 h = 11,8/h → pace 1 lệnh/5'/gian **không đổi nhịp 429** | ❌ |
| `[ApiBudget] CẦU DAO ĐÓNG` | 0 | **0** ("No matching logs") | ✅ |
| `api_throttle_states` shopee:2044679 | 162 đứng | **162**, updatedAt 21/10 22:46 (2040029: 14, 15/09) | ✅ |
| `[Ads-demand]` (10 dòng) | — | lớp 1: 5 · lớp 2: 39 · lớp 3: 5 gian, xung 30' cả ba; chặt nhất 3 % (một lần 32 % lúc factor app thấp); gian dùng 23 % trần gian×ep | ✅ |
| Chạy tiếp từ bước dở (A2) | có | **51 dòng**: bước 4 ×40, bước 2 ×10 (`[Ads-pulse] … (chạy tiếp từ bước 4)`) | ✅ |
| `cổng bảo quay lại sau` (51 dòng tải được 04:16–09:32) | — | 25 × 300 s (sàn 5' sau 429), 1–47 s ×12 (chờ app×ep quá 3 vòng ngủ — việc kế 13.9.9), 140–421 s ×7 (khóa gian×get_all_cpc 1/5' × factor) | — |
| `api_rate_keys` gian×endpoint | hits phân tán ≤ 2/gian/ngày | get_all_cpc **50 khóa, 151 hits, 40 khóa factor < 1 (min 0,22)**; setting_info 35 khóa 12 hits; total_balance 24 khóa 3 hits; 0 khóa đang bị chặn lúc đọc | ❌ |
| `adsPriority` / `adsPulseStep` ≠ 0 / `adsLockedAt` | — | 5 / 48 / 27 (80 gian) · 1/80 · 0 | ✅ |
| Trợ lý tươi (`nextAdsPulseAt` < now − 2 h, chưa khóa) | 0 | **0** cả 4 sàn (SHOPEE 80, TIKTOK 69, LAZADA 2, OFFLINE 2) | ✅ |
| `lastAdsSyncAt` / `nextAdsSyncAt` (49 gian nối Ads) | — | 40 gian lịch sử lúc 09h 23/10 (sóng 6 h từ boot 10:07: 16h → 22h → 04h → 10h); `nextAdsSyncAt` dồn 04–05h 24/10 (12) + 09–16h (41) | — |
| request_id mẫu (`lastError`) | — | gian 1359898174: `e3e3e7f35e74662c33951aca17f32500`; khóa app: `e3e3e7f35e74531d45a62d10a446d600` — mọi dòng 429 trong log đều có `request_id=` | — |

**Kết luận:**
1. **Cơ chế A2/A3 chạy đúng**: không còn chuỗi 60–80 s, xung chạy tiếp từ bước dở (51 lần), cầu dao app 0, Trợ lý vẫn tươi (0 gian trễ 2 h) — 429 giờ chỉ làm chậm một bước 5' chứ không làm mất số.
2. **Tiêu chí số KHÔNG ĐẠT**: 168/ngày ≫ 20. Và **giả thuyết A2 "trần theo gian" SAI nốt**: đã pace 1 lệnh/5'/gian mà nhịp 429 ban đêm không đổi (11,8/h vs 13,8/h); 21 lần ≥ 3 gian KHÁC NHAU dính trong 60 s — theo đúng tiêu chí bằng chứng của 13.9.8 đó là **tầng app (partner × endpoint)**. H4 (bước A) đúng tầng nhưng sai mức: trần thật của get_all_cpc thấp hơn nhiều so với 1/s.
3. **Sàn AIMD chặn học**: khóa app×ep đã xuống sàn 0,10 × 1/s = **6 lệnh/phút**, trong khi nhu cầu thật chỉ ≈ 2 lệnh/phút (49 gian / 30' + lịch sử) → van app×ep không còn pace gì nữa, cổng không thể học xuống thấp hơn. Sàn 0,1 là tỷ lệ của trần khởi điểm TỰ CHỌN (1/s) — chỗ này là thiết kế (sàn phải tuyệt đối theo lệnh/phút, hoặc học không sàn khi có bằng chứng tầng app), không phải chỉnh số. **Chưa sửa** — chờ anh chốt.
4. **Theo giờ**: 39 % số 429 rơi vào 00:00–02:00 VN, đỉnh phụ 04:00 VN (trùng sóng lịch sử 6 h); ban ngày cùng nhịp xung chỉ 1–8/h. 00–02h VN KHÔNG trùng sóng lịch sử (22h → 04h) → chưa giải thích được bằng tải của mình; nghi Shopee bóp theo giờ đổi ngày / tải đêm phía sàn — **chưa kiểm**, hỏi trong ticket.

**Việc kế (chờ anh chốt, chưa code):** (a) ticket Shopee (mục 11 + yêu cầu 15/09): partner 2044679, endpoint, 168 request_id/24 h, nhịp thật ~2 lệnh/phút cả app · 1 lệnh/5'/gian, hỏi trần thật theo tầng nào + cửa sổ + có bóp theo giờ; (b) thiết kế sàn AIMD tuyệt đối cho khóa app×ep (ghi ở 3); (c) C1 thẻ HQ "Quota Ads theo khóa" (anh đã chốt 22/10, chưa làm) — thẻ chỉ đọc nên làm được ngay cả khi chưa đạt. Không mở C2/D/C3 tới khi 429 ≤ 20/ngày.

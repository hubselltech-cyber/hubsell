# Hubsell HQ — mục "Sức khỏe" (radar sức chứa + timeline nâng cấp) — 12/09/2026

> **Trạng thái: ĐÃ CODE 12/09 khuya** (mục 7 ghi những gì khác thiết kế). Mở tại HQ → Sức khỏe (`/admin/health`, lá quyền `hq.health`, preset Kỹ thuật + Quản lý).

Anh Trung chốt 12/09 khuya: *"Làm hẳn một mục Sức khỏe: theo dõi user, gian
hàng, từ đó gợi ý phải làm gì, nâng cấp cái gì. Tất cả những gì em biết và phải
nhìn thấy trong tương lai để cảnh báo kịp thời. Nó là timeline luôn. Bao gồm cả
nâng cấp gói CPU."* Lý do: *"làm sao tự nhiên anh nhớ được việc shop lên hơn
1.000 gian mà nâng cấp"* — việc nhớ phải là của hệ thống.

---

## 1. Mục tiêu

| # | Mục tiêu | Cụ thể |
|---|---|---|
| S1 | Nhìn MỘT trang biết Hubsell đang ở đâu trên đường tăng trưởng | KPI hôm nay + mốc kế tiếp + ngày dự báo chạm |
| S2 | Hệ thống báo TRƯỚC khi nghẽn, không đợi seller kêu | chuông HQ + email khi chạm mốc, dự báo chạm trong 14 ngày, hoặc dấu hiệu quá tải |
| S3 | Mỗi mốc kèm việc phải làm + gói phải nâng + chi phí ước | checklist tick được, trạng thái lưu DB |
| S4 | Một nguồn cấu hình mốc/ngưỡng | `backend/src/config/capacity-plan.ts` (như `ads-cadence.ts`) |
| S5 | Không tốn tài nguyên | snapshot mỗi giờ, dấu hiệu mỗi 10', truy vấn đếm có index, không quét bảng lớn |

## 2. Ba lớp số liệu (collector `services/platform-health.ts`)

### 2.1 Tăng trưởng (GROWTH)
- Chủ shop: tổng, hoạt động 30 ngày (có đơn), mới 7 ngày.
- Gian ACTIVE theo sàn (Shopee/Lazada/TikTok/Offline); gian **đang chạy ads** (có
  campaign `ongoing`); gian DISCONNECTED (token chết).
- **Gian Shopee nối app Hubsell Ads** (`channelsHubsellAds`, 19/10/2026): ChannelAppAuth
  HUBSELL_ADS ACTIVE của gian Shopee ACTIVE không ngủ đông — MẪU SỐ QUOTA Ads API (quota
  tính theo app). Lưu cột `adsShops` trên snapshot để dự báo; là đại lượng `shopeeAdsShops`
  của chuỗi mốc **quota Ads Đ2/Đ3/Đ4** (`ADS_QUOTA_MILESTONES`, docs/ADS-NHIP-CANH-BAO.md
  13.5) — thẻ riêng "Quota Ads Shopee" dưới timeline, cùng khuôn tick "đã làm".
- Đơn: tổng, đơn/ngày trung bình 7 ngày, đỉnh ngày trong 30 ngày.
- Webhook/ngày (Shopee log 7 ngày ÷ 7).

### 2.2 Vận hành worker (WORKER)
- Gian **trễ hạn quét nhanh** > 15' và > 60' (nextFastSyncAt quá hạn, không bị khóa).
- Gian trễ xung ads > 2× nhịp.
- Hàng đợi webhook Shopee/MISA: số PENDING, tuổi job cũ nhất; StockPushJob pending;
  DeliveryTrackingTask quá hạn — **chỉ đếm khi `DELIVERY_FAIL_FEATURE` bật** (16/10/2026: tính năng
  Cứu đơn ẩn từ 12/10, worker không nhặt vé nên 2.410 vé cũ nằm "quá hạn" mãi → HQ báo vàng oan;
  nay dòng ghi "cứu đơn đang ẩn", số cũ trong ảnh chụp không làm vàng).
- Cầu dao app (ApiThrottleState đang paused), số lần trip 24h.
- Gian `syncFailCount ≥ 3` (sàn trễ đồng bộ), ủy quyền Hubsell Ads DISCONNECTED.
- **Mốc nước quét đơn** (15/10/2026, lát 3.6 giai đoạn 3): số gian có mốc / đang quét, gian đang vét dở
  (`ordersCatchupBeforeAt` khác NULL = lượt trước chạm trần trang), gian có mốc cũ hơn 90' / 6 giờ
  (`watermarkLagWarnMin` / `watermarkLagCritMin`, tự chọn), gian trễ nhất. Dấu hiệu `worker.watermark`
  vàng khi có gian vét dở hoặc quá 90', đỏ khi quá 6 giờ. Thẻ "Worker" ở KPI đầu trang cũng ghi tóm tắt.
  **Gian ngủ đông** (`hibernatedAt` khác NULL, `GOI-NGU-DONG-GIAN-HET-HAN.md`) bị worker bỏ qua nên mốc
  đứng yên: từ 16/10/2026 KHÔNG tính vào x/y lẫn gian trễ, chỉ in "· N ngủ đông (không tính)" (hôm 16/10
  4 gian dùng thử ngủ đông đúng luật làm HQ báo vàng "RUXI 233'").
  **Gian đang nạp lịch sử** (`historyBackfillPending`, gian vừa nối hoặc bật lại cờ để kéo trọn 90 ngày) cũng
  đứng mốc: lượt backfill đọc trục create_time, worker không tính cửa sổ mốc nước (`runFastTier` plan = null)
  dù đơn vẫn về → từ 21/10/2026 KHÔNG tính trễ, in "· N đang nạp lịch sử (không tính)" (hôm 21/10 Bella Look
  bật lại cờ sau deploy sửa OOM → HQ đỏ "824'" oan, anh Trung tưởng nâng gói worker chưa đủ).
  **Hint gian trễ nhất** (21/10/2026): backend đọc thêm `lastSyncAt / lastSyncError / syncFailCount /
  syncLockedAt / nextFastSyncAt` của đúng gian đó (`WatermarkHealth.worst`) và viết thẳng vì sao — "lượt ĐƠN LỖI
  n lần: …" (token / sàn), "đơn vừa OK mà mốc không ghi" (lượt bị cắt sau tầng đơn: tiến trình chết / OOM),
  "đang cầm khóa x'" (vé mồ côi khi ≥ 15'), "quá hạn quét x' chưa được nhặt" (worker quá tải), còn lại "bậc
  giãn nhịp / vừa nối". Không còn phải mở SQL để biết hướng xem. Cùng ngày worker ghi mốc nước NGAY sau tầng
  đơn (cùng câu bookkeeping `lastSyncAt`) thay vì chỉ ở câu lịch cuối lượt — gian chết giữa tầng giờ không còn
  kéo mốc đứng yên.

### 2.3 Hạ tầng (INFRA)
- DB: `pg_database_size` (MB), 5 bảng lớn nhất, số kết nối đang mở / `max_connections`.
- Tiến trình: RSS/heap (MB), uptime, `HUBSELL_ROLE`, phiên bản deploy (git sha nếu có).
- **Gói đang dùng** khai trong `capacity-plan.ts` (anh sửa khi nâng): Render web
  Free 512MB / Supabase Free 500MB DB, 60 kết nối… → tính **% gói** cho DB, RAM,
  kết nối. Không đoán gói qua API (Render không lộ), khai tay là nguồn sự thật.

Lưu `platform_health_snapshots` mỗi giờ (JSON metrics + vài cột số để vẽ nhanh),
giữ 90 ngày (log-cleanup dọn).

## 3. Timeline mốc (config `capacity-plan.ts`)

Mỗi mốc: `key`, tên, **điều kiện chạm** (bất kỳ một trong các ngưỡng), **việc phải
làm** (checklist), **nâng gói** (tên gói + chi phí ước/tháng), ghi chú kỹ thuật.
Trạng thái mốc lưu `platform_capacity_milestones` {reachedAt, doneAt, doneBy}.

| Mốc | Chạm khi (một trong) | Nâng gói | Việc phải làm |
|---|---|---|---|
| **M0 Khởi động** (nay) | — | Render Free web, Supabase Free | ISV duyệt; 2 ticket quota; gỡ liên kết trùng ở nick test (giữ admin@hubsell.vn) |
| **M1 20 gian / 500 đơn-ngày** | gian ≥ 20 **hoặc đơn/ngày ≥ 500** hoặc chủ shop ≥ 50 hoặc DB ≥ 60% gói | Render Starter web ($7) + **Background Worker** Starter ($7) + Supabase Pro ($25) | HUBSELL_ROLE=worker/web; `connection_limit` trong DATABASE_URL; bật backup hàng ngày Supabase; đặt ADS_APP_QPS theo số Shopee trả lời |
| **M2 100 gian / 2.000 đơn/ngày** | gian ≥ 100 hoặc đơn/ngày ≥ 2.000 hoặc RAM ≥ 80% | Worker Standard 2GB ($25) | AUTO_SYNC_CONCURRENCY 6; upsert perf ads theo lô; webhook Lazada vào hàng đợi; cảnh báo vận hành ra email/Telegram; rà index Order/OrderItem |
| **M3 500 gian / 10.000 đơn/ngày** | gian ≥ 500 hoặc đơn/ngày ≥ 10.000 hoặc kết nối ≥ 80% hoặc DB ≥ 70% | Supabase compute Small→Medium (+$60…), web Standard | 2 worker instance (bucket/breaker qua DB đã sẵn); retention đơn 1 năm + rollup tháng; log cleanup 7 ngày; Redis (Render Key Value) cho token bucket toàn cục |
| **M4 1.000 gian / 30.000 đơn/ngày** | gian ≥ 1.000 hoặc đơn/ngày ≥ 30.000 | Supabase Team + read replica; worker Pro | Báo cáo/P&L đọc từ replica; queue riêng (pg-boss) thay setInterval; SLA + người trực; Lazada ads có điều kiện nếu quota không nâng |
| **M5 5.000 gian / 100.000 đơn-ngày** | gian ≥ 5.000 hoặc đơn/ngày ≥ 100.000 | Multi-instance web + worker theo sàn | Tách worker theo sàn/tenant; giám sát APM; rate limit theo tenant |
| **M6 10.000 gian / 300.000 đơn-ngày** | gian ≥ 10.000 hoặc đơn/ngày ≥ 300.000 | DB đọc/ghi tách, Postgres partition theo tháng | Kiến trúc lại đơn/kho theo shard; SRE trực 24/7 |

Con số chi phí là giá niêm yết Render/Supabase 09/2026, ghi trong config để sửa.

**Nguyên tắc (anh Trung 12/09): mọi mốc chạm khi GIAN hoặc ĐƠN/NGÀY tới ngưỡng — một
khách vài nghìn đơn/ngày với ít gian vẫn kéo hệ thống lên đúng mốc. Chạm mốc cao
thì các mốc thấp coi như đã chạm.**

**Dự báo ngày chạm:** hồi quy tuyến tính 30 snapshot ngày gần nhất (gian, chủ
shop, đơn/ngày, DB MB) → ETA cho từng điều kiện của mốc kế tiếp; lấy ETA sớm
nhất. Ít hơn 7 điểm dữ liệu → "chưa đủ dữ liệu".

## 4. Cảnh báo (worker `workers/health-watch.ts`)

| Loại | Nhịp | Điều kiện | Kênh |
|---|---|---|---|
| Chạm mốc | mỗi giờ | mốc kế tiếp thỏa điều kiện, chưa có reachedAt | chuông HQ (mọi platform admin) + email |
| Sắp chạm | mỗi ngày 08:00 | ETA ≤ 14 ngày | chuông + email (1 lần/mốc/tuần) |
| Quá tải worker | mỗi 10' | trễ >15' ≥ 5% gian hoặc ≥ 20 gian; webhook pending ≥ 200 hoặc job cũ nhất > 30'; cầu dao đang đóng | chuông + email (dedupe 6h) |
| Hạ tầng | mỗi giờ | DB ≥ 80% gói, RAM ≥ 85%, kết nối ≥ 80% | chuông + email (dedupe 24h) |
| Token/ủy quyền | mỗi giờ | gian DISCONNECTED tăng ≥ 3 trong 24h | chuông |

**Chỉnh ngưỡng 28/09/2026 (anh Trung: "sao nhanh vượt ngưỡng vậy", kiểm log prod):**
- Dấu hiệu *Gian rớt kết nối* trước đếm TỔNG gian DISCONNECTED (4 gian rớt lâu
  ngày khách chưa nối lại) → vàng mãi. Nay đếm gian MỚI rớt trong 24h
  (`disconnectedAt`) theo đúng `disconnectedDelta24h = 3`; gian ACTIVE lỗi ≥3
  nhịp vẫn vàng (việc thật, VD KYC Shopee).
- Dấu hiệu *Cầu dao*: đỏ khi đang đóng (giữ); vàng khi đóng liên tiếp ≥
  `breakerTripsWarn24h = 3` (trước: >0 — một lần 429 lẻ của sàn cũng vàng).
- Gốc của dải đỏ 28/09 không phải ngưỡng mà là cầu dao Ads coi HTTP 429 lẻ trên
  1 gian là trần app → sửa ở docs/ADS-NHIP-CANH-BAO.md Tầng C mục 2.

**Chỉnh dấu hiệu RAM 29/09/2026 (anh Trung: "RAM có vẻ hơi tốn, mới có vài người dùng"):**
- Đo prod 14:56–15:00: RSS 375 → 320 MB trong 2 phút, heap đang dùng chỉ 64/368 MB.
  RSS là mức đỉnh hệ điều hành còn giữ sau request nặng, không tăng theo số khách.
- Dấu hiệu *RAM tiến trình* nay vàng/đỏ theo **% heap** (`heapPctWarn = 70`,
  `heapPctCrit = 85`, mặc định tự chọn, cùng số với lib/memory-watch.ts); RSS chỉ
  kéo lên **đỏ** khi ≥ `ramPctCrit = 85` % gói (sát trần thì Render khởi động lại).
  Bỏ mức vàng theo RSS (`ramPctWarn`). Hàm `ramLevel()` có test.
- Thẻ KPI hiện heap đang dùng làm số chính, RSS + % gói ở dòng phụ.
- Điều kiện mốc M2 "RAM ≥ 80%" GIỮ theo RSS (chưa đổi).

## 19/10/2026 — M2 chạm theo số đếm, đánh giá có cần nâng gói không (anh Trung CHỐT 19/10 ~15:30: GIỮ Worker Starter, KHÔNG đặt AUTO_SYNC_CONCURRENCY=6, nâng khi đủ điều kiện dưới)

**Chạm:** 106 gian ≥ 100 **và** 3.019 đơn/ngày (7 ngày) ≥ 2.000 — cả hai điều kiện đếm. Nâng gói M2 = Worker Standard 2 GB (25 USD, thay Starter 7 USD).

**Tải thật (đọc prod 19/10 15:00, SQL `platform_health_snapshots` — ảnh chụp do worker chụp nên RAM là RAM worker):**

| Chỉ số | Số | Ngưỡng nâng |
|---|---|---|
| RSS worker | 197–254 MB bình thường, 335 MB (65 %) ngay sau deploy 14:52 | ≥ 80 % = 410 MB ở ảnh chụp bình thường |
| Heap worker | 65–104 / 368 MB | 85 % |
| DB | 1.333 MB / 8 GB = 16 % | 60–70 % |
| Mốc nước quét đơn | 91/94 gian tươi; 2 gian trễ vì lỗi mã (DONG-BO-GIAI-DOAN-3 mục 2.8), 1 gian mới | — |
| Worker | "Đúng nhịp", overdueFast 0 | — |

**Kết luận đề xuất:** mốc đếm chạm là lúc **rà**, không phải lúc **mua**. Mọi thước đo sức chứa còn dưới một nửa → **chưa nâng Worker Standard**, **chưa đặt `AUTO_SYNC_CONCURRENCY=6`** (2 gian TikTok chiếm luồng là do lỗi đọc lại 2.500 đơn mỗi lượt, sửa xong thì nhẹ hơn; tăng luồng trên 512 MB chỉ tăng RAM + lệnh sàn). Nâng khi: RSS worker ≥ 80 % ở ảnh chụp bình thường (không phải lúc khởi động), hoặc ≥ 5 gian mốc nước quá 90' mà không gian nào lỗi token/sàn, hoặc overdueFast tăng. Ba việc checklist M2 còn lại (upsert ads theo lô, webhook Lazada vào hàng đợi bền, rà index Order/OrderItem) vẫn đáng làm khi rảnh — không tốn tiền. Ghi chú DB: tăng ~400 MB trong 13 giờ 19/10 (921 → 1.333 MB) là do 3 gian lớn mới nối nạp 90 ngày (Siêu Thị 8686 18/10, KTNstore + TOVO 21 19/10), không phải rò.

- Kèm: anh đặt env `MALLOC_ARENA_MAX=2` trên Render web để giảm phân mảnh; so RSS
  sau ~1 ngày chạy với mức 320–375 MB.

Chuông dùng `notify()` sẵn có (type `platform-health`, dedupe 24h theo title);
email qua `lib/mailer.ts` tới email của mọi user `isPlatformAdmin` (+ env
`HQ_ALERT_EMAILS` nếu muốn thêm).

## 5. Giao diện `/admin/health` (lá quyền mới `hq.health`, sidebar "Sức khỏe")

1. **Hàng KPI** (StatCard sẵn): Gian hoạt động (chip theo sàn) · Chủ shop hoạt động ·
   Đơn/ngày (7d) · Worker (OK / N gian trễ) · DB (MB, % gói) · RAM (% gói).
2. **Timeline dọc** các mốc: đã qua ✓ (ngày), **đang ở** (nổi bật), sắp tới (ETA
   "≈ 23 ngày nữa"), xa. Mỗi mốc mở ra: điều kiện + giá trị hiện tại, gói nâng +
   chi phí, checklist với ô "Đã làm" (ghi doneAt/doneBy + audit log).
3. **Gợi ý hôm nay**: tối đa 3 việc, sinh từ dấu hiệu đỏ/vàng + mốc kế tiếp.
4. **Dấu hiệu vận hành**: bảng ngưỡng ↔ giá trị, màu xanh/vàng/đỏ.
5. **Xu hướng 30 ngày**: sparkline gian / đơn-ngày / DB MB từ snapshot.

Chỉ đọc + tick checklist; không có nút nào gọi sàn hay đổi cấu hình.

## 6. Kế hoạch code (mỗi bước một commit)

1. Schema + migration: `platform_health_snapshots`, `platform_capacity_milestones`.
2. `config/capacity-plan.ts` (mốc, ngưỡng, gói đang dùng, giá) + test hàm thuần
   (điều kiện chạm, ETA hồi quy, sinh gợi ý).
3. `services/platform-health.ts`: collector 3 lớp + snapshot + đánh giá dấu hiệu.
4. `workers/health-watch.ts`: 10' dấu hiệu, 60' snapshot + mốc, 08:00 dự báo;
   gắn vào `workers/index.ts`; log-cleanup dọn snapshot > 90 ngày.
5. `routes/admin-health.ts`: GET /api/admin/health (tổng hợp), GET /history,
   POST /milestones/:key/done|undone (audit log). Lá `hq.health` ở 2 registry.
6. FE `/admin/health` + mục sidebar + preset quyền Kỹ thuật/Quản lý.
7. Docs (file này cập nhật "đã làm"), memory, chạy thử local, push.

Ước lượng: 1 buổi rưỡi. Rủi ro: truy vấn `pg_database_size`/`pg_stat_activity`
cần quyền trên Supabase (role thường được phép); nếu bị chặn thì hiện "không đọc
được", không vỡ trang.

## 7. Đã code (12/09 khuya) — khác biệt so với thiết kế

- **KHÔNG email, KHÔNG chuông** (anh Trung chốt 12/09 khuya: "làm trong HQ để anh theo
  dõi, chạm ngưỡng thì báo đỏ lên là được"). Mục 4 ở trên chỉ là thiết kế ban đầu,
  đã bỏ. Worker chỉ chụp snapshot **2 lần/ngày** (anh chốt "cho nhẹ") + ghi reachedAt mốc vừa chạm; trang có dải
  trạng thái đầu trang đỏ/vàng/xanh theo dấu hiệu. Tắt worker: `HEALTH_WATCH_OFF=1`.
- Files: `config/capacity-plan.ts` (gói đang dùng CURRENT_INFRA + ngưỡng + 7 mốc M0–M6
  + hàm thuần, test 9 ca), `services/platform-health.ts` (collector 3 lớp, mọi truy
  vấn bọc `safe()` — bảng thiếu/quyền pg_* bị chặn không vỡ trang), `workers/
  health-watch.ts` (10'/60'/08h VN), `routes/admin-health.ts` (GET /api/admin/health,
  POST /health/milestones/:key/done|undone → audit `health.milestone.*`), FE
  `frontend/src/app/admin/health/page.tsx` (dải trạng thái đỏ/vàng/xanh, KPI 6 ô, gợi ý, timeline dọc tick được,
  dấu hiệu, sparkline 30 ngày, bảng lớn nhất).
- Bảng mới: `platform_health_snapshots` (dọn >90 ngày ở log-cleanup),
  `platform_capacity_milestones`; thêm index `Order(createdAt)` cho thống kê toàn
  nền tảng (trước đây quét cả bảng).
- **Khi nâng gói thật: sửa `CURRENT_INFRA` trong capacity-plan.ts** (Render/Supabase
  không lộ gói qua API) rồi tick "Đã làm xong mốc này" trên trang.
- Chưa làm: dự báo cần ≥7 snapshot ngày (có sau 1 tuần chạy); RAM đo tiến trình
  đang trả lời request (web) — khi tách worker, số RAM worker chưa hiện (bổ sung sau).

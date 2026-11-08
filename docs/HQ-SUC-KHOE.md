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
  campaign `ongoing`); gian DISCONNECTED (tổng) + gian MỚI rớt 24h **tách theo lý do**
  (`channelsDisconnected24hDetail`, 07/11/2026: sàn từ chối / hết hạn ủy quyền / chưa ghi lý do /
  khách ngắt tay / khách xóa tài khoản — cột `Channel.disconnectReason` ghi tại nguồn ở mọi
  đường hạ gian, `integrations/channel-disconnect.ts`; dòng cũ suy từ User.deletedAt /
  authLostReason / hạn ủy quyền ≤ lúc ngắt).
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
  - **07/11/2026 (kiểm prod theo ảnh anh gửi):** số "mới rớt 24h" gộp cả gian bị hạ vì
    **khách tự xóa tài khoản** (`services/account-deletion.ts` hạ mọi gian của chủ shop
    trong một `updateMany` → nhiều gian cùng một mốc `disconnectedAt`) và gian khách
    ngắt tay. Ca 07/11: 2 gian TikTok rớt cùng mili-giây 18:28:36 UTC = một khách đăng
    ký, nối gian, kéo 183 đơn rồi xóa tài khoản sau 35 phút; cộng TORANO (ca 06/11)
    = 3 → vàng, dù 0 gian hỏng token. "N Hubsell Ads rớt" là lũy kế không cửa sổ thời
    gian (7 gian từ 03/10–27/10), không kéo màu thẻ.
  - **ĐÃ LÀM 07/11 chiều (anh chốt: "tách lý do đi để anh phân loại, đỡ phải hỏi lại"):**
    cột `Channel.disconnectReason` ghi TẠI NGUỒN ở 8 đường hạ gian (ACCOUNT_DELETED /
    MANUAL / AUTH_EXPIRED / AUTH_REVOKED, `integrations/channel-disconnect.ts`), nối lại → null;
    thẻ in "N mới rớt 24h: 1 hết hạn ủy quyền (TORANO · TIKTOK) · 2 khách xóa tài khoản (…)"
    và chỉ nhóm PHÍA SÀN (sàn từ chối / hết hạn / dòng cũ chưa ghi) so với
    `disconnectedDelta24h`; Hubsell Ads in "x rớt 24h (tổng y)" thay vì một số lũy kế. Ảnh
    chụp cũ không có detail → đếm tất như trước. Docs THOI-HAN-UY-QUYEN-SAN mục 8.
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

## 21/10/2026 — Anh đã nâng Worker Standard 2 GB; rà 4 việc checklist M2

Anh tự nâng gói trên Render trưa 21/10 (sau 2 lần OOM worker, PROGRESS.md phiên 21/10 trưa). Checklist M2 (`capacity-plan.ts`) rà lại:

| Việc | Trạng thái | Ghi chú |
|---|---|---|
| `AUTO_SYNC_CONCURRENCY=6` trên worker | **Anh đặt tay** trên Render (env) | Code đọc env, mặc định 3 (`workers/order-auto-sync.ts`). Đặt cùng lúc với `NODE_HEAP_MB=1536` — cờ heap trong `npm start` KHÔNG tự theo gói, thiếu là worker 2 GB vẫn chết ở heap 320 MB (docs/DEPLOY-RENDER-SUPABASE.md 2c). |
| Upsert hiệu suất ads theo lô | **Xong 21/10** | `integrations/ads-perf-batch.ts`: gom dòng (chiến dịch, ngày) rồi ghi MỘT câu `INSERT … SELECT FROM unnest(mảng) … ON CONFLICT DO UPDATE` mỗi lô ≤ 1.000 dòng; nối vào Shopee (`shopee/ads-campaigns.ts`, mỗi lô 100 chiến dịch sàn trả), TikTok (`tiktok-ads/sync.ts`, cả cửa sổ), Lazada (`lazada/ads-campaigns.ts`, mỗi trang report). Chỉ đè cột sàn có số (TikTok không có impression/clicks → giữ nguyên), cùng khóa lặp trong lô thì dòng sau thắng — y nghĩa upsert từng dòng cũ. Gian 100 chiến dịch × 30 ngày: 3.000 lượt đi-về Supabase → 3 câu. |
| Webhook Lazada vào hàng đợi bền | **Xong 01/10** | `routes/webhooks.ts` ghi `webhook_events` + xếp việc trong một giao dịch rồi ack (docs/HANG-DOI-BEN.md); test `lazada-webhook-queue.test.ts`. |
| Rà index Order(channelId, createdAt), OrderItem(orderId) | **Đã có** | `schema.prisma`: Order có `@@index([channelId, createdAt])` (kèm `[channelId, isSettled]`, `[channelId, deliveredAt]`), OrderItem có `@@index([orderId])`. Không cần migration. |

## 31/10/2026 — M3 sắp chạm theo số đơn (HQ "≈4 ngày"): anh Trung CHỐT ĐỂ NGUYÊN, đợi chạm rồi đo lại — chạm mốc đơn/ngày KHÔNG phải lệnh mua

- Số HQ 31/10 21:11: M2, 182 gian, 234 chủ shop, 8.748 đơn/ngày (đỉnh 30 ngày 13.066, webhook 68.879/ngày), worker 155/155 đúng nhịp (trễ nhất 61'), webhook chờ 0, DB 4.104 MB (50 % Pro 8 GB, compute Small 2 GB), web heap 84 MB (23 % trần) / RSS 275 MB (54 % gói). Không dấu hiệu nào vàng.
- Anh hỏi "cứ ~15 nghìn đơn lại nâng?" → không: mốc là cấp số nhân 500 / 2.000 / 10.000 / 30.000 / 100.000 / 300.000, mỗi bậc ×3–5; tổng tiền 44 → 69 → ~164 → ~933 → ~1.333 → ~2.833 USD/tháng. M4 (Supabase Team + replica 599 USD) là bậc duy nhất chi phí trên mỗi đơn tăng — rà lại khi gần 20.000 đơn/ngày (có cần đúng gói Team hay chỉ replica).
- Anh hỏi "lên 10.000 có cần nâng không, hạ tầng chưa hết nhiều?" → không. Ngưỡng 10.000 là số tự chọn 12/09 để lên kế hoạch, không phải số đo. Ba món tiền M3 soi với số thật: compute Medium (60 USD) — kết nối chưa vàng, Disk IO thiếu hôm 28/10 là do mã; web Standard (25 USD) — RSS 54 %; Redis (10 USD) — chỉ cần khi 2 worker instance, mà worker đang đúng nhịp. Bằng chứng mốc dè dặt hơn thực tế ~1 bậc: M2 ghi Worker Standard, anh giữ Starter, vẫn chạy tới 8.748 đơn/ngày.
- Đồng hồ THẬT sẽ đuối trước RAM/CPU: (1) % dung lượng DB — tích lũy theo đơn, vàng 60 % = 4,9 GB, M3 70 % = 5,7 GB; retention đơn 1 năm + dọn log 7 ngày (việc mã M3) kéo giãn; (2) Disk IO budget compute Small (bùng rồi cạn → 502 như 28/10) — HQ CHƯA hiện, còn nợ mục "IO balance"; (3) % kết nối.
- Dự báo "≈4 ngày" là hồi quy tuyến tính 7 ngày trên đà 11/11; điều kiện mốc tính TB 7 ngày nên ngày sale đơn lẻ không chạm, sau 11/11 TB có thể tụt lại.
- **Anh chốt:** *"đợi khi nào nó chạm rồi đo lại sau. Tại vì bây giờ người trả phí không nhiều, mình đang phải nuôi hạ tầng là chính."* → KHÔNG sửa HQ (em có đề xuất tách "việc mã / việc tiền" trong M3 — anh để nguyên). Khi M3 chạm: làm phần mã trong checklist (2 worker claim vé, retention, log cleanup) + đo 3 đồng hồ trên rồi mới bàn tiền. Cùng luật với mục 19/10.

## 08/11/2026 — Rà HQ theo ảnh anh gửi (15:50 VN): M3 ĐÃ CHẠM từ 04/11 21:05 theo đơn/ngày; vàng Hàng đợi bền là nhịp TikTok 429 quen, vàng DB 68 %; đo 3 đồng hồ thật

Số HQ 15:50: 221 gian (TikTok 116 · Shopee 102 · Lazada 3), 272 chủ shop (+33 tuần này), **10.484 đơn/ngày** (đỉnh 30 ngày 15.016, webhook 79.684/ngày, hôm nay tới 15:55 đã 5.598 đơn), worker đúng nhịp 168/168 gian (trễ nhất 57', 48 ngủ đông), webhook Shopee chờ 0, cầu dao mở, hóa đơn 0 việc, kết nối 23/90 (26 %). Hai thẻ vàng + một dòng mốc:

**1. Hàng đợi bền vàng (153 chờ → lúc đo 150–170, 4 chạy, hộp thư đến 343 → 198, cũ nhất 4' → 1').** SQL prod 15:52–15:56 (chỉ đọc): việc cũ nhất chỉ ~1 phút, nhịp ra 186–556 việc / 5' suốt 1 giờ (không tắc), 0 retry / 0 lỗi; cả 4 slot đều Bella Look nhưng 2,2 s/việc (276 việc / 10'), gian chậm nhất là **Sỉ Nghi 85 Store 10,0 s/việc** (119 việc / 10'), GUMAX 4,4 s, Shop Nghi 85 5,6 s, Nghi Clothings85 5,7 s; gian còn lại 0,7–1,3 s. Render log worker 15:00–15:41: 23 dòng 429 `36009002`, 17 ở `returns/search`, 4 `cancellations/search`, 2 `statement_transactions`, nhịp gian xuống đáy 0,2/s. Vàng vì `waiting > 50` (crit mới cần ≥ 200 chờ hoặc cũ nhất ≥ 30'). **= cơ chế Bella Look 26/10 lặp lần 4, mức nhẹ, buổi chiều**: làn nhịp RAM theo gian hạ theo 429 của quét hoàn/hủy, việc webhook ngủ trong slot. Thuộc 5e đại tu lớp gọi sàn — CHỈ GHI NHẬN, không sửa, không restart (anh chốt 27/10). Không mất dữ liệu.

**2. Dung lượng DB 68 % (5.536 MB / 8.192).** Snapshot: 04/11 21:05 5.093 → 08/11 01:43 5.536 MB = **~138 MB / ngày** (chậm hơn 194–200 MB/ngày tuần trước). Mốc M3 70 % = 5.734 MB → còn ~200 MB ≈ **chạm 09–10/11**; đỏ 80 % = 6.554 MB ≈ 15/11 nếu giữ đà. Ổ Supabase 6,62 / 12 GB (DB 5,3 + WAL 1 + hệ 0,2), Spend Cap vẫn BẬT (ổ muốn tự nở lên 18 GB ở mốc 90 % phải tắt) — ⏳ anh quyết từ 06/11, chưa đổi.

**3. Mốc M3 "Đang ở"**: `platform_capacity_milestones` ghi `reachedAt` **04/11 21:05 VN** (đơn/ngày TB 7 ngày vượt 10.000; snapshot 04/11 21:05 opd=10.003), HQ hiện 4 ô checklist chưa tick. Theo anh chốt 31/10: chạm thì ĐO 3 đồng hồ thật trước khi bàn tiền:
- % dung lượng DB: 68 % (vàng; xem mục 2).
- **Disk IO balance (Supabase Settings → Infrastructure, đọc tooltip ảnh): 99 %** — suốt 01–07/11 đường đỏ sát 100 %. Kết luận cho dứt mâu thuẫn 04/11 vs 06/11 trong memory: **IO không cạn**, dòng "0 % cả tuần" 04/11 là đọc nhầm. Memory 62 %, ổ 55 %.
- % kết nối: 21–23 / 90 (23–26 %).
- Thêm một đồng hồ chưa có trong kế hoạch: **CPU compute DB** biểu đồ tuần theo ngày 55 % (01/11) → 75 → 80 → 75 → **~100 % (05/11)** → 75 → 67 % (07/11); thẻ hiện 95 %; bong bóng live 23 %, Observability 60 phút 10,4 % (chiều Chủ nhật). Chưa rõ biểu đồ tuần là trung bình hay đỉnh ngày — ghi lại để so các ngày sau, chưa kết luận.
- Bốn việc mã trong checklist M3 soi với luật 06/11 (không kéo việc giai đoạn 4 lên): "2 worker instance" = thêm instance Standard thứ hai (+25 USD, là tiền chứ không phải mã); "retention đơn 1 năm + rollup" và "log cleanup 7 ngày" = giai đoạn 4 Vòng đời dữ liệu của kiến trúc triệu đơn; "Redis" = tiền. → không còn "việc mã thuần" nào trong M3; ⏳ chờ anh chốt (xem PROGRESS 08/11).

**Việc khác đã kiểm:** thẻ Gian rớt "1 mới rớt 24h: sàn từ chối / thu hồi" = **KhogiaydepHoaiAnh (TikTok)** `disconnectReason=AUTH_REVOKED` 11:49 VN 08/11, TikTok code 36004006 "authorization is cancelled" = chủ shop tự hủy ủy quyền trên TikTok; gian Shopee cùng chủ vẫn ACTIVE, mốc nước 15:54 — cột lý do ghi tại nguồn (3441334d) chạy đúng ca đầu tiên. **RAM worker** (snapshot vai worker): RSS 240 MB (07/11 00:36) → 616 (13:42) → **1.008 MB** (08/11 01:43, uptime 24 h), heap 339 / 1.584 MB (21 %) — 49 % gói 2 GB, dưới điều kiện nâng 80 % (19/10) nhưng đà leo trong 1 ngày đáng theo dõi; `CURRENT_INFRA` còn ghi worker Starter 512 MB nên snapshot tính `ramPct=197` sai → **đã sửa 08/11**: workerPlan Standard 2 GB, `workerRamMb: 2048`, `monthlyUsd: 62`.

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

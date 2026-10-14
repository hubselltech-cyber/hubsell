# Giai đoạn 3 — Đồng bộ có cam kết đầy đủ và các worker còn lại

Ngày lập: 14/10/2026. Người lập: Claude (Lead Dev). Thiết kế gốc: `docs/KIEN-TRUC-QUY-MO-TRIEU-DON.md` mục 6.3–6.5 (anh Trung duyệt hướng 30/09/2026). Kế hoạch 7 lát trình 12/10/2026, anh Trung duyệt làm lần lượt 14/10/2026.

## 0. Tiến độ

| Lát | Nội dung | Đổi DB | Tình trạng |
|---|---|---|---|
| 3.0 | Gỡ đuôi giai đoạn 1 (9 công tắc env đường lui + đường đọc đơn gốc) | Không | ✅ 14/10 `1ce3bd31` — chi tiết `docs/SO-CAI-DON.md` mục 9.8 |
| 3.1 | Hợp đồng "dữ liệu + đầy đủ" cho mọi lượt đọc sàn + sửa Lazada kéo đơn ASC→DESC | Không | ✅ 14/10 — mục 1 dưới |
| 3.2 | Mốc nước từng gian thay cửa sổ cứng 2 ngày | Có: 2 cột NULL trên `Channel` (migration `20261014230000_channel_orders_watermark`) | ✅ 14/10 tối — anh chốt luật + OVERLAP 30 phút + SQL; mã ở mục 2.7 |
| 3.3 | Nhịp quét theo mức hoạt động (webhook vừa tới thì lùi quét; gian vắng 7 ngày → 6 giờ; có đơn 10 phút → 5 phút) | Không | Chưa — các số là mặc định tự chọn, anh chưa nhận |
| 3.4 | Bộ giới hạn tốc độ dùng chung ở DB, áp mọi API sàn | Có (bảng nhỏ) | Chưa |
| 3.5 | Worker còn vòng for → vé (token-refresh, lazada-renewal, stock-reconcile, weekly-report, ads-daily-summary) | Có (1–2 cột lịch) | Chưa |
| 3.6 | Chỉ số HQ: gian quá hạn quét, tỷ lệ lần đọc bị cắt, trễ mốc nước lớn nhất; test hàng rào | Không | ✅ 15/10 — mục 3 (làm trước 3.3 để có thước đo trước khi đổi nhịp) |

Mỗi lát một lần đẩy (hai lần nếu có công tắc), đường lui = revert commit trừ khi ghi khác.

## 1. Lát 3.1 — hợp đồng "dữ liệu + đầy đủ" (14/10/2026)

### 1.1. Vì sao

Mọi hàm đọc sàn theo trang đều có chốt chặn số trang (Shopee 100 trang/lượt đơn, TikTok 50 trang/lát, Lazada 100 trang; yêu cầu hoàn 50 / 40 / 40 trang). Chạm chốt là còn dữ liệu chưa đọc. Trước 29/09 việc này im lặng; 29/09 ba hàm đồng bộ đơn bắt đầu trả `truncated` nhưng chỉ worker đơn ghi log, ba hàm quét yêu cầu hoàn vẫn im. Riêng Lazada kéo đơn `sort_direction=ASC` nên khi bị cắt, phần mất là đơn **mới nhất** — ngược hai sàn kia.

### 1.2. Làm gì

- `backend/src/integrations/sync-contract.ts`: hai kiểu chung. `SyncCompleteness { pages; truncated }` cho kết quả lượt đồng bộ (đọc + ghi); `ReadCompleteness { complete }` cho lượt đọc thuần (adapter danh mục đã có từ 29/09). Hàm `incompleteReadMessage` cho một dòng log thống nhất, từ khóa `CHƯA ĐỦ`.
- Sáu kết quả đồng bộ `extends SyncCompleteness`: ba hàm đơn (đã có cờ, chỉ gắn hợp đồng) + ba hàm quét yêu cầu hoàn (`syncShopeeReturns`, `syncTiktokReturns`, `syncLazadaReturns`) nay đếm `pages` và đặt `truncated` khi hết trần trang mà sàn vẫn báo còn.
- Worker `order-auto-sync.ts`: một hàm `warnIfIncomplete(channel, "đơn" | "yêu cầu hoàn", r, backfill?)` thay `warnIfTruncated`, gọi ở cả sáu chỗ.
- Lazada `client.ts` `getOrders`: `sort_direction=DESC` cho cả trục `updated_at` lẫn `created_at`. Với phân trang offset, DESC còn an toàn hơn khi có biến động giữa chừng: đơn vừa đổi nhảy lên đầu, các trang sau chỉ đọc trùng (upsert vô hại); ASC thì đơn đó nhảy xuống cuối, trang kế hụt một dòng ở biên — mất đơn không ai biết.
- Test `integrations/__tests__/sync-contract.test.ts`: khóa bằng kiểu (`expectTypeOf`) — hàm nào bỏ cờ là `tsc` đỏ, Render build đỏ (Render biên dịch cả test); kèm 3 ca kiểm chuỗi log.

### 1.3. Cố ý KHÔNG làm ở lát này

- **Không ghi "lần đọc chưa đủ" xuống cột / không đếm lên HQ** (kế hoạch 12/10 có ghi "ghi cột + đếm HQ"): không có cột sẵn để ghi mà lát này cam kết không migration; đếm trong RAM thì trang HQ (tiến trình web) không thấy số của worker. Lát 3.2 thêm cột mốc nước trên `Channel` — "mốc nước không tiến" chính là tín hiệu đúng hơn "số lần bị cắt", và lát 3.6 đưa lên HQ.
- **Lượt nạp lịch sử gian mới chưa đủ vẫn hạ cờ `historyBackfillPending`** (giữ hành vi cũ): giữ cờ thì mỗi lượt lại nạp 90 ngày và lại chạm cùng một chốt. Phần thiếu do mốc nước (3.2) bù dần.
- Các hàm đọc khác có trần trang (sao kê TikTok/Lazada, ví Shopee, báo cáo quảng cáo) chưa gắn hợp đồng — chúng không quyết định "đơn có hay không", xếp vào 3.5/3.6 khi đụng tới.

### 1.4. Kiểm sau deploy

1. Render Logs worker lọc `CHƯA ĐỦ`: dòng cũ của đơn vẫn ra (nếu có gian lớn), dòng mới `yêu cầu hoàn CHƯA ĐỦ` xuất hiện khi gian có hơn 2.500 (Shopee) / 2.000 (TikTok/Lazada) yêu cầu hoàn trong cửa sổ — bình thường là không có dòng nào.
2. Gian Lazada: log `[Auto-sync] Lazada "…": +N đơn mới` vẫn chạy sau deploy (sàn nhận `sort_direction=DESC`); đơn Lazada mới nhất vào Hubsell như trước (so với Seller Center một đơn vừa tạo).
3. Không có dòng `[Auto-sync] Lỗi đồng bộ đơn gian` mới cho Lazada trong 30 phút đầu.

Đường lui: revert commit. Không migration, không đổi env.

## 2. Lát 3.2 — mốc nước từng gian (phương án 14/10/2026 — anh Trung CHỐT 14/10 tối, đã làm)

### 2.1. Hiện trạng đã rà (14/10)

- Worker `order-auto-sync.ts` quét đơn theo trục `update_time` với cửa sổ CỨNG `ORDERS_DAYS_BACK = 2` ngày ở cả ba sàn (`runFastTier`). Gian giãn nhịp tới 60 phút vẫn an toàn (60 phút ≪ 2 ngày). Khe hở còn lại: lượt quét bị cắt (chạm trần trang) thì phần cũ hơn trong 2 ngày đó mất hẳn; gian lỗi liên tiếp hoặc worker chết quá 2 ngày thì đơn đổi trạng thái trong khoảng đó không bao giờ được quét lại (chỉ còn webhook).
- Ba hàm đồng bộ đều nhận khoảng thời gian hai đầu: Shopee `get_order_list` `time_from`/`time_to` + `time_range_field=update_time` (tự cắt cửa sổ 15 ngày, đọc mới nhất trước); TikTok `orders/search` `update_time_ge`/`update_time_lt` (chế độ update giữ MỘT lát); Lazada `orders/get` `update_after` (chưa truyền `update_before` — API có, cần thêm vào `client.ts`), từ 14/10 đọc mới nhất trước. Cả ba trả `update_time` / `updated_at` từng đơn trong dữ liệu chi tiết → biết được mốc cũ nhất đã đọc.
- Cờ `historyBackfillPending` (gian mới nối) kéo 90 ngày trục `create_time` rồi hạ — đường này KHÔNG đổi.
- Nút tay "Đồng bộ 2 ngày" (`routes/orders.ts`), đồng bộ kho (`routes/warehouse.ts`), nút "Đồng bộ đơn" 90 ngày (`routes/channels.ts`) gọi thẳng hàm đồng bộ — KHÔNG đụng mốc nước (mốc chỉ do worker tiến).
- Bảng `Channel` đã có một cụm cột lịch quét (`nextFastSyncAt`, `syncBackoffLevel`, `syncLockedAt`…) → hai cột mới đặt cùng cụm.

### 2.2. Luật mốc nước (đề xuất)

Hai cột mới trên `Channel`, đều NULL được, không chỉ mục:

| Cột | Nghĩa |
|---|---|
| `ordersWatermarkAt` TIMESTAMP(3) | Mọi đơn có `update_time` ≤ mốc này ĐÃ được đọc đầy đủ. NULL = chưa có mốc (gian cũ sau deploy, gian mới). |
| `ordersCatchupBeforeAt` TIMESTAMP(3) | Khác NULL = lượt trước bị cắt; lượt sau phải đọc tiếp phần CŨ HƠN mốc này trước khi tiến mốc nước. |

Mỗi lượt quét nhanh của một gian:

1. `now0` = thời điểm BẮT ĐẦU gọi sàn (không phải lúc xong).
2. Cửa sổ đọc `[from, to]`:
   - `from` = `ordersWatermarkAt − OVERLAP`; mốc NULL → `now0 − 2 ngày` (đúng như hôm nay). Sàn `from` không được cũ hơn `now0 − 90 ngày` (HISTORY_BACKFILL_DAYS) — xa hơn thế là việc của nạp lịch sử, không phải quét.
   - `to` = `ordersCatchupBeforeAt` nếu khác NULL (đang vét phần dở), ngược lại `now0`.
3. Gọi hàm đồng bộ với cửa sổ đó (ba hàm thêm tùy chọn `updateTimeFrom/To` thay cho `daysBack`; hàm trả thêm `oldestUpdateTime` = `update_time` nhỏ nhất đã đọc).
4. Kết quả:
   - **Đủ** (`truncated = false`): nếu đang vét dở → `ordersCatchupBeforeAt = NULL`, `ordersWatermarkAt = to` (phần `[to, now0]` lượt sau đọc lại qua OVERLAP — đọc trùng, không mất); nếu lượt thường → `ordersWatermarkAt = now0`.
   - **Chưa đủ** (`truncated = true`): mốc nước GIỮ NGUYÊN; `ordersCatchupBeforeAt = oldestUpdateTime` (đọc mới nhất trước nên phần chưa đọc là phần CŨ HƠN mốc này). Lượt sau vét tiếp `[from, oldestUpdateTime]`; vét bao nhiêu lượt cũng được, mỗi lượt tiến một khúc. Log một dòng `mốc nước gian X: vét tiếp từ … tới …`.
   - **Lỗi** (sàn/token): không đụng hai cột.
5. Trần trang GIỮ nguyên (Shopee 100, TikTok 50, Lazada 100): không còn mất dữ liệu vì mốc không tiến, chỉ còn "trễ" — đo được bằng `now − ordersWatermarkAt` (lát 3.6 đưa lên HQ).
6. Webhook vẫn là đường chính; mốc nước chỉ là lưới an toàn — không đổi gì ở webhook.

**OVERLAP = 30 phút** (em tự chọn, chưa có nguồn): Shopee ghi `update_time` có thể trễ so với thời điểm đổi thật; đồng hồ Hubsell và sàn lệch vài giây; một đơn đổi đúng lúc lượt quét đang chạy có thể lọt. 30 phút = 3 nhịp quét gốc, giá mỗi lượt là đọc lại tối đa 30 phút đơn (vài chục đơn ở gian lớn — rẻ, đơn không đổi thì không ghi).

**Vì sao không lưu con trỏ trang của sàn** (bản 12/10 ghi `ordersWatermarkCursor`): `next_cursor` Shopee / `next_page_token` TikTok gắn với một lượt gọi, hết hạn không rõ; Lazada là offset, lệch khi có đơn mới. Mốc thời gian `oldestUpdateTime` dùng được cho cả ba sàn và luôn đúng.

### 2.3. Thay đổi mã (ước 1 ngày, một lần đẩy)

| Tệp | Việc |
|---|---|
| `prisma/schema.prisma` + migration `20261015xxxxxx_channel_orders_watermark` | 2 cột NULL; `ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS` — chỉ lấy khóa ngắn trên `Channel` (không đụng `Order`), chạy lại êm |
| `integrations/{shopee,tiktok,lazada}/service.ts` | tùy chọn `updateTimeFrom` / `updateTimeTo` (giây) thay `daysBack` khi worker truyền; trả `oldestUpdateTime`; Lazada `client.ts` thêm `update_before` |
| `integrations/sync-contract.ts` | `SyncCompleteness` thêm `oldestUpdateTime?: number` |
| `workers/order-auto-sync.ts` | hàm thuần `planOrderWindow(channel, now0)` → `{from, to, mode}` và `nextWatermark(plan, result)` → `{ordersWatermarkAt, ordersCatchupBeforeAt}`; ghi hai cột trong cùng câu `UPDATE` lịch ở `finally` (không thêm câu lệnh); đường lui env `ORDER_SYNC_WINDOW=fixed` → cửa sổ 2 ngày như cũ, không đọc/ghi cột |
| Test | `order-watermark.test.ts` (thuần): mốc NULL → 2 ngày; đủ → tiến `now0`; cắt → giữ mốc + catch-up; vét xong → mốc = `to`; floor 90 ngày; OVERLAP; lỗi không đụng. Test DB: hai lượt liên tiếp trên fixture, cột ghi đúng |

### 2.4. SQL migration (trình trước)

```sql
-- Mốc nước quét đơn theo gian (lát 3.2 giai đoạn 3, docs/DONG-BO-GIAI-DOAN-3.md mục 2).
-- Hai cột NULL, không mặc định, không chỉ mục: chỉ worker đọc/ghi theo id gian.
-- Chỉ khóa "Channel" trong tích tắc (ALTER ADD COLUMN NULL không ghi lại dòng).
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "ordersWatermarkAt"     TIMESTAMP(3);
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "ordersCatchupBeforeAt" TIMESTAMP(3);
```

Đường lui: env `ORDER_SYNC_WINDOW=fixed` (không cần revert, cột thừa vô hại); muốn bỏ hẳn thì `DROP COLUMN` sau.

### 2.5. Kiểm sau deploy (1 tuần song song với webhook)

1. Sau lượt quét đầu: `SELECT COUNT(*) FROM "Channel" WHERE status='ACTIVE' AND "ordersWatermarkAt" IS NOT NULL` tăng dần tới = số gian đang quét; `MAX(now() - "ordersWatermarkAt")` dưới 1 giờ ở mọi gian.
2. Log `CHƯA ĐỦ` đi kèm dòng `vét tiếp` và cột `ordersCatchupBeforeAt` về NULL sau vài lượt.
3. So 7 ngày: đơn có trong `webhook_events` (đơn mới) ↔ đơn có trong `Order` — không hụt; trang Đối soát đơn hoàn vẫn thấy đơn hoàn muộn.
4. Số lệnh Shopee/giờ trên `[SanHTTP]` không tăng (cửa sổ thường chỉ bằng nhịp quét + 30 phút, nhỏ hơn 2 ngày nhiều → kỳ vọng GIẢM).

### 2.6. Việc cần anh chốt

1. Luật ở 2.2 (đặc biệt: cắt thì vét phần cũ hơn bằng mốc thời gian, không lưu con trỏ sàn).
2. `OVERLAP` 30 phút — nhận, hay đổi.
3. SQL ở 2.4 — gật thì em viết mã, test xanh, trình commit rồi anh push.

### 2.7. Đã làm (14/10/2026 tối, đúng phương án 2.2–2.4)

- `services/order-watermark.ts` (thuần): `planOrderWindow(channel, now0)` → `{mode, fromSec, toSec}`; `nextWatermark(plan, r)` → hai cột cần ghi; `watermarkLogLine`. Hằng `WATERMARK_OVERLAP_SEC = 30 phút` (tự chọn, anh nhận 14/10), `WATERMARK_DEFAULT_DAYS = 2`, sàn dưới `WATERMARK_FLOOR_DAYS = HISTORY_BACKFILL_DAYS = 90`. Mốc vét nằm ngoài cửa sổ (cũ hơn sàn dưới / ở tương lai) thì bỏ, quét thường. Bị cắt mà `oldestUpdateTime` nằm ngoài cửa sổ (sàn trả dòng ngoài bộ lọc — nghi vấn TikTok 16/09 chưa đóng) hoặc không có → không đặt mốc vét, không tiến mốc, lượt sau quét lại: không bao giờ tiến mốc sai.
- Ba hàm đồng bộ đơn nhận `updateTimeFrom` / `updateTimeTo` (giây, hai đầu đóng; TikTok `update_time_lt` là mốc mở nên +1 giây) và trả `oldestUpdateTime` (Shopee từ chi tiết đơn, TikTok từ `update_time`, Lazada từ `updated_at`). Lazada `client.getOrders` thêm `update_before`. Các lời gọi `daysBack` cũ (nút tay, kho, backfill 90 ngày) không đổi.
- Worker: `runFastTier` tính cửa sổ TRƯỚC khi gọi sàn (`now0` = lúc bắt đầu), lượt backfill không dùng mốc nước; hai cột ghi trong cùng câu `UPDATE` lịch ở `finally` của `processChannel` (không thêm câu lệnh); lượt lỗi không ghi. Log chỉ khi bị cắt ("vét tiếp từ … tới …") hoặc vét xong ("mốc nước = …"); lượt thường im lặng. `ORDERS_DAYS_BACK` bỏ; đường lui `ORDER_SYNC_WINDOW=fixed`.
- Test: `services/__tests__/order-watermark.test.ts` 15 ca (fresh / advance / sàn 90 ngày / catch-up / mốc vét ngoài cửa sổ / fixed / cắt / vét xong / vét lại cắt / chuỗi 3 lượt / log). Không có test DB cho đường ghi: hai cột đi cùng câu UPDATE lịch đã chạy từ 12/09 — kiểm trên prod theo 2.5.
- Migration đã áp DB máy em (`apply-migration-local`). Prod: Render áp lúc khởi động; chỉ `ADD COLUMN NULL` trên `Channel`.

## 3. Lát 3.6 — chỉ số HQ + hàng rào (15/10/2026, anh Trung chốt làm trước 3.3)

### 3.1. Vì sao trước 3.3

Lát 3.2 vừa lên prod tối 14/10 mà chưa ai nhìn thấy số. Lát 3.3 đổi nhịp quét với hai số tự chọn (5 phút / 6 giờ); đổi nhịp khi chưa đo được tuổi mốc nước thì không biết tốt lên hay tệ đi. Làm 3.6 trước là có thước đo, 3.3 chọn số theo số thật.

### 3.2. Làm gì

- `services/platform-health.ts`: `WatermarkHealth` + `collectWatermarkHealth()` — hai câu đếm nhẹ trên `Channel` (gian ACTIVE có token, 3 sàn): gian có mốc / đang quét, gian đang vét dở, gian mốc cũ hơn 60' và 6 giờ, tuổi mốc lớn nhất + gian đó. Gắn vào `WorkerLayer.watermark` (tùy chọn, ảnh chụp cũ không có). Dấu hiệu `worker.watermark` ("Mốc nước quét đơn"): đỏ khi có gian quá 6 giờ, vàng khi có gian quá 60' hoặc đang vét dở, hint chỉ lọc log "vét tiếp" / xem `lastSyncError`. Ngưỡng `watermarkLagWarnMin = 90`, `watermarkLagCritMin = 360` ở `config/capacity-plan.ts` — MẶC ĐỊNH TỰ CHỌN (nhịp quét giãn tối đa 60' + jitter ±15% + thời gian lượt → gian im ắng bình thường tới ~70–75'; prod ngay sau deploy 15/10 thấy 57' nên 60' sẽ báo vàng oan — đổi 90' trước khi anh kịp thấy vàng).
- "Gian quá hạn quét" đã có sẵn (`overdueFast15/60`). "Tỷ lệ lần đọc bị cắt" chưa đo trực tiếp (lát 3.1 cố ý không ghi cột): số gian đang vét dở là thước đo thay — gian bị cắt ở lượt gần nhất.
- Trang `/admin/health`: thẻ KPI "Worker" ghi thêm "mốc nước x/y gian, trễ nhất N', k vét dở"; dấu hiệu mới tự xuất hiện trong bảng dấu hiệu và "Việc nên làm hôm nay" khi vàng/đỏ.
- Hàng rào `workers/__tests__/no-module-state.test.ts`: đọc thẳng mã `src/workers/*.ts` — `let` cấp module phải nằm trong danh sách cho phép kèm lý do (cờ started/running, timer, cấu hình đọc từ env); `new Map/Set`, mảng, object cấp module chỉ được khi là hàng chờ trong tiến trình mà DB vẫn là sự thật, cũng phải nằm trong danh sách kèm lý do (hiện 6 chỗ: `inFlight`/`adsSkipLogged` của order-auto-sync, `running` của invoice-lanes, `waiting`/`running`/`again` của stock-queue; test cũng bắt mục thừa). Ai thêm trạng thái RAM mới là test đỏ và phải nói rõ lý do.
- Test `services/__tests__/platform-health-watermark.test.ts` 6 ca cho dấu hiệu.

### 3.3. Kiểm sau deploy

1. Mở HQ → Sức khỏe: thẻ Worker có "mốc nước x/y gian"; dấu hiệu "Mốc nước quét đơn" xanh, trễ nhất dưới 60'. Nếu vàng vì "vét dở" → lọc log worker theo "vét tiếp": một gian lặp mãi = sàn trả dòng ngoài cửa sổ (nghi vấn TikTok 16/09) hoặc gian quá lớn.
2. x/y chưa đủ ngay sau deploy là bình thường (gian chưa chạy lượt đầu); sau 1 giờ phải bằng nhau.

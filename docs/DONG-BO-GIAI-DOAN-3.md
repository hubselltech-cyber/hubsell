# Giai đoạn 3 — Đồng bộ có cam kết đầy đủ và các worker còn lại

Ngày lập: 14/10/2026. Người lập: Claude (Lead Dev). Thiết kế gốc: `docs/KIEN-TRUC-QUY-MO-TRIEU-DON.md` mục 6.3–6.5 (anh Trung duyệt hướng 30/09/2026). Kế hoạch 7 lát trình 12/10/2026, anh Trung duyệt làm lần lượt 14/10/2026.

## 0. Tiến độ

| Lát | Nội dung | Đổi DB | Tình trạng |
|---|---|---|---|
| 3.0 | Gỡ đuôi giai đoạn 1 (9 công tắc env đường lui + đường đọc đơn gốc) | Không | ✅ 14/10 `1ce3bd31` — chi tiết `docs/SO-CAI-DON.md` mục 9.8 |
| 3.1 | Hợp đồng "dữ liệu + đầy đủ" cho mọi lượt đọc sàn + sửa Lazada kéo đơn ASC→DESC | Không | ✅ 14/10 — mục 1 dưới |
| 3.2 | Mốc nước từng gian thay cửa sổ cứng 2 ngày | Có: 2 cột NULL trên `Channel` (migration `20261014230000_channel_orders_watermark`) | ✅ 14/10 tối — anh chốt luật + OVERLAP 30 phút + SQL; mã ở mục 2.7; ⚠️ 19/10 sửa lỗi thiết kế gian vượt trần (TikTok đọc cũ → mới, mục 2.8) |
| 3.3 | Nhịp quét theo mức hoạt động (webhook vừa tới thì lùi quét; gian vắng 7 ngày → 6 giờ; có đơn 10 phút → 5 phút) | Không | Chưa — các số là mặc định tự chọn, anh chưa nhận |
| 3.4 | Bộ giới hạn tốc độ dùng chung ở DB, áp mọi API sàn | Có (bảng nhỏ) | Chưa |
| 3.5 | Worker còn vòng for → vé (token-refresh, lazada-renewal, stock-reconcile, weekly-report, ads-daily-summary) | Có (1–2 cột lịch) | Chưa |
| 3.6 | Chỉ số HQ: gian quá hạn quét, tỷ lệ lần đọc bị cắt, trễ mốc nước lớn nhất; test hàng rào | Không | ✅ 15/10 — mục 3 (làm trước 3.3 để có thước đo trước khi đổi nhịp) |
| 3.7 | Nút "Đồng bộ từ sàn" / "Lấy sản phẩm mới từ sàn" / Nối nhanh → web chỉ XIN kéo, worker kéo (web không kéo danh mục trong request nữa) | Có: 1 cột NULL `Channel.productSyncRequestedAt` (migration `20261103150000_channel_product_sync_requested`) | ✅ 03/11 — mục 5 (anh chốt làm trước 3.3 sau sự cố web OOM 7 lần); commit chưa push, chưa kiểm prod |
| 3.8 | Trang Giá vốn chia trang ở DB cho gian vượt 5.000 mã; lưu giá chỉ đọc đúng các mã liên quan | Không | ✅ 03/11 — mục 6; chưa kiểm trên dữ liệu thật của khách lớn |

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

### 2.8. Sửa 19/10/2026 — gian vượt trần đọc lại mãi: TikTok đọc CŨ → MỚI, mốc tiến dù bị cắt

**Hiện tượng (HQ 19/10 14:58, anh Trung hỏi):** dải đỏ "Mốc nước quét đơn: trễ nhất 2598' (TIKTOK · Siêu Thị 8686)", KTNstore TikTok 2287'. SQL: hai gian quét OK (lastSyncError trống, syncFailCount 0, lượt 14:53), cờ backfill đã hạ, mốc nước 17/10 19:40 / 18/10 00:55, không mốc vét.

**Cơ chế (log worker Render 14:08–14:53, từ khóa `8686`):**

| Giờ VN | Dòng log | Nghĩa |
|---|---|---|
| 14:08:42 | `CHƯA ĐỦ — dừng ở 50 trang, 2500 đơn` · `+1 đơn mới (2499 không đổi)` · `mốc nước giữ nguyên, vét tiếp từ 17/10 11:38:05Z tới 12:21:43Z` | lượt advance đọc 2.500 đơn MỚI nhất của cửa sổ 43 giờ, bỏ hết (đã có), chỉ ghi mốc vét = đơn cũ nhất đã đọc |
| 14:20:02 | `vét xong 11:38:05 → 12:21:43, mốc nước = 12:21:43Z` | lượt catchup vét 43 phút đơn cũ → mốc tiến tới mốc vét |
| 14:24:22 | `CHƯA ĐỦ 2500` · `vét tiếp 11:51:43 → 12:27:23` | lại đọc đúng 2.500 đơn mới nhất ấy; mốc vét chỉ nhích 6 phút |
| 14:32 / 14:43 / 14:53 | vét xong 12:27:23 → cắt → vét xong 12:40:01 | mỗi chu kỳ 2 lượt (~20 phút) mốc tiến 6–13 phút |

Luật 2.2 "đọc MỚI NHẤT TRƯỚC, cắt thì mốc vét = cũ nhất đã đọc" chỉ đúng khi cửa sổ có ≤ trần đơn. Gian có **nhiều hơn trần (2.500) biến động trong cửa sổ** thì phần đã đọc (2.500 đơn mới nhất) **không bao giờ được ghi nhận** — chu kỳ sau đọc lại y hệt, mốc chỉ tiến bằng phần dôi. Siêu Thị 8686 ~1.300–6.000 biến động/ngày (H1 Pha A: 2.577/2 ngày; bóng 19/10: 132 mã/28'), cửa sổ 43 giờ → không bao giờ đuổi kịp, mỗi lượt 50 trang × 2 ≈ 100 lệnh sàn và 4–12 phút chiếm một luồng worker. Đây là **lỗi thiết kế lát 3.2**, không phải thiếu worker (HQ gợi ý `AUTO_SYNC_CONCURRENCY=6` là hệ quả, không phải nguyên nhân). Khác bản vá 18/10 (`f7820681`, sàn trả sai thứ tự): lần này sàn trả đúng DESC.

**Sửa (một lần đẩy, không migration):**
- `integrations/sync-contract.ts`: `SyncCompleteness.coveredUpToSec?` — lượt đọc **CŨ → MỚI** bị cắt thì mọi dòng ≤ mốc này đã đọc trọn, phần chưa đọc là phần MỚI hơn. `incompleteReadMessage` đổi đuôi câu: "đã đọc trọn tới …, phần mới hơn lượt sau đọc tiếp".
- `services/order-watermark.ts`: `nextWatermark` — cắt mà có `coveredUpToSec` trong cửa sổ → `ordersWatermarkAt = covered`, xóa mốc vét (luật cắt cũ giữ cho sàn đọc mới → cũ); `watermarkLogLine` thêm dòng "lượt bị cắt, đã đọc trọn … → …, mốc nước = …".
- `integrations/tiktok/service.ts`: `tiktokOrderSearchSort(byUpdateTime, oldestFirst)` — đường mốc nước (`updateTimeFrom/To`) xin `sort_field=update_time&sort_order=ASC`; đường tay `daysBack` + `byUpdateTime` và `create_time` giữ DESC. `tiktokAscCoveredUpTo(updateTimes, truncated)` (thuần): cắt + dãy không giảm → mốc = update_time cuối; sai thứ tự → `undefined` + log `[TikTok] … KHÔNG tăng dần dù xin sort ASC` (không bao giờ tiến mốc sai). Khi `byWatermark` bị cắt thì bỏ `oldestUpdateTime` (mốc vét chỉ đúng với đọc mới → cũ).
- Shopee / Lazada **chưa đổi**: Shopee trần 200 trang × 100 = 20.000 đơn/lượt, Lazada 100 × 100 = 10.000 — chưa gian nào tới; cùng bẫy, khi tới thì làm giống (adapter trả `coveredUpToSec`).
- Test: `order-watermark.test.ts` +6 ca (cắt có covered → tiến; covered thắng oldest; covered ngoài cửa sổ; chuỗi 2 lượt đuổi kịp; đang vét dở từ bản cũ; log); `tiktok-order-search-sort.test.ts` viết lại (ASC đường mốc nước, DESC đường tay, 4 ca `tiktokAscCoveredUpTo`). 42 test 4 tệp qua, `tsc --noEmit` sạch.

**✅ Kiểm prod 19/10 15:45 (worker dd77a40 live 15:24):** KTNstore lượt 15:45:47 — `CHƯA ĐỦ — dừng ở 50 trang, 2500 đơn; đã đọc trọn tới 2026-10-19T07:52:52Z` + `lượt bị cắt, đã đọc trọn 17/10 17:34:01Z → 19/10 07:52:52Z, mốc nước = 19/10 07:52:52Z` → mốc nhảy **+38 giờ trong MỘT lượt** (bản cũ: 6–13 phút/chu kỳ 20'), không có dòng `KHÔNG tăng dần dù xin sort ASC` (TikTok tôn trọng ASC). Siêu Thị 8686 lượt kế 16:28 (đang ở bậc giãn 60' vì bản cũ thấy "2.499 không đổi" → coi là gian vắng — tác dụng phụ của lỗi, tự hết khi lượt ASC thấy biến động). Kiểm trước deploy: cách kiểm dưới.

**Kiểm sau deploy:** log worker `8686` / `KTNstore`: lượt đầu `CHƯA ĐỦ … đã đọc trọn tới …` + `lượt bị cắt, đã đọc trọn … mốc nước = …` (mốc nhảy ~40 giờ), lượt sau mốc = now0; HQ "Mốc nước quét đơn" xanh trong ≤ 3 lượt (~30'); không có dòng `KHÔNG tăng dần dù xin sort ASC`. SQL: `SELECT "shopName", now() - "ordersWatermarkAt" FROM "Channel" WHERE "channelName"='TIKTOK' AND "ordersWatermarkAt" < now() - interval '90 minutes';` → 0 dòng (trừ gian ngủ đông / mới nối).

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
3. (16/10/2026) Gian ngủ đông (`hibernatedAt`) không còn tính vào x/y lẫn "gian quá 90'" — lượt ngủ
   đông đầu tiên sáng 16/10 làm dấu hiệu vàng oan ("RUXI 233'", 3 gian quá 90'). Muốn đối chiếu:
   `SELECT "channelName","shopName","hibernatedAt","lastSyncError", now()-"ordersWatermarkAt" AS tuoi
   FROM "Channel" WHERE status='ACTIVE' AND "refreshToken" IS NOT NULL AND "ordersWatermarkAt" < now() - interval '90 minutes'
   ORDER BY tuoi DESC;` — gian trễ thật là dòng có `hibernatedAt` NULL.

## 4. Lát 3.3 — nhịp quét theo mức hoạt động (ĐỀ XUẤT 17/10/2026, lượt nhắc tự động — CHỜ anh Trung chốt, chưa viết mã)

### 4.1. Số thật đọc được sáng 17/10

| Việc | Kết quả | Đã kiểm? |
|---|---|---|
| `/health` prod | commit `837d2b27` = bản mới nhất (có 3.2 + 3.6 + sửa ngủ đông 16/10) | ✅ |
| Tuổi mốc nước, gian vét dở | không đọc được (DB prod + Logs Render bị chặn với công cụ) | ❌ → SQL 4.4 |
| Số lệnh gọi sàn `[SanHTTP]` | không đọc được | ❌ → từ khóa log 4.4 |

### 4.2. Phát hiện khi đọc lại mã trước khi đề xuất

1. **Tầng nhanh chạy MỌI lượt gian được nhặt** (`processChannel`: "tầng nhanh chạy mọi lượt, rẻ, idempotent"). Nhịp quét đơn THẬT của một gian = min(`nextFastSyncAt`, `nextHourlySyncAt` 60', `nextAdsPulseAt` 30–120'). Giãn riêng tầng nhanh lên 6 giờ như mô tả 12/10 thì gian vẫn bị quét đơn mỗi ≤ 60' qua tầng giờ → số 6 giờ vô tác dụng nếu không đụng tầng giờ.
2. **`changed` chỉ đếm đơn do CHÍNH lượt quét tạo/sửa.** Gian được webhook phục vụ tốt thì lượt quét luôn thấy "không đổi" và giãn tới 60' dù đang bán mạnh. Bậc giãn hiện tại đo "webhook có sót không", không đo "gian có bán không" — đúng vai lưới an toàn, nên GIỮ, không rút xuống 5'.
3. Webhook handler không đụng lịch quét; handler Shopee tải trọn dòng `Channel` theo `externalShopId` (có `syncBackoffLevel`) → đánh thức gian vắng không cần thêm câu đọc.
4. Tín hiệu "gian có đơn" có sẵn và rẻ: `MAX("createdAt")` của `Order` theo `channelId` — `createdAt` là NGÀY SÀN (ghi chú schema), có chỉ mục `(channelId, createdAt)` → một lần quét ngược chỉ mục mỗi lượt. `webhook_events` không có chỉ mục theo shop → không dùng làm tín hiệu.
5. **Xung đột ngưỡng:** dấu hiệu HQ "Mốc nước quét đơn" đỏ ở 360' (tự chọn 15/10). Gian nhịp 6 giờ sẽ đỏ oan y như gian ngủ đông sáng 16/10 → phải đưa gian vắng ra khỏi phép đếm (cùng cách đã làm với `hibernatedAt`).

### 4.3. Thiết kế đề xuất (không migration, một lần đẩy)

- **Bậc VẮNG** = `syncBackoffLevel = 9` (hằng `IDLE_LEVEL`; bậc thường 0–3 giữ nguyên 10'→20'→40'→60'). Vào bậc cuối lượt khi: không biến động **và** đã ở trần 60' **và** `MAX(Order.createdAt) < now − SYNC_IDLE_DAYS`. Ở bậc vắng: `nextFastSyncAt` = `nextHourlySyncAt` = now + `SYNC_IDLE_MINUTES` (có jitter). Xung ads giữ nguyên (gian không campaign đã là 120', 1 lệnh), nhưng lượt nhặt vì xung KHÔNG chạy tầng nhanh/giờ khi gian ở bậc vắng và chưa đến hạn.
- **Ra bậc vắng:** (a) lượt quét thấy biến động → về bậc 0 như cũ; (b) **webhook đơn tới gian đang bậc 9** → handler `UPDATE` `syncBackoffLevel=0, nextFastSyncAt=now+nhịp gốc, nextHourlySyncAt=now` — chỉ khi level=9, tức MỘT lần ghi cho cả chuỗi webhook sau đó, không ghi mỗi webhook; đơn vẫn do webhook kéo ngay, lượt quét kế chỉ vét sót; (c) gian thức dậy từ ngủ đông đã đặt `nextFastSyncAt=now` (giữ).
- **HQ:** `collectWatermarkHealth` + `overdueFast15/60` đếm riêng "N gian vắng (nhịp 6h)", loại khỏi `lagOver60/6h` giống gian ngủ đông; thẻ Worker thêm số đó.
- **BỎ hai ý của bản 12/10:**
  - "webhook vừa tới thì lùi lượt quét": tốn một `UPDATE Channel` mỗi webhook (mốc thiết kế 1 triệu đơn/ngày = 1 triệu lần ghi lên dòng nóng) để tiết kiệm tối đa một lượt quét mỗi 10' — lỗ.
  - "có đơn trong 10 phút → 5 phút": webhook là đường chính; rút nhịp = gấp đôi lệnh gọi trên gian bận nhất — đúng nơi 429 theo gian đã xảy ra 16/10 (cầu dao Ads); chưa có số nào cho thấy lượt quét bắt được đơn webhook sót. Đo trước (log `đơn mới (` có +N > 0 ở gian có webhook = số đơn webhook sót), rồi mới bàn.
- **Hai số** (đều là MẶC ĐỊNH TỰ CHỌN, env đổi được, anh chỉnh sau khi xem SQL 4.4):
  - `SYNC_IDLE_DAYS = 7`: lý lẽ chu kỳ tuần — gian chỉ bán cuối tuần có hai đơn cách nhau ≤ 6 ngày; không có nguồn API. SQL câu 3 cho biết hôm nay có bao nhiêu gian vượt 7 ngày (= số gian sẽ vào bậc vắng).
  - `SYNC_IDLE_MINUTES = 360`: bằng tầng ads lịch sử 6 giờ và ngưỡng đỏ HQ hiện tại; gian 7 ngày không đơn mà trễ 6 giờ thì không ai thấy. Bằng chứng chi phí chỉ là ước tính: Shopee mỗi lượt gian vắng ≈ 1 lệnh danh sách đơn + 1 lệnh yêu cầu hoàn + 2–3 lệnh tầng giờ (escrow/payout) ≈ 5 lệnh × 24 lượt/ngày ≈ 120 lệnh/gian/ngày → ≈ 20 ở nhịp 6 giờ. CHƯA ĐO — đo bằng `[SanHTTP] SHOPEE n=` trước/sau.
- **Đường lui:** `SYNC_IDLE_DAYS=0` tắt bậc vắng (hành vi hôm nay), không revert, không migration. Hàng rào `no-module-state.test.ts` không đổi (không thêm biến cấp module).
- Test thuần: `nextFastSchedule` nhận thêm `{ idle: boolean }`; ca vào/ra bậc vắng, webhook đánh thức chỉ ghi khi level=9, HQ loại gian vắng.

### 4.4. SQL chỉ đọc cho anh dán vào Supabase + từ khóa log Render (worker `hubsell-worker-sg`)

```sql
-- 1. Mốc nước sau 2 ngày (kỳ vọng: gian đang thức tuổi < 1 giờ, cột vét dở NULL)
SELECT "channelName","shopName","hibernatedAt","ordersWatermarkAt","ordersCatchupBeforeAt", now()-"ordersWatermarkAt" AS tuoi
FROM "Channel" WHERE status='ACTIVE' AND "refreshToken" IS NOT NULL ORDER BY tuoi DESC NULLS FIRST;

-- 2. Phân bố bậc giãn hiện tại (bao nhiêu gian đã nằm ở trần 60')
SELECT "channelName","syncBackoffLevel",COUNT(*) FROM "Channel"
WHERE status='ACTIVE' AND "refreshToken" IS NOT NULL AND "hibernatedAt" IS NULL GROUP BY 1,2 ORDER BY 1,2;

-- 3. Tuổi đơn mới nhất từng gian (số dòng tuổi > 7 ngày = số gian sẽ vào bậc vắng)
SELECT c."channelName", c."shopName", MAX(o."createdAt") AS don_moi_nhat, now()-MAX(o."createdAt") AS tuoi
FROM "Channel" c LEFT JOIN "Order" o ON o."channelId"=c.id
WHERE c.status='ACTIVE' AND c."refreshToken" IS NOT NULL AND c."hibernatedAt" IS NULL
GROUP BY c.id, c."channelName", c."shopName" ORDER BY tuoi DESC NULLS FIRST;
```

Log: `[SanHTTP] SHOPEE n=` (mỗi 15', lấy n → lệnh/giờ); `đơn mới (` (dòng +N với N > 0 = đơn webhook sót); `vét tiếp` (gian lặp mãi = sàn trả dòng ngoài cửa sổ); `[TikTok] Cửa sổ update_time` (update_time thấp nhất < đầu cửa sổ = sàn bỏ qua `update_time_ge`, nghi vấn 16/09 — khi đó lát 3.2 cố ý KHÔNG tiến mốc nên gian TikTok sẽ lộ ra ở SQL 1 bằng tuổi mốc tăng mãi, chứ không phải bằng vét dở).

### 4.5. Kiểm sau deploy

1. Sau ~1 ngày SQL 2 có bậc 9 ≈ số gian tuổi > 7 ngày ở SQL 3; HQ Sức khỏe không đỏ vì gian vắng, thẻ Worker ghi "N gian vắng".
2. `[SanHTTP] SHOPEE n=` mỗi 15' giảm so với 2 ngày trước deploy (ghi số trước/sau vào đây).
3. Một gian vắng nhận đơn thật: webhook đánh thức, SQL 2 thấy level về 0 trong 1 phút, log `[Auto-sync]` quét gian đó trong ≤ nhịp gốc.

## 5. Lát 3.7 — nút kéo danh mục chuyển sang worker (03/11/2026, anh Trung chốt "Làm trước 3.3")

### 5.1. Vì sao

Chiều 03/11 web `hubsell-backend-sg` (Starter 512 MB) "Ran out of memory" 7 lần (09:35; 14:13, 14:14, 14:30, 14:32,
14:34, 14:37) → `/health` 502, khách và HQ cùng thấy "Không kết nối được tới máy chủ Hubsell". Log web: mỗi lần boot
xong 1–2 phút là `[TikTok] Hình dạng sản phẩm (products/search)` → `Bổ sung chi tiết gian ongbocute.vn: 100 ok … còn 211`
→ `[product-sync] 46 dòng trùng mã` → chết. Kích hoạt = khách gian TikTok ongbocute.vn (~621 SP, gian cũ) bấm **Đồng bộ
từ sàn** ở Cấu hình Giá vốn; `POST /api/finance/sync-products` chạy `syncChannelProducts` NGAY TRONG web; web chết →
khách bấm lại → lặp. Heap V8 vẫn 66–80/368 MB, không cảnh báo; RSS nền 327 MB (boot 174 MB) — phần phình ngoài heap
(ghi ở PROGRESS phiên 03/11 10:30, chưa tìm hết gốc). Worker cùng 512 MB sáng đó kéo gọn 38. [ĐÍNH CHÍNH 03/11 ~16:15: worker thật là 1 CPU, 2 GB (Render ghi 1c-2g), KHÔNG phải 512 MB; so sánh này sai, không dùng được để nói web yếu vì RSS nền.]889 SP Shopee của Hy Korea →
web yếu vì nền RSS cao + việc nặng trong request, không phải vì 621 SP.

Đây là dòng "danh mục … chuyển sang hàng đợi" của giai đoạn 3 (`docs/KIEN-TRUC-QUY-MO-TRIEU-DON.md`, bảng giai đoạn) và
nguyên tắc tách vai 12/09 (`HUBSELL_ROLE=web` chỉ xếp việc). Nửa đầu đã làm 28/09 (worker `product-catalog-sync` kéo gian
mới + làm mới đêm); nút bấm là nửa còn sót. Không nâng máy, không chỉnh `NODE_HEAP_MB`.

### 5.2. Thiết kế

- **Trạng thái ở bảng nghiệp vụ, không ở RAM / không pg-boss:** thêm cột NULL `Channel.productSyncRequestedAt`. Việc kéo
  danh mục kéo dài hàng phút → không nhét vào hàng đợi `stately` (xem gotcha pg-boss, đẩy tồn bước 4 cũng chạy ngoài
  pg-boss). Cột lịch `nextProductSyncAt` + worker poll 5' đã có sẵn từ 28/09.
- **Web chỉ xin:** `requestProductSyncNow(ownerId, channelIds?)` (workers/product-catalog-sync.ts) phân loại từng gian
  bằng hàm thuần `classifyProductSyncRequest`: `ineligible` (Offline / không refreshToken / ngủ đông) → báo "Kết nối lại";
  `already` (mốc xin < 2 giờ) → không ghi lại; `recent` (kéo xong < 2 phút) → không gọi sàn lại; `queued` → ghi
  `nextProductSyncAt = productSyncRequestedAt = now`. Một `updateMany` cho cả lô.
- **Worker:** `runProductCatalogSync` không đổi cách nhận gian; `scheduleAfterProductSync` (xong hay lỗi) xóa
  `productSyncRequestedAt`. Log thêm chữ "theo nút bấm" để lọc. Gian đang được worker kéo (đã nhận) mà khách xin: lượt đang
  chạy xong sẽ đặt lịch đêm và xóa mốc xin — danh mục vừa kéo vẫn là mới, chấp nhận.
- **"Đang kéo":** `isCatalogPending(ch, now)` (thuần) = mốc xin < `REQUEST_STALE_MS` (2 giờ; quá là coi như treo, xin lại
  được, trang thôi báo) HOẶC luật gian mới 28/09 (chưa kéo lần đầu, trong 60' kể từ lúc tạo). `listCatalogSyncState(ownerId)`
  một truy vấn trả mọi gian online + `pending`; `findChannelsPendingCatalog` thay `findChannelsPendingFirstCatalog`.
- **Ba route web** không còn gọi `syncChannelProducts`:
  - `POST /api/finance/sync-products` → 202 `{queued: true, created: 0, updated: 0, perChannel: [{…, outcome, message,
    error? (ineligible)}]}` — khuôn cũ giữ nguyên cho giao diện cũ.
  - `GET /api/finance/sku-products/catalog-pending` → `{pending, channels: [{id, shopName, channelName, lastProductSyncAt,
    productSyncError, pending}]}` — nút đọc để biết lượt mình xin xong hay lỗi.
  - `POST /api/mappings/quick-link`: gian 0 SP → xin kéo, 202 `{queued, message}`; khách bấm Nối nhanh lại sau.
  - `POST /api/sao-chep-san-pham/sources/sync` → 202 `{queued}` (recent vẫn `{skipped}`); thêm
    `GET …/sources/sync-status?channelId` → `{pending, lastProductSyncAt, productSyncError}` (quyền copy-listing, nhân viên
    không có quyền tài chính vẫn hỏi được).
- **Giao diện (câu chữ phổ thông, anh chốt):** nút hiện **"Đang kéo trong vài phút…"**, toast "Đang kéo trong vài phút.
  Bảng tự cập nhật khi xong."; hỏi `catalog-pending` mỗi 5 giây, tối đa 30 phút (`lib/poll.ts`), xong → nạp lại bảng +
  "Đã kéo xong danh mục từ sàn." / "Có N gian lỗi: …" (lỗi = gian còn `productSyncError` mà `lastProductSyncAt` không mới
  hơn lúc bấm); quá 30 phút → "Việc kéo đang lâu hơn bình thường…". Trang Giá vốn vẫn dùng dải "Đang kéo danh mục sản phẩm
  của gian … thường xong trong vài phút" sẵn có (nay gồm cả gian vừa xin). Máy chủ bản cũ (`queued` thiếu) → giao diện vẫn
  đi đường cũ. Nối nhanh: toast "đang kéo danh mục trong vài phút — xong rồi bấm Nối nhanh lại". Sao chép SP: nút "Lấy sản
  phẩm mới từ sàn" cũng chờ theo nhịp rồi tự làm mới danh sách.
- **Mobile:** không ảnh hưởng (app không có nút đồng bộ danh mục).
- **Sửa sau khi anh thử (03/11 ~15:30, "xoay 5–6 phút khó chịu hơn cả báo lỗi"):** nút KHÔNG khóa/xoay chờ nữa — xin
  xong là trả về bình thường, trang Giá vốn hiện dải "Đang kéo danh mục…" (nạp lại ngay qua onSynced), việc hỏi nhịp chạy
  nền và chỉ nạp lại + báo xong/lỗi khi kéo xong; nút "Lấy sản phẩm mới từ sàn" cùng kiểu. Worker `POLL_MS` 5' → 1' (truy
  vấn theo chỉ mục, rẻ) nên chờ còn ≤ 1' + thời gian kéo thật.

### 5.3. Mã + kiểm local

`backend/prisma/migrations/20261103150000_channel_product_sync_requested/migration.sql`, `schema.prisma`,
`workers/product-catalog-sync.ts`, `routes/finance.ts`, `routes/mappings.ts`, `routes/listing-copy.ts`,
`workers/__tests__/product-catalog-sync.test.ts` (+14 ca thuần: phân loại xin kéo, pending); frontend `lib/poll.ts` (mới),
`lib/api.ts`, `components/channels/sync-channel-products-button.tsx` (dùng ở Giá vốn, Liên kết SP, hướng dẫn),
`components/products/sync-settings-dialog.tsx`, `components/operations/copy-listing/source-picker.tsx`.
Kiểm local 03/11: vitest workers 48/48, backend + frontend `tsc --noEmit` sạch. **CHƯA chạy thử trên trình duyệt**: lệnh áp
migration lên Postgres dev (localhost:5432) bị bộ lọc công cụ chặn; muốn thử ở máy anh, chạy trước một câu:

```sql
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "productSyncRequestedAt" TIMESTAMP(3);
```

(hoặc `npx prisma migrate deploy` trong `backend/`). Prod: Render tự áp khi deploy (`migrate deploy` lúc start).

### 5.4. Kiểm sau deploy

1. `/health` mang commit mới; log web boot không lỗi migration.
2. Bấm Đồng bộ từ sàn ở một gian thật: phản hồi 202 trong < 1 giây, nút đổi "Đang kéo trong vài phút…"; log worker
   `q=theo nút bấm` có dòng `[Catalog-sync] "…" theo nút bấm:` trong ≤ 5 phút; trang tự nạp lại; SQL chỉ đọc
   `SELECT "shopName","productSyncRequestedAt","lastProductSyncAt","productSyncError" FROM "Channel" WHERE status='ACTIVE'
   ORDER BY "productSyncRequestedAt" DESC NULLS LAST LIMIT 20;` → mốc xin về NULL sau khi kéo xong.
3. Log web KHÔNG còn `[TikTok] Hình dạng sản phẩm (products/search)` / `[product-sync]` từ tiến trình web (chỉ còn ở worker).
4. Render Events web: không OOM mới kèm dòng product-sync trước đó. (OOM còn lại nếu có = kéo ví / oEmbed → lát đo RSS,
   PROGRESS 03/11 10:30.)

### 5.4b. Sau deploy 3.7: GỐC THẬT là trang Giá vốn tải nguyên danh mục (03/11 15:14–15:50)

Instance mới vẫn chết 2 lần (15:14:05, 15:14:45 — 32 giây sau boot) KHÔNG dòng log nào → request không in log. Anh
chạy SQL chỉ đọc trên Supabase: chủ shop lớn nhất **57.877 dòng ChannelProduct / 2 gian**, `lastActiveAt` 14:22 VN (cột
chỉ ghi khi quay lại sau > 6 giờ → đúng lúc bắt đầu phiên chiều, trùng cụm chết 14:30–14:45); #3 14.273 dòng online
01/11 22:47 (trùng cụm OOM 01/11). `GET /api/finance/sku-products` tải nguyên danh mục `include product` không phân
trang → web 512 MB chết. Sync-trong-web (3.7) chỉ là kích hoạt phụ.

Đã làm cùng chiều (3 commit): `c8eb0901` select gọn + `lib/request-ledger.ts` (sổ in-flight, `heavyRouteGuard`
≤ 2 cùng lúc / RSS > 400 MB → 503 SERVER_BUSY) + memory-watch canh RSS so 512 MB in sổ in-flight + log
`[sku-products] N dòng … RSS`; `5573c87f` nút không xoay khóa + worker poll 1'; **lát chắn tạm (anh chốt 15:50,
"khách muốn hiện ra và điền", không Excel):** route ĐẾM TRƯỚC, quá `SKU_PRODUCTS_MAX_ROWS` (5.000 — tự chọn, mức
khách vài nghìn SKU 22/10 chạy êm) thì chỉ trả dòng đầu ưu tiên ĐANG BÁN + CHƯA CÓ GIÁ RIÊNG (`orderBy status asc,
costPrice nulls first, createdAt desc`, `take`), kèm `truncated/totalRows/limit`, `missingCostCount` đếm ở DB; ô tìm
gửi `?q=` tìm ILIKE trong toàn bộ danh mục (channelSku, productName, variantName, itemSku, externalId); trang hiện dải
"Gian của bạn có N mã… đang hiện 5.000 mã đầu… gõ ô tìm để tìm toàn bộ", vẫn điền tại dòng. Gian ≤ 5.000 dòng: không
đổi gì.

**Lát 3.8 (kế, anh chốt làm sau lát chắn): Giá vốn tải theo trang thật** — tìm/lọc gian/trạng thái/thiếu giá vốn/nhóm
phân loại bằng SQL, đếm ở DB, xuất Excel theo luồng máy chủ; xong thì bỏ trần. Số đo để chỉnh trần/nhịp: log
`[sku-products]` (dòng, ms, RSS) + `RSS cao` kèm route.

### 5.4c. Lỗi thiết kế lát 3.7 lộ ra khi deploy liên tiếp (03/11 ~16:00): gian đã nhận bị bỏ lại 60'

Anh bấm Đồng bộ từ sàn ~15:43 (6 gian); worker k6qfd kéo được 4 gian thì Render thay worker (deploy 15:45:18) →
2 gian đang "đã nhận" (`nextProductSyncAt = now + CLAIM_MS`) không instance nào kéo tiếp trong 60', mốc xin còn →
trang treo "Đang kéo danh mục của gian DarkMan Store, and.not.or…" cả tiếng (ảnh anh gửi). Sửa gốc (một commit):
- `stopProductCatalogSync()` gắn vào SIGTERM của vai worker (`index.ts`): dừng sau gian đang dở, trả gian đó về hàng
  chờ (`nextProductSyncAt = now`), tiến trình mới kéo lại sau FIRST_RUN_DELAY 60 giây.
- `recoverStrandedClaims()` lúc worker boot (phủ cả SIGKILL/OOM): gian có mốc xin mà lịch kế nằm trong cửa sổ nhận
  (now < next ≤ now + CLAIM_MS − 90 giây) → đặt lại now. 90 giây = Render SIGTERM→SIGKILL 30 giây có dư, tránh đụng
  instance cũ còn đang chạy lúc chồng lấn deploy. Gian lịch đêm / thử lại 30' không có mốc xin nên không bị đụng.
- Gian có mốc xin được nhận TRƯỚC (`orderBy productSyncRequestedAt asc nulls last, nextProductSyncAt asc`).
- `REQUEST_STALE_MS` 2 giờ → 60' (= CLAIM_MS): một mốc xin không sống lâu hơn một lượt nhận.
- Biến tiến trình mới `currentClaim` (ghi ALLOWED_LET kèm lý do; nguồn sự thật vẫn là cột lịch trên Channel).

### 5.5. Đường lui và việc chưa làm

- Đường lui: revert commit (cột thừa vô hại; migration `IF NOT EXISTS`).
- Chưa làm: đánh thức worker ngay khi khách bấm (tín hiệu pg-boss vài mili-giây như đẩy tồn) — chờ xem khách có kêu chờ
  ≤ 5 phút không; nút "Đồng bộ từ sàn" trên app mobile (không có, giữ nguyên); lát đo RSS ngoài heap của web vẫn chờ.

## 6. Lát 3.8 — Giá vốn cho gian lớn (03/11/2026, anh Trung: "Chắn tạm rồi phân trang", "khách muốn hiện ra và điền", "em chủ động sửa và test")

### 6.1. Gốc

Chủ shop lớn nhất 57.877 dòng ChannelProduct (TikTok 18.988 + Shopee 38.889). Ba đường tải nguyên danh mục vào RAM web:
`GET /sku-products`; `findCostSiblings` chạy **mỗi lần lưu một giá**; tab Mapping (`loadTargets`). Web Render 1 CPU 512 MB;
worker là 1 CPU 2 GB nên chịu được việc kéo danh mục.

### 6.2. Đã làm

- `7a26843e`: lưu giá, "Áp dụng N gian", "Áp dụng ô trống" chỉ đọc đúng các mã liên quan (`loadTargets(owner, gian, codes)`: OR
  insensitive dạng NFC/NFD, so khớp lại bằng `normalizeSkuCode` vì ILIKE coi `_` `%` là ký tự đại diện). Tab Mapping, "Điền tất cả",
  bảng giá tự nhập, Nhập Excel: đếm trước, vượt `SKU_PRODUCTS_MAX_ROWS` (5.000, số tự chọn) trả 413 `CATALOG_TOO_LARGE`, tab Mapping
  hiện hộp hướng dẫn. Theo bảng SQL 03/11 có ít nhất 9 chủ shop trên 5.000 dòng bị khóa các tính năng này tới khi làm tiếp.
- `describeInFlight` bỏ luồng SSE chuông, route nặng trước (bản đầu SSE chiếm hết 8 chỗ nên dòng RSS 15:45 không chỉ ra route).
- Lát 3.8: `lib/sku-catalog-page.ts` một câu SQL (`WITH f AS MATERIALIZED`) lọc, tìm, đếm, chia trang theo MẪU (gian + mã sản phẩm sàn),
  thứ tự ổn định theo mẫu mới nhất. `GET /sku-products?paged=1&q&shop&status&listing&page&pageSize`: gian vượt trần trả `serverPage`,
  gian ≤ 5.000 dòng trả đủ như cũ, giao diện cũ không gửi `paged` vẫn nhận 5.000 dòng đầu. Trang: bộ lọc gửi máy chủ, tìm chờ 400 ms,
  bỏ phản hồi cũ theo số lượt.
- Sửa lỗi của bản chắn `7b7be3c9`: thanh lọc bị tháo khi đang tải và khi rỗng, nên ô tìm mất con trỏ lúc gõ và biến mất khi tìm không ra.

### 6.3. Số đo (DB dev Postgres trên máy, 60.006 dòng, CHƯA phải prod Supabase)

| Thao tác | ms |
|---|---|
| Trang 1 / trang giữa | 170–175 |
| Lọc thiếu giá | 147 |
| Lọc một gian | 316 |
| Tìm theo chữ, 6 cột, gập dấu | 1.230–1.430 |

Tìm chậm vì quét và gập dấu mọi dòng; thử ghép chuỗi không nhanh hơn. Muốn nhanh hơn cần chỉ mục `pg_trgm`, có migration, chưa làm.

### 6.4. Đã kiểm / chưa kiểm

- Đã kiểm: `sku-catalog-page-db.test.ts`, `cost-mapping-scoped-db.test.ts` chạy thật trên DB dev; vitest `src/lib src/workers src/routes` 378 qua;
  tsc 2 bên; ESLint trang Giá vốn. Giao diện soi trên trình duyệt với máy chủ GIẢ 57.877 dòng ở 1280 px: gõ tìm giữ con trỏ, tìm không ra vẫn
  còn ô tìm, sang trang, lọc, đổi tab, điền giá lưu xong dòng không nhảy, hộp tab Mapping ở chế độ tối.
- CHƯA kiểm: nhánh `paged` của route chạy thật (backend dev không chạy được vì DB dev thiếu cột `productSyncRequestedAt`, lệnh áp migration bị chặn);
  dữ liệu thật của khách lớn; thời gian trên Supabase.

### 6.5. Hạn chế còn lại

- Chế độ chia trang: xuất Excel chỉ ra trang đang xem; hàng Kho nội bộ chỉ thấy ở tab Offline; dòng không có mã sàn đứng riêng thay vì gom theo tên.
- Mở từ link "đơn thiếu giá vốn trong kỳ" vẫn đi đường cũ (5.000 dòng đầu), kỳ có mã ngoài 5.000 dòng đó sẽ không khớp.
- Còn các truy vấn không có trần khác chưa rà hết: `inventory.ts:1063`, `services/listing-copy/source.ts`, `services/ops-alerts.ts`.
- Mỗi lần deploy backend, gian lớn đang kéo phải kéo lại từ đầu.
- Trang tràn ngang 26 px ở 1280 px do dải quảng bá app, có từ trước, chưa sửa.

### 6.6. Kéo danh mục Shopee không còn hỏng cả lượt vì một lệnh chậm (03/11 ~16:40)

Log worker 16:33:21: Hy Korea Official (Shopee) lỗi "SHOPEE không trả lời trong 30 giây (get_model_list)" sau khoảng 10 phút, chờ 30 phút rồi kéo lại từ đầu.
`marketplace/transient-retry.ts`: `withTransientRetry` thử lại 3 lần (chờ 2 giây, 4 giây) chỉ với lỗi chậm hoặc đứt mạng; vẫn hỏng thì `SkipBudget` bỏ qua đúng lô hoặc mẫu đó,
`complete = false` nên không đánh dấu gỡ nhầm; 10 lần hỏng liên tiếp thì dừng để lượt sau thử lại. Số 3 và 10 là mặc định tự chọn. Chỉ áp cho Shopee.
Lazada "Vodka Store" vẫn lỗi `ServiceTimeout` mỗi 30 phút cả ngày, chưa sửa. Chưa thấy lượt kéo thật nào của Hy Korea Shopee chạy xong với bản này.

### 6.7. Nhập Excel: bỏ chặn, chỉ đọc mã trong file (03/11 ~17:10)

`7a26843e` chặn Nhập Excel với gian trên 5.000 mã là sai: khách 57.877 mã nhập file 1.229 dòng lúc 17:00 bị báo lỗi (em đã giả định không ai dùng Excel mà không thử). Nay `lib/cost-import-load.ts` chỉ đọc các dòng trùng mã trong file
(so `lower(btrim(normalize()))` hai vế, không dùng LIKE), không còn trần. Log `[cost-import]` ghi số dòng, số ô, thời gian. Test `cost-import-load-db.test.ts` chạy thật trên DB dev. Chưa đo bước ghi trên prod: mỗi mức giá một lượt UPDATE + vá đơn trong MỘT giao dịch, trần 120 giây; file nhiều mức giá trên gian nhiều đơn có thể chạm trần, đọc log `[cost-import]` sau lượt thật đầu tiên.
Bằng chứng chia trang trên dữ liệu thật: log 16:58–17:02 của khách lớn `CẮT từ 57877`, 114 và 730 dòng/trang, 0,5–2,5 giây, RSS ~246 MB.

### 6.8. Rà lại toàn bộ theo khách lớn (03/11 ~18:00, anh yêu cầu, đọc bằng Chrome): thủ phạm web chết nhiều khả năng là cảnh báo cháy hàng, KHÔNG phải trang Giá vốn

Dòng thời gian (giờ VN, Supabase + log Render):
| Mốc | Sự kiện |
|---|---|
| 01/11 19:49 | Nối gian TikTok; 20:34 danh mục 18.988 dòng |
| 01/11 21:00–21:20 | Tạo 18.988 sản phẩm kho và nối hết |
| 01/11 21:28, 21:46, 21:47, 22:45 | Web chết |
| 03/11 09:51 | Nối gian Shopee; 10:13–10:16 ghi 38.889 dòng |
| 03/11 10:15–10:40 | Khách bấm Đồng bộ, web kéo cả 2 gian trong request, KHÔNG chết (RSS 359 MB lúc 10:35) |
| 03/11 12:30–13:45 | Tạo 24.924 sản phẩm kho, nối hết (tổng 43.912 sản phẩm, 57.877 dòng đã nối) |
| 03/11 14:07 → 15:23 | Web chết liên tục, trước đó log gần như trống, số lệnh gọi sàn thấp (SHOPEE n=12 lúc 13:59) |

Cả hai ngày: vừa nối kho xong là web chết, không phải lúc kéo danh mục. Chuỗi trong mã: `GET /api/command-center/state` (mở Tổng quan) → `scanOpsAlerts` → `detectStockouts` tải MỌI dòng đã nối kèm sản phẩm kho vào RAM web. `lastScanAt` nằm trong RAM nên web lên lại là quét lại: giải thích lần chết 32 giây sau khi lên, không log. `pg_stat_statements` có đúng truy vấn sản phẩm kho 32.766 + 11.146 = 43.912 dòng của detector này.

Đo trên DB dev cùng cỡ dữ liệu, cờ heap như prod (mọi SKU hết hàng nên là ca xấu nhất, prod có 9.377 sản phẩm hết hàng): scan trước sửa 1.865 ms, RSS 168 → 374 MB (+206 MB), còn lỗi quá 32.767 tham số; sau sửa 210 ms, +1 MB. Nền prod ~330 MB + 206 MB = vượt 512 MB.
Sửa: `detectStockouts`, `detectLowStock` gom và lọc trong SQL; test `ops-alerts-stock-db.test.ts`; câu SQL chạy thử trên dữ liệu thật khách (0 thẻ, đúng vì không có SKU đang bán nào hết hàng).

Mức chắc chắn: khớp giờ 2 ngày + đo tái hiện + khớp mã, nhưng log prod không ghi route lúc chết nên chưa có bằng chứng trực tiếp. Kiểm: khách mở Tổng quan mà web không chết, log `RSS cao` không xuất hiện.
Việc khác lộ ra, chưa sửa: `POST /sync-channels/:id/preview` gọi `refreshLinkedChannelStock` trong request web (gian 38.889 dòng rất nặng; khách chưa bật đồng bộ tồn gian nào nên chưa nổ); `ownersWithOrdersIn` ở worker dùng `distinct` tải trung bình 248.812 dòng đơn mỗi lần (69 lần từ 12/10, worker 2 GB).

### 6.9. Nhập Excel báo "Lỗi máy chủ nội bộ": câu vá đơn cũ chậm, vượt trần giao dịch 120 giây (03/11 ~19:20)

Log web có 4 lượt nhập bị hủy lúc 18:14, 18:21, 18:33, 18:38, cùng lỗi `Transaction already closed ... 120000 ms` trong `applyCostPriceIn`. Cả file bị hủy nên khách không lưu được giá nào ở 4 lượt đó.

Gốc: `backfillOrderLinesByProducts` dùng `SKU_MATCH` gói 4 điều kiện trong OR, cộng thêm `OWN_COST_EXISTS` cho từng dòng đơn. OR buộc Postgres dò: mỗi dòng đơn đi qua hết dòng sàn của gian. Route gọi câu này một lần cho mỗi mức giá.

`pg_stat_statements` prod, câu vá theo sản phẩm kho, mọi khách: 803 lần gọi, trung bình 4.274 ms, tối đa 54.242 ms. Gian của khách lúc đo:

| Gian | Dòng đơn | Dòng đơn chưa có giá | Dòng sàn | Dòng sàn có giá |
|---|---|---|---|---|
| Shopee | 9.741 | 2.756 | 38.889 | 16.836 |
| TikTok | 2.103 | 19 | 18.988 | 17.324 |

Sửa, ghi nhớ thứ tự đã thử:
1. Gộp một lượt cho cả file chưa đủ: đo trên dev còn chậm hơn gọi theo mức giá, vì gốc nằm ở câu lệnh chứ không ở số lần gọi.
2. `linesMatchingSku` viết 4 điều kiện thành 4 nhánh bằng nhau nối UNION ALL để Postgres băm được. Hai câu vá nhiều mã đổi sang nhánh này. Luật khớp giữ nguyên, id trước. `SKU_MATCH` vẫn giữ cho các câu khác.
3. `cost-import-apply.ts` tách làm hai: ghi giá trọn gói trong giao dịch ngắn, rồi vá đơn cũ ngoài giao dịch. Vá lỗi không làm mất giá vừa nhập; lượt kéo danh mục vá lại qua `repairZeroCostLinesForChannel`.

Đo trên DB dev, cùng cỡ gian Shopee ở bảng trên, file 1.228 dòng, 40 mức giá (`COST_IMPORT_LOAD=do.txt npx vitest run src/lib/__tests__/cost-import-apply-db.test.ts`):

| Cách | Trước | Sau |
|---|---|---|
| Gọi theo từng mức giá | 21.741 ms | 1.439 ms |
| Cả file một lượt | 28.414 ms | 631 ms |
| Một ô giá | 49 ms | 31 ms |

Đo trên prod bằng EXPLAIN ANALYZE chỉ đọc, phần dò dòng đơn của câu mới, ca rộng nhất là toàn bộ sản phẩm của khách thay vì 1.228 dòng: lần đầu 5,5 giây, phần dò giá riêng chạy lại 0,15 giây. Không có dòng đơn nào cần vá ở lúc đo: 2.775 dòng còn 0 đều thuộc mã chưa có giá.

Chưa kiểm được: chưa có lượt nhập thật sau bản `158376cd`, câu UPDATE chưa chạy trên prod, và không biết số mức giá trong file bị lỗi vì log không ghi lượt thất bại.

Còn lại, chưa sửa: `backfillOwnerCostPrices` (nút tính lại cả shop) và các câu khác vẫn dùng `SKU_MATCH`/`OWN_COST_EXISTS` kiểu cũ.

### 6.10. Tab Mapping giá vốn: bỏ chặn 5.000 mã, tính trong DB (03/11 ~19:45)

Anh báo khách 57.877 dòng mở tab chỉ thấy câu "vượt 5.000 mã". Câu đó do `c5bdeef7`/`7a26843e` thêm chiều nay, cùng kiểu lỗi với mục 6.7: chặn tính năng của khách thay vì sửa đường đọc.

Đã làm:
- `lib/cost-mapping-catalog.ts`: một câu SQL gộp theo mã, đếm 4 trạng thái, tìm bỏ dấu, lọc nhóm, chọn trang. Luật trạng thái khớp `groupSkusByCode`; test đối chiếu đường DB với đường RAM trên cùng dữ liệu.
- Danh mục vượt `catalogRowLimit()` đi đường DB, nhỏ hơn giữ đường cũ. Giao diện hỏi lại máy chủ khi gõ tìm (đợi 300 ms) và khi đổi nhóm; "Xem thêm" đọc thêm 200 mã, tối đa 5.000 mã một lượt xem, số 200 và 5.000 là mặc định tự chọn. Mẫu cuối của lượt đọc có thể mới về một nửa nên để lượt sau hiện đủ, "Giá vốn chung" không áp thiếu.
- "Điền tất cả" tính trong DB. Bảng giá theo mã mẫu đọc theo lô 2.000 dòng, không giữ cả danh mục; xem trước đếm đủ, danh sách hiển thị tối đa 5.000 dòng mỗi loại; file Excel mã chưa khớp cũng tối đa 5.000 và nói rõ trên màn hình.
- Ghi giá một câu cho cả loạt qua `saveCostPlan`, dùng chung với Nhập Excel (mục 6.9).
- Bỏ `CatalogTooLargeError`, mã 413 và hộp báo ở giao diện.
- Soi giao diện bằng dữ liệu giả 1.600 mã, 3 gian, tên và mã dài, khổ 1280 và 1700, sáng và tối: sửa dòng trạng thái mẫu và nút "Giữ giá riêng" tràn cột ở 1280.

Đo trên DB dev, 57.877 dòng, 2 gian (`COST_MAPPING_LOAD=do.txt npx vitest run src/lib/__tests__/cost-mapping-catalog-db.test.ts`):

| Việc | Thời gian | RSS tăng |
|---|---|---|
| Mở tab | 998 ms | 1 MB |
| Lọc nhóm | 675 ms | 0 MB |
| Tìm theo tên | 2.211 ms | 0 MB |
| Xem 2.000 mã | 814 ms | 14 MB |
| Độ phủ bảng giá, đọc theo lô | 1.327 ms | 47 MB |
| Xem trước bảng giá, đọc theo lô | 1.313 ms | 39 MB |
| Điền tất cả | 619 ms | 0 MB |

Hạn chế: chia trang theo tên sản phẩm chữ thường, nên mẫu có tên lệch xa nhau có thể tách ở cuối lượt đọc. Chữ hoa trong SQL theo collation của DB, mã có dấu khác collation chỉ ảnh hưởng thứ tự và số đếm chip, nhóm hiển thị vẫn gộp lại bằng `normalizeSkuCode`.

### 6.11. Lượt nhập thật đầu tiên sau sửa: thành công nhưng 54 giây, sửa tiếp (03/11 ~19:50)

Log 19:32:08: khách nhập file 4.313 dòng, khớp 4.313, ghi 4.403 ô, vá 132 dòng đơn, 0 lỗi, 54.169 ms. Không còn lỗi 120 giây nhưng vẫn quá lâu.

`pg_stat_statements`: câu vá theo gian mới có lần 46.819 ms. EXPLAIN ANALYZE chỉ đọc trên prod với 4.403 id của khách: bước lấy dòng đơn đi Merge Join trên 724.223 đơn của mọi khách, mất 48,8 giây, vì lọc gian bằng câu con làm Postgres đoán sai. Thử lọc bằng mảng gian có sẵn: dùng index theo gian, 0,15 giây, cùng 2.620 dòng.

Sửa: cả hai câu vá lấy danh sách gian trước rồi lọc `o."channelId" = ANY(mảng)`. DB dev quá nhỏ nên không tái hiện được kế hoạch sai này; bằng chứng là đo prod, kiểm lại bằng log lượt nhập sau.

Bài học: đo dev 0,63 giây ở mục 6.9 không phát hiện được lỗi này. Câu lọc trên bảng lớn phải EXPLAIN trên prod trước khi đẩy.

Đo prod chỉ đọc sau bản `a7953626`, dữ liệu của khách:

| Việc | Thời gian |
|---|---|
| Câu vá theo gian, 4.403 mã | 2,9 giây, lượt thật trước sửa 46,8 giây |
| Gộp và đếm trạng thái khi mở tab Mapping | 1,55 giây |
| Tìm theo tên ở tab Mapping | khoảng 7 giây |

Số mã của khách lúc đo: 43.869 mã, 33 đề xuất, 0 khác giá, 17.357 chưa có giá, 26.479 đã đủ.

Tìm chậm vì phải gập dấu từng dòng: đo riêng phần lọc 4,4–4,8 giây, bỏ `normalize` chỉ còn 3,7–3,8 giây, nên không đáng đổi. Sửa thật là cột tìm kiếm đã gập dấu kèm index, cần migration, trang Nhập giá vốn dùng cùng phép gập nên cũng được lợi. Chưa làm.

### 6.12. Web chết lại 21:46–21:55: trang Quảng cáo Shopee nạp 5.000 chiến dịch cũ (03/11 ~22:00)

Anh thấy HQ báo "Không kết nối được tới máy chủ". Render ghi 5 lần vượt 512 MB từ 21:51 đến 21:55, log cho thấy web đã khởi động lại từ 21:46, hồi lúc 22:03.

Số prod chỉ đọc, gian Shopee lớn nhất (`cmw03dkk`):

| Mục | Số |
|---|---|
| Mã trên sàn | 38.889 |
| Chiến dịch, tạo 21:21–21:23 tối nay | 5.000, đúng bằng trần `MAX_CAMPAIGNS` |
| Trạng thái | 4.359 ended, 641 closed, 0 đang chạy |
| Dòng số 30 ngày | 131.162, tất cả bằng 0 |
| Kết thúc muộn nhất | 14/01/2026 |
| Chi quảng cáo toàn shop (`AdSpend`) | 51,8 triệu/30 ngày, 8,2 triệu/7 ngày |

`computeChannelAdsInsights` nạp mọi chiến dịch của gian kèm dòng số 30 ngày và toàn bộ mã trên sàn vào RAM. Cả trang Quảng cáo lẫn lượt quét cảnh báo đều gọi hàm này.

Đo DB dev, dựng gian cùng cỡ, một lượt gọi:

| | RSS | Heap | Thời gian |
|---|---|---|---|
| Trước sửa | +532 MB | +225 MB | 3,4 giây |
| Sau sửa | +72 MB | +50 MB | 0,4 giây |

Bằng chứng trên prod: dòng duy nhất bắt được là 21:48:24 `RSS cao 73% — đang chạy: GET /api/quang-cao/shopee 1s`, rồi không còn log nào tới lần khởi động kế. Log không ghi gian nên chưa chứng minh trực tiếp request đó là của gian này; giờ dữ liệu về và cỡ tăng RAM đo được đều khớp.

Heap "chỉ 70–80 MB" ở các mục trước có thể là do lấy mẫu mỗi 5 giây, không kịp thấy đỉnh: lần đo này heap tăng 225 MB trong 3,4 giây. Nên không còn kết luận được "phình ngoài heap" từ các dòng mốc nền.

Sửa: `campaignsWorthLoading` bỏ chiến dịch ended/closed/deleted không có số khác 0 trong khoảng đang xem. Chiến dịch được giữ vẫn nạp đủ dòng như cũ nên số của chúng không đổi. Route trả thêm `hiddenEndedCount`, trang ghi rõ số chiến dịch không hiện để khách không tưởng mất dữ liệu.

Chưa làm:

1. Trần 5.000 đang cắt mất chiến dịch đang chạy của gian này: shop vẫn chi tiền mà cả 5.000 dòng đều đã kết thúc từ tháng 1 trở về trước. Nghi sàn trả chiến dịch cũ trước, chưa kiểm. Khách sẽ thấy trang không có chiến dịch nào.
2. Worker vẫn gọi sàn và ghi lại dòng số 0 cho chiến dịch đã kết thúc: ~100 lệnh mỗi lượt với gian này. Có thể là một phần của băng thông worker, chưa đo.
3. Còn +72 MB mỗi lượt, nghi do nạp 38.889 mã, chưa đo tách. Lọc mã theo chiến dịch sẽ làm Trợ lý và tab Hòa vốn hết dùng chung một bộ đệm.
4. Rà các gian khác: gian TikTok của cùng khách có 256 chiến dịch, đi đường đọc khác, chưa đo.


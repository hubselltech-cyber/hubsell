# Tự chuẩn bị hàng theo gian (04/11/2026)

**Nguồn yêu cầu:** khách xin nút Bật/Tắt để Hubsell tự bấm "Chuẩn bị hàng" thay họ. Anh Trung chốt 04/11 tối: công tắc **theo gian**, popup cảnh báo khi bật, **chỉ chuẩn bị hàng** (đơn sang Đã xử lý · Chưa in phiếu), không in. Đơn hủy khách bắt ở bước quét Chờ đóng gói ([DONG-GOI-BAN-GIAO.md](DONG-GOI-BAN-GIAO.md)).

Câu trên popup: *"Hệ thống sẽ tự chuẩn bị hàng 30 phút 1 lần. Khách hàng cần cân nhắc xử lý đơn hỏa tốc và sản phẩm hết hàng."*

## 1. Vì sao không viết một vòng lặp riêng

Tổng số lệnh gọi sàn không tăng so với bấm tay (cùng số đơn), nhưng hai chỗ dễ sinh lỗi ở quy mô:

- **Dồn giờ ngày sale:** mọi gian bật tự động tới hạn cùng lúc → hàng trăm gian gọi sàn trong một phút, đúng lúc sàn đang quá tải. Cần làn theo gian + lệch nhịp ngẫu nhiên + thuê bao có nhịp tim.
- **Chồng lượt máy/người:** máy và người cùng chuẩn bị một đơn → Shopee trả "not eligible for rescheduling" (sự cố 15/10). Cần khóa đơn đang trong mẻ RUNNING, chung cho cả hai đường.

Nên tính năng này **đứng trên khối đã có**, không dựng mới:

| Khối | Dùng vào việc gì |
|---|---|
| `services/sync-lanes.ts` (làn, `FOR UPDATE SKIP LOCKED`, thuê bao + nhịp tim) | Hàng việc "gian nào tới hạn chuẩn bị"; làn mới `fulfill`, số luồng riêng |
| `services/fulfillment/batch-runner.ts` (mẻ 50 Shopee/TikTok, Lazada từng đơn, nhịp tim, `fulfillment_batches`) | Gọi sàn và ghi PROCESSED đúng một luật với nút bấm tay |
| `findLiveRunningBatches` + `splitByRunningBatches` | Khóa chồng hai chiều: máy bỏ qua đơn người đang bấm, người bỏ qua đơn máy đang chạy |
| `services/notifications.ts` | Chuông một lần/ngày/gian khi có đơn máy không làm được |

Chạy ở **worker** (`HUBSELL_ROLE=worker`), không ở web.

## 2. Dữ liệu (migration `20261104230000_auto_arrange`)

| Cột / dòng | Nghĩa |
|---|---|
| `Channel.autoArrangeEnabledAt` | null = tắt. Nguồn cho giao diện. |
| `sync_cursors` dòng `stream = "auto-arrange"`, `lane = "fulfill"` | Hàng việc cho worker (cùng khuôn lát 2 đọc đơn). Bật = upsert, tắt = xóa, trong một giao dịch với cột trên. `stream = "auto-arrange-shadow"` = chạy bóng (chỉ log, không gọi sàn) — ghi danh bằng SQL, không có giao diện. |
| `Order.autoArrangeTriedAt` / `autoArrangeAttempts` | Lần máy thử gần nhất + số lần sàn báo "chưa sẵn sàng". Đơn mới thử lại sau ≥ 30′ kể từ lần trước, tối đa 6 lần. |
| `Order.autoArrangeBlockedAt` / `autoArrangeBlockedReason` | Lỗi cứng từng đơn: máy không thử nữa, tab Chờ xử lý hiện nhãn + lý do để người làm tay. |
| `FulfillmentBatch.source` MANUAL / AUTO | Tra soát: lượt nào do máy. |
| Chỉ mục một phần `Order_auto_arrange_pending_idx (channelId, createdAt) WHERE shippingStatus = 'PENDING'` | Tập Chờ xử lý của một gian nhỏ; máy quét tập này mỗi lượt. |

Bật lại công tắc = xóa cờ thử/chặn của mọi đơn Chờ xử lý trong gian (làm mới từ đầu).

## 3. Một lượt của một gian (`workers/auto-arrange-lane.ts`)

1. Gian không ACTIVE / ngủ đông / đã tắt công tắc → không gọi sàn; đã tắt mà còn dòng → tự xóa dòng.
2. Lấy đơn Chờ xử lý của gian (chỉ mục trên), rồi hàm thuần `selectAutoArrangeCandidates` (`lib/auto-arrange.ts`) quyết từng đơn:

| Đơn | Máy làm gì | Vì sao |
|---|---|---|
| Chưa thanh toán | Bỏ qua, không gọi sàn, không đếm | Sàn không cho; webhook báo đã trả là lượt sau tự vào |
| Khách đang xin hủy | Bỏ qua | Người phải trả lời sàn trước |
| **Hỏa tốc** | **Bỏ qua, để người làm** | Hãng tới lấy trong vài giờ, phải chọn khung giờ và có hàng sẵn — đúng câu cảnh báo trên popup. Đổi thành "làm trước" chỉ cần sửa một dòng |
| Đã bị chặn (lỗi cứng) | Bỏ qua tới khi bật lại công tắc | Không thử lại vô hạn |
| Đã thử ≥ 6 lần hoặc thử < 30′ trước | Bỏ qua | Giãn nhịp, có trần |
| Đang nằm trong mẻ RUNNING (người đang bấm) | Bỏ qua | Khóa chồng |
| Còn lại, cũ nhất trước, tối đa N đơn/lượt | Đem đi chuẩn bị | N = 150 (3 mẻ Shopee/TikTok), 40 với sàn đi từng đơn (Lazada) |

3. Luồng bóng: log `[auto-arrange] … bóng: sẽ chuẩn bị N đơn` rồi hẹn 30′. Luồng thật: `runFulfillmentBatchNow` (mẻ chạy ngay trong worker, chờ xong, `source = AUTO`, lựa chọn pickup/dropoff = mặc định gian đã lưu khi bấm tay; chưa có → PICKUP như nút bấm tay).
4. Phân loại từng đơn sàn từ chối (`classifyArrangeFailure`):

| Nhóm | Dấu hiệu | Máy làm gì |
|---|---|---|
| **E. Cả gian** | mất kết nối, thiếu quyền, 429, quá hạn, sàn 5xx, chưa cấu hình | Không đánh dấu đơn; mất kết nối → hẹn 60′, còn lại 5′ |
| **B. Chưa sẵn sàng** | "not ready", "chưa sẵn sàng", "pending", "try again" | `autoArrangeAttempts + 1`, `triedAt = now`; chạm 6 lần → đánh chặn với lý do "sàn chưa cho chuẩn bị sau 6 lần" + chuông |
| **D. Lỗi cứng** | mọi lỗi khác (địa chỉ, sàn từ chối, "not eligible") | `autoArrangeBlockedAt/Reason`; chuông |
| **C. Sàn nhận nhưng cấp mã trễ** | không phải lỗi | Đơn đã PROCESSED, "Chưa in phiếu"; luồng in tự hỏi mã. Máy không gọi lại |

Chuông: type `auto-arrange`, mục mới "Tự chuẩn bị hàng" nhóm Đơn hàng (tắt được); tiêu đề cố định theo gian nên một chuông chưa đọc/ngày/gian; link `/orders?tab=pending`.

5. Hẹn lượt kế: còn đơn chưa tới lượt (quá N) → `0` (tới hạn ngay, xếp sau gian chờ lâu hơn); hết → 30′ ± 3′ ngẫu nhiên (lệch nhịp giữa các gian). Lỗi ném ra → 5′.

Không giữ trạng thái ở biến tiến trình: cờ, số lần, thuê bao đều trong DB (worker khởi động lại không mất gì).

## 4. Dung lượng (số tự chọn, đổi bằng env)

| Env | Mặc định | Nghĩa |
|---|---|---|
| `AUTO_ARRANGE_LANE` | 1 | `0` = không chạy làn |
| `LANE_FULFILL_CONCURRENCY` | 2 | số gian chuẩn bị song song mỗi tiến trình worker |
| `AUTO_ARRANGE_INTERVAL_MS` | 1.800.000 | nhịp khi gian đã hết đơn |
| `AUTO_ARRANGE_MAX_PER_RUN` | 150 | trần đơn một lượt (sàn có API mẻ) |
| `AUTO_ARRANGE_MAX_PER_RUN_SEQ` | 40 | trần một lượt với sàn đi từng đơn |
| `AUTO_ARRANGE_MAX_ATTEMPTS` | 6 | số lần "chưa sẵn sàng" trước khi chặn |

Ước lượng gian 4.000 đơn/ngày: ~85 đơn mỗi 30′ → một lượt 2 mẻ Shopee (~10 s). Worker prod 1 nhân 2 GB: mẻ giữ RAM theo số đơn một lượt (≤150 dòng), không theo gian.

## 5. API + giao diện

- `POST /api/channels/:id/auto-arrange {enabled}` (chủ shop): từ chối gian OFFLINE, gian chưa nối API hoặc đã ngắt. Giao dịch: cột + dòng làn + xóa cờ đơn.
- Trang Kênh bán: công tắc "Tự chuẩn bị hàng" trên dòng gian đang hoạt động. Gạt bật → hộp xác nhận với câu anh chốt + ba ý ngắn (30′ một lần · bỏ qua hỏa tốc, chưa thanh toán, khách xin hủy · đơn máy không làm được sẽ có chuông). Gạt tắt → tắt ngay.
- Trang Đơn hàng, tab Chờ xử lý: đơn bị chặn hiện nhãn "Máy không tự chuẩn bị được", trỏ chuột thấy lý do.

## 6. Kế hoạch đưa lên

1. Push backend + web (công tắc mặc định tắt, không gian nào có dòng làn → worker chỉ hỏi DB 5 s/lần).
2. Ghi danh **bóng** một gian thật bằng SQL (mục 7), đọc log `[auto-arrange]` 1–2 ngày: số đơn máy "sẽ" chuẩn bị có khớp số người bấm tay không, có đơn nào bị chọn sai không.
3. Anh bật thật trên gian đó qua giao diện; theo dõi `fulfillment_batches` `source = 'AUTO'` + chuông.
4. Mở cho khách.

## 7. SQL vận hành (Supabase, chỉ dùng khi cần)

```sql
-- Ghi danh chạy BÓNG một gian (không gọi sàn)
INSERT INTO "sync_cursors" ("channelId","stream","cursorAt","windowMs","lane","dueAt","updatedAt")
VALUES ('<channelId>','auto-arrange-shadow', now() AT TIME ZONE 'UTC', 0, 'fulfill', now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC')
ON CONFLICT ("channelId","stream") DO NOTHING;
-- Rút bóng
DELETE FROM "sync_cursors" WHERE "channelId"='<channelId>' AND "stream"='auto-arrange-shadow';
-- Tắt khẩn MỌI gian (giữ cột để giao diện vẫn hiện bật; bật lại = gạt công tắc)
DELETE FROM "sync_cursors" WHERE "stream"='auto-arrange';
-- Lượt máy đã chạy
SELECT "createdAt","total","done",jsonb_array_length("confirmedIds") AS ok, jsonb_array_length("failed") AS failed, "error"
FROM "fulfillment_batches" WHERE "source"='AUTO' ORDER BY "createdAt" DESC LIMIT 20;
```

## 8. Hạn chế / để sau

- Hỏa tốc bỏ qua (mục 3) — nếu khách muốn máy làm cả hỏa tốc, cần cho chọn khung giờ lấy hàng theo gian trước.
- Không kiểm tồn kho trước khi chuẩn bị (chỉ biết tồn khi khách nối SKU; popup đã cảnh báo). Có thể thêm "bỏ qua đơn có SKU tồn khả dụng ≤ 0" khi có ca thật.
- Mẻ chưa đi qua cổng gọi sàn (Pha B) — như nút bấm tay. Khi luồng chuẩn bị hàng nối cổng thì máy hưởng theo.
- Mất thuê bao giữa lượt: mẻ đang chạy vẫn chạy tới xong (batch-runner không nhận tín hiệu hủy); lượt kế của gian bị gian khác nhặt sẽ bỏ qua đơn đang trong mẻ RUNNING nên không gọi trùng.
- Mobile: chưa có công tắc; chỉ web.

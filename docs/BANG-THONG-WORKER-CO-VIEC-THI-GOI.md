# Băng thông worker: từ "hỏi liên tục" sang "có việc thì gọi"

Kế hoạch lập 12/10/2026 theo yêu cầu anh Trung; **bước 0 (đo) đã chạy cùng ngày và
đổi hướng kế hoạch** (mục 3). Mục tiêu: worker trên Render gần như không tốn
băng thông khi không có việc, mà đơn hàng, tồn kho và quảng cáo vẫn xử lý ngay
như hiện nay (hoặc nhanh hơn). Không đụng nhịp nào liên quan đến tiền quảng cáo
của khách.

## 1. Hiện trạng (đã kiểm 12/10)

- Render tính tiền byte worker gửi ra ngoài; database Supabase và API sàn đều là
  "ra ngoài". Gói Hobby kèm 5 GB/tháng, vượt 15 USD / 100 GB.
- Biểu đồ Outbound Bandwidth của `hubsell-worker-sg` 7 ngày: ~115–130 MB/giờ
  trước 08/10 → ~70–95 MB/giờ (trung bình ~80) từ khi `f3f05ab` (LISTEN/NOTIFY
  cho hàng đợi pg-boss) lên lúc 09:07 ngày 08/10. Giữ đều ngày đêm.
- Tháng 10 đến 12/10: 26,8 GB / 5 GB, 25,9 GB là worker. Dự kiến cả tháng
  17,30 USD (5 USD dịch vụ + băng thông). Tháng 9: 9,25 USD, tháng 8: 7 USD.
- 80 MB/giờ ≈ 58 GB/tháng ≈ 8 USD/tháng, trong khi prod gần như chưa có khách
  trả tiền: đây là chi phí nền của các vòng quét, không phải chi phí xử lý đơn thật.

## 2. Bước 0 — số đo thật (12/10/2026, chỉ đọc)

Nguồn: `pg_stat_statements` trên Supabase prod (bộ đếm từ **30/09 06:04 UTC**,
tức 11,85 ngày, trộn cả trước và sau 08/10), chạy qua SQL Editor trong Chrome
của anh; bảng gốc lưu ở `docs/bang-thong-worker-do-2026-10-12/` (`pgss-top-calls.md`,
`pgss-groups.md`, `pgss-top-rows.md`, `prod-counts.md`). Prod đang bật `LEDGER_WORKER_ON=1` (anh
xác nhận).

### 2.1. Quy mô prod lúc đo

| Sàn | Gian ACTIVE | Tổng đơn | Đơn mới 2 ngày | Chờ escrow 7 ngày | Chưa quyết toán 45 ngày | Đang giao |
|---|---|---|---|---|---|---|
| Shopee | 27 | 31.281 | 739 | 1.396 | 3.413 | 1.066 |
| TikTok | 15 | 26.031 | 1.002 | 2.077 | 2.455 | 728 |
| Lazada | 1 | 1.552 | 41 | 85 | 113 | 44 |

43 gian hoạt động, ~1.800 đơn mới mỗi 2 ngày.

### 2.2. Tổng: 52,8 triệu câu lệnh / 11,85 ngày ≈ 4,46 triệu câu/ngày ≈ 52 câu/giây

| Nhóm | Câu lệnh | % | Ghi chú |
|---|---|---|---|
| BEGIN/COMMIT | 12,6 tr | 24% | mỗi đơn đồng bộ = 1 giao dịch riêng |
| pg-boss hỏi việc | 8,5 tr | 16% | phần lớn TRƯỚC 08/10 (nhịp 0,5 giây); nay lưới đỡ 30 giây ≈ 17 nghìn/ngày |
| UPDATE Order (đồng bộ lô + phí) | 7,7 tr | 15% | **gần như toàn bộ là ghi lại giá trị cũ** |
| SELECT Order theo mã đơn | 7,7 tr | 15% | tra "đơn đã có chưa" từng đơn một |
| COUNT OrderItem thiếu ảnh | 6,1 tr | 12% | `backfillOrderItemImagesTx` chạy cho MỌI đơn mỗi lượt |
| Sổ cái | 1,6 tr | 3% | 703 nghìn lượt nhặt dòng bẩn (nhịp 2 giây), 175 nghìn lô ghi |
| Ước tính TikTok unsettled | 1,5 tr | 3% | 740 nghìn upsert bản kê ≈ 2.455 đơn × 24 lần/ngày, câu dài 2 KB |
| Ads | 1,2 tr | 2% | đọc 22 tr dòng `AdsCampaignDailyPerf` (vào, không tính tiền Render) |
| ChannelProduct | 1,2 tr | 2% | 1 câu đọc 1.382 dòng/lượt × 10 nghìn lượt (ads-insights/margin) |
| Vé cứu đơn giao thất bại | 1,1 tr | 2% | **600 nghìn DELETE vé đơn lẻ ≈ 50 nghìn/ngày** cho ~1.800 đơn đang giao |
| **Lưới quét đẩy tồn** | 324 nghìn | **0,6%** | 5 giây, 110 MB chữ/12 ngày |
| **Lưới quét hóa đơn** | 243 nghìn | **0,5%** | 5 + 30 giây, 94 MB chữ/12 ngày |
| Khác | 3,3 tr | 6% | |

### 2.3. Kết luận bước 0

1. **Kế hoạch ban đầu (NOTIFY cho lưới quét tồn/hóa đơn) chỉ tiết kiệm ~1%.**
   Hai lưới quét 5 giây ấy là câu nhỏ; làm cũng được nhưng không phải việc đầu.
2. **Thủ phạm là tầng NHANH của `order-auto-sync` (10 phút/gian) xử lý lại
   toàn bộ đơn trong cửa sổ 2 ngày của mọi gian, mỗi đơn 5 lượt đi-về database
   (BEGIN, SELECT, UPDATE, COUNT, COMMIT) dù đơn không đổi gì.** Ước: ~2.500
   đơn trong cửa sổ × 144 lượt/ngày × 5 câu ≈ 1,8 triệu câu/ngày; đo được 2,9
   triệu/ngày cho 4 nhóm đầu (có thêm phí escrow, hoàn, vé) — khớp bậc.
3. Nguyên nhân giãn nhịp không chạy: `changed = r.created > 0 || r.updated > 0`
   nhưng `updated` đếm MỌI đơn đọc lại (service 3 sàn `result.updated++` ở nhánh
   "đã tồn tại", không so giá trị) → gian nào có đơn trong 2 ngày thì không bao
   giờ giãn lên 60 phút. Lỗi này đã ghi từ 27/09 (sự cố egress Supabase), chưa sửa.
4. Ba vòng con cũng ghi/gọi lặp vô ích:
   - Ước tính escrow Shopee: mỗi 10 phút, mỗi đơn chưa quyết toán trong cửa sổ
     → 1 call `get_escrow_detail` + 1 UPDATE Order dù số không đổi (~170 nghìn
     UPDATE phí/ngày).
   - Ước tính TikTok unsettled: mỗi giờ upsert lại bản kê ước tính của mọi đơn
     chưa quyết toán 45 ngày (câu 2 KB), dù số không đổi.
   - Vé cứu đơn giao thất bại Shopee: vé DETECT gặp tracking "đã giao" thì
     **xóa vé**, nhưng đơn trong DB vẫn `SHIPPING` (sàn chưa đổi trạng thái đơn)
     nên bước phát vé **tạo lại vé ngay lượt sau** → gọi tracking + xóa lặp vô
     hạn tới khi đồng bộ đơn đổi trạng thái. 50 nghìn call tracking/ngày đổ sông.
5. Sổ cái không phải thủ phạm: trigger trên `Order` có `WHEN (... IS DISTINCT
   FROM ...)` nên UPDATE ghi lại giá trị cũ không đánh bẩn sổ. Vòng nhặt 2 giây
   (43 nghìn câu/ngày) nhỏ; để sau.
6. Lưu ý về byte: prod dùng Session pooler 5432, Prisma giữ 100 câu đã chuẩn bị
   mỗi kết nối, nên phần lớn lượt gọi chỉ gửi tham số (~100–300 B), không gửi
   lại câu. 4,46 triệu câu/ngày × ~150 B ≈ 0,7 GB/ngày; phần còn lại tới ~2
   GB/ngày là TLS từng gói + **gọi API sàn** (escrow_detail và tracking mỗi đơn
   mỗi 10 phút, order_detail cả cửa sổ). Nghĩa là sửa đúng chỗ ở mục 2.3.2–4 giảm
   cả byte database lẫn byte gọi sàn (và quota sàn).

## 3. Kế hoạch sau khi đo (đề xuất cho cổng quyết định 1)

Nguyên tắc chung cho mọi lát: **so trước khi ghi, gom theo lô, đếm "đổi" bằng đổi
thật**. Không đổi nhịp quét nào của ads; không đổi webhook; đơn mới/đổi trạng
thái vẫn ghi ngay như cũ.

### Lát A — Đồng bộ đơn: đọc theo lô, chỉ ghi khi khác (3 sàn)

- Trong `syncShopeeOrders` / `syncTiktokOrders` / `syncLazadaOrders`: với mỗi lô
  chi tiết (≤50 đơn) **một** `findMany({ orderCode IN (...) })` lấy đúng các cột
  sẽ ghi; so trong RAM; đơn không khác → không mở giao dịch, không UPDATE, không
  đếm `updated`; đơn khác → giao dịch như cũ. `updated` chỉ đếm khi ghi thật →
  giãn nhịp 10' → 60' chạy đúng thiết kế 12/09.
- `backfillOrderItemImagesTx` chỉ gọi khi đơn **có ghi** hoặc đơn tạo trước
  08/09/2026 (ngày bắt đầu lưu ảnh lúc tạo đơn); đơn mới đã có ảnh.
- Kỳ vọng: 5 câu/đơn/lượt → ~1 câu/50 đơn/lượt khi gian im ắng; 4 nhóm đầu bảng
  2.2 giảm > 95%. Kèm theo lượt quét gian im ắng thưa dần → call `order_detail`
  tới sàn giảm theo.
- Test: lô đơn không đổi → 0 UPDATE, `updated = 0`; một đơn đổi trạng thái → đúng
  1 UPDATE; đơn mới → create như cũ; đơn hoàn → cờ hoàn tiến đúng (giữ các luật
  "chỉ tiến NONE → AWAITING", "deliveredAt ghi một lần", "không ghi đè carrier
  tay").

### Lát B — Ước tính phí: hỏi sàn khi đơn đổi trạng thái, không ghi lại số cũ

**Anh Trung đề xuất 12/10:** đơn đã có số ước tính thì chỉ hỏi lại khi đơn đổi
trạng thái (ví dụ đang giao → giao thành công). Em phân tích kỹ vì cột này đi
thẳng vào tài chính khách xem.

**Số ước tính được dùng ở đâu (đọc mã 12/10):**

| Nơi dùng | Cột | Hậu quả nếu số cũ (stale) |
|---|---|---|
| Lãi/Lỗ đơn chưa quyết toán (`routes/finance.ts`) | `fixedFee`, `paymentFee`, `serviceFee`, `sellerVoucher`, `platformSubsidy`, `shippingFee*` từ `mapShopeeEscrowFields` | Lãi ước tính của đơn chờ đối soát lệch tạm thời; số thật ghi đè khi quyết toán (tầng giờ) |
| Dòng tiền "chờ về" (`finance.ts` ~1737–1825, `ops-alerts.ts` ~654) | `expectedPayout` (thiếu thì `totalAmount`) | Tổng tiền chờ về lệch tạm thời |
| Kiểm toán phí sàn rổ #2 "sàn trả thiếu" (`settlements.ts` `computePayoutShortfall`) | `expectedIncome` = bản chụp **mới nhất trước quyết toán** | Nếu bản chụp cuối cũ hơn lời hứa thật của sàn → có thể báo oan "trả thiếu" hoặc bỏ sót |

**Số thật prod (SQL chỉ đọc 12/10, Shopee, đơn quyết toán 30 ngày qua):**
7.035 đơn quyết toán; 4.567 có số ước tính; **4.472 (98%) số ước tính cuối = số
quyết toán thật đúng từng đồng**; 86 (1,9%) lệch ≥ 1.000 đ; 0 đơn bị gắn "sàn
trả thiếu". Đang có 5.828 đơn Shopee giao xong chưa quyết toán, 5.693 (98%)
giao xong đã quá 3 ngày — đúng nhận xét của anh: đơn nằm im nhiều ngày, hỏi
mỗi 10 phút là vô ích. 181 đơn trong 7 ngày chưa có số (nhóm "chưa có số").

**Kết luận:** bản nháp phí của Shopee, một khi đã có, ổn định tới lúc quyết
toán trong 98% trường hợp; 2% còn lại là hoàn/hủy một phần hoặc khoản chốt
muộn, mà hoàn/hủy thì đổi `returnStatus`/`shippingStatus` (luồng quét đơn hoàn
+ đồng bộ đơn cập nhật) nên vẫn bắt được. Phương án của anh **đúng và đủ**, với
hai lưới đỡ rẻ:

1. "Đổi trạng thái" = đổi `shippingStatus` **hoặc** `returnStatus` (bỏ qua
   CANCELLED vì không có escrow). Tín hiệu lấy ngay trong lát A: đơn nào lát A
   ghi thật thì đưa vào danh sách hỏi escrow của cùng lượt → không thêm câu đọc.
2. Lưới đỡ **1 lần/ngày** (tầng giờ, lượt đầu sau 03:00 VN) cho đơn DELIVERED
   chưa quyết toán trong `SETTLE_DAYS_BACK`, so trước khi ghi. Mục đích: bắt
   2% khoản chốt muộn không kèm đổi trạng thái (ví dụ hoa hồng affiliate) để
   bản chụp `expectedIncome` trước quyết toán là lời hứa gần nhất của sàn —
   kiểm toán rổ #2 không báo oan. Sau 4 tuần đọc log: lưới này không bao giờ
   thấy khác thì bỏ.
3. Đơn **chưa có số** (`expectedPayout IS NULL`, chưa hủy): giữ hỏi mỗi 10 phút
   như cũ (phản ánh chủ shop 06/08 "phí đơn mới hiện chậm").
4. Mọi lần hỏi: so `mapShopeeEscrowFields(income)` + `expectedPayout` với giá
   trị đang có, khác mới UPDATE (`expectedIncome` chỉ ghi khi khác).

Ước lượt gọi `get_escrow_detail`: ~170.000/ngày → đơn mới (~400/ngày × vài lần
tới khi có số) + đơn đổi trạng thái (~800/ngày) + lưới đỡ (~1.400/ngày) ≈
**3.000–4.000/ngày**, giảm ~98%; quota Shopee của khách cũng nhẹ theo.

- TikTok unsettled: API trả theo lô cả gian (không theo từng đơn) nên gọi sàn
  đã rẻ; chỉ sửa phần ghi: so bản kê ước tính trước khi upsert, giữ nhịp giờ.

### Lát C — Vé cứu đơn: hết vòng lặp tạo-xóa

- Vé DETECT gặp tracking "đã giao" → **không xóa**, đặt `nextRunAt` xa (ví dụ
  +24 giờ) và để bước dọn (2) xóa khi đơn rời `SHIPPING`. Áp cho cả Shopee và
  TikTok (`integrations/*/delivery-fail.ts`). Không đổi schema.
- Kỳ vọng: 50 nghìn call tracking + 50 nghìn DELETE/ngày → gần 0 khi không có
  đơn hỏng.

### Lát D (sau, nhỏ) — Lưới quét nội bộ sang NOTIFY

Thiết kế ở mục 5 vẫn đúng và sẽ cần khi lên quy mô, nhưng theo số đo hôm nay chỉ
đáng ~1% nên xếp sau A–C; làm khi rảnh tay hoặc gộp vào lát 13 của HANG-DOI-BEN.

### Thứ tự và cổng

1. **Cổng 1 (anh chốt):** làm A + B + C theo thứ tự A → C → B (A lớn nhất, C
   gọn nhất, B cần anh chốt nhịp gọi escrow).
2. Sau mỗi lát: `npx tsc --noEmit` (kể cả test, [[gotcha-render-build-tests]]),
   vitest integrations + workers, em trình diff, anh push.
3. Kiểm prod sau 24 giờ: biểu đồ Outbound worker; `pg_stat_statements` đếm lại
   (em đề nghị anh cho **reset bộ đếm** ngay trước khi deploy lát A để số sau sạch
   — lệnh `select pg_stat_statements_reset();` chỉ xóa thống kê, không đụng dữ
   liệu); log `[Auto-sync]` phải thấy gian im ắng giãn lên 20', 40', 60'.
4. Mục tiêu: worker về **≤ 20 MB/giờ** sau A–C (em ước từ tỉ lệ ở bảng 2.2; sẽ
   thay bằng số đo), tức ≈ 14 GB/tháng ≈ 1,4 USD băng thông. Về dưới 5 GB/tháng
   cần thêm lát D và xem lại phần gọi sàn còn lại; chưa hứa.

## 4. Phần không đổi (ghi để khỏi hỏi lại)

- Nhịp xung ads 30'/60' cho gian đang tiêu tiền, Trợ lý tự thực thi, hạ ROAS,
  kéo chi phí ads: **giữ nguyên**. Nhóm ads ở bảng 2.2 là 2% số câu, chủ yếu đọc
  (không tính tiền Render); nếu anh muốn em xem riêng thì trình số sau.
- Webhook sàn, đường nhận đơn real-time: không đụng.
- Đơn đổi trạng thái thật vẫn được ghi ngay trong cùng lượt quét như hôm nay;
  lát A chỉ bỏ các lần ghi lại giá trị cũ.

## 5. Thiết kế "có việc thì gọi" cho lưới quét nội bộ (lát D, giữ lại)

Postgres có LISTEN/NOTIFY: worker giữ **một kết nối mở sẵn** và ngồi im (nhịp tim
10 giây, vài chục byte). Khi một dòng được ghi, database **tự đẩy** một tin nhắn
nhỏ xuống kết nối đó; worker nhận được thì chạy đúng câu quét nó vẫn chạy hôm
nay. Đã dùng cho hàng đợi pg-boss từ 08/10 (đánh thức 40 ms local, 9 ms prod).

| Vòng | Bảng phát tín hiệu | Kênh NOTIFY |
|---|---|---|
| Đẩy tồn | `stock_push_jobs` (INSERT, UPDATE status về PENDING) | `hubsell_stock` |
| Yêu cầu hóa đơn bấm tay | bảng yêu cầu hóa đơn (INSERT) | `hubsell_invoice_request` |
| Làn hóa đơn tự động + sổ cái | trigger hiện có trên `Order` thêm `pg_notify` | `hubsell_order_changed` |

Worker: module `lib/wake.ts` giữ 1 kết nối `pg` LISTEN (cổng 5432 phiên, cùng
chuỗi `QUEUE_DATABASE_URL`), gom tín hiệu dồn dập trong 100 ms, listener `error`
+ nối lại có giãn; lưới quét giữ lại ở 60 giây làm đường đỡ. Đường lui
`WAKE_LISTEN=off`. Migration đụng `Order` phải lấy khóa có thử lại
([[gotcha-migration-deadlock-render]]).

## 6. Rủi ro và đường lui

| Rủi ro | Xử lý |
|---|---|
| Lát A so thiếu một cột → đơn đổi mà không ghi | Danh sách cột so = đúng danh sách cột trong `data` của UPDATE hiện tại, có test từng cột; đường lui `SYNC_WRITE_ALWAYS=1` quay về ghi mọi đơn |
| Lát A làm gian giãn 60' mà webhook lỡ đơn | Webhook vẫn real-time; lưới 60' là thiết kế gốc 12/09; đơn mới tới thì về nhịp 10' ngay |
| Lát B làm phí đơn mới hiện chậm | Đơn chưa có số vẫn hỏi ngay mỗi 10'; chỉ đơn đã có số mới thưa |
| Lát C giữ vé lâu làm bảng vé phình | Bước dọn (2) xóa khi đơn rời SHIPPING hoặc quá 45 ngày, như cũ |
| Reset `pg_stat_statements` | Chỉ xóa thống kê hiệu năng, không đụng dữ liệu; làm khi anh đồng ý |

## 8. Đo lại 20/11/2026 — anh hỏi "Render sao lại tốn kém tới vậy" (CHỈ ĐO, chưa sửa mã)

**8.1. Tiền (trang Billing Render, 20/11 tối).** Tháng 11 tới 20/11: 49,54 USD = dịch vụ 20,89 (web Starter 7 + worker Standard 25 USD / tháng, tính theo ngày) + **băng thông 28,65** ((195,66 − 5 GB kèm gói) × 0,15 USD / GB). Dòng "Projected total 60,65" của Render chỉ cộng nốt tiền máy tới cuối tháng (32,00) với băng thông ĐÃ dùng, không ngoại suy băng thông → ƯỚC cả tháng 11 ≈ 32 + (≈ 293 − 5) × 0,15 ≈ **75 USD** (tháng 10: 44,00; tháng 9: 9,25).

**8.2. Băng thông từ đâu.** Worker `hubsell-worker-sg` **183,47 / 195,66 GB (94 %)**; biểu đồ 7 ngày (13 → 20/11) phẳng **300–400 MB / giờ suốt ngày đêm**, không theo nhịp ngày / đêm của đơn. Cùng kỳ đơn / ngày giảm 10.524 → 5.686 mà băng thông không giảm → là vòng lặp nền, không phải việc xử lý đơn của khách.

**8.3. `pg_stat_statements` (chỉ đọc; bộ đếm từ 12/10 03:00 UTC).**
- 20/11 21:05 VN: 389,6 triệu lượt, chữ câu lệnh × lượt = 358.514 MB; 4.893 / 5.000 dạng câu (sát trần → số là cận dưới). So với mốc 10/11 10:15 (282 triệu lượt, 270 GB): 10,45 ngày thêm **107,6 triệu lượt ≈ 10,3 triệu / ngày, ≈ 8 GB chữ / ngày** — cùng cỡ băng thông worker 9,2 GB / ngày.
- Mẫu 6,6 phút tối 20/11 (21:05:04 → 21:11:40): +34 MB chữ, +37.525 lượt = **309 MB / giờ, 95 lượt / giây** — khớp biểu đồ Render 300–400 MB / giờ. Một mẫu 45 giây lúc lặng chỉ 79 MB / giờ (170 dạng câu, 1.213 lượt) → tải dồn theo nhịp, mẫu ngắn không dùng để xếp hạng.
- 10 ngày qua theo nhóm (GB chữ thêm): SELECT `tiktok_order_settlements` +18,2 · upsert cùng bảng +16,4 (**hai dòng này ≈ 39 %**) · SELECT `Order` +10,6 · INSERT `order_ledger` +8,0 · SELECT `order_ledger` +5,9 · UPDATE `Order` +4,7 · INSERT `order_line_ledger` +2,8 · SELECT `lazada_order_settlements` +2,5 (5,93 triệu lượt cộng dồn chỉ trả 805 dòng = đọc rỗng) · upsert `AdsCampaign` +1,6.
- **Upsert bản kê TikTok: 8,63 triệu lượt / 10,45 ngày = 826 nghìn / ngày — đúng bằng mức trung bình từ 12/10 (825 nghìn)** → là trạng thái thường trực, không phải đợt nạp ban đầu (câu hỏi còn treo từ 10/11). Bảng có 676.747 dòng; đơn có bản kê THẬT chốt trong 7 ngày: **38.641** → mỗi đơn bị ghi lại **≈ 21 lần / ngày** (nhịp đối soát giờ), tức ~150 lần trong 7 ngày nằm trong cửa sổ, trong khi cần 1 lần.

**8.4. Chỗ trong mã (đọc 20/11, `integrations/tiktok/service.ts`).** `flushSettlementBatch`: mỗi đơn có dòng trong bản kê 7 ngày → `order.findUnique` kèm `tiktokSettlement` (2 câu đọc) → `planSettlementWrite(known, seen)` trả **"write" khi lượt quét thấy đủ mọi bản kê đã biết** (ca thường: đơn nằm trọn trong một bản kê) → `writeTiktokSettlement(estimated: false)` → **upsert bản kê + UPDATE `Order` vô điều kiện**: phép so `rowDiffers` chỉ áp cho bản kê ƯỚC TÍNH (lát B 12/10). Chú thích hàm ghi "bản kê THẬT … một lần mỗi đơn" — giả định này sai: `SETTLE_DAYS_BACK = 7` nên là mỗi giờ × 7 ngày. Đã ghi là việc chưa làm số 6 ở `DON-HOAN-VA-SAO-KE.md` mục 5 từ 02/10 ("bớt việc sổ cái bị đánh dấu tính lại hàng giờ"); em tìm chữ không thấy mục này trong `CUNG-HOA-LOP-GOI-SAN.md` hay `KIEN-TRUC-QUY-MO-TRIEU-DON.md`.

**8.5. Mức chắc.** ĐÃ ĐO: tiền, tỷ lệ worker, biểu đồ phẳng, số lượt câu lệnh, 826 nghìn upsert / ngày trên 38.641 đơn, đường mã ghi vô điều kiện. CHƯA ĐO: byte thật trên dây (đoạn 2.3.6 ngày 12/10 cho rằng Session pooler + câu đã chuẩn bị thì không gửi lại chữ; số 20/11 lại khớp với "gửi cả chữ mỗi lượt" — chưa phân xử; worker không đặt `DB_STATEMENT_CACHE_SIZE`, tức Prisma mặc định 100 câu / kết nối); phần sổ cái (`order_ledger` / `order_line_ledger`) là hệ quả của ghi lặp bản kê hay việc riêng; phần băng thông gọi API sàn. Dù byte chia thế nào, bỏ lượt ghi lặp thì bỏ luôn cả câu đọc lẫn câu ghi của nó.

**8.6. Cùng một gốc đang trả tiền ở ba nơi:** băng thông Render (≈ 43 USD / tháng theo đà tháng 11), Egress Supabase 203 / 250 GB (dữ liệu trả về cho các câu đọc ấy), WAL 16,7 GB / ngày (đo 06/11). ⏳ Anh quyết có kéo việc số 6 lên làm trước không — em nêu một lần kèm số ở đây, chưa viết mã.

**8.7. Phương án (anh hỏi 20/11 tối: "Render chiếm 10 % thu nhập là không ổn, lượng shop ủy quyền cũng chưa nhiều") — em trình, CHƯA code.**
- **Đổi gói Render không cứu được** (docs Render đọc 20/11): băng thông kèm gói Hobby 5 GB, Pro 25 GB, Scale 1 TB; vượt 0,15 USD / GB ra Internet (0,03 USD / GB qua private link). Worker đang ~290 GB / tháng.
- **Ghi lặp bản kê kéo theo sổ cái — đã xác nhận bằng migration:** trigger `order_ledger_on_tiktok_settlement` là `AFTER INSERT OR UPDATE OR DELETE` KHÔNG có `WHEN` (khác trigger trên `Order` / `OrderItem` có `IS DISTINCT FROM`) → mỗi lượt upsert bản kê không đổi vẫn đánh dấu sổ đơn "cần tính lại" → worker sổ cái đọc lại và ghi lại đơn đó. Nên các nhóm `order_ledger` / `order_line_ledger` ở 8.3 phần lớn là hệ quả, không phải việc riêng (chưa đo tỷ lệ chính xác).
- **Lát 1 (em đề xuất làm trước):** bản kê THẬT cũng so trước khi ghi. `flushSettlementBatch` vốn đã đọc đơn + bản kê đang lưu ở bước (a) → mở rộng `select` cho đủ cột rồi `rowDiffers`, giống nhau thì không upsert, không UPDATE `Order`; không thêm câu đọc nào, không đổi con số nào. Chú ý `settledAt` rơi về `new Date()` khi sàn không trả giờ → phải giữ giá trị đang lưu, không thì lần nào cũng "khác". Đường lui `SYNC_WRITE_ALWAYS=1` có sẵn. ƯỚC bỏ được: upsert bản kê (+16,4 GB / 10 ngày) + ~77 % UPDATE `Order` (+3,6) + phần lớn sổ cái và các câu đọc bản kê của nó → **khoảng một nửa** lượng chữ SQL; băng thông ≈ 43 → ≈ 20 USD / tháng nếu byte đi theo tỷ lệ chữ (chưa đo trên dây). Lợi kèm: WAL, CPU database, Egress Supabase.
- **Lát 2 (sau khi đo lát 1):** bản kê đã chốt mà gian đã đọc trọn thì lượt sau bỏ qua, không gọi sàn và không đọc database nữa (việc số 6 đúng nghĩa). Cần chỗ lưu "bản kê đã đọc" theo gian + giữ đúng nhánh "merge" của `planSettlementWrite`. ƯỚC thêm ~15–20 %.
- **Sàn dưới:** tiền máy 32 USD / tháng (web 7 + worker Standard 25) không đổi theo hai lát trên. Muốn xuống dưới nữa thì hoặc đo lại RAM worker sau khi hết ghi lặp để xét hạ cỡ máy, hoặc dời worker sang máy thuê có sẵn băng thông — cả hai CHƯA có số, để sau.
- **Không đề xuất:** giãn nhịp đối soát giờ (chỉnh số, không sửa gốc); nâng gói.

**8.8. Đối chiếu với hai kế hoạch lớn (anh hỏi 20/11 tối: "Việc này có ảnh hưởng gì tới mô hình lớn mình đang làm") — đã đọc lại hai tài liệu.**
- **`KIEN-TRUC-QUY-MO-TRIEU-DON.md`:** mục 6.3 ghi sẵn nguyên tắc đích "Đơn không đổi thì không ghi lại"; đã áp cho đơn (lát A 12/10) và bản kê ước tính (lát B 12/10), SÓT bản kê thật. Lát 1 bịt đúng chỗ sót đó. Không đổi bảng, không đổi trigger, không đổi công thức sổ cái; mục 6.1 "trigger đánh dấu khi … bản kê đối soát đổi" giữ nguyên.
- **`CUNG-HOA-LOP-GOI-SAN.md`:** kế hoạch thay ĐƯỜNG ĐỌC sàn (máy đọc con trỏ N2 / N3, cổng gọi sàn N4 / N5); luồng "tài chính (ví, escrow, sao kê)" xếp ở 5e "Sau đơn", tức sau Pha D. Lát 1 nằm ở ĐƯỜNG GHI, thứ kế hoạch giữ dùng chung cho đường đọc cũ lẫn mới (5d: "một luật ghi đơn, hai đường đọc"). Đường đọc mới còn cố ý đọc trùng (N3: "đọc trùng vô hại vì upsert") → nếu chỗ ghi không so trước thì đọc trùng lại tốn y như hôm nay. Lát 1 là mảnh kế hoạch đằng nào cũng cần, không phải đồ làm rồi gỡ.
- **⛔ Lát 2 ở 8.7 em RÚT, không làm lẻ:** "bỏ qua bản kê đã đọc trọn" chính là con trỏ N2 cho luồng sao kê = việc của Pha C tài chính. Làm riêng bây giờ là dựng chỗ lưu tạm rồi sau phải gỡ. Hệ quả: phần đọc lặp (ước 15–20 %) còn tới khi Pha C tài chính xong.
- **Không đảo quyết định nào đã chốt.** Đã kiểm trong mã: số đếm `ordersUpdated` của đối soát chỉ dùng để in log; không chỗ nào quét `Order` / bản kê theo `updatedAt`.
- **Một rủi ro thật, CHƯA kiểm hết:** hôm nay ghi lặp vô tình làm sổ cái của đơn TikTok vừa quyết toán được tính lại mỗi giờ. Nếu có thay đổi nào làm đổi số của đơn mà không có trigger riêng, việc tính lại đó đang che. Sau lát 1 lỗi kiểu ấy (nếu có) sẽ lộ ra với đơn TikTok — giống đơn Shopee vốn không có lớp che này. Cách chặn trước khi push: tính lại từ gốc một mẫu đơn TikTok đã quyết toán, so với sổ.

**8.9. Lát 1 ĐÃ CODE 20/11 tối (anh: "Làm lát 1") — chưa commit, chưa lên prod.**
- **Sửa (`integrations/tiktok/service.ts`):** `flushSettlementBatch` bước (a) đọc đơn bằng `SETTLED_ORDER_SELECT` (15 cột gộp của `TiktokOrderCols` + `isSettled` / `settledAt` + nguyên dòng bản kê) — vẫn là MỘT `findUnique` như trước, không thêm câu đọc; truyền dòng đó (`stored`) xuống `writeTiktokSettlement`, nhánh bản kê thật `rowDiffers` từng phần: bản kê giống → không upsert, cột `Order` giống → không UPDATE. `SETTLED_ORDER_COLS` có `satisfies Record<keyof TiktokOrderCols, true>` → thêm cột mới mà quên là tsc đỏ; lọt thì `rowDiffers` coi thiếu khóa = khác → ghi như cũ. Sàn không trả mốc bản kê → giữ `settledAt` đang lưu của bản kê thật (trước đây rơi về giờ chạy, mỗi giờ trôi một lần). Kết quả thêm `ordersUnchanged`; log worker thành `Đối soát TikTok "…": X đơn nhận số phí thật, Y giữ nguyên`. Đường lui `SYNC_WRITE_ALWAYS=1` (dùng chung với lát A / B). Bản kê ước tính, Lazada, Shopee: KHÔNG đụng.
- **Đã kiểm (local, DB dev):** `tsc --noEmit` sạch. `tiktok-settlement-merge-db.test.ts` 10 / 10 — 5 ca mới, dấu vết ghi đo bằng `xmin` của Postgres (đổi ở mọi UPDATE kể cả ghi lại giá trị cũ): lượt sau số không đổi → `xmin` bản kê lẫn `Order` giữ nguyên; sàn sửa số trên chính bản kê đó → ghi số mới; đơn đang giữ số ước tính → bản kê thật đầu tiên vẫn ghi đè + đặt đã quyết toán; không có mốc bản kê → mốc quyết toán không trôi, không ghi lại; `SYNC_WRITE_ALWAYS=1` → ghi lại như cũ (chính ca này chứng minh phép đo `xmin` bắt được cách ghi cũ). 5 ca cũ (cộng bản kê ngoài lô, dựng lại, ghi theo lô) vẫn xanh. Bốn tệp bản kê / ước tính liên quan 39 / 39.
- **Bộ test rộng `src/integrations` + `src/workers`: 21 ca đỏ ở 10 tệp sổ cái / xóa gian — ĐỎ SẴN, không do lát này:** em cất thay đổi (`git stash`), chạy lại 3 tệp trên mã gốc → đỏ y hệt (một chủ shop thử trong DB dev còn 4 dòng sổ bẩn, DB dev thiếu chỉ mục GIN sổ cái — lệch DB dev đã ghi ở `CUNG-HOA-LOP-GOI-SAN.md` 5b).
- **Rủi ro "ghi lặp đang che chỗ thiếu trigger" (8.8) — đã kiểm prod, chỉ đọc:** job đêm `auditLedger` (lấy mẫu dòng sổ tính xong ≥ 1 giờ, tính lại từ đơn gốc, so từng cột tiền) chạy **52 đêm từ 30/09, 11.200 đơn mẫu, 0 đơn lệch**; 6 đêm gần nhất 200 / 0. Mẫu này chính là các đơn KHÔNG được ghi lặp "chữa" (đơn Shopee, đơn TikTok quá 7 ngày) → chưa có bằng chứng nào về chỗ thiếu trigger. Sau lát 1 đơn TikTok vừa quyết toán cũng lọt vào mẫu đêm (hết bị tính lại mỗi giờ). Giới hạn: 200 đơn / đêm là mẫu nhỏ.
- **CHƯA kiểm:** prod. Việc đo sau khi lên: (1) log worker có `… giữ nguyên` với Y ≫ X ở lượt giờ thứ hai trở đi; (2) `pg_stat_statements` chênh 1 giờ của `INSERT tiktok_order_settlements` (mốc trước: ≈ 34 nghìn lượt / giờ); (3) biểu đồ Outbound Bandwidth worker sau 24–48 giờ (mốc trước 300–400 MB / giờ); (4) `order_ledger_audit` các đêm sau vẫn 0 lệch; (5) Kiểm toán phí sàn / Lãi-Lỗ một gian TikTok không đổi số. Mỗi lần deploy backend cắt lượt kéo danh mục của gian lớn → đẩy lúc vắng.

**8.10. Lát 1 LÊN PROD 20/11 21:53 (anh: "Em push luôn nhé") — commit `6720a973` (mã) + `5db5b35b` (PROGRESS + docs), push `0ecb932c..5db5b35b`.**
- Render: worker `hubsell-worker-sg` và web `hubsell-backend-sg` cùng "Deploy live for 5db5b35" lúc 21:53 (bắt đầu 21:52). Không có migration.
- **Mốc TRƯỚC deploy** (`pg_stat_statements`, 21:11:40 → 21:51:47, 40,1 phút): tổng 474 nghìn lượt / giờ, 449 MB chữ / giờ; upsert `tiktok_order_settlements` **44,3 nghìn lượt / giờ** (98,8 MB / giờ); SELECT cùng bảng 70,7 nghìn (83,8 MB); UPDATE `Order` 56,9 nghìn (29,4 MB); SELECT `Order` 111,7 nghìn (55 MB); INSERT `order_ledger` 7,2 nghìn (44 MB); SELECT `order_ledger` 27 MB; INSERT `order_line_ledger` 15 MB.
- **Log worker sau deploy (đọc 22:03):** 11 gian TikTok đã chạy qua lượt đối soát (21:54 → 22:01) — **0 đơn ghi lại, 2.524 đơn giữ nguyên**; không có dòng `Lỗi đối soát` nào trong 1 giờ.
- **`pg_stat_statements` SAU deploy (21:58:21 → 22:02:55, 4,6 phút — quãng NGẮN, chỉ đủ xác nhận cơ chế):** upsert `tiktok_order_settlements` **7 lượt** trong khi SELECT cùng bảng 227 lượt → 0,03 lượt ghi / lượt đọc (trước deploy 0,63). Tổng 10.401 lượt, 9,9 MB chữ (quy ra ≈ 137 nghìn lượt / giờ, 130 MB / giờ so với 474 nghìn và 449 MB trước deploy) — **CHƯA dùng con số quy đổi này làm kết quả**: sau khi worker khởi động lại các gian chạy dồn một đợt rồi thưa, quãng 4,6 phút rơi vào lúc thưa (8.3 đã ghi mẫu ngắn lệch nhiều).
- **CÒN PHẢI ĐO (chưa làm):** chênh `pg_stat_statements` trọn ≥ 1 giờ (một vòng đối soát đủ mọi gian); biểu đồ Outbound Bandwidth worker sau 24–48 giờ (mốc 300–400 MB / giờ); `order_ledger_audit` đêm 21/11 03:00 trở đi vẫn 0 lệch; số Lãi/Lỗ một gian TikTok không đổi.

## 7. Nhật ký

- 12/10/2026 sáng: lập kế hoạch bản 1 (NOTIFY cho lưới quét); đã bỏ cờ 2 thư
  Render 04/10 trên Zoho theo lệnh anh sau khi xem biểu đồ.
- 12/10/2026 trưa: chạy bước 0 trên Supabase (chỉ đọc) → đổi hướng sang lát
  A–C; anh chốt lát B theo hướng "hỏi khi đổi trạng thái" (mục 3, lát B).
- 12/10/2026 10:00 VN: anh cho reset → đã chạy `pg_stat_statements_reset()`;
  số đếm từ mốc này là "trước deploy lát A" sạch (chỉ còn trạng thái sau 08/10).
- 12/10/2026: **lát A code xong** (`integrations/order-sync-write.ts` + 3
  service + `order-auto-sync` log), tsc sạch, test mới 16/16 + stock-push 7/7;
  chi tiết PROGRESS.md phiên 12/10. ✅ ĐÃ PUSH `1421075` (anh bảo em push).
- 12/10/2026: **lát C code xong** — vé DETECT đã an bài thì đỗ 24 giờ
  (`DETECT_SETTLED_PARK_MS`, `parkedDetectTaskData`, cả Shopee lẫn TikTok),
  bước dọn xóa khi đơn rời SHIPPING; test DB `delivery-fail-park-db.test.ts`
  3/3. ✅ ĐÃ PUSH `2020617`, worker deploy 10:24.
- 12/10/2026: **lát B code xong** đúng cách anh chốt: `sweep` "new" / "delivered"
  (1 lần/ngày VN, `claimDailyEscrowSweep`) / "all"; `changedOrderCodes` từ đồng
  bộ đơn + quét đơn hoàn (quét hoàn chạy TRƯỚC ước tính); so trước khi ghi bằng
  `rowDiffers`; TikTok unsettled so trước khi upsert. Test
  `escrow-estimate-sweep.test.ts` 10/10. Chi tiết PROGRESS.md phiên 12/10.
  Kiểm prod sau 24 giờ cùng A + C theo mục 3 bước 3, thêm: Kiểm toán phí sàn rổ
  #2 không tăng báo oan.

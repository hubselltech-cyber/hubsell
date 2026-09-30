# Sổ cái đơn — thiết kế giai đoạn 1 của kiến trúc quy mô triệu đơn

Ngày lập: 30/09/2026. Người lập: Claude (Lead Dev). Tệp gốc: `docs/KIEN-TRUC-QUY-MO-TRIEU-DON.md` (mục 6.1, anh Trung duyệt hướng 30/09/2026).

Trạng thái: **bước 1 đã viết xong, đã chạy thử trên DB local (30/09/2026 tối): migration áp sạch, 12 test tích hợp qua, 7.570 đơn tính trong 8 giây (~960 đơn/giây), đối soát 1.000 dòng lệch 0, so khớp SUM trong DB với tính lại trong RAM khớp từng đồng cho cả 3 chủ shop.** Chưa push, chưa đụng prod. Mục 8 là việc còn lại để đưa lên prod.

---

## 1. Sổ cái giải quyết việc gì

Hôm nay mọi báo cáo tài chính (Báo cáo dòng tiền, Lãi/Lỗ, Tổng quan, Thuế, Lãi/Lỗ theo SKU, KOC, biên lãi quảng cáo) đều làm cùng một việc: kéo từng đơn kèm dòng hàng, sổ kho và bản kê đối soát lên server, chạy `computePnlRow` cho từng đơn, rồi cộng trong RAM. Đó là khuôn lỗi K1 (cộng trong bộ nhớ server): buộc phải có trần, và trần đã làm sai số tháng 8 (13,19 triệu thay vì 34,29 triệu). Với shop 300.000 đơn/tháng, cách này không chạy nổi dù có bỏ trần.

Sổ cái đổi lại thứ tự: **tiền của mỗi đơn được tính đúng một lần, ghi xuống database; báo cáo chỉ còn là một câu SUM.** Công thức vẫn là `computePnlRow` (không viết lại bằng SQL), nên số không thể lệch với những gì trang Lãi/Lỗ đang hiển thị.

Ba tính chất phải giữ, và cách giữ:

| Tính chất | Cách giữ |
|---|---|
| Sổ luôn đúng, không phụ thuộc lập trình viên nhớ gọi hàm | Trigger ở database đánh dấu "cần tính lại" khi đơn, dòng hàng, bản kê, sổ kho hay giá vốn sản phẩm đổi. Bao trùm cả các script vá giá vốn hàng loạt ghi thẳng bằng SQL |
| Số trong sổ tươi trong vài giây | Worker nhặt dòng bị đánh dấu theo lô, tính lại, ghi. Báo cáo còn tự tính nốt dòng bẩn trong kỳ của mình trước khi cộng |
| Hệ thống tự phát hiện sai lệch trước khách | Mỗi đêm lấy mẫu đơn, tính lại từ dữ liệu gốc, so với sổ; lệch là ghi bảng đối soát và tự đánh dấu tính lại. Số dòng bẩn tồn, dòng lạc mảnh, kết quả đối soát hiện trên HQ |

---

## 2. Cấu trúc

### 2.1. Bảng `order_ledger` (mỗi đơn một dòng)

Phân mảnh theo THÁNG trên `createdDate` (ngày tạo đơn theo giờ Việt Nam). Khóa chính `(createdDate, orderId)` vì Postgres buộc khóa của bảng phân mảnh phải chứa khóa phân mảnh; ngoài ra có chỉ mục riêng trên `orderId` để tra một đơn không phải quét mọi mảnh.

| Nhóm cột | Nội dung |
|---|---|
| Định danh | `orderId`, `createdDate`, `channelId`, **`ownerId`** (chủ shop, cột trực tiếp, hết vòng qua bảng gian), `channelName`, `orderCode` |
| Ba trục ngày | `createdAt` + `createdDate`, `deliveredAt` + `deliveredDate`, `settledAt` + `settledDate`. Khóa ngày theo giờ VN để nhóm theo ngày và lọc theo kỳ không phải đổi múi giờ lúc đọc |
| Trục lọc | `shippingStatus`, `returnStatus`, `isSettled`, `returnType`, và ba cờ tính sẵn theo `lib/finance-definitions.ts`: `countsAsRevenue`, `isReturning`, `isLoss`; `missingCostPrice`; đếm `itemCount`, `totalQuantity`, `returnedQuantity` |
| Tiền (29 cột, DECIMAL 14,2) | Đúng tên trường của `computePnlRow`: `revenueGross`, `sellerVoucher`, `actualRevenue`, `platformSubsidy`, 5 cột vận chuyển, 6 cột phí, `platformTax`, `refundedAmount` (+ `refundEstimated`, `refundSource`), `returnedCostAtSale`, `recoveredCost`, `costSnapshot`, `netRevenue`, `actualPayout`, `platformRevenue`, `platformDeduction` (= giá trị đơn − doanh thu sàn), `profit`, `profitAfterTax`, và 3 khoản thất thu đơn hoàn (`computeReturnLoss`) |
| Sổ sách của sổ | `formulaVersion` (0 = dòng nháp chưa tính), `computedAt`, `dirtyAt` (≠ NULL = cần tính lại), `dirtyReason`, `claimedAt` (worker đang cầm) |

Không lưu: thuế bổ sung (tính trên tổng kỳ), tên gian, mã SKU kho, tên khách, hãng vận chuyển. Ba thứ đầu theo thiết kế gốc; hai thứ sau là trường hiển thị, trang danh sách đọc từ bảng đơn khi cần 20–100 dòng của trang hiện tại.

### 2.2. Bảng `order_line_ledger` (mỗi dòng hàng một dòng)

Cùng cách phân mảnh, khóa `(createdDate, orderItemId)`. Ngoài số riêng của dòng (`quantity`, `price`, `costPriceAtSale`, `lineGross`, `lineCost`, `costSnapshot` đã thu hồi, `recoveredCost`, `recoveredQuantity`), tiền của đơn được **phân bổ xuống dòng theo tỷ trọng giá trị dòng** và lưu sẵn: `revenueGross`, `actualRevenue`, `platformRevenue`, `platformDeduction`, `refundedAmount`, `feeGmvMax`, `profit`, `profitAfterTax`, kèm `share`. Đây đúng là cách `/sku-pnl`, biên lãi quảng cáo Shopee và hòa vốn TikTok đang phân bổ, nên ba nơi đó chuyển sang cộng từ bảng này không đổi con số.

Làm tròn: từng khoản làm tròn 2 số lẻ, phần dư dồn về dòng lớn nhất, nên Σ dòng của một đơn = đơn từng xu (có test). Đơn toàn dòng giá 0 (quà tặng) chia đều thay vì bỏ rơi tiền.

### 2.3. Bảng `order_ledger_audit`

Mỗi lượt đối soát đêm một dòng: số mẫu, số lệch, số dòng bẩn tồn, số dòng bẩn quá 10 phút chưa ai tính, số dòng rơi vào mảnh DEFAULT, chi tiết lệch (tối đa 50 đơn). Trang HQ đọc bảng này ở giai đoạn 4; hiện đã có endpoint.

### 2.4. Phân mảnh

- Mảnh `order_ledger_YYYY_MM` từ tháng của đơn cũ nhất tới 3 tháng sau hôm nay; worker tạo thêm mỗi đêm. Mảnh mới tự bật RLS (Supabase yêu cầu từ 30/09).
- Mảnh `order_ledger_default` hứng mọi ngày ngoài dải để **không bao giờ mất dòng** vì một đơn có ngày lạ. Bảng đối soát đếm mảnh này, phải luôn bằng 0.
- Khi cần tạo mảnh cho tháng mà DEFAULT đang giữ dòng (Postgres từ chối tạo thẳng), hàm `order_ledger_create_month_partition` tạo bảng rời, dời dòng sang, rồi ATTACH. Không kẹt bảo trì vì một dòng lạc.
- Đơn đổi `createdAt` sang tháng khác: trigger dời dòng sang mảnh đúng (Postgres cho phép UPDATE khóa phân mảnh); worker còn một bước "kéo về" phòng khi ghi đè trúng lúc dời. Có test.

### 2.5. Chỉ mục

`(ownerId, createdDate)`, `(channelId, createdDate)`, `(channelId, deliveredDate)`, `(channelId, settledDate)`, `(orderId)`, và chỉ mục một phần `(dirtyAt) WHERE dirtyAt IS NOT NULL` làm hàng đợi việc của worker (nhỏ dù sổ lớn). Bảng dòng hàng thêm `(productId)`, `(channelId, channelSku)`.

---

## 3. Giữ sổ luôn đúng: trigger

Hàm `order_ledger_mark(orderId, reason, checkDate)`: chưa có dòng thì tạo dòng nháp (đủ cột định danh, `formulaVersion = 0`, `dirtyAt = now`), có rồi thì chỉ đặt `dirtyAt`. Các trigger gọi hàm này:

| Bảng | Khi nào | Ghi chú |
|---|---|---|
| `Order` | INSERT; UPDATE khi một trong 32 cột công thức đọc **đổi giá trị** | So ROW(OLD…) với ROW(NEW…) nên đồng bộ ghi lại đơn không đổi (288 lần/2 ngày) không sinh việc thừa. Đổi `createdAt` → dời mảnh |
| `OrderItem` | INSERT, DELETE; UPDATE khi số lượng/giá/giá vốn/trả hàng/sản phẩm đổi | Bắt cả script vá giá vốn hàng loạt |
| `lazada_order_settlements`, `tiktok_order_settlements` | mọi INSERT/UPDATE/DELETE | |
| `InventoryLog` | mọi thay đổi có `orderId` | Giá vốn đơn cũ không có dòng hàng đọc từ sổ kho |
| `Product` | `costPrice` đổi | Chỉ đánh dấu các đơn cũ **không có dòng hàng** từng trừ kho sản phẩm đó (đơn có dòng hàng dùng giá vốn snapshot) |

Không có trigger cho `Channel.userId` / `channelName` (không đổi trong nghiệp vụ). Xóa gian, xóa đơn: FK `ON DELETE CASCADE` xóa dòng sổ.

Chi phí: mỗi lần ghi đơn thêm một lệnh UPSERT nhỏ trên chỉ mục `(createdDate, orderId)`. Phải đo trên prod sau khi bật (mục 8 bước 6).

---

## 4. Worker tính lại (`workers/order-ledger.ts`)

- Mỗi 2 giây (`LEDGER_POLL_MS`) nhặt tới 500 dòng bẩn (`LEDGER_BATCH`), cũ nhất trước. Nhặt bằng `UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED)` ghim `claimedAt` → **chạy được nhiều bản song song**, không xử lý đôi. Dòng bị cầm quá 10 phút thì bản khác nhặt lại (tiến trình chết giữa lô không kẹt việc). Mỗi lượt chạy tối đa 20 giây rồi nhả cho vòng sau.
- Đọc đơn kèm quan hệ (`LEDGER_INCLUDE` = tập `PNL_INCLUDE` + chủ shop), gọi `buildLedgerRows`, ghi theo lô 100 đơn/câu trong một transaction: kéo dòng về mảnh đúng nếu lạc, `INSERT … ON CONFLICT DO UPDATE` dòng đơn, xóa và ghi lại dòng hàng.
- **Không mất cập nhật**: khi ghi, `dirtyAt` chỉ được xóa nếu vẫn bằng mốc lúc nhặt (`IS NOT DISTINCT FROM`). Có thay đổi chen vào giữa lúc nhặt và lúc ghi thì mốc đã khác, dòng vẫn bẩn, lượt sau tính lại. Cột dùng `TIMESTAMPTZ(3)` (mili giây) để mốc đi qua JavaScript không mất số lẻ. Có test tích hợp.
- Lúc khởi động và mỗi đêm 03:00 giờ VN: tạo mảnh 3 tháng tới; đánh bẩn dần các dòng còn mang `formulaVersion` cũ (đổi công thức = tăng `LEDGER_FORMULA_VERSION` trong `lib/order-ledger.ts`, không sửa số bằng tay); đối soát mẫu 200 đơn (`LEDGER_AUDIT_SAMPLE`).
- Tắt bằng `LEDGER_WORKER_OFF=1`. Khi tắt, sổ vẫn được đánh dấu; báo cáo dùng sổ tự tính nốt phần bẩn của kỳ mình cần.

Sức tải: một lô 500 đơn ≈ 5 truy vấn đọc (mỗi 100 đơn kèm quan hệ) + 5 transaction ghi. Ước 100–250 đơn/giây một worker, tức 1 triệu đơn/ngày ≈ 12 đơn/giây trung bình là 5–10% công suất một worker. Đỉnh sale gấp 10 lần vẫn dưới một worker; cần thêm thì chạy thêm bản (không sửa code).

---

## 5. Đọc từ sổ (`services/order-ledger.ts`)

- `ledgerSummary(scope, range, {axis})`: một câu SELECT với `SUM(cột) FILTER (WHERE nhóm)` cho 7 nhóm × 29 cột tiền + các số đếm. Nhóm định nghĩa MỘT lần ở `LEDGER_GROUPS` (`lib/order-ledger.ts`), vừa có điều kiện SQL vừa có hàm TS cùng nghĩa, có test bảo đảm hai vế cùng kết quả. Trục kỳ chọn được: ngày tạo (mặc định), ngày giao (thuế), ngày quyết toán. Lọc trên cả cột thời gian (đúng biên giờ VN) lẫn cột ngày (để Postgres cắt mảnh).
- `ensureLedgerFresh(scope, range)`: báo cáo gọi trước khi cộng, tính nốt tối đa 2.000 dòng bẩn trong kỳ; trả số còn lại để giao diện nói "X đơn đang chờ cập nhật" thay vì cộng thiếu trong im lặng (nguyên tắc 3).
- Chỉ cộng dòng có `formulaVersion` hiện tại: đổi công thức thì báo cáo tạm thiếu dòng chưa tính lại và báo số thiếu, không trộn hai công thức trong một kỳ.

Nhóm (cùng trục với tab Lãi/Lỗ và thẻ Báo cáo dòng tiền): tất cả; tính doanh thu (không hủy, không đang hoàn); hủy; đang hoàn; đã quyết toán; chờ quyết toán; đã giao. Ba nhóm đầu loại trừ nhau và cộng lại bằng tất cả.

---

## 6. Tự đối soát và quan sát

- `auditLedger(n)`: lấy mẫu n dòng đã tính ≥ 1 giờ (bảng nhỏ: `ORDER BY random()`; bảng > 200.000 dòng: `TABLESAMPLE`), tính lại từ đơn gốc, so 29 cột tiền (lệch ≥ 0,5 đồng) và 4 cờ. Lệch → ghi chi tiết, đánh bẩn để tự sửa, và là **dấu hiệu trigger hoặc worker có lỗ hổng, phải điều tra** chứ không chỉ sửa số.
- `ledgerStatus()`: tổng dòng, dòng đã tính, dòng bẩn, tuổi dòng bẩn cũ nhất, dòng đang bị cầm, dòng phiên bản cũ, dòng ở mảnh DEFAULT, số dòng hàng, danh sách mảnh, kết quả đối soát gần nhất.
- Endpoint HQ (quyền `hq.health`): `GET /api/admin/ledger/status`; `GET /api/admin/ledger/compare?ownerId&from&to&channelId&channelName&fresh=1` trả hai bản tổng (SUM trong DB và tính lại trong RAM từ đơn gốc) kèm chênh lệch từng nhóm × cột, thời gian mỗi bên; `POST /api/admin/ledger/audit`, `POST /api/admin/ledger/maintenance`, `POST /api/admin/ledger/recompute` (chỉ chủ nền tảng, có nhật ký).
- Script `scripts/ledger-backfill.ts`: `status`, `drain`, `mark`, `audit`, `compare`, `partitions` — chạy trên Render Shell của worker.

Giai đoạn 4 sẽ đưa các số này lên trang HQ Sức khỏe (độ trễ hàng đợi sổ, tỷ lệ lệch).

---

## 7. Những chỗ em đã cân nhắc và chọn khác

| Lựa chọn | Đã chọn | Vì sao không chọn cách kia |
|---|---|---|
| Công thức bằng SQL hay giữ TS | Giữ `computePnlRow` TS, worker gọi | Viết lại bằng SQL là có hai công thức (khuôn K6); mọi quyết định nghiệp vụ 3 tháng qua nằm trong hàm TS đã có test |
| Bảng hàng đợi riêng hay cờ trên dòng sổ | Cờ `dirtyAt` trên dòng + chỉ mục một phần | Một bảng ít hơn, "đơn có trong sổ chưa" và "cần tính lại chưa" là cùng một dòng; báo cáo lọc dòng bẩn trong kỳ bằng chính chỉ mục kỳ |
| Phân mảnh ngay hay để giai đoạn 4 | Ngay | Đổi bảng thường thành phân mảnh sau này phải chép lại toàn bộ dữ liệu và dừng ghi; giờ bảng còn trống nên miễn phí. Cái giá: khóa chính ghép và vài chỗ phải "kéo dòng về mảnh đúng" |
| Có mảnh DEFAULT không | Có | Không có thì một đơn ngày lạ làm lệnh ghi đơn thất bại (trigger lỗi). Cái giá: tạo mảnh mới phải quét DEFAULT (rỗng thì tức thì) và cần đường vòng dời dòng khi DEFAULT có dữ liệu — đã viết |
| Khóa ngày do trigger sinh (generated column) hay worker ghi | Worker ghi | Prisma không khai báo được cột sinh; cột thường thì `groupBy`/`findMany` dùng được. Cách tính ngày VN chỉ ở một chỗ (`toBusinessDateKey`), trigger chỉ tính cho dòng nháp bằng cùng phép +7 giờ |
| Dựng sổ đơn cũ trong migration hay script | Migration chỉ tạo **dòng nháp** (~120 byte/đơn); worker tính dần theo nhịp | Phần đọc nặng (đơn kèm quan hệ) không dồn vào lúc deploy; tốc độ điều chỉnh bằng env, không cần thao tác tay. Script `mark` vẫn có cho trường hợp cần tính lại một phạm vi |
| Thay đọc báo cáo ngay | Chưa. Bước này chỉ dựng sổ + công cụ so khớp | Nguyên tắc chuyển đổi: chạy song song, khớp trên prod rồi mới chuyển từng trang |

Điểm em chưa hài lòng và sẽ theo dõi: trigger `InventoryLog` đánh dấu mọi đơn có trừ kho (kể cả đơn có dòng hàng, vốn không cần) → mỗi đơn mới bị tính lại thêm một lần. Vô hại về số, tốn ~1 lần đọc/đơn; nếu đo thấy đáng kể thì thêm điều kiện "đơn không có dòng hàng" vào trigger.

---

## 8. Đưa lên prod: việc anh Trung làm theo thứ tự

Render tự chạy `prisma migrate deploy` lúc khởi động (render.yaml), nên **push là migration áp lên Supabase**. Vì vậy phải chạy thử local trước khi push.

**Đã làm trên DB local 30/09/2026 (Claude chạy, anh Trung cho phép):**

1. ✅ Áp migration bằng psql trong một transaction (`-v ON_ERROR_STOP=1 --single-transaction`): sạch, 7.570/7.570 dòng nháp bẩn, 84 mảnh tháng (đơn cũ nhất 07/2023 → 12/2026), 8 trigger, mảnh DEFAULT trống. Nhân tiện áp hai migration DB local còn thiếu (`20260928230000_channel_product_catalog_sync`, `20260930090000_order_delivered_at_index`) — đây là lý do 12 file test tích hợp cũ từng đỏ.
2. ✅ `vitest run src/integrations/__tests__/order-ledger-db.test.ts src/lib/__tests__/order-ledger.test.ts`: 12 + 14 test qua.
3. ✅ `npx tsx scripts/ledger-backfill.ts drain`: 7.570 đơn trong 8 giây (~960 đơn/giây, gồm 9.936 dòng hàng). `status`: dirty 0, staleVersion 0, defaultRows 0. `audit --sample 1000 --min-age 0`: lệch 0. `compare --all`: 3 chủ shop KHỚP từng đồng, cộng từ sổ 16–60 ms so với tính lại 183–1.061 ms (1.011 → 5.319 đơn).

**Sự cố khi lên prod 30/09/2026 (10:08–10:35, đã ghi memory `hubsell-su-co-so-cai-nano-2026-09-30`):**

- Lần deploy đầu: migration **deadlock 40P01** với instance cũ đang ghi đơn (`DROP TRIGGER` cần khóa độc quyền trên `Order`) → Prisma ghi FAILED, mọi lần khởi động sau P3009. Sửa: khối lấy khóa 6 bảng theo thứ tự cố định có thử lại + `CREATE OR REPLACE TRIGGER` (`34b48a4`); anh Trung chạy `update _prisma_migrations set rolled_back_at = now() …`; worker áp lại thành công 10:08:05 UTC.
- Ngay sau đó worker dựng sổ 42.251 đơn với lô 500/2 giây không nghỉ, mỗi lô có DELETE/UPDATE theo `orderId` quét chỉ mục của cả 84 mảnh → **Supabase compute NANO (t3a.nano) quá tải**: pool 5 kết nối của worker cạn (webhook TikTok, đẩy tồn, auto-sync timeout), rồi `P1001 Can't reach database server`, project Unhealthy ~12 phút. Em bấm Restart project trên Supabase lúc 10:30.
- Sửa (`0baaa2b`, đã deploy worker): mọi câu ghi kèm `createdDate` để cắt mảnh; bỏ bước "kéo dòng về mảnh" khỏi đường nóng (đối soát đêm đếm và tự sửa `duplicateOrders`); lô 100 (`LEDGER_BATCH`) + nghỉ 500 ms giữa lô (`LEDGER_CHUNK_PAUSE_MS`); tắt hẳn bằng `LEDGER_WORKER_OFF=1`.
- **Kết luận thiết kế:** (1) compute Nano không đủ cho bất kỳ việc nền nào quét hàng chục nghìn dòng — đề nghị nâng compute (gói Pro có tín dụng cho Micro); (2) với bảng phân mảnh, câu lệnh thiếu khóa phân mảnh trong WHERE đắt gấp số mảnh; (3) công tắc khẩn (env) phải đặt sẵn trước khi bật tính năng nặng, vì sửa env qua giao diện lúc sự cố không kịp.

**Còn lại, anh Trung làm:**

4. **Push.** Render deploy web + worker; migration tạo bảng, trigger, dòng nháp cho toàn bộ đơn prod trong một transaction (vài giây với vài chục nghìn đơn). Worker bắt đầu tính ngay, 500 đơn/2 giây (local đo ~960 đơn/giây, prod qua pooler Supabase sẽ chậm hơn).
5. **Theo dõi trên prod**: `GET /api/admin/ledger/status` (đăng nhập dev@hubsell.tech) tới khi `dirty = 0`; hoặc Render Shell worker: `npx tsx scripts/ledger-backfill.ts status`.
6. **Đo chi phí trigger**: so thời gian một lượt đồng bộ đơn trước/sau trên log worker (`[AutoSync]`). Kỳ vọng thêm dưới 1 ms/đơn.
7. **So khớp trên dữ liệu thật**: Render Shell worker `npx tsx scripts/ledger-backfill.ts compare --all` (mọi chủ shop) rồi kỳ đã có số đối chiếu (tháng 8 tài khoản demo: 2.052 đơn tính doanh thu, doanh thu 332.474.760, lợi nhuận 32.978.902): `compare --owner <id> --from 2026-08-01 --to 2026-08-31 --fresh`, hoặc `GET /api/admin/ledger/compare?ownerId=…&from=…&to=…&fresh=1` → `match: true`. Thử thêm lọc theo sàn và theo gian.
8. Khớp rồi mới sang bước 2 của giai đoạn 1 (mục 9).

Đường lui: chưa báo cáo nào đọc từ sổ nên tắt worker (`LEDGER_WORKER_OFF=1`) là hệ thống như cũ; gỡ hẳn thì `DROP TRIGGER` 7 trigger và `DROP TABLE` 3 bảng (em soạn SQL khi cần). Migration đã áp không cần hoàn tác để deploy tiếp.

---

## 9. Việc kế tiếp của giai đoạn 1 (sau khi so khớp prod đạt)

Chuyển từng nơi đọc sang sổ, mỗi nơi một commit, giữ đường cũ sau công tắc env trong 1 tuần:

1. `/api/finance/analytics` (Báo cáo dòng tiền) — nơi xuất phát sự cố, dùng `ledgerSummary` nhóm active/settled/pending/cancelled/returning.
2. `/api/analytics` (Tổng quan) — cùng nhóm active + chuỗi ngày `GROUP BY createdDate`.
3. `/api/finance/realized-pnl` — danh sách phân trang ở database (`ORDER BY createdAt DESC LIMIT/OFFSET` trên sổ, join bảng đơn lấy trường hiển thị), tổng kết bằng SUM.
4. Thuế (`/api/tax/report`, `/tax/declaration`) — trục ngày giao (`axis: "delivered"`), hết 10–15 giây/lượt.
5. `/sku-pnl`, biên lãi quảng cáo Shopee, hòa vốn TikTok, KOC — từ `order_line_ledger`.
6. Bỏ `fetchPnlRows`/phanh 20.000 khi không còn nơi gọi; giữ `forEachPnlOrderPage` cho worker và đối soát.

Tiêu chí nghiệm thu (giữ nguyên từ tệp gốc): với mọi bộ lọc, số từ sổ khớp từng đồng với số tính từ đơn gốc trên toàn bộ dữ liệu prod; báo cáo tháng của shop 300.000 đơn (dữ liệu sinh thử) dưới 2 giây.

---

## 10. Việc cần anh Trung chốt

1. Push bước 1 (mục 8 bước 1–3 đã đạt trên local).
2. Thứ tự chuyển báo cáo ở mục 9 — em đề nghị Báo cáo dòng tiền trước vì đó là nơi khách thấy sai.
3. Ngưỡng đối soát đêm: mẫu 200 đơn/đêm là mặc định em chọn (đủ để bắt lỗi hệ thống, không đủ để bắt lỗi lẻ tẻ); shop lớn có thể nâng qua `LEDGER_AUDIT_SAMPLE`.

## Phụ lục. Tệp liên quan

| Tệp | Vai trò |
|---|---|
| `backend/prisma/migrations/20260930230000_order_ledger/migration.sql` | Bảng, chỉ mục, RLS, hàm phân mảnh, hàm đánh dấu, 7 trigger, dựng dòng nháp cho đơn cũ |
| `backend/prisma/schema.prisma` | Model `OrderLedger`, `OrderLineLedger`, `OrderLedgerAudit`, enum `LedgerReturnType` (chỉ để đọc có kiểu) |
| `backend/src/lib/pnl-formula.ts` | `computePnlRow` và họ hàng, tách nguyên văn khỏi `routes/finance.ts` (route re-export, nơi import cũ không đổi) |
| `backend/src/lib/order-ledger.ts` | Dựng dòng sổ (thuần), phân bổ dòng hàng, `LEDGER_GROUPS`, đối soát dòng, phiên bản công thức |
| `backend/src/services/order-ledger.ts` | Nhặt việc, ghi sổ, cộng trong DB, tươi hóa, bảo trì, đối soát đêm, trạng thái HQ |
| `backend/src/workers/order-ledger.ts` | Worker nền (poll + bảo trì đêm) |
| `backend/src/routes/admin-ledger.ts` | Endpoint HQ (status, compare, audit, maintenance, recompute) |
| `backend/scripts/ledger-backfill.ts` | Công cụ dòng lệnh |
| `backend/src/lib/__tests__/order-ledger.test.ts` | Test thuần (phân bổ, cờ, nhóm, đối soát) |
| `backend/src/integrations/__tests__/order-ledger-db.test.ts` | Test tích hợp trên DB dev (tự bỏ qua khi chưa áp migration) |

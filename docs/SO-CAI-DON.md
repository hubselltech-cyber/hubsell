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

**Trạng thái sau sự cố (30/09 ~11:00):** migration đã áp trên prod (bảng, 8 trigger, 42.251 dòng); worker sổ cái **TẮT** (bản `1d41137`, chỉ chạy khi `LEDGER_WORKER_ON=1`); 27.300 dòng đã tính, ~15.000 dòng bẩn chờ; trigger vẫn đánh dấu đơn mới nên sổ không lỗi thời về phạm vi, chỉ chưa tính. Chưa báo cáo nào đọc từ sổ nên khách không bị ảnh hưởng gì về số liệu.

**Điều kiện để tiếp tục giai đoạn 1 (anh Trung quyết):**
1. ✅ 30/09 11:15 anh chốt nâng compute Supabase Nano → **Micro** (1 GB; 9,68 USD/tháng nằm trong tín dụng gói Pro, +0 USD).
2. ✅ 30/09 12:03–12:23 (anh nhắn "chạy đi" lúc nghỉ trưa): `LEDGER_CHUNK_PAUSE_MS=9000 npx tsx scripts/ledger-backfill.ts drain --batch 500` trên Render Shell worker → **15.725 đơn trong 1.188 giây (13 đơn/giây), 0 lỗi**. Suốt lúc chạy: CPU Supabase 7–8 %, RAM 933 MB/1 GB không đổi, log worker không có P2024/P1001, webhook TikTok + auto-sync + đẩy tồn chạy bình thường. `status` sau đó: 42.343 dòng, 42.305 đã tính, 38 bẩn (đơn mới phát sinh trong lúc chạy, chờ worker), claimed 0, staleVersion 0, defaultRows 0, 57.187 dòng hàng.
3. ✅ `compare --all --fresh`: **20/20 chủ shop KHỚP từng đồng** (7 nhóm × 29 cột). Chủ shop lớn nhất 15.395 đơn: cộng từ sổ 204 ms so với tính lại 10.382 ms (nhanh ~50 lần); các chủ shop 4.000–5.500 đơn: 61–76 ms so với 2.400–5.700 ms. `compare --all --from 2026-08-01 --to 2026-08-31 --fresh`: 20/20 KHỚP. `audit --sample 1000 --min-age 0`: sampled 1.000, mismatched 0, duplicateOrders 0, 1,75 giây.
4. ✅ **Đối chiếu số tham chiếu tháng 8** (chủ shop demo `cms4dqhw…`): nhóm `active` = 2.052 đơn, `platformRevenue` = 332.474.760 (đúng số "Doanh thu" Báo cáo dòng tiền), `profitAfterTax` = 90.143.760. Báo cáo dòng tiền ghi lợi nhuận 32.978.902 vì trừ tiếp hai khoản NGOÀI sổ: chi phí vận hành cố định nhập tay 56.547.000 + quảng cáo Shopee (bảng AdSpend) 617.858 → 90.143.760 − 56.547.000 − 617.858 = **32.978.902, đúng từng đồng**. Kết luận: sổ cái chỉ ghi số theo đơn; chi phí nhập tay, AdSpend, thu khác, thuế bổ sung vẫn cộng ở tầng báo cáo như cũ (khi chuyển báo cáo sang sổ, giữ nguyên các phép trừ này).
5. ⏳ **Việc còn lại trước khi chuyển báo cáo:** đặt `LEDGER_WORKER_ON=1` trên dịch vụ worker Render (Environment → Add → Save; worker tự redeploy) để worker giữ sổ tươi (lô 100, nghỉ 500 ms). Claude không được sửa env Render (lớp kiểm quyền chặn), anh Trung làm tay. Chưa bật thì dòng bẩn dồn dần (38 dòng lúc 12:25); báo cáo đọc sổ vẫn tự tính nốt phần bẩn trong phạm vi (`ensureLedgerFresh`) nên không sai số, chỉ chậm hơn.

**Các bước cũ (đã làm hoặc thay bằng phần trên):**

4. **Push.** Render deploy web + worker; migration tạo bảng, trigger, dòng nháp cho toàn bộ đơn prod trong một transaction (vài giây với vài chục nghìn đơn). Worker bắt đầu tính ngay, 500 đơn/2 giây (local đo ~960 đơn/giây, prod qua pooler Supabase sẽ chậm hơn).
5. **Theo dõi trên prod**: `GET /api/admin/ledger/status` (đăng nhập dev@hubsell.tech) tới khi `dirty = 0`; hoặc Render Shell worker: `npx tsx scripts/ledger-backfill.ts status`.
6. **Đo chi phí trigger**: so thời gian một lượt đồng bộ đơn trước/sau trên log worker (`[AutoSync]`). Kỳ vọng thêm dưới 1 ms/đơn.
7. ✅ **So khớp trên dữ liệu thật** (30/09 12:25, xem mục 3–4 ở trên): `compare --all` 20/20 KHỚP; tháng 8 demo khớp 2.052 đơn / 332.474.760 / (90.143.760 − chi phí nhập tay − AdSpend = 32.978.902). Lưu ý khi so với Báo cáo dòng tiền: số "lợi nhuận" của trang đó = Σ `profitAfterTax` đơn đã quyết toán có giá vốn − chi phí nhập tay − AdSpend, hai khoản sau không nằm trong sổ. Chưa thử lọc theo sàn/gian trên prod (script `compare --channel <id>` có sẵn).
8. ✅ Khớp → sang bước 2 của giai đoạn 1 (mục 9), bắt đầu từ Báo cáo dòng tiền.

Đường lui: chưa báo cáo nào đọc từ sổ nên tắt worker (`LEDGER_WORKER_OFF=1`) là hệ thống như cũ; gỡ hẳn thì `DROP TRIGGER` 7 trigger và `DROP TABLE` 3 bảng (em soạn SQL khi cần). Migration đã áp không cần hoàn tác để deploy tiếp.

---

## 9. Việc kế tiếp của giai đoạn 1 (sau khi so khớp prod đạt)

Chuyển từng nơi đọc sang sổ, mỗi nơi một commit, giữ đường cũ sau công tắc env trong 1 tuần:

1. ✅ **30/09 13:20** `/api/finance/analytics` (Báo cáo dòng tiền) — nơi xuất phát sự cố. Cách làm:
   - `lib/cash-flow-totals.ts`: bộ tổng `CashFlowTotals` (đếm + Σ cột theo 6 nhóm + ba bảng bóc giá vốn theo sàn / GMV Max theo gian / doanh thu-giá vốn theo ngày) với HAI nguồn: `cashFlowTotalsFromRows(pnlRows)` (đường cũ, logic nguyên văn) và `cashFlowTotalsFromLedger(ledgerSummary, ledgerCashFlowBreakdown)` (SUM trong database). `computeGrossDeductions` dời sang đây, thêm `computeGrossDeductionsFromTotals` (thác nước từ Σ, không cần dòng); finance.ts re-export.
   - `services/order-ledger.ts`: `ledgerCashFlowBreakdown` = 3 câu GROUP BY (channelName / channelId với feeGmvMax ≠ 0 / createdDate từ mốc 14 ngày) trên nhóm active, cùng `formulaVersion` với `ledgerSummary`.
   - Route: `loadCashFlowTotals(source, scope, range)` — `ledger`: `ensureLedgerFresh(maxInline 500)` → `ledgerSummary` + breakdown; `orders`: `fetchPnlRows` như cũ. Phần còn lại của handler (chi phí nhập tay, AdSpend, thuế, thác nước, series 14 ngày, JSON) chỉ đọc từ bộ tổng — không đổi công thức nào.
   - **Công tắc:** mặc định `ledger`; env `CASH_FLOW_SOURCE=orders` lui về đường cũ (giữ 1 tuần, tới ~07/10); `?source=orders|ledger` trên request thắng env — dùng để so hai đường trên prod. Trả thêm `source` và `ledgerPending` (đơn trong kỳ còn bẩn sau khi tính nốt 500); FE hiện dải xanh "N đơn vừa thay đổi đang được cập nhật" (`LedgerPendingNotice`), `truncated` chỉ còn ý nghĩa ở đường cũ.
   - Test: `lib/__tests__/cash-flow-totals.test.ts` (9 đơn phủ đủ nhóm: hai đường bằng nhau từng cột, thác nước đóng, chọn nguồn) + `integrations/__tests__/cash-flow-ledger-db.test.ts` (DB dev: mọi chủ shop, cả kỳ + 60 ngày, sổ = đơn, tự bỏ qua khi chưa có bảng). Cả hai qua 30/09 13:18.
   - **Đã so trên PROD 30/09 13:30** (commit `ebeb553`, tài khoản Chủ Shop Hubsell 12.239 đơn, gọi `?source=ledger` và `?source=orders` rồi so MỌI trường JSON trừ source/ledgerPending/truncated/hint): tháng 8 (2.052 đơn), tháng 9 (1.902), toàn kỳ (12.239), lọc 3 sàn, lọc 5 gian — **0 lệch ở mọi trường**, ledgerPending 0. Thời gian: sổ 230–555 ms so với đường cũ 1,2–2 s (một tháng) và **9,8 s** (toàn kỳ 12k đơn) → đúng chỗ sự cố 29/09 nay còn 0,5 s.
2. ✅ **30/09 14:00** `/api/analytics` (Tổng quan). Cùng cách với mục 1:
   - `lib/overview-totals.ts`: bộ tổng `OverviewTotals` của nhóm ĐƠN TÍNH DOANH THU (đếm, số món, Σ 12 cột, sàn khấu trừ, thiếu giá vốn) + bóc theo GIAN (số đơn, doanh thu, Σ feeGmvMax) + theo NGÀY (số đơn, doanh thu, giá vốn, sàn khấu trừ); hai nguồn `overviewTotalsFromRows` / `overviewTotalsFromLedger`. `lib/report-source.ts`: `resolveReportSource(query, env)` dùng chung.
   - `services/order-ledger.ts`: `ledgerOverviewBreakdown` = 2 câu GROUP BY (channelId; createdDate từ mốc đầu trục biểu đồ).
   - Route: `loadOverviewTotals(source, scope, range, { byDaySince, summaryOnly, fresh })` gọi 3 lần như cũ — kỳ hiện tại (làm tươi một lần cho cả khoảng kỳ trước + trend + hiện tại), cửa sổ trend 14 ngày (chỉ khi kỳ < 14 ngày), kỳ trước (`summaryOnly`). Số đơn theo ngày lấy luôn từ bộ tổng (cùng định nghĩa `countsAsRevenue` với câu đếm cũ) nên bỏ `countOrdersByDay`. Phễu trạng thái, chi phí nhập tay, AdSpend giữ nguyên.
   - **Công tắc:** env `OVERVIEW_SOURCE=orders` lui đường cũ (giữ tới ~07/10); `?source=orders|ledger`; trả `source` + `ledgerPending`, FE dải xanh như Báo cáo dòng tiền.
   - Test: `lib/__tests__/overview-totals.test.ts` (dùng chung `ledger-order-fixture.ts`) + `integrations/__tests__/overview-ledger-db.test.ts` (DB dev: mọi chủ shop × cả kỳ / 60 ngày / 7 ngày). Cả bộ 830 test qua 30/09 13:53.
   - **Đã so trên PROD 30/09 14:00** (commit `af7ffd5`, tài khoản Chủ Shop Hubsell, so MỌI trường JSON của `?source=ledger` với `?source=orders`, gồm chuỗi ngày, trend, theo gian, kỳ trước): hôm nay, hôm qua, 7 ngày, tháng 9, tháng 8, quý 3 (6.229 đơn), toàn kỳ (12.242 đơn), lọc sàn Shopee/TikTok, lọc 4 gian — **13/13 trường hợp 0 lệch**, ledgerPending 0. Thời gian: sổ 0,3–0,56 s so với đường cũ 1,3–3,7 s (ngày/tháng), 8,9 s (quý), 9,3 s (toàn kỳ). Lợi nhuận tháng 8 trên Tổng quan = 32.978.902 = Báo cáo dòng tiền.
3. ✅ **30/09 14:25** `/api/finance/realized-pnl` (Lãi/Lỗ thực hiện). Trước đó MỖI trang của bảng (và mỗi trang 100 dòng của xuất Excel) đọc lại cả kỳ lên RAM rồi mới cắt 20 dòng.
   - **Danh sách:** `ledgerPnlList` lọc + sắp xếp (`createdAt DESC, orderId DESC` — cùng thứ tự đường cũ) + cắt trang TRÊN SỔ, chỉ trả mã của ≤ 100 đơn; route đọc đúng các đơn đó (`PNL_INCLUDE`) và dựng dòng chi tiết bằng `computePnlRow` → hình dạng JSON giữ nguyên, FE không sửa bảng. Dòng trên trang tính trực tiếp từ đơn, tổng lấy từ sổ (anh Trung đồng ý 30/09).
   - **Tổng kết:** `ledgerPnlSummary` = 3 câu cộng trong database (tổng / theo sàn / theo ngày từ đầu trục biểu đồ) với ĐÚNG điều kiện lọc của bảng (`LedgerPnlFilter`: trạng thái giao, Hoàn/Trả = `returnType IS NOT NULL`, Lợi nhuận âm = `isLoss`, tìm mã đơn = `orderCode ILIKE '%…%'` đã thoát `% _ \`). Bộ tổng `PnlSummaryTotals` ở `lib/realized-pnl-totals.ts`, hai nguồn như các mục trên; `summarizePnlRows` cũ giữ nguyên làm mốc test.
   - **Theo mô hình SHOP LỚN ngay (anh Trung chốt 30/09: "làm theo mô hình shop lớn luôn sau đỡ phải sửa")** — migration `20260930240000_order_ledger_list_indexes`: (a) extension `pg_trgm` (Supabase: schema `extensions`; đã kiểm prod có sẵn 1.6, PG 17.6) + chỉ mục GIN trigram `order_ledger_orderCode_trgm_idx` cho tìm mã đơn kiểu chứa chuỗi (mẫu ≥ 3 ký tự); (b) chỉ mục `order_ledger_ownerId_createdAt_idx (ownerId, createdAt DESC, orderId DESC)` → trang đầu là Merge Append các lượt đọc chỉ mục có LIMIT, không sắp xếp cả kỳ; (c) đọc theo CON TRỎ `?cursor=<createdAt>|<orderId>` + `rowsOnly=1` cho xuất Excel (`fetchRealizedPnlRows` trong FE) — lượt nào cũng rẻ như lượt đầu, không tính lại tổng kết. Lật trang trên giao diện vẫn dùng OFFSET (người dùng thấy số trang). EXPLAIN trên DB dev xác nhận cả ba dạng câu lệnh dùng đúng chỉ mục (Bitmap Index Scan trigram; Index Scan + Merge Append; `ROW(createdAt, orderId) <` nằm trong Index Cond). Migration chỉ khóa SHARE bảng sổ (không đụng `Order`), có thử lại, idempotent.
   - `ensureLedgerFresh` ĐẾM TRƯỚC: sổ sạch thì trả về sau một câu đếm, không chạy câu nhặt việc ở mỗi lượt xem báo cáo (áp cho cả Dòng tiền, Tổng quan).
   - **Công tắc:** env `REALIZED_PNL_SOURCE=orders` lui đường cũ (giữ tới ~07/10); `?source=orders|ledger`; trả `source`, `ledgerPending`, `nextCursor`.
   - Test: `lib/__tests__/realized-pnl-totals.test.ts` (bộ tổng = `summarizePnlRows` cũ; 9 bộ lọc: dòng sổ và dòng computePnlRow chọn cùng tập, cộng cùng số; con trỏ; thoát LIKE) + `integrations/__tests__/realized-pnl-ledger-db.test.ts` (DB dev: mọi chủ shop × 8 bộ lọc × 2 trang: cùng danh sách đúng thứ tự, cùng tổng kết; đi hết con trỏ = đủ, không trùng, đúng thứ tự; hai chỉ mục tồn tại). Cả bộ 845 test qua 30/09 14:17.
   - **Đã lên PROD + so hai đường 30/09 14:30** (commit `2d9d4be`): migration áp xong (`_prisma_migrations` finished, không rollback), `pg_trgm` nằm ở schema `extensions`, chỉ mục trigram và chỉ mục danh sách có trên đủ 12/12 (bảng cha + các mảnh). So MỌI trường JSON (kể cả từng dòng chi tiết của trang) giữa `?source=ledger` và `?source=orders`, tài khoản Chủ Shop Hubsell 15.410 đơn: hôm nay; tháng 9 trang 1 / trang 5×100; tháng 8 trang cuối; lọc Đã giao / Đang giao / Đã hủy / Hoàn-Trả / Lợi nhuận âm; quý 3 lỗ + đã giao trang 2; quý 3; toàn kỳ trang 1 / trang 100; lọc sàn TikTok; tìm đoạn giữa mã đơn; tìm cả mã; tìm không có — **17/17 trường hợp 0 lệch**. Thời gian khi máy đã ấm: một trang 0,15–0,3 s (trang 100 dòng ~0,9 s) so với đường cũ 1–5,6 s (tháng), 9,4 s (quý), 14–18 s (toàn kỳ); tìm mã đơn 0,21–0,28 s so với 5–9 s. Xuất Excel theo con trỏ tháng 9: 2.442 dòng = 25 lượt, 7,5 s tổng, lượt đầu 285 ms, lượt cuối 260 ms, đủ và không trùng. Lưu ý: hai lượt gọi ĐẦU TIÊN ngay sau deploy mất 3,8–4,6 s (máy chủ vừa khởi động, kết nối và bộ đệm còn nguội) rồi về mức trên.
4. ✅ **30/09 14:45** Thuế — hai nơi cộng từ đơn của module Hóa đơn & Thuế:
   - **`/api/tax/report`** (đối soát thuế kỳ, theo ngày TẠO đơn): `ledgerTaxReportTotals` = MỘT câu SELECT trên các đơn KHÔNG HỦY (số đơn, đã quyết toán, doanh thu gốc, lợi nhuận của đơn có giá vốn, thuế sàn đã trích, doanh thu thực tế của đơn chưa quyết toán, đơn thiếu giá vốn). Lưu ý nhóm của thuế là "không hủy" (đơn đang hoàn VẪN vào) — khác nhóm "tính doanh thu" của Tổng quan/Dòng tiền, nên không dùng `ledgerSummary`. Phần hóa đơn điện tử (InvoiceLog, đối chiếu sót) giữ nguyên.
   - **`/api/tax/declaration`** (số liệu kê khai theo sàn + lũy kế năm): `ledgerDeclarationByChannel` = MỘT câu GROUP BY theo sàn, áp đúng cơ sở cắt kỳ `declarationBasis()`: theo NGÀY SÀN BÁO GIAO (prod, `TAX_DECLARATION_BY_DELIVERED=1`) = đơn Đã giao có `deliveredAt` trong kỳ UNION ALL đơn Đã giao chưa có mốc giao mà ngày tạo trong kỳ (đếm `missingDeliveredAt`); theo ngày tạo = mọi đơn không hủy. Doanh thu tính thuế = `Σ GREATEST(0, revenueGross − sellerVoucher − refundedAmount)` TỪNG ĐƠN — đúng phép kẹp của `aggregateDeclaration`. `declarationRowsFromLedger` dùng chung thứ tự sàn + cách làm tròn. Lũy kế năm gọi cùng hàm cho toàn shop. Trigger sổ có theo dõi `deliveredAt`/`shippingStatus`/`isSettled` nên trục ngày giao trên sổ luôn theo đơn.
   - **Theo mô hình SHOP LỚN** — migration `20260930250000_order_ledger_tax_indexes`: (a) `order_ledger_ownerId_deliveredDate_idx (ownerId, deliveredDate)` — sổ phân mảnh theo ngày TẠO nên truy vấn theo ngày giao toàn shop phải có lối vào riêng ở mỗi mảnh (EXPLAIN DB dev: Index Cond đủ `ownerId` + khoảng `deliveredDate`); (b) `order_ledger_formulaVersion_idx` + viết lại `ledgerFreshness` thành HAI câu đếm (dòng bẩn qua chỉ mục cục bộ; dòng công thức cũ qua `formulaVersion < v OR > v`) → kiểm "sổ sạch chưa" ở mỗi lượt xem báo cáo không còn quét cả phạm vi. Tờ khai làm tươi TOÀN SHOP trước khi cộng (đơn của kỳ có thể tạo từ kỳ trước), còn dư → `ledgerPending`, thẻ Số liệu kê khai hiện dòng nhắc "tải lại trước khi dùng số này để kê khai".
   - **Công tắc:** env `TAX_SOURCE=orders` lui đường cũ cho cả hai nơi (giữ tới ~07/10); `?source=orders|ledger`.
   - Test: `lib/__tests__/tax-totals.test.ts` (đối soát kỳ: sổ = dòng = vòng cộng cũ; bảng kê khai: Σ thô kiểu SQL → cùng bảng với `aggregateDeclaration`, kẹp ≥ 0 từng đơn) + `integrations/__tests__/tax-ledger-db.test.ts` (DB dev: mọi chủ shop; đối soát 3 kỳ; kê khai CẢ HAI cơ sở × 4 quý + năm nay + năm trước, so từng sàn, tổng, tách GTGT/TNCN, lũy kế năm, bậc ngưỡng). Cả bộ 855 test qua 30/09 14:37.
   - **Đã lên PROD + so hai đường 30/09 14:45** (commit `65301d4`, tài khoản Chủ Shop Hubsell, prod đang cắt kỳ theo ngày giao — `basis: "delivered"`; so MỌI trường JSON trừ source/ledgerPending/truncated/daysLeft và danh sách nhật ký hóa đơn): kê khai quý 1–4/2026, cả năm 2026, cả năm 2025, quý 3 lọc sàn Shopee; đối soát tháng 9, tháng 8, quý 3, toàn kỳ, tháng 9 lọc TikTok — **12/12 trường hợp 0 lệch**, ledgerPending 0, missingDeliveredAt 0. Thời gian: kê khai 0,23–0,42 s so với đường cũ 7,8–12,1 s; đối soát 0,29–0,44 s so với 0,9–9,5 s. Số quý 3/2026 lúc 14:45: 6.411 đơn đã giao, doanh thu tính thuế 1.469.855.907, sàn đã khấu trừ 21.825.307; lũy kế năm 2.711.973.602 (hai đường giống nhau; số tăng dần tới hết kỳ vì đơn tiếp tục được sàn báo giao).
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

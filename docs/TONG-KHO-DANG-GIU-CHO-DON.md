# Tổng kho: cột "Chờ giao" cho đơn đã trừ kho nhưng chưa giao ship — thiết kế (11/11/2026, bản 2 sau khi rà lại)

> Khách xin: cột "Có thể bán" phải là "giữ lại", ví dụ đơn đang ra 10 con thì hiện 10 con bị giữ.
> Khảo sát đối thủ + lý do ở [QUAN-LY-KHO-TAI-CAU-TRUC.md](QUAN-LY-KHO-TAI-CAU-TRUC.md) mục 11.
> Trạng thái: **anh CHỐT BẢN 2 tối 11/11** ("Chốt bản 2"). Đang làm lát 1 + 2 trên local.
> **Bản 2 ĐẢO ba lựa chọn của bản 1** (anh đã "Chốt theo em" ở bản 1, sau đó hỏi "có cần khảo sát lại cho chắc không"). Lý do ở mục 2. Câu chờ anh chốt lại ở mục 10.

## 1. Hiện trạng (đọc mã 11/11)

| Việc | Ở đâu | Hành vi |
|---|---|---|
| Đơn chưa thanh toán | `shouldHoldShopeeStock`, `lazadaShouldHoldStock` → `holdStockTx` | Cộng `Product.holdQuantity`, KHÔNG trừ `quantityInStock`. TikTok UNPAID không giữ. |
| Đơn đã chốt (Chờ lấy hàng trở đi) | `shouldDeductShopeeStock`, `shouldDeductStock` (TikTok), `lazadaShouldDeductStock` → `deductStockTx` | Nhả giữ, trừ THẲNG `quantityInStock` + số ở vị trí (`applyStockDelta`, ghi `InventoryLog` có `orderId` + `locationId`), mốc `stockDeductedAt`. Cho phép âm. |
| Đơn hủy (kể cả hủy SAU khi đã giao ship) | `restoreStockTx` | Cộng lại NGAY lúc sàn báo hủy, đúng vị trí đã trừ, mốc `stockRestoredAt`. |
| Số đẩy lên sàn | `availableToPush` | `max(0, quantityInStock − holdQuantity − safetyStock)`. |
| Kiểm kê | `POST /inventory/stocktake` | Ghi đè sổ = số đếm (toàn kho hoặc theo vị trí). |

`holdQuantity` gần như luôn 0 (COD không qua UNPAID) nên "Có thể bán" ≈ "Tồn kho". Hàng của đơn đã chốt chưa giao vẫn nằm trong kho nhưng không hiện ở đâu.

## 2. Rà lại 11/11 — sáu phát hiện

Cách rà: đọc mọi chỗ ghi nhật ký kho gắn đơn, mọi tệp đọc `quantityInStock` (16 tệp web, 2 tệp mobile, 23 tệp backend), luồng gian mất kết nối / ngủ đông, rồi chạy thử câu SQL trên DB local.

1. **"Tồn kho" của Hubsell vốn KHÔNG phải số hàng trong kho, và cộng thêm chờ giao cũng không thành số trong kho.** Có ba khoảng lệch, bản 1 chỉ thấy một:
   - hàng đơn chờ giao: đã trừ sổ, còn trong kho (cái khách hỏi);
   - hàng ở **ô "không bán"** (chờ kiểm, lỗi): có trong kho, không nằm trong sổ. Giao diện đang gọi sổ là "tồn bán" (`stock-levels-cell.tsx`, `stock-transfer-dialog.tsx`);
   - **đơn hủy sau khi đã giao ship**: `restoreStockTx` cộng lại sổ ngay lúc sàn báo hủy, trong khi kiện còn đang quay về. Sổ có, kho chưa có.
   → Bản 1 định đổi cột Tồn kho thành "số trong kho = sổ + chờ giao" là hứa một con số mình không tính đúng được.
2. **Số sổ đang được đọc ở rất nhiều màn.** Nhật ký kho ("tồn sau" từng dòng), phiếu nhập / xuất (tồn → tồn mới), chuyển vị trí, cột Vị trí (tổng các vị trí = sổ), hộp đồng bộ so với số trên sàn, Excel xuất / nhập, Giá trị tồn, in tem, app mobile. Đổi nghĩa MỘT cột ở Tổng kho thì nó lệch với tất cả các màn kia. Ví dụ: Nhật ký ghi "trừ đơn X: 35 → 34" mà cột vẫn hiện 44.
3. **Đơn kẹt làm số chờ giao phình mãi.** Gian DISCONNECTED hoặc ngủ đông thì webhook bị bỏ qua (`webhook-queue.ts`), đơn đứng im ở PENDING / PROCESSED. DB local có đúng ca này: 26 đơn đã trừ kho, còn PENDING, tuổi ≥ 30 ngày, trên gian DISCONNECTED. Nếu số này được cộng vào Tồn kho, hoặc Kiểm kê lặng lẽ trừ nó, thì sai số đi thẳng vào sổ.
4. **Chỗ ghi nhật ký gắn đơn đúng như giả định.** Dòng trừ có `orderId` chỉ sinh từ `deductStockTx` (3 sàn) và route đơn thử `POST /webhooks/mock-order` (chỉ gian chưa nối sàn, không đánh `stockDeductedAt` → không vào tập chờ giao, chấp nhận). Xuất mẫu KOC không gắn `orderId`. Hủy tay và nhập hàng hoàn chỉ ghi dòng DƯƠNG và đơn đã CANCELLED / DELIVERED nên không dính. Đơn kênh offline không bao giờ có `stockDeductedAt`.
5. **Câu SQL chạy được ở cỡ shop lớn, với điều kiện có chỉ mục mới.** Dữ liệu giả trên local (1 shop, 400.000 đơn, 8.000 đơn chờ giao, 600.000 dòng nhật ký, mã bán chạy nhất 47.225 dòng), hỏi 100 mã bán chạy nhất, chạy trong giao dịch rồi hủy:

   | Cách | Thời gian | Trang đĩa phải đọc |
   |---|---|---|
   | Có chỉ mục bán phần mới | 65 ms | ~160 |
   | Không có chỉ mục | 204 ms | 9.294 |

   Planner tự đi từ tập đơn chờ giao sang nhật ký theo `orderId`; ép bằng CTE cho kết quả như nhau (63 ms). Mỗi lượt vẫn chạm ~36.000 trang trong bộ nhớ đệm, nên nên giữ kết quả theo chủ shop ~30 giây. Đây là máy local, chưa phải Supabase.
6. **DB local không có đơn chờ giao nào kèm nhật ký trừ** (dữ liệu seed), nên phần cộng theo vị trí mới kiểm trên dữ liệu giả, chưa trên đơn thật.

**Chưa kiểm (cần số prod):** có bao nhiêu đơn đã trừ kho đang kẹt PENDING / PROCESSED theo tuổi và theo trạng thái gian; bao nhiêu shop dùng ô "không bán"; bao nhiêu đơn hủy sau giao đã cộng sổ mà kiện chưa về.

## 3. Thiết kế bản 2 — chỉ THÊM, không đổi nghĩa số nào

| Số hiển thị | Công thức | Đổi gì |
|---|---|---|
| **Tồn kho** | `quantityInStock` | KHÔNG đổi |
| **Có thể bán** | `max(0, quantityInStock − holdQuantity − safetyStock)` | KHÔNG đổi |
| **Chờ giao** (cột mới) | số đã trừ sổ của đơn đã chốt, chưa giao ship, chưa hủy, thuộc gian đang hoạt động | MỚI, chỉ đọc |

- Ví dụ của khách: **Tồn kho 34 · Có thể bán 34 · Chờ giao 10**. Tooltip: "10 con của 7 đơn chưa giao cho ship. Đã trừ khỏi Tồn kho, hàng vẫn còn trong kho."
- **Đặt tên "Chờ giao", không dùng "Đang giữ".** Ở Sapo, "đang giữ" nằm TRONG Tồn kho; ở Hubsell nó đã bị trừ ra. Gọi là "giữ" thì khách quen Sapo sẽ lấy 34 − 10 = 24. Cột đặt SAU Có thể bán để không nằm giữa phép trừ.
- Đơn chưa thanh toán (`holdQuantity`) vẫn hiện như hiện nay trong tooltip Có thể bán ("giữ N"), không gộp vào Chờ giao vì hai số có quan hệ khác nhau với Tồn kho.
- ~~Bấm số Chờ giao → hộp danh sách đơn~~ **ĐÃ BỎ 11/11** (anh: "kích vào hiện lên mã đơn có thực sự cần thiết không… khách có 1.000 đơn thì cũng mệt" → "Bỏ hộp đi"). Số chỉ để xem, rê chuột hiện "N sản phẩm của M đơn đã chốt, chưa giao…". Muốn xem đơn thì sang trang Đơn hàng. ⛔ Đừng đề xuất lại hộp này.
- Bán vượt: Tồn kho âm vẫn hiện như cũ; Chờ giao cho biết đang nợ đơn nào.
- Không đổi: thời điểm trừ / hoàn kho, số đẩy sàn, cảnh báo sắp hết, lọc "Hết hàng", Giá trị tồn, Nhật ký, phiếu kho, Excel, sửa tay ô Tồn kho, sửa số theo vị trí, app mobile.

## 4. Nguồn số "chờ giao": tính từ đơn, không thêm bộ đếm

Bộ đếm trên Product phải cộng / trừ ở mọi chỗ đổi `shippingStatus` (em đếm được hơn 10 chỗ ghi cột này: 3 sàn, quét bù, hủy tay, mẻ chuẩn bị hàng, giao thất bại, tài khoản demo…). Sót một chỗ là lệch vĩnh viễn. Tính từ đơn thì tự đúng theo trạng thái đang lưu.

```sql
WITH aw AS MATERIALIZED (
  SELECT o.id FROM "Order" o
  JOIN "Channel" c ON c.id = o."channelId" AND c."userId" = $owner
       AND c.status = 'ACTIVE' AND c."hibernatedAt" IS NULL
  WHERE o."shippingStatus" IN ('PENDING','PROCESSED')
    AND o."stockRestoredAt" IS NULL AND o."stockDeductedAt" IS NOT NULL)
SELECT il."productId", il."locationId", SUM(-il."changeQuantity")::int AS qty, COUNT(DISTINCT aw.id)::int AS orders
FROM aw JOIN "InventoryLog" il ON il."orderId" = aw.id AND il."changeQuantity" < 0
WHERE il."productId" = ANY($productIds)
GROUP BY 1, 2;
```

- Số lượng lấy từ nhật ký trừ (số ĐÃ trừ thật, có sẵn vị trí), không lấy từ dòng đơn.
- **Chỉ mục mới (bắt buộc):** `"Order_stock_awaiting_ship_idx" ON "Order"("channelId") WHERE "shippingStatus" IN ('PENDING','PROCESSED') AND "stockRestoredAt" IS NULL AND "stockDeductedAt" IS NOT NULL`.
- **Chỉ tính gian ACTIVE, không ngủ đông.** Đơn của gian mất kết nối không cập nhật được nữa, tính vào là sai.
- Không đặt mốc cắt theo tuổi đơn: em không có căn cứ cho con số nào. Hệ quả sau khi bỏ hộp danh sách: đơn kẹt lâu ở gian đang hoạt động vẫn nằm trong số Chờ giao mà Tổng kho không chỉ ra được — khách thấy nó ở trang Đơn hàng.
- Một hàm dùng chung `services/stock-awaiting-ship.ts`; giữ kết quả theo chủ shop ~30 giây (`lib/ttl-cache`).
- API: `GET /api/products?awaiting=1` thêm trường mới `awaitingShip` + `awaitingShipOrders` (dòng cha do web cộng các phân loại). Không đổi trường cũ.

## 5. Kiểm kê — chỗ DUY NHẤT đổi cách ghi

Đây là rủi ro thật thấy kèm: khách đếm cả kiện đã gói chưa giao, máy ghi đè sổ = số đếm → cộng lại hàng đã bán → đẩy lên sàn → bán vượt.

- Phiếu kiểm kê thêm cột **"Chờ giao"** cạnh cột Sổ (theo đúng vị trí đang kiểm, lấy từ `locationId` của nhật ký). Cột "Lệch" so số đếm với **Sổ + Chờ giao**.
- Chốt: sổ mới = đếm − chờ giao. Lý do nhật ký ghi đủ: "Kiểm kê 11/11: đếm 44, trừ 10 chờ giao → sổ 34".
- **Không lặng lẽ.** Dòng nào có chờ giao thì hiện rõ con số, bấm xem được đơn. Đầu phiếu có một công tắc "Số đếm gồm cả kiện đã gói chưa giao cho ship" (mặc định BẬT). Khách đã để riêng kiện chờ ship và không đếm thì tắt, khi đó máy làm như cũ.
- Body thêm `includesAwaiting: true`; thiếu trường này thì giữ nghĩa cũ. Tính chờ giao TRONG giao dịch chốt, sau khi khóa dòng Product (webhook trừ kho cũng khóa dòng này).
- Hai khoảng lệch còn lại (ô không bán, kiện hủy đang quay về) KHÔNG xử lý ở lát này. Ô không bán đã được kiểm kê riêng theo vị trí. Kiện đang quay về là lỗ có sẵn từ trước (ghi ở mục 9).
- Sửa tay ô Tồn kho, sửa số theo vị trí, nhập Excel: **giữ nguyên nghĩa** (số sổ). Chỉ thêm một dòng nhắc trong ô sửa khi mã đó có chờ giao: "Không tính 10 con chờ giao".

## 6. Ca biên

| Ca | Kết quả |
|---|---|
| Đơn COD về (READY_TO_SHIP) | Tồn kho −1, Có thể bán −1, Chờ giao +1 |
| Shipper lấy kiện (SHIPPED / IN_TRANSIT / shipping) | Chờ giao −1, hai số kia đứng yên |
| Hủy trước khi giao | Chờ giao −1, Tồn kho +1, Có thể bán +1 |
| Khách xin hủy (IN_CANCEL) | vẫn Chờ giao tới khi sàn chốt |
| TikTok PARTIALLY_SHIPPING | cả đơn vẫn tính Chờ giao (sổ không ghi theo kiện); ca hiếm, ghi ở tooltip đơn |
| Gian mất kết nối / ngủ đông | đơn của gian đó không tính; nối lại thì tính lại sau khi quét bù |
| Đơn kẹt do lỡ webhook ở gian đang hoạt động | vẫn tính; Tổng kho không chỉ ra được, khách xem ở trang Đơn hàng |
| Đơn kênh offline, đơn thử | không bao giờ vào Chờ giao (đã kiểm mã) |
| Dòng đơn chưa nối SKU | không có nhật ký trừ → không tính |
| Nhật ký cũ không có `locationId` | tính vào Kho chính, giống `restoreStockTx` |
| Kiểm kê kéo dài, có kiện được lấy giữa chừng | lệch dư đúng số kiện đó; nhắc "chốt ngay sau khi đếm" |

## 7. Lát làm + kiểm

0. **Số prod (chỉ đọc):** trước khi có chỉ mục chỉ dùng `pg_stats` + `EXPLAIN` (không quét bảng). Sau khi có chỉ mục: đếm đơn chờ giao theo tuổi, theo trạng thái gian, shop lớn nhất.
1. **Backend đọc:** migration chỉ mục (tạo `CONCURRENTLY`, ngoài giờ cao điểm — Supabase từng cạn Disk IO), `stock-awaiting-ship.ts`, trường mới, endpoint danh sách đơn. Test DB cho 11 ca mục 6, có vị trí.
2. **Web Tổng kho:** cột + hộp đơn + Excel thêm cột "Chờ giao". Đo 1280 → 1920, không cuộn ngang ở ≤ 1440, sáng + tối, seed ca rộng nhất. Không đủ chỗ ở 1280 thì thành dòng nhỏ dưới Có thể bán.
3. **Kiểm kê:** cột Chờ giao, công tắc, chốt có trừ; test giao dịch chen với webhook trừ kho; chạy thật trên local với đơn chờ giao ở 2 vị trí.
4. **Mobile (OTA):** hiện Chờ giao ở màn Tồn kho.

Lát 1 + 2 chỉ thêm, không đổi số nào → lên trước, độc lập. Lát 3 đi sau, không còn ràng buộc "phải lên cùng lúc" như bản 1.

## 8. So với bản 1

| | Bản 1 | Bản 2 |
|---|---|---|
| Cột Tồn kho | đổi thành sổ + chờ giao | giữ nguyên |
| Tên cột mới | Đang giữ (gồm cả đơn chưa thanh toán) | Chờ giao (chỉ đơn đã trừ kho) |
| Sửa tay, sửa vị trí, Excel | đổi sang nhận số trong kho | giữ nguyên |
| Kiểm kê | lặng lẽ trừ | hiện rõ + công tắc |
| Mobile | lệch web tới khi ra OTA | không lệch |
| Số màn bị đổi nghĩa | Tổng kho + 4 cửa ghi | 0 màn đổi nghĩa, 1 màn (Kiểm kê) thêm bước |

## 9. Không làm / ghi nhận

- Không đổi thời điểm trừ kho, không đổi số đẩy sàn, không thêm bộ đếm trên Product.
- Không tách "Đang đóng gói" thành cột riêng như Sapo.
- **Lỗ có sẵn, ngoài phạm vi:** đơn hủy sau giao được cộng sổ ngay khi kiện còn trên đường về. Nếu khách kiểm kê lúc đó, sổ bị hạ xuống; khi kiện về, mốc `stockRestoredAt` đã có nên không cộng lại → thiếu hàng trên sổ. Chưa đo mức độ trên prod.

## 10. Chờ anh chốt lại

1. Theo bản 2: **giữ nguyên Tồn kho, thêm cột "Chờ giao"** (em chọn sau khi rà), hay vẫn muốn Tồn kho = số trong kho như Sapo (bản 1)?
2. Kiểm kê: công tắc "số đếm gồm cả kiện đã gói chưa giao" mặc định **BẬT** (em chọn) hay TẮT?
3. Em đọc số prod cho lát 0 (chỉ `pg_stats` + `EXPLAIN`, không quét bảng) trước khi code?

## 11. ĐÃ LÀM lát 1 + 2 trên local (11/11/2026 tối) — CHƯA commit, chưa push

**Backend**
- Migration `20261111230000_order_stock_awaiting_ship_idx` (chỉ mục bán phần, có khối lấy khóa thử lại). DB local áp bằng `prisma db execute --file` (lệnh `migrate deploy` ở local vướng một migration cũ ghi FAILED từ 17/09, không liên quan).
- `backend/src/services/stock-awaiting-ship.ts`: `awaitingShipByProduct` (số theo mã cho một trang).
- `GET /api/products?awaiting=1` trả thêm `awaitingShip` + `awaitingShipOrders` cho từng mã. **Phải xin mới có** — ô chọn mã, app mobile gọi danh sách này không tốn thêm câu SQL.
- **Lệch so với mục 4:** CHƯA thêm bộ nhớ đệm 30 giây. Số đo local 65 ms mỗi lượt là chấp nhận được; có số prod rồi mới quyết, đỡ một lớp có thể trả số cũ.
- Test `integrations/__tests__/stock-awaiting-ship.test.ts` 8 ca (9 ca trước khi bỏ hộp) trên DB thật qua đúng `deductStockTx` / `holdStockTx` / `restoreStockTx`: chờ xử lý + đã xử lý, đang giao / đã giao, hủy trước giao, đơn chưa thanh toán, đơn có mốc nhưng không có nhật ký, gian mất kết nối + ngủ đông, chủ shop khác, đơn trừ rải hai vị trí.

**Web**
- `frontend/src/components/products/awaiting-ship.tsx`: số (cột / dòng nhỏ), chú thích rê chuột, ngưỡng hiện / ẩn `AWAITING_SHIP_SHOW`.
- `app/products/page.tsx`: cột "Chờ giao" sau "Có thể bán" (cố định 4.75rem), dòng cha cộng tổng các phân loại; Excel xuất thêm cột "Chờ giao" (nhập lại thì cột này bị bỏ qua).
- **Cột co theo khung bảng** như cột Giá trị tồn. Khung hẹp thì cột ẩn, số thành dòng nhỏ dưới Có thể bán. Dòng nhỏ là **biểu tượng xe tải + số**, không viết chữ: "chờ giao 9.998" cần 70px trong khi cột Có thể bán chỉ 75px (đo thấy tràn ở 1280, đã sửa).

**Đo local** (đủ cột, seed ca rộng: khoảng giá min–max, giá 7 chữ số, tên 100 ký tự, số 9.998 và 10.022, tồn âm; sáng với tài khoản không vị trí, tối với tài khoản có vị trí):

| Màn | Không dùng vị trí | Có dùng vị trí |
|---|---|---|
| 1280 | dòng nhỏ; bảng cuộn 57px trong khung (có sẵn từ trước) | dòng nhỏ; cuộn 97px (có sẵn) |
| 1366 | dòng nhỏ, không cuộn | dòng nhỏ, cuộn 11px (có sẵn) |
| 1440 | dòng nhỏ, không cuộn | dòng nhỏ, không cuộn |
| 1536 | CỘT, không cuộn | dòng nhỏ, không cuộn |
| 1700 | CỘT | CỘT |
| 1920 | CỘT | CỘT |

Không ô nào của cột mới / dòng nhỏ tràn ở mọi cỡ. **Thấy kèm, có từ trước, CHƯA sửa:** tài khoản có vị trí ở 1280 và 1366, ô giá "1.250.000 ₫" tràn 3px (cột tiền 94px, cần 97px) — cột Chờ giao đang ẩn ở hai cỡ này nên không phải do nó.

**Nhân viên kho (không thấy giá vốn), tài khoản có vị trí — soi thêm trước khi push:** 1280 / 1366 / 1440 dòng nhỏ, 1536 cột riêng, không ô nào tràn. (Tài khoản nhân viên KHÔNG dùng vị trí chưa soi riêng.)

**Chưa kiểm:** tải thử tệp Excel; app mobile.

**Chỉ mục trên prod: ĐÃ DỰNG 11/11/2026 23:19** (anh chọn "Em chạy qua Chrome") bằng `CREATE INDEX CONCURRENTLY` ở Supabase SQL Editor, trước khi push. Kiểm sau khi dựng: `indisvalid = true`, `indisready = true`, cỡ 80 kB. Bảng "Order" lúc đó ~884.000 dòng, 503 MB. Migration trong repo dùng IF NOT EXISTS nên ở prod bỏ qua.

**Số prod lúc 23:20 11/11** (đếm qua chỉ mục mới, EXPLAIN xác nhận Index Scan):

| Gian | Đơn đã trừ kho chưa giao | Quá 7 ngày | Quá 30 ngày | Số chủ shop | Có tính vào Chờ giao |
|---|---|---|---|---|---|
| Đang hoạt động | 3.680 | 0 | 0 | 62 | CÓ |
| Đang hoạt động nhưng ngủ đông | 3.479 | 245 | 0 | 51 | không |
| Mất kết nối | 416 | 87 | 1 | 9 | không |
| Mất kết nối + ngủ đông | 225 | 33 | 3 | 3 | không |

Đọc số: (1) ở gian đang hoạt động KHÔNG có đơn nào kẹt quá 7 ngày → nỗi lo "đơn kẹt làm phình số" hiện chưa xảy ra với phần được tính; (2) phần bị loại (gian ngủ đông + mất kết nối) là 4.120 đơn, nhiều hơn cả phần được tính → luật "chỉ gian đang hoạt động, không ngủ đông" là cần thật; (3) cả nền tảng mới 3.680 đơn trong tập → câu hỏi mỗi trang rất nhẹ, chưa cần bộ nhớ đệm. Chưa đo: shop lớn nhất có bao nhiêu đơn trong tập; thời gian chạy thật của câu theo trang.

**Dọn local: ĐÃ DỌN** trước khi commit — xóa 2 tài khoản thử + 2 nhân viên thử, xóa các tệp seed tạm.

**✅ ĐÃ BỎ hộp danh sách đơn (11/11, anh: "Bỏ hộp đi"):** gỡ `awaitingShipOrdersOf`, endpoint `GET /products/:id/awaiting-orders`, kiểu + hàm gọi trong `lib/api.ts`, phần hộp trong `awaiting-ship.tsx` (tệp còn ~90 dòng, không còn "use client"), 1 ca test + 1 đoạn kiểm trong ca gian mất kết nối. Sau khi gỡ: tsc hai phía + eslint frontend sạch, test 8/8, soi lại local 1622 (cột) + 1440 (dòng nhỏ): số không còn bấm được, không ô nào tràn.

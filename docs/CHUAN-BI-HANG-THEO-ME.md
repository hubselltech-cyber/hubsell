# Chuẩn bị hàng theo mẻ + chạy nền (14/10/2026)

Anh Trung: "chuẩn bị đơn của mình hơi chậm, trên Shopee hay TikTok rất nhanh". Gốc: Hubsell gọi sàn **từng đơn** (Shopee 3 lượt + nghỉ 0,3 s mỗi đơn, tải PDF từng đơn) trong **một request đồng bộ** (mẻ 58 đơn 09/09 kéo 1,5–3 phút, bị cắt giữa chừng). Seller Center dùng API mẻ. Nay Hubsell dùng đúng các API đó.

## 1. Trần một mẻ của sàn (đọc tài liệu chính thức 14/10/2026)

| Sàn | API | Trần | Ràng buộc |
|---|---|---|---|
| Shopee | `get_mass_shipping_parameter` / `mass_ship_order` / `get_mass_tracking_number` | 50 kiện | đi theo `package_number`; cùng `product_location_id` (kho) + cùng `logistics_channel_id` (kênh VC do người mua chọn). New API 24/02/2025 |
| Shopee | `create_shipping_document` / `download_shipping_document` | 50 đơn | download: cùng hãng → MỘT PDF |
| Shopee | `batch_ship_order` | — | **CHỈ Brazil** (channel 90003), không dùng |
| Shopee | `create_shipping_document_job` | 600 | chỉ `THERMAL_UNPACKAGED_LABEL`, không phải vận đơn thường |
| TikTok | `POST /fulfillment/202309/packages/ship` body `packages[]` | không ghi | code 0 vẫn có `data.errors[].detail.package_id`; Hubsell cắt 50/lượt |
| TikTok | `GET /order/202309/orders?ids=` | 50 đơn | có `tracking_number` + `shipping_provider` |
| TikTok | `GET /packages/{id}/shipping_documents` | từng kiện | không có bản mẻ → tải song song 4 |
| Lazada | `/order/fulfill/pack`, `/order/package/rts`, `/order/package/document/get` | không công bố | có mã lỗi 700022 BATCH_SIZE_OUT_OF_LIMIT; giữ đường từng đơn |

## 2. Luồng mới

```
POST /api/orders/bulk/confirm  → kiểm đơn
     15/10: hỏi fulfillment_batches RUNNING của chủ shop còn sống (updatedAt < 3 phút = STALE_MS)
            đơn đang nằm trong orderIds của lượt đó → bỏ qua "Đang được sắp xếp ở lượt trước — đợi lượt đó xong"
            MỌI đơn sẵn sàng đều ở đúng MỘT lượt → 202 {batchId: lượt cũ, total, skipped, reattached: true}, KHÔNG tạo lượt mới
     tạo fulfillment_batches (RUNNING, orderIds = đơn đem đi gọi sàn), trả 202 {batchId,total,skipped}
   batch-runner (tiến trình web, không pg-boss vì việc dài chặn hàng đợi)
     mỗi gian song song:
       Shopee  arrangeShipmentBatch: get_order_detail(package_list) 50 đơn → gom (kho, kênh) ≤50
               → get_mass_shipping_parameter → mass_ship_order → get_mass_tracking_number
               nhóm lỗi CẢ MẺ → ship_order từng đơn cho riêng nhóm đó (không bao giờ tệ hơn trước)
       TikTok  arrangeShipmentBatch: orders?ids= 50 → Batch Ship 50 kiện → orders?ids= lấy mã (3 vòng)
       Lazada  từng đơn như cũ
     sàn OK → Order.PROCESSED + mã vận đơn ngay từng nhóm; tiến độ `done` ghi ≤1 lần/giây
GET  /api/orders/bulk/confirm/:batchId → {status, done, total, confirmed, failed, notes}
     RUNNING quá 3 phút không cập nhật = FAILED (máy chủ khởi động lại)
Giao diện: lib/api bulkConfirmOrders tự poll 1,5 s; nút "Sàn đã sắp xếp x/y…"; xong → đợi mã → in
           reattached → toast "Lượt trước vẫn đang chạy — đang theo dõi tiếp" rồi poll lượt cũ như thường
```

Chặn chồng lượt (15/10): `splitByRunningBatches` (hàm thuần, `confirm-skip.ts`) nhận các lượt RUNNING còn sống + id đơn chọn, trả `free` / `held` / `reattachTo`. Lượt "còn sống" = `updatedAt` trong 3 phút — cùng `STALE_MS` mà `getFulfillmentBatch` dùng để đánh FAILED, hai nơi phải cùng một số. Đơn bị giữ rải ở ≥2 lượt mà không còn đơn tự do → 409 `NO_READY_ORDERS` với câu "N đơn đang được sắp xếp ở lượt chuẩn bị trước — đợi lượt đó xong rồi tải lại danh sách, không bấm lại". Truy vấn đi qua chỉ mục riêng phần `fulfillment_batches_running_owner_idx (ownerId, updatedAt) WHERE status = 'RUNNING'` (gần như rỗng lúc bình thường); so khớp id đơn trong bộ nhớ vì mỗi chủ shop chỉ 0–2 lượt đang chạy, không cần GIN.

In vận đơn: `fetchLabels(..., { combined: true })` khi không in kèm phiếu xuất hàng → Shopee tải MỘT PDF cho cả nhóm cùng loại phiếu; sàn từ chối ("khác hãng") → tải lẻ. Probe mã vận đơn (`/bulk/label-readiness`) cũng đi theo mẻ.

## 3. Hạn chế đã biết

- Shopee `platformPackageId` vẫn null: docs cấm gửi `package_number` cho đơn không tách; đơn nhiều kiện ship đủ kiện nhưng in theo `order_sn` như cũ.
- Khung giờ TikTok hỏi một lần trên kiện đầu, dùng chung cả mẻ (cùng địa chỉ gian).
- Số kiện/lượt TikTok 50 là tự chọn, chưa có nguồn; Lazada chưa đụng.

## 4. Kiểm sau deploy (15/10)

1. ANO/DarkMan mẻ 20–50 đơn: bấm giờ so với trước (ước trước ~75 s/50 đơn sắp xếp + ~25 s tải PDF).
2. Log Render tìm `[fulfillment.shopee] mass ship` — thấy "lùi về từng đơn" nghĩa là mass API chưa mở cho gian/app → hỏi Shopee Open Platform.
3. Đối chiếu Seller Center: số đơn "Chờ lấy hàng" khớp số sàn nhận; vận đơn in đúng mã.
4. TikTok Hi.Bé: mẻ nhỏ 3–5 kiện trước.

Mã: `backend/src/services/fulfillment/{shopee,tiktok,batch-runner,types}.ts`, `integrations/shopee/client.ts` (4 hàm mass), `integrations/tiktok/client.ts` (`batchShipPackages`), `routes/orders.ts`, migration `20261014210000_fulfillment_batch`. Test: `integrations/__tests__/fulfillment-mass-ship.test.ts`.

## 4. Sự cố 15/10/2026 — "Không kết nối được máy chủ" rồi "Không có đơn nào ở trạng thái Chờ xử lý"

Anh Trung test 30 đơn Shopee (ANO 21 + DarkMan 9) ngay sau khi bản 14/10 lên prod (backend `f7b597d8`, web đã có luồng chạy nền — đã kiểm bundle, không lệch bản):

1. Bấm Chuẩn bị lần 1 → web báo **"Không kết nối được máy chủ"**, nhưng sàn **đã nhận đủ đơn** (anh xác nhận trên Seller Center).
2. Bấm lần 2 trên cùng hộp thoại → 409 **"Không có đơn nào ở trạng thái Chờ xử lý để chuẩn bị"**.

**Đọc mã:** câu "Không kết nối được máy chủ" trong hộp thoại chỉ hiện khi mã web ném lỗi **không phải** `ApiError` (lỗi mạng của `apiFetch` có câu dài riêng nhắc chặn quảng cáo). Sau khi lượt chạy nền DONE, đoạn duy nhất còn chạy là **đợi mã vận đơn + in** — và `fetchOrderLabelsPdf` dùng `fetch` thô, lỗi mạng/ngắt request ở đó là `TypeError` → bị dịch thành "Không kết nối được máy chủ", hộp thoại **không đóng, bảng không tải lại** → người dùng bấm lại trên danh sách cũ → 409 đúng kỹ thuật nhưng vô nghĩa với người dùng. Lỗi cụ thể của bước in lần 1 **chưa xác định** (cần log Render `[fulfillment.shopee]` + console trình duyệt lúc đó).

**Sửa (15/10):**
- Hộp thoại: bước in bọc `try/catch` riêng — sàn đã nhận thì luôn đóng hộp thoại + tải lại bảng; lỗi in chỉ là cảnh báo *"N đơn đã được sàn nhận nhưng chưa in được: … — lọc Chưa in phiếu rồi bấm In"*. Lỗi JS khác in nguyên văn (`Lỗi ngoài dự kiến: …`) thay vì đổ cho kết nối.
- `fetchOrderLabelsPdf`: lỗi mạng → `ApiError(0, networkErrorMessage())` như `apiFetch`.
- Backend 409: `services/fulfillment/confirm-skip.ts` — câu báo nói rõ *"30 đơn đã rời trạng thái Chờ xử lý — sàn đã nhận ở lượt chuẩn bị trước…"* + đuôi các nhóm khác, kèm `code: NO_READY_ORDERS`; web nhận mã này thì đóng hộp thoại + tải lại. Ghi `console.warn [fulfillment] bulk/confirm 409` với số đếm theo lý do + 3 mã mẫu.
- `batch-runner`: **nhịp tim 30 s** chạm `updatedAt` khi RUNNING, để lượt gọi sàn im lặng >3 phút không bị `getFulfillmentBatch` đánh FAILED oan.
- Test: `fulfillment-confirm-skip.test.ts` 5 ca.

**Đọc Supabase (15/10, cùng ngày):** lượt 1 (30 đơn) DONE sau 8,5 giây; 6 giây sau trình duyệt báo lỗi nên anh bấm lại → lượt 2 cùng 30 đơn được tạo **khi lượt 1 còn RUNNING** (dòng batch chưa kịp chuyển DONE lúc route kiểm đơn): 10 đơn bị bỏ qua, 20 đơn Shopee đã sắp xếp bị gọi lại và sàn từ chối `Package … not eligible for rescheduling`. Bảng `fulfillment_batches` không lưu danh sách đơn đầu vào nên route không có cách biết đơn nào đang ở lượt khác.

**Sửa lần 2 (15/10) — chặn lượt chồng lên lượt đang chạy:**
- Migration `20261015170000_fulfillment_batch_order_ids`: cột `orderIds JSONB NOT NULL DEFAULT '[]'` (không ghi lại bảng trên PG ≥ 11) + chỉ mục riêng phần `fulfillment_batches_running_owner_idx (ownerId, updatedAt) WHERE status = 'RUNNING'`. `startFulfillmentBatch` ghi id đơn thật sự đem đi gọi sàn.
- `POST /bulk/confirm`: `findLiveRunningBatches(ownerId)` (RUNNING, `updatedAt` trong `STALE_MS` 3 phút) → `splitByRunningBatches`: đơn đang ở lượt sống bị bỏ qua với `IN_RUNNING_BATCH_REASON` ("Đang được sắp xếp ở lượt trước — đợi lượt đó xong"); mọi đơn sẵn sàng đều ở đúng MỘT lượt → `202 { batchId: lượt cũ, total, skipped, reattached: true }`, không tạo lượt mới; rải ≥2 lượt → 409 `NO_READY_ORDERS` câu "đợi lượt đó xong… không bấm lại". Log `[fulfillment] bulk/confirm … đang ở lượt <id>`.
- Web: `bulkConfirmOrders(…, onReattached)` → hộp thoại `toast.info("Lượt trước vẫn đang chạy — đang theo dõi tiếp")` rồi poll lượt cũ như thường; kết quả cuối vẫn là của lượt cũ (confirmed/failed/skipped của lượt đó).
- Test `fulfillment-confirm-skip.test.ts`: +1 ca câu 409 mới, +6 ca `splitByRunningBatches` (không lượt, bấm lại đúng 30 đơn → reattach, thêm đơn mới → giữ cũ + tự do mới, rải 2 lượt → không reattach, lượt khác đơn, một đơn ở hai lượt).

**Chưa làm / theo dõi:** bước in vẫn là một request đồng bộ `/bulk/labels` (30 đơn: dựng vận đơn + poll + tải gộp); nếu log cho thấy request này bị cắt thì chuyển sang chạy nền giống Chuẩn bị hàng. Lượt chết thật (máy chủ khởi động lại) giữ đơn tối đa 3 phút rồi tự nhả — đúng ý, vì sàn có thể đã nhận một phần.

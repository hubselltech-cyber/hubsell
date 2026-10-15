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
POST /api/orders/bulk/confirm  → kiểm đơn, tạo fulfillment_batches (RUNNING), trả 202 {batchId,total,skipped}
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
```

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

**Chưa làm / theo dõi:** bước in vẫn là một request đồng bộ `/bulk/labels` (30 đơn: dựng vận đơn + poll + tải gộp); nếu log cho thấy request này bị cắt thì chuyển sang chạy nền giống Chuẩn bị hàng.

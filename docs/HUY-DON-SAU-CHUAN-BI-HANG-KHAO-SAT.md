# Khảo sát 23/10/2026 — Khách hủy đơn SAU khi shop đã chuẩn bị hàng / đang giao: API 3 sàn + Hubsell đang xử lý tới đâu

> Anh hỏi 23/10: "trên sàn có kiểu đơn đã chuẩn bị hàng rồi khách vẫn hủy, thậm chí đang giao cũng hủy ngang — có API không?"
> Nguồn: đọc trực tiếp docs Open Platform của Shopee / TikTok / Lazada bằng trình duyệt 23/10/2026 (trích nguyên văn bên dưới).
> Chính sách người mua theo thị trường VN lấy từ báo chí + blog bên thứ ba — CHƯA thấy trang chính thức Kênh Người Bán, ghi rõ là chưa kiểm.

## 1. Kết luận ngắn

| Sàn | Khách hủy khi shop ĐÃ chuẩn bị hàng (chưa bàn giao) | Khách hủy khi ĐANG GIAO | API cho shop quyết định | Hubsell hôm nay |
|---|---|---|---|---|
| Shopee | CÓ. Đơn sang `IN_CANCEL`, shop phải Chấp nhận / Từ chối (không trả lời → sàn tự hủy sau ~2 ngày, nguồn blog) | CÓ với SPX Express từ 20/06/2024 (đơn nội địa, chưa tới trạm giao cuối): ĐVVC quyết, shop chỉ theo dõi; đơn thành `CANCELLED`, kiện quay đầu | `POST /api/v2/order/handle_buyer_cancellation` `{order_sn, operation: ACCEPT|REJECT}` — chỉ nhận khi đơn `IN_CANCEL` | `IN_CANCEL` ánh xạ thẳng thành **Đã hủy** (shop không thấy "chờ duyệt"); không có nút duyệt; `CANCELLED` sau bàn giao đã hoàn kho + lấy mã vận đơn kiện quay đầu |
| TikTok | KHÔNG. Docs: "If an order status changes to AWAITING_COLLECTION, the buyer will no longer be able to request for a cancellation." Yêu cầu hủy chỉ phát sinh ở `UNPAID`/`AWAITING_SHIPMENT` (ngoài 1 giờ hối hận → shop duyệt trong 48 h, không trả lời → tự chấp nhận) | KHÔNG hủy; khách chuyển sang **yêu cầu hoàn tiền** (`AWAITING_COLLECTION`, `IN_TRANSIT`, `DELIVERED`) — trục hoàn/trả | `POST /return_refund/202309/cancellations/search` (lọc `BUYER_CANCEL`, `CANCELLATION_REQUEST_PENDING`) → `POST /return_refund/202309/cancellations/{cancel_id}/approve` hoặc `/reject`; scope `seller.return_refund.basic` | Webhook type 11 đã nhận nhưng chỉ kéo lại đơn (đơn vẫn `AWAITING_SHIPMENT` → app hiện Chờ xử lý, yêu cầu hủy VÔ HÌNH); không có search/approve/reject; đơn `CANCELLED` hoàn kho đúng |
| Lazada | Theo blog: chỉ hủy được khi "Chưa đóng gói" (`pending`); sau `packed`/`ready_to_ship` không hủy — CHƯA có nguồn chính thức | KHÔNG hủy; khách **từ chối nhận** → `failed_delivery` → `shipped_back` | Yêu cầu hủy = reverse order `request_type: CANCEL`, `reverse_status: REQUEST_INITIATE` (liệt kê qua `/reverse/getreverseordersforseller`); shop quyết bằng `GET /order/reverse/cancel/seller/decide` `{reverse_order_id, agree_cancel, reason_code}` | `returns-sync` cố ý BỎ mọi reverse order `CANCEL` ("trục shippingStatus lo"); `failed_delivery`/`shipped_back` đã ánh xạ Đã hủy + hoàn kho; không có decide |

Tóm lại: **cả 3 sàn đều có API cho shop chấp nhận / từ chối yêu cầu hủy, Hubsell chưa gọi API nào trong số đó.** Trường hợp "đang giao khách hủy ngang" chỉ Shopee (SPX) cho hủy thật; TikTok và Lazada đi đường hoàn tiền / từ chối nhận, Hubsell đã nhận diện kết quả cuối (Đã hủy + hoàn kho) nhưng không thấy giai đoạn "đang chờ shop quyết".

## 2. Trích docs nguyên văn (23/10/2026)

### Shopee — `v2.order.handle_buyer_cancellation`
- `POST /api/v2/order/handle_buyer_cancellation`; "Use this api to handle buyer's cancellation application."
- Tham số: `order_sn` (string, bắt buộc), `operation` (string, bắt buộc) "Avaiable value: ACCEPT, REJECT". Trả `update_time`.
- Lỗi `order.cancel_order_invalid_status` / `order.order_status_invalid`: "Invalid order_status. The order status should be IN_CANCEL." Lỗi `logistics.cancel_forder_failed`: "Cancel forder failed."
- App types được gọi: ERP System, Seller In House System, Order Management, Customer Service, Swam ERP (app Hubsell là ERP → được).
- `get_order_list` lọc `order_status`: UNPAID/READY_TO_SHIP/PROCESSED/SHIPPED/COMPLETED/IN_CANCEL/CANCELLED/INVOICE_PENDING. Push code 3 (`order_status_push`) cũng mang status này.
- `get_order_detail` optional fields: `buyer_cancel_reason` ("Cancel reason from buyer, could be empty."), `cancel_by`, `cancel_reason` ("Use this field to get reason for buyer, seller, and system cancellation."); item_list có `cancel_requested_qty` ("currently under a cancellation request but has not yet reached the final cancelled status") + `cancelled_qty`; đơn có `can_full_cancel_order`, `can_partial_cancel_order`, `buyer_preference_for_partial_cancellation` (0 = giao phần còn, 1 = hủy cả đơn).
- Chính sách VN (znews/Tuổi Trẻ 06/2024, chưa kiểm trang chính thức): từ 20/06/2024 "người mua có thể hủy đơn đang trong quá trình vận chuyển" — chỉ đơn nội địa SPX Express, từ lúc ĐVVC lấy hàng tới khi về trạm giao; yêu cầu lúc shop đang chuẩn bị hàng "cần được bên bán chấp thuận"; đang giao "kết quả yêu cầu hủy đơn phụ thuộc vào hành trình và quyết định của đơn vị giao hàng"; hàng hoàn theo chính sách này "không bị tính vào tỉ lệ đơn không thành công cho shop". Blog BigSeller: từ 13/11/2024 (thị trường khác?) "buyers will be able to cancel their orders instantly before the parcel is handed over to the courier" với Shopee-Supported Logistics — VN chưa xác nhận.

### TikTok — Return, refund, and cancel API overview + Approve/Search Cancellation (v202309)
- Bảng ai được làm gì: Cancel/Buyer = Y ở UNPAID, ON_HOLD (UK), AWAITING_SHIPMENT; **N ở AWAITING_COLLECTION, IN_TRANSIT, DELIVERED**. Refund/Buyer = Y ở AWAITING_COLLECTION, IN_TRANSIT (tùy thị trường), DELIVERED.
- "Once an order is longer within the buyer remorse window, the cancellation must be reviewed by the seller. If an order status changes to AWAITING_COLLECTION, the buyer will no longer be able to request for a cancellation." Cửa sổ hối hận ngoài UK: AWAITING_SHIPMENT + 1 giờ.
- "Cancel request can be initiated by the buyer BEFORE the seller ships an order. Once the order has been shipped, the buyer will no longer be able to cancel the order. If the package is still being delivered and the buyer insists on canceling the order, the seller should ask the buyer to initiate a refund request."
- Hạn trả lời: "seller must respond to the request within 48 hours. If there is no response within 48 hours, TikTok Shop will automatically approve"; nếu yêu cầu tới trước SLA 2 ngày làm việc: "the seller must act within 24 hours… Sellers must resolve the request by either: Uploading the tracking number to the cancellation request / Approving the cancellation".
- `POST /return_refund/202309/cancellations/search` body: `cancel_ids`, `order_ids`, `cancel_types` (`CANCEL` = seller/system; `BUYER_CANCEL` = "Cancel by buyer. Need to be approved by seller or system."), `cancel_status` (`CANCELLATION_REQUEST_PENDING` / `_SUCCESS` / `_CANCEL` / `_COMPLETE`), `create_time_ge/lt`, `update_time_ge/lt`; page_size ≤ 50; cần `shop_cipher`.
- `POST /return_refund/202309/cancellations/{cancel_id}/approve` (và `/reject`): "Call this API only when the cancellation request is still waiting for seller action." `cancel_id` lấy từ Search Cancellations, "Do not pass the order ID here." Có `idempotency_key`. Lỗi đáng chú ý: 25001045 "The order has already been shipped and we are unable to cancel shipment with the courier."; 25011012 "reverse status cannot approve application".
- Webhook `CANCELLATION_STATUS_CHANGE` (type 11) — Hubsell đã đăng ký (`tiktok/webhook-queue.ts`).
- Seller Academy VN (knowledge_id 6837773789234946): "Hầu hết đơn hàng có thể bị hủy bất kỳ lúc nào trước khi đơn hàng ở trạng thái 'đang vận chuyển'." COD qua J&T: khách được từ chối nhận nếu hàng hỏng/sai mô tả.

### Lazada — Return and Refund API
- Nhóm API: GetReverseOrderDetail (`/order/reverse/return/detail/list`), GetReverseOrderHistoryList, GetReverseOrderReasonList, GetReverseOrdersForSeller (`/reverse/getreverseordersforseller`), InitReverseOrderCancel, **InitReverseOrderCancelDecide** (`GET /order/reverse/cancel/seller/decide`), ReverseOrderOnlyRefundDecide, ReverseOrderReturnUpdate.
- `/order/reverse/cancel/seller/decide` tham số: `reverse_order_id` (bắt buộc, "The reverse order to be cancelled"), `agree_cancel` (Boolean, bắt buộc, "decision"), `reason_code` (tùy chọn). Lỗi E0131 "no decision for this reverse order". Mô tả trang ghi "Seller initiates a cancelation" nhưng tham số `agree_cancel` cho thấy đây là quyết định ĐỒNG Ý/TỪ CHỐI một yêu cầu hủy đã có — cần thử thật trên gian anh để chắc.
- `getreverseordersforseller` lọc `request_type_list` (ví dụ ONLY_REFUND; mẫu detail có `"request_type": "CANCEL"`), `reverse_status_list` (ví dụ `REQUEST_INITIATE`), `ofc_status_list`, `trade_order_id`, khoảng thời gian ms. Push LPM message_type 0 cũng mang `reverse_order_id` cho đơn hoàn/hủy (`lazada/webhook.ts`).
- Chính sách người mua VN: chỉ blog (dienmaycholon, Ginee): hủy được khi "Chưa đóng gói"; "Change of mind… only available if the item has not yet been shipped, and approval is subject to seller agreement". BigSeller liệt kê trạng thái hủy được: Pending, Repacked, packed, ready_to_ship_pending (phía shop). Chưa có trang chính thức.

## 3. Hubsell đang làm gì với các ca này (đọc mã 23/10)

- Shopee `integrations/shopee/service.ts` `mapShopeeStatus`: `IN_CANCEL` → `ShippingStatus.CANCELLED` (test `shopee-order-status-map.test.ts` khóa hành vi này). `shouldDeductShopeeStock` loại `IN_CANCEL` (không hoàn kho vội — đúng), chỉ `CANCELLED` mới `releaseStockHoldTx` + `restoreStockTx`. `CANCELLED` sau bàn giao vẫn hỏi `get_tracking_number` để kho quét kiện quay đầu. Hệ quả: shop nhìn app thấy "Đã hủy" trong khi Shopee đang chờ shop bấm Chấp nhận/Từ chối; Chuẩn bị hàng bỏ qua với lý do "Đơn đã hủy" (`fulfillment/confirm-skip.ts`); từ chối trên Seller Center xong đơn quay về PROCESSED/SHIPPED nhờ đồng bộ, nhưng không ai báo.
- TikTok `integrations/tiktok/webhook-queue.ts`: type 11 nằm trong `ORDER_EVENT_TYPES` → chỉ kéo chi tiết đơn + upsert; `client.ts` có đọc `cancel_reason`, `cancel_time`, `cancellation_initiator`, `cancel_order_sla_time` nhưng không có hàm gọi `cancellations/search`, `approve`, `reject`. Yêu cầu hủy đang chờ (đơn vẫn `AWAITING_SHIPMENT`) → app hiện Chờ xử lý, shop có thể đóng gói đơn sắp bị tự hủy sau 24–48 h.
- Lazada `integrations/lazada/returns-sync.ts` `lazadaReturnSolutionOf`: `request_type` chứa CANCEL → null → bị lọc khỏi trục hoàn ("Bỏ hẳn yêu cầu HỦY ĐƠN (trục shippingStatus lo)"); `client.ts` chỉ có `getreverseordersforseller`, không có `cancel/seller/decide`.
- Chung: `ShippingStatus` chỉ có 5 giá trị (PENDING/PROCESSED/SHIPPING/DELIVERED/CANCELLED), không có chỗ cho "chờ duyệt hủy"; không thông báo (`services/notifications`) nào về yêu cầu hủy.

## 5. ĐÃ LÀM 23/10/2026 đêm — lát 1 + lát 2 trên WEB (anh chốt: web trước, app để sau)

Anh chốt: "phần quan trọng vì khi quét đơn sẽ hiện trạng thái yêu cầu hủy kèm nhạc cảnh báo trên app — nhưng app làm sau, chủ yếu web đêm nay".

**Dữ liệu** — 4 cột NULL trên `Order` (migration `20261023010000_order_cancel_request`, khóa có thử lại + chỉ mục một phần
`Order_cancel_request_pending_idx` WHERE cancelRequestedAt IS NOT NULL): `cancelRequestedAt`, `cancelRequestReason`, `cancelRequestRef`
(TikTok cancel_id / Lazada reverse_order_id), `cancelRequestDueAt`. Trục RIÊNG, `shippingStatus` không đổi. Dùng chung: `integrations/cancel-request.ts`
(`CLEAR_CANCEL_REQUEST`, `notifyCancelRequest` → chuông type `cancel_request`, link `/orders?cancelRequested=1`).

**Nguồn cờ từng sàn**
- Shopee `shopee/service.ts`: `mapShopeeStatus("IN_CANCEL")` → PENDING (trước là CANCELLED); `planShopeeOrderUpdate` khi IN_CANCEL KHÔNG ghi
  `shippingStatus` (giữ Đã xử lý/Đang giao), bật cờ từ `buyer_cancel_reason`/`cancel_reason` (đã thêm vào `ORDER_DETAIL_FIELDS`), hạn = +2 ngày
  (`SHOPEE_CANCEL_DECISION_WINDOW_MS`, nguồn blog — ghi rõ tự chọn); rời IN_CANCEL → xóa cờ. Đi qua cả đồng bộ lô lẫn webhook code 3.
- TikTok `tiktok/cancel-requests.ts`: `planTiktokCancelFlag` thuần + `syncTiktokCancelRequests` gọi `cancellations/search` (client mới:
  `searchCancellations`, `approveCancellation`, `rejectCancellation`, `getRejectReasons`). Kích hoạt: webhook type 11 (job hàng đợi nay mang
  `eventType`, `webhook-inbox.ts` + `event-queue.ts`) hỏi đúng đơn; auto-sync quét biến động 3 ngày làm lưới đỡ + hạ cờ đơn sàn không còn báo
  chờ. `planTiktokOrderUpdate` xóa cờ khi đơn rời PENDING (khách hết quyền từ AWAITING_COLLECTION).
- Lazada `lazada/returns-sync.ts`: `planLazadaCancelRequest` — reverse order request_type CANCEL còn dòng sống → cờ với reverse_order_id; chết → hạ.
  `planLazadaOrderUpdate` xóa cờ khi CANCELLED. Client mới `decideReverseOrderCancel` (`/order/reverse/cancel/seller/decide`).

**Quyết định** — `services/cancel-request-decide.ts` + `POST /api/orders/:id/cancel-request/decide {accept}`: Shopee `handle_buyer_cancellation`
ACCEPT/REJECT; TikTok approve hoặc reject (reject phải kèm `reason_key` lấy từ `reject_reasons`, chọn lý do có chữ ship/giao/đóng gói, không có thì
lý do đầu); Lazada `agree_cancel`. Sau lệnh: KÉO LẠI ĐƠN bằng đúng đường webhook (`processShopeeOrderEvent` / `processTiktokOrderEvent` /
`processLazadaOrderPush` → CANCELLED thì hoàn kho) rồi hạ cờ. Lỗi sàn → 502 kèm thông điệp.

**Web** — `GET /api/orders?cancelRequested=1` + `counts.CANCEL_REQUESTED` (đếm trên mọi tab); trang Đơn hàng: dải đỏ "N đơn khách đang xin hủy" +
nút "Chỉ xem đơn xin hủy" (deep-link từ chuông), nhãn "Khách xin hủy · còn N giờ" dưới trạng thái (tooltip lý do), cột Thao tác đổi thành hai nút
Chấp nhận hủy / Từ chối mở hộp xác nhận (cảnh báo kiện quay đầu nếu đã chuẩn bị hàng). Chuẩn bị hàng hàng loạt: `window.confirm` cảnh báo nếu có
đơn đang xin hủy, KHÔNG chặn (luật "cảnh báo, không khóa cứng").

**Kiểm** — tsc BE/FE sạch; vitest `cancel-request-plan.test.ts` (Shopee 4 ca, TikTok 4, Lazada 3) + 4 file liên quan 41/41; DB dev áp SQL
migration bằng `prisma db execute` (migrate deploy kẹt bản ghi lỗi cũ `20260830120000_fee_audit` từ 17/09 — có sẵn, không phải do lát này);
soi web local (cổng 3000 của phiên khác, hot reload) với 1 đơn seed: dải + nhãn + 2 nút hiện đúng, seed đã xóa.
**CHƯA kiểm** — gọi API thật 3 sàn (chưa có đơn IN_CANCEL thật); hình dạng `cancellations/search` TikTok (log `[TikTok cancel] hình dạng` lần
đầu); Lazada `cancel/seller/decide` có đúng là quyết định trên yêu cầu khách (docs mô tả mập mờ); lát 3 (đóng gói rồi mới hủy → rút kiện, cộng kho
khi hàng về) CHƯA làm; app mobile CHƯA làm (anh muốn nhạc cảnh báo khi quét đơn).

## 4. Đề xuất ban đầu (lát 1+2 đã làm — mục 5; lát 3 chờ anh)

1. **Lát 1 — nhìn thấy:** cờ `cancelRequestedAt` + `cancelRequestedBy/Reason` trên Order (trục riêng, không đổi `ShippingStatus`); Shopee `IN_CANCEL` giữ nguyên trạng thái vận chuyển cũ + bật cờ; TikTok webhook 11 → `cancellations/search` theo `order_ids` → cờ khi `CANCELLATION_REQUEST_PENDING`; Lazada quét `getreverseordersforseller` thêm `request_type CANCEL` + `REQUEST_INITIATE`. Danh sách đơn hiện nhãn "Khách xin hủy · còn N giờ" + thông báo chuông; Chuẩn bị hàng cảnh báo (không chặn — theo luật "cảnh báo, không khóa cứng").
2. **Lát 2 — quyết định:** nút Chấp nhận / Từ chối gọi 3 API trên (Shopee `handle_buyer_cancellation`, TikTok `approve`/`reject` với idempotency_key, Lazada `cancel/seller/decide`); ghi `ChannelSyncLog` + sổ cái cập nhật theo webhook sau đó.
3. **Lát 3 — đơn đã đóng gói rồi mới hủy:** khi `CANCELLED` tới sau `packedAt`, đánh dấu "kiện cần rút khỏi lô" trong Chuẩn bị hàng (phiếu nhặt đã in) và CHỈ cộng kho khi hàng thật về (đường quét tem kiện quay đầu đã có) thay vì `restoreStockTx` ngay — cần anh chốt vì hiện CANCELLED là hoàn kho tức thì.

Chưa kiểm: thử thật `handle_buyer_cancellation` và `cancel/seller/decide` trên gian anh; trang Kênh Người Bán Shopee VN về "Hủy đơn đang vận chuyển" (có áp dụng đại trà hay chỉ một nhóm shop HN/HCM như 2024).

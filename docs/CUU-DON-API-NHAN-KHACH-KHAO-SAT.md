# Cứu đơn giao thất bại — khảo sát API nhắn khách theo sàn (12/10/2026)

Bối cảnh: nhánh "tự nhắn khách" của Cứu đơn giao thất bại chết trên Shopee từ
15–16/09/2026 (Shopee từ chối Chat API cho app ISV, xem SHOPEE-ISV-HO-SO.md
mục 6). Cảnh báo (chuông) vẫn chạy cả 3 sàn. Anh Trung hỏi 12/10: TikTok có
API nào dùng được không. Khảo sát trực tiếp trên docs chính thức ngày 12/10.

## 1. Kết luận nhanh

| Sàn | API nhắn chủ động cho khách | Hubsell có quyền chưa | Đường xin | Đánh giá |
|---|---|---|---|---|
| Shopee | sellerchat (đã bị từ chối) | ⛔ không bao giờ (app ISV) | đóng từ 18/11/2024 | giữ cảnh báo |
| TikTok | Customer Service API: Create Conversation + Send Message | ⛔ scope `seller.customer_service` là custom, app chưa có | ngưỡng ≥1.000 gian ủy quyền hoặc ≥1 triệu call/ngày | chờ quy mô |
| Lazada | Instant Messaging API: `/im/session/open` (theo order_id) + `/im/message/send` | ⛔ nhóm quyền IM chưa có trên app ERP 142085 | xin nhóm quyền / app category "ERP IM Chat" | **làm được sớm nhất** |

## 2. TikTok Shop — Customer Service API (docs partner.tiktokshop.com, đọc 12/10)

API khớp đúng bài toán:

- `POST /customer_service/202309/conversations` body `buyer_user_id` (= `user_id`
  trong Get Order Detail) → trả `conversation_id`. Có hội thoại cũ thì mở lại cùng id.
- `POST /customer_service/202309/conversations/{id}/messages` type `TEXT` (≤2.000 ký
  tự), `ORDER_CARD` (order_id), `LOGISTICS_CARD` (order_id + package_id), ngoài ra
  IMAGE/VIDEO/PRODUCT_CARD/COUPON_CARD/RETURN_REFUND_CARD.
- Điều kiện shop được MỞ hội thoại trước (lỗi 45109003 nếu không thỏa): khách đã
  chat trong 30 ngày, HOẶC đã đặt hàng trong 60 ngày, HOẶC từng hoàn/hủy.
  → Đơn đang giao thất bại luôn thỏa điều kiện "đặt hàng trong 60 ngày".
- Hội thoại tự đóng sau 6 giờ nếu khách không trả lời; shop có 7 ngày để trả lời.
- Quota gửi: 10.000 request/ngày/app (lỗi 45101004). Webhook NEW_CONVERSATION (13),
  NEW_MESSAGE (14) — Hubsell đã có mã type 13 trong webhook-queue.ts, đang tắt.

Rào cản (trang "Customer Service API overview", mục Approval Rule):

- Scope `seller.customer_service` là **custom API**, chỉ hiện với partner đã chọn
  business category "Customer Service" trong Category & Market của Partner Center.
  Danh sách 24 scope của app Hubsell (soi 16/09) KHÔNG có mục này — khớp.
- Điều kiện cấp: partner có **≥1.000 seller ủy quyền** HOẶC **≥1 triệu call API/ngày**.
  Ngoại lệ: app loại "TikTok Shop Seller" (seller tự có đội dev) được xét đặc cách.
  Hubsell 12/10: 15 ủy quyền → chưa đủ.
- Hồ sơ phải có: khung chat đang chạy thật (ảnh full + clip 30–90 giây gửi/nhận),
  đã tích hợp Order / Fulfillment / After-sales (Hubsell có đủ: Trợ lý vận hành,
  đơn, vận đơn, hoàn).
- Customer Engagement API (tin marketing theo mẫu) chỉ cho seller **US**, 1 tin/tuần
  → không dùng được cho VN và không phải bài toán này.

Phương án TikTok:

1. **Chờ ngưỡng 1.000 gian** rồi nộp: chọn thêm category Customer Service, xin scope,
   nộp ảnh + clip Trợ lý vận hành. Khi được cấp, khách phải Kết nối lại gian (token
   theo scope lúc ủy quyền, giống Product Modify 12/10).
2. BYO app loại "TikTok Shop Seller": khách tự tạo app, tự dán key → trái nguyên tắc
   "khách cần đơn giản", chỉ hợp khách Business lớn. Không đề xuất.
3. Hỏi Partner Assistant (ticket) xem có ngoại lệ cho partner VN quy mô nhỏ không —
   chi phí thấp, kỳ vọng thấp.

## 3. Lazada — Instant Messaging API (docs open.lazada.com, đọc 12/10)

API khớp bài toán hơn cả TikTok vì mở hội thoại **theo mã đơn**:

- `GET/POST /im/session/open` tham số `order_id` → `session_id`. Lỗi -22 "order out
  of day limit: 30" = chỉ đơn tạo trong 30 ngày. Endpoint VN https://api.lazada.vn/rest.
- `POST /im/message/send` tham số `session_id` + `template_id`: 1 = text (`txt`),
  10007 = thẻ đơn (`order_id`), 3 = ảnh, 10006 = thẻ sản phẩm, 10008 = voucher.
- Đã có sẵn trong `backend/src/integrations/lazada/client.ts`: im/session/list,
  im/message/list, im/message/send (viết 08/08 cho Trợ lý vận hành, chưa chạy được
  vì InsufficientPermission). Thiếu duy nhất hàm `im/session/open`.

Rào cản: nhóm quyền IM không nằm trong app category "ERP System" (app ISV 142085).
Soi console 10–11/09: IM Chat là category riêng ("ERP IM Chat" cho ISV, "In-house
IM Chat" cho app nội bộ), cả hai app đều không có nhóm IM. Docs "Request API
permission" (cập nhật 23/06/2026): nhóm quyền Inactive có thể Apply ngay trong App
Overview → API Permission Group kèm Reason + tệp đính kèm.

Việc cần làm (theo thứ tự):

1. Đăng nhập isvconsole.lazada.com → App 142085 → API Permission Group: xem có nhóm
   "Instant Messaging"/"IM" trạng thái Inactive không. Có → bấm Apply (Reason: nhắn
   khách khi giao thất bại + CSKH, kèm ảnh Trợ lý vận hành + tab Cứu đơn).
2. Không có → hỏi đầu mối Lazada SMP (Agnes tjc01281935@alibaba-inc.com) hai câu:
   (a) app ERP System có được gắn nhóm IM không; (b) nếu phải tạo app "ERP IM Chat"
   riêng thì seller có phải đặt gói + ủy quyền lần hai không (token theo app).
3. Được quyền → code: thêm `openImSession(orderId)`, nối vào
   `integrations/lazada/delivery-fail.ts` chỗ đang ghi SKIPPED "Lazada chưa có API
   nhắn khách" → gửi thẻ đơn 10007 rồi text template; giữ cùng khuôn Shopee (thẻ đơn
   trước, text sau). Lưu ý nhịp 10' + webhook LPM đã phát hiện failed_delivery, chỉ
   thêm bước gửi.

## 4. Kênh ngoài sàn (SMS / Zalo ZNS) — chưa kết luận được

Hubsell lưu `customerPhone` từ cả 3 sàn. Đếm DB local 12/10 (chỉ đếm, không đọc số):
Lazada 1.010/2.563 đơn có dấu `*` (bị che); Shopee, TikTok 0 đơn che. Nhưng DB local
lẫn ~4.300 đơn seed của tài khoản reviewer, công cụ chặn đọc tiếp → **chưa kiểm
được prod**. Nếu SĐT thật còn thì ZNS/SMS là đường không phụ thuộc sàn, nhưng tốn
phí tin + đăng ký mẫu ZNS + phải rà chính sách liên hệ ngoài nền tảng của từng sàn.
Để sau, chỉ xét khi cả TikTok lẫn Lazada đều tắc.

## 5. Đề xuất

- Làm Lazada trước (1–2 ngày console + ~nửa ngày code), vì API đúng use case và
  đường xin nằm trong tay mình.
- TikTok: ghi vào lộ trình, mốc kích hoạt = 1.000 gian ủy quyền; trong lúc chờ, đổi
  câu SKIPPED "Hubsell chưa nối API chat TikTok Shop" thành câu nêu rõ lý do sàn.
- Shopee: giữ nguyên cảnh báo + nhắn tay (đã chốt 16/09).

Nguồn: partner.tiktokshop.com/docv2/page/customer-service-api-overview,
create-conversation-202309, send-message-202309, customer-engagement-api-overview,
access-scope; open.lazada.com/apps/doc/api?path=/im/session/open, /im/message/send,
doc?nodeId=10535&docId=108131.

## 6. Quyết định 12/10/2026 — ẨN HẲN (anh Trung chốt ngay sau khảo sát)

"Có dùng được đâu mà giữ — tội gì phơi bày tính năng chưa làm được cho đối thủ."
Làm cùng phiên, một commit:

- Backend `integrations/shopee/delivery-fail.ts`: 2 cờ `DELIVERY_FAIL_FEATURE=false`
  (cả tính năng) + `DELIVERY_FAIL_AUTO_CHAT_FEATURE=false` (nhánh chat).
  `effectiveDeliveryFailConfig` trả alertEnabled=false & autoChatEnabled=false khi
  cờ tắt → 3 worker không quét tracking (tiết kiệm quota sàn), không chuông,
  `ops-alerts` không dựng thẻ Trung tâm điều hành. Bảng DeliveryFailConfig/
  Notice/TrackingTask giữ nguyên; routes `/delivery-fail/*` vẫn sống (PUT chỉ ghi
  alertEnabled khi cờ chat tắt, không ghi đè 2 trường chat chủ shop từng lưu).
- Frontend: `ai-rules-page.tsx` cờ `DELIVERY_FAIL_FEATURE=false` → bỏ tab + thanh
  pill (trang chỉ còn Phản hồi đánh giá), deep-link `?tab=delivery-fail` bị bỏ qua;
  `delivery-fail-tab.tsx` cờ `AUTO_CHAT_FEATURE=false` giấu công tắc chat, mẫu tin,
  cột Nhắn khách (sẵn cho lúc mở lại); sidebar `app-shell.tsx` thêm `hidden` cho
  trang con, mục **Trợ lý Chat** ẩn (route + lá quyền `operations.chat` còn, giống
  cách ẩn KOC 25/09); tour Giữ tiền gỡ bước Cứu đơn (gt-rescue.png + step-7.mp3
  để lại trên đĩa), tiêu đề đổi "Giữ tiền: đơn hoàn, phí ship, phí sàn"; hộp giới
  thiệu app mobile bỏ dòng "Trả lời tin nhắn khách…".
- Mở lại (mốc: TikTok đủ 1.000 gian → làm TikTok + Lazada một thể): đổi 4 cờ
  (2 BE + 2 FE), bỏ `hidden` Trợ lý Chat, trả bước tour, nối API chat.
- CHƯA đụng: landing hubsell-landing (`components/landing/tour.tsx` còn slide
  "Cứu đơn giao thất bại" + "CSKH đa kênh một khung chat") — anh dặn 14/09 dừng
  chỉnh landing, chờ anh chốt; cây phân quyền vẫn hiện lá "Trợ lý Chat" (cùng
  cách KOC).

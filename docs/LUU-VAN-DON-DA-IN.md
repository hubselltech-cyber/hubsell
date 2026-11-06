# Lưu vận đơn đã in 60 ngày (06/11/2026)

> Trạng thái: **ĐÃ PUSH 06/11 tối (anh: "cứ push lên đi… anh sẽ tự test"); chưa gian nào bật — anh tự thử trên prod.**
> Mã: `backend/src/services/label-archive.ts` (+ test), `backend/src/lib/supabase-storage.ts` (bucket `order-labels`),
> `backend/src/routes/orders.ts` (xếp hàng lúc in + `GET /:id/saved-label`), `backend/src/routes/channels.ts`
> (`POST /:id/label-archive`), `backend/src/workers/log-cleanup.ts` (dọn), `frontend/src/components/orders/label-archive-dialog.tsx`.

## 1. Vì sao có

Một khách hỏi in lại vận đơn của đơn đã giao thành công (ca khách trả hàng). Anh Trung chốt 06/11: làm, giữ 60 ngày rồi tự
xóa, kho tệp = Supabase Storage, không lưu tệp trong Postgres, mục đích khách dùng phiếu không phải việc của mình.
Tối 06/11 anh chốt thêm: có **công tắc gạt theo gian** ("sau này dùng chính công tắc này để thu thêm phí") và phần lưu
**không cần tức thì, xếp hàng lưu từ từ, không được ảnh hưởng hệ thống**.

## 2. Vì sao phải lưu, không gọi lại sàn — thăm dò prod 06/11

`backend/scripts/label-delivered-probe.ts` (chỉ đọc) chạy ở Render Shell worker, tài khoản ANO:

| Sàn | Gian | Thử | Sàn trả phiếu | Lý do sàn nêu |
|---|---|---|---|---|
| Shopee | ANO Official Store | 7 đơn giao 1 → 90 ngày trước | 0 / 7 | từ chối ở `create_shipping_document` |
| Shopee | ANO Official Store | 5 đơn Đã xử lý / Đang giao | 2 / 5 | 3 đơn đã bàn giao: "Failed to print the shipping document because the parcel has been shipped" |
| TikTok | ANO Official | 6 đơn giao 4 → 90 ngày trước | 0 / 6 | mã `21042102` "Documents couldn't be printed after the package has been pickup" |
| Lazada | — | chưa thử (tài khoản ANO không có gian Lazada) | — | — |

Kết luận: hạn sàn cho in lại là **tới lúc hãng vận chuyển lấy kiện**. Sau đó chỉ còn bản khách đã in qua Hubsell.
Cỡ phiếu Shopee đo thật (mẫu 2 đơn): tải riêng 108,5 KB và 107,7 KB, 1 trang / đơn; tệp gộp 2 đơn = 2 trang, 184,7 KB.

## 3. Thiết kế đã chọn

| Điểm | Chọn | Đã loại và vì sao |
|---|---|---|
| Kho | Supabase Storage, bucket riêng tư `order-labels`, không ký link công khai | Postgres (đã chốt không), R2 (chỉ tính khi kho gần 100 GB) |
| Đường dẫn | `{ngày in UTC}/{channelId}.{orderId}.pdf` — mỗi ngày MỘT thư mục phẳng, không bảng / cột cho từng tệp | Xếp theo gian trước: dọn phải dò từng gian mỗi ngày. Bảng riêng: thêm ghi DB cho mỗi lượt in |
| Ngày thư mục | Ngày của `Order.labelPrintedAt` (mốc in lần đầu); chưa có mốc thì hôm nay. Lúc tìm thử ngày của mốc rồi ngày liền trước | — (frontend đánh dấu đã in vài giây SAU khi nhận tệp) |
| Tệp gộp Shopee (≤ 50 đơn, chỉ khi in không kèm phiếu nhặt) | Lưu NGUYÊN tệp `{ngày}/{channelId}.lo-{khóa}.pdf` + tệp chỉ đường `{ngày in}/{channelId}.{orderId}.json` cho từng đơn. Tách trang LÚC IN LẠI, chỉ khi số trang = số đơn; không khớp thì trả cả tệp gộp kèm cờ `wholeBatch` | Tách lúc in: tốn CPU tiến trình web ở mọi lượt in. Tải từng đơn khi công tắc bật: in chậm ~10 lần, gọi thêm sàn |
| Công tắc | Cột `Channel.labelArchiveEnabledAt` (NULL = tắt), gạt ở hộp "Lưu vận đơn" trên trang Đơn hàng, chỉ chủ shop | Env danh sách gian: HQ / khách không gạt được, không có mốc "bật từ lúc nào". Khóa trong `fulfillmentSettings`: `batch-runner.ts` ghi đè cả cột JSON |
| Ai được gạt | `labelArchiveAllowed(ownerId)` — MỘT hàm, chỗ gắn thu phí về sau. Hiện MỞ cho mọi chủ shop khi đã có kho tệp (anh chốt 06/11 lúc cho push: "người ta vẫn có thói quen in trên Seller Center, không để ý đâu"); thu hẹp bằng env `LABEL_ARCHIVE_OWNERS` = `off` hoặc danh sách id chủ shop. Công tắc từng gian vẫn mặc định TẮT | Bản đầu để trống = chưa ai thấy (anh bỏ) |
| Chép lên kho | Lượt in chỉ XẾP HÀNG (`LabelArchiveSpool`) sau khi đã trả PDF; tải lên nhỏ giọt ở nền | Tải ngay trong lượt in (bản đầu, anh bảo đổi). Hàng đợi bền trong Postgres: phải nhét PDF vào DB |
| Nút In lại phiếu | Trong ô Trạng thái của bảng Đơn hàng, dưới dòng "Đã in phiếu"; chỉ hiện khi gian đang bật, đơn in SAU mốc bật, chưa quá 60 ngày, và đơn đã qua Đã xử lý (Đang giao / Đã giao / Hủy · hoàn) | Cột Thao tác: phải nới cột, bảng đang chật ở 1280. Hỏi kho từng đơn để biết có tệp: thêm lệnh gọi mỗi lần tải bảng |
| Dọn 60 ngày | Cron `log-cleanup` (worker, 24 giờ): liệt kê gốc bucket → thư mục ngày nào `< ngày(bây giờ − 60 ngày)` thì liệt kê 1.000 tệp → xóa → lặp tới rỗng | Quét bảng Order |

### 3.1 Hàng chờ nhỏ giọt (`LabelArchiveSpool`)

- Một hàng cho cả tiến trình web; số lệnh tải lên cùng lúc cố định (mặc định 2) + nghỉ 100 ms sau mỗi lệnh. Một lượt in 200
  đơn hay 50 lượt in cùng lúc thì kho vẫn chỉ thấy đúng nhịp đó.
- Trần 48 MB PDF đang chờ. Đầy → lượt in mới KHÔNG được xếp hàng, ghi log `HÀNG CHỜ ĐẦY`; lượt in vẫn bình thường.
- Tải hỏng → xếp lại cuối hàng, thử lại sau 5 giây rồi 30 giây; hết lượt mới ghi log lỗi.
- Không khóa, không trạng thái dùng chung: nhiều máy web thì mỗi máy một hàng; tải trùng vô hại (`putIfAbsent`).
- Chỉnh bằng env, không sửa mã: `LABEL_ARCHIVE_CONCURRENCY`, `LABEL_ARCHIVE_PAUSE_MS`, `LABEL_ARCHIVE_MAX_QUEUE_MB`.
  Các số mặc định là **số tự chọn**, chưa có số đo tải thật. Với 2 lệnh song song + nghỉ 100 ms, thông lượng ước vài tệp / giây
  (vài trăm nghìn tệp / ngày); muốn hơn thì tăng env.
- **Hệ quả chấp nhận:** hàng nằm trong RAM (PDF không được vào Postgres) → tiến trình web khởi động lại thì mất các tệp còn
  đang chờ. Khách in lại khi kiện chưa bị lấy thì tệp được xếp hàng lại.

### 3.2 Có đụng database không

- Mã Hubsell: lượt in và lượt lưu **không ghi bảng nào**. Chỉ có thao tác gạt công tắc ghi một cột của `Channel`, và danh
  sách đơn đọc thêm cột đó.
- Phía Supabase: mỗi tệp trong Storage là **một dòng `storage.objects`** do dịch vụ kho tự ghi vào chính Postgres của dự án.
  Đây là lý do giữ số tệp thấp (tệp gộp lưu một lần) và dọn theo thư mục ngày.

## 4. API

- `POST /api/channels/:id/label-archive` `{ enabled }` — chỉ chủ shop. Bật cần `labelArchiveAllowed`. Trả gian đã cập nhật.
  `GET /api/channels` kèm `labelArchiveEnabledAt` và `labelArchiveAvailable`.
- `GET /api/orders/:id/saved-label` — trả `application/pdf`; header `X-Hubsell-Saved-Label` = base64 JSON `{ wholeBatch, count }`.
  Kiểm `channelScope` (đúng chủ gian + quyền nhân viên theo gian) và công tắc đang bật. Lỗi: 403 gian chưa bật, 404 đơn
  chưa in qua Hubsell / không có bản lưu, 410 quá 60 ngày, 502 kho lỗi.
- `GET /api/orders` — `channel.labelArchiveEnabledAt` đi kèm từng đơn để bảng biết vẽ nút.

## 5. Log để soi (tiền tố `[label-archive]`)

- `lưu N đơn (mới a, đã có b), lỗi c — cỡ tệp mới: SHOPEE x phiếu y KB (z KB/phiếu)` — đo dung lượng thật từng sàn.
- `HÀNG CHỜ ĐẦY — bỏ lưu …`, `LỖI lưu <đường dẫn> …`, `in lại đơn … KB`, `dọn: xóa … tệp của … ngày`, `owner=… BẬT/TẮT gian …`.

## 6. Đã kiểm / chưa kiểm

**Đã kiểm (local, 06/11):** vitest `label-archive.test.ts` 28 ca (luật ngày + đường dẫn, lượt in → việc, hàng chờ: lưu / in
lại / thử lại / lỗi hẳn / hàng đầy / giới hạn song song, đọc lại: phiếu riêng / tách đúng trang / trả cả tệp gộp / chỉ đường
lạ, dọn theo lô, kho thư mục máy, ai được gạt); vitest `src/services src/lib src/workers src/routes` 85 tệp / 767 qua;
`npx tsc --noEmit` backend + frontend sạch; eslint hai tệp frontend sạch. Chạy thật trên local qua kho thư mục máy
(`backend/.local-uploads/order-labels`, chỉ khi không phải production): endpoint in lại trả đúng 4 ca; nút và hộp công tắc
đọc rõ ở sáng + tối; thêm nút không làm đổi bề rộng cột Trạng thái (161,7 px có và không có nút), 0 ô tràn ở 1280 và 1440.

**CHƯA kiểm:**
- Supabase Storage thật: lệnh liệt kê (`object/list`, dạng `prefix` + `sortBy`), mã trả khi tệp đã có / không có, tự tạo
  bucket với `allowed_mime_types` PDF + JSON. Mã viết theo tài liệu, chưa chạy với kho thật (local không có `SUPABASE_URL`).
- Lượt in thật qua sàn với công tắc bật (DB dev không có token gian) — phần nối vào `/bulk/labels` mới qua tsc + đọc mã.
- "1 trang / đơn" của tệp gộp Shopee: mới có mẫu 2 đơn. Không đúng thì in lại trả cả tệp gộp (đã có đường lùi + log).
- Lazada có trả phiếu sau khi lấy kiện không; cỡ phiếu TikTok / Lazada.
- Điều khoản lưu dữ liệu người mua: Shopee 90 ngày (điều 10.6–10.7 Data Protection Policy, đọc qua bài Zetpy 01/10/2024,
  trang gốc chưa mở được); TikTok, Lazada chưa tìm được con số.
- Bấm nút In lại phiếu ra hộp in thật của trình duyệt (mới gọi endpoint bằng fetch); nhân viên bị giới hạn gian; mobile.
- Cột Mã đơn giãn 546 px với tên gian 66 ký tự làm bảng cuộn ngang ở 1280 — có từ trước, không do lát này, chưa sửa.

## 7. Trước khi lên prod

1. Migration `20261106203000_channel_label_archive` (một cột NULL trên `Channel`, không đụng `Order`) tự áp khi deploy.
2. Không cần đặt env: nút "Lưu vận đơn" hiện với mọi chủ shop, gian nào cũng TẮT cho tới khi chủ shop tự gạt. Muốn ẩn: `LABEL_ARCHIVE_OWNERS=off` (hoặc danh sách id chủ shop) trên dịch vụ web.
3. Bật công tắc cho một gian, in thử vài đơn, soi log `[label-archive] lưu …` rồi bấm In lại phiếu sau khi kiện bị lấy.
4. Thêm một dòng về tệp vận đơn vào chính sách quyền riêng tư (`hubsell-landing/src/app/privacy`, mục 8).
5. **Cách bán — anh chốt 06/11 tối: KHÔNG thu phí riêng cho tính năng này lúc này** ("thà sau này nhích gói lên một tí còn hơn là thu nhiều lần làm khách khó chịu"; thu riêng còn kéo theo cổng thanh toán và việc gán kỳ của gói phụ theo kỳ gói chính). Tính năng mở miễn phí cho mọi chủ shop; hộp công tắc không ghi gì về phí. Hàm `labelArchiveAllowed` giữ nguyên làm chỗ chặn nếu sau này cần.
6. Việc còn mở: tên gian của khách đã hỏi (để báo họ bật), HQ có cần trang bật hộ không.

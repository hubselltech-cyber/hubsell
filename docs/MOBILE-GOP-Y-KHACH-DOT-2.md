# Mobile — góp ý khách đợt 2 (12/11/2026)

Trạng thái: **ĐÃ CODE (mục 7–9), anh Trung xem local xong; phát hành thành BẢN KHO 1.4.3 theo lệnh anh 12/11 tối (mục 10) — không đi OTA như dự tính ở mục 5.**

Nguồn: ảnh khách gửi anh Trung 12/11/2026 (7 ý). Anh trả lời 12/11:

- Ý 2 (đổi "Chờ đóng gói" → "Đang đóng gói"): **không làm**, để sau.
- Ý 1: ở màn quét xem chi tiết đơn, vuốt xuống cuối là **hành trình của bên vận chuyển** (lấy từ API sàn).
- Ý 5: thêm **"Chi phí vận hành"** (đóng gói, lương…) ngay dưới phần Gian hàng ở tab Tổng quan.
- Ý 6: bộ lọc ở **popup Thống kê nhặt hàng** của màn Đơn hàng — xem SKU của cả đơn mới ra, đang giao, thành công.

## 1. Hành trình vận chuyển trong chi tiết đơn

**Hiện trạng.** `OrderDetailPanel` (dùng chung cho màn quét `ScanScreen` và hộp chi tiết ở Đơn hàng `OrderDetailSheet`) chưa có hành trình. Backend đã có sẵn hàm gọi sàn, đang dùng cho Cứu đơn giao thất bại:

| Sàn | Hàm có sẵn | Trạng thái |
|---|---|---|
| Shopee | `getTrackingInfo` (`/api/v2/logistics/get_tracking_info`), 1 call / đơn | đã chạy thật |
| TikTok | `getOrderTracking` (`/fulfillment/202309/orders/{id}/tracking`) | đã chạy thật (payload 16/09) |
| Lazada | chưa có trong mã; API sàn là `/logistic/order/trace` | **chưa kiểm payload thật** |

**Phương án.**

- Backend: route mới `GET /api/orders/:id/tracking` → chuẩn hóa về `{ carrier, trackingCode, events: [{ at, description, kind }] }`, mới nhất trước. `kind` = thường / giao thất bại / đã giao / hoàn, để app tô màu.
- Một phần đặt cuối `OrderDetailPanel` → có ở cả màn quét lẫn Đơn hàng, không viết hai lần.
- Tiết chế số call (mỗi lượt xem = 1 call sàn):
  - đơn chưa có mã vận đơn / còn Chờ xử lý → không gọi, hiện "Đơn chưa giao cho đơn vị vận chuyển";
  - mở chi tiết từ Đơn hàng (chủ ý bấm) → tự tải;
  - ở màn quét → chỉ tải khi người dùng **vuốt xuống** (nhân viên quét liên tục không tốn call);
  - máy chủ nhớ kết quả 10 phút / đơn (đệm RAM, mất cũng chỉ tốn thêm 1 call); không quét nền, không lưu DB.
- Giao diện: cột mốc dọc, mốc mới nhất trên cùng và in đậm, giờ `dd/MM HH:mm`; đầu phần có hãng + mã vận đơn kèm nút sao chép; mốc giao thất bại màu đỏ. Đủ ca: đang tải, lỗi (nút Thử lại), sàn chưa có mốc nào.
- Lazada: làm sau một bước — gọi thử trên một đơn thật để xem payload rồi mới viết (luật "không làm điều chưa chắc"). Trong lúc chờ, đơn Lazada hiện dòng "Hành trình Lazada sẽ có ở bản sau".
- Đơn tách nhiều kiện (Shopee): bản đầu lấy kiện đầu tiên, ghi rõ giới hạn.

## 2. Chi phí vận hành ở Tổng quan

**Hiện trạng.** Web có trang Tài chính → Chi phí (`/api/expenses`: GET theo kỳ, POST, DELETE — không có sửa). App chỉ ĐỌC tổng chi phí vận hành ở trang Tài chính, chưa nhập được. Phần "Gian hàng" ở Tổng quan là khối **Thiết lập** cuối trang (hai ô Gian hàng · Giá vốn).

**Phương án.** Không đổi backend.

- Thêm ô **Chi phí vận hành** nằm ngang, ngay dưới hàng Gian hàng · Giá vốn; ô hiện tổng chi tháng này.
- Bấm vào → màn `/expenses`: chọn tháng, tổng chi của tháng, danh sách gom theo ngày, nút **Thêm khoản chi**.
- Form thêm (hộp trượt, ít ô nhất có thể): Nội dung · Số tiền · Nhóm (Mặt bằng / Nhân viên / Đóng gói / Quảng cáo / Khác — cùng chữ với web) · Ngày (mặc định hôm nay) · Gian áp dụng (mặc định Tất cả shop) · Ghi chú.
- Bỏ so với web: ô "Cố định / Biến đổi" (app tự suy theo nhóm: Mặt bằng, Nhân viên = cố định; còn lại = biến đổi), ô gắn SKU, và khoản THU — ba thứ này vẫn làm trên web.
- Xóa: giữ lâu vào dòng → hỏi lại rồi xóa (web cũng chỉ thêm / xóa).
- Thêm / xóa xong, số ở trang Tài chính (Lãi ròng) đổi theo.
- Tài khoản bị khóa gói hoặc không có quyền `finance.expenses` → hiện thẻ khóa như các màn khác.

## 3. Bộ lọc ở popup Thống kê nhặt hàng

**Hiện trạng.** App luôn ép `shippingStatus=PROCESSED&printed=yes` (chỉ Chờ đóng gói). Route `GET /api/orders/pick-summary` vốn đã nhận mọi trạng thái, nhưng **không có lọc ngày** → nếu mở cho "Đã giao" sẽ cộng toàn bộ lịch sử: số vô nghĩa và nặng DB.

**Phương án.**

- Hàng chip đầu popup: **Chờ xử lý** (đơn mới ra) · **Chờ đóng gói** (mặc định, như hiện nay) · **Đang giao** · **Đã giao**.
- "Đã giao" có thêm chọn kỳ: Hôm nay / Hôm qua / 7 ngày, tính theo ngày giao thành công. Backend thêm tham số `deliveredFrom` / `deliveredTo` cho `pick-summary` (đã có chỉ mục `channelId + deliveredAt`), trần 31 ngày.
- "Chờ xử lý" và "Đang giao" = toàn bộ đơn đang ở trạng thái đó, không cần ngày.
- Vẫn theo bộ lọc sàn / gian / hãng đang chọn ở màn Đơn hàng.
- Tên popup: "Phiếu nhặt hàng" khi ở Chờ đóng gói; các trạng thái khác là "Thống kê sản phẩm".

## 4. Ba lỗi đã rõ gốc

- **Nhãn lệch ngoài / trong.** Thẻ đơn dùng `statusBadgeOf` (theo bước đóng gói), chi tiết dùng `SHIPPING_STATUS` → dời `statusBadgeOf` ra `lib/labels.ts`, hai nơi dùng chung.
- **Quét đóng gói đếm đơn hủy lặp.** `PackScanScreen.announce` cộng ô đếm mỗi lượt quét. Sửa: đếm theo mã đơn (mỗi đơn một lần); bấm ô "Đơn hủy" mở danh sách đơn hủy đã quét trong lượt (mã đơn + nút sao chép).
- **Thông báo hủy ngang.** `orderCancelledMessage` (backend `integrations/cancel-request.ts`): kiện đã bàn giao thì link là `/warehouse/returns` không kèm mã → app nhảy tab Đơn hoàn trơn. Sửa:
  - backend gắn mã đơn vào link;
  - app: bấm thông báo đơn hủy → mở thẳng **chi tiết đúng đơn đó**;
  - dòng thông báo có mã đơn kèm nút sao chép, nội dung thông báo hủy hiện đủ (hiện bị cắt 3 dòng);
  - thông báo cũ (link chưa có mã): app tự đọc mã từ tiêu đề.

## 5. Phát hành

- Backend lên trước (route hành trình, lọc ngày cho pick-summary, link thông báo) — bản app cũ không bị ảnh hưởng.
- App: toàn bộ là JS, `expo-clipboard` đã có trong bản 1.4.2 → đi **OTA runtime 1.4.2**, không cần nộp kho.
- Trước khi OTA: rà ca âm / 0 / rỗng (checklist DUA-APP mục 9), soi 320–390 px + giao diện tối, gửi ảnh theo trình tự khách gặp.

## 6. Chưa kiểm

- Payload thật của Lazada `/logistic/order/trace`.
- Tiếng của `description` Shopee / TikTok trả về (dự kiến tiếng Việt theo gian VN) — xem khi chạy thử trên đơn thật.

## 7. Đã làm 12/11 (local, chưa commit)

Anh: "Code từng phần trên local để anh xem giao diện, gặp vấn đề mình sẽ sửa luôn".

**Ba lỗi**

- `lib/labels.ts` `orderStatusBadge` — thẻ đơn và dòng Trạng thái trong `OrderDetailPanel` dùng chung.
- `PackScanScreen`: ô đếm cộng theo khóa `ô đếm + id đơn` (mã vừa quét khi không ra đơn); ô "Đơn hủy" bấm được → hộp danh sách đơn hủy của lượt quét, mỗi dòng có nút Sao chép.
- Thông báo hủy ngang:
  - backend `orderCancelledMessage`: kiện quay đầu link `/warehouse/returns?search=<mã>` (web Đối soát đơn hoàn đọc `?search=` đổ vào ô tìm);
  - `notification-target.ts`: type `order_cancelled` → đích `orders` + `openOrder`; mã lấy từ `?search=`, thông báo cũ link trơn thì đọc ở cuối tiêu đề (`notificationOrderCode`);
  - màn Đơn hàng nhận `?open=1` → `lookupOrder(mã)` rồi mở hộp chi tiết, không phụ thuộc tab trạng thái;
  - dòng thông báo: dải Mã đơn + Sao chép, nội dung thông báo hủy hiện đủ, chữ cuối dòng "Xem đơn"; chi tiết đơn có nút sao chép mã đơn.

**Popup Thống kê** (`PickSheet` trong `(admin)/orders.tsx`)

- Chip cuộn ngang: Chờ xử lý · Chờ đóng gói · Đang giao · Đã giao, có số đếm từ bảng đếm của màn Đơn hàng (Đã giao không hiện số).
- Mở theo tab đang đứng (Chờ xử lý / Đang giao / Đã giao), các tab khác = Chờ đóng gói. **Khác phương án ban đầu** ("mặc định luôn Chờ đóng gói") — em chọn vì người đang xem tab nào thường muốn số của tab đó.
- "Đã giao": Hôm nay / Hôm qua / 7 ngày → `deliveredFrom/To`; backend từ chối kỳ quá 31 ngày (`PICK_DELIVERED_MAX_DAYS`, tự chọn).
- Món hỏa tốc chỉ tô đỏ ở hai nhóm còn phải nhặt (Chờ xử lý, Chờ đóng gói).

**Chi phí vận hành**

- Ô ở Tổng quan: **cùng cỡ và thẳng hàng với ô Gian hàng**, nằm ngay dưới nó; ô bên phải để trống giữ chỗ (anh Trung 12/11: "về sau mình còn thêm các mục khác bên cạnh" — bản đầu em làm ô ngang hết hàng, anh bảo đổi). Ô giữ chỗ phải mang cùng đệm + viền với ô thật thì hai ô mới bằng nhau.
- Màn `/expenses` (`ExpensesScreen`): bộ chọn tháng, tổng chi, thanh theo nhóm, danh sách gom theo ngày, nút Thêm dính đáy. Form: Số tiền · Nhóm · Nội dung (bỏ trống = tên nhóm) · Ngày (lùi / tới từng ngày, không cho ngày tương lai) · Áp dụng cho (chỉ hỏi khi shop có từ 2 gian) · Ghi chú. Xóa: bấm dòng → hộp chi tiết → Xóa → hỏi lại.
- Không đổi backend.

**Hành trình vận chuyển**

- Backend `services/order-tracking.ts` + `GET /api/orders/:id/tracking`: Shopee, TikTok; Lazada / gian chưa nối API trả `unsupported`; đơn Chờ xử lý hoặc chưa có mã vận đơn trả `not_shipped` (không gọi sàn); đệm RAM 10 phút, tối đa 2.000 đơn; sàn lỗi → 502.
- App `OrderTrackingSection` cuối `OrderDetailPanel`: mã vận đơn + Sao chép, cột mốc (5 mốc đầu, "Xem cả N mốc"), mốc giao thất bại đỏ. Mở từ Đơn hàng tự tải; màn quét chỉ tải khi vuốt xuống quá 24 px hoặc bấm "Xem hành trình".
- `ORDER_TRACKING_FAKE=1` (chỉ ngoài production): trả 7 mốc mẫu để soi giao diện trên máy dev — launch config `backend-http-tracking-demo`.

**Kiểm**

- tsc mobile + backend sạch; eslint các tệp mới / sửa của mobile sạch; test mobile 62/62 (thêm 5 ca đích thông báo), backend: `order-tracking` 6 ca mới, `cancel-request-plan` sửa 1 ca, `pick-summary` qua.
- Giả lập web local (tài khoản demo, backend 4010): thêm rồi xóa một khoản chi (tổng 23.400.000 → 23.750.000 → 23.400.000); popup Thống kê nhóm Đã giao hôm nay ra 5 đơn / 10 sản phẩm; thông báo hủy link cũ mở đúng chi tiết đơn; nút Sao chép trên thông báo không làm nhảy màn; quét hai lần một đơn hủy → ô Đơn hủy vẫn 1, danh sách 1 dòng; soi 390 px sáng + tối, ô Tổng quan đo ở 320 và 390 (ba ô cùng bề rộng, cùng mép).

**Chưa kiểm**

- Hành trình với dữ liệu THẬT của Shopee / TikTok (local chỉ có mốc mẫu): chữ sàn trả, đơn tách kiện, đơn sàn không có hành trình.
- Máy thật: bàn phím che form chi phí, vuốt xuống ở màn quét có kích tải hành trình không, sao chép vào bộ nhớ tạm, nhãn "Chi phí vận hành" tự co chữ ở máy 320 px (trên web bị cắt "…").
- Trang web Đối soát đơn hoàn đọc `?search=` — chưa mở trình duyệt thử (eslint tệp sạch).
- `expo lint` cả dự án vẫn 41 lỗi có từ trước ở tệp khác; chưa chạy toàn bộ test backend.
- Checklist DUA-APP mục 9 chưa chạy.

**Dữ liệu thử trong DB local:** đã dọn 12/11 tối (khoản chi + thông báo `[M2DEMO]`); 9 đơn Đã giao của tài khoản demo vẫn mang `deliveredAt` hôm 11–12/11. Tệp seed tạm đã xóa.

## 8. Quét đóng gói: quét lần hai bị đơ / báo "không thấy đơn" (12/11 tối)

Anh Trung thử máy thật bản 1.4.2: quét hai lần vào một đơn hay bị đơ; quét lần hai vào một đơn hủy còn báo không xác định được đơn. Anh chốt nguyên tắc: **quét lần hai phải hiện là đã quét trùng**.

**Gốc** (tái hiện bằng test có độ trễ máy chủ 200 ms — bộ test 05/11 giả định máy chủ trả lời tức thì nên không lộ):

1. `pack-scan-gate.ts` xét "mã đã xử lý, còn trong khung" bằng lần thấy gần nhất, mà lần thấy được làm mới cả ở lượt đọc bị từ chối vì máy đang bận. Đưa lại kiện đúng lúc có lượt gọi khác → mã bị khóa mãi → không gửi, không kêu.
2. Quét lại kiện mà camera đọc mã phân tuyến trước: mã phân tuyến chiếm lượt gọi (404), mã vận đơn bị khóa theo (1) → chỉ còn câu "không thấy đơn".
3. Hai mã vạch đã biết của cùng một đơn khóa chéo nhau theo luật "cùng tem" khi cùng trở lại lúc máy bận.
4. `PackScanScreen` im lặng 10 giây theo id đơn (`SAME_ORDER_QUIET_MS`) → đưa lại kiện trong 10 giây là im, dù máy chủ đã trả "đã quét rồi".

**Sửa — đổi thiết kế, không chỉnh ngưỡng** (REARM 2 s, COMPANION 0,6 s giữ nguyên):

- Cửa tính theo **lượt đưa kiện**: mã vắng khung đủ `REARM_MS` rồi thấy lại thì được cấp lại quyền hỏi máy chủ (cờ `armed`), quyền chỉ mất khi mã thật sự được gửi đi hoặc mã vạch khác của cùng đơn đã lo xong lượt đó.
- Luật "cùng tem" chỉ tính mã đã lo xong lượt này (đang gọi, hoặc gọi xong và còn trong khung) → hết khóa chéo.
- Mã từng không ra đơn trở lại khung: nhường `COMPANION_MS` cho mã vận đơn đi trước (verdict mới `hold`); tem chỉ còn mã đó thì 0,6 giây sau vẫn hỏi máy chủ.
- `gate.resolved(mã, id đơn, lúc)` trả `first / alias / repeat`. Màn quét chỉ im khi `alias` (mã vạch khác của tem đang nằm trong khung); `repeat` luôn báo. Bỏ hẳn `SAME_ORDER_QUIET_MS`.
- Đơn hủy quét lại: vẫn màn đỏ + còi hủy, câu đổi thành "Kiện này đã quét rồi — vẫn bỏ lại, không đưa ship". Đơn thường quét lại: máy chủ trả "đã quét rồi" → màn vàng "KIỆN NÀY ĐÃ QUÉT RỒI" như thiết kế cũ, nay không còn bị nuốt.

**Kiểm:** 9 ca test mới cho cửa (3 ca đỏ trên bản cũ, xanh trên bản mới), 1 ca cho câu báo; 12 ca cũ của cửa vẫn qua; tổng mobile 71/71; tsc + eslint sạch. Giả lập web: gõ tay hai lần một đơn hủy → lần hai ra câu "đã quét rồi", ô Đơn hủy vẫn 1.

**Chưa kiểm:** camera + tem thật (web không có camera) — phải thử lại trên máy sau OTA. Ca còn im theo thiết kế: giữ nguyên kiện trong khung không nhấc ra; đưa ra rồi đưa vào lại trong chưa tới 2 giây.

## 9. Popup Thống kê: đủ 6 nhóm theo dây chuyền của đơn (12/11 tối)

Anh Trung xem local hỏi: "Khi khách chuẩn bị hàng mà chưa in đơn thì những đơn hàng đó thuộc phần nào?" — bản 4 nhóm ở mục 3 và mục 7 **bỏ sót** đơn Đã xử lý chưa in phiếu và đơn Đã đóng gói: hai loại này không nằm ở nhóm nào.

Sửa: 6 chip theo đúng thứ tự đơn đi qua — **Chờ xử lý · Chưa in phiếu · Chờ đóng gói · Đã đóng gói · Đang giao · Đã giao**. Đơn chưa hủy nào cũng thuộc đúng một nhóm (local: 24 + 37 + 102 + 9 = 172 = Chờ xử lý 24 + Đã xử lý 148).

- `PickGroup` thêm `NOT_PRINTED` (`printed=no`) và `PACKED` (`printed=packed`); không đổi backend.
- Số trên chip lấy từ bảng đếm sẵn có (`PROCESSED_NOT_PRINTED`, `PROCESSED_PACKED`).
- Mở popup khi đang lọc chip con Chưa in phiếu / Đã đóng gói ở màn Đơn hàng → mở đúng nhóm đó.
- Hàng chip nay dài hơn màn → chip đang chọn tự trượt vào tầm nhìn (lúc mở và lúc bấm), chừa 56 px lộ chip đứng trước.
- Món hỏa tốc tô đỏ ở ba nhóm còn phải lấy hàng: Chờ xử lý, Chưa in phiếu, Chờ đóng gói.

## 10. Phát hành bản kho 1.4.3 (12/11 tối)

Anh Trung: "Dọn dẹp sạch code thừa, đảm bảo cấu trúc tree chuyên nghiệp, commit và push sau đó nộp lên apple và google".

**Dọn trước khi commit**

- `PickSheet` (popup Thống kê, 368 dòng) tách khỏi `app/(admin)/orders.tsx` sang `components/PickSheet.tsx` — màn Đơn hàng còn 916 dòng, không đổi hành vi.
- Xóa tệp seed tạm `backend/scripts/_tmp_seed_mobile_dot2.ts`, dọn dữ liệu `[M2DEMO]` trong DB local.
- Giữ lại có chủ đích: `ORDER_TRACKING_FAKE` trong `services/order-tracking.ts` + launch config `backend-http-tracking-demo` (cách duy nhất soi giao diện hành trình trên máy dev, bị khóa khi `NODE_ENV=production`).
- KHÔNG đưa vào commit: `tools/mail-digest/unflag.js` (việc cục bộ của phiên khác), `hubsell-marketing/kenh/tiktok/KICH-BAN-TRUY-THU-SHIP-NGANH-NANG-2026-11-10.md` (bài nháp).

**Vì sao là bản kho chứ không OTA:** toàn bộ thay đổi là JS nên OTA runtime 1.4.2 cũng tới được khách; anh chọn nộp kho. Hệ quả: `version` lên 1.4.3 = runtime OTA mới 1.4.3; khách còn ở 1.4.2 chỉ nhận thay đổi khi cập nhật từ kho.

**Checklist mục 9 của DUA-APP — nói rõ phần bỏ qua:** ca 1–5 (Tài chính) không chạy lại, mã Tài chính không đổi; ca 6–7 chỉ soi các màn mới / sửa trên giả lập web 390 px sáng + tối, ô Tổng quan đo thêm ở 320; ca 8 (quét đóng gói) chỉ thử gõ tay trên web — **chưa thử camera + tem thật dù luật chống bắn lặp vừa viết lại**; ca 9 đối chiếu bằng tổng các nhóm (172 đơn), chưa so với popup web; ca 10 không chạy (mã Tồn kho không đổi).

## 11. Quét nhiều đơn — chế độ thứ ba của tab QR giữa (12/11 khuya)

**Nguồn.** Một khách đang dùng ShipXanh nhắn anh Trung: "phần xem đơn để chế độ quét nhiều đơn xong xem thống kê thì sẽ tiện hơn với các shop nhờ ship TikTok buổi trưa"; ảnh ShipXanh: tab Xem đơn → Quét nhiều → danh sách mã đã quét → "Xem hàng" cộng sản phẩm của các đơn vừa quét (công tắc Gộp SKU). Anh: "Em build gọn gàng và đẹp hơn ShipXanh cho anh".

**Vì sao Phiếu nhặt hàng / popup Thống kê không thay được:** hai thứ đó cộng theo cả nhóm trạng thái; lô giao buổi trưa là một XẤP KIỆN cụ thể, chỉ quét mới khoanh đúng. Chưa hỏi lại khách dùng lúc bàn giao hay lúc nhặt hàng — hai cách dùng cần cùng một tính năng.

**Đã làm**

- Công tắc tab QR: **Xem đơn · Quét nhiều · Đóng gói** (`ScanChrome`, `ScanDetailTab`; nhớ chế độ dùng lần trước).
- `screens/BatchScanScreen.tsx`: quét liên tục, CHỈ XEM (không đổi trạng thái đơn). Dải đáy: kết quả gần nhất, ba ô Kiện · Đơn hủy · Món (bấm được), nút "Xem hàng trong lô", ô gõ tay.
- `components/BatchSheet.tsx` — hộp "Lô đã quét": ba con số (kiện, sản phẩm, SKU) + chia theo sàn / hãng; tab **Hàng** (theo sản phẩm / theo SKU, mỗi dòng có số đơn chứa món đó) và tab **Kiện** (mới nhất trước, đơn hủy lên đầu tô đỏ, chép mã, bỏ từng kiện, Xóa lô có hỏi lại).
- **Đơn ĐÃ HỦY lẫn trong lô:** còi + màn đỏ như Quét đóng gói, nằm riêng, KHÔNG tính vào số hàng. Khách đang xin hủy: màn vàng, vẫn tính hàng, có dòng nhắc.
- `lib/batch-scan.ts` (thuần, 8 ca test): cộng hàng cùng luật gom với Phiếu nhặt hàng; câu báo từng trường hợp. `lib/batch-scan-store.ts`: lô giữ ngoài màn hình → không mất khi đổi chế độ / rời tab; mất khi Xóa lô hoặc tắt hẳn app.
- Dùng lại cửa chống bắn lặp `pack-scan-gate.ts`. Tách phần dùng chung của hai màn quét liên tục: `components/ScanFlash.tsx` (màn báo, màu, rung) và `components/ScanTopBar.tsx` — `PackScanScreen` nay dùng hai tệp này, hành vi không đổi.
- Backend `GET /api/orders/lookup?fast=1`: chỉ đọc DB, bỏ hai nhánh hỏi sàn (làm mới trạng thái hoàn, tự chữa lành khi tra trượt). Không có cờ này thì mỗi mã phân tuyến trên tem kích một lượt đồng bộ mọi gian. App cũ / máy chủ cũ vẫn chạy (cờ bị bỏ qua).

**Không làm:** nút "Tạo phiếu" của ShipXanh (chưa rõ là phiếu gì; biên bản bàn giao đang ở web).

**Kiểm:** tsc + eslint sạch; test mobile 79/79. Giả lập web: thêm 3 kiện + 1 đơn hủy → 2 kiện / 1 đơn hủy / 3 món, hộp Lô đã quét đúng hai tab; quét lại mã đã có → "đã có trong lô", số không đổi; Quét đóng gói sau khi tách phần dùng chung vẫn báo đơn hủy.

**Chưa kiểm:** camera + tem thật (cả màn này lẫn cửa chống bắn lặp vừa viết lại); máy 320 px và giao diện tối của hộp Lô đã quét; lô vài trăm kiện. Trên giả lập web, đổi chế độ hiện lỗi dev "wake lock … has not activated yet" của `expo-keep-awake` — chưa xác minh có từ trước hay không, bản web không phát hành.

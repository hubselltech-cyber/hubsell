# Mobile — nâng cấp đợt 3 (26/11/2026)

Trạng thái: **ĐANG LÀM — mục 1 + 2 đã code LOCAL (kèm lát lưu mốc hãng ở backend), anh Trung xem trên local; CHƯA commit / chưa push / chưa OTA / chưa thử máy thật.** Lưu ý thứ tự phát hành: lát lưu mốc có migration backend — backend lên prod trước rồi mới OTA app (app chạy với backend cũ vẫn đúng, chỉ là bộ lọc chưa gồm kiện hãng báo).

Nguồn: anh Trung 26/11/2026 tối ("buổi hôm nay sẽ nâng cấp rất nhiều"), gửi từng ý kèm ảnh khoanh đỏ. Mỗi ý một mục; ý mới ghi nối xuống dưới.

## 1. Kho › Đơn hoàn: trạng thái "Ship báo đã hoàn" + bộ lọc

**Anh nói:** "Hiện tại trạng thái chỉ có 'Chờ hàng về' chứ chưa có trạng thái 'Ship báo đã hoàn' — cần cập nhật vào trạng thái và cả bộ lọc" (khoanh nút Bộ lọc và viên nhãn trên dòng đơn).

**Hiện trạng trước khi sửa.** App chỉ đọc tình trạng KHO (`returnStatus`). Web Đối soát đơn hoàn đã có cột "Trạng thái vận chuyển" từ 13/11 (`backend/src/lib/return-shipping.ts`, `docs/DOI-SOAT-DON-HOAN-HANG-LOAT-VA-THAT-THU.md` mục 12 + 14); backend đã trả sẵn `returnShipping` cho từng đơn, `shippingCounts`, nhận tham số lọc `ship=` — app chưa dùng.

**Đã làm — phần hiển thị + bộ lọc chỉ sửa app** (backend chỉ đổi ở lát lưu mốc, xem đoạn "Bộ lọc + kiện giao thất bại" bên dưới):

| Chỗ | Thay đổi |
|---|---|
| Viên nhãn trên dòng (tab Chờ nhận hoàn) | Sàn / hãng báo kiện ĐÃ VỀ shop mà kho chưa quét → **"Ship báo đã hoàn"** (xanh) thay cho "Chờ hàng về" |
| Dòng phụ mới dưới mã vận đơn | Chấm màu + câu: `Sàn báo 25/11 18:53 · kho chưa quét nhận` (đỏ) · `Hãng báo …` (đỏ) · `Đang hoàn về · sàn chưa báo kiện về tới` · `Chờ khách gửi hàng` · `Giao thất bại, kiện quay đầu` · `Chưa có tin từ hãng` |
| Sheet Bộ lọc (tab Chờ nhận hoàn) | Nhóm mới **Trạng thái vận chuyển**: Tất cả · Ship báo đã hoàn · Đang hoàn về · Chờ khách gửi hàng · Giao thất bại · Chưa có tin từ hãng — kèm số đơn từng nhóm; chọn xong có chip gỡ nhanh cạnh nút Bộ lọc |

Chữ "Ship báo đã hoàn" là chữ anh chọn cho app; web cùng nhóm đang ghi "Hoàn thành công" (chưa đổi, chờ anh nói có thống nhất không).

**Hai nguồn — cùng luật với web:**

1. Đơn KHÁCH TRẢ HÀNG: `returnShipping` backend tính từ cột đã lưu → 0 lệnh gọi sàn.
2. Kiện GIAO THẤT BẠI quay đầu: API hoàn của sàn không nói gì về chặng về → app hỏi hành trình hãng qua `POST /api/warehouse/returns/carrier-status` (đường web đang dùng) cho các dòng đang hiện.

**Số lệnh gọi sàn (đã tính trước khi làm):** chỉ hỏi dòng thuộc diện (giao thất bại + chờ về + có mã vận đơn + Shopee / TikTok), lô 10 đơn tuần tự, mỗi đơn 1 lệnh gọi, backend đệm 10 phút, app nhớ đã hỏi 10 phút (kéo làm mới / đổi bộ lọc không hỏi lại). Trang app 20 đơn → **nhiều nhất 20 lệnh gọi cho một lượt mở tab Đơn hoàn**, bấm "Xem thêm" mới hỏi 20 đơn kế. Web hiện hỏi tới 100 đơn / trang, nên app không vượt mức đã chấp nhận. Tab Tồn kho không gọi gì (màn Đơn hoàn chỉ dựng khi bấm sang).

**Bộ lọc + kiện giao thất bại hãng đã trả — ĐÃ LÀM lát lưu mốc (anh Trung 26/11: "Làm lát lưu mốc"), chi tiết `docs/DOI-SOAT-DON-HOAN-HANG-LOAT-VA-THAT-THU.md` mục 19.** Lúc đầu mốc hãng trả kiện chỉ biết khi hỏi hành trình và không lưu, nên 6 dòng mang nhãn "Ship báo đã hoàn" mà bộ lọc chỉ ra 3. Nay backend ghi mốc một lần vào cột riêng `Order.returnCarrierReturnedAt` lúc dòng được hỏi hãng → bộ lọc ra đủ 6, đơn có mốc không bị hỏi sàn nữa, app tự tải lại số đếm nhóm lọc khi hãng vừa báo. **Giới hạn còn lại:** kiện chưa ai mở xem thì chưa có mốc (vẫn ở "Giao thất bại") — shop hàng nghìn kiện chờ về thì số ở chip là số đã biết; muốn đủ phải quét nền (≈ 10.000 lệnh gọi sàn / ngày, **⏳ anh quyết**, chưa làm).

**Tệp:**

- `hubsell-mobile/src/lib/return-shipping.ts` — luật thuần (nhãn nhóm lọc, đơn nào cần hỏi hãng, dòng phụ nói gì) + `return-shipping.test.ts` (9 ca).
- `hubsell-mobile/src/lib/useReturnCarrierStatus.ts` — hook hỏi hãng theo lô.
- `hubsell-mobile/src/api/warehouse.ts` — tham số `ship`, `fetchReturnCarrierStatus`.
- `hubsell-mobile/src/types/api.ts` — `ReturnShippingDto`, `ReturnShippingFilter`, `ReturnCarrierStatus`, `shippingCounts`.
- `hubsell-mobile/src/lib/labels.ts` — `RETURN_SHIP_RETURNED`.
- `hubsell-mobile/src/screens/WarehouseHubPage.tsx` — nhãn, dòng phụ, nhóm lọc.

**Lỗi tránh được khi chép hook từ web:** bản web gỡ dấu "đã hỏi" của các lô chưa gửi ở TRONG vòng lặp (sau khi lô đang bay về). Trên app danh sách NỐI THÊM khi bấm "Xem thêm" (web thì thay cả trang), nên lượt kế chạy trước khi dấu được gỡ → các dòng của lô 2 treo mãi ở "Đang hỏi hãng…". Bản app gỡ dấu ngay trong hàm dọn của effect.

## 2. Kho › Đơn hoàn: bốn khối số bấm vào ra đúng đơn

**Anh nói (khoanh bốn khối số):** "khối này click vào chưa ra đơn cụ thể. khách hàng đang khá khó chịu".

**Đã làm:** bốn khối = bộ lọc bấm được, cùng nết thẻ lọc của web.

| Khối | Bấm vào thì danh sách là | Gửi backend |
|---|---|---|
| Chờ hàng về | tab Chờ nhận hoàn, không lọc (mặc định) | `status=AWAITING` |
| Đã nhận · chờ nhập kho | tab Đã nhận hoàn, trạng thái Đã nhận · chờ nhập kho | `status=RECEIVED` |
| Quá 14 ngày chưa về | tab Chờ nhận hoàn, chỉ đơn quá hạn | `status=OVERDUE` (backend đã có) |
| Hàng hỏng · chờ khiếu nại sàn | tab Đã nhận hoàn, trạng thái Hàng hỏng | `status=DAMAGED` |

- Khối khớp danh sách đang hiện có **viền màu của chính khối**; bấm lại khối đang chọn = về mặc định.
- Bấm khối thì màn **tự cuộn tới danh sách** và có chip gỡ nhanh cạnh nút Bộ lọc.
- Nhãn khối cho xuống 2 dòng — trước bị cắt "Đã nhận · chờ nhậ…", "Hàng hỏng · chờ k…".
- Số trên khối = số đơn danh sách ra (cùng một câu đếm của backend). Bộ lọc sàn áp cho cả khối lẫn danh sách như cũ.

## 3. Kiểm

- Kiểm kiểu app sạch (`tsc --noEmit`); `return-shipping.test.ts` 10 / 10 (thêm ca "mốc hãng đã lưu"). Lint: 3 lỗi của `WarehouseHubPage.tsx` có từ trước (đã so với bản chưa sửa), mã mới không thêm lỗi.
- Local (app bản web 375 × 812, backend local + hành trình giả `ORDER_TRACKING_FAKE=1`, tài khoản thử 16 đơn hoàn đủ ca kể cả mã đơn 23 ký tự + tên khách dài): danh sách, sheet lọc, lọc "Ship báo đã hoàn" (3 đơn), khối Quá 14 ngày (1 đơn), khối Hàng hỏng (1 đơn) — sáng + tối.
- **CHƯA:** máy thật / máy ảo Android + iOS · cỡ chữ lớn 1,2× · màn 320 px · dữ liệu thật của sàn (câu chữ hành trình TikTok giao thất bại vẫn chưa đối chiếu — docs Đối soát mục 12) · commit · OTA.
- Ghi nhận khi xem local: trên bản WEB của app ảnh sản phẩm của dòng đơn hoàn nằm TRÊN chữ (trên điện thoại nằm bên trái như ảnh anh chụp) — lệch riêng của bản web, có từ trước, không thuộc đợt này.

## 4. Phát hành (chưa làm)

Toàn bộ là JS → đi OTA được. Lưu ý: máy anh đang chạy 1.5.1 TestFlight dựng từ nhánh thử `thu/video-dong-goi-lat-0` (có nút "Quay video khui hàng" chen giữa nút quét và hàng tab của chính màn này) — gộp master vào nhánh thử sẽ đụng `WarehouseHubPage.tsx`; khách kho đang 1.4.3 / 1.5.0 (xem `mobile-index` + `DUA-APP-LEN-CH-PLAY-APP-STORE.md` mục OTA).

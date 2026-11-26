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

## 5. Tài chính: thêm Thất thu hàng mất/hỏng

**Anh nói:** "Trong 'tài chính' cần in thêm chi phí thất thu hàng hỏng" (đây cũng là việc anh dặn nhắc khi nâng cấp app bản sau, 13/11 — `docs/DOI-SOAT-DON-HOAN-HANG-LOAT-VA-THAT-THU.md` mục 10).

**Hiện trạng trước khi sửa (màn Tài chính của app, ba khối đọc số chi phí):**

| Khối | Trước | Sau |
|---|---|---|
| Thẻ Chi phí (bấm bung "Chi phí theo khoản") | ĐÃ có dòng "Thất thu hàng mất/hỏng" — app in nguyên danh sách backend trả | không đổi |
| Bóc tách dòng tiền (thác nước) | thất thu của đơn sàn hủy bị gộp vào bậc "Vận hành", của đơn tính doanh thu nằm trong "Giá vốn" — không thấy tên | bậc riêng **"Thất thu"** ngay sau Vận hành; Giá vốn và Vận hành gỡ phần đó ra |
| Cơ cấu chi phí (vòng + chú thích) | phần thất thu của đơn sàn hủy KHÔNG có lát nào → "tổng chi" ở tâm vòng thấp hơn thẻ Chi phí đúng bằng khoản đó | lát riêng **"Thất thu hàng mất/hỏng"** (màu `#be123c` như web); tổng ở tâm khớp lại |

**Công thức — y web Tổng quan (`frontend/src/app/page.tsx`), backend không đổi:** Giá vốn = `totalCost − damagedLossInCost`; Vận hành = `totalOperatingExpense − quảng cáo − (damagedLoss − damagedLossInCost)`; bậc / lát mới = `damagedLoss`. Số ghi theo NGÀY KHO BÁO HỎNG (anh chốt 20/11). Bậc / lát 0 đồng tự ẩn — shop không có đơn báo hỏng trong kỳ thấy màn như cũ. Backend bản cũ không gửi hai trường → vẽ như trước.

**Tệp:** hai hàm `costSegments` / `waterfallSteps` chuyển từ `FinancePage.tsx` sang `hubsell-mobile/src/lib/finance-breakdown.ts` (thuần) để có test `finance-breakdown.test.ts` (5 ca) giữ hai đẳng thức với mọi bộ số, kể cả phần ngoài giá vốn ÂM: Σ lát = phí sàn + giá vốn + chi phí hoạt động; Tổng giá trị SP − Σ bậc = Lãi ròng. `types/api.ts` thêm `damagedLoss`, `damagedLossInCost`.

**Kiểm:** test 5 / 5, kiểm kiểu sạch (lint: 3 mục của `FinancePage.tsx` có từ trước). Local kỳ 30 ngày với 1 đơn báo hỏng 92.000 đ: thẻ Chi phí 92 k (dòng Thất thu 92.000 đ) = bậc Thất thu −92 k = lát 92 k; 219 k − 92 k = 127 k = Lợi nhuận ròng; sáng + tối. **CHƯA:** máy thật, ca có cả hai loại thất thu cùng kỳ trên dữ liệu thật, so trực tiếp với màn web cùng tài khoản.

## 6. Trợ lý Hubsell: bàn phím che ô nhập chat

**Anh nói:** "Trợ lý Hubsell trên app khi khách sử dụng và chat thì khi thanh bàn phím hiện lên thì khu vực nhập chat bị che mất (giống trường hợp đăng ký, đăng nhập lần trước) — Fix luôn lỗi vặt này."

**Gốc (đọc mã, CHƯA tái hiện trên máy thật):** màn `/assistant` mở dạng `presentation: "modal"` — trên iOS là TỜ TRƯỢT không sát mép trên màn hình. `KeyboardAvoidingView` tính phần bị che bằng "đáy của nó trong KHUNG CHA − mép trên bàn phím trên MÀN HÌNH", nên thiếu đúng khoảng tờ trượt cách mép trên (cỡ 55–60 pt trên iPhone có tai thỏ) → thanh nhập (cao ~86 pt gồm vùng an toàn đáy) bị che gần hết ô gõ. Khác ca Đăng nhập / Đăng ký 19/10 (ở đó là không tự cuộn ô đang gõ); Android mở màn này phủ kín nên phép tính cũ không lệch.

**Sửa:** bỏ `KeyboardAvoidingView` ở màn Trợ lý, dùng `useKeyboardLift` (hook các màn quét đang dùng): lúc bàn phím mở, ĐO vị trí thật của màn trong cửa sổ rồi đệm đáy đúng phần bị che → không phụ thuộc màn nằm ở đâu, đúng cả Android tràn viền. Kèm: bàn phím mở thì thanh nhập bỏ khoảng vùng an toàn đáy (ngồi sát bàn phím); khung hội thoại tự cuộn xuống tin mới nhất khi bàn phím mở. Hook thêm tùy chọn `animate` (chỉ iOS, trượt cùng nhịp bàn phím như `KeyboardAvoidingView`), mặc định tắt — ba màn quét không đổi.

**Tệp:** `hubsell-mobile/src/app/assistant.tsx`, `hubsell-mobile/src/lib/useKeyboardLift.ts`.

**Kiểm:** kiểm kiểu sạch; bản web của app: màn Trợ lý mở, hỏi – đáp, bố cục như cũ (web không có bàn phím ảo nên KHÔNG kiểm được chính lỗi này). **CHƯA:** iPhone thật / TestFlight (nơi lỗi xảy ra), Android thật. Đây là màn modal duy nhất của app; các hộp nhập khác (Giá vốn, Thu chi, Tồn kho) dùng `Modal` phủ kín nên không dính ca này.

## 7. Soi giao diện trên Android cỡ chữ lớn (26/11/2026 khuya)

**Anh nói:** "Em xem lại phần giao diện đã đẹp chưa? Đừng để gặp vấn đề trên các màn hình android như hôm trước" (hôm 23/11: máy Samsung để cỡ chữ lớn, chữ đè nhau).

**Cách soi:** máy ảo Android `hubsell` chạy ngầm, bản debug `vn.hubsell.app` nạp mã master qua Metro, `font_scale 1.5` (app chặn ở 1,2×) + `wm density 480` (màn 360dp) và `540` (màn 320dp), sáng + tối; đăng nhập tài khoản thử có 16 đơn hoàn đủ ca (mã đơn 23 ký tự, tên khách dài). Đọc chữ + tọa độ bằng `uiautomator dump`, chụp bằng `screencap`.

**Tìm ra và đã sửa:**

| Chỗ | Trên Android cỡ chữ lớn | Sửa |
|---|---|---|
| Dòng đơn hoàn — mã đơn + nhãn trạng thái | nhãn dài ("Hàng hỏng · chờ khiếu nại sàn", "Ship báo đã hoàn") ép mã đơn cụt còn vài ký tự; ở 320dp nhãn rộng hơn cả hàng (lỗi có từ trước với nhãn Hàng hỏng) | hàng tự xuống dòng: vừa thì mã trái nhãn phải như cũ, không vừa thì nhãn xuống dòng dưới — mã đơn luôn đủ |
| Dòng đơn hoàn — "sàn · tên khách" + "chờ N ngày" | chữ trên máy thật không tự co → tên khách dài đẩy "chờ N ngày" ra mép | tên khách co + cắt "…", số ngày giữ nguyên |
| Bốn thẻ số | 320dp: "Hàng hỏng · chờ khiếu nại sàn" cần 3 dòng, bản đầu cho 2 dòng nên bị cắt | cho tới 3 dòng, thẻ cùng hàng tự cao bằng nhau |
| Ô nhập của Trợ lý | ô cao cứng 40 → chữ gợi ý bị cắt mép trên | bỏ chiều cao cứng + đệm dọc mặc định của ô nhập Android |
| Thẻ đồng ý / thẻ thông báo của màn quay video | máy nhỏ + chữ lớn: thẻ dài hơn màn hình, không kéo tới nút được | bọc trong vùng cuộn |

**Đã nhìn trên máy ảo, gọn ở 360dp và 320dp:** Kho › Đơn hoàn (thẻ số, danh sách, sheet Bộ lọc, thẻ Hàng hỏng → danh sách, giao diện tối), Tài chính (Lợi nhuận ròng, vòng cơ cấu + chú thích Thất thu), Trợ lý (bàn phím Android bật: ô nhập ngồi sát trên bàn phím, chữ gợi ý đủ).

**Có từ trước, không thuộc đợt này (chỉ ghi):** orb Trợ lý nổi che cột "Ví sàn" của bảng Tiền theo gian hàng khi cuộn tới (đã ghi 23/11); ở 320dp hai nhãn "Trang chủ" và "Đơn hàng" trên thanh tab đứng sát nhau (chưa đè).

### 7.1 Soi tiếp với bản Android CÓ thư viện camera (26/11/2026 ~22:30)

Dựng bản debug mới tại máy (`expo run:android --no-bundler --variant debug`, 5 phút 48 giây, nới bộ nhớ Gradle `-Xmx4096m`) để máy ảo có phần gốc camera quay video → nhìn được các màn của mục 40 tài liệu video:

- **Màn quay video bản master CHẠY trên Android** (lần đầu — trước đó chỉ có mã nhánh thử chạy trên máy thật): khung quay 3:4, ngày giờ in ở góc trái trên, bảng điều khiển Trở về · Đóng hàng · Khui hàng hoàn, "Giờ quay: Còn 2 giờ", bộ đếm lượt quay; nút Trở về quay lại đúng tab Đơn hàng; chế độ khui đổi nền tím. Máy ảo không có tem để đưa vào nên **CHƯA thấy cảnh đang quay / cắt clip / tải lên** trên bản master.
- Nút "Quay video khui hàng" ở Kho › Đơn hoàn: gọn ở sáng + tối.
- Sửa thêm hai chỗ thấy trong lượt này:

| Chỗ | Trên Android cỡ chữ lớn | Sửa |
|---|---|---|
| Ô tìm tab Đơn hàng (có từ trước) | chữ gợi ý dài bị XUỐNG DÒNG, lòi mép chữ "vận đơn…" ở đáy ô (ô nhập Android không cắt "…") | `lib/fit-hint.ts`: mỗi ô có vài câu gợi ý từ dài tới ngắn, chọn câu dài nhất còn vừa một dòng theo bề ngang ô + cỡ chữ máy; áp cho ba ô tìm (Đơn hàng, Kho › Đơn hoàn, Tồn kho); test 5 ca |
| Câu hướng dẫn chế độ khui trên màn quay | "Chờ tem kiện hoàn — quay đủ 6 mặt kiện trư…" bị cắt | câu chờ được hai dòng (đang quay vẫn một dòng) |

## 8. Nút "Quay video" ở tab Đơn hàng nổi hơn

**Anh nói (ảnh iPhone bản thử, khoanh nút):** "Nút quay video hơi mờ trên app, anh cần nổi hơn".

Trước: nút viền xám nền trắng (cố ý trung tính để không tranh với nút Đóng gói — nhưng chìm vào nền trang). Nay: **nút đặc nền navy, chữ trắng, kèm chấm đỏ "đang quay"** (giao diện tối đảo thành nền sáng chữ đậm) — cùng tông với chip "Tất cả" và nút "Xử lý đơn", không dùng xanh lá để khỏi lẫn với nút Đóng gói ngay dưới. Vị trí, bề ngang một ô lưới, chữ không phóng theo cỡ chữ máy: giữ nguyên. Màn rộng (ô ≥ 98 px) thay chấm đỏ bằng icon máy quay đỏ.

Đã nhìn trên máy ảo Android 360dp cỡ chữ lớn, sáng + tối: nút nổi rõ, thẳng cột với nút Đóng gói. **CHƯA nhìn trên iPhone** (cần bản dựng mới).

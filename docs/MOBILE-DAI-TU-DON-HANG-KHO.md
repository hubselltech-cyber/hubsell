# Đại tu app mobile đợt 1 — Đơn hàng + Kho (05/11/2026): khảo sát, thiết kế, kết quả bản 1.4.2

**Anh Trung 05/11 chiều, 4 việc:** (1) quét mã ngay trong Đơn hàng để chuyển đơn Chờ đóng gói → Đã đóng gói, chỉ âm thanh + màn báo tự tắt, không popup nút bấm, seller quét nhanh; (2) "Thống kê bốc hàng" → "Phiếu nhặt hàng", tính ở trạng thái Chờ đóng gói; (3) cập nhật số lượng kho theo kiểu màn Giá vốn (cha – con); (4) vuốt xuống làm mới Đơn hàng đang không chạy. "Khảo sát kỹ, làm chậm mà chắc."

Trạng thái: anh duyệt cả 4 điểm ở mục 5 ("Duyệt, làm đi") → **cả 4 việc ĐÃ CODE 05/11 chiều, kiểm trên giả lập web local; CHƯA commit, CHƯA thử trên máy thật** — kết quả và phần còn hở ở mục 7. Mục 1–6 là bản khảo sát, giữ nguyên trừ chỗ có ghi "đã đổi".

## 0. Kết luận chung

- Cả 4 việc **không cần đổi backend, không cần build kho**: API đã có từ đợt web (01–05/11), module native (camera, âm thanh, rung, giữ sáng màn) đã nằm trong bản 1.4.1 → đi **OTA** kênh production.
- Chỗ không kiểm được trên giả lập: camera đọc tem thật (tem sàn có 2–3 mã vạch), cử chỉ vuốt. **Đã đổi:** bản khảo sát định thử bằng máy ảo Android + Expo Go — không làm được, app không còn chạy trong Expo Go (mục 7.3). Đường thử trước khi OTA nay là một bản dựng thử (preview) + OTA kênh preview.

## 1. Việc 4 — vuốt xuống làm mới Đơn hàng (ĐÃ SỬA)

- **Gốc:** `FlatList` ở `src/app/(admin)/orders.tsx` chưa bao giờ có `refreshControl` (Tồn kho, Giá vốn có; Đơn hàng thiếu từ bản đầu).
- **Sửa:** thêm `RefreshControl` + chế độ tải `asRefresh` (danh sách giữ nguyên, chỉ quay vòng nhỏ). Kèm hai chỗ hở lộ ra khi thêm: lỗi tải trước đây thay cả danh sách bằng một dòng chữ không có lối thử lại → nay lỗi nằm đầu danh sách, vuốt là thử lại; danh sách rỗng vẫn vuốt được (`flexGrow`). Đổi bộ lọc mà tải hỏng thì bỏ danh sách của bộ lọc cũ.
- **Kiểm:** tsc sạch; eslint 7 lỗi trước = 7 lỗi sau (nền cũ react-compiler). **Chưa thử cử chỉ trên máy** — giả lập web không có vuốt làm mới; thử cùng lượt máy ảo Android của các lát sau.

## 2. Việc 2 — Phiếu nhặt hàng ở trạng thái Chờ đóng gói

**Hiện trạng:** hộp "Thống kê bốc hàng" gọi `GET /api/orders/stats` — backend ĐÈ trạng thái = Chờ xử lý, cắt **top 50** dòng, trần 20.000 dòng đơn, gom bằng JS.

**"Chờ đóng gói" là gì (anh hỏi):** đúng — đơn Đã xử lý + **đã in phiếu trên Hubsell** + chưa quét đóng gói (`shippingStatus=PROCESSED`, `labelPrintedAt` có, `packingDoneAt` trống). Tên cũ của chip là "Đã in phiếu".

**Đề xuất:** đổi sang `GET /api/orders/pick-summary?shippingStatus=PROCESSED&printed=yes` (+ sàn / gian / hãng đang lọc) — đúng route web đang dùng.

| Được | Mất |
|---|---|
| Đủ mọi SKU (hết bị cắt 50 dòng — với phiếu nhặt, thiếu dòng = kho thiếu hàng mà không biết) | Tab "Theo ĐVVC" (route không có) |
| Gom bằng SQL, 18.445 đơn đo prod 1,0 s | Doanh số + "N đơn" từng dòng |
| Một nguồn số với web | |

- Bắt buộc gửi kèm `shippingStatus=PROCESSED`: thiếu thì `printed=yes` kéo cả đơn Đang giao / Đã giao đã in mà chưa quét (mọi đơn trước 01/11).
- Tên: tiêu đề hộp "Phiếu nhặt hàng"; **nút ngoài giữ chữ "Thống kê"** (luật anh chốt trên web 05/11). `docs/store/LISTING.md` đổi theo.
- `/api/orders/stats` GIỮ NGUYÊN — bản app cũ chưa nhận OTA còn gọi.
- **Đi kèm (em đề xuất, nhỏ, không đổi backend):** trong Bộ lọc, khi chọn Đã xử lý hiện 3 chip con Chưa in phiếu / Chờ đóng gói / Đã đóng gói kèm số (`counts.PROCESSED_*` đã có, tham số `printed` đã có) + nhãn "Đã đóng gói" trên thẻ đơn. Không có thì trên điện thoại không biết còn bao nhiêu kiện chưa quét.
- **Rủi ro:** shop in phiếu ở Seller Center (không in trên Hubsell) → Chờ đóng gói luôn trống → hộp trống, trong khi bản cũ còn thấy đơn Chờ xử lý. Giảm nhẹ: hộp trống ghi rõ "đơn vào đây sau khi in phiếu trên Hubsell" + số đơn Chưa in phiếu.

## 3. Việc 1 — Quét đóng gói trong Đơn hàng

**Backend sẵn:** `POST /api/orders/packing/scan {code}` (quyền `orders`; không hỏi sàn; 1–2 truy vấn) → `PACKED | ALREADY_PACKED | REJECTED` + `reason` + `warnings`; 404 không thấy, 409 khớp nhiều đơn. Bảng quyết định ở `DONG-GOI-BAN-GIAO.md` mục 2.2.

**Kiến trúc:** màn MỚI `PackScanScreen` (route gốc `/pack-scan`, phủ thanh tab, có mũi tên về), KHÔNG nhét thành chế độ thứ ba của `ScanScreen`. Lý do: `ScanScreen` là máy trạng thái **chặn** (quét → hộp kết quả → bấm mới quét tiếp, khóa `scanLock`); quét đóng gói là dòng **liên tục** không bấm. Phần dùng chung (màn xin quyền camera, nút tròn trên camera, danh sách loại mã) tách ra tệp chung, hai màn cùng gọi.

**Lối vào:** nút QR bên phải ô tìm ở Đơn hàng (đúng chỗ anh khoanh). Về lại Đơn hàng thì danh sách tự tải lại.

**Cửa chống bắn lặp** (camera bắn ~10 lần/giây, tem sàn có 2–3 mã vạch):
1. Mỗi lúc một lượt gọi; đang gọi thì bỏ mọi lượt đọc.
2. Cùng một mã còn nằm trong khung → không bắn lại; rời khung 2 giây mới nhận lại.
3. Mã KHÁC đọc được trong lúc màn báo đang hiện (mã vạch thứ hai của cùng tem) → vào danh sách bỏ qua theo luật 2.
4. Máy chủ trả "đã quét" cho đúng đơn vừa ghi trong phiên (< 10 giây) → im lặng, không kêu trùng.

**Phản hồi — không nút bấm, tự tắt:**

| Kết quả | Màn | Âm | Rung | Giữ |
|---|---|---|---|---|
| Ghi được | xanh "ĐÃ ĐÓNG GÓI" + mã đơn · hãng | ting-ting (có sẵn) | nhẹ | 0,8 s |
| Ghi được + khách đang xin hủy | vàng "KHÁCH ĐANG XIN HỦY — để riêng" | buzz (có sẵn) | mạnh | 2,5 s |
| Đã quét rồi | vàng "KIỆN NÀY ĐÃ QUÉT RỒI · lúc hh:mm" | boop-boop (có sẵn) | cảnh báo | 1,2 s |
| **Đơn đã hủy** | đỏ kín màn "ĐƠN ĐÃ HỦY" + "Bỏ kiện lại — không đưa ship" | **âm MỚI riêng**: còi hai tông cao–thấp lặp 3 lần, ~1 giây (đã đổi so với bản khảo sát "3 nhịp trầm": hai tông dễ phân biệt với tiếng rè của lỗi thường hơn) | mạnh ×2 | 2,5 s |
| Chặn khác (chưa chuẩn bị hàng / đã giao / đã lên biên bản) | đỏ + lý do | buzz | mạnh | 2 s |
| Không thấy mã / khớp nhiều đơn / mất mạng | đỏ "KHÔNG GHI ĐƯỢC" + lý do | buzz | mạnh | 2 s |

- Thời lượng là mặc định em tự chọn (web: chặn lặp 2 s); chỉnh sau khi anh thử tay.
- **Dải cố định đáy màn** (không phải popup): "Đã gói 12 · Hủy 1 · Lỗi 0" + dòng "Vừa quét: mã đơn — kết quả". Người gói nhìn kiện, lỡ mất màn đỏ thì dải vẫn còn dấu.
- Ô gõ tay vài số cuối giữ lại (tem nhăn / rách).
- Mất mạng phải kêu lỗi: im lặng = người gói tưởng đã ghi.
- **Không làm ở app (v1):** "Bỏ dấu" quét nhầm, lập biên bản bàn giao — ở web.
- **Phát hành:** JS + 1 tệp WAV → OTA (EAS Update chở cả asset); không thêm module native.
- **Chưa kiểm được trước khi có máy thật:** tem thật nhiều mã vạch (luật 2–4 là thiết kế trên giấy), tốc độ đọc, âm mới phát từ gói OTA.

## 4. Việc 3 — Tồn kho kiểu cha – con (như Giá vốn)

**Backend sẵn:** `GET /api/products?view=grouped` phân trang theo MẪU (`groupKey`), trả `variantName`, `skuTotal`, `groupTotals` ("1/6 phân loại" khi đang tìm), `outOfStockCount`, `stock=out`. App đang gọi kiểu phẳng nên mỗi phân loại một thẻ, không thấy màu / size.

**Danh sách:** mỗi dòng một mẫu — ảnh, tên 2 dòng, "6 phân loại · 2 hết hàng", tổng tồn to bên phải; sản phẩm đơn hiện mã SKU như nay. Thêm chip "Hết hàng N" (món nợ 04/10, backend nay đã có).

**Hộp trượt của mẫu** (khung của `ModelSheet` Giá vốn): công tắc Nhập thêm / Xuất bớt cho cả hộp; mỗi phân loại một dòng (tên phân loại, mã SKU, "Tồn 12 · bán được 10", − số +, xem trước "12 → 17"); mẫu 2 tầng ≥ 4 dòng thì nhóm theo tầng như Giá vốn; Lý do + Vị trí chọn một lần; nút "Nhập 3 phân loại · +25".

**Lưu:**
- 1 phân loại → `POST /api/inventory/adjust` như nay (không sinh phiếu).
- ≥ 2 phân loại → `POST /api/inventory/adjust-bulk`: MỘT giao dịch (thiếu hàng một mã thì không ghi mã nào), sinh Phiếu kho PN-/PX- như "phiếu nhiều mã" trên web. Không gọi N lượt rời — hỏng giữa chừng là nửa lưu nửa không.

**Giữ nguyên chốt cũ:** cộng / trừ theo số lượng, không gõ đè tồn (04/10). **Phản biện:** KHÔNG làm ô "số chung cho cả mẫu" như ô Giá chung — giá vốn các phân loại thường bằng nhau, tồn thì không; gõ nhầm là cộng sai cả mẫu.

**Kèm:** 3 câu trong `StockPage` còn ghi "trang Hàng hóa" → "Tổng kho" / "Sản phẩm trên sàn" (web đổi tên 05/11).

## 5. Bốn điểm chờ anh chốt

1. **Nhân viên đóng gói** dùng tài khoản nhân viên — khu nhân viên (Kho · QR · Cấu hình) KHÔNG có tab Đơn hàng. Em đề xuất: màn nút QR giữa có công tắc "Xem đơn · Đóng gói" (nhớ lựa chọn), cho cả chủ shop lẫn nhân viên có quyền Đơn hàng; nút QR ở Đơn hàng mở thẳng chế độ Đóng gói.
2. **Phiếu nhặt hàng bỏ tab "Theo ĐVVC" + doanh số** (em đề xuất bỏ: nhặt hàng không cần; muốn giữ ĐVVC thì thêm `byCarrier` vào `pick-summary`, phải deploy backend).
3. **Âm riêng cho đơn hủy**, khách đang xin hủy = vàng + buzz, màn đỏ giữ 2,5 s (vẫn tự tắt, không nút).
4. **Lưu nhiều phân loại sinh một Phiếu kho** (adjust-bulk).

## 6. Thứ tự làm

Việc 4 (xong) → việc 2 → việc 1 → việc 3. Mỗi lát: dựng local (giả lập web + seed, soi 320–430 + nền tối) → máy ảo Android cho cử chỉ / camera → anh xem → commit. OTA khi anh bảo; trước OTA rà checklist `DUA-APP-LEN-CH-PLAY-APP-STORE.md` mục 9.

Tệp sẽ đụng: `hubsell-mobile/src/app/(admin)/orders.tsx`, `src/app/pack-scan.tsx` (mới), `src/screens/PackScanScreen.tsx` (mới), `src/screens/ScanScreen.tsx` (tách phần chung), `src/screens/ScanDetailTab.tsx`, `src/screens/StockPage.tsx`, `src/api/orders.ts`, `src/api/inventory.ts`, `src/types/api.ts`, `src/lib/scan-sounds.ts`, `assets/sounds/` (1 tệp mới), `docs/store/LISTING.md`.

## 7. Đã làm 05/11 chiều (chưa commit)

### 7.1 Mã

| Việc | Tệp (trong `hubsell-mobile/`) | Ghi chú |
|---|---|---|
| 4 | `src/app/(admin)/orders.tsx` | `RefreshControl` + chế độ tải `asRefresh`; lỗi tải nằm đầu danh sách |
| 2 | `src/app/(admin)/orders.tsx`, `src/api/orders.ts`, `src/types/api.ts` | `PickSheet` thay `StatsSheet`, gọi `fetchPickSummary` (đè `shippingStatus=PROCESSED&printed=yes`); bộ lọc con `PRINTED_FILTERS` chỉ gửi khi đang ở Đã xử lý (`printedInUse`); nhãn thẻ đơn `statusBadgeOf` (Chưa in phiếu / Chờ đóng gói / Đã đóng gói / Đã bàn giao) + dải đỏ "Đã gói — lấy kiện ra" cho đơn gói rồi sàn mới hủy; dòng "N đơn" đọc `total` của lượt tải (trước suy từ bảng đếm, bật hai bộ lọc là lệch) |
| 1 | `src/screens/PackScanScreen.tsx`, `src/app/pack-scan.tsx`, `src/lib/pack-scan-gate.ts`, `src/lib/pack-scan-feedback.ts`, `src/components/ScanChrome.tsx`, `src/lib/useKeyboardLift.ts`, `src/screens/ScanDetailTab.tsx`, `src/lib/scan-sounds.ts`, `assets/sounds/scan-cancelled.wav`, `scripts/gen-scan-cancelled-sound.mjs` | màn quét liên tục; cửa chống bắn lặp và bảng phản hồi là hàm thuần có test; phần chung của hai màn quét tách ra `ScanChrome` + `useKeyboardLift` (`ScanScreen` chỉ đổi chỗ import, thêm chỗ đặt công tắc); công tắc "Xem đơn · Đóng gói" ở tab QR giữa, nhớ lựa chọn (`scanTabMode`) |
| 3 | `src/screens/StockPage.tsx`, `src/api/inventory.ts`, `src/lib/variant-tiers.ts` | danh sách theo mẫu (`view=grouped`), chip Hết hàng, hộp `StockSheet`: sản phẩm đơn giữ ô số to như cũ, mẫu nhiều phân loại mỗi dòng một ô, chia mục theo tầng; 1 dòng → `/adjust`, từ 2 dòng → `/adjust-bulk` |
| — | `docs/store/LISTING.md` | "Thống kê bốc hàng" → "Phiếu nhặt hàng" |

Khác bản khảo sát:
- **Cửa chống bắn lặp (luật 3)** không dựa vào thời gian màn báo: mã lạ bị bỏ qua khi một mã ĐÃ RA ĐƠN vừa được thấy trong 600 ms gần nhất (cùng tem). Sang kiện kế, mã cũ rời khung là mã mới được nhận ngay, không phải chờ màn báo tắt — quét nhanh không bị kìm.
- **Mã không ra đơn do camera đọc** hoãn báo lỗi 700 ms: tem có mã phân tuyến đứng trước mã vận đơn thì mã vận đơn ra đơn trong lúc hoãn → bỏ báo lỗi oan. Gõ tay thì báo ngay.
- **Lượt gọi quá 8 giây** coi là mất mạng (lớp gọi API của app chưa có giới hạn thời gian); mất mạng tự thử lại sau 2,5 giây khi kiện còn trong khung.
- Mọi ngưỡng (2 s, 600 ms, 700 ms, 8 s, 10 s, thời lượng màn báo) là **mặc định em tự chọn**, hằng số đặt đầu tệp, chỉnh sau khi thử tem thật.
- `CostPricesScreen` vẫn giữ bản tách tầng phân loại viết liền trong tệp; `variant-tiers.ts` là bản dùng chung mới cho kho (chưa gộp hai nơi để không đụng màn Giá vốn trong đợt này).

- **Nút "Đóng gói" thẳng cột chip Lazada** (anh góp ý khi xem local): ô tìm + nút chia theo lưới 4 cột của hàng chip sàn — ô tìm `flexBasis 16, flexGrow 3`, nút `flexBasis 0, flexGrow 1`, hai ô chia cột không mang viền / đệm ngang (viền + đệm đội gốc lên, lần đầu đo ra nút rộng hơn chip 3 px). Đo 320–660 px: mép phải lệch 0, mép trái ≤ 0,5 px. Dưới 360 px nút chỉ còn chữ.

### 7.2 Đã kiểm

- `npx tsc --noEmit` sạch. eslint toàn `src`: 52 lỗi trước → 51 sau (nền cũ react-compiler, không phát sinh mới).
- Test (từ `backend/`, `npx tsx --test ../hubsell-mobile/src/lib/<tệp>.test.ts`): `pack-scan-gate` 12 ca (cùng mã trong khung, tem hai mã vạch, mã phân tuyến đọc trước, sang kiện kế, hỏng mạng, 1.000 kiện), `pack-scan-feedback` 13 ca (mọi nhánh của `decidePackingScan` + mã lỗi của route), `notification-target` 33 ca cũ — 58/58.
- **Giả lập web local** (backend local cổng 4010 + launch config `mobile-web-http`, tài khoản seed, 13 đơn mẫu `PACKDEMO-*`), soi 320 / 360 / 390 px + giao diện tối, không tràn ngang:
  - Bộ lọc: chip con hiện khi chọn Đã xử lý, số 2 / 7 / 1 cộng đúng 10; áp Chờ đóng gói → "7 đơn khớp bộ lọc".
  - Phiếu nhặt hàng: gọi đúng `pick-summary?shippingStatus=PROCESSED&printed=yes` (28 ms); "15 sản phẩm · 7 đơn · 8 SKU", 4 món hỏa tốc — khớp số tay của 7 đơn mẫu; sau khi quét 2 kiện còn 13 · 5.
  - Quét đóng gói (gõ tay): ghi được 0,8 s xanh · đã quét rồi 1,2 s vàng · đơn hủy 2,5 s đỏ · khách xin hủy 2,5 s vàng (vẫn cộng Đã gói) · Chờ xử lý / mã lạ / khớp nhiều đơn 2 s đỏ · chưa in phiếu và sàn đã Đang giao = xanh kèm dòng lưu ý 1,5 s; ba ô đếm cộng đúng; quay về Đơn hàng danh sách tự tải lại, nhãn đổi sang Đã đóng gói.
  - Công tắc tab QR: đổi chế độ, rời tab rồi quay lại vẫn ở Đóng gói.
  - Tồn kho: mẫu 12 phân loại chia mục theo size, nhập 3 + 5 → một lượt `adjust-bulk` (67 ms), phiếu `PN-261105-139F`, tổng tồn 110 → 118; xuất lại đúng số đó → `PX-261105-52E5`, về 110 (kho local trả nguyên; hai phiếu thử còn trong DB local). Xuất vượt tồn báo "Kho chỉ còn 5". Lọc Hết hàng: "4/12 phân loại · 4 hết hàng".

### 7.3 CHƯA kiểm được — và vì sao

- **Camera thật / tem thật** (toàn bộ luật chống bắn lặp trên tem nhiều mã vạch), **âm thanh và rung thật**, **cử chỉ vuốt làm mới**, **bàn phím che dải đáy màn quét**: giả lập web không có.
- **Máy ảo Android không dùng được theo cách cũ:** từ bản 1.3.0 app nạp `@react-native-google-signin/google-signin` (module native) ngay lúc khởi động → Expo Go báo `TurboModuleRegistry.getEnforcing('RNGoogleSignin')` và không dựng được màn nào. Đã thử 05/11 trên AVD `hubsell`. Các bản dựng thử (preview) hiện có trên Expo đều là 1.3.0 trở xuống, không cùng runtime 1.4.1.
- **Đường thử đề xuất trước khi OTA production:** một bản `eas build -p android --profile preview` (kênh `preview`, runtime 1.4.1) cài lên máy ảo + điện thoại Android của anh → đẩy OTA kênh preview (`eas update --channel preview`) → thử tem thật → ổn mới đẩy kênh production. Tốn 1 lượt build EAS; chờ anh quyết.
- Tài khoản nhân viên (khu Kho · QR · Cấu hình) chưa đăng nhập thử; mã dùng chung `ScanDetailTab` với khu chủ shop.
- Dữ liệu thử trên DB local: 13 đơn `PACKDEMO-*` (script seed ở scratchpad phiên, chạy lại với `--clean` để xóa).

### 7.4 Bản 1.4.2 — đã nộp hai kho 05/11 chiều

Anh chốt nộp luôn, thử trên TestFlight, không ổn thì tối thay. iOS 1.4.2 (29): TestFlight + WAITING_FOR_REVIEW (`110cd16d`). Android 1.4.2 [vc 12]: production completed. Bản nộp khi CHƯA thử camera / tem thật; checklist DUA-APP mục 9 ca 1–5 không chạy lại (mã Tài chính không đổi), ca 8–10 mới qua giả lập web. Lỗi JS sau khi thử vá bằng OTA runtime 1.4.2. Chi tiết lượt nộp ở PROGRESS phiên 05/11 chiều (3)–(4).

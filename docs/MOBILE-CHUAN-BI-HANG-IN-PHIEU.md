# App mobile: Chuẩn bị hàng · In phiếu · Tùy chỉnh phiếu in

> 19/11/2026 — anh Trung: "Cần em khảo sát kỹ để nâng cấp trải nghiệm của khách. Phần này quan trọng và là
> các phần được nhiều khách hàng yêu cầu… Em cứ làm trên local không cần hỏi trước." Ba việc: (1) chuẩn bị
> hàng trên điện thoại — đặt vào đâu trong Đơn hàng cho không rối; (2) in phiếu trên điện thoại — ShipXanh,
> BigSeller nối máy in kiểu gì, đặt ở đâu; (3) chỉnh sửa phiếu in bằng cách chèn thêm ("watermark").
>
> **Trạng thái: ĐÃ CODE trên local, CHƯA commit, CHƯA push, CHƯA lên bản dựng.** Mục 8 liệt kê cái đã kiểm
> và cái CHƯA kiểm; mục 9 là các điểm chờ anh quyết.

## 1. Khảo sát

Mức chắc: **[NV]** đọc nguyên văn trang chính thức · **[SR]** suy ra / nguồn bên thứ ba · **[KTĐ]** không tìm
được. Khảo sát web ngày 19/11/2026.

### 1.1 Đối thủ in vận đơn trên điện thoại thế nào

| Bên | In vận đơn từ app điện thoại | Nguồn |
|---|---|---|
| ShipXanh | **[LỜI KHÁCH, anh Trung hỏi một khách đang dùng ShipXanh 19/11]** "shipxanh chỉ tạo file in thôi", "vẫn phải kết nối với app của máy in", "giống hệt tiktok shop app ấy" → ShipXanh KHÔNG tự nối máy in; ra tệp rồi in bằng app hãng máy in. Khớp với khảo sát web: **[KTĐ]** không có bằng chứng app tự in. Mô tả + lịch sử phiên bản App Store (tới 4.1.21) không có chữ nào về in / máy in / Bluetooth; tài liệu chính thức nói app để quét, chuyển trạng thái, nhặt hàng, "gần như mọi tính năng đều có trên website"; in nằm ở web (Đơn hàng → Chờ lấy hàng → Đã xử lý → "In phiếu sàn"). Ảnh khách gửi (hộp "In phiếu sàn" trên màn điện thoại) khớp với bản web mở trên điện thoại. | apps.apple.com/vn/app/shipxanh-v2/id6475646185 · docs.shipxanh.com |
| BigSeller | **[LỜI ANH TRUNG 19/11, sau khi hỏi khách]** "bigseller cũng in qua app của máy in" — tức thực tế khách vẫn in bằng app hãng máy in. Khảo sát web trước đó: **[NV, blog chính thức]** App nối máy in nhiệt **Bluetooth** hoặc máy có cổng mạng **LAN**, in từng đơn, nói iOS giống Android. **[KTĐ]** model máy tem A6, giao thức (TSPL hay gì). Bài Bluetooth chi tiết duy nhất là hóa đơn POS 50/80 mm. | bigseller.com/blog/articleDetails/4845 · help.bigseller.com |
| Sapo | **[NV]** In vận đơn sàn + mẫu tùy chỉnh mô tả trên web quản trị. **[KTĐ]** app in vận đơn sàn. | help.sapo.vn |
| Nhanh.vn | **[NV]** "In bằng trình duyệt" / "In bằng Extension" — máy tính. | pos.manual.nhanh.vn |
| Salework, KiotViet, Pancake, Haravan, UpBase, Ginee | **[KTĐ]** | — |

**Cách nhà bán VN đang in từ điện thoại [SR, trang bán máy in]:** tải tệp PDF vận đơn → "Chia sẻ" sang **app
của hãng máy in** (Open Label, HereLabel, Labelife, XPrinter…) → app đó in qua Bluetooth.

**Ca khách thật (ảnh chat anh Trung chuyển 19/11):** khách dùng máy in nhiệt tên Bluetooth `BY-480BT_…-LE` (đuôi
LE = kiểu tiết kiệm điện BLE), ghép trong app hãng **Label Expert** (app có mục "In PDF", tab "Thiết bị Bluetooth" /
"Thiết bị WiFi"). Hỏi in đơn ở đâu thì khách đáp "hiện tại đang in qua bigseller". **[KTĐ]** BigSeller tự nối máy in
hay BigSeller chỉ ra tệp rồi khách in bằng Label Expert — chờ anh hỏi lại khách. Ảnh chụp có dấu "◀ Shopee Seller"
trên thanh trạng thái = khách vừa mở Label Expert TỪ app Shopee Seller (gợi ý có luồng chia sẻ tệp sang app hãng).

### 1.2 Kỹ thuật

- **Hộp in của hệ điều hành** (`expo-print`): nhận tệp PDF, mở hộp in của máy (iPhone: AirPrint; Android: dịch
  vụ in). **[NV docs Expo SDK 57]** iPhone báo được "đóng mà không in"; Android trả về ngay khi hộp in hiện.
  Hạn chế: máy in nhiệt phổ biến ở VN (Xprinter XP-420B…) **[NV trang hãng]** không ghi hỗ trợ AirPrint.
- **Bluetooth thẳng từ app:** iPhone chỉ cho Bluetooth Classic với thiết bị MFi **[NV]**; BLE thì tự do. Máy
  Xprinter là Classic hay BLE: nguồn mâu thuẫn **[KTĐ]** — phải thử máy thật. XP-420B có ba mã bán riêng (USB
  / USB+LAN / USB+Bluetooth); bản USB là mặc định, Bluetooth là thiểu số **[SR]**.
- **Mạng LAN cổng 9100:** giống nhau trên hai nền, không dính MFi; chỉ phục vụ máy có LAN / Wi-Fi; cần module
  native + quyền Local Network trên iPhone.
- Bluetooth / LAN đều cần **máy chủ dựng sẵn ảnh 1-bit hoặc lệnh TSPL** từ tệp PDF (chuyển PDF → ảnh ngay trên
  điện thoại phải thêm module native nữa).

### 1.3 Đối thủ chỉnh phiếu in thế nào

- **ShipXanh "Watermark khi in MVĐ" [NV]:** đóng dấu chữ, chèn logo, phóng to mã vận đơn, che tên sản phẩm,
  thay bảng sản phẩm của sàn bằng bảng của ShipXanh (đơn nhiều món đỡ tốn giấy). **[KTĐ]** cơ chế.
- **BigSeller [NV, nói rõ nhất]:** phiếu chia hai phần — nửa trên là vận đơn của sàn **bị cắt bớt**, nửa dưới
  là thông tin tự chọn (SKU, kệ hàng, ghi chú, logo…). TikTok: tắt "Print Packlist with Label" để không ra tờ 2.
- **Sapo [NV]:** TikTok có "Mẫu mặc định" (của sàn) và "Mẫu tùy chỉnh" (bật / tắt cột STT, tên, SKU, số lượng;
  ghi chú ≤ 200 ký tự; lưu theo gian).
- **Ảnh chat khách gửi 19/11:** khách cần ba thứ — không in sang tờ thứ hai, đổi tên sản phẩm thành SKU với
  hàng nhạy cảm, có số điện thoại shop trên tờ đơn để khách gọi trước khi hoàn.

### 1.4 Kết luận khảo sát

1. Không bên VN nào được chứng minh là in vận đơn A6 **thẳng** từ app. Bên duy nhất nói có (BigSeller) không
   công bố máy / giao thức.
2. Con đường chạy được trên cả iPhone lẫn Android với ít rủi ro nhất: **máy chủ dựng một tệp PDF A6 hoàn
   chỉnh → app đưa tệp ra hộp in của máy hoặc bảng chia sẻ**. Đúng thói quen hiện có của nhà bán (chia sẻ sang
   app hãng máy in).
3. In thẳng Bluetooth / LAN là lát sau, và **phải mượn máy thật thử trước khi code** (mục 9.4).
4. **Xác nhận từ khách thật (19/11):** một khách dùng ShipXanh nói ShipXanh chỉ tạo tệp in, vẫn in qua app của hãng
   máy in, "giống hệt TikTok Shop app" → lối Chia sẻ tệp của Hubsell đã ngang ShipXanh và app TikTok Shop. In thẳng
   Bluetooth không còn là thứ phải có để bằng đối thủ này; chỉ còn BigSeller là bên nói có in thẳng (chưa kiểm).
5. **ANH CHỐT 19/11:** "bigseller cũng in qua app của máy in em ạ. Mà nên như vậy việc gì mình phải gánh phần
   này. Đổi nút chính như em đề xuất. Phần khổ in chắc là họ phải cài trên app của máy in rồi."
   → ⛔ Hubsell KHÔNG làm in thẳng Bluetooth / LAN. ⛔ KHÔNG làm chọn khổ giấy (A4 / A6 / A7) — tệp ra A6 nguyên
   bản của sàn, khổ do app máy in lo. Nút chính của hộp In phiếu = "Mở bằng app máy in" (mục 4.1). Đừng đề xuất lại.

## 2. Đặt ở đâu — hộp "Xử lý đơn"

Màn Đơn hàng đã có: ô tìm, nút Đóng gói, hàng chip sàn, Bộ lọc, Thống kê. Thêm hai nút nữa là rối, và dãy tab
trạng thái từng bị anh bỏ (13/08). Người bán nghĩ theo **thứ tự việc**, không theo danh sách nút.

**Vị trí nút — bản 2 (19/11, sau khi anh xem):** bản đầu em đặt "Xử lý đơn" làm nút thứ ba cùng hàng Bộ lọc ·
Thống kê; anh: "cụm này nó kiểu lộn xộn… không vừa mắt". Gốc: cụm đầu trang vốn chia theo MỘT lưới 4 cột (ô
tìm 3 + nút Đóng gói 1 · bốn chip sàn · Bộ lọc 2 + Thống kê 2); hàng 3 nút nằm lệch khe với 4 chip phía trên,
lại thêm một nút xanh thứ hai tranh với Đóng gói. → **Cụm đầu trang trả về nguyên như cũ**, "Xử lý đơn" thành
**thanh nổi ở đáy danh sách** (ngay trên thanh tab, vùng ngón cái):
- chưa tích đơn nào: một viên bo tròn góc phải "⚡ Xử lý đơn" + số đơn đang chờ chuẩn bị / chờ in;
- đang tích đơn: nở thành thanh đầy bề ngang "✕ · Đã chọn N đơn · Chọn tất cả · [Xử lý]" (màn dưới 360 px ghi
  gọn "N đơn" để con số không bị cắt).
Màu theo cặp đen / trắng của chip đang chọn (không thêm màu xanh thứ hai). Danh sách chừa đáy 88 px để thanh
không che thẻ cuối. ⛔ Đừng đưa nút thứ ba trở lại cụm đầu trang.

Bấm ra hộp trượt xếp theo dây chuyền của đơn:

| Bước | Dòng mô tả | Nút |
|---|---|---|
| Chuẩn bị hàng | N đơn chờ xử lý | **Chuẩn bị** |
| In phiếu | N đơn chưa in phiếu | **In phiếu** |
| Đóng gói | N đơn chờ đóng gói | **Quét** (mở màn Quét đóng gói có sẵn) |
| Chờ giao | N đơn đã đóng gói, chờ đơn vị vận chuyển lấy | — |

Dưới đường kẻ: "In lại phiếu đã in" · "Tùy chỉnh phiếu in". Bấm phần chữ của một bước = xem danh sách đơn ở
bước đó (đặt đúng bộ lọc). Số đơn lấy từ bảng đếm màn Đơn hàng đã có → mở hộp không tốn lượt gọi nào.

Thêm lối thứ hai cho ca làm một đơn (hỏa tốc): hộp **Chi tiết đơn** có nút việc kế tiếp của riêng đơn đó —
đơn Chờ xử lý → "Chuẩn bị hàng", đơn Đã xử lý → "In phiếu" / "In lại phiếu". Đơn khách chưa thanh toán không
có nút.

Giữ nguyên: nút Đóng gói xanh cạnh ô tìm (anh chốt 05/11), chữ "Thống kê".

### 2.1 Tích đơn ngay trên danh sách (anh Trung 19/11 sáng)

Anh: "Nếu như mình thêm dấu tích để nó tích trực tiếp vào các đơn hàng → ấn Xử lý đơn thì sẽ hiện popup xử lý…
Bộ lọc thì tận dụng luôn bộ lọc bên ngoài rồi." → ĐÃ LÀM, thay cho ý "xổ danh sách đơn trong từng gian" em nêu
trước đó (ý đó bỏ).

- **Ô tích ở đầu thẻ đơn**, cạnh mã đơn. Chỉ đơn CÒN VIỆC mới có ô: chờ xử lý (khách đã thanh toán), chưa in
  phiếu, đã in chưa đóng gói. Đơn đang giao / đã giao / hủy / khách chưa thanh toán không có ô. Thẻ đang tích
  có viền + nền xanh nhạt. Bấm phần còn lại của thẻ vẫn mở chi tiết như cũ.
- **Có đơn đang tích:** thanh nổi ở đáy đổi thành thanh "Đã chọn N đơn" có nút Xử lý; hộp Xử lý đơn ghi "N đơn đã chọn",
  bước Chuẩn bị hàng / In phiếu đếm và làm ĐÚNG các đơn đã tích thuộc bước đó; "In lại phiếu" thành "In lại N
  phiếu đã chọn" khi có đơn đã in được tích. Hộp Chuẩn bị hàng mở ở chế độ "N đơn đã chọn" (không còn ô tích
  theo gian — đã chọn đích danh).
- **Không tích đơn nào:** như trước — làm cả nhóm trong phạm vi đang lọc. Em giữ đường này vì shop vài chục /
  vài trăm đơn mỗi lượt không thể tích tay từng đơn.
- **Thanh "Đã chọn N đơn · Chọn tất cả · ✕ bỏ chọn"** (ở đáy màn) hiện khi có đơn tích. "Chọn tất cả" = mọi đơn có ô tích
  TRONG BỘ LỌC ĐANG XEM (sàn, gian, hãng, trạng thái, từ khóa, khách xin hủy), kể cả đơn chưa cuộn tới — để ca
  "làm gần hết, bỏ lại vài đơn hết hàng" là: tích một đơn → Chọn tất cả → bỏ tích vài đơn. Mỗi nhóm lấy tối
  đa 200 đơn (trần máy chủ), quá thì thanh ghi rõ.
- **Đổi bộ lọc là hết lựa chọn** (lựa chọn gắn với bộ lọc lúc tích) — không bao giờ làm trên đơn đang khuất
  mắt. Làm xong một lượt (sàn nhận / đã in) lựa chọn cũng tự bỏ.

Đã đối chiếu "Chọn tất cả" với số đếm thẳng từ bảng đơn trên dữ liệu thử (19/11): không lọc 52 · Shopee 13 ·
TikTok 10 · Lazada 29 · Shopee + gian Mộc Outlet 4 · hãng Hỏa tốc 3 · trạng thái Chờ xử lý 40 — khớp cả 7 ca;
đổi sàn thì gian đang lọc thuộc sàn khác tự gỡ và lựa chọn cũ tự bỏ.

**Phương án đã cân nhắc và loại:** (a) dãy chip 4 công đoạn ngay trên danh sách — chính là dãy tab anh đã bỏ;
(b) thanh nút nổi ở đáy khi đang lọc đúng công đoạn — phải lọc trước mới thấy, khó tìm; (c) chế độ tích từng
đơn — chậm với shop vài chục đơn trở lên, ShipXanh cũng chọn theo cụm.

### 2.2 Hàng đầu thẻ đơn: mã đơn dài không được đè nhãn (anh Trung 19/11)

Anh: "Khi em thêm dấu tích vào thì em cần phải đo độ dài của mã đơn hàng nữa. Tránh trường hợp mã đơn hàng quá
dài sẽ bị chèn chữ lên phần hỏa tốc bên phải." Ô tích lấy mất 28 px (ô 20 + khe 8) của hàng đầu thẻ.

**Khảo sát độ dài mã đơn** (DB local, dữ liệu đồng bộ thật; CHƯA đối chiếu prod):

| Sàn | Dạng mã | Độ dài |
|---|---|---|
| Shopee | chữ + số (có chữ rộng M / W / Q) | 14 ký tự |
| Lazada | toàn số | 15 số |
| TikTok | toàn số | 18 số |
| Dự phòng em tự thêm | toàn số | 16 và 19 số |

**Ca chật nhất:** đơn có ô tích + Hỏa tốc + nhãn "Chưa in phiếu" (nhãn trạng thái dài nhất). Seed thử có 8 đơn
đúng ca này, mã dài đúng thật (`backend/scripts/_tmp_seed_mobile_fulfill.ts`).

**Bản một dòng cũ (đo được, đã bỏ):** 320 px cắt mọi mã (cần 104–133 px, còn 63–86 px); 360 px cắt mã Shopee
14 ký tự (thiếu 4 px), mã 16 số + "Chưa in phiếu" (thiếu 8 px), mã 19 số (thiếu 7 px); 375 px trở lên vừa.

**Bản chốt — hàng cho phép xuống dòng:** `[ô tích + mã đơn]` và `[Hỏa tốc] [trạng thái]` là hai cụm trong một
hàng `flex-wrap`. Đủ chỗ thì nằm một dòng như cũ; không đủ thì cụm nhãn rơi xuống dòng dưới, vẫn sát mép phải.
Mã đơn luôn hiện đủ (người bán nhận đơn bằng mấy ký tự cuối), chỉ bị cắt khi tự nó dài hơn cả bề ngang thẻ.
Mã đơn bỏ kiểu số đều cột (không cần gióng cột giữa các thẻ, mà số đều cột làm chuỗi 18–19 số rộng thêm).

**Đo lại sau khi sửa** (web bản dựng thử, 8 mã × 6 cỡ màn; kiểm bằng JS: chữ có bị cắt, khung mã có chồng khung
nhãn, có tràn mép thẻ):

| Bề ngang | Bị cắt | Đè nhãn | Tràn thẻ | Mã phải xuống dòng nhãn |
|---|---|---|---|---|
| 320 px | 0 | 0 | 0 | cả 8 mã |
| 360 px | 0 | 0 | 0 | 5 / 8 (mã 14, 16, 18, 19, 19) |
| 375 px | 0 | 0 | 0 | 3 / 8 (mã 14, 18, 19) |
| 390 px | 0 | 0 | 0 | không |
| 412 px | 0 | 0 | 0 | không |
| 430 px | 0 | 0 | 0 | không |

Đơn không Hỏa tốc (đa số) rộng hơn ca trên một nhãn (~74 px) trong khi 360 px chỉ thiếu tối đa 8 px, nên tính ra
nằm một dòng từ 360 px — suy từ số đo, CHƯA đo trực tiếp (seed chưa có đơn mã dài không Hỏa tốc).

**Giới hạn của phép đo:** đo trên bản web (phông trình duyệt), chưa đo trên máy thật — bề rộng chữ trên iOS /
Android có thể lệch vài px, nhưng luật xuống dòng không phụ thuộc con số nên không thể đè. Người bật cỡ chữ hệ
thống lớn sẽ gặp xuống dòng sớm hơn, vẫn không đè.

⛔ Thêm nhãn mới vào hàng đầu thẻ: đặt trong cụm nhãn bên phải, KHÔNG quay lại hàng một dòng `numberOfLines={1}`
chia chỗ với nhãn.

### 2.3 Hộp Bộ lọc: mục Gian hàng xếp theo cây Sàn → gian (anh Trung 19/11)

Anh: "Tiện sắp xếp luôn bộ lọc dạng cha-con, vẫn liệt kê hết các shop ra nhưng theo thứ tự Sàn - shop."

**Trước:** mọi gian nằm lẫn một hàng chip theo thứ tự backend trả, mỗi chip kéo đuôi "· Shopee" / "· Lazada" để
phân biệt; gian tên dài + đuôi sàn tràn ra ngoài mép phải hộp ở 360 px.

**Giờ:**
- "Tất cả" đứng riêng một dòng.
- Mỗi sàn một dòng tên có chấm màu sàn; các gian của sàn đó thụt vào bên dưới, chip chỉ còn tên gian.
- Thứ tự sàn: Shopee → TikTok → Lazada → Offline (trùng hàng chip sàn ở đầu màn và màn Gian hàng). Sàn lạ app
  chưa biết xếp sau cùng, không làm rơi gian.
- Gian trong một sàn xếp theo tên kiểu tiếng Việt (không phân biệt hoa thường, "Shop 2" trước "Shop 10").
- Đang lọc sẵn một sàn ở chip ngoài → chỉ còn gian của sàn đó, bỏ dòng tên sàn (tiêu đề mục ghi "Gian hàng
  Shopee"), vẫn xếp theo tên.
- Dòng tên sàn chỉ là nhãn, KHÔNG bấm được — lọc theo sàn đã có hàng chip ở đầu màn; em không thêm chỗ bấm thứ
  hai cho cùng một việc. Anh xác nhận 19/11: "Lọc sàn thực ra bên ngoài mình đã có rồi" → GIỮ, không làm tên sàn bấm được.
- `PickChip` (dùng chung với trang Kho): nhãn dài giờ cắt "…" trong bề ngang hộp thay vì tràn mép.

Luật xếp nằm ở `hubsell-mobile/src/lib/channel-groups.ts` (`PLATFORM_ORDER`, `groupChannelsByPlatform`), 5 test
ở `channel-groups.test.ts`; màn Gian hàng dùng chung `PLATFORM_ORDER` từ đây.

**Đã soi** (web bản dựng thử, 8 gian / 4 sàn, có gian tên 47 ký tự): 320 px tối, 360, 390, 430 px sáng — không chip
nào tràn mép; ở 320 px tên 47 ký tự cắt "…". Chọn sàn Shopee ở ngoài → mục còn 3 gian Shopee. Chọn gian Mộc Outlet
→ Áp dụng → tích 1 đơn → "Chọn tất cả" ra 4 đơn, khớp DB (gian có 5 đơn, 1 đơn đã đóng gói không có ô tích).
Chưa soi máy thật.

## 3. Chuẩn bị hàng trên app

Cùng việc với hộp Chuẩn bị hàng của web (sàn sắp xếp vận chuyển THẬT, chạy nền theo mẻ — xem
[CHUAN-BI-HANG-THEO-ME.md](CHUAN-BI-HANG-THEO-ME.md)); cùng route `/api/orders/bulk/shipping-options`,
`/bulk/confirm`, `/bulk/confirm/:batchId`.

- **Chọn đơn:** không tích từng dòng. Mở từ hộp Xử lý đơn = mọi đơn Chờ xử lý trong phạm vi đang lọc (sàn /
  gian / hãng / từ khóa), tối đa 200 đơn mỗi lượt (trần `BULK_MAX` của máy chủ), hỏa tốc trước rồi đơn cũ
  trước. Quá 200 thì hộp nói rõ còn bao nhiêu, làm tiếp sau lượt này.
- **Mỗi gian một thẻ:** ô tích (bỏ được cả gian), số đơn, số hỏa tốc tô đỏ. Cách giao điền sẵn theo lần trước
  của gian / mặc định của sàn, hiện thành MỘT dòng tóm tắt + chữ "Đổi" — không bắt người bán chọn lại mỗi lần.
- **Báo trước khi bấm:** đơn khách chưa thanh toán (không nằm trong lượt, đếm riêng); gian sàn không hỏi được
  / chưa hỗ trợ (thẻ đỏ / vàng, bị bỏ qua); gian chọn lấy hàng tận nơi mà sàn chưa có địa chỉ lấy hàng.
- **Ba màn trong một hộp:** chọn → đang chạy (thanh tiến độ "Sàn đã sắp xếp x/y") → kết quả (sàn nhận bao
  nhiêu; đơn bị từ chối liệt kê ĐỦ mã + lý do; nút "In phiếu N đơn" đi tiếp).
- **Không có công tắc "In ngay sau khi sàn xác nhận"** như web: màn kết quả đã có nút In, một chạm.

Backend thêm `GET /api/orders/process-queue?stage=ARRANGE|PRINT|REPRINT` (`lib/process-queue.ts`): trả id đơn
của một công đoạn gom gian → hãng, chỉ đọc bảng Order, không gọi sàn. App cần nó vì không có bảng tích; kéo
`GET /api/orders` 100 đơn / trang kèm dòng hàng + ảnh chỉ để lấy id là phí.

## 4. In phiếu trên app

### 4.1 Hộp In phiếu

Cây **gian → hãng vận chuyển**, mặc định tích hết; bỏ tích một hãng khi hãng đó chưa tới lấy. Hỏa tốc là một
dòng riêng tô đỏ đứng đầu. Hai tab **Chưa in · Đã in** (Đã in = đã in, chưa quét đóng gói → in lại). Hai ô loại
phiếu như web: Vận đơn của sàn · Phiếu xuất hàng (nhớ lựa chọn). Dòng "Số đơn sẽ in" + hai nút. Có mục "Nối máy
in thế nào?" nói đúng ba cách bản này làm được (máy in nhiệt Bluetooth đứng đầu).

**Hai nút (anh chốt 19/11):**
- **"Mở bằng app máy in"** — NÚT CHÍNH mặc định (xanh, bên phải, rộng gấp rưỡi): mở bảng chia sẻ của điện thoại
  để đưa tệp sang app của hãng máy in.
- **"In qua Wi-Fi"** — nút phụ (bên trái): hộp in của điện thoại, cho máy in nối Wi-Fi / LAN.
- **App nhớ lối dùng gần nhất** trên từng điện thoại (khóa `hubsell.print.via`): shop in Wi-Fi bấm lối đó một lần
  là lần sau nó lên làm nút chính, lối kia thành nút phụ ghi gọn "App máy in". Đóng hộp in mà không in thì
  không tính. Luật ở `lib/print-via.ts` + 5 test.
- Màn kết quả: "Đã đưa tệp N trang sang app máy in" + hai nút "In qua Wi-Fi" / "Mở lại app máy in".
- Bản web giả lập: lối "app máy in" = tải tệp về (để soi được luồng), không phải hành vi trên máy thật.
- Đo 320 / 360 / 390 px: chữ hai nút không bị cắt ở cả hai thứ tự.

Sau khi chuẩn bị hàng xong bấm "In phiếu": hộp tự **đợi sàn cấp vận đơn** (`/bulk/label-readiness`, trần 45
giây như web) rồi mới xin tệp.

### 4.2 Kiến trúc in

```
app ──POST /api/orders/bulk/labels──▶ máy chủ (gọi sàn lấy vận đơn, chèn bảng gọn nếu bật, ghép MỘT tệp A6)
app ◀── tệp PDF + header tóm tắt ──
app: ghi tệp vào bộ nhớ đệm (xóa tệp cũ hơn 1 giờ)
  ├─ MỞ BẰNG APP MÁY IN (chính) → bảng chia sẻ của máy (expo-sharing) → app hãng máy in / lưu tệp / gửi máy tính
  └─ IN QUA WI-FI (phụ)         → hộp in của hệ điều hành (expo-print)
```

- App **không tự điều khiển máy in** và **không chọn khổ giấy** — anh chốt 19/11, không phải việc tạm hoãn.
- **Đánh dấu Đã in:** bấm In → hộp in mở được là đánh dấu (cùng luật với web). iPhone báo được "đóng mà không
  in" → không đánh dấu. Bấm Chia sẻ → hệ điều hành không cho biết tệp có được in không → app hỏi một câu "Đã
  in xong N đơn", không tự đánh dấu.
- Đơn sàn chưa cấp vận đơn: không đánh dấu, liệt kê mã + lý do ở màn kết quả.
- Tệp vừa lấy được giữ lại trong hộp: "Mở lại hộp in" / "Chia sẻ tệp này" không gọi sàn lần hai.

### 4.3 Bản dựng

Ba module native mới: `expo-print`, `expo-sharing`, `expo-file-system` → **phải dựng bản kho mới (đề xuất
1.5.0)**, không đi OTA được. Mã nạp ba module bằng `require` trong try/catch (`lib/print-labels.ts`): bản app
thiếu module thì hộp In hiện dòng "Bản app đang cài chưa in được…", không văng app. Nhờ vậy phần Chuẩn bị hàng
+ hộp Xử lý đơn (chỉ JS) về nguyên tắc đẩy OTA cho 1.4.3 được — **nhưng chưa thử trên bản 1.4.3 thật**, đừng
đẩy OTA production trước khi thử kênh preview.

Không thêm quyền, không thêm khai báo Info.plist / AndroidManifest. Plugin `expo-sharing` (chỉ cần khi NHẬN
tệp từ app khác) đã gỡ khỏi `app.json` sau khi `expo install` tự thêm.

## 5. Tùy chỉnh phiếu in ("watermark")

### 5.1 Làm gì

Giữ nguyên phần vận chuyển của sàn (mã vạch, mã phân tuyến, địa chỉ — Hubsell không vẽ lại), chỉ **thay phần
bảng sản phẩm của sàn** bằng bảng gọn của Hubsell:

- mỗi món một dòng: **số lượng** (từ 2 trở lên in đảo màu) · **SKU** · phân loại · tên — bật / tắt từng cột;
  tắt Tên sản phẩm = hàng nhạy cảm chỉ còn SKU;
- mã máy của sàn (dãy 19 số…) không in ra — cùng luật `lib/order-line-display.ts`;
- **dòng nhắn của shop** ≤ 80 ký tự in đậm trên đầu bảng (số điện thoại shop, "hàng dễ vỡ");
- **mỗi đơn một tờ**: bỏ trang tràn của bảng sản phẩm sàn;
- bảng tự co: giảm cỡ chữ → chia hai cột → quá nữa mới cắt và ghi "+ N dòng nữa — xem phiếu xuất hàng"
  (không in chữ nhỏ hơn 5,5 pt — máy nhiệt 203 dpi in nhòe; số tự chọn).

Mẫu lưu theo **chủ shop + sàn** (`User.labelTemplates`, migration `20261119220000_user_label_templates`) và áp
ở máy chủ lúc dựng tệp → **in từ web hay từ app đều ra cùng một phiếu**; in lại từ kho vận đơn đã lưu
(`/:id/saved-label`) cũng chèn theo mẫu đang bật. Kho vận đơn đã in vẫn lưu **bản gốc** của sàn.

### 5.2 Phạm vi: TikTok trước

Tem TikTok kèm phiếu đóng gói có bảng sản phẩm nằm riêng ở nửa dưới — thay được mà không đụng phần vận chuyển
(đúng ca trong ảnh khách gửi). **Shopee / Lazada CHƯA làm:** ô "Nội dung hàng" nằm giữa tem, sát dòng tiền thu
hộ và chữ ký; che nhầm là hãng vận chuyển từ chối kiện. Màn cài đặt nói thẳng "đang in nguyên phiếu của sàn".

### 5.3 Biết vùng bảng nằm đâu

Hai cách, đều có trong mã:

1. **Số đã lưu trong mẫu** — "cao từ đáy tem N mm" (20–70 mm, nấc 2 mm). Mặc định điền 46 mm: đo trên ảnh tem
   TikTok – J&T khách gửi 19/11 (bảng bắt đầu ở ~69 % chiều cao tem tính từ trên). **Một mẫu tem, chưa đo hãng
   khác.**
2. **Tự dò từng tệp** — đọc lớp chữ của PDF, tìm dòng tiêu đề "Tổng N mặt hàng", lấy từ mép trên dòng đó xuống
   đáy. Có chốt an toàn: dòng tiêu đề nằm cao quá 55 % tem thì coi là dò nhầm, không chèn.

**Production mặc định dùng cách 1; cách 2 TẮT** (`LABEL_OVERLAY_AUTODETECT`, mặc định bật ngoài production).
Lý do là số đo ngày 19/11 trên máy dev:

| Việc (200 vận đơn) | Thời gian | RSS tăng |
|---|---|---|
| Ghép tệp như hôm nay (không chèn) | 1,4 s | +49 MB |
| Ghép + chèn bảng gọn, vùng đã lưu | 1,8 s | +99 MB (chạy ngay sau lượt trên, cùng tiến trình) |
| Đọc lớp chữ bằng pdf.js (trong luồng phụ) | 1,5 s | +145 MB; tắt luồng vẫn còn +111 MB |
| Bản đầu của em: dựng lại từng vận đơn + nhúng phông từng tệp | 10,3 s | +138 MB |

Máy web Render là Starter 512 MB, RSS nền ~327 MB, có chốt 503 khi RSS > 400 MB (sự cố OOM 03/11). Đọc lớp chữ
ngay trong tiến trình web là không được. Vì thế: bảng được **vẽ lúc ghép tệp** lên tài liệu ghép, phông nhúng
một lần (`fulfillment/merge-pdf.ts`); pdf.js chỉ chạy trong luồng phụ có trần heap 128 MB, tự tắt sau 15 giây
rảnh, và chỉ khi cờ bật.

Ba nguyên tắc không đổi: lỗi chèn **không bao giờ** làm hỏng lượt in (đơn đó ra nguyên phiếu sàn); **không che
mò** (chưa có vùng thì để nguyên, màn kết quả in báo "N vận đơn chưa chèn được"); không ăn bộ nhớ tiến trình
web.

### 5.4 Màn "Tùy chỉnh phiếu in" trên app

Route `/label-template`, mở từ hộp Xử lý đơn và hộp In phiếu. Chọn sàn → công tắc "Bảng sản phẩm gọn" → **khung
xem trước** (tờ tem thu nhỏ, đổi theo từng công tắc ngay khi bấm, không gọi máy chủ) → Mỗi dòng in gì → Dòng
nhắn của shop → Mỗi đơn một tờ → Vùng chèn bảng → nút **Xem phiếu mẫu** (máy chủ dựng tệp mẫu, mở bằng hộp in)
và **Lưu**. Nhân viên có quyền Đơn hàng xem được, chỉ chủ shop lưu được (máy chủ chặn).

Web chưa có màn chỉnh mẫu (mẫu vẫn áp cho lượt in trên web).

## 6. Giả thuyết phải kiểm trên phiếu thật

Mọi thứ ở mục 5 mới chạy trên **vận đơn mẫu do em dựng** (`fulfillment/fake-label-pdf.ts`, bắt chước bố cục).
Trước khi bật cho khách phải chạy `backend/scripts/label-shape-probe.ts` (chỉ đọc; Render shell worker; **cần
anh đồng ý**):

```
npx tsx scripts/label-shape-probe.ts "<tên gian TikTok>" TIKTOK 8
```

| # | Giả thuyết | Script trả lời bằng |
|---|---|---|
| G1 | Bảng sản phẩm bắt đầu ở CÙNG một độ cao với mọi đơn của cùng hãng (thì số đã lưu mới dùng được) | dòng "vùng chèn: từ đáy lên N mm" của từng đơn |
| G2 | 46 mm đúng với J&T; các hãng khác (GHN, BEST, Viettel Post, Ninja Van…) bao nhiêu | như trên, chạy với gian có hãng khác |
| G3 | Trang thứ hai trở đi của tệp là phần tràn của bảng sản phẩm (bỏ được), không phải tem của kiện khác | "N trang" đối chiếu số dòng hàng |
| G4 | Tệp của sàn có lớp chữ và tiêu đề đúng là "Tổng N mặt hàng" | "N mẩu chữ", "dò được vùng" |
| G5 | Trong vùng chèn không có gì ngoài bảng sản phẩm | dòng "⚠ dòng lạ trong vùng" |

G1 sai → phải dò từng tệp → việc dò phải chuyển sang tiến trình worker (mục 9.3). G3 sai → tắt mặc định "Mỗi
đơn một tờ".

## 7. Tệp mã

**Backend**
- `src/lib/process-queue.ts` + route `GET /api/orders/process-queue` trong `routes/orders.ts`
- `src/services/label-overlay/` — `template.ts` (mẫu + làm sạch), `lines.ts`, `locate.ts` (luật vùng + cầu nối
  luồng phụ), `read-page.ts` + `locate-worker.ts` (đọc lớp chữ), `draw.ts` (vẽ bảng), `index.ts`
  (`planOverlay`, `overlayLabels`, `autoDetectEnabled`)
- `src/services/fulfillment/merge-pdf.ts` — vẽ bảng lúc ghép; `routes/orders.ts` `/bulk/labels` (kế hoạch chèn
  + header `overlay`), `/:id/saved-label`
- `src/routes/label-template.ts` — `GET / PUT /api/orders/label-template`, `POST …/preview`; mount trong `app.ts`
- `prisma/schema.prisma` + `migrations/20261119220000_user_label_templates`
- `src/services/fulfillment/fake.ts` + `fake-label-pdf.ts` — sàn giả lập cho máy dev (`FULFILLMENT_FAKE=1`,
  production luôn bỏ qua); `index.ts` chọn adapter
- `scripts/label-shape-probe.ts` — bản TỰ CHỨA (không import lớp label-overlay, chữ in ra không dấu, mỗi đơn
  một dòng) để đẩy lên prod riêng được mà không kéo theo tệp nào trong `src`
- Gói mới: `unpdf` **1.4.0** (pdf.js không cần canvas; có bản CommonJS; tệp khóa gói chỉ thêm 15 dòng). Không
  dùng: bản 0.12.1 (kéo gói native `canvas` dạng tùy chọn, +670 dòng khóa gói), bản 1.9+ / 2.x (đòi Node ≥ 22 /
  ≥ 24, bản 2.x chỉ ESM), `pdfjs-dist` trực tiếp (cũng kéo `canvas`). Chưa biết bản Node trên Render — gõ
  `node -v` trong Render shell trước khi chạy script đo.
- Test: `src/lib/__tests__/process-queue.test.ts`, `src/services/__tests__/label-overlay.test.ts`

**App**
- `src/app/(admin)/orders.tsx` (nút Xử lý đơn + ba hộp), `components/OrderDetailSheet.tsx` (nút việc kế tiếp)
- `components/Sheet.tsx`, `ProcessSheet.tsx`, `ArrangeSheet.tsx`, `PrintSheet.tsx`, `LabelPreview.tsx`
- `screens/LabelTemplateScreen.tsx`, `app/label-template.tsx`
- `api/fulfill.ts`, `api/label-template.ts`, `api/client.ts` (`apiBinary`)
- `lib/fulfill.ts` (cả luật tích đơn: `workStageOf`, `selectionCounts`, `selectAllStages`),
  `lib/label-template.ts`, `lib/print-labels.ts`, `lib/fulfill.test.ts`
- `lib/channel-groups.ts` + `lib/channel-groups.test.ts` (cây Sàn → gian của hộp Bộ lọc, mục 2.3);
  `components/FilterChips.tsx` (chip cắt "…"), `screens/ChannelsScreen.tsx` (dùng chung `PLATFORM_ORDER`)
- `package.json`: `expo-print`, `expo-sharing`, `expo-file-system`; `scripts/dev-proxy.js` chuyển tiếp header
  tóm tắt tệp in

**Chạy thử local:** launch config `backend-http-fulfill-demo` (cổng 4010, sàn giả lập, không tự dò — giống
production) + `mobile-web-http`; dữ liệu thử `npx tsx scripts/_tmp_seed_mobile_fulfill.ts` (tệp tạm, không
commit; thêm `clean` để dọn) tạo 4 gian "Mộc…" + 28 đơn `XLDEMO-*` cho tài khoản seed. Mã đơn kết thúc `FAIL` =
sàn từ chối, `NOLABEL` = sàn không trả vận đơn.

## 8. Đã kiểm / CHƯA kiểm

**Đã kiểm (local, 19/11):**
- `tsc` sạch cả backend lẫn app; eslint các tệp app mới 0 lỗi (không thêm vào mức nền của dự án).
- Test: backend 86 ca nhóm in / chèn / hàng chờ xanh; app 19 ca (`node:test`) xanh.
- Toàn bộ test backend (2.815 ca): xanh trừ **8 ca ở 5 tệp so sổ cái trên DB local** (`channel-delete-db`,
  `pack-video/retention-db`, `realized-pnl-ledger-db`, `order-ledger-db`, `ads-rows-ledger-db`) — cùng con số
  "8 ca / 5 tệp có sẵn" phiên 19/11 rạng sáng đã ghi; em KHÔNG chạy lại trên mã gốc để đối chiếu từng ca. Lượt
  chạy đầu đỏ 23 ca: 15 ca là do rác sổ cái trên DB local (xem "Bẫy" bên dưới), đã dọn.
- Giả lập web của app, tài khoản seed, sàn giả lập: hộp Xử lý đơn → Chuẩn bị 14 đơn (bỏ tích một gian; 13 sàn
  nhận, 1 từ chối hiện đúng lý do) → In 13 phiếu (14 trang) → đơn sang Chờ đóng gói; hộp In phiếu từ hàng chờ,
  đổi tab Chưa in / Đã in; nút Chuẩn bị hàng trong chi tiết đơn; màn Tùy chỉnh phiếu in (bật, gõ dòng nhắn,
  lưu). Soi 390 px sáng và 320 px + giao diện tối.
- Gọi thẳng API local ở chế độ như production (không tự dò, vùng đã lưu 46 mm): `/bulk/labels` 4 đơn TikTok
  với mẫu bật → 3 vận đơn 3 trang (đơn 7 món còn một tờ), 1 đơn `NOLABEL` báo đúng, 312 ms; mở tệp xem bằng
  mắt. Cả chế độ tự dò cũng đã chạy cùng bài này.

**Bẫy gặp trong lượt này:** trên DB local, xóa đơn / gian thử để lại **dòng sổ cái mồ côi** (28 dòng mỗi lượt
dọn) → 8 tệp test "sổ cái = kéo đơn" báo "còn dòng bẩn". Dọn bằng hàm xóa gian chuẩn (`deleteChannelWithin`,
phải ngắt gian trước — nó từ chối gian đang hoạt động) vẫn để lại dòng mồ côi; test `channel-delete-db` vốn đỏ
sẵn trên local đúng ở điểm này. Script dữ liệu thử nay tự quét dòng mồ côi theo tiền tố mã đơn. Em đã xóa 56
dòng của mình và 4 dòng `DEMOPL-*` phiên trước để lại, chỉ trên DB local. **Chưa kiểm** trên prod việc xóa gian
có để lại dòng sổ cái mồ côi hay không (prod có worker sổ cái, local thì không).

**Điều cần biết về "hàng nhạy cảm":** bảng của sàn bị PHỦ TRẮNG chứ không bị xóa khỏi tệp — in ra giấy không
thấy, nhưng ai mở tệp PDF rồi bôi chọn chữ vẫn đọc được tên sản phẩm gốc. Đủ cho tờ dán trên kiện hàng; nếu
cần xóa hẳn khỏi tệp thì là việc khác (phải dựng lại trang).

**CHƯA kiểm:**
- **Máy thật** (app không chạy trong Expo Go): ghi tệp, hộp in, bảng chia sẻ, thứ tự đóng / mở hai hộp trượt
  trên iPhone (đang chờ 380 ms — số tự chọn), phím Back Android, bàn phím ở ô Dòng nhắn.
- **Máy in thật** — chưa in ra giấy tờ nào.
- **Vận đơn thật của sàn** — toàn bộ mục 6.
- Trên giả lập web em chặn hộp in của trình duyệt (để không treo) — đường "hộp in mở được" coi như đã mở.
- `unpdf` trên bản Node của Render; bộ nhớ thật của tiến trình web khi in 200 đơn có chèn.
- Tài khoản nhân viên; gian mất kết nối; mẻ > 200 đơn; đơn Lazada thật.
- Checklist "Rà trước khi build" (DUA-APP-LEN-CH-PLAY-APP-STORE mục 9) — chưa chạy vì chưa build.

## 9. Chờ anh quyết

0. **Trạng thái 19/11 trưa:** anh xem local xong, bảo "dọn dẹp, commit và push trước. Sau đó build bản TestFlight
   mới để anh test" → toàn bộ mã đã commit + push master; app lên **1.5.0**; anh thử trên TestFlight rồi mới tính
   nộp kho. Các mục dưới còn mở trừ mục đã gạch.
   **Bản dựng:** TestFlight **1.5.0 (37)**, EAS `6b5788b7`, dựng từ nhánh thử video đã gộp master (commit gộp `9e096ee0`
   chỉ ở máy) theo lời anh "có phần quay video gói hàng chung luôn". Dựng XONG 10:33 (khoảng 8 phút). Nộp qua `eas submit --id` từ repo chính lúc ~10:36, lượt nộp Expo `96d90b16-8e61-41bb-acb9-2bd02f311113` báo đã tải lên App Store Connect; App Store Connect ghi build 37 **VALID** lúc 10:38 (kiểm bằng `asc-release.mjs status`); chưa nhìn trong app TestFlight trên máy. Backend prod ở `965368e1`.
   Bản này mang mã thử video → không dùng để nộp duyệt kho.
1. **Vị trí + tên nút "Xử lý đơn"** và bốn bước trong hộp — em tự chọn; anh đã xem và chỉnh (thanh nổi ở đáy, mục
   2). Phần tích đơn trên thẻ (mục 2.1) làm theo ý anh; điểm em tự quyết: không tích gì thì vẫn làm cả nhóm đang
   lọc. Mã đơn dài đã xử lý ở mục 2.2 (không còn cắt).
2. **Chạy script đo phiếu thật** (mục 6) trên Render shell — script đã lên prod theo lượt push 19/11, CHƯA chạy; cần anh đồng ý; có kết quả mới biết 46 mm và
   "mỗi đơn một tờ" có đúng không. Trước đó KHÔNG nên bật mẫu cho khách.
3. **Việc dò vùng tự động:** nếu G1 đúng (bảng nằm cố định theo hãng) → giữ "số đã lưu", thêm nút "Đo từ một
   đơn thật" chạy ở tiến trình worker rồi ghi số vào mẫu. Nếu G1 sai → dò từng tệp ở tiến trình worker.
4. ~~In thẳng ra máy in nhiệt (Bluetooth / LAN)~~ — **ĐÓNG 19/11: anh chốt KHÔNG làm** ("việc gì mình phải gánh
   phần này"); chọn khổ giấy cũng không làm. Xem mục 1.4 điểm 5.
5. **Bản dựng 1.5.0** cho phần in (module native mới) — 19/11 đã push backend + dựng bản TestFlight cho anh thử;
   còn lại: thử máy thật → rà checklist `docs/DUA-APP-LEN-CH-PLAY-APP-STORE.md` mục 9 → nộp kho. Phần Chuẩn bị hàng có đẩy OTA sớm cho 1.4.3 không (phải thử kênh preview trước).
6. **Màn chỉnh mẫu trên web** và **Shopee / Lazada** — làm sau khi có số đo phiếu thật.
7. Lưu ý khi push backend: migration chỉ thêm một cột NULL trên `User`; mẫu mặc định TẮT nên lượt in hiện tại
   không đổi gì cho tới khi chủ shop bật.

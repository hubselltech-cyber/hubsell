# Niêm yết Hubsell lên App & Service Store của TikTok Shop — định vị Trợ lý quảng cáo

Soạn 23/10/2026 theo yêu cầu anh Trung: *"nộp lên store của TikTok app Hubsell; định vị là
trợ lý quảng cáo, không phải phần mềm quản lý bán hàng đa kênh tiếp theo; sắp xếp làm luôn."*
Tài liệu này gom: sự thật từ docs TikTok + Partner Center (đọc 23/10), quyết định anh phải
chốt (mục 2), nội dung listing tiếng Việt chép thẳng vào form (mục 3), bộ ảnh (mục 4), bước
bấm trên Partner Center (mục 5), code đã làm cho luồng cài từ App Store (mục 6), hướng dẫn
cho người xét duyệt (mục 7).

> **Trạng thái 23/10/2026:** nội dung + ảnh + code ĐÃ XONG (chưa commit). CHƯA bấm gì trên
> Partner Center ngoài việc đọc. Chờ anh chốt mục 2 rồi em điền form.

---

## 1. Sự thật đã kiểm (docs TikTok 23/10 + Partner Center qua Chrome anh)

### 1.1. App hiện tại
| | |
|---|---|
| App | **Hubsell**, service_id `7685556109353699080`, App Key `6l9tutuffdu4v` |
| Loại | **Dịch vụ tùy chỉnh** (custom), trạng thái Bật, đã qua Xét duyệt đăng ký đối tác + Xét duyệt ứng dụng (12/10) |
| Hạng mục | **Quản lý thương mại điện tử › Lập kế hoạch tài nguyên doanh nghiệp (ERP)** — khóa từ lúc tạo |
| Thị trường / loại người bán | Việt Nam / Người bán trong nước |
| Nút có sẵn | **"Nâng cấp lên Dịch vụ công khai"** (hiện trên trang app) |
| Gian đã ủy quyền | 15 ủy quyền (14 hiệu lực) — token gắn với app key này |
| Hạng mục tài khoản đối tác đã được duyệt | chỉ **ERP** (Quản lý đa kênh còn Bản nháp từ 15/09) |

### 1.2. Luật TikTok ảnh hưởng tới quyết định
| Luật | Nguồn | Hệ quả cho Hubsell |
|---|---|---|
| **Hạng mục app không đổi được bằng bất cứ kênh nào**; chọn sai phải tạo app mới | App Category Selection Guide, FAQ Q2 | Muốn nằm ở kệ "Marketing" là phải tạo app mới |
| Nâng cấp custom → public **không đổi được** thị trường / loại người bán; app vẫn là custom tới khi qua hết review | Publish a custom App | Nâng cấp = giữ nguyên kệ ERP |
| Nâng cấp cần: upgrade review + listing review từng ngôn ngữ (3–5 ngày làm việc) + public app review + compliance khi áp dụng | App review process | App đã qua app review 12/10; TikTok có thể xét lại nhanh hơn, không chắc |
| Cây hạng mục VN cho Nhà phát triển ứng dụng: **Marketing chỉ có "Phân tích và Báo cáo"** (không có mục Quảng cáo/Ads ở VN) | Partner Center form Hạng mục & thị trường, soi 23/10 | Kệ gần "quảng cáo" nhất ở VN là Marketing › Phân tích và Báo cáo, hoặc Thúc đẩy bán hàng › Tối ưu hóa |
| Marketing › Phân tích và Báo cáo + Thúc đẩy bán hàng › Tối ưu hóa có scope mặc định đủ (Order, Finance, Product, Fulfillment, Return…) | App Category Selection Guide bảng 2 | App chính vẫn chạy được nếu tạo app mới ở hai hạng mục này |
| Tên dịch vụ SEA **không được chứa "TikTok"/"TikTok Shop"**, không chỉ là tên chức năng chung | LR-SEA-001 | Tên: "Hubsell - Trợ lý quảng cáo đa sàn" |
| Ảnh listing **không được là ảnh chụp màn hình thô**; phải ghép giao diện + giải thích; không SĐT/email/QR trong ảnh; dữ liệu phải giả hoặc che | LR-MED-002, LR-MED-007, LR-MED-008 | Bộ ảnh mục 4 dựng từ HTML, dữ liệu "Hubsell Demo Store" |
| Thị trường ngoài Mỹ **được** nhắc tên TikTok Shop trong mô tả/ảnh để nói tích hợp; logo dịch vụ không được mang logo TikTok | LR-IP-001 | OK |
| Mô tả chi tiết ≤10.000 ký tự, khuyến nghị ≤2.000 ký tự hiển thị; không emoji, không testimonial | Listing form + LR-OPT-005 | Mục 3.5 = 2.072 ký tự |
| Giá: 3 nhãn Free / Paid (giá tối thiểu bắt buộc, tối đa + dùng thử tùy chọn) / Contact; URL chi tiết giá công khai | APP price information | Paid plan từ 99.000đ/tháng, dùng thử 14 ngày, URL hubsell.vn/bang-gia |
| Cài từ App Store: TikTok redirect về Redirect URL **chỉ kèm `code`** (không state), người bán có thể chưa đăng nhập app của mình; "Users must not need to copy authorization codes manually" | Authorization via App Store, G-AUTH-001 | Phải sửa trang callback (mục 6) — ĐÃ LÀM |

### 1.3. Trường của form listing (Listing your service on the App & Service Store)
| Trường | Bắt buộc | Giới hạn |
|---|---|---|
| Service name | ✓ | < 100 ký tự |
| Service logo | ✓ | jpg/png, **256×256**, < 10MB |
| Service language | ✓ | VN local = Tiếng Việt |
| Short description | ✓ | < 200 ký tự |
| Video hoặc ảnh chính | ✓ | video mp4/mov/flv < 200MB, hoặc ảnh tỷ lệ **5:3** < 10MB |
| Key benefits ×3 | ✓ cả 3 | tiêu đề < 50, mô tả < 150 |
| Ảnh bổ sung | ✓ ≥ 3 (khuyến nghị 3–6) | jpg/png, "300×180" (tỷ lệ 5:3; form là nguồn sự thật về cỡ tối đa) |
| Detail description | ✓ | < 10.000 ký tự, có thể chèn URL |
| Integrations | — | liệt kê nền tảng tích hợp |
| Phone | — | số VN nếu điền |
| Email | ✓ | kênh hỗ trợ |
| Website | — (LR-CON-003: cần cho mỗi ngôn ngữ) | |
| Service FAQ | — | URL hướng dẫn / FAQ |
| Price tag | ✓ khi public | Free / Paid / Contact |

---

## 2. QUYẾT ĐỊNH ANH PHẢI CHỐT: nâng cấp app cũ hay tạo app mới ở kệ Marketing

| | **A. Nâng cấp app hiện tại lên Dịch vụ công khai** | B. Tạo app công khai MỚI ở Marketing › Phân tích và Báo cáo | C. Tạo app MỚI ở Thúc đẩy bán hàng › Tối ưu hóa |
|---|---|---|---|
| Kệ trên App Store | Quản lý TMĐT › ERP (chung kệ Sapo/Nhanh/KiotViet…) | Marketing (VN hiện 16 app, toàn dashboard/đồng bộ) | Thúc đẩy bán hàng |
| Khớp định vị "trợ lý quảng cáo" | Chỉ qua **tên + mô tả + ảnh** (kệ không khớp) | Khớp nhất trong các kệ VN có (VN không có kệ "Quảng cáo") | Khớp vừa ("tối ưu dựa trên dữ liệu đơn/sản phẩm") |
| Khách đang nối TikTok (15 gian) | **Không ảnh hưởng** — app key giữ nguyên | **Phải ủy quyền lại hết** (token thuộc app key cũ); backend phải nuôi 2 app key trong thời gian chuyển (Channel ghi app nào cấp token) — code mới, chưa làm | Như B |
| Review | Upgrade review + listing review (3–5 ngày) + public app review (có thể xét lại) | Đơn "Hạng mục & thị trường" mới cho tài khoản đối tác (3–5 ngày) → tạo app → app review từ đầu (lần trước 16/09 → 12/10 ≈ 4 tuần) → listing review | Như B |
| Thời gian ước | **1–3 tuần** | 5–8 tuần | 5–8 tuần |
| Rủi ro | Kệ ERP làm khách nghĩ là phần mềm quản lý (nhưng tên/ảnh nói rõ trợ lý quảng cáo) | Gián đoạn đồng bộ với khách đang dùng nếu họ chậm ủy quyền lại; thêm code đa app key; chạy lại cả ba vòng review | Như B |

**Em khuyên A.** Lý do: (1) kệ chỉ là nơi xếp, khách tìm app bằng tên và nhìn ảnh/mô tả —
cả ba thứ đó đã nói "trợ lý quảng cáo"; (2) B/C bắt 15 gian khách ủy quyền lại và phải viết
thêm lớp đa app key cho một kệ mà chính anh nhận xét 12/10 là khách "bán nhiều năm chưa từng
vào"; (3) A xong trong vài tuần, B/C mất gần hai tháng và lặp lại vòng xét duyệt vừa mới
qua. Nếu sau này cần kệ Marketing thật sự (khi App Store VN có mục Quảng cáo), lúc đó tạo
app thứ hai với lớp đa app key đã được thiết kế sẵn, không vội bây giờ.

Nếu anh chốt B hoặc C: em làm thêm (1) đơn Hạng mục & thị trường, (2) tạo app công khai mới,
(3) code `Channel.tiktokAppKey` + đọc cấu hình theo app, (4) hộp nhắc "Ủy quyền lại" cho 15
gian, (5) nộp app review lần nữa với video/ảnh/gian demo như 16/09.

---

## 3. Nội dung listing (tiếng Việt, chép thẳng vào form)

Độ dài đã đếm bằng máy 23/10 (số trong ngoặc).

### 3.1. Tên dịch vụ (33/100)
```
Hubsell - Trợ lý quảng cáo đa sàn
```

### 3.2. Mô tả ngắn (181/200)
```
Trợ lý quảng cáo cho shop bán trên Shopee, Lazada, TikTok Shop: biết chiến dịch nào thật sự có lãi sau phí sàn, giá vốn và hàng hoàn; canh ví 24/7, loại video đốt tiền không ra đơn.
```

### 3.3. Ba lợi ích chính
| # | Tiêu đề (< 50) | Mô tả (< 150) |
|---|---|---|
| 1 | `Biết lãi thật của từng chiến dịch` (33) | `Đọc từng đơn, phí sàn, giá vốn và hàng hoàn để tính lãi/lỗ thật của chiến dịch GMV Max, thay vì chỉ nhìn ROAS sàn báo.` (118) |
| 2 | `Loại video đốt tiền không ra đơn` (32) | `Soi từng video trong GMV Max: video tiêu tiền mà không ra đơn được đánh dấu, một chạm loại khỏi chiến dịch, khôi phục khi cần.` (126) |
| 3 | `Ba sàn, một trợ lý quảng cáo` (28) | `Shopee, Lazada, TikTok Shop trên cùng một bảng: ví sắp cạn, mục tiêu đặt dưới hòa vốn, chiến dịch đang lỗ đều được báo ngay.` (124) |

### 3.4. Tích hợp (Integrations)
```
Shopee, Lazada, TikTok Shop, TikTok GMV Max (TikTok for Business), MISA meInvoice
```

### 3.5. Mô tả chi tiết (2.072 ký tự hiển thị; giới hạn 10.000, khuyến nghị ≤ 2.000 — chấp nhận)
<!-- LONG-START -->
Hubsell là trợ lý quảng cáo đa sàn cho nhà bán trên Shopee, Lazada và TikTok Shop. Khác với bảng số của sàn chỉ hiện ROAS, Hubsell đọc từng đơn hàng, từng khoản phí sàn theo bản kê, giá vốn, hàng hoàn và đơn hủy của chính gian hàng để biết chiến dịch nào thật sự có lãi, rồi canh chiến dịch cả ngày lẫn đêm.

VỚI GIAN HÀNG TIKTOK SHOP
- Nối tài khoản quảng cáo GMV Max: xem chi phí, doanh thu, ROI và lãi/lỗ ước tính của từng chiến dịch theo ngày.
- Soi từng video trong chiến dịch: video tiêu tiền mà không ra đơn được đánh dấu; loại khỏi chiến dịch hoặc khôi phục ngay trong Hubsell, có lịch sử lệnh; bật chế độ tự loại theo luật nếu muốn.
- ROI hòa vốn của từng sản phẩm tính từ đơn đã đối soát của gian; gợi ý sản phẩm nên chạy, ROI mục tiêu và ngân sách ngày nên đặt khi tạo chiến dịch trong Seller Center.
- Nhận định cho từng chiến dịch: đang lãi, đang lỗ, mục tiêu đặt dưới hòa vốn, ngân sách đang chặn, mục tiêu đang bó phân phối.

VỚI SHOPEE VÀ LAZADA
- Cùng một bảng với TikTok: chi phí, GMV, ROAS sàn, ROAS hòa vốn và lãi/lỗ ước tính của từng chiến dịch.
- Cảnh báo ví quảng cáo sắp cạn, mục tiêu ROAS đặt dưới hòa vốn, chiến dịch cắn tiền không ra đơn.
- Tự canh khi bạn bật: hạ mục tiêu từng nấc nhỏ, khóa thời gian chờ, dừng chiến dịch theo luật bạn chọn; mọi lệnh ghi vào sổ và đảo lại được.

NỀN ĐỂ TÍNH LÃI THẬT
- Đồng bộ đơn hàng ba sàn, đối soát 25 loại phí sàn theo bản kê thật, giá vốn theo từng gian, hàng hoàn, đơn hủy, dòng tiền ví sàn.
- Báo cáo lãi lỗ theo ngày, theo sản phẩm, theo gian; tồn kho và chuẩn bị hàng theo mẻ; hóa đơn điện tử.
- Ứng dụng điện thoại cho chủ shop và nhân viên kho: kết quả hôm nay, quảng cáo cần xử lý, quét mã nhận hàng hoàn.

BẮT ĐẦU
1. Cài Hubsell từ App Store của Seller Center và ủy quyền gian hàng.
2. Đăng nhập hoặc tạo tài khoản Hubsell; gian hàng được nối ngay sau đó.
3. Nhập giá vốn sản phẩm, nối tài khoản quảng cáo. Trợ lý bắt đầu đọc chiến dịch.

Dùng thử đầy đủ tính năng 14 ngày. Gói từ 99.000 đồng/tháng theo số đơn, không giới hạn người dùng. Hỗ trợ bằng tiếng Việt qua email và ngay trong ứng dụng.
<!-- LONG-END -->

Câu chữ bám đúng khả năng thật từng sàn (anh dặn 15/10): TikTok = đọc GMV Max + loại/khôi
phục video + tự loại + gợi ý, KHÔNG nói bật/tắt chiến dịch; Shopee/Lazada = cảnh báo + tự
canh khi khách bật. Không "đối tác chính thức", không "số 1".

### 3.6. Liên hệ & hỗ trợ
| Ô | Giá trị |
|---|---|
| Email | `support@hubsell.vn` |
| Phone | để trống (không bắt buộc; AI check của TikTok từng báo định dạng +84 sai) |
| Website | `https://hubsell.vn` |
| Service FAQ | `https://hubsell.vn/ho-tro` |

### 3.7. Giá (Price tag and price information)
| Ô | Giá trị |
|---|---|
| Nhãn | **Paid plan** |
| Giá tối thiểu | 99.000 VND / tháng (Starter, < 300 đơn/tháng) |
| Giá tối đa | 1.199.000 VND / tháng (Scale, 20.000 đơn) — điền nếu form cho; Enterprise theo đơn thì ghi ở URL |
| Dùng thử | 14 ngày |
| URL chi tiết giá | `https://hubsell.vn/bang-gia` |

---

## 4. Bộ ảnh (docs/store/tiktok/)

| Tệp | Dùng ở | Nội dung |
|---|---|---|
| `logo-256.png` | Service logo (256×256) | logo Hubsell nền trắng, không chữ |
| `01-ba-san-mot-tro-ly.png` | **Ảnh chính** 5:3 (1500×900) | "Ba sàn, một trợ lý quảng cáo." + biểu đồ Chi phí vs GMV từ Ads (ảnh thật app, data demo) |
| `02-lai-that-khong-phai-roas.png` | Ảnh bổ sung 1 | bảng chiến dịch: ROAS sàn vs ROAS hòa vốn → lãi/lỗ ước tính |
| `03-loai-video-dot-tien.png` | Ảnh bổ sung 2 | bảng video GMV Max: Đốt tiền → Loại khỏi chiến dịch / Khôi phục |
| `04-roi-hoa-von-san-pham.png` | Ảnh bổ sung 3 | gợi ý sản phẩm nên chạy: biên lãi, ROI hòa vốn, ROI nên đặt, ngân sách/ngày |
| `05-canh-24-7.png` | Ảnh bổ sung 4 | danh sách cảnh báo ba sàn (lỗ, mục tiêu dưới hòa vốn, ví cạn, đã hạ 10% khóa 48 giờ) |
| `06-nen-tinh-lai-that.png` | Ảnh bổ sung 5 | "Vì Hubsell đọc từng đơn" + trang Tài chính (ảnh thật) + màn Quảng cáo trên điện thoại (ảnh thật) |

- Nguồn: `listing-images.html` (6 khung, mở `?frame=N`), chụp bằng
  `node tools/do-hoa/tiktok-store-images.mjs` rồi `python tools/do-hoa/tiktok-store-finish.py`.
- Tuân thủ: không ảnh chụp thô (mỗi ảnh ghép UI + câu giải thích), không SĐT/email/QR, dữ liệu
  "Hubsell Demo Store" ghi rõ "Số liệu minh họa", logo ≠ ảnh chính, các ảnh bổ sung khác nhau.
- Nếu form từ chối cỡ 1500×900 cho ảnh bổ sung (docs ghi "300×180"): thu bằng Pillow về
  đúng cỡ form đòi — tỷ lệ đã là 5:3 nên không phải dựng lại.
- Video chính: không bắt buộc (đã có ảnh). Nếu muốn có video, anh tự quay (nguyên tắc video
  anh tự làm, em không dựng).

---

## 5. Bước bấm trên Partner Center (phương án A — sau khi anh chốt)

1. App & Service → Hubsell → **Nâng cấp lên Dịch vụ công khai** → hộp so sánh (đã xem 23/10:
   giữ Việt Nam / Người bán trong nước; app vẫn custom tới khi qua review) → tiếp.
2. **Listing review → Edit**: điền mục 3 (tên, logo, mô tả ngắn, ảnh chính, 3 lợi ích, 5 ảnh
   bổ sung, mô tả chi tiết, tích hợp, liên hệ, website, FAQ) + **Price tag** (mục 3.7). Ngôn
   ngữ: Tiếng Việt (người bán trong nước VN).
3. Kiểm tra **Redirect URL** = `https://app.hubsell.tech/channels/tiktok/callback` (LR-API-001:
   phải là URL production; `.tech` đang 307 → `.vn`, query giữ nguyên; cân nhắc đổi thẳng sang
   `https://app.hubsell.vn/channels/tiktok/callback` + env `TIKTOK_REDIRECT_URI` trên Render cùng
   lúc — đổi URL là đổi cấu hình app, anh quyết).
4. Nếu TikTok đòi lại "Submission materials for review" (ARD / video / test account): dùng mục 7
   + tài khoản `reviewer@hubsell.vn` + gian demo như lần 16/09.
5. Gửi → theo dõi trạng thái trên console (TikTok duyệt lặng lẽ, không mail — bài học 12/10).
   Mốc kiểm: 3–5 ngày làm việc cho listing review.
6. Khi LIVE: landing thêm huy hiệu "Có trên TikTok Shop App Store" (chân trang cạnh BCT) +
   link cài; bài fanpage; cập nhật memory.

**Trước khi bấm Gửi: push code mục 6 lên prod** (reviewer sẽ cài từ App Store → về callback
không có state → phải vào được).

---

## 6. Code: luồng cài từ App Store (ĐÃ LÀM 23/10, chưa commit)

Vấn đề: trang `/channels/tiktok/callback` cũ bắt buộc `state` (chống CSRF) và người dùng đã
đăng nhập. Cài từ App Store thì TikTok chỉ gửi `?code=` và người bán có thể chưa có tài khoản
Hubsell → trang báo "state sai", người bán kẹt (vi phạm G-AUTH-001).

Sửa (`frontend/src/app/channels/tiktok/callback/page.tsx`, `frontend/src/app/login/page.tsx`):
- Có `state` → luồng cũ y nguyên (đối chiếu sessionStorage, đổi token ngay).
- Không `state`:
  - chưa đăng nhập → giữ `code` + mốc giờ trong sessionStorage (`tiktok_store_code`), chuyển
    `/login?from=tiktok-store`; trang login hiện dải xanh "Gian TikTok Shop của bạn đã ủy quyền
    cho Hubsell. Đăng nhập, hoặc tạo tài khoản nếu chưa có, để hoàn tất kết nối."; đăng nhập /
    đăng ký / Google xong → quay về `/channels/tiktok/callback?resume=1` (thay vì Tổng quan).
  - đã đăng nhập (hoặc `resume=1`) → màn **xác nhận** "Gian hàng vừa ủy quyền sẽ được nối vào
    tài khoản Hubsell <email>" + nút *Kết nối vào tài khoản này* / *Dùng tài khoản Hubsell khác*
    (đăng xuất, giữ code, về login). Người dùng tự bấm thay cho state: link lạ không tự nối gian.
  - mã quá 15 phút (TTL tự chọn, TikTok không công bố) hoặc đổi token lỗi → câu hướng dẫn mở
    lại Hubsell trên App Store / bấm Kết nối ở Kênh bán.
- Backend không đổi: `POST /api/channels/tiktok/callback` vẫn `requireAdmin` (nhân viên không
  nối được gian — đúng ý).
- Kiểm 23/10 (preview frontend, không backend): vào `/channels/tiktok/callback?code=x` khi chưa
  đăng nhập → sang `/login?from=tiktok-store`, dải xanh hiện, sessionStorage có mã; `tsc` sạch.
  Chưa kiểm được bước đổi token thật (cần gian TikTok ủy quyền qua App Store, chỉ có sau khi
  listing LIVE) → theo dõi log `[TikTok]` + báo của khách đầu tiên cài từ App Store.

---

## 7. Hướng dẫn cho người xét duyệt (nếu TikTok hỏi lại materials)

- URL sản phẩm: `https://app.hubsell.vn` (web), app điện thoại Google Play / App Store "Hubsell".
- Tài khoản test: `reviewer@hubsell.vn` (mật khẩu anh Trung giữ, tự gõ), vai chủ shop, có gian
  TikTok Shop demo đã nối + dữ liệu đơn/quảng cáo.
- Luồng cài: Seller Center → Growth › App store → Hubsell → Install → Authorize → về
  `app.hubsell.vn/channels/tiktok/callback` → đăng nhập reviewer@ → *Kết nối vào tài khoản này*
  → trang Kênh bán hiện gian vừa nối → Trợ lý quảng cáo › TikTok đọc chiến dịch (cần nối thêm
  tài khoản quảng cáo TikTok ở cùng trang).
- Scope dùng: Order, Finance, Product (đọc + Product Modify để đẩy tồn), Fulfillment, Return &
  Refund, Seller info; webhook `POST /api/webhooks/tiktok`.
- Video demo: dùng lại video đã nộp 16/09 (gian demo TikTok Shop thật) nếu còn; nếu TikTok đòi
  video mới, anh quay theo luồng trên (em không dựng video).

---

## 8. Liên quan
- Định vị: `docs/marketing/DINH-VI-LAI-HUBSELL-QUANG-CAO.md` (anh chốt 15/10).
- Listing kho di động (Google Play / App Store): `docs/store/LISTING.md`.
- Tích hợp TikTok, app console, xét duyệt 12/10: `docs/TIKTOK-TICKET-GIUC-XET-DUYET-APP.md`.
- Docs TikTok đã đọc 23/10: *Listing your service on the App & Service Store*, *Edit your app and
  service*, *App review process*, *Listing Review Requirements*, *App review requirements*,
  *Publish a custom App*, *APP price information*, *Create your App*, *App Category Selection
  Guide*, *Seller authorization guide*, *Authorization via App Store*.

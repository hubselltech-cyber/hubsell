# Huy hiệu tin cậy ở chân trang landing (kiểu Sapo)

Soạn 27/09/2026. Anh Trung xem footer Sapo có 5 huy hiệu (ISO 27001, ISO 9001, NCSC Tín nhiệm mạng, Nói không với hàng giả, Đã thông báo BCT) và chốt: **cái nào miễn phí thì làm hết**. File này là hồ sơ + kết quả đã tra cứu để không phải tra lại.

## 0. Kết luận nhanh

| Huy hiệu | Cơ quan | Phí | Làm? | Tình trạng |
|---|---|---|---|---|
| Đã thông báo Bộ Công Thương | UBND TP Hà Nội qua online.gov.vn | 0 ₫ | CÓ | ⏳ chờ duyệt tài khoản DVC (đăng ký 25/09) → nộp theo `THONG-BAO-BO-CONG-THUONG.md` |
| Tín nhiệm mạng – **Tổ chức** | Trung tâm An ninh mạng quốc gia (NCA), Cục An ninh mạng, Bộ Công an | 0 ₫ (nguồn thứ 3: mikotech.vn; trang NCA không ghi phí) | CÓ | chưa nộp |
| Tín nhiệm mạng – **Website** mức Cơ bản | NCA | trang NCA để trống giá, chỉ ghi "mỗi website/năm"; nguồn thứ 3 nói ≈100.000 ₫/năm | CÓ (nếu đúng ≈100k thì vẫn rẻ) | chưa nộp, hỏi giá khi NCA gọi lại |
| Nói không với hàng giả – BCT | Cục TMĐT & KTS | 0 ₫ | KHÔNG | không có kênh đăng ký mở (xem mục 3) |
| ISO 27001 / 9001 | tổ chức chứng nhận độc lập | vài chục → vài trăm triệu | HOÃN | kích hoạt khi khách Business/Enterprise đòi |
| Tín nhiệm mạng – **Hệ thống** / Thiết bị | NCA | có phí theo quy mô hệ thống (trang NCA không công bố); Cơ bản 35 ngày, Nâng cao 66 ngày + đánh giá bên thứ 3 | KHÔNG | anh hỏi 27/09; chứng nhận cả hạ tầng (mình thuê Vercel/Render/Supabase, không sở hữu), bản chất = ISO 27001 kiểu VN → gộp vào điều kiện hoãn ISO; Thiết bị dành cho nhà sản xuất phần cứng |

Ghi chú: huy hiệu NCSC trên Sapo là mẫu cũ (Cục An toàn thông tin, Bộ TT&TT). Từ khi chương trình chuyển về NCA – Bộ Công an, huy hiệu mới mang chữ **NCA**; Hubsell sẽ nhận mẫu mới.

## 1. Đã thông báo Bộ Công Thương

Toàn bộ hồ sơ ở `docs/THONG-BAO-BO-CONG-THUONG.md`. Khi trạng thái **Đã xác nhận**, email gửi mã nhúng dạng:

```html
<a href="http://online.gov.vn/Home/WebDetails/123456">
  <img src="http://online.gov.vn/Content/EndUser/LogoCCDVSaleNoti/logoSaleNoti.png" />
</a>
```

Cách gắn: chép **số ở cuối link WebDetails** vào `TRUST_BADGES.bctWebDetailsId` trong `hubsell-landing/src/lib/site.ts`. Footer tự hiện logo và trỏ về hồ sơ công khai (mục 5). Chưa có số thì KHÔNG gắn logo (BCT cấm treo logo khi chưa được xác nhận).

## 2. Tín nhiệm mạng (tinnhiemmang.vn)

### 2.1 Việc anh làm (em không được tạo tài khoản / gửi form thay)

1. Vào https://tinnhiemmang.vn → **Đăng ký ngay**. Form đầu (27/09 anh đã mở): tick **Tín nhiệm Tổ chức** + **Tín nhiệm Website** (không tick Thiết bị / Hệ thống); Họ tên = **Nguyễn Trung Hiếu** (người liên hệ, không phải tên công ty), SĐT 0965863292, Email **support@hubsell.vn** (khớp hồ sơ BCT, thư xác minh về hộp công ty). Chọn **Tín nhiệm Tổ chức** trước (miễn phí, 7–14 ngày). Form đầu chỉ hỏi họ tên, email, SĐT, loại chứng nhận; NCA gọi/email lại để lấy thông tin chi tiết.
2. Làm tiếp **Tín nhiệm Website** → gói **Basic** cho `hubsell.vn`. Sau khi đăng ký, trong 3 ngày NCA gửi bộ tiêu chí; mình trả lời trong 7–10 ngày; NCA xét 7 ngày.
3. Khi NCA gửi mã nhúng chứng nhận, chuyển em: cần **đuôi URL trang chứng nhận** (`tinnhiemmang.vn/danh-ba-tin-nhiem/<slug>`) để điền `TRUST_BADGES.tinNhiemMangSlug`.

Liên hệ NCA: (+84) 593505999, contact@nca.gov.vn, Lô E2 Hoàng Quán Chi, Cầu Giấy, Hà Nội.

### 2.2 Thông tin điền (chép y nguyên, khớp GCN ĐKDN và hồ sơ BCT)

| Ô | Giá trị |
|---|---|
| Tên tổ chức | CÔNG TY TNHH CÔNG NGHỆ HUBSELL |
| Mã số doanh nghiệp | 0111626360 |
| Địa chỉ | Số nhà 5k1, Ngõ 5, TT75, Tổng Cục II, BQP, Tổ dân phố Kim Chung, Xã Hoài Đức, Thành phố Hà Nội |
| Website | https://hubsell.vn (khai thêm hubsell.tech, app.hubsell.tech) |
| Điện thoại | 0965863292 |
| Email | support@hubsell.vn |
| Người đại diện | Nguyễn Trung Hiếu — Giám đốc |
| Fanpage / kênh | https://www.facebook.com/profile.php?id=61594385712213 ; https://www.youtube.com/channel/UC38e1vLMdN0sti-FBrA1jyg |
| Đầu mối tiếp nhận sự cố an toàn thông tin | support@hubsell.vn — 0965863292 |

### 2.3 Tiêu chí website Cơ bản (7 mục trên trang NCA) — Hubsell đạt/chưa

| Tiêu chí | Hubsell | Việc cần làm |
|---|---|---|
| Tuân thủ pháp luật ATTT theo cấp độ | hệ thống thương mại nhỏ, chưa xếp cấp độ | khai "hệ thống cấp độ 1, tự đánh giá"; NCA hỏi thêm thì trả lời |
| Chỉ thu thập dữ liệu cá nhân khi được đồng ý | /privacy 14 mục theo Luật BVDLCN | đạt |
| Mã hóa đường truyền bằng chứng chỉ bên thứ 3 | HTTPS Vercel (Let's Encrypt), backend Render TLS | đạt |
| Tên miền/máy chủ không trong danh sách khuyến cáo | hubsell.vn, Vercel/Render/Supabase Singapore | đạt (tra tại tinnhiemmang.gov.vn khi nộp) |
| Không link độc hại, mã độc, lừa đảo | landing tĩnh, không quảng cáo bên thứ 3 | đạt |
| **Công khai đầu mối tiếp nhận sự cố ATTT** | footer mới có "Hỗ trợ: support@hubsell.vn", chưa ghi rõ là đầu mối ATTT | ✅ thêm câu "Báo sự cố bảo mật: support@hubsell.vn" ở /an-toan (làm cùng đợt gắn huy hiệu) |
| Báo cáo đánh giá ATTT bởi đơn vị NCA ủy quyền | chưa có | gói Cơ bản thường không bắt buộc (chỉ Nâng cao 45 ngày + bên thứ 3); nếu NCA đòi thì hỏi giá đơn vị họ chỉ định, báo anh quyết |

## 3. Nói không với hàng giả — KHÔNG làm được, lý do

Đã tra moit.gov.vn + online.gov.vn 27/09/2026:

- Chương trình là **lễ ký cam kết 18/04/2019** do Cục TMĐT & KTS tổ chức cho 5 sàn (Adayroi, Lazada, Sendo, Shopee, Tiki), sau mở cho một số website bán hàng lớn; logo gắn kèm hotline và quy trình xử lý phản ánh hàng giả.
- **Không có mục đăng ký trên online.gov.vn**, không có mẫu cam kết công khai, không có tiêu chí xét. Muốn tham gia phải liên hệ Cục (hotline 0866.59.4498, BaoCT@moit.gov.vn) và họ chỉ xét đơn vị bán hàng hóa.
- Hubsell bán phần mềm, không bán hàng hóa → sai bản chất. Sapo có vì bán web bán hàng + POS.

Chốt: bỏ. Nếu anh vẫn muốn thì việc duy nhất là gọi hotline Cục hỏi "phần mềm SaaS có được ký cam kết không" — em không khuyến nghị.

## 4. ISO 27001 / 9001 — hoãn

Ước chi phí ISO 27001 tại Việt Nam: tư vấn 80–200 triệu + đánh giá 40–100 triệu, 4–8 tháng, tái đánh giá hằng năm (ước lượng, chưa lấy báo giá). Kích hoạt cùng điều kiện với giao diện tiếng Anh: khách Business/Enterprise đòi hoặc ≥2 lead hỏi.

## 5. Cách gắn lên landing (đã chuẩn bị sẵn code 27/09)

- `hubsell-landing/src/lib/site.ts`: hằng `TRUST_BADGES` gồm `bctWebDetailsId` và `tinNhiemMangSlug`, đều rỗng cho tới khi có kết quả. Hàm `trustBadgeItems()` dựng link + ảnh từ 2 giá trị này.
- `hubsell-landing/src/components/site-footer.tsx`: hàng huy hiệu cao 40px dưới icon YouTube/Facebook, **tự ẩn khi cả hai rỗng** nên production hôm nay không đổi gì.
- Nếu mã nhúng thật NCA gửi khác dạng `tinnhiemmang.vn/handle_cert?id=hubsell.vn`, sửa `trustBadgeItems()` theo mã họ gửi (chỉ một chỗ).
- Vị trí: chỉ footer (mọi trang). Không làm khối "chứng nhận" riêng to như Sapo cho tới khi có ≥3 huy hiệu.

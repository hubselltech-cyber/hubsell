# Huy hiệu tin cậy ở chân trang landing (kiểu Sapo)

Soạn 27/09/2026. Anh Trung xem footer Sapo có 5 huy hiệu (ISO 27001, ISO 9001, NCSC Tín nhiệm mạng, Nói không với hàng giả, Đã thông báo BCT) và chốt: **cái nào miễn phí thì làm hết**. File này là hồ sơ + kết quả đã tra cứu để không phải tra lại.

## 0. Kết luận nhanh

| Huy hiệu | Cơ quan | Phí | Làm? | Tình trạng |
|---|---|---|---|---|
| Đã thông báo Bộ Công Thương | UBND TP Hà Nội qua online.gov.vn | 0 ₫ | CÓ | ✅ **ĐÃ XÁC NHẬN 19/10/2026**, logo gắn footer 21/10 (mục 1) |
| Tín nhiệm mạng – **Tổ chức** | Trung tâm An ninh mạng quốc gia (NCA), Cục An ninh mạng, Bộ Công an | 0 ₫ (nguồn thứ 3: mikotech.vn; trang NCA không ghi phí) | CÓ | ✅ ĐÃ GỬI 27/09 tối, chờ NCA 7–14 ngày |
| Tín nhiệm mạng – **Website** mức Cơ bản | NCA | trang NCA để trống giá, chỉ ghi "mỗi website/năm"; nguồn thứ 3 nói ≈100.000 ₫/năm | CÓ (nếu đúng ≈100k thì vẫn rẻ) | ✅ ĐÃ GỬI 27/09 tối (1 website hubsell.vn, Gói cơ bản); chờ bộ tiêu chí trong 3 ngày về support@, hỏi giá khi NCA liên hệ |
| Nói không với hàng giả – BCT | Cục TMĐT & KTS | 0 ₫ | KHÔNG | không có kênh đăng ký mở (xem mục 3) |
| ISO 27001 / 9001 | tổ chức chứng nhận độc lập | vài chục → vài trăm triệu | HOÃN | kích hoạt khi khách Business/Enterprise đòi |
| Tín nhiệm mạng – **Hệ thống** / Thiết bị | NCA | có phí theo quy mô hệ thống (trang NCA không công bố); Cơ bản 35 ngày, Nâng cao 66 ngày + đánh giá bên thứ 3 | KHÔNG | anh hỏi 27/09; chứng nhận cả hạ tầng (mình thuê Vercel/Render/Supabase, không sở hữu), bản chất = ISO 27001 kiểu VN → gộp vào điều kiện hoãn ISO; Thiết bị dành cho nhà sản xuất phần cứng |

Ghi chú: huy hiệu NCSC trên Sapo là mẫu cũ (Cục An toàn thông tin, Bộ TT&TT). Từ khi chương trình chuyển về NCA – Bộ Công an, huy hiệu mới mang chữ **NCA**; Hubsell sẽ nhận mẫu mới.

## 1. Đã thông báo Bộ Công Thương

Toàn bộ hồ sơ ở `docs/THONG-BAO-BO-CONG-THUONG.md`. ✅ Hồ sơ hubsell.vn **Đã xác nhận 19/10/2026** (Sở Công Thương HN, nộp lại 09/10).

Cổng mới (Luật TMĐT 2025) KHÔNG còn dạng `/Home/WebDetails/<số>` và không gửi mail; mã nhúng thật lấy từ trang hồ sơ công khai (ô Tìm kiếm online.gov.vn → "hubsell" → ĐÃ XÁC NHẬN):

```html
<a href="https://online.gov.vn/nen-tang/3419a3ba-7e49-4677-ad65-3d1c54c17f14">
  <img src="https://fileserver.online.gov.vn/uploads/Resources/iconxacnhan/DaThongBao.png" alt="Đã thông báo Bộ Công Thương" />
</a>
```

Đã gắn 21/10/2026: GUID ở `TRUST_BADGES.bctPublicId` (`hubsell-landing/src/lib/site.ts`), ảnh 230×86 hiện cao 44px (bằng cổng in) ở **cột thứ 4 khối pháp nhân** footer, nhãn "Chứng nhận" (anh chốt đặt vào ô trống bên phải). Ảnh hotlink từ máy chủ cổng theo hướng dẫn của họ ("Hướng dẫn lấy biểu tượng xác nhận và liên kết công khai", 23/07/2026).

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

### 2.4 Tình trạng 21/10/2026 — 24 ngày không hồi âm, cần liên hệ lại

Kiểm 21/10: (a) 471 thư 30 ngày ở dev@hubsell.vn (support@ đổ về đây) + hubselltech@gmail.com: KHÔNG thư nào từ NCA/tinnhiemmang, kể cả thư xác nhận đã nhận đăng ký; (b) tra danh bạ công khai tinnhiemmang.vn (Website tín nhiệm + Tổ chức tín nhiệm, từ khóa "hubsell"): "chưa được đăng ký xác nhận". Kết luận: form 27/09 nhiều khả năng không tới NCA (BCT còn gửi thư tự động khi nhận hồ sơ; NCA im hoàn toàn). Việc anh làm, chọn 1 trong 2 hoặc cả hai:

1. **Gọi NCA 0593505999** (giờ hành chính) hỏi hồ sơ đăng ký Tín nhiệm Tổ chức + Website của CÔNG TY TNHH CÔNG NGHỆ HUBSELL, MST 0111626360, website hubsell.vn, đăng ký ngày 27/09/2026 qua form tinnhiemmang.vn, liên hệ support@hubsell.vn. Họ nói chưa có → đăng ký lại form (mục 2.1) ngay trong cuộc gọi.
2. **Gửi thư từ support@hubsell.vn tới contact@nca.gov.vn** (mẫu dưới, chép nguyên). Thư có dấu vết, dễ chuyển nội bộ hơn form web.

```
Tiêu đề: Đề nghị xác nhận hồ sơ đăng ký Tín nhiệm mạng – CÔNG TY TNHH CÔNG NGHỆ HUBSELL (hubsell.vn)

Kính gửi Trung tâm An ninh mạng quốc gia (NCA),

Ngày 27/09/2026, Công ty TNHH Công nghệ Hubsell đã gửi đăng ký qua form tại tinnhiemmang.vn cho hai chứng nhận:
- Tín nhiệm Tổ chức;
- Tín nhiệm Website (gói Cơ bản) cho https://hubsell.vn.

Đến nay công ty chưa nhận được phản hồi hay bộ tiêu chí đánh giá. Kính đề nghị Trung tâm kiểm tra giúp hồ sơ đã được tiếp nhận chưa; nếu chưa, xin hướng dẫn để công ty gửi lại.

Thông tin tổ chức:
- Tên: CÔNG TY TNHH CÔNG NGHỆ HUBSELL — Mã số doanh nghiệp 0111626360
- Địa chỉ: Số nhà 5k1, Ngõ 5, TT75, Tổng Cục II, BQP, Tổ dân phố Kim Chung, Xã Hoài Đức, Thành phố Hà Nội
- Website: https://hubsell.vn (ngoài ra hubsell.tech, app.hubsell.tech)
- Người đại diện: Nguyễn Trung Hiếu — Giám đốc — 0965863292
- Email liên hệ / đầu mối tiếp nhận sự cố an toàn thông tin: support@hubsell.vn
- Lĩnh vực: dịch vụ trực tuyến (phần mềm quản lý bán hàng đa sàn). Website đã hoàn thành thông báo nền tảng TMĐT với Bộ Công Thương (hồ sơ công khai: https://online.gov.vn/nen-tang/3419a3ba-7e49-4677-ad65-3d1c54c17f14).

Trân trọng,
Nguyễn Trung Hiếu
Giám đốc — Công ty TNHH Công nghệ Hubsell
```

Có kết quả → điền `TRUST_BADGES.tinNhiemMangSlug`, logo tự hiện cạnh logo BCT ở footer.

## 3. Nói không với hàng giả — KHÔNG làm được, lý do

Đã tra moit.gov.vn + online.gov.vn 27/09/2026:

- Chương trình là **lễ ký cam kết 18/04/2019** do Cục TMĐT & KTS tổ chức cho 5 sàn (Adayroi, Lazada, Sendo, Shopee, Tiki), sau mở cho một số website bán hàng lớn; logo gắn kèm hotline và quy trình xử lý phản ánh hàng giả.
- **Không có mục đăng ký trên online.gov.vn**, không có mẫu cam kết công khai, không có tiêu chí xét. Muốn tham gia phải liên hệ Cục (hotline 0866.59.4498, BaoCT@moit.gov.vn) và họ chỉ xét đơn vị bán hàng hóa.
- Hubsell bán phần mềm, không bán hàng hóa → sai bản chất. Sapo có vì bán web bán hàng + POS.

Chốt: bỏ. Nếu anh vẫn muốn thì việc duy nhất là gọi hotline Cục hỏi "phần mềm SaaS có được ký cam kết không" — em không khuyến nghị.

## 4. ISO 27001 / 9001 — hoãn

Ước chi phí ISO 27001 tại Việt Nam: tư vấn 80–200 triệu + đánh giá 40–100 triệu, 4–8 tháng, tái đánh giá hằng năm (ước lượng, chưa lấy báo giá). Kích hoạt cùng điều kiện với giao diện tiếng Anh: khách Business/Enterprise đòi hoặc ≥2 lead hỏi.

## 5. Cách gắn lên landing (đã chuẩn bị sẵn code 27/09)

- `hubsell-landing/src/lib/site.ts`: hằng `TRUST_BADGES` gồm `bctPublicId` (✅ đã điền 21/10) và `tinNhiemMangSlug` (rỗng cho tới khi NCA cấp). Hàm `trustBadgeItems()` dựng link + ảnh từ 2 giá trị này.
- `hubsell-landing/src/components/site-footer.tsx`: ô `<TrustBadges/>` = ô cuối của `<dl>` khối pháp nhân; `<dl>` dùng **cùng lưới 5 cột với tầng 1** (`1.15fr + 4×1fr`, Trụ sở span 2) để mép trái thẳng với cột link phía trên (Chứng nhận thẳng với Quy chế nền tảng — anh chốt 21/10 "canh cho thẳng hàng"); nhãn "Chứng nhận", ảnh cao 44px; mobile xếp xuống dưới Hỗ trợ; **tự ẩn khi cả hai rỗng**.
- Nếu mã nhúng thật NCA gửi khác dạng `tinnhiemmang.vn/handle_cert?id=hubsell.vn`, sửa `trustBadgeItems()` theo mã họ gửi (chỉ một chỗ).
- Vị trí: chỉ footer (mọi trang). Không làm khối "chứng nhận" riêng to như Sapo cho tới khi có ≥3 huy hiệu.

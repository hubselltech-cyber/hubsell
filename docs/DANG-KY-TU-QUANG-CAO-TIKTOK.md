# Đăng ký cho khách đến từ TikTok — trình duyệt nhúng, form ngắn, câu hỏi mức chi quảng cáo

> 12/11/2026. Anh Trung: "Làm mục 2 trước" (mục 2 phần "Hubsell nên làm gì" trong
> `hubsell-marketing/chien-luoc/nghien-cuu/reports/Tệp khách và kênh lấy khách.md`).
> Trạng thái: ĐÃ CODE + SOI LOCAL, CHƯA COMMIT / PUSH.

## 1. Vì sao

- Quảng cáo TikTok Traffic 09–10/11: 423 lượt bấm về `/login?ref=HUBSELL101`, **0 đăng ký**.
  Khách mở link trong **trình duyệt nhúng của TikTok**: Google chặn đăng nhập OAuth ở đây từ 30/09/2021
  (lỗi 403 `disallowed_useragent`), nên nút "Tiếp tục với Google" là nút chết. Đường còn lại là form 7 ô
  trên điện thoại.
- Khách trả tiền của Hubsell gần như đều chi quảng cáo ≥10 triệu đ/tháng (nhóm chi 0 đ: 0/159 trả tiền).
  Các công cụ tối ưu quảng cáo nước ngoài (Perpetua, Teikametrics) hỏi mức chi ngay trên form để chia luồng.

## 2. Đã làm

| Phần | Thay đổi | Tệp |
|---|---|---|
| Nhận biết trình duyệt nhúng | Theo user agent: TikTok (`musical_ly`, `trill_`, `BytedanceWebview`), Messenger, Facebook (`FBAN/FBAV/FB_IAB`), Instagram, Zalo, Line | `frontend/src/lib/in-app-browser.ts` |
| Trong trình duyệt nhúng | Ẩn nút Google (cả Đăng nhập lẫn Đăng ký); hiện hộp nhắc vàng "Bạn đang mở Hubsell trong ứng dụng TikTok… dùng email bên dưới, hoặc mở link bằng Chrome / Safari" + nút **Sao chép link** (Clipboard API, hỏng thì chép kiểu cũ) | `frontend/src/components/auth/social-buttons.tsx` (`useInAppBrowser`, `InAppBrowserNotice`) |
| Form đăng ký | 7 ô → 4 ô + 1 câu chọn + tick: Họ tên · SĐT (Zalo) · Email · Mật khẩu · **Mức chi** · đồng ý. Bỏ "Tên đăng nhập" (backend tự sinh từ email, y như khách Google; đăng nhập bằng email vẫn được) và "Nhập lại mật khẩu" (ô mật khẩu có nút xem; quên thì đặt lại qua email) | `frontend/src/app/login/page.tsx` |
| Câu hỏi mức chi | "Mỗi tháng shop chi bao nhiêu cho quảng cáo sàn?" — 5 nút một chạm: Chưa chạy · Dưới 5 triệu · 5–10 triệu · 10–30 triệu · Trên 30 triệu (bắt buộc ở form web). Mốc 5/10/30 triệu **tự chọn**, quanh trung vị khách trả ~22 triệu | `frontend/src/lib/ad-spend-band.ts`, `backend/src/lib/ad-spend-band.ts` |
| Lưu | Cột `User.adSpendBand` (TEXT, nullable; NONE / LT_5M / M5_10 / M10_30 / GT_30M). API nhận sai/thiếu → null, **không chặn** đăng ký (app mobile, client cũ, Google không gửi) | migration `20261112120000_user_ad_spend_band`, `backend/src/routes/auth.ts` |
| HQ | Thư "Khách mới" thêm SĐT + mức chi; khách ≥10 triệu thì tiêu đề có "⭐ Chi ads ≥10tr —" để nhắn Zalo trong ngày. HQ → Khách hàng, cột Quy mô thêm dòng "Ads/tháng: …" (≥10 triệu chữ xanh đậm) | `backend/src/services/customer-mails.ts`, `backend/src/routes/admin.ts`, `frontend/src/app/admin/customers/page.tsx` |

Không đổi: app mobile (màn Đăng ký trong app giữ nguyên, không gửi mức chi), luồng Google ở trình duyệt thường,
đăng nhập nhân viên "chủ/nhânviên" (username chủ shop vẫn có, chỉ là tự sinh).

## 3. Đã kiểm (local, 12/11/2026)

- Giả lập user agent TikTok Android + iOS trên `/login?ref=…` ở cỡ 375 px: Đăng nhập và Đăng ký đều hiện hộp nhắc,
  không có nút Google; "Sao chép link" đổi thành "Đã sao chép link".
- Bỏ trống mức chi + tick → báo lỗi đúng chỗ. Điền đủ, chọn 10–30 triệu → tạo tài khoản, về màn chào.
  DB: `adSpendBand = M10_30`, SĐT E.164, username tự sinh từ email, có bản ghi đồng ý điều khoản.
- Đăng xuất → đăng nhập lại bằng email trong chế độ TikTok: vào được.
- Trình duyệt thường, chế độ tối: còn nút Google, ô đã chọn tô màu rõ.
- HQ Khách hàng: dòng "Ads/tháng: 10–30 triệu" xanh đậm dưới cột Quy mô.
- `detectInAppBrowser`: 9/9 user agent mẫu đúng (TikTok ×2, Facebook, Messenger, Instagram, Zalo, Chrome máy tính,
  Safari iPhone, Chrome Android). `backend/src/lib/ad-spend-band.test.ts` 3/3. tsc + eslint sạch.
- Tài khoản thử đã xóa khỏi DB local.

**Chưa kiểm:** máy thật trong app TikTok (user agent thật có thể khác mẫu); thư HQ (local không cấu hình mailer);
DB local có migration cũ `20260830120000_fee_audit` lỗi sẵn từ 17/09 nên migration mới áp bằng `db execute` +
`migrate resolve`, prod sẽ áp bình thường khi Render deploy.

## 4. Đo sau khi lên

- Đăng ký theo mã kênh: `hubsell-marketing/so-lieu/SQL-DANG-KY-THEO-MA-KENH.sql`.
- Tỉ lệ khách chọn ≥10 triệu theo tuần và theo nguồn: `SELECT "adSpendBand", count(*) FROM "User" WHERE "createdAt" >= '2026-11-12' GROUP BY 1`.

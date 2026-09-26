# Tóm tắt thư hằng ngày (Zoho + Gmail)

Script đọc thư mới qua IMAP từ hai hộp `dev@hubsell.vn` (Zoho) và `hubselltech@gmail.com`, xếp theo mức ưu tiên rồi in bản tóm tắt. Không tải thư về máy, không đánh dấu đã đọc, không sửa gì trên hộp thư. Chỉ lưu một file `state.json` vài trăm byte ghi mốc thư cuối đã xem.

Tác vụ định kỳ `mail-digest-hang-ngay` trong Claude Code chạy script này mỗi sáng 07:30 (khi app đang mở; nếu app tắt thì chạy lúc mở lại) và báo kết quả.

## Cài đặt một lần (anh Trung làm tay, ~10 phút)

1. `copy .env.example .env` trong thư mục này.
2. **Zoho** (mailadmin không cần, làm ở tài khoản người dùng):
   - Bật IMAP: mail.zoho.com → Cài đặt (bánh răng) → *Tài khoản mail* → chọn dev@hubsell.vn → mục *Truy cập IMAP* → bật.
   - Tạo mật khẩu ứng dụng: accounts.zoho.com → **An ninh** (Security, không phải *Bảo mật*) → *Mật khẩu theo ứng dụng* → tạo mới, đặt tên `mail-digest` → dán chuỗi vào `ZOHO_IMAP_PASS` trong `.env`.
   - Máy chủ đã điền sẵn `imappro.zoho.com` (tài khoản tổ chức trả tiền). Nếu báo lỗi đăng nhập, thử `imap.zoho.com`.
3. **Gmail** hubselltech@gmail.com:
   - Bật *Xác minh 2 bước* (myaccount.google.com → Bảo mật) nếu chưa bật.
   - Tạo *Mật khẩu ứng dụng*: myaccount.google.com/apppasswords → tên `mail-digest` → dán 16 ký tự (bỏ dấu cách) vào `GMAIL_IMAP_PASS`.
   - IMAP của Gmail mặc định đã bật với tài khoản mới; nếu lỗi thì Gmail → Cài đặt → *Chuyển tiếp và POP/IMAP* → bật IMAP.
4. Thử: `node digest.js --dry --since 3` → phải in ra thư 3 ngày gần nhất của cả hai hộp. Chạy thật lần đầu: `node digest.js`.

Mật khẩu ứng dụng chỉ nằm trong `.env` (đã nằm trong `.gitignore`). **Không dán vào chat.** Muốn thu hồi thì xóa mật khẩu ứng dụng trên Zoho/Google, script hết đọc được ngay.

## Việc còn treo (nhắc lại mỗi ngày)

Rule Zoho "Cần xử lý" gắn cờ đỏ cho cảnh báo hạ tầng và giữ chúng ở Hộp thư đến. Script coi **mọi thư đang gắn cờ trong Hộp thư đến** (cả Zoho lẫn Gmail) là việc chưa xong và in ở mục "⏳ Còn treo" đầu báo cáo, kèm số ngày treo, dù thư đã cũ. Xử lý xong thì **lưu trữ hoặc bỏ cờ** thư đó, hôm sau sẽ không nhắc nữa. Muốn tự thêm việc vào danh sách nhắc: gắn cờ thư đó trong Hộp thư đến. Trần 20 thư (`PENDING_MAX` trong `.env`).

## Cách chạy

| Lệnh | Tác dụng |
|---|---|
| `node digest.js` | Đọc thư mới hơn lần chạy trước, in tóm tắt, cập nhật mốc |
| `node digest.js --dry` | In nhưng không cập nhật mốc (xem lại mà không mất dấu) |
| `node digest.js --since 7` | Nhìn lại 7 ngày, bỏ qua mốc, không cập nhật mốc |
| `node digest.js --account zoho` | Chỉ đọc một hộp (`zoho` hoặc `gmail`) |
| `node digest.js --json` | In JSON để máy đọc |

Mã thoát: `0` bình thường, `2` có hộp không đọc được (thiếu cấu hình / sai mật khẩu), `1` lỗi khác.

## Mức ưu tiên (sửa trong `rules.js`)

| Mức | Nhóm | Nguồn |
|---|---|---|
| P0 | Hạ tầng cần xử lý ngay | Render, Supabase, MISA, Zoho, Vercel, payOS, Mắt Bão kèm chữ Action Required / failed / exceeded / Restrictions / Invalid payment / Bandwidth / quota / suspend / expired / security / cảnh báo… |
| P1 | Sàn & chính sách | Shopee, Lazada, TikTok, Apple, Google, MISA: duyệt app, đổi API, chính sách, ticket, xác minh |
| P1 | Khách hàng | thư mục Hỗ trợ / Thanh toán trên Zoho, hoặc gửi tới support@ / billing@ |
| P1 | Người gửi khác | thư người thật không thuộc nhóm nào, để không bỏ sót |
| P2 | Pháp lý & nhà nước | gov.vn, dichvucong, dangkyquamang, ipvietnam, D&B, CRIF, Bộ Công Thương |
| P2 | Hóa đơn nhà cung cấp | Stripe (Render), Zoho Books, thư có chữ invoice / receipt |
| P3 | Hệ thống Hubsell | tiêu đề có `[Hubsell]` |
| P4 | Bản tin / thông báo thường | chỉ đếm số, không liệt kê |
| SKIP | DMARC | bỏ qua |

Thư mục Zoho được đọc: Hộp thư đến, Hỗ trợ, Thanh toán, Hạ tầng, Hệ thống. Bản tin và DMARC chỉ đếm. Gmail đọc Hộp thư đến. Đổi trong `.env` (`ZOHO_FOLDERS`, `GMAIL_FOLDERS`).

## Thêm sàn / đối tác mới

Mở `rules.js`, thêm tên miền vào `MARKET_DOMAINS` (sàn), `INFRA_DOMAINS` (hạ tầng) hoặc `LEGAL_DOMAINS` (pháp lý). Thư của người thật không khớp nhóm nào vẫn hiện ở P1 "Người gửi khác".

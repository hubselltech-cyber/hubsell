# Apple từ chối lần 2 (08/10/2026 21:47) — chỉ còn 3.1.1, nguyên nhân thật và cách xử lý

Submission `bc9bbaf6-c12d-4808-8fbb-e6b201a0163d`, bản 1.0.0 **build 5** (commit
`f785608`, nộp lại 07/10 21:35), duyệt trên iPad Air 11-inch (M3). Hai mục
5.1.1(iv) camera và 2.1 widget **đã qua** (không còn trong thư). Mục 3.1.1 Apple
chép lại nguyên văn thư lần 1 (thuê bao mua ngoài app không có IAP; hết dùng thử
bị dẫn tới cách thanh toán khác).

## Người duyệt thấy gì — kiểm 08/10 tối

| Giả thuyết | Kiểm | Kết luận |
|---|---|---|
| Tài khoản demo `reviewer@hubsell.vn` hết dùng thử | SQL Supabase: gói **Business, ACTIVE, isTrial=false, kỳ tới 27/08/2027** | **Không** — tài khoản demo không bao giờ hiện trạng thái hết hạn |
| Người duyệt tự đăng ký tài khoản mới (như lần 1) | Build 5 màn Đăng ký còn dòng **"Dùng thử miễn phí, không cần thẻ"** | Rất có thể — chữ "dùng thử" = có thuê bao trả phí đứng sau |
| Tài khoản mới chưa nối gian → Tổng quan hiện thẻ "chưa có gian" có nút **"Kết nối gian hàng trên web"** mở `app.hubsell.tech/channels` trong trình duyệt | Web app hiện dải "Dùng thử còn N ngày · Nâng gói" + trang Gói & giá | **Đây là chỗ "dẫn người dùng tới cách thanh toán ngoài app"** đúng nghĩa đen — còn nguyên trên master |
| Cấu hình → Trung tâm hỗ trợ mở `hubsell.vn/ho-tro` | Landing có menu Bảng giá | Rủi ro thấp hơn, Apple ít bắt trang chính sách/hỗ trợ |

## Sửa trong build 6 (master từ 08/10 trưa + 1 việc mới)

1. ✅ Đã có trên master (3 commit 08/10, chưa vào build 5): màn Đăng ký bỏ "Dùng thử
   miễn phí", Tài khoản ẩn dòng gói trên cả hai nền tảng, dải nhắc / thẻ khóa chữ trung
   tính, câu lỗi `PLAN_*` thay trung tính.
2. ⏳ **Mới**: thẻ "chưa có gian" ở Tổng quan **bỏ nút mở web app**; chỉ còn chữ "Chủ shop
   kết nối gian hàng trên bản web Hubsell, sau đó bấm Tải lại" + nút Tải lại. Trang
   `no-access` giữ nguyên (chỉ chữ, không link).
3. Không đổi: link Hỗ trợ / Chính sách / Điều khoản / Xóa tài khoản (Apple bắt buộc có).

Dự phòng nếu bị từ chối lần 3 cùng lý do: **bỏ hẳn màn Đăng ký trên app** (tài khoản
tạo trên web, app chỉ đăng nhập) — cắt mọi khái niệm "dùng thử" khỏi tầm mắt Apple.

## Nội dung trả lời (dán vào Reply to App Review, cùng lúc chọn build 6 → Update Review → Resubmit)

```
Hello,

Thank you for the review. We would like to clarify how Hubsell works and
what we changed in build 6.

Guideline 3.1.1 – In-App Purchase

Hubsell for iOS is a free stand-alone companion app to our paid web-based
business tool for online merchants (guideline 3.1.3(f)). Nothing is sold,
purchased, unlocked or upgraded in the app, and the app contains no prices,
no purchase buttons and no links to a purchase page.

The demo account provided in the Sign-in information section
(reviewer@hubsell.vn) is a regular paid business account with no trial
and no expiry; it never shows any "trial expired" state.

We believe the issue was caused by two elements that a newly registered
account could see in build 5, and both are removed in build 6:

1. The registration screen contained the sentence "Dung thu mien phi,
   khong can the" ("Free trial, no card required"). It has been removed;
   the screen now only says that the app shares the same account as the
   Hubsell web version.

2. For an account with no marketplace store connected yet, the overview
   screen showed a button that opened our web application in a browser.
   That button has been removed. The screen now only explains that the
   shop owner connects stores in the web version and offers a "Reload"
   button inside the app.

In addition, the account screen no longer displays any plan, trial or
expiry information, and no message in the app refers to plans, pricing,
trials, renewal or any payment mechanism, inside or outside the app.

If there is any other screen where you saw a reference to purchasing or
to an external payment option, we would be grateful if you could point us
to it so we can correct it.

Thank you.
```

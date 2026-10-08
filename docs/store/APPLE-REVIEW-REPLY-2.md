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

## Khảo sát app cùng ngành trên App Store VN (08/10 tối)

| App | IAP | Đăng ký trong app |
|---|---|---|
| Sapo - Quản lý bán hàng | CÓ (Start Up 249k, Pro 399k) | Có |
| Pancake (đa kênh) | CÓ (249k / 799k / 1.499k) | chưa rõ |
| Haravan | CÓ (xu) | KHÔNG — mô tả: "dành riêng cho khách doanh nghiệp đã có tài khoản Haravan" |
| KiotViet | Không | Có (Tạo tài khoản miễn phí, dùng thử) — ngoại lệ, không đặt cược |
| Pancake POS | Không | KHÔNG — đăng ký tại pos.pancake.vn, app chỉ đăng nhập |
| Nhanh, Sapo 365, KiotViet Online | Không | chưa rõ |

→ Không IAP mà qua Apple = lối **không đăng ký trong app** (Haravan, Pancake POS).
**Anh Trung chốt 08/10 tối: bỏ hẳn màn Đăng ký, cả iOS lẫn Android (một bản dựng).**

## Sửa trong build 6 (commit cùng ngày)

1. **Gỡ màn Đăng ký**: xóa `src/app/register.tsx`, `lib/countries.ts`, `lib/username.ts`,
   `signUp` trong AuthContext, `register` + `checkUsernameAvailable` trong `api/auth.ts`.
   Màn Đăng nhập chỉ còn dòng chữ "Dùng tài khoản Hubsell sẵn có của shop bạn." (không link).
2. **Thẻ "chưa có gian" ở Tổng quan bỏ nút mở web app** (`CONNECT_CHANNEL_URL`), chỉ còn
   chữ "Chủ shop kết nối … trên bản web Hubsell" + nút "Đã kết nối xong, tải lại".
3. Đã có từ master 08/10 trưa: không chữ dùng thử / gói / gia hạn ở cả hai nền tảng,
   câu lỗi `PLAN_*` trung tính, dải nhắc + thẻ khóa trung tính.
4. Không đổi: link Hỗ trợ / Chính sách / Điều khoản / Xóa tài khoản (Apple bắt buộc).
5. `LISTING.md`: mô tả thêm "Ứng dụng không có chức năng đăng ký tài khoản."; Notes
   mục 4 viết lại (không sign-up, không trial, không link ra web app).

Lưu ý khi nói với Apple: app KHÔNG phải "chỉ đọc" (có quét nhập kho hoàn, tạm dừng
chiến dịch, cập nhật tồn) → viết "vận hành trên dữ liệu khách đã có, không mua bán gì
trong app", đừng viết read-only kẻo người duyệt bấm thấy nút hành động.

## ✅ ĐÃ NỘP LẠI 08/10 23:23 — build mang số 7 (build 6 ngày 07/10 bị hủy nên bộ đếm nhảy)

EAS build `3b29ffe5` (22:40) → `eas submit` (23:09) → trên ASC: Mô tả + Notes mới, gỡ build 5 chọn 1.0.0 (7), Update Review, Reply (thư dưới, đã đổi "build 6" thành "build 7"), Resubmit → **Waiting for Review**. Anh chốt: lần 3 bị từ chối → làm IAP.

## Các bước đã làm trên App Store Connect (để tham khảo)

1. App Store Connect → bản 1.0 → **Mô tả** thêm câu "Ứng dụng dành cho khách hàng đã có
   tài khoản Hubsell… Ứng dụng không có chức năng đăng ký tài khoản." (LISTING.md mục 2).
2. **Notes** thay bằng khối mới ở LISTING.md mục 4.
3. Chọn **build 7** → **Update Review** → vào submission → **Reply to App Review** dán
   nội dung dưới → **Resubmit to App Review**.

## Nội dung trả lời (dán vào Reply to App Review)

```
Hello,

Thank you for the review. We have changed the app in build 7 (version 1.0)
so that the situation described in your message cannot occur, and we would like to
explain how Hubsell works.

Guideline 3.1.1 – In-App Purchase

Hubsell for iOS is a free companion app for existing customers of our
paid web-based business tool for online merchants (guideline 3.1.3(f)).
Merchants use it to work on the data their business already has in
Hubsell: today's revenue and profit, orders, returns, stock and ad
campaigns. Nothing is sold, purchased, unlocked or upgraded in the app.

The demo account in the Sign-in information section (reviewer@hubsell.vn)
is a regular paid business account with no trial and no expiry, so it
never shows any "trial expired" state.

Changes in build 7:

1. The registration screen has been removed. Accounts are created by
   merchants on our website; the app only signs in to an existing
   account, in the same way as other merchant management apps on the App
   Store (for example Haravan and Pancake POS). The sentence "Free trial,
   no card required" that appeared on the former registration screen in
   build 5 no longer exists anywhere in the app.

2. For an account with no marketplace store connected yet, the overview
   screen previously showed a button that opened our web application in
   a browser. That button has been removed; the screen now only explains
   that stores are connected in the web version and offers a "Reload"
   button inside the app.

3. The app shows no plan, trial, pricing, renewal or expiry information
   on any screen, and no message in the app refers to any payment
   mechanism, inside or outside the app. The only external links are the
   support centre, privacy policy, terms of service and account deletion
   policy pages, which the guidelines require.

Build 7 therefore contains no purchasing and no call to action for
purchase outside the app. If you still see a screen that appears to
reference purchasing or an external payment option, we would be grateful
if you could point us to it so we can correct it.

Thank you.
```

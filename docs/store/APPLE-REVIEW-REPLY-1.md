# Apple từ chối lần 1 (06/10/2026) — nguyên văn, cách sửa, nội dung trả lời

Submission `bc9bbaf6-c12d-4808-8fbb-e6b201a0163d`, bản 1.0.0 build 4, duyệt trên
**iPad Air 11-inch (M3)**. Người duyệt **tự đăng ký tài khoản mới** (không dùng
`reviewer@hubsell.vn`) vì Notes cũ ghi "The app has no sign-up" — sai, app có màn
Đăng ký. Thư của Apple (đọc 07/10) nêu đúng 3 mục dưới; bản phân tích sơ bộ hôm
06/10 (xóa tài khoản, SĐT) đoán sai một phần nhưng code đã làm thì vẫn giữ vì có lợi.

| Guideline | Apple viết gì (nguyên ý) | Sửa trong build 5 |
|---|---|---|
| **5.1.1(iv) Privacy – Data Collection and Storage** | App "thúc" người dùng cấp quyền camera: màn giải thích trước hộp xin quyền có nút **"Cấp quyền"**. Phải đổi thành chữ kiểu **"Continue" / "Next"**. Nếu tính năng không chạy được khi thiếu camera thì nên báo và **đưa link vào Settings**. | `ScanScreen`: tiêu đề "Quét mã vận đơn bằng camera", câu giải thích trung tính ("Ở bước tiếp theo, hệ thống sẽ hỏi bạn có cho phép hay không"), nút **"Tiếp tục"**. Khi đã từ chối (`canAskAgain=false`): "Camera đang tắt cho Hubsell…" + nút **"Mở Cài đặt"** (`Linking.openSettings()`), kèm gợi ý tìm đơn ở tab Đơn hàng không cần camera. |
| **3.1.1 Business – Payments – In-App Purchase** | App cho truy cập nội dung số mua ngoài app (**account subscriptions**) mà không bán được qua IAP; **khi hết dùng thử, người dùng bị dẫn tới cách thanh toán ngoài IAP**. Gợi ý 3.1.3(b) multiplatform. | (1) `AccountScreen` **ẩn hẳn dòng "Gói đang dùng · Dùng thử · hết hạn"** trên iOS. (2) `api/client.ts`: lỗi backend mã `PLAN_*` (gói hết hạn / vượt trần: "gia hạn để tiếp tục…", "nâng gói…") **thay bằng câu trung tính** không nhắc gói/giá/nơi mua. Trả lời Apple theo **3.1.3(f) Free Stand-alone Apps**: app miễn phí đi kèm công cụ web trả phí, trong app không mua gì và không có lời mời mua ở ngoài. |
| **2.1 Information Needed** | "App appears to offer **widget extension** functionality but we couldn't find a widget option — confirm and give instructions to enable it." | App **không có widget**; không khai `NSExtension`, không có gói widget nào trong `package-lock.json`, mô tả/từ khóa không nhắc widget. Trả lời xác nhận không có; nhờ Apple chỉ chỗ nào trong hồ sơ gợi ý vậy để sửa. |

Việc làm thêm từ phiên 06/10 (không phải Apple đòi nhưng giữ): nút **Xóa tài khoản**
trong app + API `POST /api/auth/me/delete` (5.1.1(v) chắc chắn sẽ bị hỏi ở lần sau
nếu thiếu), SĐT đăng ký không bắt buộc.

## Việc anh làm tay

1. Gộp nhánh `claude/gracious-galileo-w5yruu` vào `master` → Render tự chạy migration
   `20261006160000_user_deleted_at` + deploy backend (**backend lên trước** khi nộp).
2. `cd hubsell-mobile && eas build -p ios --profile production --non-interactive`
   (autoIncrement → build 5) → `eas submit -p ios --latest`.
3. (Tùy chọn, để chắc câu trả lời widget) tải `.ipa` từ trang build EAS, đổi đuôi
   `.zip`, giải nén, xem `Payload/Hubsell.app/` **không có thư mục `PlugIns`** — không
   có app extension nào.
4. App Store Connect → bản 1.0 → thay **Notes** bằng khối mới trong `LISTING.md` mục 4
   → chọn build 5 → vào submission → **Reply to App Review** dán nội dung dưới →
   **Resubmit to App Review**.
5. Kiểm trước khi nộp: `reviewer@hubsell.vn` đăng nhập được trên web bằng đúng mật
   khẩu đã điền trong Sign-in information.

## Nội dung trả lời (dán vào Reply to App Review)

```
Hello,

Thank you for the detailed review. We have addressed each point in build 5
(version 1.0):

Guideline 5.1.1(iv) – Data Collection and Storage
The explanation screen shown before the camera permission request has been
rewritten. It now neutrally describes what the camera is used for, states
that the system will ask for permission in the next step, and the button
reads "Tiep tuc" ("Continue") instead of "Cap quyen" ("Grant permission").
If camera access was previously declined, the screen explains that camera
access is off for Hubsell and offers an "Open Settings" button that opens
the app's page in the Settings app; it also points out that orders can be
found by typing the last digits of a code, so no feature depends on the
user granting access.

Guideline 3.1.1 – In-App Purchase
Hubsell for iOS is a free stand-alone companion app to our paid web-based
business tool (guideline 3.1.3(f)). Merchants (businesses) buy a Hubsell
service contract from us on the web by bank transfer with a VAT invoice;
nothing is or can be purchased in the app. In build 4 the account screen
displayed the merchant's current plan and trial status, and some server
messages mentioned renewing the plan. In build 5 we removed the plan/trial
information from the iOS app entirely, and the app no longer shows any
message that refers to plans, pricing, trials, renewal or any purchase
mechanism, inside or outside the app. The app contains no prices, no
purchase entry points and no links to a purchase page.

Please note that the demo account in the Sign-in information section is
connected to sample marketplace stores with orders, stock and finance data.
A freshly registered account has no stores connected yet (that requires a
real Shopee/Lazada/TikTok seller account), so most screens would be empty.

Guideline 2.1 – Information Needed (widget)
We confirm that the app does not offer any widget or app extension
functionality. The binary contains no app extensions (no NSExtension
targets, no WidgetKit code), and our App Store metadata does not mention
widgets. If something in our submission gave the impression of a widget
option, we would be grateful if you could point us to it so we can correct
it.

Additionally, build 5 adds in-app account deletion (Settings tab "Cau
hinh" -> name row -> "Xoa tai khoan", confirmed with the current password)
and makes the phone number optional on the registration form.

Thank you,
Hubsell Technology
```

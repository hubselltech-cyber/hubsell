# Apple từ chối lần 1 (06/10/2026) — nguyên nhân, cách sửa, nội dung trả lời

Submission `bc9bbaf6-c12d-4808-8fbb-e6b201a0163d`, bản 1.0.0 build 4, người duyệt
thử trên **iPad**, **tự đăng ký tài khoản mới** (không dùng `reviewer@hubsell.vn`)
vì Notes cũ ghi "The app has no sign-up". Ba guideline bị nêu:

| Guideline | Apple thấy gì (ảnh họ gửi) | Sửa trong bản build 5 |
|---|---|---|
| **2.1.0 Performance – App Completeness** | Màn quét: bấm "Cấp quyền Camera" không có gì xảy ra (iOS chỉ hỏi quyền một lần; đã từ chối thì `requestPermission()` về ngay). | `ScanScreen`: khi `canAskAgain=false` nút đổi thành **Mở Cài đặt** (`Linking.openSettings()`), kèm dòng gợi ý tìm đơn ở tab Đơn hàng không cần camera. |
| **3.1.1 Business – Payments – IAP** | Màn Tài khoản hiện "Gói đang dùng: Scale · Dùng thử · Hết hạn 20/10/2026 · còn 14 ngày". | `AccountScreen`: **ẩn dòng gói trên iOS** (Android giữ). Notes mới nói rõ gói là hợp đồng B2B mua trên web, app không có điểm mua. |
| **5.1.1 Legal – Privacy – Data Collection and Storage** | App có đăng ký nhưng chỉ có link "Yêu cầu xóa tài khoản" ra web bảo gửi email (5.1.1(v)); form đăng ký bắt nhập SĐT. | Backend `POST /api/auth/me/delete` (xóa mềm + ẩn danh ngay, token hết hiệu lực, xóa cứng sau 30 ngày bằng `scripts/purge-deleted-accounts.ts`); app có khối **Xóa tài khoản** trong trang Tài khoản (nhập mật khẩu + hộp xác nhận). Ô **SĐT thành không bắt buộc**. |

## Việc anh làm tay

1. Gộp nhánh vào `master` → Render tự chạy migration `20261006160000_user_deleted_at` + deploy backend. **Backend phải lên trước** khi người duyệt bấm xóa.
2. `cd hubsell-mobile && eas build -p ios --profile production --non-interactive` (autoIncrement → build 5) → `eas submit -p ios --latest`.
3. App Store Connect → bản 1.0 → thay **Notes** bằng khối mới trong `LISTING.md` mục 4 → chọn build 5 → vào **App Review → submission** dán trả lời dưới vào Messages → **Resubmit to App Review**.
4. Kiểm trước khi nộp: đăng nhập `reviewer@hubsell.vn` trên web còn đúng mật khẩu đã điền trong ô Sign-in information.

## Nội dung trả lời (dán vào Messages của submission)

```
Hello,

Thank you for the detailed review. We have addressed all three points in
build 5 (version 1.0):

Guideline 2.1.0 – App Completeness
The "Grant camera access" button on the scan screen did nothing after
camera access had been declined once, because iOS does not show the
permission prompt a second time. The screen now detects this state and the
button opens the app's page in Settings instead, with a hint that orders
can also be found by typing the last digits of a code (no camera needed).

Guideline 3.1.1 – In-App Purchase
The account screen displayed the merchant's current service plan and trial
status. Hubsell plans are B2B service contracts that businesses buy from us
on the web (bank transfer with a VAT invoice); nothing is or can be
purchased in the app, and the app never links to a purchase page. To avoid
any confusion we have removed the plan/trial information from the iOS app
entirely. The app contains no prices, plans, trials or upgrade entry points.

Guideline 5.1.1 – Data Collection and Storage
(a) Account deletion is now available inside the app: Settings tab ("Cau
hinh") -> tap the name row at the top -> "Xoa tai khoan" -> enter the
current password -> confirm. Personal data (name, email, phone, avatar,
credentials) is erased immediately and the account can no longer sign in;
remaining business records are purged within 30 days, as described in our
privacy policy.
(b) The phone number field on the registration form is now optional; only
name, email and password are required.

Please note that the demo account in the Sign-in information section is
connected to sample marketplace stores with orders, stock and finance data.
A freshly registered account has no stores connected yet (that requires a
real Shopee/Lazada/TikTok seller account), so most screens would be empty.

Thank you,
Hubsell Technology
```

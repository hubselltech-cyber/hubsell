# Đăng nhập Google + Apple trong app mobile (bản 1.3.0)

> Anh Trung chốt 18/10/2026 đêm: "Nộp 1.2.1 như đang chạy. Sau đó làm bản 1.3.0 có nút Google + Sign in with Apple trong app."
> Bối cảnh: khách đăng ký web bằng nút Google không có mật khẩu → không vào được app (chỉ ô email + mật khẩu). Bản 1.2.1 vá bằng dòng chỉ đường sang web đặt mật khẩu; 1.3.0 là lối thẳng.

## 1. Luật Apple chi phối thiết kế

| Luật | Hệ quả |
|---|---|
| 4.8 Login Services | App có đăng nhập Google (bên thứ ba) → PHẢI có thêm một dịch vụ tương đương về quyền riêng tư. Sign in with Apple là cách đạt chuẩn chắc nhất → iOS có cả 2 nút. Android chỉ cần Google. |
| 4.8 (đoạn 2) | Nút Apple phải "ngang hàng" nút Google: cùng cỡ, cùng vị trí, không được giấu dưới "Cách khác". |
| 5.1.1(v) | App có Sign in with Apple thì khi khách xóa tài khoản PHẢI gọi REST API thu hồi token Apple (`/auth/revoke`). Đã có xóa tài khoản trong app → bổ sung bước thu hồi. |
| Human Interface Guidelines | Dùng nút chuẩn `AppleAuthenticationButton` (expo-apple-authentication), không tự vẽ. |

## 2. Luồng

```
App (iOS/Android)                         Backend                           Google / Apple
──────────────────                        ────────                          ─────────────
Bấm "Tiếp tục với Google"
  → SDK native mở bộ chọn tài khoản ───────────────────────────────────────▶ Google
  ◀── idToken (JWT, aud = client iOS/Android) ──────────────────────────────
POST /api/auth/social/google {idToken} ──▶ verify JWKS Google
                                           iss accounts.google.com, aud ∈ {iOS, Android, Web}
                                           exp, email_verified
                                           upsertSocialUser(google, sub, email, name)
  ◀── {token, user} (JWT Hubsell như /login) ─
persistSession → vào app

Bấm "Đăng nhập bằng Apple" (chỉ iOS)
  → expo-apple-authentication ───────────────────────────────────────────▶ Apple (Face ID)
  ◀── identityToken, authorizationCode, fullName (CHỈ LẦN ĐẦU), email (có thể là relay)
POST /api/auth/social/apple {identityToken, authorizationCode, fullName?} ──▶
                                           verify JWKS https://appleid.apple.com/auth/keys
                                           iss https://appleid.apple.com, aud = vn.hubsell.app
                                           đổi authorizationCode → refresh_token (client_secret = JWT ES256 ký bằng key SIWA)
                                           upsertSocialUser(apple, sub, email, name) + lưu refresh_token mã hóa
  ◀── {token, user}
```

### 2.1 `upsertSocialUser` (tách từ callback Google web, dùng chung 3 lối)

1. Tìm theo `googleId` / `appleUserId` → có → đăng nhập.
2. Chưa có → tìm theo email (đã lower) → có → **liên kết** (ghi id nhà cung cấp vào user đó) → đăng nhập. Email Apple relay (`@privaterelay.appleid.com`) không trùng ai → sang bước 3.
3. Chưa có → tạo chủ shop mới: username sinh từ email, `passwordHash` ngẫu nhiên, **`passwordSetAt` NULL**, role ADMIN, `TermsAcceptance` nguồn `google_app` / `apple_app`, gói mặc định, thư chào mừng (nguồn mới "apple" chỉ đổi câu đầu).
4. Apple lần sau không trả email → chỉ bước 1; không thấy → trả lỗi rõ: "Vào Cài đặt iPhone → Apple ID → Đăng nhập bằng Apple → Hubsell → Dừng sử dụng, rồi thử lại" (mất mối vì xóa tài khoản nhưng chưa dừng ở Apple ID).

### 2.2 Xóa tài khoản

`deleteOwnAccount` (account-deletion.ts) thêm bước: user có `appleRefreshTokenEnc` → giải mã → `POST https://appleid.apple.com/auth/revoke` (`token_type_hint=refresh_token`). Lỗi mạng không chặn xóa, ghi log `[account-deletion] apple revoke`.

Xóa tài khoản hiện đòi mật khẩu (`{password}`) → tài khoản social không có mật khẩu (passwordSetAt NULL) **không xóa được** → sửa: `hasPassword=false` thì không đòi mật khẩu, chỉ đòi xác nhận trên app (kiểm cơ chế xác nhận hiện có khi code).

## 3. Thay đổi dữ liệu

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `User.appleUserId` | String? @unique | `sub` Apple — ổn định theo Team ID. |
| `User.appleRefreshTokenEnc` | String? | refresh_token mã hóa bằng `lib/secret-box.ts`, chỉ dùng để thu hồi khi xóa tài khoản. |
| `TermsAcceptanceSource` | thêm `google_app`, `apple_app` | đồng ý ngầm qua dòng chữ dưới hai nút. |

Migration: cột NULL + chỉ mục unique, khóa có thử lại (bẫy deadlock Render).

## 4. Backend

- `services/social-login.ts`: `verifyGoogleIdToken(idToken)` (JWKS `https://www.googleapis.com/oauth2/v3/certs`, cache theo `Cache-Control`), `verifyAppleIdentityToken(token)` (JWKS Apple), `exchangeAppleAuthorizationCode(code)`, `revokeAppleToken(refreshToken)`, `upsertSocialUser(...)`. JWT verify bằng `jose` (thêm dep) — `jsonwebtoken` hiện có không đọc JWKS.
- `routes/auth.ts`: `POST /api/auth/social/google`, `POST /api/auth/social/apple` (public, rate-limit như /login theo IP); callback Google web chuyển sang dùng `upsertSocialUser` (hành vi không đổi, test cũ phải xanh).
- `/api/auth/me` trả thêm `linked: { google: boolean, apple: boolean }` (web Cài đặt hiện "Đã liên kết Google / Apple" — lát sau nếu cần).
- Env mới (Render web): `GOOGLE_IOS_CLIENT_ID`, `GOOGLE_ANDROID_CLIENT_ID` (aud chấp nhận thêm `GOOGLE_CLIENT_ID` web sẵn có), `APPLE_SIWA_TEAM_ID=BF6Y7D47P5`, `APPLE_SIWA_KEY_ID`, `APPLE_SIWA_PRIVATE_KEY` (.p8, base64), `APPLE_SIWA_CLIENT_ID=vn.hubsell.app`. Thiếu env → route trả 503 (pattern Lazada/Google web).

## 5. Mobile

- Gói: `expo-apple-authentication` (plugin + `ios.usesAppleSignIn: true`), `@react-native-google-signin/google-signin` (plugin với `iosUrlScheme` = reversed iOS client id). Cả hai cần build native mới (EAS) — không chạy trong Expo Go.
- `login.tsx`: dưới nút Đăng nhập → vạch "Hoặc" → nút **Tiếp tục với Google** (cả 2 nền) + nút **Đăng nhập bằng Apple** (iOS, `AppleAuthenticationButton` kiểu BLACK/WHITE theo theme, cùng chiều cao nút Google). Dòng chữ nhỏ: "Bằng việc tiếp tục với Google/Apple, bạn đồng ý Điều khoản và Chính sách bảo mật" (giống web; mở link web). KHÔNG chữ "đăng ký", "dùng thử", "gói" (3.1.1, 3.1.3(f)).
- `AuthContext`: thêm `signInWithGoogle()`, `signInWithApple()` → gọi API → `persistSession`.
- Lỗi SDK Google `SIGN_IN_CANCELLED` → im lặng; `DEVELOPER_ERROR` (SHA-1 chưa khai) → câu rõ cho dev.
- Dòng chỉ đường 1.2.1 giữ lại nhưng rút thành "Quên mật khẩu?" (khách Google không còn cần đặt mật khẩu để vào app).

## 6. Cấu hình bên ngoài (việc tay, cần tài khoản anh)

| # | Ở đâu | Việc | Ai |
|---|---|---|---|
| C1 | Google Cloud Console (dự án đang giữ `GOOGLE_CLIENT_ID` web) | Tạo OAuth client **iOS**: bundle `vn.hubsell.app` → lấy client id + reversed scheme | em qua Chrome anh / anh |
| C2 | Google Cloud Console | Tạo OAuth client **Android**: package `vn.hubsell.app` + **SHA-1** của (a) khóa upload EAS (`eas credentials -p android`), (b) khóa **Play App Signing** (Play Console → Thiết lập → Toàn vẹn ứng dụng). Thiếu (b) thì bản tải từ Play báo DEVELOPER_ERROR. | em lấy (a); (b) cần anh mở Console |
| C3 | Apple Developer → Identifiers → `vn.hubsell.app` | Bật capability **Sign in with Apple** (EAS build thường tự đồng bộ từ entitlements; kiểm lại) | em / EAS |
| C4 | Apple Developer → Keys | Tạo key **Sign in with Apple** (.p8) → Key ID; tải về MỘT LẦN, cất gitignore + đặt env Render | anh (tải .p8) |
| C5 | Render web | 6 env mục 4 | anh dán / em soạn |
| C6 | App Store Connect | App Privacy không đổi (đã khai email, tên). Ghi chú người duyệt: tài khoản reviewer vẫn đăng nhập bằng mật khẩu. | em |

## 7. Thứ tự làm

1. Backend + migration + test (verify token giả bằng khóa test, upsert 3 nhánh, xóa tài khoản không mật khẩu) → push → Render deploy.
2. Mobile: gói + plugin + nút + AuthContext; chạy thử iOS simulator qua EAS development build hoặc preview; Android preview APK trên máy anh.
3. C1–C5 cấu hình; thử thật trên máy anh (TestFlight + APK) **trước** khi nộp.
4. app.json 1.3.0, LISTING "Có gì mới", nộp 2 kho; ghi chú người duyệt nêu rõ có Sign in with Apple.

## 8. Điểm em tự chọn (anh bác được)

- Dùng `@react-native-google-signin/google-signin` (native, có bộ chọn tài khoản của máy) thay `expo-auth-session` (mở trình duyệt, trải nghiệm kém hơn, Google đang siết "embedded webview").
- Tài khoản Apple email relay tạo tài khoản mới, không ép nhập email thật (Apple cấm ép). Khách muốn gộp với tài khoản web thì vào web Cài đặt → liên kết (lát sau).
- Lưu refresh_token Apple (mã hóa) chỉ để thu hồi khi xóa — không dùng việc khác.
- Web `/login` KHÔNG thêm nút Apple (4.8 chỉ áp cho app; web giữ như cũ).

## 9. Trạng thái

- 18/10 đêm: thiết kế xong, chờ 1.2.1 nộp xong rồi code backend (mục 7 bước 1).

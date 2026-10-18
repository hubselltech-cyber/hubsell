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
- Env mới (Render web): `GOOGLE_IOS_CLIENT_ID` = client iOS (mục 6.1). **Android KHÔNG cần env riêng:** SDK Android phát idToken với `aud` = **client Web** (đã là `GOOGLE_CLIENT_ID`); hai client Android chỉ để Google kiểm package + SHA-1 lúc mở bộ chọn. `GOOGLE_ANDROID_CLIENT_ID` để trống. `APPLE_SIWA_TEAM_ID=BF6Y7D47P5`, `APPLE_SIWA_KEY_ID`, `APPLE_SIWA_PRIVATE_KEY` (.p8, base64), `APPLE_SIWA_CLIENT_ID=vn.hubsell.app`. Thiếu env → route trả 503 (pattern Lazada/Google web).

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


### 6.1 Số đã lấy (18/10 ~23:55, Chrome anh)

| Mục | Giá trị |
|---|---|
| Dự án Google Cloud giữ client web | **My Project 18602** (`static-gravity-499208-v9`), tài khoản xwearhn@gmail.com |
| Client Web sẵn có "Hubsell Web" (= `GOOGLE_CLIENT_ID` Render) | `266117474182-q8ik0gt7db03kelrq554bvlfub0c8ebn.apps.googleusercontent.com` |
| Play Console | tài khoản dev@hubsell.vn (u/3), nhà phát triển Hubsell Technology `4691969570523261762`, app `4973694311665052949` |
| ✅ Client **iOS** "Hubsell iOS" (bundle vn.hubsell.app, App Store 6819512670, Team BF6Y7D47P5) — tạo 18/10 ~23:58 | `266117474182-am79goplhqbpdogcirohc492ucqt33bp.apps.googleusercontent.com` → iosUrlScheme `com.googleusercontent.apps.266117474182-am79goplhqbpdogcirohc492ucqt33bp` |
| ✅ Client **Android** "Hubsell Android (Play App Signing)" — SHA-1 khóa ký Play | `266117474182-f0v215ija2plp3h2h67dcf3r61pnqucu.apps.googleusercontent.com` |
| ✅ Client **Android** "Hubsell Android (khoa upload EAS)" — SHA-1 khóa upload (APK preview) | `266117474182-ljdacf0bt9g4o2vur8qrd33dh0lo8i00.apps.googleusercontent.com` |
| SHA-1 khóa ký ứng dụng (Play App Signing) — bản tải từ Play | `28:6D:69:49:55:C4:B2:65:3F:93:29:5E:69:0C:D0:57:E6:90:0A:B4` |
| SHA-1 khóa tải lên (EAS ký AAB) — bản APK preview / internal | `21:3D:8D:22:37:B9:DA:83:FE:C9:B5:A5:4B:E2:C3:92:CF:83:38:FE` |

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

- 18/10 đêm: thiết kế xong; 1.2.1 đã nộp 2 kho.
- 18/10 ~23:20: **backend xong** (mục 7 bước 1) — `services/social-login.ts`, 2 route, migration, test 12 ca; chưa commit, DB dev chưa áp (classifier chặn), prod áp khi deploy. 
- 19/10 ~00:10: **C1 + C2 XONG** (em làm qua Chrome anh): 1 client iOS + 2 client Android tạo trong dự án My Project 18602; app.json đã điền `extra.googleIosClientId`, `extra.googleWebClientId`, `iosUrlScheme` thật → nút Google hiện. Còn C4 (key Apple .p8) + C5 (env Render: `GOOGLE_IOS_CLIENT_ID`, `APPLE_SIWA_*`) — anh làm.
- 18/10 ~23:40: **mobile xong phần code** (bước 2): social.ts + 2 nút + AccountScreen; app.json extra client id RỖNG → nút Google tự ẩn, nút Apple hiện trên iOS. Chờ C1–C5 (mục 6) rồi build thử TestFlight/APK (bước 3).

## 10. Thư báo khách khi 1.3.0 lên kho (anh chốt 19/10: một email, không nhắc trong app ở bản này)

Gửi cho chủ shop ACTIVE có email (ưu tiên nhóm `googleId IS NOT NULL` — họ là người kẹt). Gửi qua `safeSend` role noreply, cùng khung `shell()` của customer-mails. Nội dung nháp:

- **Tiêu đề:** Hubsell — App điện thoại có đăng nhập bằng Google (và Apple)
- Xin chào {fullName},
- Bản mới của app Hubsell đã có trên App Store và Google Play. Bạn chỉ cần cập nhật app, mở lên và bấm **Tiếp tục với Google** (iPhone có thêm **Đăng nhập bằng Apple**) là vào thẳng, không cần đặt mật khẩu.
- App Store và Google Play thường tự cập nhật trong vòng một ngày. Muốn có ngay: mở kho, tìm Hubsell, bấm **Cập nhật**.
- Nút: **Mở App Store** / **Mở Google Play** (APP_STORE_URL / Play URL sẵn có).
- Chân thư: Vướng gì cứ trả lời thư này, Hubsell đọc và trả lời từng thư.

Việc code khi gửi: script một lần `backend/scripts/mail-app-1-3-0.ts` (đọc danh sách, gửi tuần tự có nghỉ 200 ms, log số đã gửi, cờ `--dry-run` in danh sách trước) — chạy sau khi CẢ HAI kho đã phát hành, anh duyệt nội dung + danh sách dry-run rồi mới gửi thật.

## 11. Bản sau (1.4): nhắc cập nhật trong app + EAS Update

Anh chốt 19/10: làm từ bản sau. Phạm vi: backend `/api/mobile/version` (latest, min theo nền), app so `Constants.expoConfig.version` lúc mở → dải "Có bản mới" + nút mở kho, dưới min thì chặn; Android thêm Play In-App Updates (`expo-in-app-updates` hoặc tương đương); EAS Update cho thay đổi chỉ JS với `runtimeVersion` policy `appVersion` để JS mới không rơi vào native cũ.

## 12. Bản sau (1.3.1): ba việc giao diện anh Trung chốt 19/10 (xem ảnh Salework V3.3.5 anh gửi)

Anh: "Phiên bản này 2 nút Google và Apple xếp hàng dọc khá xấu. Phiên sau học theo Salework."

1. **Nút xã hội hàng ngang, dạng tròn.** Dưới nút Đăng nhập: dòng chữ xám "Hoặc đăng nhập với", rồi một hàng icon tròn ~56px cách đều: Apple (nền đen, logo trắng — chỉ iOS), Google (nền trắng viền xám, logo G màu). Không Facebook (chưa nối). Apple 4.8 vẫn đạt vì hai nút cùng cỡ, cùng hàng; HIG cho phép nút Apple "logo-only" tròn nếu giữ đúng logo + tương phản, nên tự vẽ Pressable thay `AppleAuthenticationButton` (expo-apple-authentication không có kiểu logo-only). Dòng điều khoản giữ, nhỏ hơn.
2. **"Sử dụng tài khoản nhân viên"** như Salework: một link dưới nút Đăng nhập thay cho dòng chú thích "Nhân viên đăng nhập dạng: tênchủshop/têncủabạn" — bấm thì ô nhập đổi placeholder sang "chủshop/nhânviên". Chỉ là trình bày, backend không đổi.
3. **Màn Tài khoản: Đăng xuất to, Xóa tài khoản nhỏ.** Hiện nút Xóa tài khoản (viền đỏ, to) nằm TRÊN nút Đăng xuất → dễ bấm nhầm. Đổi: Đăng xuất thành nút đầy chiều ngang, nổi; Xóa tài khoản thành một dòng chữ nhỏ (12px, xám đỏ) đặt DƯỚI CÙNG màn, cách Đăng xuất một khoảng; bấm vẫn vào hộp xác nhận + mật khẩu (nếu có) như cũ. Apple 5.1.1(v) chỉ đòi "dễ tìm trong app", dòng chữ nhỏ ở mục Tài khoản vẫn đạt (nhiều app lớn làm vậy).

KHÔNG học Salework chỗ "Đăng ký" trên màn đăng nhập — anh chốt 08/10 app không có đăng ký (Google/Apple tạo tài khoản ngầm là đủ).

Gộp cùng màn trống cho chủ shop mới chưa nối gian (phần thẻ đề xuất 19/10) thành bản **1.3.1**, nộp sau khi 1.3.0 duyệt.

### 12.4 Màn Đăng ký trong app (anh chốt 19/10 23:4x: "Thêm cả màn đăng ký nữa. Salework được thì mình cũng được")

Đảo quyết định 08/10 (gỡ Đăng ký sau khi Apple từ chối 3.1.1 lần 2). Vì sao giờ được: lý do bị 3.1.1 là luồng đăng ký dẫn tới dùng thử/mua gói ngoài IAP; từ 10/10 iOS đã có mua gói bằng IAP (màn /plan) nên tài khoản mới có đường mua hợp lệ trong app. Điều kiện giữ để không bị bắt lại:
- Màn đăng ký chỉ: Họ tên, Email, Mật khẩu (+ nhập lại), ô tick Điều khoản + Chính sách (link web). KHÔNG chữ "dùng thử", "miễn phí 14 ngày", "gói", "giá". Gọi `POST /api/auth/register` sẵn có (backend ghi TermsAcceptance nguồn `register_form`… cân nhắc thêm nguồn `register_app`), nhận token → persistSession → vào app như đăng nhập.
- Link "Đăng ký" + "Quên mật khẩu?" dưới cùng màn đăng nhập như Salework.
- Sau đăng ký, chủ shop mới chưa có gian → rơi vào màn trống mục 12.3 (bắt buộc làm cùng).
- Xóa tài khoản trong app đã có (5.1.1(v)).
- Ghi chú người duyệt: nêu rõ có tạo tài khoản, dùng thử/gói chỉ qua IAP, reviewer vẫn dùng tài khoản sẵn.

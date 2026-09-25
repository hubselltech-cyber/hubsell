# Đưa app Hubsell Mobile lên CH Play (Google Play) và App Store

Cập nhật 25/09/2026 (D-U-N-S đã cấp). App dựng bằng **Expo SDK 57** (`hubsell-mobile/`), build iOS và Android trên mây bằng **EAS Build**, không cần máy Mac.

---

## 0. Quyết định cần chốt trước khi bắt tay

| Việc | Đề xuất | Lý do |
|---|---|---|
| Loại tài khoản | **Tổ chức** ở cả 2 kho, đứng tên **CÔNG TY TNHH CÔNG NGHỆ HUBSELL** (MST 0111626360) | Google: tài khoản cá nhân lập sau 13/11/2023 bị bắt thử nghiệm kín 12 tester × 14 ngày liên tục mới được lên production, tài khoản tổ chức miễn. Apple: tài khoản cá nhân hiện tên "Nguyễn Trung Hiếu" làm nhà bán trên App Store, đổi sang tổ chức sau phải xin Apple Support. |
| Mã định danh app | `vn.hubsell.app` cho cả `ios.bundleIdentifier` và `android.package` | Android **không đổi được** sau khi phát hành; Apple cũng vậy. Đặt theo tên miền đích hubsell.vn. |
| Bán gói | **Không bán trong app, không có nút/link dẫn ra trang thanh toán** | Apple 3.1.1 và chính sách Play Billing đều bắt dùng IAP nếu app bán gói số. App chỉ đăng nhập, gói mua trên web (payOS) → hợp lệ theo Apple 3.1.3(b) "dịch vụ đa nền tảng". Hiện app chưa có lối nào ra thanh toán, giữ nguyên. |
| Thị trường phát hành | **Chỉ Việt Nam** đợt đầu | Phát hành vào EU phải khai "trader status" theo DSA (địa chỉ, SĐT, email công khai). Mở rộng sau khi cần. |

~~**Việc chậm nhất là số D-U-N-S** (1–4 tuần ở Việt Nam).~~ ✅ **Đã cấp 25/09/2026, xem mục 1.1.**

---

## 1. Xin số D-U-N-S (miễn phí, dùng chung cho cả Apple và Google)

### 1.1 ✅ KẾT QUẢ 25/09/2026: D-U-N-S **32-013-1497**

Thư D&B iResearch 10:35 25/09 (Inquiry 10960566 / Case 11019008, "Verified through a company spokesperson plus outside sources") và thư CRIF D&B Vietnam (Nhat Hoang) 10:34 cùng ngày. Hồ sơ D&B lưu như sau, **mọi thông tin nộp Apple/Google phải chép đúng từng chữ bản này** (không dùng bản tiếng Việt trên GCN):

| Mục | Giá trị D&B lưu |
|---|---|
| D-U-N-S | `32-013-1497` (nhập không gạch: `320131497`) |
| Tên pháp nhân | `HUBSELL TECHNOLOGY CO., LTD.` |
| Địa chỉ | `5K1, Lane 5, TT75, General Department II, Ministry of National Defence, Kim Chung Residential Group, Hoai Duc Commune, Ha Noi, Vietnam` |
| Điện thoại | `+84 96 5863292` |
| Website | `hubsell.vn` (khai website này, không phải hubsell.tech) |
| Email | `support@hubsell.vn` |

Thời gian đồng bộ: D&B nói 24–48 giờ cho DB địa phương, **2–3 tuần** cho sản phẩm toàn cầu; CRIF nói ít nhất 1 tuần. Apple và Google tra qua DB toàn cầu → **thử từ 29/09**; nếu báo "không tìm thấy D-U-N-S" thì chờ thêm vài ngày rồi thử lại, **tuyệt đối không xin cấp mới lần nữa** (sinh mã trùng, sửa rất lâu).

Quá trình đã đi: submit form Apple 23/09 → CRIF D&B Vietnam (đối tác D&B duy nhất tại VN) gọi + email 24/09 đòi bảng 10 mục + scan GCN → trả lời 24/09 từ `hubselltech@gmail.com` (máy chủ CRIF chặn mail Zoho hubsell.vn, lỗi 550 5.7.1) → cấp 25/09. Tổng 2 ngày.

### 1.2 Cách xin (đã làm, giữ để tham khảo)

D-U-N-S là mã 9 số do Dun & Bradstreet cấp cho pháp nhân. Cả Apple lẫn Google đều bắt buộc với tài khoản tổ chức.

1. Vào **https://developer.apple.com/enroll/duns-lookup/** (đăng nhập bằng Apple ID của công ty, xem mục 2).
2. Tra cứu trước: nhập tên công ty + Việt Nam. Công ty mới lập 09/09 gần như chắc chắn chưa có → chọn **Submit** để xin cấp mới.
3. Điền **đúng như Giấy chứng nhận ĐKDN**:
   - Tên pháp nhân: nếu GCN có "tên viết bằng tiếng nước ngoài" thì dùng tên đó (D&B lưu bản tiếng Anh), không thì ghi `CONG TY TNHH CONG NGHE HUBSELL` (không dấu).
   - Địa chỉ trụ sở: Số 5k1, Ngõ 5, TT75, Tổng Cục II, BQP, Tổ dân phố Kim Chung, Xã Hoài Đức, TP Hà Nội.
   - Điện thoại công ty, email `hubselltech@gmail.com`, người đại diện: Nguyễn Trung Hiếu, chức danh Giám đốc (Owner/CEO).
4. D&B gửi email xác nhận, có thể **đòi bản scan GCN ĐKDN** → gửi ngay, đừng để trôi.
5. Có số rồi chờ thêm **2 ngày làm việc** để Apple/Google đồng bộ được dữ liệu D&B, sau đó mới đăng ký.

Mọi thông tin nộp cho Apple và Google về sau phải **khớp từng chữ** với hồ sơ D&B (tên, địa chỉ). Sai lệch là lý do từ chối phổ biến nhất.

---

## 2. Chuẩn bị chung (làm trong lúc chờ D-U-N-S)

### 2.1 Tài khoản và thanh toán
- **Thẻ Visa/Mastercard thanh toán quốc tế** đứng tên anh hoặc công ty. Phí: Google **25 USD một lần**, Apple **99 USD/năm**.
- **Apple ID riêng cho công ty**: tạo bằng `hubselltech@gmail.com` (hoặc email đuôi @hubsell.tech nếu anh có hộp thư thật, Apple duyệt tổ chức nhanh hơn khi email cùng tên miền website). Bật xác thực 2 lớp, đăng nhập trên **một iPhone thật** vì việc đăng ký làm qua app **Apple Developer** trên iPhone.
- **Tài khoản Google** `hubselltech@gmail.com` cho Play Console.
- **Tài khoản Expo** (expo.dev) cho EAS Build, gói Free đủ cho vài build/tháng.

### 2.2 Trang web bắt buộc phải có link công khai
| Trang | Tình trạng | Dùng ở đâu |
|---|---|---|
| Chính sách bảo mật `hubsell.tech/privacy` | ✅ có (bản 13/09) | Bắt buộc cả 2 kho, và Apple bắt phải có **link trong app** (5.1.1) |
| Điều khoản `hubsell.tech/terms` | ✅ có | Apple EULA, Google khai trong listing |
| Trang hỗ trợ `hubsell.vn/ho-tro` | ✅ đã code 23/09 (chờ push landing) | Apple Support URL bắt buộc là trang web, không nhận mailto. Có email, Zalo, link hướng dẫn, mục báo lỗi app di động, FAQ. |
| Hướng dẫn **xóa tài khoản** `hubsell.vn/xoa-tai-khoan` | ✅ đã code 23/09 (chờ push landing) | Google khai vào Data safety → account deletion URL; Apple 5.1.1(v). Trang nêu ai được gửi, gửi email theo mẫu tới support@hubsell.vn, xác minh 2 ngày, xóa xong trong 30 ngày (khớp /privacy), dữ liệu giữ lại theo luật kế toán. Chưa có API xóa tự động, xử lý tay qua email. |

### 2.3 Tài khoản demo cho người duyệt (cực kỳ quan trọng)
Cả hai kho đều bắt cung cấp tài khoản đăng nhập vì app không dùng được khi chưa đăng nhập. Tài khoản **phải có dữ liệu thật để xem**: shop đã nối sàn, có đơn hàng, có tồn kho, có hội thoại. Tài khoản trống là bị từ chối 2.1 "không thể xác minh chức năng". ✅ Đã có sẵn trên production (23/09):
- **Chủ shop**: `reviewer@hubsell.vn` (tài khoản seed ISV, gói Business, 3 gian Shopee/Lazada/TikTok "Hubsell Demo Store", >4.000 đơn; mật khẩu anh Trung giữ, xem hồ sơ TikTok). Worker `reviewer-demo-topup` bồi đơn mỗi 30 phút — **giữ bật tới khi cả 2 kho duyệt xong**.
- **Nhân viên kho**: `reviewer/reviewer_kho` / `Hubsell2026kho` (tạo qua UI /staff 23/09, quyền Đơn hàng + Quản lý Kho, cả 3 gian) → app mở thẳng màn Quét đơn hoàn. Dự phòng: `backend/scripts/seed-reviewer-staff.ts`.
- Vài mã vận đơn thật để reviewer quét thử nếu muốn (lấy từ đơn hoàn của tài khoản reviewer).
- Ghi chú tiếng Anh cho reviewer: app B2B cho chủ shop Shopee/Lazada/TikTok tại Việt Nam, tài khoản demo đã nối sẵn gian hàng mẫu, gói dịch vụ mua trên web không bán trong app.

### 2.4 Nội dung listing (viết một lần dùng cho cả 2 kho)
| Mục | Giới hạn | Gợi ý |
|---|---|---|
| Tên app | 30 ký tự (cả 2 kho) | `Hubsell - Quản lý bán đa sàn` |
| Mô tả ngắn (Google) | 80 ký tự | `Đơn, kho, tin nhắn Shopee Lazada TikTok trong một app` |
| Phụ đề (Apple) | 30 ký tự | `Shopee · Lazada · TikTok Shop` |
| Từ khóa (Apple) | 100 ký tự | quản lý bán hàng, shopee, lazada, tiktok shop, đơn hàng, tồn kho, đối soát |
| Mô tả dài | 4000 ký tự | Lấy từ landing /tinh-nang, viết cho người bán nhỏ |
| Danh mục | | Apple: Business. Google: Business |

### 2.5 Ảnh
| Ảnh | Kích thước | Ghi chú |
|---|---|---|
| Icon Apple | **1024×1024, không alpha** | ✅ `assets/images/icon-1024.png` (phóng từ logo 417 bằng Lanczos, nền trắng đặc); Android adaptive: `adaptive-icon.png` logo 66% giữa nền trắng |
| Icon Google | 512×512 PNG | |
| Feature graphic (Google, bắt buộc) | 1024×500 | Ảnh bìa có logo + slogan |
| Ảnh màn hình iPhone 6.9" | 1320×2868 hoặc 1290×2796 | Bắt buộc ít nhất 3, tối đa 10, **phải là màn hình thật của app** (2.3.3) |
| Ảnh màn hình Android | 9:16, ≥1080 ngang | Ít nhất 2 |
| Ảnh iPad | không cần | app không bật `supportsTablet` |

---

## 3. Google Play Console

1. **https://play.google.com/console/signup** → đăng nhập `hubselltech@gmail.com`.
2. Chọn **Organization**. Nhập: D-U-N-S `320131497`, tên tổ chức `HUBSELL TECHNOLOGY CO., LTD.`, địa chỉ **chép nguyên bảng mục 1.1**, **SĐT tổ chức** `+84 96 5863292` (nhận OTP), **email tổ chức** `support@hubsell.vn` (nhận mã, dev@ nhận thay), website `hubsell.vn`, loại tổ chức Company.
3. Email nhà phát triển và SĐT sẽ **hiện công khai** trên trang app, cân nhắc dùng email/SĐT công ty chứ không phải số cá nhân.
4. Trả 25 USD, tạo Google Payments profile loại tổ chức.
5. **Xác minh danh tính**: chụp CCCD/hộ chiếu người đại diện + có thể yêu cầu GCN ĐKDN. Thường 1–7 ngày, tổ chức mới có thể lâu hơn.
6. Sau khi được duyệt → **Create app**: tên, ngôn ngữ mặc định Tiếng Việt, App, Free.
7. Mục **App content** phải khai đủ trước khi nộp:
   - Privacy policy: `https://hubsell.tech/privacy`
   - **App access**: chọn "Restricted access", điền tài khoản demo mục 2.3
   - Ads: Không
   - Content rating (IARC): Utility/Productivity → Everyone
   - Target audience: 18+
   - Data safety: thu thập email + tên (đăng nhập), dữ liệu kinh doanh (đơn hàng, tồn kho) gửi về máy chủ mã hóa HTTPS; **camera chỉ quét mã, không lưu ảnh**; **giọng nói nhận dạng trên máy, không gửi lên**; có URL xóa tài khoản.
   - Financial features: Không (app hiển thị doanh thu nhưng không cung cấp dịch vụ tài chính)
   - Government app, Health: Không
8. **Play App Signing**: để mặc định (Google giữ khóa ký). EAS tự sinh upload keystore, **tải bản sao lưu** bằng `eas credentials` cất nơi an toàn.
9. Nộp bản đầu vào **Internal testing** (tối đa 100 tester, duyệt trong vài giờ) → cài thử trên máy thật → sau đó **Production**, chọn quốc gia **Việt Nam**.
10. Duyệt lần đầu: vài giờ tới 7 ngày. Bản cập nhật sau đó thường dưới 1 ngày.

---

## 4. Apple Developer Program

1. Trên iPhone, tải app **Apple Developer** (App Store), đăng nhập Apple ID công ty.
2. Tab Account → **Enroll Now** → xác minh danh tính bằng cách chụp **CCCD/hộ chiếu** và selfie.
3. Chọn **Organization** (không chọn Individual). Nhập D-U-N-S `320131497`, tên pháp nhân `HUBSELL TECHNOLOGY CO., LTD.` (Apple tự kéo từ D&B, chỉ cần đối chiếu), website `hubsell.vn`, chức danh của anh: **Owner / Founder** (người có quyền ký hợp đồng thay công ty).
4. Apple có thể **gọi điện hoặc email** xác minh, đôi khi yêu cầu thư xác nhận quyền ký. Trả lời trong 1–2 ngày.
5. Trả 99 USD trong app. Tài khoản kích hoạt sau vài giờ tới vài ngày.
6. Vào **appstoreconnect.apple.com** → Agreements: đồng ý **Paid Apps Agreement không cần** (app miễn phí), chỉ cần Free Apps.
7. **My Apps → New App**: nền tảng iOS, tên, ngôn ngữ chính Vietnamese, Bundle ID `vn.hubsell.app` (EAS tự đăng ký identifier), SKU `hubsell-mobile`.
8. Khai **App Privacy** (nhãn dữ liệu): Contact info (email, tên) + User content (dữ liệu kinh doanh) dùng cho App functionality, có liên kết với người dùng, không dùng theo dõi.
9. **App Review Information**: bật Sign-in required, điền tài khoản demo, ghi chú tiếng Anh mục 2.3. Điền Support URL, Marketing URL `hubsell.tech`, Privacy URL.
10. Age rating: 4+. Export compliance: app chỉ dùng HTTPS → khai "exempt" (đặt sẵn trong app.json, mục 5).
11. **Sign in with Apple KHÔNG bắt buộc** vì app không có đăng nhập Google/Facebook, chỉ email + mật khẩu.
12. Đưa build lên **TestFlight** trước, cài thử, rồi Submit for Review. Thường 24–48 giờ. Lần đầu hay bị trả về, lỗi phổ biến:
    - 2.1: tài khoản demo trống hoặc đăng nhập không được
    - 5.1.1: thiếu link Chính sách bảo mật trong app
    - 4.0 / 4.2: giao diện giống web bọc lại, tính năng quá mỏng
    - 2.3.3: ảnh màn hình không phải app thật
    - 3.1.1: có chỗ nhắc mua gói ngoài app

Availability: chỉ Việt Nam đợt đầu (tránh khai trader EU).

---

## 5. Việc code (✅ làm xong 23/09, chờ anh duyệt rồi push)

- ✅ `app.json`: `ios.bundleIdentifier` + `android.package` = `vn.hubsell.app` (anh chốt 23/09), `ios.supportsTablet: false`, `ios.config.usesNonExemptEncryption: false` (khỏi khai export compliance mỗi lần nộp), `infoPlist` tiếng Việt, icon 1024, adaptive icon Android.
- ✅ `eas.json`: `appVersionSource: remote` + `autoIncrement` ở production (EAS tự tăng versionCode/buildNumber, không sửa tay); profile preview ra APK cài thử; mục submit trỏ `google-play-service-account.json` + `asc-api-key.p8` (đã thêm .gitignore, tạo ở giai đoạn C).
- ✅ Màn Cài đặt (dùng chung 2 vai, `SettingsScreen.tsx`): khối "Về Hubsell" 4 dòng mở bằng trình duyệt trong app: Trung tâm hỗ trợ, Chính sách bảo mật, Điều khoản, Yêu cầu xóa tài khoản (đỏ); dòng phiên bản đọc từ `expo-constants`.
- ✅ Rà toàn app: không có chữ nào về giá gói/nâng cấp/thanh toán; chỉ có câu "dùng bản web app.hubsell.tech" ở màn thiếu quyền, giữ được.
- ⏳ Còn lại giai đoạn C: `npx eas-cli init` (cần đăng nhập Expo của anh, sinh `extra.eas.projectId`), tạo khóa nộp store, build, ảnh màn hình, feature graphic.
- Kiểm tra targetSdk 36 (Expo 57 mặc định đạt, Google hạn 31/08/2026).
- Lệnh:
  ```bash
  npx eas-cli init
  npx eas-cli build -p all --profile production
  npx eas-cli submit -p android --latest
  npx eas-cli submit -p ios --latest
  ```
  `eas submit` iOS cần khóa App Store Connect API (tạo trong App Store Connect → Users and Access → Integrations), Android cần service account JSON từ Google Cloud gắn vào Play Console. Hai bước này làm một lần, tôi hướng dẫn khi tới.

---

## 6. Dòng thời gian thực tế

| Bước | Thời gian | Ai làm |
|---|---|---|
| Xin D-U-N-S | ✅ cấp 25/09 (32-013-1497), 2 ngày kể từ submit | Anh |
| Trang hỗ trợ, trang xóa tài khoản, tài khoản demo ✅ 23/09; còn ảnh listing | song song | Claude |
| Đăng ký Google Play tổ chức + xác minh | bắt đầu từ 29/09, 1–7 ngày | Anh |
| Đăng ký Apple tổ chức | bắt đầu từ 29/09, 2–7 ngày | Anh |
| Sửa code + build + nộp | 1–2 ngày | Claude |
| Duyệt Google | tới 7 ngày | |
| Duyệt Apple | 1–3 ngày, có thể trả về 1–2 vòng | |

Tổng cộng **3–6 tuần**, gần như toàn bộ là chờ D-U-N-S và xác minh tổ chức.

---

## 7. Chi phí

| Khoản | Số tiền |
|---|---|
| Google Play Console | 25 USD, một lần |
| Apple Developer Program | 99 USD/năm |
| D-U-N-S | miễn phí |
| EAS Build | gói Free, nâng lên 19 USD/tháng chỉ khi hàng đợi build quá lâu |

---

## 8. Nguồn
- Google: [Chọn loại tài khoản](https://support.google.com/googleplay/android-developer/answer/13634885), [Thông tin cần khi tạo tài khoản](https://support.google.com/googleplay/android-developer/answer/13628312), [Yêu cầu thử nghiệm với tài khoản cá nhân](https://support.google.com/googleplay/android-developer/answer/14151465)
- Apple: [Đăng ký qua app Apple Developer](https://developer.apple.com/help/account/membership/enrolling-in-the-app/), [D-U-N-S](https://developer.apple.com/help/account/membership/D-U-N-S/), [Yêu cầu đăng ký](https://developer.apple.com/help/account/membership/program-enrollment/)

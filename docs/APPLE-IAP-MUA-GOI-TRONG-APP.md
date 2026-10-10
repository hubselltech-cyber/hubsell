# Mua gói trong app iOS qua App Store (In-App Purchase)

**Ngày:** 10/10/2026 · **Quyết định của anh Trung:** sau khi Apple từ chối bản iOS ba lần
cùng mục 3.1.1 (06/10, 08/10, 09/10), bán gói trong app qua In-App Purchase, giá app
= giá web ÷ 0,85 (khách chịu phần Apple giữ), app KHÔNG nhắc web / payOS / giá nơi khác.

## 1. Vì sao phải làm

- Lần 1 (06/10): 5.1.1(iv) camera + 3.1.1 + 2.1 widget. Sửa xong 2 mục đầu.
- Lần 2 (08/10): còn 3.1.1 vì màn Đăng ký ghi "dùng thử" + nút mở web.
- Lần 3 (09/10): đã bỏ hẳn Đăng ký, app câm về gói — Apple vẫn trả: *"The app accesses
  digital content purchased outside the app, but that content isn't available to purchase
  using In-App Purchase"*, viện dẫn 3.1.3(b): đa nền tảng được cho khách dùng gói mua ngoài
  **chỉ khi** gói đó cũng mua được trong app bằng IAP.
- Khảo sát 08/10 (docs/store/APPLE-REVIEW-REPLY-2.md): Sapo, Pancake, Haravan đều có IAP.

## 2. Kiểu sản phẩm: Non-Renewing Subscription

Chọn **Non-Renewing** (không tự gia hạn) thay vì Auto-Renewable vì:
- Khớp đúng mô hình trả trước theo kỳ 1/3/6/12 tháng của `PackagePayment` — Apple chỉ là
  một "cổng" nữa bên cạnh chuyển khoản / Ví / payOS, không phải mô hình mới.
- Không phải xử lý renew / billing retry / grace period / đổi gói giữa kỳ của Apple.
- Anh Trung: "chẳng ai gia hạn trên app mấy đâu" — không đáng đổi cả mô hình.

Mỗi (gói, kỳ) là một sản phẩm, mã **bất biến** theo khuôn
`vn.hubsell.app.<code gói viết thường>.<monthly|quarterly|semiannual|yearly>`
(`backend/src/integrations/apple-iap/products.ts`, test `apple-iap-products.test.ts`).
Gói Enterprise bán bằng tư vấn → không có sản phẩm. Kỳ có giá 0 → không có sản phẩm.

### Danh sách 20 sản phẩm đã tạo trên App Store Connect (10/10, Apple ID từng sản phẩm)

| Gói | 1 tháng | 3 tháng | 6 tháng | 12 tháng |
|---|---|---|---|---|
| Starter | 6821210172 | 6821213384 | 6821213505 | 6821213507 |
| Growth | 6821213222 | 6821213596 | 6821213433 | 6821213624 |
| Pro | 6821213775 | 6821213611 | 6821213915 | 6821213808 |
| Business | 6821213919 | 6821213896 | 6821213824 | 6821214065 |
| Scale | 6821213971 | 6821214046 | 6821213552 | 6821213553 |

Trang sản phẩm: `https://appstoreconnect.apple.com/apps/6819512670/distribution/non-renewing-subscriptions/<Apple ID>`.

### Giá (anh Trung chốt 10/10): giá web ÷ 0,85, làm tròn LÊN mức giá Apple gần nhất

Apple trừ hoa hồng (15% Small Business Program, 30% mặc định) **trước khi trả**, khách chỉ
thấy giá niêm yết. Apple chỉ cho chọn trong bảng mức giá VND có sẵn → khi đặt giá, chọn
mức ≥ giá web ÷ 0,85. Ví dụ Starter tháng 99.000 → 116.471 → mức 119.000₫ (nếu có).
**Ngoài app tuyệt đối không ghi "+15%" hay so giá** — 3.1.3 cấm làm nản lòng dùng IAP.

⏳ Đăng ký **App Store Small Business Program** (doanh thu < 1 triệu USD/năm → 15%) tại
developer.apple.com → Account → Small Business Program, Account Holder (anh) tự bấm.

## 3. Luồng kỹ thuật

```
app (expo-iap)                         backend                              Apple
GET /api/subscription/apple-iap/catalog ─► appleCatalogFor(ownerId)
   ◄── { appAccountToken, items[] }        (sinh UUID lười, lưu User.appleAppAccountToken)
fetchProducts(skus) ─────────────────────────────────────────────────────► StoreKit (giá)
requestPurchase(sku, appAccountToken) ───────────────────────────────────► StoreKit
   ◄── Purchase { purchaseToken = JWS } (onPurchaseSuccess)
POST /api/subscription/apple-iap/redeem { jws } ─► verifyAppleTransaction (chuỗi chứng chỉ
                                                    Apple Root CA G3, bundleId, appAppleId)
                                                  ─► tìm chủ shop theo appAccountToken
                                                  ─► recordPackagePayment(APPLE_IAP,
                                                     externalRef "apple:<transactionId>")
   ◄── { outcome: recorded | duplicate }
finishTransaction(purchase, isConsumable)
                                        POST /api/webhooks/apple-iap ◄───── App Store Server
                                          ONE_TIME_CHARGE → ghi nhận (lưới an toàn)   Notifications V2
                                          REFUND/REVOKE   → mail HQ xử lý tay
```

- **Xác minh offline** bằng `@apple/app-store-server-library` (SignedDataVerifier) + 3 chứng
  chỉ gốc trong `backend/certs/apple/*.cer` (tải 10/10 từ apple.com/certificateauthority;
  Apple Computer Root đã hết hạn 02/2025 nên không dùng). Không cần khóa API ASC.
- **Hai môi trường**: người duyệt App Review mua bằng tài khoản sandbox trên bản production
  → thử Production trước, lỗi đúng INVALID_ENVIRONMENT mới thử Sandbox. Khoản sandbox ghi
  `amount 0` (không vào sổ quỹ, không hoa hồng) nhưng gói vẫn mở cho người duyệt thấy luồng.
- **Chống trùng**: `externalRef` unique → redeem lặp / webhook đua app trả "duplicate", app
  vẫn `finishTransaction`. Redeem lỗi thì KHÔNG finish → StoreKit giữ giao dịch, nút
  "Khôi phục giao dịch" (`getPendingTransactionsIOS`) hoặc ONE_TIME_CHARGE xử lý sau.
- **Tiền thực thu**: StoreKit 2 báo `price` theo milli-đơn vị + `currency`; VND → ghi đúng
  số Apple báo (giá niêm yết, chưa trừ hoa hồng — phần Apple giữ là chi phí, HQ đối chiếu
  báo cáo Payments & Financial Reports của Apple). Khác VND → ghi giá web.
- **Kỳ hạn**: cùng `recordPackagePaymentTx` → cùng gói còn hạn thì nối tiếp, khác gói thì
  bắt đầu từ ngày mua (y như payOS).
- **Hoàn tiền**: Apple hoàn tiền không hỏi mình. Webhook REFUND chỉ **mail HQ**, không tự
  cắt kỳ (khách có thể đã dùng nửa kỳ) — HQ vào /admin/plans quyết định.

### Mã

- Backend: `src/integrations/apple-iap/{products,verifier}.ts`, `src/services/apple-iap.ts`,
  routes `GET/POST /api/subscription/apple-iap/{catalog,redeem}` (chỉ chủ shop),
  webhook `POST /api/webhooks/apple-iap`. Migration `20261010100000_apple_iap`
  (enum `APPLE_IAP` + cột `User.appleAppAccountToken`).
- Env Render (có mặc định, không bắt buộc): `APPLE_IAP_BUNDLE_ID=vn.hubsell.app`,
  `APPLE_IAP_APP_APPLE_ID=6819512670`, `APPLE_IAP_ROOT_CA_DIR`.
- Mobile: `expo-iap` 6.0 (plugin trong app.json), màn `/plan` = `PlanStoreScreen.tsx`,
  lối vào: thẻ "Gói dịch vụ" ở Cấu hình + dòng gói ở Tài khoản + link trên dải nhắc —
  **chỉ iOS + chủ shop**. Android giữ nguyên (chưa nối Google Play Billing; Google cũng cấm
  nhắc gói mà không bán qua Play).

## 4. Việc trên App Store Connect (theo thứ tự)

1. ⏳ **Paid Apps Agreement** (Business → Agreements): Account Holder ký + Banking + Tax
   (W-8BEN-E). Chưa Active thì không đặt giá, không mua sandbox được. — anh tự làm.
2. Từng sản phẩm (20): Availability = Việt Nam; Pricing (mức ≥ giá web ÷ 0,85); Display
   Name/Description tiếng Việt (≤30/≤45 ký tự, đã điền dần 10/10); **Review Screenshot**
   (ảnh màn Gói dịch vụ trên bản build mới — bắt buộc để duyệt IAP); Review Notes.
3. App Information → **App Store Server Notifications**: Production URL và Sandbox URL đều
   `https://hubsell-backend-sg.onrender.com/api/webhooks/apple-iap`, version 2.
4. Users and Access → **Sandbox Testers**: tạo một tài khoản sandbox để thử mua trên
   TestFlight trước khi nộp.
5. Trang bản 1.0: mục **In-App Purchases and Subscriptions** → chọn cả 20 sản phẩm nộp
   cùng build 8 ("first non-renewing subscription must be submitted with a new app version").
6. Reply Apple + Resubmit (thư ở docs/store/APPLE-REVIEW-REPLY-3.md).

## 5. Luật chữ trên app (giữ cho cả hai nền tảng)

- Chỉ một cách mua: App Store. Không chữ/link/nút dẫn tới web, payOS, chuyển khoản.
- Không nhắc giá web, không "+15%", không "rẻ hơn ở…".
- Khách mua trên web vào app thấy gói đang chạy, không bị đòi mua lại (3.1.3(b)).

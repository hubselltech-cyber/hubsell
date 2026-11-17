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

### ✅ Giá đã đặt trên ASC 10/10 (đã rà lại cả 20, Availability = tất cả 175 nước — app chỉ bán VN nên vô hại)

| Gói | Web 1/3/6/12 tháng | App Store 1/3/6/12 tháng (VND) |
|---|---|---|
| Starter | 99.000 / 297.000 / 594.000 / 1.089.000 | **119.000 / 359.000 / 699.000 / 1.289.000** |
| Growth | 199.000 / 597.000 / 1.194.000 / 2.189.000 | **239.000 / 709.000 / 1.409.000 / 2.590.000** |
| Pro | 399.000 / 1.129.000 / 2.129.000 / 3.990.000 | **470.000 / 1.329.000 / 2.549.000 / 4.695.000** |
| Business | 699.000 / 1.979.000 / 3.729.000 / 6.990.000 | **829.000 / 2.349.000 / 4.390.000 / 8.290.000** |
| Scale | 1.199.000 / 3.399.000 / 6.399.000 / 11.990.000 | **1.419.000 / 3.999.000 / 7.590.000 / 14.199.000** |

Mức Apple: dưới ~1,3 triệu bước 1.000₫; trên đó thưa dần (vd 2.500.000 / 2.549.000 / 2.590.000 /
2.595.000 / 2.599.000) → lấy mức đầu tiên ≥ web ÷ 0,85. Bẫy ASC: ô tìm giá khớp CHUỖI CON
("4.390.000" ra cả 439.000 và 1.439.000) → luôn chọn đúng dòng, kiểm lại bằng hộp "Current Price".

**App Store Small Business Program** (doanh thu < 1 triệu USD/năm → 15%): ✅ anh ĐÃ GỬI mẫu
đăng ký 10/11/2026 tại developer.apple.com/app-store/small-business-program/enroll (Team ID
BF6Y7D47P5; khai: đã chấp nhận Paid Applications Agreement, không có tài khoản liên kết). Apple
báo "We've received your enrollment and will email you about your status soon". ⏳ Chờ thư duyệt
về dev@hubsell.vn. Tới khi được duyệt Apple vẫn trừ 30%; ngày bắt đầu 15% xem trong thư duyệt /
FAQ của Apple (em CHƯA xác minh ngày hiệu lực).

### Khoản thật đầu tiên — 10/11/2026

14:58 10/11 khách mua Business 1 tháng trong app iOS: `apple:230003797496288`, storefront VNM,
829.000 VND, môi trường Production (các khoản trước đều sandbox, 0 đ). Gói tự kích hoạt tới 10/12.
Lộ hai chỗ chưa ổn (cách ghi đã rà 17/11/2026, xem mục "Thuế + sổ sách cho khoản Apple" cuối tài liệu):
- Sổ quỹ ghi THU đủ 829.000 đ ngay ngày mua, trong khi Apple trả sau (khoảng 45 ngày sau tháng
  tài chính) và đã trừ hoa hồng → lệch sao kê; chưa có dòng chi phí hoa hồng Apple.
- Hóa đơn 829.000 đ tự đẩy lên meinvoice chờ ký. (17/11: anh đã ký, số 00000017 — xuất đủ giá là đúng theo Công văn 1063/CT-CS.)

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

## 6. ★ Bẫy openiap: Non-Renewing là `type "subs"`, phải fetch `"all"` (Apple từ chối lần 6, 14/10/2026)

Apple 2.1(b): "unable to complete purchase Non Renewable Subscription". Gốc (đã kiểm mã nguồn
openiap-apple, lõi native của expo-iap 6.0): `StoreKitTypesBridge.productType` gắn StoreKit
`.nonRenewable` → `type: "subs"`; `OpenIapModule.fetchProducts` nhánh `.inApp` chỉ giữ
`type == .inApp`, nhánh `.subs` chỉ giữ sản phẩm có `product.subscription != nil` (non-renewing
không có). → `fetchProducts({type:"in-app"})` lẫn `"subs"` đều trả RỖNG, màn hiện "App Store chưa
có gói nào". Chỉ `type:"all"` trả về, và hook `useIAP` xếp chúng vào mảng `subscriptions` (theo
`item.type`), không vào `products`.

Sửa: `PlanStoreScreen` gọi `type:"all"` + đọc gộp `[...products, ...subscriptions]`;
`requestPurchase` giữ `type:"in-app"` (native iOS chỉ nhìn `request.apple`). Backend không đổi.
Chi tiết + thư trả lời: `docs/store/APPLE-REVIEW-REPLY-6.md`. Bài học: luồng StoreKit PHẢI thử
trên iPhone thật qua TestFlight + Sandbox Tester trước khi nộp; web không có StoreKit nên không lộ.

## Phụ lục hợp đồng Apple nói gì về Việt Nam (đọc 12/11/2026)

Nguồn: *Exhibits to Schedule 2 and 3*, bản ghi ngày **27/08/2026**, tải từ developer.apple.com. Anh Trung hỏi: "hóa đơn mình xuất bao gồm cả phần tiền của Apple".

- **Exhibit A mục 2:** Việt Nam thuộc danh sách Apple Distribution International Ltd. làm *commissionaire* — "an agent who purports to act on their own behalf and concludes agreements in their own name but acts on behalf of other persons".
- **Exhibit B, chú thích của Việt Nam:** việc Apple thu và nộp thuế "Solely applicable to non-resident Developers and local individual Developers. Apple shall not collect and remit taxes for local corporate Developers, and such Developers shall be solely responsible for the collection and remittance of such taxes". Riêng để tính hoa hồng, Apple ước lượng VAT theo *tax category* nhà phát triển chọn và trừ khỏi giá khách trả trước khi tính hoa hồng.
- **Exhibit C mục 17 (Vietnam):** "If You are a resident of Vietnam, Apple will apply Vietnamese Foreign Contractor Tax on the commission payable by You to Apple to be deducted from Your remittance".

Hệ quả cho Hubsell (công ty trong nước):

1. Thuế trên khoản bán cho khách là việc của Hubsell → hóa đơn theo ĐỦ giá khách trả là khớp với hợp đồng; phần Apple giữ là **hoa hồng (chi phí)**, không phải khoản giảm doanh thu.
2. Thuế nhà thầu trên hoa hồng: Apple tự trừ vào tiền chuyển về — Hubsell không kê khai thêm (chứng từ = báo cáo tài chính Apple; kế toán xác nhận).
3. Cần kiểm trong App Store Connect: *tax category* đang chọn (ảnh hưởng số hoa hồng).

Đây là đọc hợp đồng, CHƯA phải ý kiến kế toán. Phần luật + cách ghi sổ đã rà ở mục dưới (17/11/2026).

## Thuế + sổ sách cho khoản Apple (rà 17/11/2026)

Anh Trung hỏi kế toán (14/11), kế toán nói "15% là hoa hồng, hạch toán chi phí bán hàng, có khả năng
dính thuế nhà thầu theo luật mới 01/07/2026" nhưng không chốt được. Anh nhờ: "rà soát lại luật, quy
trình và trường hợp của Apple này mình có phải khai thuế thầu phụ không? Cả việc quản lý sao trên HQ,
đối soát sao trên HQ cho chuẩn".

### Văn bản đã đọc nguyên văn

| Văn bản | Đọc ở đâu | Nói gì |
|---|---|---|
| **Công văn 1063/CT-CS ngày 12/02/2026** của Cục Thuế gửi Công ty VSTV (K+) | thuvienphapluat.vn, đọc đủ toàn văn | Đúng ca Apple thu hộ và giữ 15 %. Công ty Việt Nam ghi **toàn bộ số tiền Apple thu hộ là doanh thu**, tự lập hóa đơn cho khách. Thù lao của Apple là **chi phí được trừ** nếu đủ chứng từ. Apple tự kê khai và nộp thuế GTGT + TNDN trên khoản Apple nhận. Cuối công văn: đề nghị công ty và Apple liên hệ cơ quan thuế quản lý trực tiếp để được hướng dẫn |
| **Nghị định 252/2026/NĐ-CP** (hiệu lực 01/07/2026, thay Nghị định 126/2020) — Điều 40, 43, 44, 45, 46 | luatnguyen.vn, đọc đủ toàn văn các điều này | Khoản 3 Điều 43: tổ chức kinh doanh tại Việt Nam áp dụng phương pháp khấu trừ thuế GTGT, mua dịch vụ của nhà cung cấp nước ngoài trên nền tảng thương mại điện tử, **có trách nhiệm khấu trừ, nộp thay** thuế GTGT + TNDN, tại thời điểm thanh toán. Khoản 2 Điều 46: nhà cung cấp nước ngoài tự khai phần doanh thu **chưa được** bên Việt Nam hay nền tảng khấu trừ. Tức là thứ tự đảo so với Thông tư 80/2021 |
| **Bộ 37 câu hỏi đáp của Cục Thuế** về thuế nhà thầu, nền tảng thương mại điện tử 2026 | bài đăng lại trên thuvienphapluat.vn (ghi nguồn Cổng thông tin Cục Thuế — em CHƯA mở bản trên cổng Cục Thuế) | **Câu 34** đúng ca doanh nghiệp phần mềm bán app qua App Store / Google Play bị giữ 15–30 %: khoản giữ lại là phí dịch vụ trả cho tổ chức nước ngoài, thuộc diện thuế nhà thầu; cấn trừ trước khi chuyển tiền không đổi bản chất; từ 01/07/2026 doanh nghiệp phương pháp khấu trừ thì khấu trừ nộp thay theo khoản 3 Điều 43 (mẫu 01/NTNN, Điều 32 Thông tư 89/2026); báo cáo thanh toán của Apple không phải chứng từ đã nộp thuế; **"trường hợp tại hợp đồng/thỏa thuận không có quy định nhà cung cấp nước ngoài tự thực hiện nghĩa vụ thuế tại Việt Nam thì doanh nghiệp Việt Nam … có trách nhiệm khấu trừ, khai, nộp thay"**. **Câu 18:** phần doanh thu nhà cung cấp nước ngoài đã trực tiếp khai nộp thì doanh nghiệp Việt Nam không khấu trừ lần nữa, nhưng phải có căn cứ. **Câu 21:** Apple Distribution International Limited có MST 9000000486. **Câu 24:** cách tính: GTGT = tiền chưa thuế × 10 %; doanh thu tính TNDN = (tiền chưa thuế + GTGT) ÷ 0,95; TNDN = × 5 %. **Câu 35** (bán gói phần mềm qua Google Play): doanh thu khách Việt Nam không chịu thuế GTGT; được lập hóa đơn chậm nhất ngày 07 tháng sau theo báo cáo đối soát; không gộp một hóa đơn tổng |
| Trang trợ giúp App Store Connect "Provide tax information for commissions and fees…" | developer.apple.com, đọc 17/11/2026 | "If you're based in Vietnam, Apple Distribution International Limited is registered with the Vietnam tax authority (Tax ID 9000000486) and will remit Vietnam Foreign Contractor Tax on Core Technology Fee and Commission payable to Apple" |
| Phụ lục hợp đồng Apple, bản 27/08/2026 (sau ngày luật mới có hiệu lực) | mục "Phụ lục hợp đồng Apple" ở trên | Exhibit C mục 17: Apple áp thuế nhà thầu Việt Nam trên hoa hồng và **trừ vào tiền chuyển về** |

Chưa đọc được nguyên văn: Thông tư 89/2026/TT-BTC (Điều 30, 32) và Thông tư 90/2026/TT-BTC — trang đăng
toàn văn lỗi khi tải; chỉ biết qua bài tóm tắt.

### Kết luận

1. **Thuế nhà thầu CÓ phát sinh** trên phần hoa hồng Apple giữ (GTGT 10 % + TNDN 5 %). Kế toán nói đúng chỗ này.
2. **Hubsell KHÔNG tự khai 01/NTNN cho hoa hồng Apple**, vì hợp đồng với Apple ghi rõ Apple tự nộp thuế này
   và trừ vào tiền chuyển về — đúng ngoại lệ Cục Thuế nêu ở câu 34. Điều kiện giữ kết luận: báo cáo tài chính
   tháng của Apple phải hiện khoản thuế đã trừ (cột Withholding Tax). **Nếu báo cáo đầu tiên không có khoản
   này thì Hubsell phải khai 01/NTNN** (khi đó cần xin MST nộp thay, mẫu 04.1-ĐK-TCT).
3. **Hóa đơn xuất đủ giá khách trả là đúng** (Công văn 1063). Tiền về ít hơn hóa đơn là chuyện bình thường
   của mô hình này: phần chênh = hoa hồng Apple + thuế nhà thầu Apple trừ, ghi chi phí bán hàng.
4. Mức còn chưa chắc: câu 34 là hỏi đáp, không phải văn bản pháp quy và em mới đọc bản đăng lại. Muốn chắc
   hẳn thì gửi văn bản hỏi cơ quan thuế quản lý (chính Công văn 1063 cũng bảo vậy), kèm báo cáo Apple đầu tiên.

### Bộ hồ sơ giải trình "hóa đơn 115 mà tiền về 100"

1. Hợp đồng Apple: Paid Applications Agreement + Schedule 2 + Exhibits (Apple là bên thu hộ / commissionaire,
   mức hoa hồng, điều khoản thuế nhà thầu Việt Nam) — tải PDF, lưu theo ngày bản.
2. Báo cáo tài chính Apple từng tháng tài chính (Payments and Financial Reports): tổng khách trả, hoa hồng,
   thuế đã trừ, số chuyển về.
3. Sao kê ngân hàng dòng tiền Apple chuyển về.
4. Bảng kê hóa đơn Hubsell đã xuất, khớp từng mã giao dịch Apple (`apple:<transactionId>`).
5. Công văn 1063/CT-CS làm căn cứ tham chiếu.

### Số thật trên HQ (kéo API sổ quỹ prod 17/11/2026, chỉ đọc)

5 khoản App Store từ 10/11 → 14/11: 829.000 + 119.000 + 119.000 + 470.000 + 119.000 = **1.656.000 đ**.
Cả 5 đã có hóa đơn ký (số 17, 19, 20, 23, 25) theo đủ giá khách trả. Sổ quỹ đang ghi THU đủ 1.656.000 đ
vào ngày mua, trong khi tiền chưa về.

CHƯA kiểm được trên App Store Connect (trình duyệt chưa đăng nhập): Small Business Program đã duyệt chưa
(chưa duyệt thì Apple giữ 30 %, không phải 15 %), tax category, số Proceeds từng khoản, lịch chuyển tiền.

### Đề xuất cách quản lý + đối soát trên HQ (CHƯA code, chờ anh duyệt)

- **Lát A — tách "Phải thu Apple" khỏi tiền quỹ:** ✅ LÀM 17/11/2026 (anh: "Làm lát A"), CHƯA commit.
  Khoản mua qua App Store vẫn sinh hóa đơn đủ giá ngay ngày mua, nhưng không cộng vào Tổng THU / chênh
  lệch của Sổ quỹ HQ; thẻ thứ 5 "Apple chưa chuyển về" (cộng dồn mọi kỳ, kèm số khoản + ngày cũ nhất);
  dòng sổ tô vàng "Chờ Apple chuyển"; Excel thêm cột "Chờ Apple chuyển" (Tiền vào không gồm khoản này);
  biểu đồ sổ quỹ 6 tháng ở báo cáo nhà đầu tư cũng bỏ khoản này. Điều kiện "khoản nào là phải thu Apple"
  nằm DUY NHẤT ở `backend/src/services/apple-receivable.ts` (lát B chỉ sửa ở đó). Không migration.
  Hóa đơn, hoa hồng giới thiệu, kỳ hạn gói không đổi. Kèm sửa bảng sổ quỹ: cắt tên khách / người ghi /
  dòng email hóa đơn dài → hết cuộn ngang ở 1700 (trước cuộn ~37 px); 1440 còn cuộn 244 px, 1280 còn
  457 px (trước 837 px) — bảng 8 cột vốn rộng hơn khung, chưa làm lại.
  **Ngày dự kiến (17/11/2026, anh: "Thêm ngày dự kiến"), CHƯA commit:** thẻ hiện "Dự kiến về ~31/12/2026
  (ước)" — nhiều đợt thì đợt gần nhất + số tiền + "thêm N đợt sau"; dòng sổ "Apple chuyển ~31/12", rê chuột
  thấy ngày cuối tháng tài chính + hạn chót 45 ngày. Bảng ngày cuối tháng tài chính `APPLE_FISCAL_MONTH_ENDS`
  trong `apple-receivable.ts` lấy theo aso.dev, chạy tới 25/09/2027 — ngoài bảng ghi "chưa có lịch Apple".
  ⏳ Khi Apple công bố lịch năm tài chính 2027 (hoặc có báo cáo / lần chuyển thật đầu tiên) thì đối chiếu
  và sửa bảng; tháng 12/2026 trở đi đang lệch giữa hai nguồn.
  ⚠️ Khi Apple chuyển tiền thật (dự kiến khoảng đầu–giữa 01/2027 cho khoản tháng 11) mà lát B chưa có:
  thẻ "Apple chưa chuyển về" vẫn giữ số cũ — phải có lát B trước mốc đó.
- **Lát B — hộp "Đối soát Apple" theo tháng tài chính:** nhập (hoặc nạp tệp) báo cáo Apple + số tiền ngân
  hàng nhận. Máy khớp từng mã giao dịch, đóng các khoản phải thu của tháng đó, ghi phiếu thu đúng số ngân
  hàng nhận và hai dòng chi phí "Hoa hồng App Store" + "Thuế nhà thầu Apple đã trừ" (nhà cung cấp Apple
  Distribution International Ltd., MST 9000000486, chứng từ = mã báo cáo). Lệch thì hiện hộp cảnh báo số
  từng bên, không khóa. Phải có báo cáo Apple thật đầu tiên mới biết đúng các cột → làm sau khi có báo cáo.
  **Cách tự động (anh hỏi 17/11 "làm sao biết khi nào Apple chuyển, HQ tự đối soát"):**
  - Lịch Apple (trang trợ giúp "Overview of receiving payments", đọc 17/11): báo cáo tài chính của tháng
    tài chính trước có trước **thứ Sáu đầu tiên** của tháng tài chính sau; tiền về **trong 45 ngày kể từ
    ngày cuối tháng tài chính** có giao dịch; gộp một lần chuyển mỗi tháng mỗi loại tiền; phải có Paid
    Apps Agreement + tài khoản ngân hàng + vượt ngưỡng tối thiểu (Việt Nam không có mức riêng → **40 USD**).
    Có thư báo từ do-not-reply@apple.com nếu hồ sơ người dùng bật nhận thông báo báo cáo tài chính.
    Tháng tài chính Apple không trùng tháng dương lịch. Lịch năm tài chính 2027 (Apple không công bố lịch
    trả; hai nguồn ngoài aso.dev + RevenueCat ước "33 ngày sau cuối tháng tài chính", đọc 17/11/2026):
    tháng 10 = 27/09 → 31/10/2026, trả ~03/12/2026; **tháng 11 = 01/11 → 28/11/2026, trả ~31/12/2026**
    (hạn cứng 45 ngày = 12/01/2027); tháng 12 hai nguồn LỆCH NHAU (năm 2027 có tuần thứ 53): 29/11 → 26/12
    trả ~28/01/2027 (aso.dev) hoặc 29/11 → 02/01/2027 trả ~04/02/2027 (RevenueCat). Ngày trên là ngày
    Apple chuyển, tiền về MB có thể chậm thêm vài ngày (chưa có lần thật để đo). 5 khoản 10–14/11/2026
    (1.656.000 đ) thuộc tháng tài chính 11 → dự kiến ~31/12/2026, nếu tiền thực nhận vượt 40 USD.
  - Phía Apple tự động được: App Store Connect API `/v1/financeReports` (`FINANCE_DETAIL`, vùng `Z1`,
    `vendorNumber`, `reportDate` theo tháng tài chính), cần khóa API có quyền **Finance** (nguồn cộng
    đồng nói phải tick lúc tạo khóa — chưa kiểm trên tài liệu Apple). Báo cáo gộp theo sản phẩm + ngày,
    em CHƯA thấy có mã giao dịch → khớp theo mã sản phẩm + ngày + số lượng, chưa chắc khớp từng khoản.
  - Phía ngân hàng: payOS chỉ báo các lệnh thu qua link payOS, KHÔNG thấy tiền Apple chuyển vào MB → hoặc
    anh nhập tay số tiền về 1 lần/tháng, hoặc nối thêm dịch vụ đọc biến động số dư (chưa khảo sát).
- **Lát C — Apple hoàn tiền cho khách (REFUND):** hiện chỉ gửi thư HQ. Cần thêm: nhắc lập hóa đơn điều
  chỉnh giảm + bút toán đảo.
- **Điểm cần anh quyết:** hoa hồng giới thiệu đang tính trên đủ giá App Store (`creditReferralCommission`
  nhận `amount` = giá Apple), cao hơn giá web khoảng 18 %.

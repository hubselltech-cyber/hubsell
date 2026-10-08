# Hồ sơ trang kho ứng dụng Hubsell (Google Play + App Store)

Soạn 01/10/2026 cho bản 1.0.0, mã app `vn.hubsell.app`. Mọi nội dung dưới đây chép thẳng vào Play Console / App Store Connect ở giai đoạn C của [DUA-APP-LEN-CH-PLAY-APP-STORE.md](../DUA-APP-LEN-CH-PLAY-APP-STORE.md). Phần khai dữ liệu (mục 5, 6) viết theo **code thật** của `hubsell-mobile/` rà ngày 01/10, không theo trí nhớ: sửa app thì phải rà lại.

Độ dài các ô có giới hạn đã đếm bằng máy (`python docs/store/check-lengths.py`).

---

## 1. Thông tin chung

| Ô | Giới hạn | Nội dung | Dùng ở |
|---|---|---|---|
| Tên app | 30 | `Hubsell - Quản lý bán đa sàn` | cả 2 kho |
| Phụ đề | 30 | `Đơn, kho, lãi lỗ trong một app` | Apple |
| Mô tả ngắn | 80 | `Xem lãi ròng, đơn mọi sàn, trả lời khách và quét hàng hoàn ngay trên điện thoại` | Google |
| Từ khóa | 100 | `quản lý bán hàng,đa sàn,đơn hàng,tồn kho,lãi lỗ,đối soát,hàng hoàn,quét mã vận đơn,bán hàng online` | Apple |
| Dòng quảng bá | 170 | `Chủ shop mở máy là thấy lãi ròng hôm nay. Nhân viên kho quét mã là nhận xong kiện hàng hoàn. Dùng chung tài khoản Hubsell đang có.` | Apple (sửa được không cần duyệt lại) |
| Danh mục | | Business (Kinh doanh) | cả 2 kho |
| Ngôn ngữ chính | | Tiếng Việt | cả 2 kho |
| Giá | | Miễn phí, không mua trong ứng dụng | cả 2 kho |
| Quốc gia | | Chỉ Việt Nam | cả 2 kho |
| Bản quyền | | `© 2026 HUBSELL TECHNOLOGY CO., LTD.` | Apple |
| Trang hỗ trợ | | `https://hubsell.vn/ho-tro` | cả 2 kho |
| Trang giới thiệu | | `https://hubsell.vn` | cả 2 kho |
| Chính sách bảo mật | | `https://hubsell.vn/privacy` | cả 2 kho |
| Trang xóa tài khoản | | `https://hubsell.vn/xoa-tai-khoan` | Google (Data safety) |
| Email liên hệ công khai | | `support@hubsell.vn` | cả 2 kho |
| SKU | | `hubsell-mobile` | Apple |

Cả 5 đường dẫn trên trả về 200 khi kiểm ngày 01/10/2026. Dùng `hubsell.vn` ở mọi ô vì hồ sơ D&B và link trong app (màn Cấu hình) đều là `hubsell.vn`; bản hướng dẫn cũ ghi `hubsell.tech/privacy` là lệch.

**Vì sao phụ đề và từ khóa không có tên sàn.** Apple cấm dùng nhãn hiệu của bên khác trong tên, phụ đề, từ khóa (hướng dẫn 2.3.7), đây là lý do trả hồ sơ khá thường gặp với app "quản lý đa sàn". Tên Shopee, Lazada, TikTok Shop chỉ xuất hiện trong phần mô tả dài, ở dạng câu nêu sự thật "phần mềm kết nối với…". Ảnh bìa cũng không vẽ logo sàn.

**Vì sao không nhắc gói dịch vụ, giá, dùng thử.** App không bán gì, và Apple 3.1.1 coi câu "mua gói trên web" là lời mời thanh toán ngoài app. Phần mô tả chỉ nói "dành cho khách hàng đang dùng Hubsell".

---

## 2. Mô tả dài (dùng chung 2 kho, giới hạn 4.000 ký tự)

<!-- LONG-START -->
Hubsell là phần mềm quản lý bán hàng đa sàn cho nhà bán trên Shopee, Lazada và TikTok Shop. Ứng dụng di động mang những việc cần làm ngay ra khỏi bàn máy tính: chủ shop mở máy là thấy hôm nay lãi bao nhiêu, nhân viên kho cầm điện thoại quét mã là nhận xong kiện hàng hoàn.

DÀNH CHO CHỦ SHOP
• Kết quả hôm nay: doanh thu, chi phí và lợi nhuận, so với hôm qua, kèm nhịp lãi 7 ngày gần nhất.
• Tài chính: đi từ giá trị đơn tới lợi nhuận ròng, thấy rõ từng khoản sàn khấu trừ, giá vốn, quảng cáo; biết tiền đang nằm ở ví sàn hay đã về ngân hàng; chọn kỳ bất kỳ.
• Quảng cáo: theo dõi chiến dịch đang chạy của các gian đã nối, thấy chiến dịch cần xử lý kèm đề xuất, tạm dừng hoặc bật lại ngay trên máy.
• Đơn hàng của mọi gian trong một danh sách: lọc theo trạng thái, hãng vận chuyển, gian hàng; đơn hỏa tốc được đánh dấu riêng để xử lý trước; bấm vào đơn xem chi tiết và các khoản phí.
• Quét mã bất kỳ đơn nào bằng camera để mở ngay chi tiết đơn: shop, trạng thái, đơn vị vận chuyển, sản phẩm, phí và doanh thu ước tính.
• Thống kê bốc hàng: cộng sẵn số lượng cần lấy theo từng sản phẩm, từng SKU cho các đơn đang chờ.
• Trợ lý Hubsell: hỏi bằng tiếng Việt, gõ hoặc nói, nhận câu trả lời bằng số liệu của chính shop.

DÀNH CHO KHO
• Tồn kho từng mã hàng: nhập thêm hoặc xuất bớt theo số lượng ngay khi đang ở ngoài.
• Quét mã vận đơn bằng camera để nhận hàng hoàn, không cần máy quét rời.
• Ba âm báo khác nhau cho quét đúng, quét trùng và mã lỗi, không cần nhìn màn hình.
• Ghi nhận hàng hỏng ngay lúc nhận, kèm ghi chú tình trạng kiện.
• Danh sách kiện chờ về kho, kiện quá hạn, kiện đã nhận.

AN TOÀN VÀ TIỆN DỤNG
• Khóa ứng dụng bằng Face ID hoặc vân tay.
• Phân quyền theo vai: chủ shop thấy tài chính, nhân viên kho chỉ thấy phần kho và quét đơn.
• Giao diện sáng và tối.
• Con số trùng với bản web vì cùng một nguồn dữ liệu.

ĐĂNG NHẬP
Ứng dụng dành cho khách hàng đã có tài khoản Hubsell. Đăng nhập bằng email và mật khẩu của tài khoản Hubsell sẵn có; tài khoản nhân viên do chủ shop cấp. Ứng dụng không có chức năng đăng ký tài khoản.

Hỗ trợ: https://hubsell.vn/ho-tro · support@hubsell.vn
<!-- LONG-END -->

Ghi chú khi dán:
- **App Store**: dán nguyên văn. Không thêm chữ "Android", "CH Play" (Apple 2.3.10 cấm nhắc nền tảng khác).
- **06/10: bỏ mục Tin nhắn** khỏi mô tả, ghi chú người duyệt và nhãn dữ liệu — tab Tin nhắn đã gỡ khỏi app từ bản 04/10 (không còn `messages.tsx`, không còn dùng expo-image-picker). Thêm Quảng cáo, Tồn kho, quét đơn bất kỳ. Mô tả này ĐÃ DÁN vào App Store Connect 06/10.

### Có gì mới (bản 1.0.0)

```
Bản phát hành đầu tiên của Hubsell trên điện thoại: kết quả kinh doanh hôm nay, đơn hàng mọi sàn, quảng cáo, tồn kho, Trợ lý Hubsell và quét mã nhận hàng hoàn cho kho.
```

---

## 3. Tài khoản cho người duyệt

Điền vào **App access** (Google) và **App Review Information → Sign-in required** (Apple). Cả hai tài khoản nằm trên production, có dữ liệu sẵn (mục 2.3 bản hướng dẫn).

| Vai | Tên đăng nhập | Mật khẩu | Vào app thấy gì |
|---|---|---|---|
| Chủ shop | `reviewer@hubsell.vn` | anh Trung giữ, điền tay | Trang chủ 3 trang vuốt (Tổng quan / Tài chính / Quảng cáo), Đơn hàng, QR, Kho, Cấu hình, Trợ lý |
| Nhân viên kho | `reviewer/reviewer_kho` | mục 2.3 bản hướng dẫn | Mở thẳng màn quét đơn hoàn |

Apple chỉ có một cặp ô tài khoản: điền tài khoản **chủ shop**, tài khoản kho ghi trong phần Notes bên dưới.

---

## 4. Ghi chú gửi người duyệt (tiếng Anh)

Dán vào **Notes** của App Review (Apple) và ô **Any other instructions** của App access (Google). Bản dưới viết lại **08/10 tối sau khi Apple từ chối lần 2** (xem `APPLE-REVIEW-REPLY-2.md`): build 6 **GỠ HẲN màn Đăng ký** (tài khoản tạo trên web, như Haravan / Pancake POS) và gỡ nút mở web app ở thẻ chưa có gian → Notes nói rõ không có đăng ký, không dùng thử, không link ra web app; nhấn mạnh dùng tài khoản demo, ghi rõ nút xóa tài khoản. Với Google thay "see the user name / password fields above" bằng tài khoản + mật khẩu cụ thể.

```
Hubsell is a B2B tool for online merchants in Vietnam who sell on the
Shopee, Lazada and TikTok Shop marketplaces. It is a companion app to our
web product: merchants use it to check today's revenue and profit, browse
orders, follow their ad campaigns, adjust stock, and (warehouse staff)
scan return parcels. The app's interface is in Vietnamese only.

ACCOUNTS
PLEASE REVIEW WITH THE DEMO ACCOUNT BELOW. It is connected to sample
stores ("Hubsell Demo Store") that already contain orders, returns, stock
and financial data.

Shop owner (all screens): see the user name / password fields above.
Warehouse staff account (opens directly on the warehouse screens) is also
available on request: user name reviewer/reviewer_kho.

Sign-up: there is NO registration inside the app. Accounts are created
by merchants on our website; the app only signs in to an existing
account (like other B2B merchant tools). Users can delete their account
at any time inside the app: Settings tab ("Cau hinh") -> tap the name
row at the top -> "Xoa tai khoan" (enter current password to confirm).
Personal data is erased immediately and the remaining data is purged
within 30 days.

PAYMENTS
Nothing is sold inside the app. The app is a free companion for existing
customers of our web-based business tool (App Store Review Guideline
3.1.3(f)): it works on the data the merchant already has (orders, stock,
finance, ad campaigns). The app has no sign-up, no trial, no prices, no
plan information, no upgrade/purchase entry point and no link to any
purchase page or to the web application.

HOW TO TEST
- Home tab: three swipeable pages (Overview, Finance, Ads). Finance has a
  period filter.
- Orders tab: orders from all stores with filters; tap an order to see its
  details and fees.
- Round QR button in the middle of the tab bar: scans any order's tracking
  barcode to open its details. No physical parcel needed: type at least 3
  trailing digits of any order code shown in the Orders tab into the search
  field at the bottom of the scan screen.
- Warehouse tab ("Kho"): "Ton kho" adjusts stock quantities; "Don hoan"
  lists return parcels and has a scan button to receive them. You can type
  the last digits of a tracking number from the pending list instead of
  scanning.
- Round button at the bottom right of Home opens the Hubsell Assistant;
  ask e.g. "Doanh thu hom nay bao nhieu".

PERMISSIONS
- Camera: only to scan shipping barcodes. No photo or video is saved or
  uploaded. The scan screen first explains the purpose with a "Continue"
  button, then the system permission prompt appears. If camera access was
  declined earlier, the screen shows an "Open Settings" button; orders can
  also be found by typing the last digits of a code, no camera needed.
- Microphone and speech recognition: only after the user taps the
  microphone button to ask the Assistant a question by voice. Speech-to-text
  is done by the operating system's speech service; our servers receive the
  resulting text only.
- Face ID / fingerprint: optional app lock, enabled in Settings.

WIDGETS / EXTENSIONS
The app has no widget or app extension of any kind.

ACCOUNT DELETION
Available inside the app (see ACCOUNTS above). The Settings tab also
links to our deletion policy page, https://hubsell.vn/xoa-tai-khoan,
which explains what is erased and when.

Contact: support@hubsell.vn, +84 96 5863292
```

---

## 5. Google Play: App content

### 5.1 Data safety

Nguyên tắc của Google: "thu thập" là dữ liệu **từ máy người dùng gửi ra ngoài**. Số liệu đơn hàng, doanh thu do máy chủ Hubsell kéo từ sàn về rồi hiển thị trên app thì không phải dữ liệu app thu từ máy, nên không khai.

Ba câu đầu: **Có** thu thập dữ liệu · **Có** mã hóa khi truyền (HTTPS) · **Có** cách yêu cầu xóa dữ liệu → `https://hubsell.vn/xoa-tai-khoan`.

| Loại dữ liệu (tên trong Play Console) | Thu thập | Chia sẻ | Bắt buộc | Mục đích | Căn cứ trong code |
|---|---|---|---|---|---|
| Personal info → **Email address** | Có | Không | Bắt buộc | App functionality, Account management | đăng nhập `/api/auth/login` |
| Personal info → **Name** | Có | Không | Bắt buộc | App functionality, Account management | hồ sơ tài khoản `/api/auth/me` |
| Personal info → **User IDs** | Có | Không | Bắt buộc | App functionality, Account management | mã tài khoản trong token |
| Messages → **Other in-app messages** | Có | Không | Tùy chọn | App functionality | tin trả lời khách `/api/operations/conversations/send` |
| Photos and videos → **Photos** | Có | Không | Tùy chọn | App functionality | ảnh chọn gửi trong chat `/send-image` |
| App activity → **Other user-generated content** | Có | Không | Tùy chọn | App functionality, Analytics | câu hỏi gửi Trợ lý, máy chủ ghi `assistant_query_log` |

Các loại **không khai**, kèm lý do để lần sau khỏi phân vân:

| Loại | Vì sao không khai |
|---|---|
| Location, Contacts, Calendar, Health, Web browsing | App không xin quyền, không đọc |
| Financial info | App không thu thông tin thanh toán của người dùng; doanh thu shop là dữ liệu máy chủ |
| Audio → Voice or sound recordings | App không ghi và không gửi âm thanh về Hubsell. Nhận dạng giọng nói do dịch vụ của hệ điều hành làm, Hubsell chỉ nhận chữ. Xem cảnh báo dưới bảng |
| Files and docs | Không đọc tệp |
| Device or other IDs | Không có SDK quảng cáo hay phân tích; manifest không có quyền `AD_ID` |
| App info and performance (crash logs, diagnostics) | Chưa gắn công cụ báo lỗi nào. **Gắn Sentry hay tương tự thì phải khai thêm mục này** |
| Ảnh từ camera | Khung hình chỉ dùng để đọc mã ngay trên máy, không lưu, không gửi |
| Sinh trắc học | Hệ điều hành xử lý, app chỉ nhận kết quả đúng/sai |

"Chia sẻ" để **Không** ở dòng tin nhắn và ảnh dù nội dung đi tiếp tới sàn: Google miễn trừ việc chuyển dữ liệu do chính người dùng chủ động thực hiện và hiểu rõ (bấm Gửi tin cho khách).

**Cảnh báo về giọng nói.** Bản hướng dẫn cũ ghi "giọng nói nhận dạng trên máy, không gửi lên" là **chưa đúng**. Code gọi bộ nhận dạng của hệ điều hành mà không ép chế độ trên máy ([use-voice-input.ts](../../hubsell-mobile/src/lib/use-voice-input.ts), không đặt `requiresOnDeviceRecognition`), nên âm thanh có thể được gửi tới máy chủ nhận dạng của Apple hoặc Google. Điều đúng để nói là: **Hubsell không nhận và không lưu âm thanh**. Không nên ép nhận dạng trên máy vì tiếng Việt trên máy chưa có ở nhiều đời điện thoại, bật lên là nút mic hỏng với phần lớn khách.

### 5.2 Các tờ khai còn lại

| Mục | Trả lời |
|---|---|
| Privacy policy | `https://hubsell.vn/privacy` |
| App access | "All or some functionality is restricted" → thêm 2 bộ tài khoản mục 3, dán ghi chú mục 4 |
| Ads | Không chứa quảng cáo |
| Content rating (IARC) | Nhóm "Utility, Productivity, Communication or Other". Người dùng trao đổi nội dung với nhau: **Có** (tin nhắn với khách mua). Chia sẻ vị trí: Không. Mua vật phẩm số: Không. Kết quả chờ đợi: Everyone / 3+ |
| Target audience | 18 tuổi trở lên |
| News app | Không |
| Health apps | Không có tính năng sức khỏe |
| Financial features | "My app doesn't provide any financial features" (app chỉ hiển thị doanh thu của shop, không cho vay, không giữ tiền) |
| Government apps | Không |
| Advertising ID | Không dùng |
| Data deletion | URL mục 1; có thể xóa tài khoản: Có, qua yêu cầu trên web |

Quyền Android trong bản phát hành (soi bằng `npx expo config --type introspect` ngày 01/10): `INTERNET`, `VIBRATE`, `CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `USE_BIOMETRIC`, `USE_FINGERPRINT`, và `READ/WRITE_EXTERNAL_STORAGE` chỉ tới Android 12. Không có quyền nào thuộc nhóm phải nộp tờ khai riêng (dịch vụ chạy nền, đọc toàn bộ ảnh, vị trí nền, SMS).

---

## 6. App Store Connect

### 6.1 App Privacy (nhãn dữ liệu)

Trả lời "Yes, we collect data from this app", rồi chọn:

| Nhóm | Loại | Mục đích | Gắn với danh tính | Dùng để theo dõi |
|---|---|---|---|---|
| Contact Info | Name | App Functionality | Có | Không |
| Contact Info | Email Address | App Functionality | Có | Không |
| Identifiers | User ID | App Functionality | Có | Không |
| User Content | Emails or Text Messages | App Functionality | Có | Không |
| User Content | Photos or Videos | App Functionality | Có | Không |
| User Content | Other User Content (câu hỏi gửi Trợ lý) | App Functionality, Analytics | Có | Không |

Không chọn Audio Data (Hubsell không nhận âm thanh), không chọn Financial Info, Location, Diagnostics, Usage Data. App không theo dõi người dùng, không cần hộp xin phép theo dõi (ATT).

### 6.2 Các ô còn lại

| Mục | Trả lời |
|---|---|
| Age rating | Trả lời đúng theo bảng hỏi: có tính năng nhắn tin (với khách mua của shop), không quảng cáo, không nội dung nhạy cảm. Mức tuổi do Apple tính ra |
| Export compliance | Đã khai sẵn trong app (`usesNonExemptEncryption: false`), không bị hỏi mỗi lần nộp |
| Content rights | Không chứa nội dung của bên thứ ba cần giấy phép |
| Sign in with Apple | Không bắt buộc: app chỉ đăng nhập bằng email và mật khẩu |
| Thiết bị | Chỉ iPhone (`supportsTablet: false`) |
| Paid Apps Agreement | Không cần, chỉ nhận thỏa thuận app miễn phí |

Dòng xin quyền hiện trên iPhone (đều tiếng Việt, nêu rõ mục đích theo 5.1.1):

| Quyền | Dòng hiển thị |
|---|---|
| Camera | Hubsell cần Camera để quét mã vận đơn trên kiện hàng hoàn. |
| Thư viện ảnh | Hubsell cần mở thư viện ảnh để bạn chọn ảnh gửi cho khách trong tin nhắn. |
| Micro | Hubsell cần Micro để bạn hỏi Trợ lý bằng giọng nói thay vì gõ tay. |
| Nhận dạng giọng nói | Hubsell dùng nhận dạng giọng nói của máy để chuyển câu hỏi của bạn thành chữ. |
| Face ID | Hubsell dùng Face ID để mở khóa app, bảo vệ số liệu bán hàng của bạn. |

---

## 7. Ảnh

| Ảnh | Kích thước | Tình trạng |
|---|---|---|
| Icon App Store | 1024×1024, không alpha | Có: `hubsell-mobile/assets/images/icon-1024.png` (EAS tự gắn vào bản build) |
| Icon Google Play | 512×512 | Có: [icon-512.png](icon-512.png) |
| Ảnh bìa Google Play | 1024×500, không alpha | Có: [feature-graphic-1024x500.png](feature-graphic-1024x500.png). Sửa chữ ở [feature-graphic.html](feature-graphic.html) rồi chạy `node docs/store/render.mjs` và `python docs/store/finish.py` |
| Ảnh màn hình iPhone | ★ 06/10 App Store Connect chỉ nhận cỡ "iPhone with Dynamic Island (medium display)" = 1179×2556 hoặc **1206×2622** (1290×2796 bị báo "File dimensions are invalid") → bộ đã tải lên ở [screenshots/iphone-6.3/](screenshots/iphone-6.3/) (resize từ iphone/). Bản 1290×2796: 6 ảnh ở [screenshots/iphone/](screenshots/iphone/). Dựng từ ảnh chụp app thật trên máy ảo Android (bản `25817e81`), đã cắt thanh trạng thái + thanh điều hướng Android. Có bản TestFlight thì chụp lại trên iPhone thật để thay |
| Ảnh màn hình Android | cạnh dài không quá 2 lần cạnh ngắn, 2 đến 8 ảnh | Có (05/10): 6 ảnh 1080×2160 ở [screenshots/android/](screenshots/android/) |

Ảnh gốc (đã cắt) ở `screenshots/raw/`. Sửa chú thích trong `screenshots/render-shots.mjs` rồi chạy `node docs/store/screenshots/render-shots.mjs` và `python docs/store/screenshots/finish-shots.py`. Xem nhanh cả bộ: [screenshots/xem-nhanh.png](screenshots/xem-nhanh.png).

Bộ 6 ảnh theo app bản 04/10 (đã bỏ tab Tin nhắn; trang Quảng cáo không chụp vì gian mẫu chưa ủy quyền quảng cáo nên màn trống), giao diện Sáng:

| # | Màn | Chú thích |
|---|---|---|
| 1 | Trang chủ → Tổng quan | Mở máy là thấy lãi ròng hôm nay |
| 2 | Trang chủ → Tài chính | Tiền đi đâu, còn lại bao nhiêu |
| 3 | Đơn hàng | Đơn mọi sàn trong một danh sách |
| 4 | Kho → Đơn hoàn | Quét mã, nhận hàng hoàn |
| 5 | Kho → Tồn kho | Tồn kho từng mã, biết hàng sắp hết |
| 6 | Trợ lý Hubsell | Hỏi bằng tiếng Việt, đáp bằng số thật |

Ảnh phải là màn hình thật của app (Apple 2.3.3) và không lộ tên, số điện thoại khách thật: chụp bằng tài khoản `reviewer@hubsell.vn` (dữ liệu mẫu), không chụp bằng shop thật.

---

## 8. Việc phải xong trước khi bấm nộp

| # | Việc | Ai | Tình trạng |
|---|---|---|---|
| 1 | Sửa `app.json`: dòng xin quyền thư viện ảnh đang là tiếng Anh mặc định; tắt chế độ phát âm thanh nền (app chỉ phát tiếng bíp, để mặc định là xin dư quyền chạy nền, Apple trả theo 2.5.4, Google bắt nộp video giải trình dịch vụ chạy nền); chặn quyền `SYSTEM_ALERT_WINDOW` | Claude | Đã sửa 01/10, đã soi lại bằng introspect. **Chưa kiểm trên bản build thật** |
| 2 | Đăng nhập `reviewer@hubsell.vn` trên bản build, đi hết 6 màn. Riêng màn Tin nhắn: gian mẫu không phải shop thật trên sàn nên có thể hiện hộp lỗi, người duyệt gặp lỗi là trả hồ sơ theo 2.1 | Claude + anh (anh giữ mật khẩu) | Chưa làm |
| 3 | Lấy 3 mã vận đơn hoàn của tài khoản reviewer điền vào ghi chú mục 4 | Claude | Chưa làm, làm cùng việc 2 |
| 4 | Chính sách bảo mật chưa có đoạn nào nói về app di động (camera, ảnh, giọng nói). Kho đối chiếu chính sách với tờ khai dữ liệu. Đoạn đề xuất ở mục 9, chờ anh duyệt câu chữ | Anh duyệt → Claude sửa landing | Chờ anh |
| 5 | Dải thông báo trên web app và khối #mobile trên landing đang ghi "trả lời tin nhắn khách Shopee, TikTok Shop, Lazada", trong khi thẻ TikTok trên app di động là màn "chưa nối chat" | Anh chốt: nối chat TikTok cho mobile, hay sửa câu chữ | Chờ anh |
| 6 | Chụp ảnh màn hình (mục 7) | Claude | Xong 05/10 (ảnh từ máy ảo Android), chờ anh duyệt |
| 7 | Build thử Android (APK) để bắt lỗi native trước khi tài khoản kho được duyệt | Anh `npx eas-cli login` → Claude | Chờ anh đăng nhập Expo |

---

## 9. Đoạn đề xuất thêm vào Chính sách bảo mật

Chèn thành một mục riêng "Ứng dụng di động" trong `hubsell-landing/src/app/privacy/page.tsx`, tăng ngày phiên bản. Chưa sửa, chờ anh duyệt.

> **Ứng dụng di động Hubsell.** Ứng dụng trên điện thoại dùng chung tài khoản và chung dữ liệu với bản web; mọi điều khoản trong chính sách này áp dụng như nhau. Ứng dụng chỉ xin các quyền sau, và chỉ khi bạn dùng tới tính năng tương ứng:
>
> - **Camera**: đọc mã vận đơn trên kiện hàng. Hình ảnh từ camera được xử lý ngay trên máy, không lưu và không gửi về Hubsell.
> - **Thư viện ảnh**: khi bạn chọn một ảnh để gửi cho khách trong tin nhắn. Hubsell chỉ nhận đúng ảnh bạn chọn và chuyển tới sàn nơi diễn ra cuộc trò chuyện.
> - **Micro và nhận dạng giọng nói**: khi bạn bấm nút micro để hỏi Trợ lý. Việc chuyển giọng nói thành chữ do dịch vụ nhận dạng của hệ điều hành (Apple hoặc Google) thực hiện theo chính sách của họ; Hubsell không nhận và không lưu âm thanh, chỉ nhận phần chữ của câu hỏi.
> - **Face ID hoặc vân tay**: nếu bạn bật khóa ứng dụng. Việc xác thực do hệ điều hành thực hiện, Hubsell không nhận dữ liệu sinh trắc học.
>
> Câu hỏi bạn gửi Trợ lý được lưu lại để cải thiện khả năng trả lời. Ứng dụng không chứa quảng cáo và không dùng công cụ theo dõi của bên thứ ba.

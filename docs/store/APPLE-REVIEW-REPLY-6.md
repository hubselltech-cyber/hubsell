# Lần 6 — Apple 2.1(b): "unable to complete purchase Non Renewable Subscription" (14/10/2026)

Bối cảnh: submission `6b88b07c…` (build 1.0 (8) + 20 IAP Non-Renewing). Apple xem 14/10 trên
iPhone 17 Pro Max iOS 27.0.1, trả lời 14/10 09:41 (giờ VN). KHÔNG còn 3.1.1, KHÔNG đòi thêm
thông tin, 20 IAP vẫn "Ready for Review". Lời Apple:

> Guideline 2.1(b) - Performance - App Completeness. The In-App Purchase products in the app
> exhibited one or more bugs which create a poor user experience. Specifically, unable to
> complete purchase Non Renewable Subscription. … Confirm you have a Paid Apps Agreement in effect.

## Gốc lỗi (đã kiểm 14/10, không phải phỏng đoán)

Đã loại trừ trước:
- Paid Apps Agreement: **Active** 09/10/2026 → 05/10/2027 (Business → Agreements), ngân hàng
  Active, W-8BEN-E Active. Có "New Agreement Available" nhưng không chặn.
- Availability từng sản phẩm: **175 nước**, giá VND, Display Name + Review Screenshot đủ.
- Backend: không có thư HQ "[Hubsell] 🍎 App Store (sandbox)" trong 2 ngày → chưa từng có
  giao dịch nào tới `/apple-iap/redeem`. Lỗi nằm TRƯỚC lúc bấm mua.

Gốc: **openiap (lõi native của expo-iap 6.0) xếp StoreKit `.nonRenewable` vào `type: "subs"`**
(`StoreKitTypesBridge.productType(from:)`: `.autoRenewable, .nonRenewable → .subs`). Màn
`PlanStoreScreen` gọi `fetchProducts({ type: "in-app" })`, mà native `OpenIapModule.fetchProducts`
nhánh `.inApp` chỉ giữ `value.type == .inApp` → **20 gói bị lọc hết, mảng rỗng** → màn hiện
"App Store chưa có gói nào để mua lúc này". Người duyệt không có nút Mua → "unable to complete
purchase". Gọi `type: "subs"` cũng KHÔNG được vì nhánh `.subs` đòi `product.subscription != nil`
(non-renewing không có SubscriptionInfo). Chỉ `type: "all"` trả về; khi đó hook `useIAP` chia
theo `item.type` → non-renewing rơi vào mảng **`subscriptions`**, không vào `products`.

Vì sao sót: luồng mua chưa từng chạy trên iPhone thật/TestFlight (ghi chú 06/10). Trên web
(chế độ dựng ảnh review) không có StoreKit nên không lộ.

## Sửa (commit cùng ngày)

`hubsell-mobile/src/components/PlanStoreScreen.tsx`:
- `fetchProducts({ skus, type: "all" })`.
- Đọc gộp `[...products, ...subscriptions]` từ `useIAP` làm nguồn giá (`StoreItem = Product |
  ProductSubscription`, chỉ cần `id` + `displayPrice`).
- `requestPurchase` giữ `type: "in-app"` + `request.apple`: native iOS chỉ nhìn `request.apple`
  (`resolveIosPurchaseProps`), type chỉ có nghĩa với Android.
- Không đổi backend.

Build iOS mới = **1.0 (9)** (EAS production, autoIncrement).

## Thứ tự nộp lại

1. `eas build -p ios --profile production --non-interactive --no-wait` → chờ xong →
   `eas submit -p ios --latest --non-interactive` (khóa ASC Q5L8979HZT).
2. (Nếu có iPhone) TestFlight + Sandbox Tester: mở Cấu hình → Gói dịch vụ → thấy 5 gói có giá →
   mua Starter 1 tháng → hộp "Đã kích hoạt gói" + thư HQ "App Store (sandbox)" về dev@.
3. ASC trang bản 1.0: Build → gỡ (8) chọn (9) → Save → **Update Review** (anh bấm).
4. App Review → submission 6b88b07c → **Reply to App Review** (thư dưới) → **Resubmit** (anh bấm).
5. 20 IAP vẫn gắn trong cùng submission, không cần chọn lại.

## Thư trả lời Apple (dán vào Reply to App Review)

Hello App Review team,

Thank you for the detailed report. We found and fixed the cause.

Root cause: the store screen requested products from StoreKit with the "in-app" product-type
filter. Our products are Non-Renewing Subscriptions, which the purchase library classifies
under the "subscription" type, so the request returned an empty list and the screen showed
"no plans available" instead of the purchase buttons. The purchase sheet was therefore never
reached. There was no problem with the products' configuration or the Paid Apps Agreement
(active since Oct 9, 2026).

Fix in build 1.0 (9): the screen now requests all product types and reads both lists, so the 20
non-renewing products load with their App Store prices and the Buy button triggers the StoreKit
purchase sheet. After a successful purchase the app validates the signed transaction with our
server and activates the plan immediately.

How to test (same demo account, subscription already expired):
1. Sign in with reviewer@hubsell.vn (password in App Review Information).
2. Tap the red "expired" banner on Home, or Settings → "Gói dịch vụ".
3. The plans (Starter, Growth, Pro, Business, Scale) appear with 1/3/6/12-month prices.
4. Tap "Mua gói" → complete the sandbox purchase → the alert "Đã kích hoạt gói" appears and
   the banner disappears.

We apologize for the inconvenience and appreciate your patience.

Hubsell Technology

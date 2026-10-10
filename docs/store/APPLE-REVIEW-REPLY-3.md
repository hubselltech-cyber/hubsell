# Thư trả lời Apple lần 3 — build 8, đã thêm In-App Purchase (10/10/2026)

Bối cảnh: Apple từ chối build 7 ngày 09/10 chỉ vì 3.1.1 ("The app accesses digital content
purchased outside the app, but that content isn't available to purchase using In-App
Purchase"). Anh Trung chốt làm IAP (docs/APPLE-IAP-MUA-GOI-TRONG-APP.md). Dán thư dưới vào
**Reply to App Review** của submission bc9bbaf6 sau khi đã chọn build 8 + 20 sản phẩm IAP.

```
Hello,

Thank you for the review. We have resolved Guideline 3.1.1 in build 1.0 (8):

- The service plans that merchants could previously buy only on our website are
  now available for purchase inside the app with In-App Purchase. We created
  20 non-renewing subscriptions (Starter / Growth / Pro / Business / Scale, each
  for 1 / 3 / 6 / 12 months) and submitted them together with this build.
- New entry points: Settings tab ("Cau hinh") -> "Goi dich vu" card, and the
  plan row on the Account screen. The screen lists the plans with prices from
  StoreKit and a single "Mua goi" button that starts the StoreKit purchase.
  After the purchase, our server validates the signed transaction and activates
  the plan immediately; the new period is shown on the same screen.
- There is no other purchase method, no external purchase link and no price
  comparison anywhere in the app. Merchants who purchased a plan on our website
  continue to use it in the app, as allowed by Guideline 3.1.3(b), since the
  same plans are now sold via In-App Purchase.
- "Khoi phuc giao dich" (Restore) re-syncs any unfinished StoreKit transaction.

To test: sign in with the demo account in App Review Information, open
Settings -> "Goi dich vu", choose a plan and period, tap "Mua goi" and complete
the sandbox purchase. The plan activates right away.

Everything else is unchanged from the previous build (no sign-up, no trial,
account deletion inside the app, camera only for barcode scanning).

Thank you,
Hubsell Technology Co., Ltd.
```

## Việc trên App Store Connect trước khi Resubmit (10/10)

1. Paid Apps Agreement = Active (anh ký + Banking + Tax).
2. 20 sản phẩm: Availability Việt Nam + Pricing (giá web ÷ 0,85, làm tròn lên) + Review
   Screenshot (ảnh màn "Gói dịch vụ" build 8) + Review Notes (một câu: "Non-renewing plan
   for Hubsell merchants, activates immediately after purchase").
3. App Information → App Store Server Notifications: Production + Sandbox URL
   `https://hubsell-backend-sg.onrender.com/api/webhooks/apple-iap` (V2).
4. Trang 1.0 → chọn build 1.0 (8) → mục In-App Purchases and Subscriptions → thêm 20 sản phẩm
   → Notes mới (LISTING.md mục 4, đoạn PAYMENTS iOS) → Save → Update Review → Reply (thư trên)
   → Resubmit.

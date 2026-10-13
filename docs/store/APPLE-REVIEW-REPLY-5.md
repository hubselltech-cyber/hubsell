# Lần 5 — Apple 2.1 Information Needed: cần tài khoản demo ĐÃ HẾT HẠN (13/10/2026)

Bối cảnh: submission `6b88b07c…` (build 1.0 (8) + 20 IAP). Apple xem 12/10 trên iPhone 17 Pro
Max, trả lời 13/10 05:14. KHÔNG từ chối 3.1.1, 20 IAP vẫn "Ready for Review". Chỉ một yêu cầu:

> Guideline 2.1 - Information Needed. We are not able to continue our review because we need
> access to a demo account with an expired subscription to review the entire purchase flow.
> Next Steps: provide a user name and password for a demo account with expired subscriptions in
> the App Review Information section of App Store Connect.

Lý do: tài khoản demo `reviewer@hubsell.vn` đang Business ACTIVE tới 27/08/2027 nên người duyệt
không thấy trạng thái hết hạn → không thử được luồng "hết hạn → mua IAP → kích hoạt lại".

## Đã làm 13/10 (anh chốt dùng MỘT tài khoản, không tạo tài khoản mới)

1. **SQL Supabase (anh dán 08:50)** — cho chính `reviewer@hubsell.vn` hết hạn từ hôm qua. Hết
   hạn còn 7 ngày ân hạn (`EXPIRED_GRACE_DAYS` trong plan-enforcement.ts) nên các màn khác vẫn
   xem được; dải đỏ trên Trang chủ dẫn thẳng tới màn Gói dịch vụ. Backend suy "hết hạn" lúc đọc
   từ `currentPeriodEnd < now()`, không có cron, không cần đổi `status`.

   ```sql
   UPDATE subscriptions s
   SET "currentPeriodEnd" = now() - interval '1 day', "updatedAt" = now()
   FROM "User" u
   WHERE u.id = s."userId" AND u.email = 'reviewer@hubsell.vn'
   RETURNING u.email, s."planId", s.status, s."isTrial", s."currentPeriodEnd";
   ```
   Bẫy: bảng User KHÔNG có `@@map` → tên thật là `"User"` (ngoặc kép, chữ hoa); `users` báo
   42P01. Kết quả: 1 dòng, ACTIVE, isTrial=false, currentPeriodEnd 2026-10-12 01:58.

2. **App Store Connect → bản 1.0 → App Review Information → Notes** (Claude gõ qua Chrome, đã
   Save): thay đoạn "To test: …" bằng đoạn dưới, rút câu Sign-up để giữ ≤ 4.000 ký tự
   (bản mới 3.997). Ô Sign-in vẫn là `reviewer@hubsell.vn`.

   ```
   EXPIRED PLAN / PURCHASE FLOW: the demo account above now has an EXPIRED plan (period ended
   the day before this resubmission). After sign-in the Home tab shows a red banner "Tinh nang
   nang cao se tam khoa tu ngay ...". Tap the banner, or Settings -> "Goi dich vu", pick a plan
   and period, tap "Mua goi" and complete the purchase. The plan activates at once, the banner
   disappears and the new period shows on the same screen. "Khoi phuc giao dich" re-syncs
   unfinished StoreKit transactions. All other screens work with the same account.
   ```

3. **Reply to App Review** trên submission `6b88b07c…` (Claude gửi 09:01):

   ```
   Hello,

   Thank you for the review. The demo account in the App Review Information section
   (reviewer@hubsell.vn, same password as before) now has an EXPIRED subscription: its plan
   period ended on 12 October 2026, the day before this resubmission.

   After signing in, the Home tab shows the red banner "Tinh nang nang cao se tam khoa tu ngay
   ..." (advanced features will be locked from that date). Tap the banner, or open Settings
   ("Cau hinh") -> "Goi dich vu", choose a plan and period and tap "Mua goi" to complete the
   purchase with In-App Purchase. The plan is activated right after the purchase, the banner
   disappears and the new period is shown on the same screen.

   The account is still connected to the sample shops with orders, returns, stock and finance
   data, so every other screen can be reviewed with the same account before or after the
   purchase. We have also updated the Notes in App Review Information accordingly.

   Thank you,
   Hubsell Technology Co., Ltd.
   ```

4. **Anh bấm** (bộ lọc an toàn của Claude chặn nút "Update Review"): trang bản 1.0 → Update
   Review → App Review → submission → Resubmit to App Review. ✅ 13/10 ~09:20 trạng thái
   **Waiting for Review** (bản 1.0 + 20 IAP). Không cần build mới.

## Lưu ý sau lượt này
- Người duyệt mua bằng môi trường sandbox của Apple (Apple quyết định, không thu tiền thật);
  backend ghi khoản 0₫ không vào sổ quỹ + gửi thư "[Hubsell] 🍎 App Store (sandbox)" về dev@.
  Thấy thư này = luồng redeem chạy thật. Khách thật mua ở production, ghi đúng tiền.
- Sau khi duyệt, `reviewer@hubsell.vn` ở gói người duyệt chọn mua thử → muốn trả về Business
  như cũ thì SQL đổi `planId` + `currentPeriodEnd` (hỏi anh).
- Mail HQ "khách hết hạn gói hôm qua" ngày 13–14/10 sẽ liệt kê reviewer@ — bỏ qua.
- Bẫy Chrome MCP trên ASC: gõ Notes dài bằng `type` báo timeout 30 s nhưng chữ vẫn vào, kiểm
  bằng JS `value.length`; nút "Reply to App Review" bấm theo ref không mở, phải bấm tọa độ;
  đặt chữ bằng JS (setter + dispatch input) bị bộ lọc an toàn chặn.

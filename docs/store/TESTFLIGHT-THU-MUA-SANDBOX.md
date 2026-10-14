# Thử mua gói IAP trên iPhone thật qua TestFlight (14/10/2026)

Mục đích: xác nhận bản 1.0 (9) hiện đủ gói + mua được trong sandbox TRƯỚC khi nộp lại Apple
(lần 6 bị từ chối vì màn Gói dịch vụ trống, xem `APPLE-REVIEW-REPLY-6.md`).

Tổng cộng ~15 phút, 3 phần. Phần A và B làm ngay, không cần chờ build.

## A. Tạo tài khoản mua thử (Sandbox Tester) — trên máy tính, ASC

1. appstoreconnect.apple.com → **Users and Access** → tab **Sandbox** → **Test Accounts** → nút **+**.
2. Điền: First/Last name tùy ý; **Email** là một địa chỉ CHƯA từng là Apple ID, ví dụ
   `sandbox1@hubsell.vn` (không cần hộp thư thật, Apple không gửi xác minh); mật khẩu tự đặt
   (ghi lại); **Country or Region = Vietnam** (để giá hiện VND đúng như Apple duyệt); Date of
   birth bất kỳ > 18 tuổi → **Create**.
3. KHÔNG đăng nhập tài khoản này vào iCloud/App Store thật của iPhone. Chỉ dùng ở bước C3.

## B. Cho iPhone của anh nhận bản thử

1. iPhone: App Store → cài app **TestFlight** (của Apple, miễn phí).
2. Xác định **Apple ID đang dùng trên iPhone** (Cài đặt → tên anh ở trên cùng → email hiện dưới tên).
   - **Nếu là dev@hubsell.vn**: xong phần B, qua C.
   - **Nếu là email khác (thường gặp)**: trên ASC → Users and Access → tab People → **+** →
     nhập tên + email Apple ID đó, Role **App Manager**, chọn app Hubsell → Invite. iPhone sẽ
     nhận mail "You're invited to join Hubsell Technology" → bấm Accept (đăng nhập bằng chính
     Apple ID đó). Phải Accept xong mới sang bước 3.
3. ASC → app Hubsell → tab **TestFlight** → cột trái **Internal Testing** → **+** → tên nhóm
   `Hubsell team`, bật **Enable automatic distribution** → Create → **Testers +** → tích
   dev@hubsell.vn (hoặc Apple ID của iPhone) → Add.
4. Khi build 1.0 (9) được nộp lên và Apple xử lý xong (~10–20 phút sau khi em báo "đã nộp"),
   iPhone nhận thông báo TestFlight. Mở TestFlight → Hubsell → **Install**. (Nếu không thấy
   thông báo: mở TestFlight, kéo xuống làm mới; hoặc mail "Hubsell 1.0 (9) is now available".)

## C. Mua thử

1. iPhone: **Cài đặt → Apps → App Store** (iOS cũ hơn: Cài đặt → App Store) → kéo xuống cuối →
   mục **Sandbox Account** → Sign In → nhập tài khoản ở phần A. Mục này CHỈ hiện sau khi iPhone
   đã cài ít nhất một app TestFlight/dev.
2. Mở Hubsell (bản TestFlight, icon có chấm cam) → đăng nhập **reviewer@hubsell.vn** (tài khoản
   demo đang hết hạn, mật khẩu anh có). Hoặc tài khoản shop thật của anh cũng được.
3. Trang chủ có dải đỏ hết hạn → bấm, hoặc **Cấu hình → Gói dịch vụ**.
   - ✅ ĐÚNG: thấy 5 gói Starter/Growth/Pro/Business/Scale, mỗi gói có nút 1/3/6/12 tháng và giá
     VND. Đây là chỗ lần trước trống.
   - ❌ SAI: "App Store chưa có gói nào để mua lúc này" hoặc quay mãi "Đang tải bảng giá" → chụp
     màn hình gửi em, DỪNG, không nộp Apple.
4. Chọn **Starter → 1 tháng → Mua gói**. Bảng xác nhận của Apple hiện chữ **[Environment: Sandbox]**,
   giá 0₫ hoặc giá thật đều bình thường → xác nhận (Face ID / mật khẩu sandbox).
5. ✅ Kỳ vọng: hộp "Đã kích hoạt gói — Gói Starter (1 tháng) có hiệu lực tới …", dải đỏ biến
   mất; Zoho dev@ nhận thư "[Hubsell] 🍎 App Store (sandbox): +0₫ — gói Starter" trong 1 phút.
   Thấy hộp "Chưa ghi nhận được giao dịch" → chụp màn hình gửi em (lỗi phía backend, gói Apple
   đã giữ, bấm "Khôi phục giao dịch" sau khi em sửa).
6. Mua xong, tài khoản reviewer@ thành Starter ACTIVE 1 tháng → trước khi nộp Apple phải cho
   hết hạn lại (SQL ở `APPLE-REVIEW-REPLY-5.md` mục 1, dán Supabase), vì Apple cần tài khoản
   hết hạn để đi lại luồng mua.

## Sau khi thử đạt

Anh báo em → em kiểm thư HQ → anh bấm 3 nút trên ASC: trang bản 1.0 chọn build (9) → Update
Review → App Review → Reply (thư ở REPLY-6) → Resubmit.

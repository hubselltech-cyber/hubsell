# CHUYỂN TÊN MIỀN hubsell.tech → hubsell.vn

> Anh Trung chốt 19/09/2026: **chuyển dần**, chạy song song hai tên miền; phần **hạ tầng (chặng 3) đợi TikTok review app xong** (nộp lại 16/09, hạn 10–12 ngày làm việc) vì hồ sơ TikTok khai URL `.tech` và redirect TikTok Ads đang là `app.hubsell.tech/ads/tiktok/callback`.

## 1. Trạng thái

| Chặng | Nội dung | Trạng thái |
|---|---|---|
| 0. Alias | 3 tên miền `.vn` chạy song song `.tech` | ✅ 19/09 |
| 1. Email | Zoho Mail Lite, hộp + bí danh `@hubsell.vn`, thư hệ thống gửi qua Zoho | ✅ 19/09 |
| 2. Mặt tiền | chữ, email hỗ trợ, link pháp lý, canonical, link giới thiệu về `.vn` | ✅ 19/09 |
| 3. Hạ tầng (buổi cắt) | env, 301, portal các sàn | ⏳ **chờ TikTok review OK** |
| 4. Hậu kỳ | giữ `.tech` + 301 tối thiểu 12 tháng | sau chặng 3 |

## 2. Cái đang chạy (để tra khi cần)

**DNS hubsell.vn** — Mắt Bão (`manage.matbao.net` → hubsell.vn → Chi tiết dịch vụ → tab Bản ghi DNS; một bản ghi nhận nhiều giá trị), NS `ns1/ns2.matbao.vn`:

| Loại | Host | Giá trị |
|---|---|---|
| A | `@` | `216.198.79.1` (Vercel) |
| CNAME | `www` | `8c849c4217aba00a.vercel-dns-017.com.` (project `hubsell-landing`) |
| CNAME | `app` | `ddefc76c38c8bc53.vercel-dns-017.com.` (project `hubsell`) |
| MX | `@` | `mx.zoho.com` 10 · `mx2.zoho.com` 20 · `mx3.zoho.com` 50 |
| TXT | `@` | `v=spf1 include:zohomail.com ~all` + `zoho-verification=…` |
| TXT | `zmail._domainkey` | khóa DKIM của Zoho |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dev@hubsell.vn` |

**Vercel:** `hubsell-landing` có `hubsell.vn` + `www.hubsell.vn` (cùng nối Production, KHÔNG bật "redirect apex → www" — tên trần là chính); `hubsell` có `app.hubsell.vn`. `.tech` giữ nguyên.

**Zoho Mail** (tổ chức "Hubsell", gói Mail Lite 1 người, 12 USD / năm, gia hạn 19/09/2027): miền chính `hubsell.vn`, `hubsell.tech` vẫn là miền phụ. MỘT hộp thư, địa chỉ chính + đăng nhập = `dev@hubsell.vn`; bí danh: `support@`, `billing@`, `no-reply@hubsell.vn`, `dev@` + `support@hubsell.tech`. Bộ lọc: Đến/Cc chứa `support@hubsell` → **Hỗ trợ**; `billing@hubsell` → **Thanh toán**; Tiêu đề chứa `[Hubsell]` → **Hệ thống** (thư đối tác gửi `dev@` cố ý để lại Hộp thư đến).

**Phân vai người gửi** (code: `backend/src/lib/mailer.ts` `resolveSender`, nội dung ở `services/customer-mails.ts`):

| Sự kiện | Gửi từ | Trả lời về | Báo HQ |
|---|---|---|---|
| Khách đăng ký mới | `no-reply@` | `support@` | có |
| Quên / đổi mật khẩu | `no-reply@` | `support@` | không |
| Kích hoạt / gia hạn gói | `billing@` | `billing@` | có (đường payOS) |
| Còn 7 ngày / 1 ngày tới hạn | `billing@` | `billing@` | một thư tổng hợp khách hết hạn hôm qua |

Env Render: `SMTP_HOST=smtppro.zoho.com` (tài khoản tổ chức trả tiền — `smtp.zoho.com` là của tài khoản cá nhân), `SMTP_PORT=465`, `SMTP_USER=dev@hubsell.vn`, `SMTP_PASS` = Mật khẩu ứng dụng (Zoho Accounts → **An ninh** → Mật khẩu theo ứng dụng), `MAIL_FROM`, `MAIL_FROM_NOREPLY`, `MAIL_FROM_BILLING`. Zoho Mail không dành cho gửi số lượng lớn — đông khách thì chuyển thư hệ thống sang dịch vụ thư giao dịch (ZeptoMail), địa chỉ giữ nguyên.

**Điểm đã lường trước ở giai đoạn song song:** vào `app.hubsell.vn` phải đăng nhập lại (phiên lưu theo tên miền); đăng nhập Google / nối gian hàng từ `app.hubsell.vn` bị trả về `app.hubsell.tech` vì mọi luồng quay về đọc `APP_FRONTEND_URL` → **chưa phát link app đuôi `.vn` cho khách**. KHÔNG viết code "quay về đúng tên miền xuất phát" — sau 301 chỉ còn một tên miền, code đó thành đồ bỏ.

## 3. CHẶNG 3 — buổi cắt (một buổi tối ít khách, SAU khi TikTok review OK)

Làm đúng thứ tự — khai bên ngoài trước, đổi env sau, 301 sau cùng:

1. **Khai URL mới trên các portal (chưa đổi gì phía mình):**
   - TikTok Marketing API: thêm Redirect URL `https://app.hubsell.vn/ads/tiktok/callback` (mặc định trong code: `backend/src/integrations/tiktok-ads/config.ts`).
   - Website URL trên Console Shopee (app chính 2040029 + Hubsell Ads 2044679), Lazada (ISV 142085), TikTok Shop. Callback / webhook các sàn + payOS trỏ thẳng `hubsell-backend-sg.onrender.com` nên KHÔNG đổi.
   - Google Cloud (client "Hubsell Web"): thêm origin `https://app.hubsell.vn` nếu màn hình OAuth yêu cầu (redirect URI trỏ backend nên không đổi).
2. **Đổi env:** Render `APP_FRONTEND_URL=https://app.hubsell.vn`, `CORS_ORIGINS` thêm `.vn` (allowlist cứng trong `app.ts` đã có sẵn), `TIKTOK_ADS_REDIRECT_URI`, `REFERRAL_LINK_BASE` (nếu đang đặt); Vercel landing `NEXT_PUBLIC_APP_URL=https://app.hubsell.vn` (nút, chữ khung tour, redirect `/register` tự theo).
3. **Thử 5 luồng trên `.vn`:** đăng nhập Google · email quên mật khẩu (link phải là `.vn`) · nối Shopee · nối TikTok Ads · thanh toán payOS (returnUrl).
4. **Bật 301** `hubsell.tech` → `hubsell.vn` và `app.hubsell.tech` → `app.hubsell.vn`, giữ nguyên đường dẫn + tham số (link giới thiệu cũ, link trong thư đã gửi vẫn ăn). Làm ở Vercel → Domains → Edit → Redirect to.
5. **Dải thông báo trong app vài ngày:** "Hubsell chuyển sang hubsell.vn, anh/chị đăng nhập lại một lần".
6. **Dọn chữ còn sót:** `hubsell-mobile/src/app/no-access.tsx` (cần phát hành bản app mới), bỏ cụm "(và hubsell.tech)" trong Điều khoản khi đã 301 ổn định (đổi ngày cập nhật + `TERMS_VERSION`), Search Console khai Change of Address.

**Đường lùi:** bước 3 lỗi thì trả env về `.tech` (khoảng 5 phút) — lúc đó chưa bật 301 nên khách không bị ảnh hưởng.

**Không làm:** đưa backend về `api.hubsell.vn` (phải khai lại callback + webhook 3 sàn và payOS, khách không được lợi gì).

## 4. Hậu kỳ

- Giữ gia hạn `hubsell.tech` + 301 tối thiểu 12 tháng; `dev@` / `support@hubsell.tech` giữ làm bí danh nhận thư cùng thời gian đó.
- Đổi email đăng ký ở từng cổng đối tác (Shopee, TikTok, Lazada, payOS, Render, Vercel, Supabase) sang `dev@hubsell.vn` TRƯỚC khi bỏ `.tech`. Tài khoản HQ trong app cũng đang là `dev@hubsell.tech`.
- DMARC nâng từ `p=none` lên `quarantine` sau vài tuần báo cáo sạch.

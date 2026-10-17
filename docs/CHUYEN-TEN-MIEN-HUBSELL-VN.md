# CHUYỂN TÊN MIỀN hubsell.tech → hubsell.vn

> Anh Trung chốt 19/09/2026: **chuyển dần**, chạy song song hai tên miền; phần **hạ tầng (chặng 3) đợi TikTok review app xong** (TikTok duyệt app 12/10/2026). 12/10 anh chốt làm chặng 3 ban ngày 13–14/10; 14/10 khảo sát xong: **không ảnh hưởng Apple review** (app iOS gọi thẳng backend Render, không universal link, link pháp lý đã là .vn).

## 1. Trạng thái

| Chặng | Nội dung | Trạng thái |
|---|---|---|
| 0. Alias | 3 tên miền `.vn` chạy song song `.tech` | ✅ 19/09 |
| 1. Email | Zoho Mail Lite, hộp + bí danh `@hubsell.vn`, thư hệ thống gửi qua Zoho | ✅ 19/09 |
| 2. Mặt tiền | chữ, email hỗ trợ, link pháp lý, canonical, link giới thiệu về `.vn` | ✅ 19/09 |
| 3. Hạ tầng (buổi cắt) | env, 301 | ✅ **14/10 09:30 XONG** — Render APP_FRONTEND_URL (anh), Vercel NEXT_PUBLIC_APP_URL tạo lại loại Config + Redeploy (em), redirect **307** app.hubsell.tech→app.hubsell.vn + hubsell.tech→hubsell.vn (anh bấm, công cụ chặn em); curl kiểm 6 URL giữ nguyên path + query. Đổi 307→308 sau vài ngày ổn định (mục 4) |
| 4. Hậu kỳ | giữ `.tech` + 301 tối thiểu 12 tháng | ⏳ từ 14/10 |

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

## 3. CHẶNG 3 — buổi cắt (14/10/2026, ban ngày — anh chốt 12/10)

Thứ tự bắt buộc: **đổi env backend → đổi env landing → thử luồng → 301 sau cùng.** Portal các sàn KHÔNG đụng (lý do ở 3.1).

### 3.1 Quyết định 14/10 sau khi rà mã (khác bản kế hoạch cũ)

| Việc trong kế hoạch cũ | Quyết định | Lý do |
|---|---|---|
| Thêm Redirect URL `.vn` trên TikTok Marketing API (Ads) | **KHÔNG làm** | Sửa app trên portal TikTok có thể kéo xét duyệt lại. Callback `/ads/tiktok/callback` nhận `auth_code` + `state` do backend ký (`tiktok-ads/oauth.ts`), không phụ thuộc origin; 301 giữ nguyên đường dẫn + query nên luồng vẫn chạy. Giữ `TIKTOK_ADS_REDIRECT_URI` = `.tech`. |
| Đổi Redirect URL TikTok Shop (Partner Center) `app.hubsell.tech/channels/tiktok/callback` | **KHÔNG làm** | App vừa được duyệt 12/10 + bật Product Modify; sửa URL = sửa app đã duyệt. Trang callback đọc `state` ở `sessionStorage` của **origin đích sau 301** (app.hubsell.vn, nơi khách bấm Kết nối) nên vẫn khớp. Giữ `TIKTOK_REDIRECT_URI` = `.tech`. Thêm URL `.vn` khi có dịp nộp lại app. |
| Website URL trên Console Shopee (2040029, 2044679), Lazada ISV 142085 | **Dời sang hậu kỳ** | Chỉ là thông tin hiển thị, `.tech` vẫn mở được nhờ 301; sửa hồ sơ app đã duyệt không đáng rủi ro. |
| Google Cloud thêm origin `app.hubsell.vn` | **Không cần** | Đăng nhập Google là code flow: FE chuyển sang `/api/auth/google` (backend) → Google → callback backend → redirect `APP_FRONTEND_URL`. Không có JS origin. |
| `CORS_ORIGINS` thêm `.vn` | **Không cần** | Allowlist cứng trong `app.ts` đã có `hubsell.vn`, `www.hubsell.vn`, `app.hubsell.vn` từ 09/2026. |

Vì sao 301 đủ cho mọi callback: Vercel domain redirect giữ nguyên đường dẫn + query (kiểm lại bằng `curl -I` ngay sau khi bật, bước 3.4).

### 3.2 Env Render — **anh làm** (công cụ của em bị chặn xem/sửa env Render 14/10)

Làm trên CẢ HAI service `hubsell-backend-sg` (web) và `hubsell-worker-sg` (worker gửi thư có link):

| Biến | Đặt thành | Ghi chú |
|---|---|---|
| `APP_FRONTEND_URL` | `https://app.hubsell.vn` | Biến duy nhất bắt buộc. Quyết định đích redirect sau Google login, link trong thư (quên mật khẩu, nhắc gói, nối gian), returnUrl payOS, `fe` trong state OAuth 3 sàn. |
| `REFERRAL_LINK_BASE` | `https://hubsell.vn/register` | Chỉ sửa nếu đang đặt `.tech`; mặc định trong mã đã là `.vn`. |
| `TIKTOK_ADS_REDIRECT_URI`, `TIKTOK_REDIRECT_URI` | **GIỮ NGUYÊN** `.tech` | Xem 3.1. |
| `CORS_ORIGINS` | giữ nguyên | Xem 3.1. |

Lưu = Render tự deploy lại (~1m40s mỗi service, không migration). Render báo bảo trì hạ tầng **15/10 08:00 GMT+7** — làm xong trước mốc đó.

### 3.3 Env Vercel landing — em làm sau khi 3.2 xong

Project `hubsell-landing` → Environment Variables → `NEXT_PUBLIC_APP_URL` (Production + Preview, tạo 09/08) đổi thành `https://app.hubsell.vn` → **Redeploy** bản Production (biến `NEXT_PUBLIC_*` nướng lúc build). Mặc định trong mã (`src/lib/site.ts`, `next.config.ts`, `.env.example`) đã đổi sang `.vn` ngày 14/10.

### 3.4 Thử luồng trên `.vn` (trước khi 301)

1. Đăng nhập Google từ `app.hubsell.vn/login` → phải quay về `app.hubsell.vn` (không văng sang `.tech`).
2. Quên mật khẩu → link trong thư là `app.hubsell.vn/reset-password?...`.
3. Landing `hubsell.vn` → nút Dùng thử / `/register?ref=` → sang `app.hubsell.vn/login`.
4. Nối Shopee (callback backend → redirect theo `fe` trong state = `.vn`).
5. payOS: tạo yêu cầu nâng gói → returnUrl `.vn` (xem trong link thanh toán).

Lỗi ở đây → trả `APP_FRONTEND_URL` về `.tech` (5 phút), chưa bật 301 nên khách không ảnh hưởng.

### 3.5 Bật 301 — Vercel → project → Domains → Edit → Redirect to

- `hubsell` : `app.hubsell.tech` → `app.hubsell.vn` (mã 308/301, giữ đường dẫn).
- `hubsell-landing` : `hubsell.tech` → `hubsell.vn`. (`www.hubsell.tech` không gắn project nào — không cần.)
- Kiểm ngay: `curl -sI "https://app.hubsell.tech/channels/tiktok/callback?code=x&state=y"` phải trả `Location: https://app.hubsell.vn/channels/tiktok/callback?code=x&state=y`. Không giữ query → **tắt 301 ngay**, vì callback TikTok phụ thuộc điều này.

### 3.6 Dải nhắc trong app — ✅ mã xong 14/10

`frontend/src/components/auth/domain-move-notice.tsx` gắn trên form `/login`: chỉ hiện ở host `app.hubsell.vn`, một câu "đã chuyển sang app.hubsell.vn, đăng nhập lại một lần", nút Bỏ qua = không hiện lại (localStorage), tự tắt sau 30/11/2026 (mốc tự chọn). Đã soi local sáng/tối/mobile, chữ 14px.

**17/10: anh Trung chốt gỡ hẳn** ("bỏ luôn đi không cần nữa") — xóa tệp + chỗ gắn trên `/login`.

### 3.7 Dọn chữ còn sót

- ✅ 14/10 `hubsell-mobile/src/app/no-access.tsx` đổi chữ sang `.vn` — đi cùng bản mobile KẾ TIẾP, **không nộp build mới khi Apple đang xét** (reset hàng đợi).
- Bỏ cụm "(và hubsell.tech)" trong Điều khoản khi 301 ổn định (đổi ngày cập nhật + `TERMS_VERSION`); Search Console khai Change of Address.

**Không làm:** đưa backend về `api.hubsell.vn` (phải khai lại callback + webhook 3 sàn và payOS, khách không được lợi gì).

## 4. Hậu kỳ

- **Nhật ký buổi cắt 14/10/2026 (09:00–09:30):** Render env anh đổi 2 service → backend redirect Google callback về `.vn` (kiểm header Location) → Vercel landing: biến `NEXT_PUBLIC_APP_URL` cũ loại Secret không đổi sang Config được → xóa, tạo lại loại Config (Production + Preview) → Redeploy không cache → `/register?ref=` sang `app.hubsell.vn`, 25 link app trên trang chủ đều `.vn` → redirect 307 hai domain (chọn 307 thay 301 vì trình duyệt không cache, lùi được tức thì) → curl: `/channels/tiktok/callback?code&state`, `/ads/tiktok/callback?auth_code&state`, `/login?social&token`, `/register?ref`, `/terms` đều giữ nguyên path + query. `www.hubsell.tech` không gắn project, không phân giải — bỏ. CHƯA tự tay thử: quên mật khẩu, nối Shopee, payOS returnUrl trên `.vn` (cùng biến `APP_FRONTEND_URL` đã kiểm) — anh thử khi tiện.
- **Đổi 307 → 308** ở Vercel Domains (cả hai project) sau ~1 tuần không sự cố, để Google chuyển hẳn thứ hạng sang `.vn`.
- Vercel Hobby Deployment Storage 9,81/10 GB (14/10) — dọn preview cũ nhánh `claude/*` để deploy không bị chặn.
- Giữ gia hạn `hubsell.tech` + 301 tối thiểu 12 tháng; `dev@` / `support@hubsell.tech` giữ làm bí danh nhận thư cùng thời gian đó.
- Website URL hiển thị trên Console Shopee (app 2040029 + Hubsell Ads 2044679), Lazada ISV 142085, TikTok Shop: đổi sang `https://hubsell.vn` khi có dịp sửa hồ sơ app (dời từ chặng 3, xem 3.1). Cùng dịp: thêm Redirect URL `.vn` cho TikTok Ads + TikTok Shop rồi mới đổi `TIKTOK_ADS_REDIRECT_URI` / `TIKTOK_REDIRECT_URI`.
- Đổi email đăng ký ở từng cổng đối tác (Shopee, TikTok, Lazada, payOS, Render, Vercel, Supabase) sang `dev@hubsell.vn` TRƯỚC khi bỏ `.tech`. Tài khoản HQ trong app cũng đang là `dev@hubsell.tech`.
- DMARC nâng từ `p=none` lên `quarantine` sau vài tuần báo cáo sạch.

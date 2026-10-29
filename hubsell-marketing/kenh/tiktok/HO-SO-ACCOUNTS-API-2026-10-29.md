# Hồ sơ TikTok Accounts API Access Application + scope Business Comment (29/10/2026)

**Em soạn, ANH nộp trên Chrome.** Nguồn kỹ thuật: khảo sát 12/10 `docs/TIKTOK-BINH-LUAN-VIDEO-KHAO-SAT.md` (Accounts API v1.3: `/business/comment/list/`, `/business/comment/reply/create/`, webhook COMMENT; scope TikTok Accounts 18000000 › Business Media 18020000 + Business Comment 18030000: Get 18030100 / Manage 18030200; từ 20/03/2026 phải điền *Accounts API Access Application Form* trước khi xin scope). Đích mới (25/10): **trả lời bình luận dưới video TikTok của tài khoản Hubsell / anh Trung, kéo khách về Zalo OA Hubsell** — không phải tính năng cho khách thuê bao ở bước này.

Lưu ý trước khi nộp:
- Form nằm trong cổng developer TikTok for Business (My Apps → app → Authorization → Scope of permission → TikTok Accounts → link form). Tên trường có thể khác bản nháp dưới; anh ghép ý vào đúng ô.
- Em đề xuất nộp trên **app Hubsell Ads hiện có** (App ID `7686282112950747157`, đã duyệt, đang chạy GMV Max) — thêm scope nhanh hơn tạo app mới. ⏳ anh xác nhận (câu hỏi 5 trong tệp tuần 1).
- Điền tiếng Anh (bản dưới), kèm bản Việt để anh đọc. Không hứa tính năng chưa có; không nói "official partner".
- Sau khi nộp: lưu **nguyên văn** email TikTok trả lời vào mục "Nhật ký" cuối tệp. Lịch nhắc kiểm: 10/11/2026 08:30.

---

## 1. Thông tin công ty / developer

| Trường | Giá trị |
|---|---|
| Company legal name | CÔNG TY TNHH CÔNG NGHỆ HUBSELL (Hubsell Technology Co., Ltd.) |
| Tax ID | 0111626360 |
| Country | Vietnam |
| Website | https://hubsell.vn (app: https://app.hubsell.tech) |
| Privacy policy URL | [KIỂM URL trên landing: https://hubsell.vn/… — anh dán link đúng] |
| Contact person / email | Nguyễn Văn Trung — [email công ty anh dùng với TikTok dev] |
| Developer app | Hubsell Ads — App ID 7686282112950747157 (Marketing API, GMV Max; đã go-live Shopee 17/09, TikTok duyệt app 12/10) |
| Current scopes | Ad Account Management, GMV Max (Marketing API) — [anh soi lại trang Scope để chép đúng tên] |
| Requested scopes | TikTok Accounts (18000000) › Business Media (18020000) · Business Comment (18030000) › Get Business Comment (18030100) + Manage Business Comment (18030200) |

## 2. Use case (English — dán vào ô mô tả)

> **Product:** Hubsell is a Vietnamese SaaS for e-commerce sellers (Shopee, TikTok Shop, Lazada) that tracks per-order net profit and manages TikTok GMV Max campaigns through the TikTok Marketing API (approved app 7686282112950747157).
>
> **What we want to build with the Accounts API:** a comment-management assistant for TikTok accounts **owned by our own company and our founder** (and, in a later phase, for sellers who already connect their shops to Hubsell). The assistant will:
> 1. Receive new comments on our own videos via the COMMENT webhook (`/business/webhook/update/`) and list them (`/business/comment/list/`, `/business/comment/reply/list/`).
> 2. Classify each comment (pricing question, how-to question, feedback, spam) with an LLM, and **draft** a reply. In the first phase every reply is reviewed and sent by a human from our console; later, only low-risk intents (pricing, how-to) are auto-replied, always with varied wording and rate-limited to avoid repetitive content.
> 3. Post the reply with `/business/comment/reply/create/`, typically inviting the user to continue on our official Zalo channel for personal support.
> 4. Hide obvious spam (`/business/comment/hide/`) after human confirmation.
>
> **Accounts to be managed:** initially 1–2 TikTok accounts (company account and founder's account), each authorizing the app individually through the standard TikTok account holder authorization flow. Expected volume: under 200 comments/day; API calls well within 40 QPM/account.
>
> **Data handling:** we store comment text, comment ID, video ID, author display name and timestamps only for the authorizing account's own videos, in a PostgreSQL database hosted in Singapore (Supabase) with row-level security, accessed by our backend on Render (Singapore). Access tokens are stored encrypted and can be revoked by the account holder at any time. Comment data is retained for 90 days and then deleted. We do not sell or share data with third parties, do not build user profiles of commenters, and do not contact commenters outside TikTok's reply function.
>
> **Why this helps TikTok users:** faster, more accurate answers to questions under educational videos about e-commerce profitability and ad spend, with a human in the loop and anti-spam controls (no identical mass replies).

## 3. Bản Việt (để anh đọc, không dán)

Sản phẩm: Hubsell là SaaS cho nhà bán Shopee/TikTok Shop/Lazada, tính lãi ròng từng đơn và quản lý chiến dịch GMV Max qua Marketing API (app đã duyệt). Xin Accounts API để làm trợ lý quản lý bình luận cho **tài khoản TikTok của công ty và của anh Trung** (sau mới mở cho khách đã nối gian): nhận bình luận mới qua webhook, phân loại bằng LLM, **soạn nháp** trả lời — giai đoạn đầu người duyệt và gửi; sau chỉ tự trả lời ý định rủi ro thấp, câu chữ đa dạng, có giới hạn tốc độ chống spam; trả lời thường mời khách sang Zalo OA chính thức; ẩn spam sau khi người xác nhận. 1–2 tài khoản, < 200 bình luận/ngày. Dữ liệu: chỉ bình luận trên video của tài khoản đã ủy quyền, lưu Supabase Singapore có RLS, token mã hóa, giữ 90 ngày rồi xóa, không bán/chia sẻ, không lập hồ sơ người bình luận, không liên hệ ngoài TikTok.

⚠️ Hai cam kết trong hồ sơ phải thành ràng buộc khi code: **giữ bình luận 90 ngày** và **token mã hóa** — ghi vào thiết kế `hubsell-sales/` tuần 2.

## 4. Câu trả lời sẵn cho các ô hay gặp

| Ô | Trả lời |
|---|---|
| Do you serve third-party businesses (agency/SaaS) or only your own accounts? | Both: our own accounts first; Hubsell is a SaaS, sellers may connect their own TikTok accounts later. Each account holder authorizes individually. |
| How will users authorize? | Standard TikTok account holder authorization URL → auth_code → `/tt_user/oauth2/token/`; redirect `https://app.hubsell.tech/…/` (https, trailing slash, no query). |
| Will you use automation to post comments? | Replies are drafted by AI but **reviewed by a human** in phase 1; in later phases only low-risk intents are auto-posted, with varied text, per-account rate limits, and a daily cap. No identical bulk replies. |
| Data retention | Comments 90 days; tokens until revoked; logs 30 days. |
| Security | Supabase Postgres (Singapore) with RLS on all tables; Render backend (Singapore); TLS everywhere; secrets in environment variables; access limited to platform admins with audit log. |
| Webhook endpoint | `https://[backend Render]/api/webhooks/tiktok-accounts/` — [điền khi dựng, tuần 2+] |

## 5. Việc kèm sau khi được duyệt

1. Probe bằng tài khoản anh: ủy quyền → `video/list` → `comment/list` → 1 lệnh reply thử → đăng ký webhook (callback Render).
2. Lát 0: bình luận → phân loại → nháp trong HQ, anh bấm gửi; câu trả lời kéo về OA.
3. Ghi lại rate limit thực tế và cảnh báo spam (docs: trả lời na ná hàng loạt sẽ bị ẩn).

## 6. Nhật ký nộp / trả lời

| Ngày | Việc | Kết quả |
|---|---|---|
| 29/10/2026 | Em soạn hồ sơ | chờ anh nộp |
| | | |

# Hạ tầng Hubsell có sẵn cho hệ Marketing-Sale: dùng lại được gì, thiếu gì (kiểm 03/11/2026)

Cách đọc: nguồn ghi dạng `đường dẫn:dòng`, tính từ gốc repo `D:\Claude Code\Hubsell`, theo cây làm việc 03/11/2026 (HEAD `ffdf9215`). Nhãn **[mã]** = em đọc mã hiện tại. **[memory]** hoặc **[PROGRESS]** = ghi chép cũ, chưa kiểm lại, chủ yếu số prod. Không kết nối prod: mọi số prod dưới đây là số đã ghi trong memory/PROGRESS, không phải số em đo. `hubsell-landing/` là repo git riêng, HEAD `e32b062` (22/10).

## 1. HQ CRM: giai đoạn khách, tự chuyển trạng thái, ConsultLead, SupportRequest, kênh báo chuyển người

### Takeaway
CRM đã có và đọc được, nhưng là CRM chăm chủ shop đã đăng ký: 5 trạng thái, chỉ 2 trạng thái tự chuyển theo tiền/hạn gói, không có giai đoạn phễu (nối gian, dùng thử, im lặng). Ghi chú 29/10 đúng phần lớn, sai một ý quan trọng: **HQ không có "chấm đỏ" toàn cục**, và **lead tư vấn mới không báo cho ai**.

### Cited Findings
**Trạng thái chăm sóc [mã]**
- 5 trạng thái `NEW / CONTACTED / ACTIVE / CHURN_RISK / CHURNED` — `backend/prisma/schema.prisma:2723-2729`. Hồ sơ 1-1 với chủ shop, tạo lười, có `assigneeId`, `note` (bản mới nhất), `statusSource`, `statusChangedAt` — `schema.prisma:2744-2768`. Chưa có hồ sơ = NEW ngầm định — `backend/src/routes/admin.ts:261-262`.
- Tự chuyển chỉ có 2 luật: thanh toán `amount > 0` → ACTIVE trong cùng giao dịch — `backend/src/services/care-auto-status.ts:11-14,110-149`, gọi tại `backend/src/services/subscription-service.ts:211`. Hết gói quá ân hạn → CHURNED mỗi 6 giờ — `care-auto-status.ts:15-18,168-259`, gọi tại `backend/src/workers/plan-hibernate.ts:46`.
- Quyết định tay sau hết gói thắng worker — `care-auto-status.ts:68-79`. Mọi lần tự chuyển ghi `platformAuditLog` action `care.auto` — `care-auto-status.ts:34,132-146`.
- `CONTACTED` và `CHURN_RISK` không có đường tự động: tìm trong `backend/src` chỉ thấy đếm `CHURN_RISK` ở `admin.ts:228`. Đặt tay qua `PATCH /api/admin/customers/:userId/care` — `admin.ts:443-445`.
- Sổ thao tác append-only dùng lại được — `schema.prisma:2896-2904` (chỉ chủ nền tảng đọc, theo memory `hubsell-platform-admin`).
- Prod: chưa kiểm được log `[care-auto]`; memory ghi "⏳ kiểm prod" từ 22/10, 155/160 khách từng kẹt ở Mới đăng ký trước khi có luật — **[memory]** `hubsell-hq-crm-trang-thai-tu-dong`.

**ConsultLead [mã]**
- Trường: `name`, `email` và `phone` đều bắt buộc, `source`, `status NEW/CONTACTED/CONVERTED/DROPPED`, `note`, `assigneeId`; không có `reply` — `schema.prisma:2823-2843`, `2771-2776`.
- Tạo qua `POST /api/public/consult-lead`, không JWT, chống phá 10 lead/IP/giờ bằng Map trong RAM (restart mất bộ đếm), honeypot, gộp trùng 24 giờ theo email hoặc SĐT — `backend/src/routes/public.ts:15-29,43-104`. `source` chỉ nhận 2 giá trị — `public.ts:62-63`.
- **Tạo lead không gửi bất kỳ thông báo nào** — `public.ts:89-100` chỉ ghi DB (ghi chú 29/10 không nêu điểm này). Sale chỉ thấy khi mở HQ.
- HQ tự khớp lead ↔ tài khoản theo email hoặc SĐT — `admin.ts:579-606`. `CONVERTED` là đặt tay, không tự chuyển — `admin.ts:647-649` (route PATCH; em không thấy đường tự động nào trong phần đã đọc).

**SupportRequest [mã]**
- `userId` bắt buộc, Cascade; `requesterName`, `content`, `phone?`, `status NEW/IN_PROGRESS/DONE`, `reply` (khách thấy), `note` (nội bộ), `assigneeId`, `attachments[]`, `customerSeenAt`, `doneAt` — `schema.prisma:2856-2890`.
- Tạo qua `POST /api/support-requests`, JWT khách — `backend/src/app.ts:248`; trần 5 phiếu mở/shop, 2.000 ký tự, tối đa 3 ảnh — `backend/src/routes/support.ts:26-31,197-205`.
- Báo HQ: email mọi platform admin — `support.ts:66-102`, lỗi chỉ log, khách không biết — `support.ts:99-101`. Trả lời: `PATCH /api/admin/support-requests/:id` — `admin.ts:822-824`, và email khách qua `notifyCustomerSupportUpdate` — `support.ts:109-147`.

**Đối chiếu ghi chú 29/10 (`HE-MARKETING-SALE-TUAN-1-2026-10-29.md` mục 3) với mã**
| Ý trong ghi chú | Kết quả | Mã hiện tại |
|---|---|---|
| `SupportRequest` ~2821, `ConsultLead` ~2788 | Đúng nội dung, lệch dòng | `schema.prisma:2856`, `:2823` |
| `userId` bắt buộc, trần 5 phiếu, email platform admin | Đúng | như trên |
| `ConsultLead` email + SĐT bắt buộc, 2 source, không có reply | Đúng | như trên |
| "Chưa có endpoint nội bộ khóa dịch vụ" | Đúng | xem câu 2 |
| Báo kỹ thuật bằng "email platform admin + **chấm đỏ HQ**" (mục 0 dòng 6, mục 2.6) | **Sai một nửa.** HQ chỉ có nhãn đếm "x chưa xử lý" / "x chưa gọi" trên tab bên trong trang Khách hàng — `frontend/src/app/admin/customers/page.tsx:178-199`. Mục sidebar không có huy hiệu — `frontend/src/components/shell/app-shell.tsx:319`. Tệp `backend/src/services/hq-mail.ts:4` ghi thẳng "HQ không có chuông nên email là kênh chạm tới điện thoại anh Trung". "Chấm đỏ" có thật là của KHÁCH trên avatar — `schema.prisma:2872-2873`, `support.ts:327`. | |

**Kênh chuyển người hiện có [mã]**
- Email qua `mailHq` — `hq-mail.ts:13`; có sẵn thư "Khách mới" — `backend/src/services/customer-mails.ts:136`. Tức một chiều, phụ thuộc Zoho (câu 5).

### Inferences
- Trạng thái CRM hiện không đủ làm "giai đoạn bán": muốn biết khách ở đâu trong phễu phải suy từ `Channel`, `Subscription`, `PackagePayment`, `lastActiveAt`, không phải từ `status`.
- Phương án phiếu A (nới `SupportRequest.userId` thành nullable) đụng `/mine`, email, HQ. Nếu A vẫn được chọn, phải sửa lại câu "chấm đỏ HQ" trong thiết kế: thông báo chuyển người phải là kênh mới, không phải có sẵn.
- ConsultLead không báo ai nghĩa là lead từ landing có thể nằm yên. Lỗ này nhỏ, sửa được độc lập với hệ mới.

### Gaps
- Chưa kiểm prod worker `[care-auto]` đã chạy chưa, phân bố trạng thái hiện tại ra sao.
- Số `ConsultLead`, `SupportRequest` thật trên prod: không có trong tài liệu đã đọc.
- Không thấy trường lịch sử giai đoạn hay ghi chú nhiều dòng; chỉ `note` bản mới nhất + sổ thao tác.

## 2. API nội bộ / khóa dịch vụ, và route đọc trạng thái khách theo email hoặc SĐT

### Takeaway
**Không có.** Không có route nội bộ, không có khóa dịch vụ, không có cửa đọc khách đúng theo email/SĐT cho máy gọi. Cái gần nhất là API HQ cho người dùng đăng nhập, nặng và tìm mờ. Phải thêm mã backend nếu hệ ngoài cần biết "lead này đã thành khách chưa".

### Cited Findings
- Tìm `/api/internal`, `x-api-key`, `SERVICE_KEY`, `INTERNAL_*`, `CRON_SECRET` trong `backend/src`: hit duy nhất là header gọi ra payOS — `backend/src/integrations/payos/client.ts:279`. **[mã]**
- Toàn bộ `/api/public` chỉ có 2 route ghi (`consult-lead`, `landing-event`), không có route đọc — `public.ts:43,129`, mount không JWT tại `app.ts:182`. **[mã]**
- Đọc khách gần nhất: `GET /api/admin/users?q=` — `admin.ts:256`, gác `requireAuth` + `requirePlatformPermission("hq")` ở mount — `app.ts:242` + lá `hq.customers`. Tìm `contains` trên tên/email/username/SĐT — `admin.ts:283-296`, phân trang OFFSET — `admin.ts:305`. Mỗi trang chạy thêm groupBy tiền và đơn — `admin.ts:348-381`. Trả về đủ gói, hồ sơ chăm sóc, số gian, số đơn — `admin.ts:307-342,387-405`. **[mã]**
- JWT có hạn (`TOKEN_EXPIRES_IN`) — `backend/src/middleware/auth.ts:48`; quyền HQ đọc cờ tươi mỗi request — `auth.ts:184-200`. **[mã]**
- Khuôn xác thực máy với máy đã có: webhook sàn kiểm chữ ký — `backend/src/routes/webhooks.ts:311,395,479,557`. **[mã]**
- `/health` công khai — `app.ts:154`. **[mã]**
- Quy tắc khớp SĐT đã có: `normalizeVnPhone` ra E.164 khớp `User.phone` — `public.ts:33-38`; `User.phone` nullable — `schema.prisma:203`. **[mã]**

### Inferences
- Dùng JWT người HQ cho máy là sai cách: token hết hạn, gắn với một người, trả dữ liệu thừa, gây tải groupBy. Không nên làm kể cả tạm thời.
- Việc tối thiểu cần thêm là một route đọc riêng: khớp chính xác email hoặc E.164 (đi index), trả tối giản (`đã có tài khoản`, `gói`, `isTrial`, `hạn`, `số gian`, `đã trả tiền`, `trạng thái chăm sóc`), khóa dịch vụ, ghi audit. Theo định hướng 25/10 "đọc qua API HQ, không join DB" — `PHAN-BIEN-HE-MULTI-AGENT-MARKETING-SALE-2026-10-25.md:92`.
- Nhiều khách đăng ký Google không có SĐT (memory 09/10, `admin.ts:270-272`), Zalo OA không trả SĐT theo mặc định (ghi chú 29/10): tỷ lệ khớp được sẽ thấp. Đây là giới hạn dữ liệu, không phải giới hạn API.

### Gaps
- Chưa rõ `User.email` có index dùng được cho tra cứu chính xác không phân biệt hoa thường; chưa đọc phần này của schema.

## 3. Mã AI trong repo: Trợ lý AI, Trợ lý Chat, mô hình, cách gọi Claude, nguồn kiến thức, kiểm soát chi phí

### Takeaway
Chỉ có **hai điểm gọi Claude**, một cái đang ẩn và viết cho vai CSKH của shop, cái kia đọc hóa đơn nội bộ. "Trợ lý Hubsell" trong app **không phải AI**. Dùng lại được khuôn gọi Claude (structured output, cache), **không dùng lại được prompt, kiến thức, hay kiểm soát chi phí (vì không có)**.

### Cited Findings
- SDK `@anthropic-ai/sdk ^0.116.0` chỉ ở backend — `backend/package.json:21`. Chưa có pgvector/embedding: tìm trong `schema.prisma` và `backend/src` không ra. **[mã]**

**Copilot CSKH (Trợ lý Chat) [mã]**
- `backend/src/integrations/ai/copilot.ts`. Khóa `ANTHROPIC_API_KEY`, mô hình `COPILOT_MODEL`, mặc định `claude-opus-5` — `copilot.ts:12-15,73`. Gọi một lượt, `max_tokens: 2048`, `effort: "low"`, `format: json_schema`, `cache_control` trên system — `copilot.ts:82-96`. Xử lý `refusal` — `copilot.ts:101-103`.
- Prompt viết cho **nhân viên shop trả lời người mua**: xưng "shop", mở đầu "Dạ", intent `SIZE_ADVICE/STOCK_CHECK/GENERAL` — `copilot.ts:18,27-36`.
- Kiến thức = khối ngữ cảnh sản phẩm do **trình duyệt dựng rồi gửi lên** — `copilot.ts:7-8,74-80`, `frontend/src/components/operations/chat-page.tsx:76-80`.
- Route: `POST /api/operations/copilot-suggest` — `backend/src/routes/operations.ts:1221`, gác JWT + quyền `operations` + `requirePlanUnlocked` + `requireChannel` — `app.ts:273`. Thiếu khóa → 503 `NO_AI_KEY` — `operations.ts:1228-1233`. FE rơi về engine luật — `chat-page.tsx:79-80`.
- Đang ẩn: `hidden: true` ở sidebar với lý do "chat Shopee mất từ 16/09, TikTok cần ≥1.000 gian, Lazada chưa có nhóm IM" — `frontend/src/components/shell/app-shell.tsx:188-196`. Trang vẫn còn — `frontend/src/app/operations-assistant/chat/page.tsx:3`. Memory `hubsell-delivery-fail-plan` (12/10) khớp mã. Cứu đơn cũng ẩn bằng cờ theo memory này; em không kiểm lại từng cờ.

**HQ đọc hóa đơn đầu vào [mã]**
- `backend/src/integrations/invoice/input-invoice-reader.ts`. Khóa riêng `ANTHROPIC_API_KEY_HQ`, "workspace riêng trong console, trần chi tiêu riêng" — `:9-12,243`. Mô hình `HQ_INVOICE_MODEL`, mặc định `claude-sonnet-5` — `:262`. `max_tokens 2048`, `output_config`, `cache_control` — `:281-286`. XML đọc bằng parser thuần, không tốn AI — `:5-7`.

**Trợ lý Hubsell `/api/assistant` [mã]**
- Tầng luật thuần: từ khóa không dấu → template + số Prisma, tầng LLM đang gác — `backend/src/routes/assistant.ts:2-13,986,1065,1079`. Gác JWT, `adminOnly`, `requirePlanUnlocked` — `app.ts:337`. Không dùng được cho khách chưa đăng ký.
- **Trùng tên với persona đề xuất.** Chính sách công khai nêu tên "Trợ lý Hubsell" là bộ hỏi đáp "đối chiếu theo quy tắc từ khóa" — `hubsell-landing/src/app/privacy/page.tsx:173-176`. Đoạn này được thêm để trả lời Apple tháng 10 về chia sẻ dữ liệu cho AI bên thứ ba — **[PROGRESS]** `PROGRESS.md:1720-1722`. Landing cũng có khối "Trợ lý AI" — `hubsell-landing/src/components/landing/ai.tsx`.

**Kiểm soát chi phí [mã]**
- Tìm `usage.`, `input_tokens`, `cache_read`, `rateLimit` trong `integrations/ai`, `input-invoice-reader.ts`, `admin-input-invoices.ts`: **không có kết quả**. Không ghi token, không có hạn mức theo khách, không có giới hạn tốc độ riêng ở route copilot.
- Biện pháp duy nhất: tách khóa theo workspace với trần ở console (`input-invoice-reader.ts:9-11`) và `max_tokens`. `backend/.env.example` không liệt kê biến `ANTHROPIC_*`. Tên biến khác đã có: `SMTP_*`, `MAIL_FROM*`, `TIKTOK_ADS_*`.

**Nguồn kiến thức có thể nạp [mã, kiểm sự tồn tại]**
- Định vị + bảng khả năng từng sàn: `docs/marketing/DINH-VI-LAI-HUBSELL-QUANG-CAO.md`. Bối cảnh: `hubsell-marketing/.agents/product-marketing.md` (v4, chưa commit). `docs/` có 71 mục. Trang hướng dẫn: `frontend/src/app/guide/`. Landing: `hubsell-landing/src/app/{ho-tro,bang-gia,an-toan,tinh-nang}`.
- Khung 4 lớp chỉ là khung, **chưa có nội dung** — `hubsell-marketing/chien-luoc/KHUNG-4-LOP-NHAN-VAT-BAN-0.md:3,136`. Không có mẫu hội thoại: thư mục `hubsell-marketing/khach-hang/` không tồn tại.

### Inferences
- Không nên "bật lại" Trợ lý Chat: sai đối tượng, gắn với gian và gói. Dùng lại khuôn kỹ thuật, viết prompt mới.
- Hệ mới cần key/workspace riêng theo tiền lệ `ANTHROPIC_API_KEY_HQ`, và phải tự làm ghi token + trần chi, vì repo không có gì để thừa kế. Mô hình mặc định `claude-opus-5` của copilot không nên chép sang: ghi chú 25/10 định Haiku phân loại + Sonnet chat — `PHAN-BIEN…:122`.
- Tên "Trợ lý Hubsell" cho bot dùng Claude sẽ **đụng câu chữ chính sách bảo mật** và lời đã trả lời Apple. Hoặc đổi tên bot, hoặc sửa chính sách và tách rõ hai "trợ lý". Điểm này chưa được nêu trong tài liệu 25/10 và 29/10.

### Gaps
- `COPILOT_MODEL`, khóa Anthropic có đặt trên Render không: không kiểm (không đọc env).
- Chi phí Claude thực tế: ghi chú 29/10 ghi `[CHƯA CÓ SỐ]`, hiện vẫn chưa có — `HE-MARKETING-SALE-TUAN-1…:217`.
- Trần chi trong console Anthropic: không kiểm được từ repo.

## 4. Hàng đợi/worker, sự cố băng thông và OOM: hệ này có nên chạy ngoài Render và DB chính?

### Takeaway
Hạ tầng hàng đợi đáng tin về mặt dữ liệu nhưng **đang là chỗ đau nhất của hệ thống**, và anh đã chốt không sửa riêng trước đại tu. Kết luận của em: **chạy tách khỏi hai service Render chính và DB prod**. Chỉ thêm vào backend chính phần rất mỏng (một route đọc, một route tạo phiếu nếu được duyệt).

### Cited Findings
**Cấu trúc [mã]**
- pg-boss schema `pgboss`, 8 hàng đợi: `evt.order`, `evt.auth`, `evt.dead`, `stock.channel`, `stock.verify`, `stock.dead`, `invoice.issue`, `listing.copy` — `backend/src/lib/queue-config.ts:13-39`.
- Thêm hàng đợi = **thêm migration + thêm tên**, không tạo lúc chạy — `queue-config.ts:5-7`. API: `enqueue`, `upsertQueued`, `registerWorker`, `queueStats` — `backend/src/lib/queue.ts:162,180,244,301`.
- Khuôn đáng chép: ghi `webhook_events` cùng giao dịch với xếp việc, rồi trả 200 — `backend/src/services/webhook-inbox.ts:5-16`.
- `evt.order` mặc định 4 slot — `queue-config.ts:68`. Worker 2 kết nối pg-boss, web 1, trần phiên bộ gộp 30 cho mọi tiến trình — `queue-config.ts:49-60`. Prisma `connection_limit=5` — `backend/src/lib/prisma.ts:10-11`. Tách vai bằng `HUBSELL_ROLE` — `backend/src/workers/index.ts:2-11,54`.
- Có 29 worker trong `backend/src/workers/` (không tính test), gồm `onboarding-reminder`, `subscription-reminder`, `weekly-report`, `ads-daily-summary`, `health-watch`.
- Theo dõi bộ nhớ chỉ canh heap — `backend/src/lib/memory-watch.ts:5-12,24`.

**Sự cố gần đây [memory/PROGRESS, em không đo lại]**
- Web `hubsell-backend-sg` (Starter 512 MB) OOM 6 lần 01–03/11, heap chỉ 70–96 MB, RAM phình ngoài heap, chưa rõ gốc — `PROGRESS.md:11`, memory `hubsell-render-oom-web-va-bang-thong-worker-2026-11-03`.
- Băng thông tháng 11 sau 3 ngày: 24,71 GB trên 5 GB gói; worker 23,67 GB đường phẳng 250–300 MB/giờ; hóa đơn 10/2026 có 157,5 GB = 23,70 USD trong tổng 44 USD. Gốc nghi là SQL gửi sang Supabase, **chưa đo phía DB** — `PROGRESS.md:12-13`.
- Hàng đợi bền nghẽn lần 3 ngày 02/11: 2.147 việc `evt.order` chờ, đơn trễ 30–90 phút; một gian bị TikTok 429 chiếm hết 4 slot. Anh chốt **không sửa riêng, không restart** tới đại tu 5e — `PROGRESS.md:56-58`.
- 28/10 sập 502 do Supabase cạn Disk IO (pg-boss quét cả bảng + đếm gian); đã nâng Small, anh không vui vì tốn tiền — memory `hubsell-su-co-disk-io-supabase-2026-10-28`.
- Worker từng OOM 20–21/10 vì Bella Look — chỉ mục memory `hubsell-su-co-worker-oom-bella-look-2026-10-21` (em chỉ đọc dòng chỉ mục, chưa đọc tệp).
- Luật: không đề xuất nâng máy khi chưa tìm gốc — memory `feedback-tim-goc-truoc-khi-de-xuat-nang-goi`. Thiết kế phải chịu 50.000 khách, không gián đoạn seller, cấm vòng for tuần tự và mutex RAM — `feedback-thiet-ke-quy-mo-thuong-mai`.
- Quyết định có sẵn: thư mục riêng + Supabase project riêng — `PHAN-BIEN…:91-92`; ghi chú 29/10 đề xuất webhook ở Next.js route + Supabase Free — `HE-MARKETING-SALE-TUAN-1…:188`.

### Inferences
Lý do chạy tách, xếp theo độ nặng:
1. **Webhook Zalo đòi 200 trong 2 giây; không đáp có thể bị hủy đăng ký** (`HE-MARKETING-SALE-TUAN-1…:80`). Web chính vừa OOM 6 lần trong 2 ngày chưa rõ gốc: đặt webhook ở đó là gắn kênh bán với sự cố chưa giải.
2. **Chiều ngược lại:** thêm việc AI vào worker là thêm RAM và SQL vào tiến trình đang nghẽn, ảnh hưởng người bán đang trả tiền. Mọi byte SQL từ Render sang Supabase còn tính băng thông.
3. Đại tu 5e chưa tới và anh không muốn sửa riêng, nên chờ hạ tầng khỏe là chờ vô thời hạn.
4. Hội thoại khách, mẫu huấn luyện, dữ liệu đồng ý là nhóm dữ liệu khác hẳn đơn hàng; tách DB giảm phạm vi rủi ro cho RLS và hồ sơ ISV.

Mặt trái cần nói thẳng:
- Tách **không miễn** các luật quy mô: webhook vẫn phải ghi bền rồi xử lý sau, không RAM mutex.
- Nếu đặt thêm service trên cùng tài khoản Render thì băng thông vẫn có thể cộng vào cùng mức thu; cần kiểm trước khi chọn. Next.js trên Vercel + Supabase riêng tránh được điểm này nhưng có giới hạn thời gian chạy hàm.
- Hồ sơ TikTok đang viết "backend on Render", webhook "`[backend Render]/api/webhooks/tiktok-accounts/`" — `hubsell-marketing/kenh/tiktok/HO-SO-ACCOUNTS-API-2026-10-29.md:39,58`. Chọn tách thì phải sửa hồ sơ trước khi nộp.
- Không dùng lại được pg-boss của hệ chính từ ngoài. Hệ mới tự có hàng đợi (pg-boss riêng trên Supabase riêng, hoặc bảng + cron).

### Gaps
- Chưa có số `pg_stat_statements`, nên chưa biết băng thông worker đến từ đâu (đề xuất đo vẫn chờ anh — `PROGRESS.md:13`). Không ảnh hưởng hướng tách, nhưng ảnh hưởng khi tính thêm tải vào DB chính.
- Hạn mức của Supabase Free (tạm dừng khi ít hoạt động, số kết nối), giới hạn hàm Vercel, cách Render tính băng thông theo workspace: không có trong repo, không kiểm ở đây.
- Sức chịu của route đọc mới trên web chính: phụ thuộc gốc OOM chưa tìm ra.

## 5. Nhắn tin và thông báo: email (giới hạn Zoho), push, Telegram và kênh duyệt từ điện thoại

### Takeaway
Hiện chỉ có **email (một chiều, dễ bị Zoho chặn)** và **Expo push cho chủ shop (không có màn HQ, không có nút duyệt)**. Không có Telegram, không có Zalo. **Chưa có kênh nào để anh bấm duyệt từ điện thoại ngoài việc mở web HQ.**

### Cited Findings
**Email [mã]**
- `backend/src/lib/mailer.ts`: nodemailer SMTP, biến `SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM`, `MAIL_FROM_NOREPLY`, `MAIL_FROM_BILLING`, `MAIL_REPLY_TO_*` — `:14-18,49-64`. Mỗi lần gửi tạo transport mới, **không có hàng đợi, không có giãn nhịp** — `:20-28,76-90`.
- Mẫu thư đang có: chào mừng, nhắc nối gian, kích hoạt gói, nhắc gia hạn… — `backend/src/services/customer-mails.ts:83,147,170,214,252,310,373`.
- Nhắc nối gian: cửa sổ 24–48 giờ, gửi từ 8h VN, vé chống trùng, gửi 5 luồng, tắt bằng `ONBOARDING_REMINDER_OFF` — `backend/src/workers/onboarding-reminder.ts:8-20,31,39,47`.

**Giới hạn Zoho [memory]**
- Tối 29/10: ~200 thư trong vài phút → `550 5.4.6`, chặn **toàn bộ** thư gửi đi của hộp hệ thống, không tự mở sau 12 giờ; quên mật khẩu lỗi theo; mở bằng CAPTCHA tay 10:40 30/10. Bài học: ≤100 thư/lô cách ≥1 giờ, hoặc chuyển sang dịch vụ giao dịch — memory `hubsell-su-co-zoho-chan-gui-thu-2026-10-30`. 26 chủ shop chưa nhận thư đó — `hubsell-thu-nhac-khach-tu-dong`.

**Push [mã]**
- `backend/src/services/push.ts`: Expo Push, `sendPushToOwner(ownerId, …)` — `:16,53`, gọi từ `notify()` — `backend/src/services/notifications.ts:132,170`. Bảng `PushDevice` — `schema.prisma:3571-3585`. Kênh này theo **chủ shop**. App mobile không có màn HQ: tìm `platformWorkspace`, `isPlatformAdmin`, `/api/admin` trong `hubsell-mobile/src` chỉ thấy khai báo kiểu ở `src/types/api.ts`.
- OTA đã chạy từ 01/11 nên JS mobile sửa nhanh được — **[memory]** `hubsell-mobile-app`.

**Telegram, Zalo, kênh khác [mã]**
- Telegram: không có mã, chỉ một dòng mô tả trong trang cài đặt — `frontend/src/app/settings/other/page.tsx:17`. Zalo: chỉ là chữ mô tả và link. `frontend/src/components/shell/phone-nudge-band.tsx:22` ghi rõ không hứa SMS/Zalo tự động "vì chưa làm".
- Landing đang dẫn khách về **Zalo cá nhân** của anh — `hubsell-landing/src/lib/site.ts:41`, dùng ở `hubsell-landing/src/app/ho-tro/page.tsx:75`, `src/components/consult.tsx:236,298`.

**Công cụ ngoài backend**
- Tác vụ `mail-digest-hang-ngay` (07:30 mỗi ngày, đang bật) đọc Zoho + Gmail bằng IMAP, xếp ưu tiên P0–P4, mã ở `tools/mail-digest/digest.js` — xác nhận qua danh sách tác vụ 03/11. Chỉ chạy trên máy anh.

### Inferences
- **Không để hệ AI gửi thư qua SMTP chung**: một đợt quá tay từng làm hỏng cả quên mật khẩu của khách. Cần dịch vụ thư riêng hoặc địa chỉ riêng, kể cả thư báo nội bộ.
- Báo chuyển người bằng email + Zoho có rủi ro im lặng: `notifyHqSupportRequest` nuốt lỗi (`support.ts:99-101`), nên khi Zoho chặn thì không ai biết. Chuyển người phải có ít nhất một kênh độc lập với Zoho.
- Kênh duyệt từ điện thoại phải làm mới. Các đường có thể: bot Telegram (chưa có mã; nhanh, không phụ thuộc Expo), trang web riêng tối giản cho điện thoại, hoặc thêm màn trong app. Theo tệp 25/10 lát 0 nằm ở HQ — `PHAN-BIEN…:114`, nhưng HQ không có giao diện điện thoại được kiểm ở đây. Nên quyết định kênh này trước khi chốt nơi đặt lát 0.

### Gaps
- Giới hạn gửi chính thức của Zoho Mail Lite: chỉ có kinh nghiệm thực tế, không có số nhà cung cấp.
- HQ web dùng trên điện thoại tốt tới đâu: chưa kiểm. Môi trường có một skill tên `telegram-sales-bot`, ngoài repo, em không đọc.

## 6. Đo lường: Meta Pixel, UTM, nguồn đăng ký, `landing_event_daily`, phễu đăng ký, SQL trong `so-lieu/`

### Takeaway
Xác nhận: **không Pixel, không UTM, không lưu nguồn đăng ký**. Đo được phễu tổng (đăng ký → nối gian → trả tiền) và phân biệt web/app, nhưng **không biết khách đến từ đâu**. Số phễu tuy có SQL nhưng **chưa chạy trên prod**.

### Cited Findings
- Tìm `fbq`, `facebook.net`, `meta pixel`, `utm_`, `gtag`, `googletagmanager`, `ttq.`, `@vercel/analytics` trong `frontend/src`, `hubsell-landing/src`, hai `package.json`: **không có kết quả** về Pixel, UTM, Analytics. `layout.tsx` của cả hai không có `Analytics`. **[mã]**
- Lúc đăng ký backend nhận các trường đăng ký, `referralCode`, `client`; không có trường nguồn — `backend/src/routes/auth.ts:186-192`. **[mã]**
- `TermsAcceptance.source` chỉ phân biệt cách đăng ký: `register_form`, `register_app`, `google_register`, `google_login` — `auth.ts:192`, `schema.prisma:380`. **[mã]**
- Giới thiệu là dấu vết nguồn duy nhất: `User.referredById` — `schema.prisma:247-248`, `auth.ts:263,278`; HQ xem `GET /api/admin/marketing` — `admin.ts:2510-2511`. **[mã]**
- `landing_event_daily`: `(day, event, count)`, không lưu người/IP — `schema.prisma:2809-2816`. Chỉ 2 sự kiện `roas_tool_view`, `roas_tool_login_click`; đếm cộng dồn, 120 lượt/IP/giờ — `public.ts:114-127,143-146`. Landing gửi qua `/api/su-kien` — `hubsell-landing/src/lib/track.ts:6-16`, `src/app/api/su-kien/route.ts:12`; chỉ gọi ở máy tính ROAS — `src/components/landing/roas-calculator.tsx:70,153`. **[mã]**
- Không có mốc "bấm nối gian" hay "sàn trả thành công": tìm trong `backend/src` không ra; memory 09/10 cũng ghi "chưa làm". **[mã + memory]**
- `lastActiveAt` có, độ chính xác 6 giờ, gộp web và mobile; anh chốt không tách — `admin.ts:315-317`, memory `hubsell-platform-admin`.

**SQL `hubsell-marketing/so-lieu/` (đã đọc)**
| Tệp | Đo gì | Trạng thái |
|---|---|---|
| `SQL-SO-THAT-KHACH-HANG.sql` | 6 khối: phễu tổng, đăng ký theo tháng + nối gian 7 ngày, khách trả tiền + MRR, chi quảng cáo 30 ngày, cơ cấu sàn, giới thiệu | Chưa có kết quả |
| `SQL-LUOT-DEM-LANDING.sql` | Lượt mở + bấm trang ROAS theo ngày | Chưa có kết quả |
| `SQL-PHEU-KHACH-TU-VIDEO-1017.sql` | Từ 17/10: đăng ký → nối gian → nối TikTok → TKQC → cài app → trả tiền, tách web/app; đăng ký theo tuần. Tệp tự ghi: không tách được khách của video (`:4-5`). **Chưa commit** | Chưa có kết quả |
| `SQL-CA-THUC-TE-TRO-LY-QUANG-CAO.sql` + `KET-QUA-2026-10-25-…` | Ca shop ANO, không phải số khách | Có kết quả |

- "Anh vẫn nợ" 3 SQL đầu tính đến 02/11 — **[PROGRESS]** `PROGRESS.md:64`.
- Số đang có đều là lời báo hoặc đếm rải rác **[memory]**: gần 100 đăng ký tự nhiên từ video 1017 (anh báo, chưa đối chiếu), 62 chủ shop chưa nối gian (25/10), 227 chủ shop có email (29/10).
- 01/11: anh chưa chốt làm phần lưu nguồn đăng ký — `PROGRESS.md:70`. Kết luận cùng ngày: chưa nên chạy quảng cáo cài app vì không đo được — `PROGRESS.md:69`, memory `hubsell-video-tro-ly-tiktok-ads-1017`.

### Inferences
- Trước khi chạy quảng cáo, thiếu tối thiểu: giữ UTM/nguồn từ landing qua đăng ký vào DB, sự kiện chuyển đổi phía server, và Pixel/Conversions API nếu chạy Meta. Lưu nguồn đăng ký là việc nhỏ so với giá trị, lại phục vụ cả hệ Sales ("hội thoại này có ra đăng ký không").
- Dấu vết `landing_event_daily` chỉ trả lời "trang ROAS có ai mở", không tính được chuyển đổi. Không nên mở rộng nó thành hệ đo.
- Thêm Pixel phải đi cùng chính sách bảo mật và đồng ý cookie, chưa kiểm tình trạng hiện tại.

### Gaps
- Đo Vercel: hồ sơ thư mục nêu "Vercel analytics" là nguồn số (`hubsell-marketing/CLAUDE.md`) nhưng mã không cài. Không kiểm được dashboard Vercel.
- Số TikTok Analytics của video: chưa có — memory `hubsell-video-tro-ly-tiktok-ads-1017`.
- Đường đi của link giới thiệu từ landing sang form đăng ký: tìm `?ref` không ra, chưa lần tiếp.

## 7. Tích hợp marketing Facebook, Zalo, TikTok; API bình luận TikTok; hồ sơ `kenh/tiktok/`

### Takeaway
**Chưa có một dòng mã nào** cho Facebook, Zalo OA, TikTok Accounts API hay YouTube. Hồ sơ Accounts API đã soạn nhưng **chưa nộp**, còn ô trống, và có điểm cần sửa trước khi nộp. Thứ dùng lại được là khuôn OAuth TikTok Marketing API.

### Cited Findings
- Tìm `business/comment`, `business/video`, `tiktok-accounts`, `tt_user/oauth2`, `commentThreads`, `pages_manage`, `pages_messaging`, `openapi.zalo`, `zalo.me` trong `backend/src`, `frontend/src`, `hubsell-landing/src`, `hubsell-mobile/src`: hit duy nhất là link Zalo cá nhân ở `hubsell-landing/src/lib/site.ts:41`. **[mã]**
- Facebook: nút đăng nhập đã gỡ 09/09 — `frontend/src/components/auth/social-buttons.tsx:6`; mobile "Không Facebook (chưa nối)" — `hubsell-mobile/src/app/login.tsx:227`. **[mã]**
- Không có thư mục `hubsell-sales/`, `hubsell-oa/`, `hubsell-tro-ly-ban/`. Thư mục mức gốc: backend, certs, docs, frontend, hubsell-landing, hubsell-marketing, hubsell-mobile, scripts, tools. **[mã]**

**Dùng lại được từ TikTok Marketing API [mã]**
- `backend/src/integrations/tiktok-ads/{config,oauth,client}.ts`: cùng cổng `business-api.tiktok.com`; app được duyệt 17/09/2026; scope hiện tại chỉ đọc + loại video, "CHƯA xin nhóm Campaign" — `config.ts:4-14`. Token dài hạn lưu ở `TiktokAdsAuth.accessToken` — `schema.prisma:3783-3793`, ghi tại `oauth.ts:229`.
- `backend/src/lib/secret-box.ts` đã có mã hóa hai chiều, dùng cho hóa đơn, đăng nhập mạng xã hội — `secret-box.ts:1-14`, nhưng `integrations/tiktok-ads` và `integrations/hubsell-ads` không gọi nó (tìm theo tên module và tên hàm phổ biến).
- `docs/TIKTOK-ADS-XIN-QUYEN-CAMPAIGN.md` có sẵn, liên quan "sau này chạy ads" nhưng là chiến dịch **của khách**, không phải quảng cáo của Hubsell.

**Chat sàn [mã] — không phải kênh marketing**
- `backend/src/integrations/shopee/client.ts:1207,1234`, `lazada/client.ts:885,957`: nhắn người mua của shop, gắn với gian của khách, đang ẩn.

**Hồ sơ `hubsell-marketing/kenh/tiktok/HO-SO-ACCOUNTS-API-2026-10-29.md`**
- Nhật ký chỉ một dòng: "29/10/2026 | Em soạn hồ sơ | chờ anh nộp" — `:66-71`. Theo tệp chưa nộp; em không kiểm được cổng TikTok.
- Còn ô trống: URL chính sách bảo mật, email liên hệ, scope hiện tại, webhook — `:21,22,24,58`.
- Sai tên/lịch sử cần sửa: ghi "Hubsell Ads … đã go-live Shopee 17/09, TikTok duyệt app 12/10" — `:23`. Trong mã, app Marketing API tên "Hubsell", duyệt 17/09 — `tiktok-ads/config.ts:12`; memory `hubsell-tiktok-gmv-max-api` xác nhận cùng App ID. "Go-live Shopee" thuộc app Shopee Ads, là thứ khác.
- Cam kết sẽ thành ràng buộc: bình luận giữ 90 ngày, token mã hóa, chỉ platform admin + audit log, người duyệt ở giai đoạn đầu — `:39,47,55-57`.
- Rào: điền form Accounts API Access, xét duyệt không công bố tiêu chí; 40 QPM/tài khoản/endpoint; trả lời na ná hàng loạt có thể bị ẩn — memory `hubsell-tiktok-binh-luan-video`, `docs/TIKTOK-BINH-LUAN-VIDEO-KHAO-SAT.md:64-80`.
- Lưu ý mâu thuẫn trong ghi chú: 12/10 anh chốt "không nộp hồ sơ, không tự đề xuất lại", làm app riêng — memory `hubsell-tiktok-binh-luan-video:15`. Từ 25/10 hệ này chính là app đó (`PHAN-BIEN…:154`), nhưng câu "app riêng có phải developer app riêng không" vẫn chưa trả lời — `HE-MARKETING-SALE-TUAN-1…:203`.

**Nội dung**
- Bài đăng hiện là tay. Có nháp một lần chưa commit: `hubsell-marketing/kenh/facebook/NHAP-video-1031-dang-san-pham-nhieu-shop.md` (bài chính + 5 tiêu đề quảng cáo + 3 câu mở), tạo 03/11 13:14. Không có quyết định chạy quảng cáo đi kèm trong tài liệu đã đọc.
- 02/11 anh chốt tạm bỏ đăng bài nhóm, chưa có kênh thay thế — `PROGRESS.md:60-63`, `hubsell-marketing/.agents/product-marketing.md` Learnings v4 (chưa commit).

### Inferences
- Hồ sơ cam kết "tokens stored encrypted" trong khi token TikTok Ads hiện tại trông như lưu nguyên văn. Hệ mới phải mã hóa thật; nên sửa bản ghi này trước khi nộp nếu reviewer hỏi về toàn bộ app, không chỉ phần mới. Đây là suy luận từ tìm kiếm tên, chưa đọc mọi đường ghi token.
- Việc "AI trả lời bình luận và tin nhắn" phụ thuộc 2 phê duyệt bên ngoài chưa bắt đầu: OA xác thực, TikTok scope. Việc nặng code không phải nút cổ chai đầu tiên.
- Chỉ dựa vào dữ liệu 29/10, phần DM TikTok vẫn phải tay, đăng bài nhóm không tự động được: phạm vi "AI trả lời" giai đoạn đầu chỉ là bình luận TikTok và OA.

### Gaps
- Tài khoản TikTok của anh loại gì; OA đã tạo chưa: không có ghi nhận.
- Facebook Standard Access cho Page tự quản trị vẫn ⏳ — `HE-MARKETING-SALE-TUAN-1…:132`.
- Trang Hubsell trên kho app sàn: memory `hubsell-marketing-thu-muc` còn ⏳.

## 8. Câu hỏi mở 29/10 đã được trả lời chưa? Tuần 2 đã làm gì? Lịch 10/11 đã tạo chưa?

### Takeaway
**Không câu nào được trả lời, tuần 2 chưa bắt đầu, lịch 10/11 chưa tạo.** Không có dấu vết nào của hệ này sau ngày 29/10 trong PROGRESS, git, memory, hay danh sách tác vụ.

### Cited Findings
| Câu hỏi 29/10 (`HE-MARKETING-SALE-TUAN-1…:199-204`) | Trạng thái 03/11 |
|---|---|
| Persona "Trợ lý Hubsell" | Chưa trả lời. 25/10, 27/10, 29/10 đều ghi chưa chốt. Câu này giờ là nghĩa vụ luật theo tài liệu 29/10 (`:30-37`), nguồn thứ cấp ⏳ đối chiếu Công báo |
| Tên OA | Chưa trả lời |
| Phiếu A/B/C | Chưa trả lời, chưa sửa mã: `SupportRequest` không có `source`/`externalRef` — `schema.prisma:2856-2890` |
| Tên thư mục mã | Chưa trả lời, thư mục chưa tồn tại |
| App TikTok xin scope | Chưa trả lời |
| Gói OA | Chưa trả lời |

**Việc tay của anh**
- Hồ sơ Accounts API: chưa nộp theo nhật ký tệp (câu 7).
- 20–30 hội thoại mẫu: `hubsell-marketing/khach-hang/` **không tồn tại**; chỉ có dòng `.gitignore:52`.
- OA, xác thực, link bio, loại tài khoản TikTok: không có ghi nhận nào.

**Bằng chứng tìm kiếm**
- `PROGRESS.md` tìm Marketing-Sale/Zalo OA/Accounts API/`hubsell-sales`/persona: chỉ hit ở các phiên 25/10, 27/10, 29/10 (`:458-461`, `:573-574`, `:699-702`). Các dòng `:1720-1722` là "Trợ lý Hubsell" trong app, không liên quan.
- `git log -- hubsell-marketing`: commit mới nhất là `550e1533` lúc 08:56 29/10. Chưa commit: Learnings v4, `ke-hoach-90-ngay.html`, `kenh/facebook/`, `SQL-PHEU-KHACH-TU-VIDEO-1017.sql`, không dính đến hệ này.
- Tìm toàn git `zalo oa`, `hubsell-sales`, `tuan 2`: chỉ ra các commit tới 29/10.
- Memory `hubsell-he-marketing-sale-multi-agent` sửa lần cuối 29/10, dòng 39 vẫn liệt kê đủ câu chưa trả lời. Chỉ mục MEMORY.md ghi "⏳ anh chốt persona/OA + hội thoại; lịch 10/11 CHƯA tạo".

**Lịch nhắc**
- `list_scheduled_tasks` (03/11): **không có** tác vụ `hubsell-nhac-1011-he-marketing-sale-kiem-tiktok-oa` hay tác vụ nào fireAt 10/11/2026. Tác vụ hệ này duy nhất là `hubsell-nhac-2910-he-marketing-sale-tuan-1`, đã chạy 29/10, đang tắt.
- Tác vụ `hubsell-marketing-nhac-thu-hai` (kế tiếp 09/11) có trong prompt về ROAS và kế hoạch 90 ngày, tìm "Marketing-Sale", "Zalo OA", "Accounts" không ra: hệ này không được nhắc tự động ở đâu.
- Nội dung nhắc đã soạn sẵn tại `PROGRESS.md:461`.

**Lịch đề xuất**
- Tuần 2 theo đề xuất là 03–09/11, điều kiện "OA xác thực; anh gật persona + thư mục", chưa được duyệt — `HE-MARKETING-SALE-TUAN-1…:184-188`. Hôm nay là ngày đầu của khung đó, điều kiện vào chưa đạt.

### Inferences
- Lịch 3 tuần ban đầu đã trễ trên thực tế vì OA cần 2–7 ngày làm việc xác thực (`:163`) mà chưa khởi động. Chạy bóng cần tin thật trên OA, nên không thể bắt đầu trước đó.
- Không có lịch nhắc nên nếu không được nêu lại, các câu này sẽ tiếp tục treo. Tuy nhiên kế hoạch mới này có thể thay nhiều câu hỏi cũ. Nên hỏi lại gộp một lần, thay vì đuổi từng câu.

**Tóm tắt dùng lại / thiếu** (suy luận từ 8 câu trên)
| Dùng lại ngay | Dùng lại khuôn, phải viết mới | Chưa có gì |
|---|---|---|
| `ConsultLead` + tab HQ, `SupportRequest` + tab HQ (khách có tài khoản), `platformAuditLog`, bộ khớp lead ↔ user, `normalizeVnPhone`, mẫu thư nhắc nối gian, `SQL-PHEU-*`, luật quyền `hq.*` | Gọi Claude có schema + cache (`copilot.ts`), hộp thư webhook ghi-trước (`webhook-inbox.ts`), OAuth TikTok, `secret-box`, tách key theo workspace, chữ ký webhook | Khóa dịch vụ + route đọc khách; Zalo/FB/TikTok Accounts/YouTube; kênh duyệt điện thoại; Telegram; hệ thư tách khỏi Zoho; ghi token + trần chi AI; hàng đợi cho hệ mới; UTM + nguồn đăng ký; Pixel; nội dung 4 lớp; mẫu hội thoại; thông báo lead mới; số phễu prod |

### Gaps
- Câu trả lời có thể đã nói miệng trong phiên chưa ghi; em chỉ kiểm được repo, memory và tác vụ, không đọc lịch sử chat.
- Không kiểm được tình trạng thật ở cổng TikTok, OA Manager, developers.zalo.me.

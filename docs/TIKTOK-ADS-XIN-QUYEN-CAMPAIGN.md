# Hồ sơ xin thêm quyền CAMPAIGN cho app "Hubsell" — TikTok API for Business

Soạn 18/09/2026. Người nộp: anh Trung (tài khoản developer dev@hubsell.tech — CÔNG TY TNHH CÔNG NGHỆ HUBSELL).
App: **Hubsell** · App ID `7686282112950747157` · cổng https://business-api.tiktok.com/portal → My Apps.

## 1. Vì sao phải xin

App hiện có (duyệt 17/09/2026, mất 1 ngày): *Ad Account Information* · *GMV Max › Store management* · *GMV Max › Identity and
video* (gồm lệnh loại / khôi phục video) · *Reporting › GMV Max reports*.

Việc kế của Trợ lý quảng cáo TikTok — **gợi ý tạo quảng cáo từ ROI hòa vốn của từng sản phẩm** (tab "Hòa vốn sản phẩm" đã
live 18/09) — cần các endpoint app CHƯA có quyền:

| Endpoint (v1.3) | Tên trên docs TikTok | Hubsell dùng để |
|---|---|---|
| `GET /gmv_max/campaign/get/` | Get GMV Max Campaigns | Liệt kê chiến dịch Product + LIVE GMV Max (LIVE hiện chưa vào bảng) |
| `GET /campaign/gmv_max/info/` | Get the details of a GMV Max Campaign | Đọc ROI mục tiêu, ngân sách, danh sách sản phẩm, kiểu chọn video |
| `GET /gmv_max/bid/recommend/` | Get the recommended GMV Max ROI target and budget | Mức ROI + ngân sách SÀN gợi ý → so với hòa vốn của sản phẩm |
| `POST /campaign/gmv_max/create/` | Create a GMV Max Campaign | Nút "Tạo chiến dịch" từ gợi ý (khách bấm, không tự động) |
| `POST /campaign/gmv_max/update/` | Update a GMV Max Campaign | Nâng ROI mục tiêu khi đang đặt DƯỚI hòa vốn; chỉnh ngân sách |
| `POST /campaign/status/update/` | Update campaign status | Bật / tạm dừng chiến dịch theo lệnh của khách |

(Danh sách endpoint đã đối chiếu với mục lục "GMV Max" trên docs TikTok ngày 18/09/2026. Bảng *Appendix › Permission scope* công
khai của TikTok CHƯA liệt kê nhóm GMV Max → tên nhóm quyền chính xác phải đọc ngay trong cổng, xem mục 2. Riêng
`/campaign/status/update/` thì bảng đó ghi rõ: *Ads Management › Campaign › Create and Update Campaigns* (scope 201); đọc chiến
dịch thường là *Read Campaigns* (scope 200).)

**KHÔNG xin / không dùng:** `exclusive_authorization/create` (đổi tài khoản quảng cáo độc quyền của shop = dừng toàn bộ chiến
dịch của tài khoản cũ) — Hubsell không bao giờ gọi. Nếu cổng gộp nó chung nhóm thì vẫn tick nhóm đó, nhưng code không gọi.

## 0. TRẠNG THÁI

✅✅ **ĐÃ DUYỆT 19/09/2026** (nộp 18/09 tối → duyệt trong chưa đầy 1 ngày, không bị hỏi thêm, không đòi minh họa). Cổng hiện
"Your scope of permission changes have been approved"; cây quyền: Ad account management 1 · Ads management 4 · Reporting 1.
→ Làm mục 6.

**Đã kiểm 19/09 (mục 6.1):** token nhà cấp 17/09 (trước khi duyệt) gọi `/gmv_max/campaign/get/`, `/campaign/gmv_max/info/`,
`/gmv_max/bid/recommend/` đều trả `40001 advertiser does not grant you <path>:GET permission` → token cũ KHÔNG tự có quyền mới,
mọi gian phải ủy quyền lại. Token cũ vẫn sống song song sau khi có token mới hơn (token probe 17/09 vẫn gọi được hôm nay dù prod
ủy quyền sau nó) → ủy quyền lại không làm chết token đang chạy. Script: `backend/scripts/tiktok-ads-campaign-probe.ts` (chỉ GET).
⚠️ ID scope trong `/oauth2/access_token/` là số 19 chữ số, `JSON.parse` làm tròn mất đuôi → ĐỪNG nhận diện quyền bằng ID scope;
nhận diện bằng cách gọi thử một endpoint đọc rồi lưu cờ có / không có quyền Campaign.
✅ 19/09 anh đã ủy quyền lại link probe → cả 3 endpoint ĐỌC chạy được (token mới có thêm scope `20`); shape thật ghi ở `docs/ADS-TIKTOK-GMV-MAX.md` mục 4 "Nhóm quyền CAMPAIGN". Mục 6.1 + 6.2 XONG. Còn: gian prod ủy quyền lại (khi có tính năng dùng tới), thiết kế gợi ý tạo chiến dịch, probe 3 lệnh GHI (chờ anh đồng ý).

✅ **ĐÃ NỘP 18/09/2026 tối** (Claude điền trong Chrome của anh Trung, anh xác nhận rồi mới bấm Submit): tick *Read campaigns* + *Create and update campaigns*, lý do = bản 496 ký tự ở mục 3b. Trang My Apps hiện: **Approved · Scope of Permissions Change Pending**. App vẫn Online, quyền cũ vẫn chạy trong lúc chờ. Lần xin đầu duyệt trong 1 ngày. ⏳ Chờ kết quả → làm mục 6.

## 1b. ĐÃ ĐỌC TRONG CỔNG 18/09/2026 (tên quyền chính xác — khỏi dò lại)

Cây quyền của app (App Detail → Authorization → Scope of permission, bấm cây bút để sửa):

- **Ads management → Campaign → Read campaigns**: `/campaign/gmv_max/info/` · `/gmv_max/bid/recommend/` · `/campaign/quota/info/`
  · `/campaign/spc/quota/get/` · `/smart_plus/campaign/get|review|copy/task/check/` (+ `/campaign/get/` … theo bảng công khai, scope 200).
- **Ads management → Campaign → Create and update campaigns**: `/campaign/gmv_max/create/` · `/campaign/gmv_max/update/` ·
  `/business/spark_ad/create/` · `/smart_plus/campaign/create|update|status/update|copy/task/create/` (+ `/campaign/status/update/`
  theo bảng công khai, scope 201).
- **Ads management → GMV Max** KHÔNG có mục "Campaign". Các mục con: *Exclusive authorization* (không xin) · *Store management* ✓ ·
  *Identity and video* ✓ · *Session* (`/campaign/gmv_max/session/*`) · *Custom anchor* · *changelog* (`/gmv_max/campaign/changelog/get/`).
- `/gmv_max/campaign/get/` KHÔNG xuất hiện trong ô tìm của cây quyền ("No data") → không biết thuộc mục nào; nhiều khả năng đi
  theo Read campaigns — probe sau khi duyệt.
- Ô lý do giới hạn **500 ký tự** (đoạn dài ở mục 3 không dán vừa — dùng bản rút gọn 496 ký tự ở mục 3b).

→ Chỉ cần tick ĐÚNG HAI mục: **Read campaigns** + **Create and update campaigns**.

## 2. Bấm ở đâu

1. Đăng nhập https://business-api.tiktok.com/portal bằng tài khoản developer (KHÔNG phải tài khoản quảng cáo cá nhân — máy anh
   hay tự điền `user9272487416588`, nhớ kiểm góc phải trên).
2. **My Apps → Hubsell → App Detail → Authorization → Scope of permission** → nút sửa / "Apply for more permissions".
3. Tick thêm:
   - Trong cụm **GMV Max**: mọi mục con liên quan tới **Campaign** (tên thường thấy: *Campaign management* / *Campaign* —
     đọc + tạo + sửa) và mục chứa **bid / ROI recommendation** nếu tách riêng. Hai mục đang có (*Store management*, *Identity
     and video*) giữ nguyên.
   - Trong cụm **Ads Management → Campaign**: *Read Campaigns* và *Create and Update Campaigns*.
   - KHÔNG cần: Ad Group, Ad, Audience, Pixel, Catalog, Creative, TCM… (xin thừa dễ bị hỏi lại).
4. Ô mô tả lý do / use case: dán đoạn tiếng Anh ở mục 3. Nếu có ô riêng cho từng quyền thì dán đoạn tương ứng ở mục 4.
5. Nộp. Lần trước duyệt trong 1 ngày. Có kết quả (kể cả bị từ chối / bị hỏi thêm) báo em để ghi lại.

Anh chụp giúp em màn hình danh sách quyền trong cụm GMV Max trước khi tick — em ghi tên chính xác vào docs để lần sau khỏi dò.

## 3. Đoạn mô tả chung (dán nguyên văn, tiếng Anh)

> Hubsell (https://hubsell.tech) is a multi-channel commerce management SaaS for Vietnamese online sellers (TikTok Shop, Shopee,
> Lazada). Our TikTok integration is already live with the scopes Ad Account Information, GMV Max Store management, GMV Max
> Identity and video, and GMV Max reports: sellers connect the ad account that runs GMV Max for their TikTok Shop, review
> campaign and video-level performance, and remove or restore under-performing videos from a campaign.
>
> We are requesting campaign-level permissions for GMV Max so that sellers can act on the break-even analysis Hubsell already
> provides. Hubsell computes each product's break-even ROI from the seller's settled TikTok Shop orders (real product cost,
> platform fees and refunds). With the requested permissions Hubsell will:
>
> 1. Read GMV Max campaigns and their settings (ROI target, budget, products, schedule) for both Product and LIVE GMV Max, so
>    the seller sees every campaign of the shop in one place.
> 2. Read TikTok's recommended ROI target and budget for a product, and show it next to the product's break-even ROI, so the
>    seller can choose a target that is both competitive and profitable.
> 3. Create a Product GMV Max campaign from that recommendation when the seller clicks "Create campaign" and confirms the ROI
>    target and daily budget.
> 4. Update the ROI target or budget of an existing GMV Max campaign when the seller confirms a change — typically raising a
>    target that is currently below the product's break-even ROI.
> 5. Pause or resume a campaign on the seller's request.
>
> Every write action is initiated and confirmed by the seller in the Hubsell UI; nothing is created or changed in bulk or
> without an explicit confirmation step. Each action is written to an audit log before the API call is sent and the result is
> recorded on the same entry, so sellers can always see who changed what and when. Hubsell only accesses ad accounts that the
> seller has authorized and only the TikTok Shops that belong to that seller; we re-verify the ad account's access to the shop
> before every write. We never call the exclusive-authorization endpoints on the seller's behalf. Our traffic stays well within
> the Basic rate limits: campaign data is synced on a schedule (every 1–6 hours per shop) and recommendation calls are made
> only when a seller opens a product.

## 3b. Bản rút gọn 496 ký tự (đúng ô "Please state your reason for updating permissions", tối đa 500)

> Hubsell is a commerce management SaaS for Vietnamese TikTok Shop sellers. Our GMV Max integration (store, identity/video, reports) is live. We compute each product's break-even ROI from settled orders. We need Campaign read/create/update to read GMV Max campaign settings and TikTok's recommended ROI and budget, and to let sellers create, edit or pause GMV Max campaigns from Hubsell. Every write is initiated and confirmed by the seller in our UI and audit-logged. No bulk or automatic changes.

## 4. Đoạn riêng cho từng quyền (nếu cổng hỏi từng mục)

- **GMV Max – campaign read** (`/gmv_max/campaign/get/`, `/campaign/gmv_max/info/`):
  > List the seller's Product and LIVE GMV Max campaigns and read their ROI target, budget and promoted products, to display them
  > in the Hubsell ads dashboard and compare each campaign's ROI target with the product's break-even ROI.
- **GMV Max – ROI / budget recommendation** (`/gmv_max/bid/recommend/`):
  > Show TikTok's recommended ROI target and budget next to the product's break-even ROI computed from settled orders, so the
  > seller can pick a profitable target before creating or editing a campaign.
- **GMV Max – campaign create / update** (`/campaign/gmv_max/create/`, `/campaign/gmv_max/update/`):
  > Create a Product GMV Max campaign, or change the ROI target / budget of an existing one, only when the seller clicks the
  > action and confirms the values in Hubsell. Every change is logged with the previous and new values.
- **Ads Management – Campaign (Read / Create and Update)** (`/campaign/status/update/`):
  > Pause or resume a GMV Max campaign at the seller's request from the Hubsell dashboard.

## 5. Nếu TikTok đòi minh họa (lần duyệt app TikTok Shop từng đòi ảnh + video)

Có sẵn trên prod, chụp là đủ: (1) tab **Hòa vốn sản phẩm** (bảng hòa vốn + cột Nhận định "Mục tiêu dưới hòa vốn"); (2) trang
chiến dịch TC054 (ROI mục tiêu · Hòa vốn · ROI thực + bảng video); (3) tab **Lịch sử** (sổ lệnh ghi trước khi gọi sàn, nhật ký
đổi thông số); (4) tab **Kết nối** (mỗi gian một tài khoản quảng cáo, có nút Gỡ kết nối). Phần "tạo chiến dịch" chưa có giao
diện → nếu họ đòi, em dựng màn hình thật (nút bị khóa vì chưa có quyền) rồi chụp, KHÔNG dựng ảnh giả.

## 6. Sau khi được duyệt — việc phải nhớ

1. **Token cũ nhiều khả năng KHÔNG tự có quyền mới** (kiểm ngay sau khi duyệt: gọi thử `/gmv_max/campaign/get/` bằng token nhà — lỗi thiếu quyền là đúng như dự đoán). Quyền gắn vào token lúc ủy quyền (`scope` trả về ở `/oauth2/access_token/`) → mọi gian
   đã nối phải **ủy quyền lại** (tab Kết nối → Kết nối lại). Hubsell cần: lưu `scope` của token vào `TiktokAdsAuth`, và hiện
   dòng "Kết nối lại để dùng tính năng tạo / sửa chiến dịch" cho gian còn token cũ. Hiện trên prod chỉ có and.not.or.
2. Probe ĐỌC trước bằng token nhà: `/gmv_max/campaign/get/` (cả LIVE), `/campaign/gmv_max/info/` của TC054,
   `/gmv_max/bid/recommend/` cho sản phẩm TC054 → ghi shape thật vào `docs/ADS-TIKTOK-GMV-MAX.md` mục 4 rồi mới thiết kế.
3. Lệnh GHI: mọi lệnh đi qua khuôn "ghi sổ trước, gọi sàn sau" (`send-command.ts`), có hộp xác nhận, không có chế độ tự động ở
   bản đầu. Trước khi viết lệnh tạo phải đọc kỹ ràng buộc "một sản phẩm chỉ nằm trong một chiến dịch Product GMV Max" và việc tạo
   chiến dịch mới có đụng chiến dịch đang chạy không.
4. Ghi kết quả ticket (ngày nộp, ngày duyệt / lý do từ chối, tên quyền chính xác) vào memory `hubsell-tiktok-gmv-max-api`.

## 7. TICKET HỎI TIKTOK — lệnh sửa chiến dịch bị từ chối qua API, sửa tay trên SELLER CENTER thì được (✅ ĐÃ GỬI 19/09/2026 — ticket **#4455484**, ✅ TIKTOK TRẢ LỜI 22/09/2026 — xem mục 7b)

**Dữ kiện (19/09/2026, gian nhà and.not.or):** `POST /campaign/gmv_max/update/` đổi `budget` của TC076 (đang tắt) → `40002 Shop must
belong to a Business Center account.` 3/3 lần. Cùng ngày anh Trung SỬA TAY ngân sách TC076 2.000.000 → 2.001.000 trên **SELLER CENTER**
(tư cách CHỦ SHOP) thì ĐƯỢC (API đọc lại ra 2.001.000, `modify_time` 2026-09-19 01:52:29 UTC). ⚠️ Seller Center ≠ tài khoản quảng cáo: API
của Hubsell đi bằng TÀI KHOẢN QUẢNG CÁO (tương đương Ads Manager) → lần sửa tay này CHƯA chứng minh tài khoản quảng cáo sửa được.
Phép thử còn thiếu: sửa ngân sách TC076 trong ADS MANAGER (ads.tiktok.com) bằng đúng TKQC 7230813704726609922 — Ads Manager cũng
không cho ⇒ chiến dịch tạo từ Seller Center không sửa được từ phía tài khoản quảng cáo (API chỉ phản chiếu điều đó); cho ⇒ giới hạn riêng của API.

★ **ĐÃ THỬ 19/09 (anh Trung chụp màn hình):** Ads Manager của đúng TKQC 7230813704726609922 mở mục GMV Max chỉ hiện trang chào "Grow your
sales with GMV Max — Create campaign", KHÔNG liệt kê chiến dịch TC nào (Seller Center thì có đủ 20). ⇒ chiến dịch GMV Max tạo từ SELLER
CENTER không quản lý được từ phía tài khoản quảng cáo: API ĐỌC được (report, info, campaign/get), loại / khôi phục video được, nhưng
SỬA chiến dịch thì không. Ticket vẫn nên gửi để TikTok xác nhận bằng văn bản + hỏi lệnh tạo / bật-tắt.
Loại / khôi phục video qua API (`/campaign/gmv_max/creative/update/`) vẫn chạy với đúng tài khoản + token này.

**Trạng thái:** anh Trung tự điền + bấm Submit 19/09/2026 (Claude điền hộ thì trình soạn thảo của cổng ticket làm treo tab — lần sau đưa
nội dung cho anh dán). Nhóm: Marketing API → General API Inquiry → Campaign Management. Mã ticket **#4455484**. Xem trả lời ở
business-api.tiktok.com/portal → Support → Ticket Platform → All tickets. Ô "Full request and response payload" bỏ trống (tùy chọn).
Phần mô tả gửi đi dùng "Fact 1–4 / Question A–D" (trình soạn thảo tự biến "1." / "a)" thành danh sách lồng nhau).

**Gửi ở đâu:** https://business-api.tiktok.com/portal → Support → Submit a ticket (đăng nhập tài khoản developer dev@hubsell.tech).

**Nội dung (tiếng Anh, dán nguyên văn):**

> Subject: /campaign/gmv_max/update/ returns 40002 "Shop must belong to a Business Center account" although the same ad account can edit the campaign in the UI
>
> App: Hubsell (App ID 7686282112950747157). Scopes approved on 2026-09-19 include Ads management > Campaign > Read campaigns and Create and update campaigns. The access token was re-authorized after the approval; the read endpoints /gmv_max/campaign/get/, /campaign/gmv_max/info/ and /gmv_max/bid/recommend/ all return code 0.
>
> Problem: POST /open_api/v1.3/campaign/gmv_max/update/ with body {"advertiser_id":"7230813704726609922","campaign_id":"1865537277522002","budget":2001000} returns
> {"code":40002,"message":"Shop must belong to a Business Center account."}
> request_id: 2026091909433524649A5FA30B9C677F29, 2026091909434990F655C80F26AF6A412B, 202609190946523DA1E3DE25002581E223
>
> Facts:
> 1. The ad account 7230813704726609922 holds the exclusive GMV Max authorization for the TikTok Shop 7494569560744626612 (/gmv_max/store/list/ returns exclusive_authorized_advertiser_info.advertiser_id = 7230813704726609922, is_gmv_max_available = true).
> 2. /gmv_max/store/list/ returns for this shop: is_owner_bc = false, store_role = AD_PROMOTION, store_authorized_bc_id = 7239164658173722625. /campaign/gmv_max/info/ for the campaign returns store_authorized_bc_id = 7147263165355589633.
> 3. In TikTok Ads Manager, the GMV Max section of this ad account shows only the welcome page ("Create campaign") and lists none of these campaigns, although the API returns all 20 of them via /gmv_max/campaign/get/ and /gmv_max/report/get/.
> 4. The shop owner can change the daily budget of this campaign manually in TikTok Shop Seller Center (done on 2026-09-19, modify_time 2026-09-19 01:52:29; the campaigns of this shop were created in Seller Center), and /campaign/gmv_max/creative/update/ works for this campaign's shop with the same token.
>
> Questions:
> a) What exactly does "Shop must belong to a Business Center account" require for /campaign/gmv_max/update/ — must the TikTok Shop be owned by (is_owner_bc = true) the Business Center that owns the ad account, or is partner access (AD_PROMOTION + exclusive GMV Max authorization) sufficient?
> b) Does the same requirement apply to /campaign/gmv_max/create/ and /campaign/status/update/?
> c) Can campaigns created in Seller Center be updated through the API at all?
> d) How can a developer detect in advance (from /gmv_max/store/list/ or another endpoint) whether update/create will be allowed for a given advertiser + shop, so we can explain it to the seller instead of failing?

**Sau khi có trả lời:** ghi NGUYÊN VĂN câu trả lời (kể cả "không được") vào mục này + memory `hubsell-tiktok-gmv-max-api`.

## 7b. TRẢ LỜI CỦA TIKTOK (ticket #4455484, 2026-09-22 08:22:21, Dag A. — Technical Product Specialist, MPO, North America and LATAM) — NGUYÊN VĂN

> Hello Nguyen
>
> Thank you for reaching out to TikTok for Developers Support. I will be happy to assist you with this issue you reported.
>
> We checked the three request IDs and confirmed that the requests are reaching the GMV Max backend successfully. The failure is caused by a Business Center authorization mismatch.
>
> The existing campaign is associated with Business Center 7147263165355589633, while /gmv_max/store/list/ shows the shop's current authorized Business Center as 7239164658173722625. The backend authorization check for the campaign's Business Center returns false, resulting in error 40002.
>
> This is not caused by the app scopes, access token, or the campaign having been created in Seller Center. To update this campaign through the API, the user and advertiser must have the required authorization under Business Center 7147263165355589633. Otherwise, the campaign may need to be recreated under the shop's currently authorized Business Center.
>
> For existing campaigns, we recommend comparing store_authorized_bc_id from /campaign/gmv_max/info/ with the value returned by /gmv_max/store/list/. A mismatch indicates that the campaign may not be editable through the API.
>
> If you have any other questions or require further clarification on this topic, you may reach back at any time and reopen the ticket if it has been closed.

(Ảnh chụp cổng ticket còn dòng tự động "Thanks for submitting your query. Our technical team is currently working on it and will get back to you soon." bên dưới — là dòng hệ thống của lần gửi, không phải thư thứ hai.)

**Đọc trả lời — trả lời được câu nào trong 4 câu đã hỏi:**
- (a) Điều kiện thật của 40002 = **BC của chiến dịch phải trùng BC mà shop đang ủy quyền cho tài khoản quảng cáo**. KHÔNG phải scope, KHÔNG phải token, KHÔNG phải vì tạo trong Seller Center → kết luận 19/09 "chiến dịch tạo từ Seller Center không sửa được qua API" là SAI NGUYÊN NHÂN, phải bỏ.
- (b) Lệnh create / status/update: TikTok KHÔNG trả lời thẳng; suy ra cùng một phép kiểm BC (chưa được xác nhận bằng văn bản).
- (c) Chiến dịch tạo từ Seller Center: sửa được qua API NẾU BC trùng (câu "not caused by ... created in Seller Center").
- (d) Cách biết trước: so `store_authorized_bc_id` của `/campaign/gmv_max/info/` với `store_authorized_bc_id` của `/gmv_max/store/list/`. Lệch ⇒ chiến dịch đó không sửa được qua API. Đây là phép kiểm rẻ, dùng được ngay.

**Probe CHỈ ĐỌC 23/09/2026 (Claude chạy, gian nhà and.not.or, token cấp 19/09 vẫn sống):**
- `/gmv_max/store/list/`: and.not.or `is_owner_bc false` · `store_role AD_PROMOTION` · `store_authorized_bc_id 7239164658173722625` (TIKTOK_ADS_1), độc quyền GMV Max = TKQC 7230813704726609922; DARKMAN STORE cũng ủy quyền BC 7239… nhưng `is_gmv_max_available false`.
- **22/22 chiến dịch** (20 PRODUCT_GMV_MAX + 2 LIVE_GMV_MAX, kể cả TC076 mới nhất) đều mang `store_authorized_bc_id 7147263165355589633` ⇒ mọi chiến dịch tạo trong Seller Center của gian này đều đứng dưới BC 7147…, không có cái nào dưới BC 7239….
- `/bc/get/` → 40001 "advertiser does not grant you /bc/get/:GET permission" (app chưa xin scope Business Center) → không tra được qua API anh Trung là thành viên BC 7147… hay không; phải xem tay ở business.tiktok.com.
- `/advertiser/info/` không trả `owner_bc_id` cho TKQC 7230… (chỉ tên, role ROLE_ADVERTISER, công ty PRECISE).
- Mã BC 7147… (sinh ~2022) CŨ hơn BC TIKTOK_ADS_1 7239… (~2023) và cũ hơn cả shop 7494… (~2025) ⇒ nhiều khả năng là một BC cũ của anh / công ty mà shop and.not.or đang là tài sản (owner), còn TIKTOK_ADS_1 chỉ được shop chia sẻ quyền chạy quảng cáo (AD_PROMOTION). Chưa xác nhận.

**Việc phải làm tay (anh Trung), trước khi code gì thêm:**
1. Vào business.tiktok.com, xem danh sách Business Center mà tài khoản anh là thành viên → có BC mã 7147263165355589633 không, tên gì, anh là Admin hay chỉ thành viên. Trong BC đó xem Assets → TikTok Shop: and.not.or có nằm đó không (và ở BC TIKTOK_ADS_1 shop này hiện dưới dạng "được chia sẻ").
2. Nếu anh là Admin BC 7147…: phương án rẻ nhất là cho TKQC 7230… có quyền dưới BC 7147… (chia sẻ tài khoản quảng cáo giữa 2 BC, hoặc ủy quyền lại GMV Max của shop cho một TKQC thuộc BC 7147…) rồi ủy quyền lại Hubsell → probe lại `update` budget +1.000 trên TC076 (đang tắt). Không tự làm khi chưa rõ: đổi BC độc quyền GMV Max có thể ảnh hưởng chiến dịch đang chạy (TC054, TC040 NEW, TC025 NEW, TC079).
3. KHÔNG tạo lại 4 chiến dịch đang bật dưới BC 7239… chỉ để API sửa được — mất lịch sử học của chiến dịch, đổi lấy một nút bấm.

**Hệ quả cho sản phẩm (đề xuất của Claude 23/09, chờ anh chốt):**
- Giữ hướng đã LIVE: Hubsell GỢI Ý bằng số thật, khách tự sửa trong Seller Center. Nút sửa / tạo qua API vẫn CHƯA code cho tới khi chứng minh được trên gian nhà (sau bước 2).
- Nên làm ngay vì rẻ và đúng lời TikTok: lưu `store_authorized_bc_id` của từng chiến dịch khi sync + so với BC của shop → cờ "sửa được qua API" theo từng chiến dịch; khi sau này có nút sửa thì chiến dịch lệch BC hiện đúng câu "Chiến dịch này thuộc Business Center khác, chỉ sửa được trong Seller Center" thay vì lỗi 40002.
- Ticket còn mở được ("reach back at any time"). Nếu sau bước 1 anh KHÔNG có quyền ở BC 7147…, hỏi tiếp một câu: vì sao Seller Center tạo chiến dịch dưới BC 7147… trong khi shop đang ủy quyền BC 7239…, và seller đổi cách nào. Chưa gửi.


## 8. XIN THÊM QUYỀN "GMV Max → Session" (anh Trung chốt 23/09/2026: xin để dành, CHƯA code tăng cường video)

**Vì sao:** nhóm `/campaign/gmv_max/session/*` (max delivery theo sản phẩm + creative boost theo video — `docs/ADS-TIKTOK-GMV-MAX.md` mục 11)
trả 40001 vì 18/09 chưa tick mục này. Anh chốt: xin sẵn, khi khách yêu cầu hoặc đối thủ có tính năng thì mới làm; chưa code gì.

**Bấm ở đâu:** như mục 2 (portal → My Apps → Hubsell → App Detail → Authorization → Scope of permission → sửa). Tick thêm đúng MỘT mục:
**Ads management → GMV Max → Session** (ô tìm: gõ `session`; endpoint hiện dưới tên `/campaign/gmv_max/session/*`). Giữ nguyên các mục đang có.
KHÔNG tick *Exclusive authorization*, *Custom anchor*. Anh tự điền + Submit (Claude điền hộ làm treo tab).

**Lý do (ô tối đa 500 ký tự — bản dưới 483 ký tự, dán nguyên văn):**

> Hubsell is a commerce management SaaS for Vietnamese TikTok Shop sellers; our GMV Max integration (store, video, campaign read, reports) is live. We request GMV Max Session access to read the max delivery and creative boost sessions of a seller's Product GMV Max campaigns, so our campaign overview shows which videos and products are already boosted and does not suggest a duplicate boost. Read-only first; any future write is seller-initiated, confirmed in our UI and audit-logged.

**Sau khi duyệt:** token cũ KHÔNG tự có quyền mới (mục 6.1) → khi nào bắt đầu code mới cần gian ủy quyền lại (tab Kết nối → Kết nối lại);
probe đọc `session/list/` trên TC054 bằng token nhà để ghi shape thật; ghi ngày duyệt vào memory `hubsell-tiktok-gmv-max-api`.
**Trạng thái: ✅ ĐÃ NỘP 23/09/2026 tối** (Claude điền trong Chrome của anh Trung sau khi anh đăng nhập; form scope KHÔNG treo tab như trình soạn ticket). Cây quyền sau khi tick: Ads management 5 (Campaign ✓ · GMV Max: Store management ✓ · Identity and video ✓ · Session ✓); 5 endpoint hiện thêm: `/campaign/gmv_max/session/create|update|delete|list|get/`. Cổng hiện "Your scope of permission changes are currently under review"; My Apps: **Approved · Scope of Permissions Change Pending**. App vẫn Online. Lần trước duyệt trong 1 ngày. ⏳ Có kết quả → ghi vào đây + memory.

**✅ ĐÃ DUYỆT 24/09/2026** (anh Trung chụp cổng business-api.tiktok.com/portal/apps/7686282112950747157: banner xanh "Your scope of permission changes have been approved"; cây quyền: Ad account management 1 · Ads management 5 · Reporting 1; API rate limiting vẫn **Basic**; redirect URL vẫn `https://app.hubsell.tech/ads/tiktok/callback`). **Anh chốt 24/09: XIN ĐỂ DÀNH, tạm thời KHÔNG dùng** — chưa code tăng cường video, chưa ủy quyền lại gian, chưa probe `session/list/`. Khi nào làm: gian ủy quyền lại (mục 6.1) → probe đọc trước → code theo `docs/ADS-TIKTOK-GMV-MAX.md` mục 11. Nhớ: chuyển tên miền .vn (chặng 3) phải đổi redirect URL ở cổng này TRƯỚC khi đổi env.

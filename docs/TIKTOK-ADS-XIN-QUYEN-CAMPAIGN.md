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

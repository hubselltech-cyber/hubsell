# Hubsell Ads — app "Ads Service" riêng trên Shopee Open Platform

Cập nhật 10/09/2026. Anh Trung chốt: tách hẳn thành app riêng tên **Hubsell Ads**,
làm gọn sạch, 3 shop nhà chịu ảnh hưởng chút trong lúc chuyển đổi cũng được.

## 1. Vì sao phải có app thứ hai

- Shopee cấp quyền theo **từng app**. App chính 2040029 khi tài khoản lên ISV
  (Third-party Partner Platform) tự đổi thành loại **ERP System** = "All API
  except Chat API and Ads API" → mất Ads API ngay khi được duyệt (≈24/09/2026).
- Shopee trả lời (ticket, xem `SHOPEE-ISV-HO-SO.md` mục 2): Ads API phải đi
  qua app loại **Ads Service** riêng → partner_id / partner_key thứ hai.
- Token Shopee gắn với cặp (partner_id, shop_id), **không đổi chéo được giữa hai
  app** dù cùng chủ. Vì vậy mỗi gian muốn dùng Trợ lý quảng cáo phải **ủy quyền
  thêm một lần** cho Hubsell Ads. Đơn, kho, tài chính vẫn chạy trên app chính,
  không đụng.
- Trạng thái ISV gắn với **tài khoản developer**, không gắn app: tạo app Ads
  Service dưới tài khoản đã ISV là mặc nhiên app bên thứ ba, **không phải nộp
  ISV lần nữa**. Vẫn phải qua **Go-Live** riêng của app đó.

## 2. Kiến trúc trong code (đã làm 10/09)

```
backend/src/integrations/hubsell-ads/
  config.ts   env HUBSELL_ADS_* → ShopeeConfig (dùng lại client Shopee, chỉ đổi cfg)
  oauth.ts    state ký JWT, URL ủy quyền, callback đổi code → ChannelAppAuth, gỡ liên kết
  token.ts    resolveShopeeAdsAccess() = ĐIỂM CHỐT DUY NHẤT cấp quyền gọi Ads API,
              refresh có mutex theo gian, cron lưới an toàn, trạng thái cho UI
backend/src/routes/hubsell-ads.ts
  /api/hubsell-ads/{status,auth-url,connect,link}   (JWT + ADMIN)
  /api/auth/hubsell-ads/callback                     (công khai, Shopee redirect về)
prisma: model ChannelAppAuth (channelId, app=HUBSELL_ADS) — token app phụ, tách khỏi
        token app chính trên Channel; mai sau Chat tách app chỉ thêm enum.
frontend/src/components/ads/hubsell-ads-link.tsx — thẻ mời kết nối / dải hết hạn /
        dòng xác nhận trên trang Trợ lý quảng cáo Shopee.
```

Nơi gọi Ads API đã chuyển sang điểm chốt: `ads-spend.ts`, `ads-campaigns.ts`,
`ads-auto-execute.ts`, ví ads ở `routes/ads.ts` + `ops-alerts.ts`. Worker
`order-auto-sync.ts` hỏi `hasShopeeAdsAccess()` trước, gian chưa nối thì bỏ qua
lặng lẽ (log một lần). Cron `token-refresh.ts` quét thêm bảng ChannelAppAuth.

### Cơ chế bật / tắt

| Env `HUBSELL_ADS_PARTNER_ID/KEY` | Hành vi |
|---|---|
| **Chưa đặt** (production hôm nay) | Trợ lý quảng cáo chạy bằng token app chính như trước. UI không hiện gì mới. |
| **Đã đặt** | Mọi gian Shopee PHẢI ủy quyền Hubsell Ads. Chưa nối → thẻ mời kết nối, nút Làm mới khóa, worker bỏ qua xung ads của gian đó. |

Env đầy đủ (xem `backend/.env.example`): `HUBSELL_ADS_PARTNER_ID`,
`HUBSELL_ADS_PARTNER_KEY`, `HUBSELL_ADS_ENV` (bỏ trống = theo `SHOPEE_ENV`;
đặt `sandbox` để test app Ads trong khi app chính đã production),
`HUBSELL_ADS_REDIRECT_URI` (bỏ trống = `<backend>/api/auth/hubsell-ads/callback`).

## 3. Việc phải làm trên Shopee Console (sau khi ISV duyệt)

> **17/09/2026 — app Hubsell Ads ĐÃ LIVE** (Go-Live nộp 15/09, Shopee duyệt).
> Các bước 1–3 dưới đây đã xong; còn bước 4 (đổi env Render sang key Live, bỏ
> `HUBSELL_ADS_ENV`) và 3 shop nhà ủy quyền lại — checklist chi tiết ở
> `ADS-SHOPEE-KHAI-THAC-API.md` mục 5. Cùng ngày: thẻ kết nối rút còn MỘT nút
> (chi tiết trong dấu hỏi), nêu mốc số ads đang đứng; Trung tâm điều hành +
> chuông có thẻ `ads-app-not-linked` / `ads-app-expired` cho gian Shopee **đang
> chạy ads** mà chưa nối / hết hạn (`detectHubsellAdsLinkGaps`), deep-link
> thẳng trang Trợ lý của gian đó; gian chưa từng chạy ads không bị réo.

1. Console → Create App: tên **Hubsell Ads**, loại **Ads Service**, redirect
   domain = domain backend Render (`hubsell-backend-sg.onrender.com`).
2. Lấy Partner ID / Key **sandbox** → đặt env trên Render với
   `HUBSELL_ADS_ENV=sandbox`, test ủy quyền một shop sandbox từ trang Trợ lý
   quảng cáo. (Sandbox không có số liệu ads thật — chỉ kiểm luồng ủy quyền +
   chữ ký.)
3. Nộp **Go-Live** cho app Hubsell Ads: dùng lại mô tả Trợ lý quảng cáo trong
   hồ sơ ISV + tài khoản `reviewer@hubsell.vn`. Hỏi kèm trong ticket: loại Ads
   Service có điều kiện xét duyệt bổ sung nào ngoài Go-Live thường không.
4. Go-Live xong: đổi env sang partner **production**, bỏ `HUBSELL_ADS_ENV` (theo
   `SHOPEE_ENV=production`). Từ lúc này 3 shop nhà (DarkMan, ANO, Hi.Bé) và
   khách mới đều thấy thẻ "Kết nối Hubsell Ads" trên trang Trợ lý quảng cáo.
5. Sau khi app chính bị đổi thành ERP System mà Hubsell Ads chưa Go-Live →
   khoảng trống số liệu ads là chấp nhận được (anh Trung chốt 10/09).

## 4. Luồng seller

1. Trang Trợ lý quảng cáo Shopee → chọn gian → thẻ "Kết nối Hubsell Ads" → bấm.
2. Shopee mở trang ủy quyền (luồng legacy `auth_partner` như app chính, cùng
   cờ `SHOPEE_AUTH_FLOW`). Seller đăng nhập đúng tài khoản gian → Đồng ý.
3. Callback đối chiếu `shop_id` **trước khi đổi code**: trùng gian đang chọn → nối
   gian đó; là gian Shopee **khác của cùng chủ shop** (17/09: chọn DarkMan mà đăng
   nhập ANO) → nối luôn gian kia, trang mở đúng gian vừa nối; shop_id không thuộc
   gian nào của chủ shop → báo lỗi rõ, không ghi token. Lưu ChannelAppAuth, redirect
   về `/ads/shopee?hubsell_ads=connected&channelId=<gian vừa nối>`.
4. Worker nhặt vé trong ≤20s → XUNG ads kéo cấu hình + số hôm nay + ví ngay; lịch sử 30 ngày ở lượt kế (adsBackfillPending).
5. Hết hạn refresh (30 ngày không gia hạn được) → dải vàng "kết nối lại".

Dev local: callback đăng ký là domain Render → Render bật `code + shop_id +
channelId` về `localhost:3000/ads/shopee?hubsell_ads=code`, FE gọi
`POST /api/hubsell-ads/connect` (cùng cơ chế trạm trung chuyển với app chính).

## 5. Kiểm chứng

- `backend/src/integrations/__tests__/hubsell-ads.test.ts`: fallback app chính khi
  chưa cấu hình, chặn khi chưa nối, đối chiếu shop_id, refresh token, hết hạn →
  DISCONNECTED, gỡ liên kết.
- Migration `20260910150000_channel_app_auth_hubsell_ads` — Render tự áp khi deploy;
  local đã chạy qua `scripts/apply-migration-local.ts` 10/09.

### Đã chạy thật trên SANDBOX tối 10/09/2026 (app tạo ngay, không đợi ISV)

App **Hubsell Ads** đã tạo trên Console: category **Ads Service**, Test Partner ID
**1243985**, Test Redirect URL Domain `https://hubsell-backend-sg.onrender.com`.
Key sandbox chỉ nằm trong `backend/.env` local (`HUBSELL_ADS_ENV=sandbox`,
`HUBSELL_ADS_REDIRECT_URI` trỏ Render để trạm trung chuyển bật code về local).

| Bước | Kết quả |
|---|---|
| Chữ ký partner 1243985 | Sandbox trả `invalid_code` cho code giả → key + host đúng |
| Ủy quyền shop sandbox 227774404 (OpenSANDBOX) | Trang `open.sandbox…/auth` hiện app Hubsell Ads → Confirm → Render relay → local đổi code → ChannelAppAuth ACTIVE |
| Ads API bằng token Hubsell Ads | `get_shop_info`, `get_total_balance`, `get_all_cpc_ads_daily_performance` đều `error:""` (số 0 vì sandbox không có ads) — danh sách quyền trống trên trang ủy quyền KHÔNG ảnh hưởng |
| Ép refresh | access_token đổi, refresh_token xoay, hạn mới ghi DB |

Ghi chú: link luồng CŨ (`auth_partner` ký sign) trên sandbox bấm đăng nhập đứng
im khi link đã quá 5 phút, không báo gì; link luồng MỚI (`/auth`) chạy ổn. Gian
test local `Sandbox Hubsell Ads` (channel `cmtvlfq5o0001trf0pi4wqsy5`, user
demo@hubsell.tech). Script tạm sinh link / probe / trạm bắt code nằm ở
`.claude-tmp/tools/_tmp_hubsell_ads_{probe,catcher}.ts` (gitignore).

Còn lại sau ISV duyệt: nộp Go-Live app Hubsell Ads, lấy Partner ID/Key **Live**
→ env Render, bỏ `HUBSELL_ADS_ENV`, 3 shop nhà ủy quyền lại trên trang Trợ lý.

## Trợ lý tự thực thi — máy làm gì cũng phải nói, và đảo lại được (14/09/2026)

**Sự cố:** 07:05 sáng 14/09 executor (mode live, gian ANO) tạm dừng campaign "Túi Đeo
Chéo Nam" đang lời (ROAS 7 ngày 19x) vì cửa sổ Hôm nay ROAS 4,96x < hòa vốn 6,63x
khi mới tiêu hơn 20.000₫ — đơn broad Shopee về trễ vài giờ (chiều cùng ngày 8,98x).
Seller không nhận được chuông, thẻ điều hành hay nhật ký nào (vòng quét chạy SAU
khi dừng nên rule engine hết verdict, máy tự xóa dấu vết). Sổ hành động ghi đúng
lệnh, cả 4 lệnh từ trước đến nay đều từ cửa sổ Hôm nay. Anh Trung chốt cùng ngày:

1. **Ngưỡng tiền gác cả hai nhánh Quy tắc 1** (`hard.zeroOrderSpend7d`, mặc định
   150.000₫): 0 đơn hay ROAS dưới hòa vốn đều phải tiêu đủ mức này; cửa sổ Hôm nay
   đòi ĐỦ (không nhân 0,2), 3d ×0,5, 30d ×1,5 (`WINDOW_MONEY_SCALE`). Chưa đủ tiền
   → badge "Ổn" kèm ghi chú "chưa kết luận, đơn về trễ". Seller tự chỉnh mức này.
2. **Máy trạng thái nguồn dừng** (`ads-pause-flag.ts`, cột `AdsCampaign.hubsellPaused*`):

   | Ai vừa thao tác | Trạng thái | Máy được làm gì |
   |---|---|---|
   | Hubsell dừng | tắt, có cờ | chỉ **bật lại** khi ROAS cửa sổ đã kích ≥ hòa vốn × `review.dangerFactor` |
   | Người dừng (Seller Center / sàn tự tắt) | tắt, không cờ | **không bao giờ** bật lại |
   | Người bật lại (dù ai tắt trước) | chạy, cờ xóa, `cycle+1` = ván mới | đủ quyền như campaign mới, kể cả tắt lại cùng ngày |

   Sync (Shopee `upsertShopeeCampaignSettings`, Lazada xung + lịch sử) thấy campaign
   còn cờ mà sàn báo chạy → `reconcileHubsellPauseFlags`: xóa cờ, sổ ghi
   `OVERRIDDEN` ("Seller đã bật lại"), nhật ký ADS. Khóa chống lặp theo VÁN:
   `{pause|resume}-{rowId}-{ngày}-c{cycle}`. Máy tự bật lại hôm nào thì hôm đó không
   tắt lại (`hubsellResumedOn`) — một vòng dừng/bật mỗi campaign mỗi ngày.
3. **Thông báo:** detector `detectAdsAutoActions` (ops-alerts.ts) sinh thẻ từ CỜ +
   SỔ HÀNH ĐỘNG hôm nay, không từ verdict: `ads-auto-paused` (high, nút **Bật lại**
   gọi sàn thật, payload kind `ads-resume`), `ads-auto-planned` (diễn tập),
   `ads-auto-failed` (sàn từ chối, lỗi nguyên văn), `ads-auto-resumed`. Thẻ mới →
   chuông + nhật ký qua `applyDetectedAlert`; worker ép `scanOpsAlerts(owner, true)`
   ngay sau lượt máy có hành động. Thẻ tự đóng khi cờ hết / qua ngày.
4. **Bật lại:** máy (`shouldAutoResume`, live) hoặc seller bấm trong Hubsell
   (`POST /api/ads/:platform/campaigns/:id/resume` → `resumeCampaignByOwner`, sổ
   mode `manual`). Shopee `edit_manual_product_ads` edit_action `resume` — enum
   xác minh trong docs chính thức (start/pause/resume/stop/delete/change_*);
   `pause` đã chạy thật 21/08 + 14/09; `resume` ĐÃ BẮN THẬT 14/09 21h50 qua write-probe
   trên campaign ANO 55242573 (resume → error "" → pause lại → error ""). Lazada
   `updateCampaign switchStatus=1` (chưa bắn thật).
6. **Xung nhẹ không được khóa gian có campaign tạm dừng** (bug tìm ra 14/09 tối:
   ANO 15:28 bật lại trên Seller Center, 18:02+ Hubsell vẫn ghi "Tạm dừng"): xung
   nhẹ từng chạy khi DB "0 campaign ĐANG CHẠY" → campaign cuối cùng vừa bị dừng là
   gian rơi vào xung nhẹ mãi, cấu hình không bao giờ đọc lại (tầng B chỉ kéo perf).
   Nay xung nhẹ chỉ khi không còn campaign chạy/tạm dừng/hẹn giờ nào; gian còn cờ
   Hubsell giữ nhịp PULSE_MIN để tự bật lại / hòa giải cờ kịp thời.
7. **Bước 6 — niềm tin trước khi gạt live** (`ads-scorecard.ts`, thuần):
   `GET /api/ads/:platform/assistant-scorecard?channelId=&days=` → GỘP vào "Sổ hành
   động & bảng điểm Trợ lý" trong tab Cấu hình Trợ lý (anh Trung 14/09: tab Tổng quan
   là nơi thao tác bảng campaign, không chen card; shop trăm campaign vẫn gọn): mỗi lần máy ĐỊNH dừng (dry_run) nhìn tiếp những
   ngày SAU (perf theo ngày, bỏ ngày phán): vẫn lỗ = máy đúng + tiền tiêu tiếp là
   "lẽ ra tiết kiệm được"; ROAS đạt = máy sai (chạy thật máy tự bật lại); <20k chưa
   kết luận. Kèm 4 ô đếm hành động thật (dừng / máy bật / người bật / sàn từ chối); từng dòng
   diễn tập trong sổ có badge kết luận + "sau đó: tiêu thêm X, ROAS Y / hòa vốn Z". Worker `ads-daily-summary.ts`: 20h VN
   gom Sổ hành động trong ngày của chủ shop thành MỘT chuông
   "🤖 Trợ lý quảng cáo hôm nay: dừng X, bật lại Y, diễn tập Z", ngày không có gì thì
   im; tắt `ADS_DAILY_SUMMARY_OFF=1`.
8. **Sổ = dòng thời gian đầy đủ** (anh Trung 14/09 tối, giảm khiếu nại "tự nhiên tắt"):
   mỗi lượt đồng bộ so trạng thái trước/sau; chạy→tạm dừng không do Hubsell → dòng
   **"Tắt trên sàn"**, tạm dừng→chạy → **"Bật trên sàn"** (`recordMarketplaceStatusChange`,
   mode `marketplace`, status `OBSERVED`, ghi rõ "Hubsell KHÔNG can thiệp, ghi nhận lúc
   đồng bộ"). Không tính quota máy, không lên bảng điểm/chuông. Khách khiếu nại: hỏi tên
   gian + campaign + khoảng giờ, mở sổ là thấy ai tắt; đối chiếu Lịch sử hoạt động
   Seller Center nếu cần. Chưa làm (chờ khiếu nại thật): lưu request_id Shopee,
   write-probe ghi sổ, trang tra cứu bên HQ.
5. FE: nhãn **"Hubsell tạm dừng"** (tím, tooltip lý do + giờ) thay "Tạm dừng" khi
   có cờ; modal có nút **Bật lại ngay**; Sổ hành động phân biệt pause/resume/
   OVERRIDDEN; thẻ Trung tâm điều hành kind `ads-resume` gọi API bật lại từ thẻ.

## Nhịp đồng bộ số ads (12/09/2026 — thiết kế 3 tầng, docs/ADS-NHIP-CANH-BAO.md)

Nguồn nhịp duy nhất: `backend/src/config/ads-cadence.ts`.

- **Tầng A — XUNG** (`ads-pulse.ts` 2 sàn, worker `runAdsPulseTier`): mỗi **30'**
  Shopee (`ADS_PULSE_MINUTES`) / **60'** Lazada (`ADS_PULSE_LAZADA_MINUTES`, tới khi có
  quota app ISV) cho gian **đang tiêu tiền** (campaign chạy + chi trong 2 ngày).
  Kéo cấu hình campaign (trạng thái/ngân sách/ROAS mục tiêu, campaign mới), số
  **hôm nay**, chi tiêu cấp shop hôm nay và **ví ads → ghi DB**. Ngay sau xung:
  Trợ lý tự thực thi + quét cảnh báo → chuông "cắn tiền"/"ví cạn" trong ≤30' +
  độ trễ báo cáo của sàn. Gian có campaign nhưng 2 ngày không chi → 120'; gian đã
  nối Ads nhưng chưa có campaign → xung nhẹ 1 call/120' (thấy campaign mới là xung
  đủ ngay).
- **Tầng B — LỊCH SỬ** (`runAdsTier`): mỗi **6h** (`ADS_SYNC_HOURS`) kéo lại **7
  ngày** (sàn chỉnh số muộn). Lần đầu / vừa nối Hubsell Ads → `adsBackfillPending`
  → 30 ngày trọn bộ (id list + cấu hình + perf).
- **Tầng C — VAN AN TOÀN** (`services/api-budget.ts`): token bucket **3 call/s
  mỗi app** (`ADS_APP_QPS`) cho mọi path `/api/v2/ads/` và `/sponsor/`; cầu dao
  chung trong DB (`api_throttle_states`) đóng 5'→60' khi sàn báo vượt trần theo
  app (`ads.rate_limit.exceed_partner_api`/`exceed_api`/HTTP 429), **không retry**;
  vượt theo shop chỉ lùi gian đó 15'.
- Mở trang Trợ lý mà số cũ >30' → nudge **xung** (`nudgeAdsSyncIfStale`), FE nạp lại
  sau 45s. Nút **Làm mới** → `POST /api/ads/:platform/refresh` cũng kích xung
  (chống spam 2'). Ví ads trên trang và detector đều **đọc DB** (không còn gọi sống).
- **Lazada ngang Shopee (14/09/2026):** (a) trang Trợ lý Lazada hiện **dải đỏ "ví hết
  số dư"** từ cờ `adAccountBalanceStatus` (xung ghi `adsWalletBalance = 0`, route trả
  `walletEmpty`) — cùng sự kiện với thẻ ví cạn ở Trung tâm điều hành; (b) **chi phí ads
  Lazada vào bảng `AdSpend`** (`lazada/ads-spend.ts`, gọi sau xung 1 ngày + lịch sử 7/30
  ngày, chỉ DB): tổng `expense` chiến dịch theo ngày, vì Lazada không có API chi tiêu cấp
  shop đã probe. **Chống tính đúp:** gian trả tiền ads bằng cách **trừ vào doanh thu** có
  dòng "Phí Discovery tài trợ" (`feeSponsoredDiscovery`) trong sao kê 90 ngày → AdSpend
  ghi 0 (P&L từng đơn đã gánh). Báo cáo dòng tiền / Tổng quan / Trợ lý hỏi đáp từ đây
  thấy chi phí ads Lazada như Shopee.

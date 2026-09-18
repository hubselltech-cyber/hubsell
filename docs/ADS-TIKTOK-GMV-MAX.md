# Quảng cáo TikTok — GMV Max (TikTok Marketing API)

> Trạng thái 18/09/2026: **LIVE production** phần chỉ đọc + loại/khôi phục video THỦ CÔNG.
> 18/09: LOẠI TỰ ĐỘNG đã code xong (cấu hình theo từng chiến dịch, Diễn tập / Tự loại thật) — mục 6.
> 18/09 chiều: ROI HÒA VỐN đã có — mục 8. Chưa làm: quảng cáo LIVE GMV Max trong bảng campaign.
> Nhật ký theo phiên nằm ở `PROGRESS.md`; file này là bản đồ kỹ thuật để làm tiếp.

## 1. Vì sao là một hệ riêng

GMV Max thuộc **TikTok Marketing API** (`business-api.tiktok.com/open_api/v1.3`), tách hẳn khỏi TikTok Shop
Partner API mà app ISV dùng cho đơn/sản phẩm/quyết toán:

| | TikTok Shop Partner API (`integrations/tiktok/`) | TikTok Marketing API (`integrations/tiktok-ads/`) |
|---|---|---|
| App | app ISV trên Partner Center | app "Hubsell" trên business-api.tiktok.com, App ID `7686282112950747157` |
| Thứ được ủy quyền | gian hàng | **người dùng TikTok for Business** → thấy N tài khoản quảng cáo × M shop |
| Token | access + refresh, có hạn | **dài hạn**, không hết hạn, không refresh; chết khi bị hủy ủy quyền (lỗi 40105) |
| Env | `TIKTOK_APP_KEY/SECRET/SERVICE_ID` | `TIKTOK_ADS_APP_ID` / `TIKTOK_ADS_SECRET` (+ `TIKTOK_ADS_REDIRECT_URI` nếu khác mặc định) |

Scope đã được duyệt: Ad account information · GMV Max › Store management + **Identity and video** (chứa cả
lệnh loại video) · Reporting › GMV Max reports. **Chưa xin nhóm Campaign** (bật/tắt campaign, sửa ROI mục tiêu,
đọc `product_video_specific_type`).

## 2. Nguyên tắc thiết kế (anh Trung chốt 17/09)

1. **Tài khoản quảng cáo là thực thể RỜI shop.** Khác Shopee (ads chạy trên chính tài khoản shop): ở TikTok một
   tài khoản quảng cáo chạy cho nhiều shop, kể cả shop của nhiều seller (người chạy thuê), và shop có thể đổi
   tài khoản quảng cáo bất cứ lúc nào.
2. **Token chỉ là chìa khóa.** `tiktok_ads_auths` lưu token theo chủ shop (không unique theo advertiser).
   Quyền xem số do `tiktok_ads_store_links` quyết định, và link CHỈ tạo cho gian TikTok mà chính chủ shop đã
   nối app chính (`store_id` = `Channel.externalShopId` — đã kiểm khớp trên prod). Shop của seller khác trong
   cùng token: không lưu, không gọi report. Không dò ra gian nào → không giữ token.
3. **Hubsell tự chọn tài khoản quảng cáo.** Mỗi shop chỉ có một tài khoản độc quyền GMV Max
   (`exclusive_authorized_advertiser_info`) — chỉ tài khoản đó có số. Chủ shop không phải chọn gì.
4. **Kiểm lại quyền theo thời gian.** `verifyTiktokAdsLink` chạy trước mỗi lượt lịch sử 6h và NGAY TRƯỚC mọi
   lệnh ghi: shop đổi tài khoản quảng cáo → tự chuyển link nếu token cũng thấy tài khoản mới, không thì
   `NO_ACCESS` kèm lý do nêu tên tài khoản mới.
5. **Không Ads-only.** Quảng cáo chỉ gắn lên gian đã nối app chính.
6. **Không ghi `AdSpend` cho TikTok.** Phí GMV Max đã bị sàn trừ trong quyết toán từng đơn
   (`tiktok/settlements.ts`: `gmv_max_ad_fee_amount` → `order.serviceFee`). Ghi nữa là Lãi/Lỗ trừ hai lần.
   Hệ quả: lợi nhuận đơn TikTok ĐÃ trừ ads → ROI hòa vốn phải bóc riêng phí này (chưa làm).

## 3. Bản đồ code

```
backend/src/integrations/tiktok-ads/
  config.ts       env, URL ủy quyền (chỉ nhận app_id/state/redirect_uri — KHÔNG ép chọn lại tài khoản được)
  client.ts       gọi API: đổi auth_code, advertiser/get, store/list (GmvMaxStore), report/get, creative/update (GHI)
  oauth.ts        state ký (self 30' / invite 7 ngày, mang GIAN ĐÍCH) · connectTiktokAds · linkTiktokAdsStores (dò gian)
  report.ts       3 tầng báo cáo thành dòng sạch + video×ngày + clampGmvMaxRange (thuần, có test)
  backtest.ts     ĐỐI CHIẾU DIỄN TẬP (thuần, có test): video máy định loại, từ D+1 tới nay chạy ra sao
  breakeven.ts    ROI HÒA VỐN (thuần + đọc DB): cộng ngược phí GMV Max, đơn hủy vẫn trong mẫu số — mục 8
  sync.ts         đồng bộ campaign×ngày vào AdsCampaign/AdsCampaignDailyPerf · verifyTiktokAdsLink · ghi lỗi token chết
  action-log.ts   quy ước ghi/đọc sổ thao tác video trong AdsActionLog.reasons (thuần, có test)
  video-meta.ts   ảnh bìa + @kênh + caption qua oEmbed công khai, nhớ đệm RAM 3h
backend/src/routes/tiktok-ads.ts   /api/tiktok-ads/auth-url · DELETE /link · POST công khai /api/auth/tiktok-ads/connect
backend/src/routes/ads-tiktok.ts   /api/ads/tiktok (tổng quan) · /campaigns/:id/videos · /campaigns/:id/videos/action · /video-meta · /refresh
backend/src/workers/order-auto-sync.ts   runTiktokAdsPulse (60', 2 ngày) · runTiktokAdsTier (6h, 7/30 ngày) — không executor
backend/scripts/tiktok-ads-probe.ts      dụng cụ probe chỉ đọc (auth-url | exchange | run)

frontend/src/app/ads/tiktok/            page.tsx (2 tab) · campaign/page.tsx (?id=&from=&to=) · callback/page.tsx
frontend/src/components/ads/
  tiktok-ads-page.tsx        tab Tổng quan chiến dịch (DateRangePicker chuẩn, ?from=&to=) + tab Kết nối (mỗi gian một dòng → nút Kết nối)
  tiktok-campaign-page.tsx   soi video: lọc nhanh, sắp xếp ở tiêu đề cột, hộp cuộn, tick → Loại/Khôi phục, lịch sử
  tiktok-ads-format.ts       formatRoi / formatPct
```

Bốn file `tiktok-assistant*.ts(x)` + `tiktok-campaign-modal.tsx` là bản mô phỏng tháng 7 (rule engine 2 lớp + UI
cấu hình, dữ liệu giả) — **chưa nối vào đâu**, giữ làm tư liệu cho bước cấu hình tự động.

## 4. Những điều API thật dạy (đã probe — đừng thử lại)

- **Báo cáo** `/gmv_max/report/get/`: gồm cả campaign tạo từ Seller Center. Tiền là chuỗi VND nguyên; tỷ lệ
  (`ad_click_rate`, `ad_conversion_rate`) trả SẴN phần trăm dạng số trần ("1.92" = 1,92%).
- **Metric thuộc tính** (tên campaign/SP/video…) chỉ xin được khi có MỘT chiều ID, sai thì lỗi 40002.
  Tầng video buộc 3 chiều ID → **không bao giờ có tên video** qua report.
- **Khoảng ngày**: có chiều `stat_time_day` ≤ 30 ngày; KHÔNG có chiều thời gian (tầng SP/video) nhận tới 366 ngày.
- **Không có số theo giờ ở tầng video**, và chi phí video **trễ tới 11 giờ**. ROI gộp cả đơn tự nhiên.
- **Đủ bộ trạng thái video** (`creative_delivery_status`, probe 18/09 TC054 12–18/09, 1.780 video): DELIVERING 43 ·
  LEARNING 9 · IN_QUEUE 2 · EXCLUDED 140 ← bốn nhóm Hubsell ĐỌC (194 video, 99,5% tiền); KHÔNG đọc: `NOT_DELIVERYING`
  (sàn viết sai chính tả thật, 55 video — TikTok tự ngưng rải) · NOT_ACTIVE 818 · UNAVAILABLE 408 · AUTHORIZATION_NEEDED
  304 (chờ creator cấp quyền) · REJECTED 1 — cả năm nhóm này chỉ tiêu 9.424đ/7 ngày (0,5%), không có gì để loại.
  Video mới được bồi vào chiến dịch đi IN_QUEUE → LEARNING → DELIVERING nên tự vào bảng (trang đọc SỐNG mỗi lần mở,
  không lưu DB); bảng chỉ liệt kê video ĐÃ tiêu tiền trong khoảng ngày, video 0 đồng chỉ nằm trong con số "/ N video".
- **Tầng video NHẬN thêm chiều `stat_time_day`** (probe 18/09: 4 chiều campaign_id + item_group_id + item_id +
  stat_time_day, TC054 7 ngày = 225 dòng / 1 trang, khoảng ≤ 30 ngày) → `fetchGmvMaxCampaignVideoDays`. Hệ quả để
  dành: `buildAutoPlan` đang gọi 1 call cho MỖI ngày ra trường — gộp được về 1 call video×ngày khi cần tiết kiệm.
- **Tên/ảnh video**: `/gmv_max/video/get/` bắt buộc `identity_list` và chỉ trả video của tài khoản TikTok nhà,
  KHÔNG trả video creator/affiliate (nhóm chiếm đa số, nơi tiền rơi) → dùng **oEmbed công khai**
  `tiktok.com/oembed?url=…/@/video/{id}` (không cần token). Link mở video: `tiktok.com/@{author}/video/{id}`.
- **Loại/khôi phục video** `/campaign/gmv_max/creative/update/` (REMOVE | ADD, ≤400 video/lượt): chạy được với
  scope hiện tại, với campaign tạo từ Seller Center và video affiliate. Campaign phải đang bật. Sàn không trả
  kết quả từng video; lệnh thật đầu tiên 17/09 được áp dụng sau **~5–8 phút** (docs ghi 20 phút).
  UI đánh dấu "đang chờ" 30 phút từ sổ hành động.
- **Trang ủy quyền** tự điền tài khoản TikTok for Business đang đăng nhập trên trình duyệt; lần đầu ủy quyền
  advertiser phải nhập mã xác minh gửi về email tài khoản quảng cáo (hiệu lực 48h cho cùng app).

## 5. Quy ước sổ hành động (AdsActionLog) cho video

`action` = `exclude_video` | `restore_video` · `mode` = `live` · `verdict` = `manual` (chủ shop tự bấm; lệnh tự
động sau này dùng verdict khác) · `reasons`: mỗi dòng `#<videoId> · <số liệu lúc thao tác>`; dòng KHÔNG mở đầu
bằng `#<số>` là **căn cứ** của lệnh tự động. Xem `action-log.ts` + test `tiktok-ads.test.ts`.

## 6. LOẠI VIDEO TỰ ĐỘNG (code xong 18/09/2026 — anh Trung chốt thiết kế trong phiên)

**Quyết định của anh Trung 18/09:** cấu hình đặt vào **TỪNG CHIẾN DỊCH** (không có bộ chung theo gian — mỗi chiến
dịch seller đòi cài khác nhau), mở bằng **popup** trên trang soi video, phải dễ dùng không rối; video TikTok còn
**Đang học thì không động tới**; đồng hồ luật tính **từ ngày TikTok học xong** video (không đặt số ngày diễn tập
tối thiểu theo con số tự bịa; sau đó anh chốt lại: mặc định phải DIỄN TẬP 1 NGÀY THẬT rồi mới được bật Tự loại thật).

### Bản đồ code
```
backend/src/integrations/tiktok-ads/
  auto-rules.ts   LUẬT THUẦN (có test tiktok-ads-auto-rules.test.ts, 13 ca): assessVideo → planAutoExclusion → summarizeAutoPlan
  auto-run.ts     LƯỢT HẰNG NGÀY: trackCampaignVideos (theo dõi trạng thái) · buildAutoPlan (gom số theo cửa sổ hiệu lực)
                  · runTiktokAdsDaily (ghi sổ / gọi sàn / chuông) · autoRunDue (sau 12h VN, ngày chưa chạy)
backend/src/workers/order-auto-sync.ts   runTiktokAdsTier gọi runTiktokAdsDaily khi autoRunDue (mốc TiktokAdsStoreLink.lastVideoTrackOn)
backend/src/routes/ads-tiktok.ts         GET/PUT /campaigns/:id/auto-rule · POST …/preview (chạy thử, không ghi) · POST …/copy
prisma: TiktokAdsAutoRule (1 dòng / chiến dịch, không có = Tắt) · TiktokAdsVideoWatch (1 dòng / video / chiến dịch)
frontend/src/components/ads/tiktok-auto-rule-dialog.tsx   popup 3 tầng; chip + nút ở trang chiến dịch; cột "Tự động" ở Tổng quan
```

### Luật (auto-rules.ts) — mọi số tính trên CỬA SỔ NGÀY kết thúc HÔM QUA
Thứ tự chấm một video: `learning` (LEARNING/IN_QUEUE → bỏ qua) → `protected` (khách khôi phục tay ≤30 ngày → chỉ gắn
cờ) → `insufficient` (tiêu < minSpend) → vi phạm cứng [tiêu ≥ spendNoOrder mà 0 đơn · ROI < roiTarget×roiHardPct% ·
CPA > maxCpa (tùy chọn)] → công thần (≥ graceMinOrders đơn/30 ngày) thì `grace` tới khi vi phạm liên tục ≥ graceDays
ngày mới `exclude`; còn lại `exclude` → `flag` (có đơn, ROI dưới mục tiêu nhưng trên mức cứng) → `healthy`.
Chốt cấp chiến dịch: `maxExcludePerDay` (tốn tiền nhất trước, phần dư `heldByCap`) và `minOrderingVideosKeep`
(không loại tới video cuối còn ra đơn, `heldByFloor`). **Không có luật đột biến theo giờ** (tầng video không có số giờ).

### Lượt hằng ngày (auto-run.ts)
- Chạy ở lượt lịch sử 6h ĐẦU TIÊN sau **12h trưa VN** (chi phí video trễ 11h) — mỗi gian một lần/ngày.
- **Theo dõi** MỌI chiến dịch đang bật (không cần cấu hình, 2 call/chiến dịch: SP + video 30 ngày): ghi
  `TiktokAdsVideoWatch` — lần đầu thấy, chuỗi trạng thái, `statusLog`, và **`graduatedOn`** = ngày đầu thấy
  DELIVERING sau khi đã thấy LEARNING ("" = ra trường trước khi Hubsell theo dõi → dùng cửa sổ đủ). Nếu DELIVERING
  quay lại LEARNING thì log `học lại` + đặt lại đồng hồ khi ra trường lần nữa. ★ Đang THEO DÕI xem sàn có làm vậy không.
- **Xét luật** chiến dịch có rule ≠ off: 1 call cửa sổ windowDays + 1 call cho mỗi ngày-ra-trường nằm trong cửa sổ
  (video mới ra trường chỉ tính từ ngày đó, `windowDaysUsed` nhỏ hơn). Kết luận từng video ghi lại vào watch
  (`lastVerdict/lastReason/violationSince`).
  · `dry_run`: AdsActionLog mode dry_run status **PLANNED** + chuông "Diễn tập X: sẽ loại N video" (KHÔNG gọi sàn).
  · `live`: verifyTiktokAdsLink + campaign còn ongoing → `creative/update REMOVE` → SUCCESS/FAILED + chuông.
  · referenceId `ttauto-{rowId}-{YYYY-MM-DD}` unique → mỗi chiến dịch một lệnh/ngày. `lastRunSummary` (Json) giữ tóm tắt.
- Khách khôi phục tay (route action ADD) → upsert watch `restoredByUserAt` → máy không loại lại 30 ngày.

### Popup (3 tầng, anh duyệt phác thảo 18/09)
Tầng 1 luôn thấy: Tắt / Diễn tập / Tự loại thật + ROI mục tiêu (mặc định = roasTarget TikTok) + Soi theo N ngày.
Tầng 2 "Nâng cao" thu gọn: 8 ngưỡng còn lại (mặc định trong `AUTO_RULE_DEFAULTS`). Tầng 3 "Chạy thử với cấu hình
này": POST preview → "Nếu áp hôm nay: …" + danh sách video sẽ loại kèm căn cứ. **Tự loại thật** chỉ bật được khi đã
DIỄN TẬP ≥1 ngày (có `lastRunOn` từ lượt chấm hằng ngày; Chạy thử KHÔNG tính — anh Trung chốt 18/09: "khách mất tiền
lại đổ oan cho mình"; backend PUT trả 409 nếu chưa có) và phải xác nhận lại tóm tắt lượt đó. "Sao chép sang chiến dịch
khác" nhân bản cấu hình (live → đích nhận dry_run).

### Đã kiểm local 18/09 bằng số thật (gian giả nối token nhà, đã xóa)
TC054 7 ngày 11–17/09: sẽ loại 2 video (296.640đ, 4 đơn, ROI 2,76 và 4,17 so mức cứng 7,5), 2 ân hạn (công thần
55 đơn/30 ngày), 1 cần xem, 9 đang học bỏ qua, 38 chưa đủ dữ liệu. Lượt diễn tập chạy tay: 4 chiến dịch theo dõi
(75 video), 1 xét luật, sổ PLANNED + chuông đúng. **Chưa bắn `live` thật lần nào** — bật trên prod sau khi anh
xem diễn tập vài hôm.

### Còn treo
ROI tầng video gộp đơn tự nhiên (luật nghiêng nhân từ); ROI hòa vốn chờ giá vốn; tách luật video nhà / creator;
nút Gỡ kết nối; LIVE GMV Max chưa vào bảng campaign. Migration `20260918120000_tiktok_ads_auto_rules` tự áp khi Render boot.

## 7. Giai đoạn kế — BẬT TỰ LOẠI THẬT: việc còn thiếu (rà 18/09/2026 tối, chờ anh Trung chốt thứ tự)

Bối cảnh: anh Trung đã bật **Diễn tập cho TC054 trên prod** 18/09. Đường `live` trong `auto-run.ts` đã có đủ khung
(kiểm quyền TKQC + campaign còn bật ngay trước lệnh, referenceId một lệnh/ngày, sổ SUCCESS/FAILED + chuông, khách
khôi phục tay thì máy không loại lại 30 ngày) nhưng **chưa bắn lần nào**. Rà code thấy còn thiếu:

**A. Phải có trước khi bật thật**
1. ✅ **XONG 18/09 tối** (`backtest.ts` thuần + 7 test · `GET /campaigns/:id/auto-rule/backtest` · thẻ
   `tiktok-dry-run-backtest.tsx` — nằm ở TAB RIÊNG "Đối chiếu diễn tập" của trang chiến dịch, chỉ có khi đang Diễn
   tập và chỉ gọi TikTok khi mở tab; anh Trung chê bản đầu chèn thẻ lên trên bảng video là rối → trang nay gồm 3 ô số
   + 3 tab Video · Đối chiếu diễn tập · Lịch sử, và kết luận từng video nằm ở CỘT "Tự động" (trỏ chuột/bấm → lý do)). Mỗi video lấy NGÀY ĐẦU máy định
   loại (D, đọc từ sổ PLANNED — ngày nằm ở đuôi referenceId), cộng số từ **D+1** tới hôm nay (bỏ ngày D vì lượt chấm
   chạy sau trưa và không có số theo giờ → tính dè dặt). Kết luận theo đúng mốc khách cài: tiêu thêm < minSpend = Chưa
   đủ dữ liệu · 0 đơn hoặc ROI < mức loại = Máy đúng · ROI ≥ mục tiêu = Hồi phục · giữa = Lưng chừng. Chân thẻ nói rõ:
   loại thật thì TikTok DỒN tiền sang video khác — tiền đổi chỗ, không phải bớt chi. Chưa có lượt nào định loại →
   trả rỗng, KHÔNG gọi sàn; có thì 2 call. Kiểm local số thật (sổ giả định 13/09, đã xóa): 4 video từ 14/09 tiêu
   674.983đ / 18 đơn / ROI nhóm 6,73 < mức loại 7,5 → 1 Máy đúng (550k, ROI 5,99) · 1 Lưng chừng · 2 Chưa đủ dữ liệu.
   Mô tả gốc: **Bảng đối chiếu diễn tập ("máy nói đúng không?")** — hiện diễn tập chỉ để lại dòng PLANNED + chuông; mỗi ngày lặp
   lại đúng các video cũ (vì chưa loại thật) nên anh không có gì để PHÁN máy đúng hay sai. Cần: với mỗi video máy
   từng định loại, lấy số TỪ NGÀY ĐÓ tới hôm qua (1 call report/ngày-định-loại) → "nếu đã loại từ dd/mm: đỡ X đồng,
   mất Y đơn / Z doanh thu". Đây là căn cứ duy nhất để quyết bật thật, và là thứ cho khách xem sau này.
2. **Chốt chặn số liệu sàn hỏng** — luật "0 đơn" tin tuyệt đối cột đơn của report video. Nếu một hôm sàn trả thiếu
   (đơn = 0 hàng loạt) thì máy loại oan tới `maxExcludePerDay` video. Căn cứ đối chiếu CÓ SẴN, không phải số tự bịa:
   tổng đơn cửa sổ của chiến dịch trong `AdsCampaignDailyPerf` (đồng bộ riêng) — report video tổng 0 đơn mà tầng
   chiến dịch có đơn → bỏ lượt, chuông báo, không loại.
3. **Ghi sổ TRƯỚC khi gọi sàn** — hiện gọi `creative/update` xong mới `adsActionLog.create`. DB lỗi đúng lúc đó =
   video đã bị loại mà sổ trống ("khách mất tiền đổ oan cho mình" mà không có bằng chứng). Sửa: tạo dòng trước
   (status SENDING) rồi cập nhật SUCCESS/FAILED. (Render restart giữa chừng thì lượt chạy lại tự vá — đã xét.)
4. **Khôi phục MỘT CHẠM cả lệnh tự động** ở Lịch sử — hiện phải lọc chip Đã loại rồi tick tay từng video. Máy loại 10
   video/ngày mà khách thấy sai thì phải hoàn tác được ngay (và `restoredByUserAt` tự bảo vệ 30 ngày).

**B. Nên có, không chặn**
5. **Giờ chạy thất thường** — lượt ngày bám tầng lịch sử 6h nên rơi bất kỳ lúc nào 12h–18h. Cho tầng xung 60' cũng
   kiểm `autoRunDue` → luôn chạy trong ~1h sau 12h trưa; khách biết giờ mà xem chuông.
6. **Đổi cấu hình sau diễn tập** — rào `lastRunOn` chỉ biết "đã từng có lượt", không biết lượt đó chạy bằng cấu hình
   nào. Khách diễn tập bằng số nhẹ, sửa số nặng rồi bật thật luôn được. Hướng: lưu dấu cấu hình của lượt gần nhất,
   khác thì popup báo "cấu hình này chưa diễn tập" (chặn hay chỉ cảnh báo — anh chốt).
7. **Kiểm lệnh đã ngấm** — sàn không trả kết quả từng video. Lượt hôm sau: video trong `executedVideoIds` còn trạng
   thái đang phân phối → hiện sẽ tự bị loại lại (tự vá) nhưng IM LẶNG; nên ghi log/chuông để biết sàn từ chối ngầm.
8. Chuông diễn tập lặp y nguyên mỗi ngày (cùng video) → chỉ chuông khi danh sách ĐỔI so với hôm trước.

**C. Đã rà, không phải lỗi:** lệnh trùng trong ngày (referenceId chặn) · video đã loại không bị xét lại (report chỉ lấy
trạng thái đang phân phối) · chuyển Diễn tập → Thật cùng ngày không bắn ngay (lượt kế là trưa hôm sau) · trần 400
video/lệnh của sàn không chạm tới (`maxExcludePerDay` ≤ 100).

## 8. ROI HÒA VỐN (code xong 18/09/2026 chiều)

`breakeven.ts` (thuần `tiktokBreakevenBase` + `toTiktokBreakeven`, 8 test · `computeTiktokAdsBreakeven` đọc DB).
Hòa vốn = 1 ÷ biên lãi TRƯỚC quảng cáo, qua `computePnlRow` (không tự tính phí).

- ★ **CHỈ ĐƠN ĐÃ CÓ KẾT CỤC CUỐI** (anh Trung chốt 18/09 — TikTok đối soát rất lâu, đơn chưa chốt đưa vào là biên lãi
  ảo): (a) đơn ĐÃ ĐỐI SOÁT THẬT = `Order.isSettled` + bản kê `estimated = false` (giao thành công lẫn hoàn xong);
  (b) đơn HỦY **cùng lứa** = tạo không muộn hơn đơn đã đối soát mới nhất (`settledCohortCutoff`) — hủy chốt trong vài
  giờ, đối soát mất hàng tuần, không cắt lứa thì mấy tuần gần nhất chỉ toàn đơn hủy. Đơn đang giao / đã giao chờ đối
  soát / mới có số ước tính / đang hoàn → để ngoài, đếm `pendingOrders`. Cửa sổ **60 ngày** theo ngày tạo đơn
  (`TIKTOK_MARGIN_WINDOW_DAYS`, mặc định chọn cho đủ mẫu — KHÔNG phải số của sàn), `fetchPnlOrdersAll` phanh 8.000 đơn.

- **Cộng ngược phí GMV Max**: sàn trừ quảng cáo ngay trong quyết toán đơn (`TiktokOrderSettlement.feeGmvMax`, có dấu,
  âm = bị trừ; mapper dồn vào `order.serviceFee`) → `lãi trước ads = profit − feeGmvMax`.
- **Mẫu số theo định nghĩa của TikTok**: gross_revenue đếm đơn ĐẶT, không rút đơn hủy/hoàn → đơn HỦY góp doanh thu,
  0 đồng lãi (không lấy "lỗ ảo" bằng giá vốn của dòng P&L). ★ GIẢ ĐỊNH chưa kiểm được bằng số prod: nếu TikTok thật ra
  có rút đơn hủy thì hòa vốn đang bị nâng cao hơn thực (sai về phía dè dặt). Cách kiểm đã cài sẵn: ô căn cứ hiện
  "Đối chiếu doanh thu đơn đặt dd/mm–dd/mm: Hubsell thấy X · TikTok báo Y" — `placedRevenue` cộng MỌI đơn đặt (kể cả
  hủy / đang giao) của đúng SKU chiến dịch trên đúng những ngày có số TikTok; hai số sát nhau là mẫu số đúng.
- **Giá vốn**: đơn đã có kết cục cuối mà thiếu giá vốn ở bất kỳ dòng hàng nào → loại khỏi cả tử lẫn mẫu, báo
  `costCoveragePct`.
- **Chiến dịch → SKU**: `AdsCampaign.itemIds` = SPU của chiến dịch (`saveCampaignProductIds`, gọi trong lượt ngày và
  route soi video — không tốn call) ↔ `ChannelProduct.externalId = "productId-skuId"` → `channelSku` ↔ `OrderItem`.
  Chiến dịch < `MIN_ORDERS_FOR_MARGIN` (5) đơn giao thành → mượn biên lãi toàn gian (`source: "shop"`).
- **Nơi hiện**: cột Hòa vốn (Tổng quan) · đầu trang chiến dịch · popup cấu hình NHẮC khi ROI mục tiêu / mức loại dưới
  hòa vốn, KHÔNG tự sửa ngưỡng của khách.
- ★ **MỨC LOẠI THEO HÒA VỐN** (anh Trung duyệt 18/09): `AutoRuleConfig.hardBasis` `pct` (mặc định) | `breakeven`.
  `auto-rules.ts` `resolveHardLevel(cfg, breakeven)` → `{hardRoi, basis, fallbackReason, label}`; `planAutoExclusion`
  nhận thêm `breakeven`, trả `plan.hard`. Hòa vốn chỉ được dùng khi `breakevenUnusableReason` rỗng: biên lãi RIÊNG của
  chiến dịch (`source = campaign`), độ phủ giá vốn ≥ `BREAKEVEN_MIN_COVERAGE_PCT` (90 — mặc định chọn, không phải số
  của sàn), không `negativeMargin` (sản phẩm lỗ sẵn thì loại hết video cũng không cứu — rơi về % và báo). Không đủ tin
  → lượt chấm TỰ RƠI về % mục tiêu, tóm tắt/chuông ghi lý do. Vùng hòa vốn → mục tiêu: chỉ gắn cờ. Mức loại thực
  dùng được chốt vào sổ (`lastRunSummary.hardRoi/hardBasis/hardFallback` + dòng căn cứ của AdsActionLog) vì hòa vốn đổi
  theo ngày. Backtest chấm theo cùng mức loại (`marks.hardBasis`). Lượt ngày chỉ tính hòa vốn khi có chiến dịch chọn
  breakeven, một lần mỗi gian.

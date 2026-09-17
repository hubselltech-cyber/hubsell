# Quảng cáo TikTok — GMV Max (TikTok Marketing API)

> Trạng thái 17/09/2026: **LIVE production** phần chỉ đọc + loại/khôi phục video THỦ CÔNG.
> Chưa làm: loại TỰ ĐỘNG (cấu hình luật), ROI hòa vốn, quảng cáo LIVE GMV Max trong bảng campaign.
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
  report.ts       3 tầng báo cáo thành dòng sạch + clampGmvMaxRange (thuần, có test)
  sync.ts         đồng bộ campaign×ngày vào AdsCampaign/AdsCampaignDailyPerf · verifyTiktokAdsLink · ghi lỗi token chết
  action-log.ts   quy ước ghi/đọc sổ thao tác video trong AdsActionLog.reasons (thuần, có test)
  video-meta.ts   ảnh bìa + @kênh + caption qua oEmbed công khai, nhớ đệm RAM 3h
backend/src/routes/tiktok-ads.ts   /api/tiktok-ads/auth-url · DELETE /link · POST công khai /api/auth/tiktok-ads/connect
backend/src/routes/ads-tiktok.ts   /api/ads/tiktok (tổng quan) · /campaigns/:id/videos · /campaigns/:id/videos/action · /video-meta · /refresh
backend/src/workers/order-auto-sync.ts   runTiktokAdsPulse (60', 2 ngày) · runTiktokAdsTier (6h, 7/30 ngày) — không executor
backend/scripts/tiktok-ads-probe.ts      dụng cụ probe chỉ đọc (auth-url | exchange | run)

frontend/src/app/ads/tiktok/            page.tsx (2 tab) · campaign/page.tsx (?id=&days=) · callback/page.tsx
frontend/src/components/ads/
  tiktok-ads-page.tsx        tab Tổng quan chiến dịch + tab Kết nối (mỗi gian một dòng → nút Kết nối)
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

## 6. Việc kế tiếp: cấu hình LOẠI TỰ ĐỘNG (chưa chốt — cần nghiên cứu, phản biện trước)

Khung đã trình anh Trung 17/09: ba mức **Tắt / Diễn tập / Tự loại thật**; luật kế thừa bộ 2 lớp tháng 7
(chưa đủ dữ liệu thì không phán · tiêu tiền 0 đơn · ROI thấp so với ROI MỤC TIÊU khách tự đặt · CPA vượt trần ·
có đơn đều nhưng CPA cao thì chỉ gắn cờ · ân hạn cho video chủ lực), cấu hình chung theo gian + đè theo chiến dịch.

Ràng buộc từ API thật buộc phải tính tới:
1. Không có "số giờ video đã chạy" → sàn dữ liệu = mức tiêu + trạng thái `LEARNING` của chính TikTok.
2. Không có số theo giờ + chi phí trễ 11h → luật "đột biến trong 2 giờ" bất khả thi.
3. Ân hạn chỉ tính được theo ngày / số tiền tiêu thêm.
4. Số thật cho thấy phải soi theo CỬA SỔ THỜI GIAN: `@micastore92` tháng 8 chi 1,97tr ra 55 đơn (tốt) nhưng
   7 ngày gần nhất chi 815k, ROI 3,74 so mục tiêu 15 — nhìn số tổng thì lọt lưới. Nhóm "có đơn nhưng ROI/CPA
   kém" ngốn tiền gấp ~5 lần nhóm "0 đơn".
5. Chưa có giá vốn (and.not.or còn 283 SKU chưa nối) → luật chỉ so với ROI mục tiêu / CPA trần khách tự đặt.

Chốt an toàn dự kiến (bài học sự cố executor Shopee 14/09): diễn tập trước khi thật · trần số video loại mỗi
ngày/chiến dịch · không loại video cuối còn ra đơn · khách khôi phục thì máy không loại lại · chuông kèm căn cứ ·
kiểm quyền tài khoản quảng cáo trước mỗi lệnh.

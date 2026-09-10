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
| **Đã đặt** | Mọi gian Shopee PHẢI ủy quyền Hubsell Ads. Chưa nối → thẻ mời kết nối, nút Đồng bộ khóa, worker bỏ qua nhánh ads của gian đó. |

Env đầy đủ (xem `backend/.env.example`): `HUBSELL_ADS_PARTNER_ID`,
`HUBSELL_ADS_PARTNER_KEY`, `HUBSELL_ADS_ENV` (bỏ trống = theo `SHOPEE_ENV`;
đặt `sandbox` để test app Ads trong khi app chính đã production),
`HUBSELL_ADS_REDIRECT_URI` (bỏ trống = `<backend>/api/auth/hubsell-ads/callback`).

## 3. Việc phải làm trên Shopee Console (sau khi ISV duyệt)

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
3. Callback đối chiếu `shop_id` với gian đích **trước khi đổi code** (đăng nhập
   nhầm shop khác sẽ báo lỗi rõ, không ghi token nhầm gian), lưu ChannelAppAuth,
   redirect về `/ads/shopee?hubsell_ads=connected`.
4. Worker auto-sync bắt đầu kéo chi phí/campaign trong nhịp 10' kế tiếp.
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

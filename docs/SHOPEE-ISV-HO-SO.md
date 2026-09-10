# Hồ sơ nâng tài khoản Shopee Open Platform lên Third-party Partner Platform (ISV)

Cập nhật 10/09/2026. Nguồn điều kiện: open.shopee.com → Developer Guide →
"Developer account registration" (cập nhật 19/07/2026) và "App management"
(24/04/2025). Ticket Shopee 21/08/2026 đã xác nhận: In-house System không cho
seller ngoài ủy quyền; lên ISV thì app 2040029 tự đổi thành ERP System, shop đã
ủy quyền KHÔNG phải ủy quyền lại.

## 1. Điều kiện Shopee đặt ra (nguyên văn mục 3.2) và hiện trạng Hubsell

| # | Shopee yêu cầu | Hiện trạng 10/09 | Việc còn lại |
|---|---|---|---|
| 1 | Registered business — nộp giấy tờ doanh nghiệp hợp lệ | GCN ĐKDN Công ty TNHH Công nghệ Hubsell được chấp thuận 09/09/2026 | Mã số DN 0111626360; tải bản GCN điện tử (PDF) từ dangkykinhdoanh.gov.vn |
| 2 | Sản phẩm đã LIVE, có tích hợp TMĐT sẵn, nhận diện được qua tài khoản trial | app.hubsell.tech live từ 31/07; 3 shop Shopee thật + 2 Lazada đang chạy | Seed tài khoản reviewer bằng `backend/scripts/seed-isv-reviewer.ts` (xem mục 3) |
| 3 | Không có hoạt động đáng ngờ (bán tài khoản xuyên biên giới, kéo listing ra ngoài Shopee) | Không có | Khai rõ trong mô tả dịch vụ |
| 4 | Nộp URL live + tài khoản trial mở ĐỦ tính năng | reviewer@hubsell.vn từng nộp 31/07 (data mock cũ, gói không rõ) | Seed lại: gói Business 12 tháng, 45 ngày đơn, đủ module |
| 5 | URL https, TLS ≥ 1.2, xếp hạng bảo mật "A" | SSL Labs 10/09: app.hubsell.tech **A+**, hubsell.tech **A+**, backend Render **A+** (chấm lại 10/09 sau deploy HSTS 64b440e); TLS 1.2 + 1.3 | Xong |
| 6 | Thời gian duyệt | 10 ngày làm việc | Nộp xong theo dõi email tài khoản dev + Console → Go to Profile |

## 2. Đánh đổi khi app đổi thành ERP System (phải quyết TRƯỚC khi nộp)

Bảng quyền: ERP System = "All API except Chat API and Ads API". Ngay khi
Shopee duyệt, app 2040029 mất 2 nhóm quyền này:

- **Ads API** (Trợ lý quảng cáo Shopee, đồng bộ chi phí ads `get_all_cpc_ads_daily_performance`):
  Shopee trả lời phải tạo app "Ads Service" riêng → partner_id/key thứ 2,
  shop phải ủy quyền thêm app đó, backend cần bộ credential Shopee thứ 2 cho
  ads-spend/ads-campaigns. Việc code: ~1 buổi.
- **Chat API** (Trợ lý vận hành chat Shopee): ISV phải qua Account Manager /
  BD đánh giá + escalation nội bộ. Chưa có AM → hỏi qua ticket ngay khi nộp
  hồ sơ ISV, và chấp nhận chat Shopee tạm ngừng sau khi chuyển.
- Product API (phản hồi đánh giá) KHÔNG mất.

Khuyến nghị: nộp ISV ngay (10 ngày làm việc là đường găng), song song tạo app
Ads Service ở Console (sandbox) và code đa credential; ẩn tính năng chat
Shopee sau chuyển đổi bằng cờ tính năng cho đến khi có quyền.

## 3. Tài khoản trial cho đội xét duyệt

- Email: `reviewer@hubsell.vn` (giữ email đã khai trong hồ sơ Go-Live 31/07).
- Gói: Business, trả phí, hạn 12 tháng, không trần đơn mềm.
- Data: shop "Hubsell Demo Store" — 2 gian Shopee + Lazada trạng thái đang
  hoạt động, 12 SKU kho nối đủ 2 sàn (1 SKU cố ý sắp hết hàng để hiện cảnh
  báo), ~2.900 đơn trong 45 ngày đủ trạng thái, ~60 đơn hoàn rải đủ công
  đoạn, phí sàn + đối soát, chi phí ads theo ngày, chi phí vận hành, số dư ví.
- Lệnh chạy production (PowerShell, chuỗi Supabase có mật khẩu chứa ký tự đặc
  biệt phải URL-encode):

```powershell
$env:DATABASE_URL='postgresql://postgres.<ref>:<mật khẩu đã encode>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres'
npx tsx scripts/seed-isv-reviewer.ts --production --password=<mật khẩu mới>
```

- Trước khi nộp: đăng nhập app.hubsell.tech bằng tài khoản này, đi 1 vòng
  Tổng quan → Đơn hàng → Hàng hóa → Dòng tiền → Hoàn → Gói để chắc không còn
  chữ demo/mock; chạy `scripts/cleanup-ops-demo.ts --apply` (production) để
  xóa nhật ký demo Trung tâm điều hành còn sót.

## 4. Form thật trên Console (đọc 10/09/2026, Chrome anh Trung đăng nhập)

Console → Personal Center → Account Information: Developer Type hiện là
**Individual Seller** (tài khoản zing4teen@gmail.com, username ano.hn), có nút
**"Change to Third-party Partner Platform"**. Bấm vào, Shopee liệt kê 3 thứ
phải có: *Business Registration Number*, *Soft copy of Business Registration
document*, *Test account credentials of your app*, kèm ô "Why do you want to
change your account type?" (≤ 200 ký tự) rồi Next sang phần Business
Information + Services Information. Cùng trang còn mục **"Security Reports &
Certifications Information — You need to upload"** (đang trống): chuẩn bị
sẵn ảnh chụp kết quả SSL Labs A+/A của app.hubsell.tech + backend để đính kèm
nếu form đòi.

Gợi ý câu trả lời "Why…" (≤ 200 ký tự):

> Hubsell is now a registered company (Hubsell Technology Co., Ltd.) providing
> a multi-channel ERP SaaS to other Shopee sellers, so external shops must be
> able to authorise our app.

## 5. Nội dung điền form Console (Business Information + Services Information)

Điền tiếng Anh, giữ nhất quán với hồ sơ Go-Live 31/07.

**Company name:** HUBSELL TECHNOLOGY COMPANY LIMITED (CÔNG TY TNHH CÔNG NGHỆ HUBSELL)
**Business registration no. / Tax code:** 0111626360
**Country / Region:** Vietnam
**Registered address:** No. 5k1, Lane 5, TT75, Tong Cuc II, Ministry of National Defence, Kim Chung Residential Group, Hoai Duc Commune, Hanoi, Vietnam
**Legal representative:** Nguyen Trung Hieu — Director
**Contact email:** hubselltech@gmail.com (email đăng ký DN) · hỗ trợ: support@hubsell.tech
**Business license:** PDF Giấy chứng nhận ĐKDN (bản điện tử có mã QR)

**Service type:** ERP / multi-channel order, inventory and finance management SaaS
**Product URL:** https://app.hubsell.tech (landing: https://hubsell.tech; privacy: https://hubsell.tech/privacy; terms: https://hubsell.tech/terms)
**Trial account:** reviewer@hubsell.vn / <mật khẩu> (Business plan, all features enabled)
**Markets served:** Vietnam
**Existing integrations:** Shopee Open Platform v2 (app 2040029, live since 05/08/2026 — orders, escrow/settlement, returns, logistics/shipping labels, product & stock sync, buyer invoice info), Lazada Open Platform (app 140639 — orders, finance, reverse orders, pack/RTS), MISA meInvoice e-invoicing, payOS payments.
**Number of sellers using the product:** 5 shops (3 Shopee, 2 Lazada) in private beta; commercial pricing published at https://hubsell.tech/#pricing.

**Service description (gợi ý ≤ 500 chữ):**

> Hubsell is a Vietnamese SaaS that helps small and medium e-commerce sellers run
> Shopee and Lazada shops from one place. Sellers authorise their shops via the
> platforms' official OAuth flows; Hubsell then syncs orders in near real time
> (push + scheduled pull), prepares shipments and prints shipping labels,
> keeps a single warehouse stock level in sync across shops, tracks returns
> and failed deliveries, reconciles marketplace fees against actual payouts,
> and produces profit-and-loss, cash-flow and Vietnamese e-invoice/tax
> reports. Data is stored per seller in an isolated tenant and used solely to
> provide the service to that seller (see privacy policy). Hubsell does not
> sell accounts, scrape listings or move transactions off-platform.

## 6. Sau khi được duyệt

1. Console: kiểm tra app 2040029 đã đổi thành ERP System; nếu chưa, gửi ticket nhờ đổi.
2. Thử liên kết một shop mới từ trình duyệt sạch qua nút "Kết nối Shopee" trong app (không cần phiên Console dev nữa).
3. Bật lại `SHOPEE_AUTH_FLOW=new` nếu muốn dùng link ủy quyền mới (luồng cũ vẫn chạy).
4. Tạo app Ads Service tên **Hubsell Ads** + nộp Go-Live cho app đó — code đã sẵn
   10/09 (module `integrations/hubsell-ads/`, bật bằng env `HUBSELL_ADS_*`), quy
   trình Console + luồng seller trong `docs/HUBSELL-ADS.md`. Chat vẫn xin qua AM/BD (mục 2).
5. Chấm lại SSL Labs backend sau deploy HSTS (mục tiêu A+).

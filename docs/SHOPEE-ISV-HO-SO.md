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

- **Worker bồi đơn reviewer (12/09–15/09/2026) ĐÃ GỠ** sau khi ISV được duyệt
  15/09 (anh Trung chốt 12/09). Tài khoản reviewer giữ nguyên data seed, không
  còn tự sinh đơn mới; cần làm sống lại thì chạy lại seed.
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
6. **Chat API (15/09/2026):** ngay khi app thành ERP System, mọi call
   `/api/v2/sellerchat/*` trả 403 `error_api_permission` (Console → API Access
   Log). Loại app "Customer Service" đã ngừng cấp cho bên thứ ba từ 18/11/2024,
   cấp mới chỉ qua Account Manager. Đã gửi ticket xin quyền (Enquiry
   2099855634883350588). Trong lúc chờ: `integrations/shopee/chat-gate.ts` khóa
   gọi chat 6h sau lần 403 đầu (env `SHOPEE_CHAT_DENIED_TTL_MINUTES`), Trợ lý
   vận hành hiện dòng "Shopee tạm chưa cấp quyền chat cho Hubsell", Cứu đơn ghi
   SKIPPED lý do rõ (cảnh báo chuông vẫn chạy). Sàn cấp quyền là tự thông,
   không cần deploy.

## 7. Thông báo Shopee 16/10/2026: bỏ IP Whitelist, thay bằng PII Necessity Declaration

Nguồn: 3 thư `info@shopee.sg` ngày 16/10/2026 (hộp hubselltech@gmail.com) +
Developer Guide "Requesting Access to Sensitive Data" (open.shopee.com/developer-guide/718,
cập nhật 16/10/2026). Đối chiếu với hiện trạng mục 6 và bộ nhớ phiên 15/09.

### 7.1 Ba thư nói gì

| Thư | Nội dung | Hiệu lực |
|---|---|---|
| **[Action Required] IP Address Whitelist Replaced by PII Necessity Declaration** | Ô "Enable IP Address Whitelist" trên app đổi thành công tắc **"Does this App require buyer PII access?"**. ON = khai IP, chỉ IP đã khai mới gọi được OpenAPI, nhận PII không che. OFF = không khai IP, PII bị che. App từng bật whitelist → công tắc mặc định ON, phải rà trước **23/10/2026 23:59 GMT+8**. ISV muốn PII không che phải: (1) công tắc ON + IP, (2) báo cáo pentest đã duyệt còn hạn. | Ngay |
| **Significant OpenAPI Updates of Order** | `get_order_detail` + `get_package_detail` thêm vào `item_list`: `is_fulfillment_mapping`, `bundle_sku_id`, `components[]` (parent_sku_id, barcode_upc, quantity, warehouse_id, mapping_type 1 Group / 2 Lucky bag / 3 Mapping List). Chỉ trả cho shop trong whitelist FFM; shop khác không có trường mới. | Đã live |
| **Support for IP Subnet Input in CIDR Format** | Ô IP của app nhận dải CIDR **/24 → /32, tối đa 3 dải**; ô Other IT Assets nhận /22 → /32, 3 dải mỗi ô. Mỗi dòng một IP hoặc một dải; không IPv6, không wildcard, không dạng đầu-cuối. | 16/10/2026 |

### 7.2 Developer Guide 718 nói rõ hơn thư (điểm then chốt)

- "By default, sensitive data is masked" — tên, SĐT, email, địa chỉ khách bị che
  mặc định cho MỌI developer chưa khai.
- **Pentest chỉ bắt buộc với ISV phục vụ Thái Lan, Malaysia, Singapore,
  Philippines và ISV CNCB/HKCB.** Hubsell chỉ phục vụ Việt Nam → theo guide
  KHÔNG thuộc diện phải nộp pentest; chỉ cần công tắc PII ON + khai IP.
  (Thư chung viết "ISV phải đủ cả 2 điều kiện" — guide hẹp hơn, nếu Console
  vẫn đòi pentest thì mới tính.)
- Nếu có pentest: hiệu lực 2 năm từ ngày phát hành báo cáo; phải black-box,
  Critical/High đã vá, báo cáo quét lỗ hổng suông không được nhận; duyệt ~10
  ngày làm việc; nộp ở Personal Center → Security Reports & Certifications → Add.

### 7.3 Hiện trạng Hubsell đối chiếu

- **App Hubsell (2040029, ERP System):** 15/09 đã khai IP `74.220.52.0` +
  `74.220.60.0` nhưng **Enable IP Address Whitelist để OFF** (form lúc đó từ
  chối CIDR, Render chỉ cam kết DẢI `74.220.52.0/24` + `74.220.60.0/24`).
  → Theo thư, công tắc PII của mình mặc định **OFF**, không bị ép làm gì trước
  23/10. Nhưng Console 15/09 đã hiện "Access to Sensitive Data: No access" (!)
  → dữ liệu khách Shopee đang (hoặc sẽ) bị che.
- **Mình ĐANG dùng PII người mua:** `get_order_detail` xin
  `recipient_address` (tên + SĐT) → `Order.customerName/customerPhone`
  (`backend/src/integrations/shopee/service.ts`), hiện ở trang Đơn hàng,
  tìm theo SĐT, hộp hoàn/khiếu nại, app mobile; `get_buyer_invoice_info`
  (tên, MST/CCCD, địa chỉ, email người mua) cho Hóa đơn & Thuế — module
  này đã có nhánh "bị che dạng A****b → lượt sau hỏi lại" nhưng nếu che
  VĨNH VIỄN thì hóa đơn Shopee không bao giờ có thông tin người mua.
  Vận đơn KHÔNG ảnh hưởng (PDF do Shopee sinh).
- **App Hubsell Ads (2044679, Ads Service):** API Ads không trả PII → công tắc
  phải OFF. Chưa nhìn lại Console sau 16/10 — cần kiểm xem có bị ON mặc định.
- **Trường FFM mới:** mã mình chỉ khai TS type, không parse strict → trường lạ
  bị bỏ qua, không ảnh hưởng. Shop VN chưa thấy whitelist FFM; ghi nhận, chưa làm.

### 7.4 Phương án đề xuất (chờ anh chốt)

1. **Bật công tắc PII ON cho app Hubsell 2040029** + khai đúng 2 dải CIDR
   `74.220.52.0/24` và `74.220.60.0/24` (thư 3 vừa cho phép /24, tối đa 3 dải
   — đủ chỗ cho cả web `hubsell-backend-sg` lẫn worker `hubsell-worker-sg`
   cùng vùng Singapore). Trước khi khai: mở Render → service → Connect →
   Outbound, chép ĐÚNG dải đang hiện (Render có thể thêm dải).
2. **Giữ OFF cho app Hubsell Ads** và xác nhận trên Console.
3. **Rủi ro chính:** khai thiếu/sai IP = Shopee chặn toàn bộ lệnh gọi của MỌI
   khách (đồng bộ đơn, chuẩn bị hàng, ads). Làm giờ vắng (sau 22h), theo dõi
   log Render `[Shopee]` 10 phút sau khi Submit, lỗi IP thì tắt công tắc ngay.
   Máy anh/em chạy script local gọi Shopee sẽ bị chặn — chấp nhận.
4. Nếu Console đòi pentest dù chỉ phục vụ VN → gửi ticket dẫn guide 718
   (phạm vi TH/MY/SG/PH) trước khi đi thuê pentest black-box.
5. Việc cần anh: đăng nhập Console (tài khoản zing4teen@gmail.com) trên Chrome,
   em điền cùng; và xem trang Đơn hàng một gian Shopee: SĐT khách đang hiện
   số thật hay dạng `******123` để biết mức độ gấp.

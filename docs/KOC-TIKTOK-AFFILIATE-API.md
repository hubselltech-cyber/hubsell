# Mạng lưới KOC TikTok — khảo sát Affiliate Seller API

Khảo sát 20/09/2026, đọc trực tiếp docs Partner Center
(`partner.tiktokshop.com/docv2/page/affiliate-seller-api-overview`, nhóm **Affiliate seller**,
~45 endpoint). Mọi tên trường dưới đây lấy từ ví dụ response trong docs — CHƯA gọi thật,
khi code phải log hình dạng payload lần đầu như các luồng TikTok khác.

> **Anh Trung chốt 20/09/2026: LÀM SAU.** Tài liệu này chỉ trả lời "TikTok có API gì". Khi mở lại
> phải KHẢO SÁT LẠI TOÀN BỘ trước khi code: (1) seller thật sự cần gì — tham khảo các app quản lý
> KOC / affiliate đang có trên thị trường, gồm cả Trung Quốc (cái nôi của affiliate); (2) đối chiếu
> lại API vì docs có thể đã đổi. Đích: nền tảng thực sự quản lý và hỗ trợ để seller RẢNH TAY,
> không phải thêm một bảng báo cáo.

## 1. Kết luận

**CÓ API**, và đủ để biến tầng "hồ sơ từng KOC" (đang mock) thành số thật — thứ mà
Shopee / Lazada không làm được vì không trả danh tính creator theo đơn.

**Rào duy nhất là hạng mục app.** Docs ghi rõ (bảng "View app categories", chọn
Registration region = Vietnam, Target market = Vietnam) các API này chỉ cấp cho:

- `App developer / Customer Engagement / Creator collaborations`
  (= "Tương tác với khách hàng → Cộng tác với nhà sáng tạo" trên form tiếng Việt)
- `Seller inhouse developer` (app nội bộ của chính seller — không áp dụng cho Hubsell)

App Hubsell hiện đăng ký hạng mục ERP / Quản lý đa kênh → 24 scope đang có KHÔNG gồm
affiliate. Phải nộp đơn **thêm hạng mục** (docs "Partner service categories": không giới
hạn số hạng mục, thêm sau bằng đơn mới), được duyệt rồi bật scope, nộp xét duyệt app lại,
seller ủy quyền lại.

Affiliate API không mở ở UK / EU; SEA (gồm VN) có — ví dụ response trong docs dùng VND.

## 2. Scope cần xin

| Scope | Gói | Dùng cho |
|---|---|---|
| `seller.affiliate_collaboration.read` | Read Seller Affiliate Collaboration (Public) | đơn affiliate, hàng mẫu, nội dung creator, xuất Compass |
| `seller.creator_marketplace.read` | (Public) | tìm creator + hiệu quả 30 ngày của creator |
| `seller.affiliate_collaboration.write` | (Public) | tạo / sửa Open & Target Collaboration, duyệt mẫu — CHƯA cần ở giai đoạn đọc số |
| nhắn tin creator (nhóm Conversation / IM) | chưa tra scope | chưa cần; lưu ý Shopee đã từ chối Chat API cho ISV, TikTok có thể cũng khắt khe |

## 3. Endpoint đáng giá, xếp theo thứ tự nên làm

### 3.1 Đơn affiliate theo creator — LÕI của module
`POST /affiliate_seller/202410/orders/search` — scope read, token seller + `shop_cipher`,
phân trang `page_token`, `page_size` 1–100, lọc `create_time_ge/lt` (tối đa 3 tháng mỗi
request; bỏ trống = 3 tháng gần nhất).

Mỗi đơn: `id`, `status`, `create_time`, `delivery_time`, và mảng `skus[]` với:
`creator_username`, `content_type` (LIVE / video), `content_id`, `product_id`, `sku_id`,
`quantity`, `price`, `open_collaboration_id` / `target_collaboration_id` / `campaign_id`,
`commission_model`, `commission_rate`, `partner_commission_rate`, `shop_ads_commission_rate`,
`estimated_*` và `actual_*` (commission_base, paid_commission, paid_partner_commission,
paid_shop_ads_commission, cofunded_creator_bonus), `settlement_status`,
`refunded_quantity`, `returned_quantity`, `fully_return`.

→ Khớp `order id` với bảng Order sẵn có là ra ngay: GMV / số đơn / tỷ lệ hoàn / hoa hồng
THEO TỪNG KOC, tách LIVE vs video, tới từng video (`content_id`). Đủ nuôi bảng "Hiệu quả
từng KOC" + 3 nhãn STAR / LOSS / HIGH_REFUND + Net-ROI (cộng phí booking, hàng mẫu nhập tay).

### 3.2 Hàng mẫu
- `POST /affiliate_seller/202508/sample_applications/search`: đơn xin mẫu kèm creator
  (username, follower, GMV, tỷ lệ hoàn thành), sản phẩm / SKU, `status`, `order_id`,
  `tracking_number`, hạn duyệt / hạn giao.
- `POST /affiliate_seller/202409/sample_applications/{id}/fulfillments/search`: mẫu đã gửi
  có lên bài không — `content.url`, `view_count`, `like_count`, `paid_order_count`.

→ Đúng vòng đời trang Hàng mẫu: xuất kho → lên bài → đơn đầu tiên, không phải nhập tay.

### 3.3 Hồ sơ & tìm KOC
- `GET /affiliate_seller/202608/marketplace_creators/{creator_user_id}`: follower, GMV
  30 ngày (tách live / video), GPM, phân bố ngành hàng, số thương hiệu đã hợp tác.
- `POST /affiliate_seller/202608/marketplace_creators/search`: tìm creator theo GMV, từ
  khoá, nhân khẩu follower. **Trần docs ghi: 10.000 request / ngày** (mã lỗi 45101004).

### 3.4 Phụ
- Nội dung creator trong Open Collaboration (`.../open_collaborations/creator_content_details`,
  gói **Custom** — phải xin riêng): số video / live mỗi creator theo sản phẩm.
- Compass offline export (`.../202603/compass/offline_task` → task list → download): xuất
  báo cáo affiliate dạng file, bất đồng bộ.
- Tạo / sửa Open & Target Collaboration, duyệt mẫu, sinh link: nhóm GHI, để sau.

## 4. Lộ trình đề xuất

1. **Chờ app TikTok qua xét duyệt hiện tại** (nộp 16/09) — KHÔNG đụng hạng mục / scope
   trong lúc đang review.
2. Nộp đơn thêm hạng mục "Cộng tác với nhà sáng tạo" → bật 2 scope read → nộp xét duyệt
   app → shop nhà `and.not.or` ủy quyền lại.
3. Code 3.1 trước (worker kéo đơn affiliate theo gian, lưu bảng riêng khoá order+sku,
   không vòng for tuần tự toàn hệ thống), rồi 3.2, rồi 3.3.
4. Nhóm GHI + nhắn tin: chỉ làm khi có khách đòi.

## 5. Chưa biết — đừng hứa

- TikTok có duyệt hạng mục Creator collaborations cho công ty < 1 năm không (ISV ERP thì
  đã duyệt tự động).
- `creator_username` có bị che với một số loại đơn không; đơn qua TAP / Shop Ads hiện thế nào.
- Rate limit của `orders/search` (docs không ghi).
- `estimated_*` vs `actual_*` chốt ở thời điểm nào so với bản kê đối soát đang dùng
  (`affiliate_commission_amount_before_pit` trong `tiktok/settlements.ts`).

# Trả lời bình luận video TikTok — khảo sát API (12/10/2026)

Anh Trung hỏi 12/10: shop TikTok gắn 1 tài khoản chính thức + tới 4 tài khoản tiếp
thị; video đăng lên có bình luận hỏi giá, kích thước… Hubsell có tự nhận biết + trả
lời được không? Đọc trực tiếp docs business-api.tiktok.com (TikTok API for Business,
CÙNG cổng với app Hubsell Ads 7686282112950747157 đang chạy GMV Max).

## 1. Kết luận: LÀM ĐƯỢC về mặt API, phải xin thêm quyền

Khác hẳn đánh giá sản phẩm (TikTok Shop không có API), bình luận video nằm ở
**Accounts API** (nhóm Organic API của TikTok for Business) và có ĐỦ lệnh:

| Việc | Endpoint (v1.3, `https://business-api.tiktok.com/open_api/v1.3`) |
|---|---|
| Liệt kê video của tài khoản | `GET /business/video/list/` (scope Business Media) |
| Đọc bình luận một video (cả ẩn) | `GET /business/comment/list/` — tối đa 30/trang, có `include_replies`, sort smart/likes/create_time |
| Đọc toàn bộ trả lời của 1 bình luận | `GET /business/comment/reply/list/` |
| **Trả lời bình luận** | `POST /business/comment/reply/create/` — `business_id`, `video_id`, `comment_id`, `text` ≤1.200 ký tự (hoặc ảnh) |
| Ẩn/hiện, thích, xóa, tự bình luận | `/business/comment/hide|like|delete|create/` |
| Webhook bình luận mới | `POST /business/webhook/update/` `event_type=COMMENT` → sự kiện `comment.update` trong ≤5 phút (tạo/xóa/đổi hiển thị), có thể lọc theo `item_list` video |

Quyền (bảng Permission scope): nhóm cấp 1 **TikTok Accounts (18000000)** → cấp 2
Business Media (18020000, video/list), **Business Comment (18030000)** → cấp 3
Get Business Comment (18030100) + Manage Business Comment (18030200).

## 2. Điều kiện & rào cản

- **Xin quyền**: từ 20/03/2026 muốn thêm scope "TikTok Accounts" phải điền
  *Accounts API Access Application Form* rồi xin tăng scope trên app (My Apps →
  Hubsell → Authorization → Scope of permission). Có xét duyệt, tiêu chí không công
  bố; app Hubsell Ads đang ở mức rate limit Basic.
- **Ủy quyền theo TỪNG tài khoản TikTok**: chủ tài khoản bấm link "TikTok account
  holder authorization URL" của app, đăng nhập TikTok, duyệt scope → `auth_code` →
  `/tt_user/oauth2/token/` → `access_token` + `open_id` (= `business_id`). Tài khoản
  chính thức và 4 tài khoản tiếp thị đều phải tự ủy quyền; cả Business Account lẫn
  Personal Account đều dùng được (docs ghi rõ). Khách có thể thu hồi trong app
  TikTok. Redirect URL phải https, kết thúc bằng `/`, không query/port; app phải
  có logo ≤512px nếu không trang ủy quyền báo lỗi.
- **Không cần Business Center / Seller Center**: khác GMV Max (vướng 40002), bình
  luận chỉ cần chủ tài khoản TikTok ủy quyền. Việc "gắn tài khoản vào shop" trên
  Seller Center không liên quan API; Hubsell tự cho gian nối N tài khoản.
- **Rate limit**: 40 lượt/phút mỗi tài khoản mỗi endpoint; cả app 600 lượt/phút
  (Basic). Đủ cho vài trăm tài khoản nếu dùng webhook thay vì quét.
- **Chống spam**: docs cảnh báo trả lời nhiều nội dung na ná trong thời gian ngắn
  sẽ bị hệ thống gắn spam → bình luận bị ẩn, webhook không báo `set_to_public`.
  Nghĩa là KHÔNG được bắn một câu mẫu cho mọi bình luận; phải đa dạng câu, giãn
  nhịp.
- Video > 500 bình luận: trang sau 500 trả lộn xộn/có trùng — đọc bằng webhook
  là chính, list chỉ để bù.

## 3. "Tự nhận biết khách hỏi giá, kích thước" — làm được, bằng AI của mình

API chỉ trả văn bản bình luận (`text`, `username`, `create_time`, `parent_comment_id`).
Phân loại ý định phải tự làm: Claude API (đã có `integrations/ai/copilot.ts`,
khuôn Context Injection) chấm mỗi bình luận → `price | size | shipping | stock |
how_to_buy | complaint | other`, kèm độ tin. Bối cảnh để trả lời đúng: chủ shop gắn
video ↔ sản phẩm Hubsell (giá, size, tồn) hoặc đặt FAQ chung cho gian; câu trả lời
sinh từ mẫu + biến, đảo chữ để khỏi trùng (chống spam). Mặc định **duyệt tay**
(hàng đợi "bình luận cần trả lời" + nút Gửi), bật tự động theo ý định an toàn
(giá/size) sau khi khách tin — cùng tinh thần diễn tập của Trợ lý quảng cáo.

## 4. Đề xuất lộ trình (chờ anh chốt)

1. **Xin quyền trước, không code UI** (nguyên tắc 12/10: không phơi tính năng chưa
   chạy): điền Accounts API Access Application Form + xin scope TikTok Accounts
   (Business Media + Business Comment) cho app Hubsell Ads. Em soạn hồ sơ, anh nộp
   trên Chrome. Rủi ro: bị từ chối hoặc đòi use case rõ — lưu nguyên văn.
2. Được duyệt → probe bằng tài khoản TikTok của anh: ủy quyền, video/list,
   comment/list, 1 lệnh reply thử, đăng ký webhook (callback Render).
3. Dựng v1 (~1 tuần): nối tài khoản (N tài khoản/gian), webhook + hàng đợi bền,
   phân loại ý định, hàng đợi duyệt tay + mẫu câu theo ý định, nhật ký; v2: tự
   động theo ý định + gắn video ↔ sản phẩm.

Nguồn (đọc 12/10): business-api.tiktok.com/portal/docs — accounts-api, accounts-api-
authorization, accounts-api-rate-limits, manage-comments-on-owned-tiktok-videos,
get-comments-on-an-owned-video, reply-to-an-existing-comment-on-an-owned-video,
subscribe-to-tiktok-account-webhook-events-via-webhooks-api, permission-scope.

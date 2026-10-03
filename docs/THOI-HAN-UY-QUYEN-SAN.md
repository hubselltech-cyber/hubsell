# Thời hạn ủy quyền gian hàng phía sàn (Shopee, TikTok)

Ngày lập: 03/10/2026. Người lập: Claude (Lead Dev). Trạng thái: **trên prod từ 03/10/2026** (`2b19f13`, `c33e107`, `133bec9`, `ee19e87`).

## 1. Chuyện gì xảy ra

Ngày 03/10/2026 gian Shopee "The White Active" (shop 1758390206) đang nối thì ngừng đồng bộ: mỗi lượt làm mới token Shopee trả `shop_access_expired — Your access to shop has expired`. Cùng ngày, ủy quyền app Hubsell Ads của gian "Farm Nuts - Hạt Dinh Dưỡng" gặp đúng mã đó. Hai gian vẫn mang trạng thái "đang nối", worker thử lại khoảng 9 phút một lần, chủ shop không có nút Kết nối lại (nút chỉ hiện khi gian đã ở trạng thái mất kết nối).

## 2. Nguyên nhân

Mỗi LẦN ủy quyền trên sàn có một thời hạn riêng. Hết hạn thì sàn ngừng cho app làm mới token, dù refresh_token còn hạn. Hubsell không làm gì sai, và cũng không tự cứu được: chủ shop phải ủy quyền lại.

Căn cứ (database prod, đọc 03/10/2026 23:16 sau khi Hubsell bắt đầu lưu ngày hết hạn):

| Gian Shopee | App | Ủy quyền lúc | Hết hạn | Thời hạn |
|---|---|---|---|---|
| Đa số gian (ANO, Hi.Bé, Samba, Nekio, Perlyco...) | cả hai | | đúng một năm sau | 365 ngày |
| The White Active | app chính | 26/09 13:45 | hết giữa 10:09 và 14:09 ngày 03/10 | 7 ngày |
| The White Active | Hubsell Ads | 26/09 13:45 | 26/09/2027 | 365 ngày |
| Farm Nuts | Hubsell Ads | 02/10 14:31 | hết giữa 13:53 và 17:53 ngày 03/10 | khoảng 1 ngày |
| Farm Nuts | app chính | 02/10 13:55 | 02/10/2027 | 365 ngày |
| Lyin.shop - Đèn Xinh | cả hai | 02/10 | 09/10/2026 15:06 | 7 ngày |
| Xưởng sỉ thời trang TM | app chính | 28/09 | 28/10/2026 | 30 ngày |
| LamGear | app chính | 02/10 | 01/11/2026 | 30 ngày |

Cùng một shop, ủy quyền cùng phút, mà hai app có hai thời hạn khác nhau: thời hạn gắn với từng lần ủy quyền, không gắn với shop hay với Hubsell.

TikTok cũng vậy: trang ủy quyền của TikTok có ô "Thời hạn cấp quyền", mặc định Không giới hạn. Trên prod hầu hết gian TikTok có ngày hết hạn rơi vào năm 2125; gian "Dao Em Liên 68" nối 22/09, hết hạn 01/10, và bị ngắt đúng ngày đó.

**Chưa kiểm:** em chưa tận mắt thấy ô chọn thời hạn trên trang ủy quyền của Shopee (suy ra từ số liệu trên và một bài hướng dẫn của bên thứ ba); mốc "khoảng 1 ngày" của Farm Nuts chưa giải thích được. Shopee không đẩy sự kiện ủy quyền nào về Hubsell (từ 01/10 `webhook_events` nguồn SHOPEE chỉ có sự kiện đơn, mã 3 và 4).

## 3. Đã làm

| Việc | Chỗ trong mã | Commit |
|---|---|---|
| Shopee trả `shop_access_expired` khi làm mới token app chính → hạ gian xuống DISCONNECTED ngay. Chỉ nhận đúng mã này; `invalid_refresh_token` không gộp vì có thể do hai luồng đua nhau làm mới. Ghi có điều kiện: gian còn ACTIVE và vẫn cầm đúng refresh_token vừa bị từ chối | `backend/src/integrations/shopee/service.ts` (`isShopeeAccessExpiredError`, `markShopeeAccessExpired`) | `2b19f13` |
| Cùng luật cho app Hubsell Ads | `backend/src/integrations/hubsell-ads/token.ts` | `c33e107` |
| Lưu ngày hết hạn ủy quyền Shopee (`expire_time` của `get_shop_info`): lúc ủy quyền, và mỗi ngày một lần cho từng gian đang nối, cả app chính lẫn Hubsell Ads. Hỏi không được thì giữ ngày cũ, hôm sau hỏi lại | `backend/src/integrations/shopee/auth-expiry.ts` (gọi từ `workers/token-refresh.ts`), `shopAuthExpireAt` ở `shopee/client.ts` | `133bec9` |
| Bốn cột `authExpireAt`, `authExpireCheckedAt` trên `Channel` và `channel_app_auths` | migration `20261003230000_shopee_auth_expire` | `133bec9` |
| Thẻ gian ở trang Kênh bán: dòng "Ủy quyền Shopee / TikTok đến dd/mm/yyyy" (chữ đỏ; còn từ 7 ngày trở xuống kèm nút Ủy quyền lại). Gian ngắt vì hết hạn: nhãn "Hết hạn ủy quyền" + "… báo hết hạn ủy quyền, bấm Kết nối lại". TikTok dùng ngày có sẵn trong token (`refreshTokenExpireAt`), để Không giới hạn thì không hiện dòng | `frontend/src/lib/channel-auth.ts`, `frontend/src/app/channels/page.tsx` | `133bec9`, `ee19e87` |
| Hướng dẫn nối Shopee thêm câu: nếu Shopee cho chọn thời hạn ủy quyền thì chọn mức dài nhất | `frontend/src/lib/guide-tours.ts` | `133bec9` |

Hệ quả: gian hết hạn tự chuyển sang mất kết nối, chủ shop thấy dải đỏ "gian mất kết nối" + nút Kết nối lại, worker thôi gọi sàn cho gian đó. Ủy quyền lại xong gian tự về đang nối.

Test: `shopee-access-expired-db.test.ts` (6 ca), `shopee-auth-expiry-db.test.ts` (5 ca), `hubsell-ads.test.ts` (thêm 1 ca). Đã kiểm trên prod 03/10: hai gian kẹt tự hạ sau khi bản sửa lên (22:15:52 và 23:13:02); 20/21 gian Shopee đang nối và 17/17 ủy quyền Hubsell Ads có ngày hết hạn; trang Kênh bán hiện ngày cho ANO và DarkMan.

## 4. Anh Trung đã chốt (03/10/2026)

- **Không làm nhắc trước hạn** (chuông, thẻ cảnh báo): "kệ họ, khi hết cũng thông báo là kết nối lại rồi". Đừng tự đề xuất lại.
- Dòng ngày hết hạn dùng chữ đỏ, cho cả Shopee lẫn TikTok.

## 5. Còn lại

- Câu thoại audio của bước "Xác nhận uỷ quyền" trong tour nối Shopee (`frontend/scripts/generate-guide-voice.js`) chưa đổi theo câu chữ mới.
- Dòng "Kỳ dịch vụ đến…" của Lazada giữ màu cũ (xám / vàng).
- Gian KYC 321947895 không lấy được ngày hết hạn (Shopee chặn API của gian này).
- Dòng TikTok có thời hạn chưa soi được trên trình duyệt (các gian TikTok của tài khoản quản lý đều Không giới hạn).
- Lượt hỏi ngày hết hạn chạy tối đa 300 gian mỗi app mỗi 30 phút (14.400 gian mỗi ngày); chạm trần thì log `[Auth-expiry] ... CÒN TỒN`.

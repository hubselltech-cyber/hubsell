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
| **27/10/2026 — luật mất ủy quyền CHUNG cho 3 sàn + Hubsell Ads** (thay cách nhận diện theo danh sách mã) — xem mục 6 | `backend/src/integrations/auth-loss.ts` + 4 nơi làm mới token | `247ace4f` (LIVE 27/10 ~10:58) |
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


## 6. Luật mất ủy quyền chung (27/10/2026) — loại bỏ hẳn kiểu "gian vẫn đang nối nhưng sàn đã từ chối"

### 6.1 Chuyện gì xảy ra
HPGear VN (Shopee, chủ nguyenhuuphat1932001@gmail.com) từ 26/10 08:52 VN: mỗi lần làm mới token Shopee trả `shop_no_linked — Partner and shop has no linked` (chủ shop gỡ app Hubsell trên Shopee, hoặc Shopee cắt liên kết). Gian vẫn ACTIVE 26 giờ, 158 lượt thử vô ích, chủ shop không có nút Kết nối lại, HQ đỏ ở mục "Mốc nước quét đơn 1524′" thay vì mục "Gian rớt kết nối".

### 6.2 Gốc
Lần thứ BA cùng một kiểu (03/10 The White Active 55 lượt, Shopee 321947895 1.069 lượt, 26/10 HPGear VN 158 lượt). Mã chỉ nhận diện mất quyền bằng DANH SÁCH MÃ LỖI đã gặp (`shop_access_expired`), sàn trả mã mới là kẹt. Thêm từng mã khi gặp = vá. TikTok và Lazada còn không có nhánh nào: sàn từ chối làm mới thì chỉ ném lỗi, gian ACTIVE mãi.

### 6.3 Thiết kế (integrations/auth-loss.ts)
1. **Phân loại theo NGUỒN, không theo mã** (`classifyRefreshFailure`):
   - *transient* — không tới được sàn, sàn hỏng, trần gọi, câu Hubsell tự ném, hình dạng lạ → không đếm, không bao giờ hạ;
   - *lost_now* — mã sàn nói thẳng shop không còn ủy quyền (`shop_access_expired`, `shop_no_linked`) → hạ ngay;
   - *rejected* — sàn TRẢ LỜI và từ chối bằng mã nghiệp vụ BẤT KỲ (tiền tố `Shopee/Lazada refresh token lỗi:`, `TikTok auth lỗi (code …)`) → đếm.
2. **Đếm theo gian** (`authRejectCount`, `authRejectSince`, `authLostReason` trên `Channel` và `channel_app_auths`, migration `20261027110000_channel_auth_reject`): ghi có điều kiện ngay trong SQL — gian còn ACTIVE và DB vẫn cầm đúng refresh_token vừa bị từ chối. Đủ **3 lần trải ≥ 30′** → DISCONNECTED. Căn cứ ngưỡng: bằng ngưỡng `SYNC_STALL_THRESHOLD` (3 nhịp quét 10′) đã dùng cho thẻ "trễ đồng bộ" từ 09/2026; đua rotate token chỉ kéo dài vài giây và luôn đổi token trong DB nên không thể bị đếm 3 lần trải 30′.
3. **Lưới thứ hai** (workers/order-auto-sync.ts): lượt quét gặp lỗi LỚP QUYỀN theo bảng phân loại của cổng gọi sàn (`classifierFor(...).kind === "auth"`) → ép access_token "đã hết hạn" để lượt kế phải làm mới và luật 1–2 phán xử. Không chờ access_token tự hết (TikTok 7 ngày).
4. **Xóa dấu**: làm mới thành công, hoặc ủy quyền lại (5 đường nối lại: Shopee, TikTok, Lazada, nối tay, Hubsell Ads) → đếm về 0, xóa lý do.
5. **Áp cho**: Shopee app chính, TikTok, Lazada, Hubsell Ads (Ads giữ danh sách hạ ngay cũ, mã lạ đi luật đếm).

### 6.4 Khách thấy gì
Thẻ gian ở trang Kênh bán: nhãn **"Mất ủy quyền"**, dòng đỏ theo mã: `shop_no_linked` → "Shopee báo gian đã gỡ ủy quyền cho Hubsell, bấm Kết nối lại để nối lại"; mã khác → "<Sàn> từ chối làm mới quyền (<mã>), bấm Kết nối lại"; `shop_access_expired` giữ câu "báo hết hạn ủy quyền" cũ. Chuông "Gian mất kết nối" có sẵn (ops-alerts) tự bật vì gian đã DISCONNECTED. Soi trên máy local 27/10 (gian Demo Shopee giả lập, trả lại như cũ sau khi soi).

HQ: dấu hiệu "Gian rớt kết nối / sàn trễ đồng bộ" nêu tên ≤ 3 gian ACTIVE lỗi ≥ 3 lượt kèm mã lỗi, không phải tra SQL.

### 6.5 Kiểm
- `auth-loss-db.test.ts` 9 ca (phân loại; HPGear hạ ngay; mã lạ 3 lần < 30′ giữ ACTIVE, ≥ 30′ hạ; mạng/trần gọi không đếm; token đã đổi không đếm; làm mới thành công xóa dấu; TikTok theo cùng luật); `shopee-access-expired-db`, `hubsell-ads`, `shopee-auth-expiry-db` xanh. Toàn bộ backend: 1.915 qua, 5 đỏ có sẵn (sổ cái / xóa gian trên DB dev thiếu trigger). `tsc --noEmit` sạch cả backend lẫn frontend.
- Quét prod 27/10 10:45: chỉ HPGear VN là gian ACTIVE lỗi kéo dài; 12 gian rớt trong 30 ngày đều đã DISCONNECTED đúng.
- **✅ Kiểm prod 27/10 11:00:** migration xong 10:58:59; HPGear VN tự hạ DISCONNECTED 10:59:21 (authLostReason shop_no_linked); không gian nào khác bị đếm; 0 gian ACTIVE lỗi ≥ 3 lượt.
- **Sau deploy:** cron token-refresh (30′) gọi làm mới HPGear VN → log `[Auth-loss] Shopee "HPGear VN" … shop_no_linked — mã chắc chắn → DISCONNECTED`; HQ hết đỏ mục mốc nước. Sau đó mỗi lần sàn từ chối bằng mã lạ sẽ có log `[Auth-loss] … lần n/3` — mã nào lặp nhiều thì cân nhắc thêm vào nhóm hạ ngay (ghi căn cứ).

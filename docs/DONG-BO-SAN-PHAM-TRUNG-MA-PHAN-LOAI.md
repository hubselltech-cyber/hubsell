# Đồng bộ sản phẩm: một mã người bán cho nhiều phân loại (15/10/2026)

> Sự cố khách **Hi.Bé** (Nguyễn Trung Huy, `huyut2k`): "SKU kéo về không đúng, màu Hồng có 5 size mà
> Hubsell chỉ về 1 dòng, không cập nhật được tồn các size". Anh Trung nghi gọi sai API (chỉ tầng 1).
> Khảo sát + đo số thật cho thấy không phải API, mà là bước **gộp dòng trùng mã** trong adapter.

## 1. Khảo sát API phân loại 3 sàn (15/10/2026)

| Sàn | API sản phẩm | Số tầng tối đa | Cấu trúc trả về |
|---|---|---|---|
| Shopee | `get_item_base_info` + `get_model_list` | **2** (Phân loại 1 / Phân loại 2 trong Seller Center) | `model[]` phẳng, mỗi model = MỘT tổ hợp đủ tầng, có `tier_index` ví dụ `[0, 1]` (đọc docs open.shopee.com bằng trình duyệt). |
| TikTok Shop | `GET /product/202309/products/{id}` | 3 thuộc tính bán hàng (hiểu biết, docs chặn fetch tự động) | `skus[]` phẳng, mỗi sku có `sales_attributes[]` đủ thuộc tính. |
| Lazada | `/products/get` | 2 thuộc tính thường gặp (chưa đối chiếu docs) | `skus[]` phẳng, mỗi sku có `saleProp {color_family, size}`; `Variation` KHÔNG có trong payload thật. |

Kết luận: **không sàn nào trả phân loại lồng nhau**. Adapter Hubsell từ đầu đã lặp qua mọi sku lá.
Mặt hàng "3-4 tầng" không tồn tại trên 3 sàn này.

## 2. Thủ phạm thật và số đo prod

Cả 3 adapter (`backend/src/marketplace/adapters/*`) có bước "Gộp các dòng TRÙNG channelSku": người bán
bấm **"Áp dụng cho tất cả phân loại"** trên Shopee (hoặc nhập cùng seller_sku trên TikTok) → 5 size cùng
`model_sku` → gộp thành MỘT dòng, `variantName = null`, `externalId` = model ĐẦU, tồn cộng dồn. Hậu quả:

- `stock-push-worker` chỉ `update_stock` cho 1 model; 4 size còn lại trên sàn không bao giờ nhận tồn.
- `stock-refresh` đối soát cũng chỉ đọc 1 model → không báo lệch.
- Bảng Hàng hóa thiếu dòng, giá vốn theo gian không đặt được theo size.

SQL chỉ đọc trên Supabase (dấu vết: `externalId LIKE '%-%' AND variantName IS NULL`, với TikTok thêm
`imageUrl IS NOT NULL` vì dòng chưa bổ sung chi tiết cũng trống tên):

| Phạm vi | Kết quả |
|---|---|
| Hi.Bé Shopee | 319 / 361 dòng ACTIVE bị gộp (ví dụ `LT075-HONG` tồn 295 = cộng dồn các size) |
| Hi.Bé TikTok | 392 / 467 dòng bị gộp (`LT121-BE`, `AQ004-CAM`…) |
| Hi.Bé Lazada | KHÔNG gộp (SellerSku riêng từng size `LT004-Be-3-5kg`), chỉ trống tên phân loại |
| Toàn nền tảng Shopee | 13 khách / 14 gian / 1.391 dòng (lớn nhất XPL2 STORE 906, Hi.Bé 319, Biocare365 49, ANO 31…) |
| Toàn nền tảng TikTok | 12 gian / ~700 dòng (Hi.Bé 392, Samba 105, and.not.or 72, DARKMAN 48…) |
| Gian đang BẬT đồng bộ tồn | 0 — chưa khách nào mất đẩy tồn, nhưng danh mục / giá vốn / đơn theo size đều sai |

## 3. Cách sửa (code 15/10/2026)

Nguyên tắc mới, một nơi: `backend/src/marketplace/sku-key.ts`.

1. **Không gộp.** Mỗi phân loại lá trên sàn = một dòng `ChannelProduct`.
2. **Danh tính dòng = `externalId`** (`item-model` / `item-sku` / `product-sku`). `channelSku` chỉ là khóa
   hiển thị + khóa khớp kho, duy nhất trong gian (unique DB giữ nguyên).
3. **Mã trùng trong gian → đuôi tên phân loại**, khách đọc được (anh Trung chốt, không dùng id):
   `LT075-HONG (Hồng, 3-5kg)`, `LT075-HONG (Hồng, 5-7kg)`. Tên chuẩn hóa `normalizeVariantName` để Shopee
   `Hồng,3-5kg` và TikTok `Hồng, 3-5kg` ra cùng đuôi (mapping giá vốn trùng mã giữa gian vẫn khớp).
   Chưa biết tên (TikTok lượt chưa bổ sung chi tiết) → tạm `LT075-HONG #<skuId>`; có tên thì đổi khóa.
   Trùng cả mã lẫn tên → `… (tên) #id`. Mã duy nhất **giữ nguyên** — khách khác không đổi gì.
4. **`product-sync` đổi khóa tại chỗ theo externalId**: dòng gộp cũ `LT075-HONG` (externalId model đầu,
   đã nối kho, có giá vốn) → thành `LT075-HONG (Hồng, 3-5kg)` GIỮ `productId` + `costPrice`; 4 size còn
   lại tạo mới (chưa nối kho). Đổi tên phân loại trên sàn cũng chỉ đổi khóa, không tạo dòng mới + DELISTED
   dòng cũ. Khóa mới đang thuộc dòng khác → không đổi (giữ unique), đếm vào log. DELISTED theo tập id đã
   chạm, không theo khóa. Mỗi lượt sync đọc toàn bộ dòng của gian một lần (đã cần cho bước DELISTED).
5. **Đơn hàng khớp theo id sàn trước** (`backend/src/integrations/order-line-keys.ts`): Shopee gom dòng
   theo `item_id-model_id`, TikTok theo `product_id-sku_id` (hai size cùng mã không còn gộp thành một
   dòng đơn); `OrderItem.channelSku` ghi khóa của dòng sàn khớp được (có đuôi) để Lãi/Lỗ theo SKU, ảnh
   dòng đơn, điền bù giá vốn (`SKU_MATCH` so bằng) trỏ đúng size. Không khớp → giữ mã thô như cũ. Lazada
   giữ khớp theo SellerSku (sàn bắt duy nhất, dòng đơn không có sku_id).
6. **Hoàn hàng**: kế hoạch hoàn giữ thêm map theo id (`itemReturnsByExternalId` Shopee, `itemReturnsBySkuId`
   TikTok); bước áp dụng chỉ tra `expandReturnKeys` (một truy vấn) khi khóa dòng đơn không khớp mã thô.
7. **`stock-refresh`** (Lazada/TikTok) khớp dòng đã nối theo externalId, mã là đường lui.
8. **TikTok chạy nền bổ sung chi tiết** (`writeProductDetail`) ghi tên phân loại cho mọi dòng (trước
   đây cố ý để null khi trùng mã) và đổi khóa tạm `#skuId` → `(tên)` ngay nếu không đụng khóa.
9. **Lazada** đọc tên phân loại từ `saleProp` (payload thật không có `Variation`).
10. Migration `20261015150000_channel_product_external_id_index`: chỉ mục `(channelId, externalId)`.

Đơn cũ đã ghi mã thô `LT075-HONG` không sửa lại (snapshot giá vốn đã có từ lúc tạo đơn).

## 4. Việc với khách sau deploy

- Hi.Bé: bấm **Đồng bộ từ sàn** cho Shopee + TikTok (hoặc chờ worker danh mục) → 4 size/màu tách dòng,
  dòng cũ giữ liên kết kho. Khách tự nối 4 dòng mới vào SKU kho tương ứng (hoặc "Nối SKU nhanh" tạo SKU kho).
- Lời khuyên gốc cho khách: đặt SKU riêng từng size ngay trên sàn (đừng "Áp dụng cho tất cả phân loại");
  Hubsell nay không mất dòng dù khách để trùng.
- XPL2 STORE (906 dòng) là gian ảnh hưởng lớn nhất — lượt sync đầu sẽ tạo nhiều dòng mới, log
  `[product-sync] … dòng trùng mã được thêm đuôi phân loại, … dòng đổi khóa`.

## 5. Kiểm chứng

- `marketplace/__tests__/sku-key.test.ts` 10 ca (thuần): mã duy nhất giữ nguyên, 5 size tách dòng không
  cộng tồn, `#id` khi chưa có tên + gợi ý từ DB, trùng cả tên, ổn định theo thứ tự, không đụng mã sẵn có,
  Lazada saleProp.
- `marketplace/__tests__/product-sync.test.ts` 4 ca (DB dev, adapter mock): dòng gộp cũ đổi khóa giữ
  productId + giá vốn, 4 size tạo mới, 0 DELISTED oan; đổi tên phân loại → đổi khóa; lượt không trả tên
  → khóa không nhảy; khóa bị chiếm → giữ khóa cũ, sàn bỏ model → DELISTED.
- `integrations/__tests__/order-line-keys.test.ts` 5 ca (DB dev): id sàn thắng mã thô, hai size cùng mã ra
  hai dòng đơn (Shopee + TikTok), hoàn hàng tra theo id đầy đủ và id lá.
- Bộ test có sẵn đi qua: order-sync-write 16, shopee/tiktok/lazada-returns-sync, tiktok-product-adapter,
  stock-push, inventory-reconcile, cost-per-shop, cost-mapping, stock-locations — xanh; tsc sạch.

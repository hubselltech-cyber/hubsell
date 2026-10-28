# Mô hình cây sản phẩm sàn — danh tính theo id, không theo mã (18/10/2026)

> Anh Trung chốt 18/10/2026: "làm từng lát, chuyên nghiệp của một senior, mô hình tree luôn được đảm bảo
> nhất quán". Tệp này là HỢP ĐỒNG dữ liệu cho mọi chỗ nối đơn hàng ↔ sản phẩm sàn ↔ quảng cáo. Bất kỳ
> code mới nào đụng `channelSku` để gom số theo sản phẩm phải đọc mục 2 trước.

## 1. Vì sao có tệp này

Khách hỏi "hòa vốn TikTok và Shopee tính khác nhau à?" → kiểm prod 18/10 thấy chiến dịch **TC025 NEW**
(gian TikTok `and.not.or`, chủ admin@hubsell.vn) báo hòa vốn **8,90** trong khi tính đủ đơn là **7,10**
(cao hơn thật ~25%). Dòng "Đối chiếu doanh thu" của ô Hòa vốn đã bắt được: Hubsell thấy 15,4 triệu,
TikTok báo 60,0 triệu (−74%).

Nguyên nhân trực tiếp: bản sửa gộp phân loại 15/10 (`f7b597d8`, [DONG-BO-SAN-PHAM-TRUNG-MA-PHAN-LOAI.md])
đổi mã `TC025-XAM` thành `TC025-XAM (XÁM)` / `TC025-XAM (XÁM LOGO)`; 193 dòng đơn cũ giữ mã thô nên rơi
khỏi tập SKU của chiến dịch.

Nguyên nhân gốc (thiết kế): **dòng đơn không lưu danh tính sàn**. `OrderItem` chỉ có `channelSku` (chuỗi
hiển thị) + `productId` (kho, nullable). `integrations/order-line-keys.ts` tra id lá lúc tạo đơn rồi vứt;
đơn đã tạo không bao giờ đụng lại `OrderItem` (chủ ý, giữ snapshot giá vốn). Mọi phép gom theo sản phẩm
phải đi vòng ChannelProduct → `channelSku` → so chuỗi với OrderItem; mỗi lần khóa đổi là một lớp vá:
`SKU_MATCH` 3 nhánh (giá vốn), `startsWith "("` (ảnh), `expandReturnKeys` (hoàn), và nay hòa vốn — lần
thứ tư vá cùng một chỗ.

## 2. Mô hình cây và các bất biến

```
Gian (Channel)
└── Sản phẩm sàn — SPU        Shopee item_id · TikTok product_id · Lazada item_id
    └── Lá — tổ hợp đủ tầng   Shopee model_id · TikTok sku_id · Lazada SkuId
        │   (Màu × Size…; sàn trả PHẲNG, mỗi tổ hợp một lá, tầng chỉ nằm trong TÊN)
        └── Dòng đơn / dòng hoàn / dòng sổ cái
```

| # | Bất biến | Nơi giữ |
|---|---|---|
| B1 | **Danh tính của lá là id sàn** (`ChannelProduct.externalId = "item-leaf"`; SP đơn Shopee = `"item"`). Mã người bán / tên phân loại chỉ để hiển thị và khớp kho. | `marketplace/sku-key.ts`, 3 adapter |
| B2 | Mỗi lá trên sàn = **đúng một** dòng `ChannelProduct`; `channelSku` duy nhất trong gian (đuôi tên phân loại khi mã trùng). Không gộp. | `product-sync` |
| B3 | **Dòng đơn nối vào lá bằng id lá**; mã thô chỉ là đường lui khi sàn không cho id (Lazada hiện tại) hoặc danh mục chưa có lá. | `order-line-keys.ts` (lúc tạo) — ⏳ Lát 1: LƯU id vào `OrderItem.externalId` |
| B4 | **Gom theo sản phẩm / chiến dịch = gom theo item_id** (SPU) của lá, không gom theo chuỗi mã. Chiến dịch → `AdsCampaign.itemIds` (SPU) → lá → dòng đơn. | `lib/ads-margin.ts groupSkusByItemId` (đang đi qua chuỗi — ⏳ Lát 1) |
| B5 | Nối kho (`productId`) là quan hệ riêng, không thay thế danh tính sàn; **không đặt hồi tố** lên đơn cũ (tránh cộng kho ảo khi hoàn — `lib/cost-price.ts`). | — |
| B6 | Số liệu cấp sản phẩm chỉ cộng dòng đơn **nối sản phẩm bằng id lá**; dòng chỉ khớp được bằng mã thô là phần **"chưa tính được"** của độ phủ (cùng rào 90 % với thiếu giá vốn), độ phủ thấp thì **không được dùng để quyết định** (hòa vốn, luật tự động, lãi ước tính). *(Bản 18/10 viết "tự kiểm với sàn" — bỏ 28/10, mục 12: doanh thu sàn gán cho chiến dịch không phải thước đo lỗi cây.)* | TikTok: `lib/tiktok-breakeven.ts unlinkedRevenue` (mục 12). Shopee: còn phép một chiều `direct_gmv` (Lát 4) — đo lại sau |
| B7 | Giá vốn đi theo lá (`costPrice` của dòng gian > giá kho); lá mới tách ra phải có giá vốn ngay, không chờ khách tự nối. | ⏳ Lát 3 |

Giới hạn chấp nhận: khách **đăng lại tin** (item_id mới) → lịch sử tách giữa tin cũ và tin mới. Với hòa vốn
chiến dịch đó là đúng (chiến dịch chạy tin mới); hòa vốn theo sản phẩm KHO gộp qua `productId`.

## 3. Số đo prod 18/10/2026 (Supabase SQL Editor, chỉ đọc)

| Phát hiện | Số |
|---|---|
| Dòng đơn mang mã thô mà danh mục đã đổi đuôi (mồ côi) | **24.596 dòng · 32 gian · 27 khách · 3,87 tỷ** (60 ngày: 2,40 tỷ); Shopee 22 gian 2,08 tỷ · TikTok 10 gian 1,79 tỷ |
| … mã thô ứng đúng 1 sản phẩm (suy luận được) | 287 mã · 1,37 tỷ |
| … mã thô dùng chung nhiều sản phẩm (phải hỏi sàn) | 874 mã · 2,50 tỷ (vd LUMI SOLAR một mã cho nhiều tin đăng) |
| Dòng SKU đang bán **không có mã người bán** (khóa đã là id) | **55%** — Shopee 14.204 dòng/39 gian, TikTok 3.123/11 gian → nhóm này chưa bao giờ hỏng |
| Hình dạng: Shopee 1 tầng 5.983 · 2 tầng 20.985 · SP đơn 713; TikTok 1 tầng 3.000 · 2 tầng 3.633 | Shopee tối đa 2 tầng; 34 dòng "3 tầng" là dấu phẩy trong tên |
| Dòng đơn 60 ngày **không khớp dòng SKU sàn nào** theo chuỗi | TikTok trước 15/10 **25,8%** (20.057 dòng, 1,64 tỷ, 13 gian); Shopee 12,1% (4.955 dòng, 1,46 tỷ, 31 gian) |
| Sau 15/10 (khớp id lúc tạo đơn) | TikTok 15/10: 1.413 (đơn về trước deploy) · 16/10: 49 · 17–18/10: **0** → khớp id chạy đúng. Shopee 16–17/10 ~30 dòng/ngày = đơn về TRƯỚC khi danh mục tách (danh mục đồng bộ đêm 03:00 / bấm tay) → mồ côi vĩnh viễn vì id không được lưu |
| Giá vốn khác nhau giữa các lá cùng mã | Shopee 0 nhóm · TikTok 1 nhóm (khách chưa đặt giá theo size) |
| Lá tạo mới 15/10 không thừa kế giá vốn | 7.934/8.612 nhóm Shopee · 728/890 TikTok có lá chưa giá vốn → đơn 15–18/10: 849 dòng có đuôi, 703 giá vốn 0, **79 dòng (~36 triệu, 13 gian)** mất do bản 15/10 |
| TC025 (and.not.or) tính lại đúng luật | app: 45 đơn / 8,90 · mồ côi `TC025-XAM`: 142 đơn / 6,72 · **đúng: 187 đơn + 51 hủy, 60,3 tr, biên lãi 14,1%, hòa vốn 7,10** |

Bẫy khi đo: lưới Supabase ảo hóa dòng (chỉ đọc được dòng trong khung nhìn → đếm tổng bằng GROUP BY);
dòng gộp cũ được **đổi khóa tại chỗ** nên `ChannelProduct.createdAt` không phải lúc tách.

## 4. Kế hoạch 5 lát (anh chốt 18/10: làm từng lát)

| Lát | Việc | Trạng thái |
|---|---|---|
| **0** | **Chặn tạm**: đối chiếu doanh thu lệch quá ngưỡng → hòa vốn "chưa tin được": không hiện số, luật tự động rơi về % mục tiêu, Lãi/lỗ ước tính "—", nhận định "Chưa kết luận được" kèm lý do. Không đổi dữ liệu. | ✅ code 18/10 (mục 5) → **⛔ BỎ 28/10 cho TikTok** (báo động oan diện rộng — mục 12) |
| 1 | Nền đúng: `OrderItem.externalId` (id lá) + `itemId` (SPU) trong sổ dòng hàng; 3 luồng tạo đơn ghi id (Lazada: mã trước, id khi có mẫu — anh chốt 18/10); mọi phép gom đổi sang id trước, mã sau; gỡ dần 4 lớp vá chuỗi. Migration thêm cột NULL, lấy khóa có thử lại. | ✅ 1a (mục 6.8) · ✅ 1b (mục 6.9) · ✅ 1c code 18/10 (mục 6.10) |
| 2 | Bù đơn cũ: HỎI SÀN cho mọi dòng chưa có id của gian ACTIVE trong 90 ngày (mồ côi trước), lô 50, nghỉ 2 s; ghi `externalId` + đổi `channelSku`; GIỮ `costPriceAtSale`, KHÔNG đặt `productId`; gian không gọi được sàn suy luận hẹp (mục 7). | ✅ code 18/10 (mục 7.7) |
| 3 | Lá mới thừa kế giá vốn THEO LỊCH SỬ khách đã đặt cho cùng mã thô (không bịa, không nhắc — anh chốt 18/10); vá hồi tố 79 dòng. | ✅ chạy xong prod 18/10 (828 lá, mục 8.7–8.8) — việc một lần, **mã đã gỡ** (mục 11), cột `costPriceInheritedAt` giữ làm dấu + đường lui |
| 4 | Tự kiểm doanh thu cho Shopee — kiểm MỘT CHIỀU theo `direct_gmv` (sàn chỉ báo doanh thu gán cho quảng cáo); cùng lưới B6. | ✅ code 18/10 (mục 10.6) |
| — | Lượt vá định kỳ dòng đơn giá vốn 0 của lá đã có giá — bước sau mỗi lượt kéo danh mục một gian (mục 9). | ✅ code 18/10 (mục 9.4) |

## 5. Lát 0 — chi tiết (18/10/2026) — ⛔ ĐÃ GỠ KHỎI MÃ TikTok 28/10/2026 (mục 12); giữ làm sử

> Phép so doanh thu Hubsell ↔ TikTok dưới đây bắt đúng ca TC025 (Hubsell THIẾU) nhưng gạt oan mọi gian xoay sản phẩm
> giữa chiến dịch / LIVE (Hubsell "THỪA" giả — mục 12). Hàm `breakevenCheckProblem`, `check`, `checkProblem`, `placedRevenue`
> phía TikTok đã gỡ; Shopee (Lát 4, mục 10) chưa đụng.

- Luật thuần `lib/tiktok-breakeven.ts`: `breakevenCheckGapPct(check)` = (Hubsell − TikTok) ÷ TikTok;
  `breakevenCheckProblem(check)` trả lý do khi |lệch| > `TIKTOK_BREAKEVEN_CHECK_MAX_GAP_PCT` (**25 — MẶC ĐỊNH
  TỰ CHỌN**, chưa có số nào của sàn: ba chiến dịch khỏe của and.not.or lệch +4,0 / +4,7 / +8,8%, chiến dịch
  hỏng −74%; ngưỡng cũ trong docs ADS-TIKTOK-GMV-MAX mục 8 là "sát nhau" / 10% chưa từng được cài). Hai chiều
  đều là lỗi cây: Hubsell THIẾU (dòng đơn chưa nối đúng lá) hay THỪA (mã dùng chung kéo đơn sản phẩm khác).
- `TiktokBreakeven.checkProblem` ("" = ổn) gắn ở `integrations/tiktok-ads/breakeven.ts` cùng chỗ gắn `check`
  (chỉ nguồn `campaign`; nguồn `product` / `shop` không có tự kiểm → không đổi).
- Nơi dùng: `auto-rules.breakevenUnusableReason` (luật tự động + popup cấu hình + backtest), `campaign-advice`
  (qua cùng hàm → "Chưa kết luận được"), `tiktokEstProfit` → null, `loadStepChecks` không lấy biên lãi,
  `breakevenForUi` trả `problem` và **xóa `roi`/`margin`** để không client nào (web, mobile) hiện số chưa tin.
- UI web: ô Hòa vốn hiện "Chưa tin được" (vàng), popover dòng đầu là lý do + câu "Hubsell đang rà lại cách nối
  đơn với sản phẩm". Mobile hiện "—" (chưa có chữ lý do — bổ sung khi làm lát mobile).
- Hệ quả với khách hôm nay: TC025 NEW hết hiện 8,90; ba chiến dịch còn lại (lệch < 10%) giữ nguyên.

## 6. Lát 1 — thiết kế (18/10/2026; anh chốt 6.7, đã làm 6.8–6.10, LIVE)

Mục tiêu: từ nay mọi dòng đơn mới **mang id lá sàn**, và mọi phép gom theo sản phẩm / chiến dịch **đi theo id trước,
mã sau**. Không bù đơn cũ (Lát 2), không đổi tiền (sổ cái không tăng phiên bản công thức).

### 6.1 Dữ liệu

| Bảng | Thêm | Ghi chú |
|---|---|---|
| `OrderItem` | `externalId text NULL` — id lá đúng khuôn `ChannelProduct.externalId` (`"item-leaf"`; SP đơn Shopee `"item"`) | Chỉ mục `OrderItem(externalId) WHERE externalId IS NOT NULL` cho vá giá vốn theo id + Lát 2. Prod 18/10: 214 nghìn dòng / 116 MB → `ADD COLUMN NULL` là siêu dữ liệu, chỉ mục thường xây dưới 1 giây. `ALTER TABLE` vẫn cần ACCESS EXCLUSIVE chốc lát trên bảng nóng → **khối lấy khóa có thử lại** như `20260930230000_order_ledger` (bẫy deadlock 30/09). |
| `order_line_ledger` | `externalId text NULL`, `itemId text NULL` (SPU = phần trước dấu `-`, cột riêng để JOIN/GROUP BY không `split_part`) | Chỉ mục `(channelId, itemId) WHERE itemId IS NOT NULL`. Bảng phân mảnh theo tháng: `ALTER TABLE` cha lan xuống mọi mảnh; chỉ mục tạo trên cha tự gắn vào mảnh mới; `order_ledger_create_month_partition` dùng `PARTITION OF` / `LIKE … INCLUDING` nên mảnh mới thừa kế cột. Dòng sổ cũ: NULL cho tới khi đơn được tính lại (trigger `order_ledger_trg_order_item` bắt UPDATE OrderItem → Lát 2 bù xong là sổ tự theo). **Không tăng `LEDGER_FORMULA_VERSION`** (tiền không đổi, tránh tính lại toàn bộ). |

Sổ dòng hàng: `lib/order-ledger.ts` chép `externalId` từ OrderItem, suy `itemId`; `LINE_COLUMNS` + `LINE_JSON_TYPES` + `lineJson`
thêm hai cột; `PNL_INCLUDE` (items) đọc thêm `externalId`.

### 6.2 Ghi id lúc tạo đơn — 3 sàn, một luật

| Sàn | Nguồn id trên dòng đơn | Việc |
|---|---|---|
| Shopee | `item_id` + `model_id` (`shopeeLineExternalId`, đã có) | `orderItem.create` ghi `externalId: mp?.externalId ?? line.externalId` — ghi id **kể cả khi danh mục chưa có lá** (đây là chỗ Shopee đang mồ côi ~30 dòng/ngày: về sau danh mục có là tra được, không cần sửa dòng). |
| TikTok | `product_id` + `sku_id` (`tiktokLineExternalId`, đã có) | Như Shopee. |
| Lazada | Dòng đơn hiện **chưa dựng id** (chỉ so SellerSku). Payload `LazadaOrderItem` có `product_id` + `shop_sku`; docs GetOrderItems còn `sku_id` — **chưa kiểm bằng payload thật**. | `aggregateLazadaItems` dựng `externalId = "${product_id}-${sku_id}"` khi có; không có → NULL (giữ mã). `resolveOrderLineRows` thay cho `findMany` theo `channelSku` → Lazada vào cùng luật "id trước, mã sau". ⚠️ Cần soi 1 payload đơn thật (prod chỉ 1 gian Lazada đang hoạt động) trước khi chốt tên trường. |

Webhook 3 sàn đi cùng `upsertOrderTx` → tự có. Đơn đã tồn tại: vẫn **không** đụng OrderItem (giữ snapshot giá vốn) — bù id cho
dòng cũ là việc của Lát 2, có kiểm soát riêng.

### 6.3 Gom theo id — "id trước, mã sau"

Hiện `groupSkusByItemId` (lib/ads-margin) dựng tập **mã** cho mỗi sản phẩm, rồi hai câu SQL (`ledgerMarginByGroup`,
`ledgerTiktokBreakevenByGroup`) và đường "rows" đều nối `map.sku = line.channelSku`. Đổi thành:

- `AdsGroupSets` mang **hai tập** cho mỗi nhóm: `itemIds` (chiến dịch → `AdsCampaign.itemIds`; sản phẩm → chính nó) và
  `skus` (đường lui, giữ nguyên cách dựng cũ). `adsGroupMappingOf` trải thành **hai cặp mảng** `(grp, itemId)` và `(grp, sku)`;
  `digest` băm cả hai → bộ đệm 30 phút tự làm mới khi bộ nhóm đổi.
- SQL: hai CTE `mapItem` / `mapSku`; dòng có `itemId` nối `mapItem`, dòng `itemId IS NULL` nối `mapSku` (`UNION ALL`, không
  `OR` trong JOIN để giữ kế hoạch chạy đã đo 1,6 giây / 405 nghìn dòng). Phần "checks" (tự kiểm) cùng cách.
- Đường "rows" (lưới đỡ, test, công cụ `ads-compare`): `MarginRow.items` / `BreakevenPnlRow.items` thêm `itemId?`; khớp itemId
  trước, mã sau. Test "hai đường bằng nhau" chạy với **cả** dòng có id lẫn không id.
- Tab Hòa vốn sản phẩm: `productGroupKey(itemId)` nối thẳng theo `itemId` — không qua mã nữa.
- Chiến dịch → SPU đã là id ở cả ba sàn (Shopee `item_id_list`, TikTok SPU của GMV Max, Lazada adgroup → item), không đổi.

Hệ quả có thể đo được sau deploy: ba chiến dịch khỏe của and.not.or **giữ nguyên số** (dòng cũ đi đường lui mã); TC025 NEW
vẫn "Chưa tin được" cho tới Lát 2 — đúng kỳ vọng, không được "khỏi bệnh" sớm hơn vì chưa có đơn cũ nào được bù.

### 6.4 Bốn lớp vá chuỗi — gỡ dần, không gỡ cùng lúc

| Lớp vá | Lát 1 | Sau Lát 2 |
|---|---|---|
| `lib/cost-price.ts SKU_MATCH` (vá giá vốn đơn cũ) | ✅ 1c: dòng có id khớp **chỉ** bằng `oi.externalId = cp.externalId`; ba nhánh chuỗi chỉ còn cho dòng `externalId IS NULL` | giữ chuỗi làm đường lui vĩnh viễn cho Lazada chưa có id |
| `order-item-images` (`startsWith "("`) | giữ | ✅ 18/10 chiều (mục 11): dòng sàn có id → `OrderItem.externalId` trước; mã (kể cả `startsWith "("`) chỉ cho dòng đơn `externalId IS NULL` |
| `expandReturnKeys` (hoàn hàng) | giữ | ✅ 18/10 chiều (mục 11): `returnedQtyOf` khớp `OrderItem.externalId` thẳng (TikTok theo phần sku_id); mã + expand chỉ cho dòng chưa có id |
| Hòa vốn / biên lãi (ads) | **đổi sang id** (6.3) | — |

Lý do để ảnh + hoàn sang sau: dòng cũ chưa có id thì lợi ích = 0, mà mỗi lớp là một bộ test riêng; gỡ từng lớp sau khi Lát 2
đã bù để đo được "đường lui mã còn bắt bao nhiêu dòng".

### 6.5 Thứ tự đưa lên (ba lần push, mỗi lần test + tsc + kiểm prod riêng)

1. **1a — nền:** migration + schema + ghi id lúc tạo đơn 3 sàn + sổ dòng hàng mang `externalId`/`itemId`. Kiểm prod: đơn mới sau
   deploy có `externalId`; dòng sổ mới có `itemId`; số báo cáo **không đổi**.
2. **1b — gom theo id:** lib + hai câu SQL + hai nguồn + tab sản phẩm + công cụ đối chiếu. Kiểm prod: `ads-compare` hai đường
   bằng nhau; ba chiến dịch khỏe không đổi số.
3. **1c — vá giá vốn theo id:** nhánh đầu `SKU_MATCH` + test DB.

### 6.6 Rủi ro và đường lui

- Chỉ **thêm cột NULL**, không xóa, không đổi tiền → đường lui = revert commit, cột thừa vô hại.
- Migration đụng `OrderItem` lúc Render khởi động song song instance cũ → khối khóa thử lại 40 lần × 3 giây (đã dùng từ 30/09).
- Câu gom thêm một CTE và một nhánh UNION: đo lại trên DB dev bằng `explainLedgerMarginByGroup` / `explainLedgerTiktokBreakevenByGroup`
  trước khi push 1b; mục tiêu không chậm hơn 20% số đã đo (1,6 giây / 405 nghìn dòng).
- Lazada: nếu payload thật không có `sku_id` → Lazada tạm chỉ có mã (như nay), ghi rõ trong docs, không chặn 1a.

### 6.7 Anh Trung chốt 18/10/2026

1. Tách **1a → 1b → 1c** ba lần push. ✅
2. Lazada: **mã trước, id khi có mẫu** — dòng đơn Lazada để `externalId` NULL cho tới khi có payload thật để chốt tên trường. ✅
3. Ảnh dòng đơn + hoàn hàng chuyển sang id **sau Lát 2**. ✅

### 6.8 Lát 1a — đã code (18/10/2026, push `d915bdcc`)

- Migration `20261018120000_order_item_external_id`: khối lấy khóa ACCESS EXCLUSIVE có thử lại (40 × 3 giây) trên `OrderItem` +
  `order_line_ledger`, rồi `ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` (`OrderItem_externalId_idx`,
  `order_line_ledger_channelId_itemId_idx`). Schema: `OrderItem.externalId`, `OrderLineLedger.externalId` + `itemId`.
- Ghi id lúc tạo đơn: Shopee / TikTok `externalId: mp?.externalId ?? line.externalId` (ghi cả khi danh mục chưa có lá);
  `ResolvedLineRow` mang `externalId`; Lazada để NULL kèm chú thích.
- Sổ dòng hàng: `OrderLineLedgerRow.externalId/itemId`, `ledgerItemIdOf` (cùng cách cắt với `groupSkusByItemId`), `LINE_COLUMNS` /
  `LINE_JSON_TYPES` / `lineJson`. Không tăng `LEDGER_FORMULA_VERSION`.
- Test: `lib/__tests__/order-ledger-line-id.test.ts` (thuần), `order-line-keys` (+id trên dòng khớp), `order-sync-write` (3 đơn Shopee
  tạo mới mang `externalId = "1"` dù danh mục trống). DB dev đã áp migration bằng `prisma db execute` (DB dev kẹt migration
  `20260830120000_fee_audit` FAILED từ 17/09 nên `migrate deploy` không chạy — không liên quan lát này).
- Kiểm prod sau deploy: `SELECT count(*) FROM "OrderItem" WHERE "externalId" IS NOT NULL` tăng theo đơn mới; dòng
  `order_line_ledger` mới có `itemId`; số các báo cáo **không đổi**.

### 6.9 Lát 1b — gom theo id, đã code (18/10/2026, push `ceb0bcff`)

Cách làm gọn hơn thiết kế 6.3 (không cần hai CTE / hai tập riêng): **một khóa dòng hàng** dùng chung cho TS và SQL.

- `lib/ads-margin.ts`: `lineGroupKey(it)` = `"i:<itemId>"` khi dòng có SPU, không thì mã SKU thô; `lineInGroup(it, keys)`.
  `AdsGroupSets` vẫn là `Map<nhóm, Set<khóa>>` nhưng tập khóa nay chứa **cả hai loại**: `buildAdsGroupSets` thêm `itemKey(itemId)`
  cho nhóm sản phẩm và cho từng item của chiến dịch — **kể cả item chưa có trong danh mục** (đơn mang id của nó vẫn gom đúng
  chiến dịch; đây chính là ca Shopee đơn về trước khi danh mục tách). Mã thô của các lá đã biết giữ làm đường lui.
- Luật "id trước, mã sau" tại từng dòng: dòng có `itemId` **chỉ** khớp khóa `i:…` (mã trùng sản phẩm khác không kéo vào; mã đã
  đổi đuôi vẫn khớp); dòng chưa có `itemId` khớp theo mã như cũ → mọi số hiện có **không đổi** cho tới khi Lát 2 bù id.
- `marginOverRows`, `salesPaceByItem`, `tiktokBreakevenBase`, `tiktokBreakevenBaseByGroup`, `placedRevenue`, `salesPaceByGroup`
  đều đi qua `lineGroupKey`; `productOfKey` thay `productOfSku`. Ánh xạ gửi SQL đổi tên `skus` → `keys` (`AdsGroupMapping`,
  `LedgerMarginMapping`, `LedgerTiktokBreakevenMapping`, `TiktokGroupMapping`); `digest` băm khóa nên bộ đệm 30 phút tự làm mới.
- SQL (`ledgerMarginByGroup`, `ledgerTiktokBreakevenByGroup`): bộ nhóm được tách sẵn trong TS (`splitGroupKeys`) thành hai
  `unnest` nhỏ — `mapItem (grp, itemId)` nối `l."itemId"`, `mapSku (grp, sku)` nối `l."channelSku"` cho dòng `itemId IS NULL` —
  hai nhánh `UNION ALL` đúng như thiết kế 6.3. Khóa ghép `COALESCE('i:' || itemId, channelSku)` chỉ dùng ở bước gom theo SKU
  (`bySku`, vài nghìn dòng). `ledgerCompactOrders` đọc thêm `itemId` cho đường "rows"; `loadBreakevenRows` chép sang
  `BreakevenPnlRow.items`.
- **Đo trên gian thử TikTok 300.000 đơn / 405.000 dòng hàng / 2.000 sản phẩm / 100 chiến dịch (DB dev, 18/10, `bench-large-shop.ts`
  + `ledger-backfill.ts ads-compare --explain`, so cùng dữ liệu bằng `git stash`):** bản cũ 2,76 giây → bản đầu Lát 1b (nối
  bằng biểu thức ghép) **4,55 giây, +65%** vì planner mất thống kê cột, `multi`/`checks` rơi Merge Join; tách bằng `LIKE` trên
  CTE còn 3,69 giây (+33%, ước lượng vẫn sai); tách sẵn trong TS → **3,08–3,16 giây, +12–15%**, không còn Merge Join — dưới
  ngưỡng +20% tự đặt. Phần dư là nhánh UNION thứ hai (trên gian thử rỗng vì dòng chưa có id) và hai cột khóa thêm.
- Test: `ads-margin.test` (+ca id trước mã sau, bộ nhóm có `i:`), `tiktok-breakeven.test` (+3 ca), hai test DB hai đường bằng nhau
  dựng **dòng A1 mang id** (`OrderItem.externalId = "100-1"`) cạnh dòng không id → `rows` = `sql` ở mọi nhóm; 12 tệp quảng cáo
  133/133. Mobile / FE không đổi.

### 6.10 Lát 1c — vá giá vốn theo id, đã code (18/10/2026, push `973d4895`)

- `lib/cost-price.ts SKU_MATCH` (dùng ở cả 5 đường vá: theo sản phẩm kho, theo SKU sàn, nút "Áp giá vốn cho đơn cũ", và điều
  kiện "gian có giá riêng"): `(oi.externalId IS NOT NULL AND oi.externalId = cp.externalId) OR (oi.externalId IS NULL AND <3 nhánh
  mã cũ>)`. Dòng có id không bao giờ bị vá bởi lá khác cùng mã; dòng chưa có id vẫn vá theo mã như trước. Index `OrderItem(externalId)`
  của Lát 1a phục vụ nhánh id.
- Test DB `cost-per-shop-db` (+1 ca): hai lá cùng sản phẩm mã trùng (`SHARED (Đỏ)` / `SHARED (Xanh)`); dòng ghi id Xanh nhưng mã Đỏ →
  vá giá Đỏ **không** đụng, vá giá Xanh mới ăn; dòng cũ không id mã Đỏ → vá theo mã; dòng cũ mã thô `SHARED` → chưa vá được (đợi
  Lát 2). Lưu ý: dòng mang mã thô đã đổi đuôi hôm nay **không** được vá dù nhập giá — Lát 2 bù id sẽ sửa, không vá "ké" theo mã thô.
- Hệ quả với 79 dòng (~36 triệu) đơn 15–18/10 mất giá vốn: chúng mang khóa có đuôi và từ 18/10 có id → khách nhập giá vốn cho lá mới
  là vá được ngay (Lát 3 bàn chuyện thừa kế tự động).

## 7. Lát 2 — thiết kế: bù id cho đơn cũ (18/10/2026; anh chốt 7.6, LIVE, kết quả 7.8)

### 7.1 Nguyên tắc: hỏi sàn, không đoán

Thiết kế cũ (mục 4) định suy luận cho mã ↔ 1 sản phẩm và chỉ hỏi sàn cho mã nhiều sản phẩm. Đo lại thì **hỏi sàn cho tất cả rẻ
hơn tưởng**: ≤ 50 đơn một lượt gọi ở cả hai sàn (Shopee `get_order_detail` `order_sn_list`, TikTok `GET /order/202309/orders?ids=`),
nên toàn bộ tập cần bù chỉ tốn ~2.000 lượt gọi trên 73 gian. Sàn là nguồn sự thật duy nhất về id lá của từng dòng đơn → **không suy
luận từ mã**, trừ gian không gọi được sàn (7.3).

### 7.2 Phạm vi — số đo prod 18/10 (dòng đơn Shopee/TikTok chưa có `externalId`)

| Sàn · trạng thái gian | Gian | Đơn (mọi thời) | Đơn 60 ngày | Đơn 90 ngày | … trong đó mồ côi (mã không còn trong danh mục) | Đơn cũ nhất |
|---|---|---|---|---|---|---|
| Shopee ACTIVE | 51 | 64.043 | 38.876 | 51.716 | 6.989 | 09/2024 |
| Shopee DISCONNECTED | 6 | 4.133 | 1.783 | 2.732 | 121 | 03/2026 |
| TikTok ACTIVE | 22 | 58.646 | 34.051 | 46.792 | 13.958 | 03/2026 |

Đề xuất phạm vi: **mọi dòng chưa có id của gian ACTIVE, đơn tạo trong 90 ngày** (≈ 98.500 đơn ≈ 1.970 lượt gọi), ưu tiên **đơn mồ
côi trước** (≈ 21.000 đơn ≈ 420 lượt — hòa vốn đúng sớm nhất), rồi phần còn lại để cây nhất quán cho cả tự kiểm, giá vốn theo id,
Lãi/Lỗ theo SKU. 90 ngày phủ cửa sổ hòa vốn TikTok 60 ngày + biên lãi Shopee 30 ngày có dư. Đơn ngoài 90 ngày (Shopee từ 09/2024,
~12.000 đơn): **không bù trong lát này** — không báo cáo nào gom theo sản phẩm ở xa hơn thế; anh muốn trọn vẹn thì bật `--all`
sau, cùng cơ chế.

### 7.3 Cách bù một gian

1. Lấy danh sách đơn cần bù của gian theo thứ tự ưu tiên (mồ côi trước, mới trước), cắt lô 50 mã đơn.
2. Gọi sàn lấy chi tiết lô; chạy **đúng hàm gom dòng của luồng đồng bộ** (`aggregateShopeeItems` / `aggregateLineItems`) để ra các
   dòng (mã thô, id lá, số lượng) rồi `resolveOrderLineRows` tra danh mục theo id.
3. Khớp dòng sàn ↔ `OrderItem` hiện có của đơn (dòng cũ ghi mã thô đúng bằng mã sàn trả, hoặc khóa có đuôi nếu đơn tạo sau 15/10):
   - **1 ↔ 1** (đa số): ghi `externalId` = id lá; `channelSku` = khóa hiện hành của lá nếu danh mục có (để Lãi/Lỗ theo SKU, ảnh,
     hoàn hàng trỏ đúng lá), không có thì giữ nguyên.
   - **1 OrderItem ↔ nhiều dòng sàn** (trước 15/10 hai lá cùng mã bị gộp thành một dòng, số lượng cộng dồn): không tách dòng cũ
     (sổ cái, hoàn hàng đã bám vào nó). Nếu các lá **cùng một SPU** → ghi `externalId` = **SPU** (khuôn `"item"`, như SP đơn Shopee):
     sổ có `itemId`, hòa vốn / biên lãi gom đúng; vá giá vốn theo id không khớp lá nào → dòng đó giữ giá đã chụp (chấp nhận, hiếm).
     Nếu các lá **khác SPU** → để NULL, đếm và báo (không đoán).
   - Sàn không trả đơn (xóa, quá hạn) → để NULL, đếm.
4. **Giữ nguyên** `costPriceAtSale`, `productId`, số lượng, giá (B5; snapshot là lịch sử).
5. Xong gian → `invalidateCostCaches(channelId)` (đệm hòa vốn / biên lãi 30' tự làm mới).

Sổ cái: trigger `order_ledger_on_order_item_update` hiện chỉ đánh dấu khi `orderId, productId, channelSku, productName, quantity,
price, costPriceAtSale, returnedQuantity, returnRestocked` đổi — **chưa có `externalId`** → dòng chỉ đổi id (mã giữ nguyên) sẽ không
được tính lại. Lát 2 kèm migration nhỏ `CREATE OR REPLACE TRIGGER` thêm `externalId` vào điều kiện (SHARE ROW EXCLUSIVE, khối khóa
thử lại). Ledger worker tính lại theo lô như mọi thay đổi khác; ~100.000 đơn rải trong vài giờ là tải bình thường của GĐ1.

### 7.4 Bộ chạy: worker, tuần tự, có nhịp nghỉ, tự dừng

- `workers/order-line-id-backfill.ts` trong tiến trình worker (không pg-boss — việc dài, bẫy stately). Bảng tiến độ
  `order_line_id_backfill (channelId PK, status pending|running|done|error, priority, cursor, ordersDone, ordersLeft, linesSet,
  linesSpu, linesSkipped, lastError, updatedAt)` — resumable sau restart, hiện trên HQ Sức khỏe.
- Nhận gian bằng `updateMany` có điều kiện (nhiều worker không đụng nhau), **một gian một lúc**, lô 50 đơn, **nghỉ 2 giây giữa hai
  lượt gọi** (0,5 lượt/giây — thấp hơn nhiều mức khởi điểm "đọc batch 5–20/giây" TikTok công bố; Shopee không công bố, 2 s là mặc định
  tự chọn). 429 / 36009002 → qua cửa rate-limit sẵn có của client; dính nữa thì gian đó nghỉ 15', gian khác chạy. Token hết hạn /
  gian DISCONNECTED / ngủ đông → `status=error` kèm lý do, worker thử lại khi gian nối lại.
- Ước lượng: ~2.000 lượt × 2 s ≈ 70 phút chạy tuần tự cho toàn nền tảng; ưu tiên mồ côi xong trong ~15 phút đầu.
- Công tắc: `ORDER_LINE_ID_BACKFILL_OFF=1` tắt; không có → tự chạy sau deploy (như product-catalog-sync). Chạy lại được: gian
  `done` chỉ chạm lại khi còn dòng NULL trong phạm vi (đơn về trước khi danh mục có lá đã được 1a lo, nên sau lượt đầu gần như không
  còn gì).
- Gian không gọi được sàn (DISCONNECTED, 6 gian): **suy luận hẹp** mã thô ↔ **đúng một lá** trong gian → ghi id lá; còn lại NULL. Không
  suy luận "một SPU nhiều lá".

### 7.5 Kiểm chứng

- Test DB: gian giả + mock `getOrderDetail` 3 ca: 1↔1 (ghi id + đổi khóa), gộp cùng SPU (ghi SPU), gộp khác SPU (NULL + đếm); dòng đã có
  id không bị chạm; `costPriceAtSale`/`productId` không đổi; trigger đánh dấu đơn → ledger có `itemId`.
- Prod sau khi chạy: TC025 NEW tự hết "Chưa tin được" (đối chiếu về ≈ +4–9%, hòa vốn ≈ 7,1); `SELECT count(*) … externalId IS NULL`
  trong 90 ngày ACTIVE giảm về ≈ 0 (chỉ còn ca khác SPU / sàn không trả); ba chiến dịch khỏe lệch không tăng.

### 7.6 Anh Trung chốt 18/10/2026

1. Phạm vi **90 ngày, gian ACTIVE, mồ côi trước**; ngoài 90 ngày để sau. ✅
2. Dòng gộp nhiều lá **cùng SPU** → ghi SPU (`"item"`). ✅
3. **Đổi `channelSku`** của dòng cũ sang khóa hiện hành của lá. ✅
4. Chạy **tự động trong worker sau deploy**, có công tắc tắt. ✅

### 7.7 Lát 2 — đã code (18/10/2026, push `75214381` + nhịp worker `23cafd80`)

- Migration `20261018150000_order_line_id_backfill`: (a) `CREATE OR REPLACE TRIGGER order_ledger_on_order_item_update` thêm
  `externalId` vào điều kiện đánh dấu (khối khóa SHARE ROW EXCLUSIVE có thử lại); (b) bảng `order_line_id_backfill` (một dòng / gian:
  `status pending|running|done|error`, `phase orphan|all|infer`, `cursorAt`, bộ đếm `ordersDone/linesSet/linesSpu/linesSkipped/apiCalls`,
  `lastError`, `nextRunAt`), RLS bật. Prisma `OrderLineIdBackfill` + quan hệ `Channel.lineIdBackfill`.
- `services/order-line-id-backfill.ts`: `planLineIds` (thuần — đúng ba luật 7.3), `nextPendingOrders` (lô 50, phase orphan/all, cursor
  lùi theo `createdAt`; mốc so bằng `timestampConst` — so `Date` tham số thẳng với cột `timestamp(3)` lệch theo TimeZone phiên, test
  bắt được), `fetchPlatformLines` (Shopee `get_order_detail` / TikTok `GET /orders?ids=`, qua đúng `aggregateShopeeItems` /
  `aggregateLineItems` + `resolveOrderLineRows`), `applyBackfillBatch` (ghi `externalId` + `channelSku`, không đụng giá vốn /
  productId), `runChannelBackfill` (nghỉ 2 s giữa lượt gọi, trần 400 lượt / lượt chạy, xong gian → xóa đệm hòa vốn),
  `inferIdsByUniqueSku` (gian không gọi được sàn: mã ↔ đúng một lá).
- `workers/order-line-id-backfill.ts`: nhịp 5', lượt đầu sau 2'; tự gieo dòng tiến độ cho gian ACTIVE (phase orphan) và DISCONNECTED
  (phase infer), bỏ gian ngủ đông; nhận một gian bằng `updateMany` có điều kiện; lỗi → `error` + thử lại 15'; công tắc
  `ORDER_LINE_ID_BACKFILL_OFF=1`. Đăng ký trong `workers/index.ts`.
- Test `integrations/__tests__/order-line-id-backfill.test.ts` 8 ca: 4 thuần (1↔1, khóa có đuôi, gộp cùng/khác SPU, không khớp / đã có
  id) + 4 DB với Shopee mock (ưu tiên mồ côi + cursor; ghi id / SPU / đổi khóa / giữ giá vốn / ngoài cửa sổ; **trigger mới**: dòng chỉ
  đổi id → sổ có `itemId`; chạm trần → chạy tiếp đúng chỗ; suy luận hẹp).
- Theo dõi khi chạy prod (chưa có trang HQ, đọc SQL):
  `SELECT c."shopName", b.* FROM order_line_id_backfill b JOIN "Channel" c ON c.id = b."channelId" ORDER BY b."updatedAt" DESC;`

### 7.8 Kết quả chạy prod 18/10/2026 (push 10:15, worker bản nhịp mới 10:26)

- Bản đầu mỗi lượt poll 5' chỉ nhận **một** gian → 77 gian sẽ mất ≥ 6 giờ; sửa ngay (`23cafd80`): một lượt poll chạy liên tiếp nhiều
  gian tới 50', ưu tiên gian hỏi sàn trước gian suy luận. Nhịp thực tế ≈ **4 giây / lượt gọi** (2 s nghỉ + ~2 s gọi sàn và ghi DB),
  không phải 2 s như ước lượng → toàn nền tảng ≈ 2 giờ, không phải 70'.
- 12:28: **64 gian xong · 77.293 đơn · 142.309 dòng ghi id lá · 22 dòng ghi SPU · 2 dòng bỏ · 1.606 lượt gọi · 0 lỗi sàn / 429**; 4 gian
  còn chờ; 2 gian "Hubsell Demo Store" (Shopee + TikTok) lỗi thiếu token — gian demo, nay nghỉ 24 giờ thay vì thử lại 15'
  (`NO_AUTH_RETRY_MS`). Sổ cái: 0 đơn bẩn tồn đọng — ledger worker theo kịp.
- Gian lớn nhất Siêu Thị 8686 (TikTok) 15.651 đơn / 314 lượt / 44.810 dòng, 0 bỏ. Khớp sạch hơn dự tính: chỉ 22 dòng gộp cùng SPU
  và 2 dòng không khớp trên 142 nghìn.
- **TC025 NEW (and.not.or), tính trên sổ theo `itemId` sau khi bù** (277/277 dòng TC025 có id): đối chiếu Hubsell 65,8 tr · TikTok 60,8 tr
  → **+8,3%** (trong ngưỡng 25%, cùng cỡ ba chiến dịch khỏe); hòa vốn **7,05**, biên lãi 14,2%, 192 đơn đối soát + 52 hủy. Trước bù:
  8,90 trên 45 đơn (−74%). Cách tính SQL này đã tái lập đúng số app trước bù, nên app sẽ hiện 7,05 và hết "Chưa tin được" — chưa
  nhìn tận mắt qua giao diện vì phiên Chrome đã quay về dev@hubsell.tech; anh mở gian and.not.or là thấy.

## 8. Lát 3 — lá tách 15/10 nhận lại giá vốn theo LỊCH SỬ khách đã đặt (18/10/2026, đã chốt và chạy)

Anh Trung chốt hướng 18/10: *"thừa kế tự động dựa trên lịch sử khách đã đặt giá vốn, không bịa giá vốn chỉ vì tên SKU có vẻ giống
nhau; không cần nhắc, khách sai khách tự dò lại."*

### 8.1 Vấn đề

Bản 15/10 tách dòng gộp thành nhiều lá: dòng gộp cũ được **đổi khóa tại chỗ** thành một lá (giữ `productId` + `costPrice` khách đã
đặt), các lá còn lại **tạo mới, giá vốn trống**. Khách không tự nhập (3 ngày: 0) → đơn mới rơi vào lá trống chụp giá vốn 0 → bị coi
"thiếu giá vốn", kéo độ phủ xuống, hòa vốn tính thiếu. Đo 15–18/10: 849 dòng đơn khóa có đuôi, 703 giá vốn 0, **79 dòng (~36 triệu,
13 gian)** là ca lá anh em cùng mã có giá mà lá này không có.

### 8.2 "Lịch sử khách đã đặt" là gì — và không phải là gì

- **Nguồn** = trong cùng gian, lá cùng **mã thô** (mã người bán tự đặt trên sàn, phần trước đuôi phân loại) đang mang **giá vốn hiệu lực
  do khách đặt**: `ChannelProduct.costPrice > 0`, hoặc đã nối kho và `Product.costPrice > 0`. Đó chính là dòng gộp mà trước 15/10 khách
  đã đặt giá cho đúng mã này và mọi đơn của mọi phân loại đã chụp giá ấy suốt nhiều tháng — thừa kế = **giữ nguyên hiện trạng khách
  đã chấp nhận**, không phải số mới.
- **Đích** = lá cùng mã thô, `costPrice` trống, **chưa nối kho**.
- **Không** nhìn tên phân loại, tên sản phẩm, mã "na ná"; không nối kho cho lá mới (kho là của khách — anh chốt 15/10 kho chỉ khớp
  trùng mã, bất biến B5).
- **Không đoán khi lịch sử mâu thuẫn**: nhiều nguồn có giá thì phải **cùng một giá**; khách đã đặt hai giá khác nhau cho hai lá → bỏ qua
  nhóm đó.

### 8.3 Số đo prod 18/10 (gian ACTIVE, lá ACTIVE)

| Sàn | Nhóm cùng mã thô | Có lịch sử, 1 nguồn có giá → số lá sẽ thừa kế | Nhiều nguồn cùng giá | Nguồn khác giá → bỏ | **Không có lịch sử → không làm gì** | Gian |
|---|---|---|---|---|---|---|
| Shopee | 8.611 | 113 nhóm → **459 lá** | 9 | 0 | 7.811 | 6 |
| TikTok | 890 | 84 nhóm → **283 lá** | 21 | 1 | 621 | 5 |

Phạm vi thật sự nhỏ: ~740 lá / 11 gian. 8.432 nhóm còn lại (Hi.Bé, LUMI…) chưa từng có giá vốn → đúng tinh thần anh chốt: **không bịa**.

### 8.4 Cách làm

1. **Luật thuần** `inheritedCostOf(siblings)`: trả giá nếu mọi lá có giá hiệu lực trong nhóm đều bằng nhau, null nếu không có hoặc khác
   nhau. Dùng chung ba đường dưới.
2. **Một lần cho tồn hiện tại**: `inheritCostForSplitLeaves(channelId)` — gom lá ACTIVE theo mã thô, áp luật, ghi `costPrice` cho lá đích
   = giá hiệu lực của nguồn (nguồn dùng giá kho → chép xuống thành giá riêng của gian, đúng tiền lệ `keepCostOnDetach`), ghi
   `costPriceInheritedAt = now`. Chạy một lượt cho mọi gian ACTIVE trong worker danh mục (ngay sau deploy, rồi mỗi đêm như một bước của
   lượt sync — nhẹ, một câu SQL / gian).
3. ~~Từ nay về sau: product-sync gán giá cho lá mới~~ — **BỎ** theo anh chốt 8.6 (phân loại khách thêm sau này khách tự nhập).
4. **Vá hồi tố dòng đơn**: với các lá vừa nhận giá → `backfillOrderLinesByChannelProducts(ids)` (đường vá id trước của Lát 1c) → 79
   dòng 15–18/10 + mọi dòng sau đó có giá ngay; xóa đệm hòa vốn gian.
5. **Cột `ChannelProduct.costPriceInheritedAt`** (migration thêm cột NULL): chỉ để kỹ thuật — (a) không bao giờ ghi đè số khách đã
   sửa tay (khách sửa qua `applyChannelCostPrice` → cột về NULL); (b) đường lui một câu `UPDATE … SET costPrice = NULL WHERE
   costPriceInheritedAt IS NOT NULL` nếu anh đổi ý. **Không chuông, không dải nhắc, không hiện gì thêm** trên giao diện trong lát này
   (anh chốt).

### 8.5 Kiểm chứng

- Test thuần luật: 1 nguồn giá riêng; 1 nguồn giá kho; 2 nguồn cùng giá; 2 nguồn khác giá → null; không nguồn → null.
- Test DB: nhóm tách → lá đích nhận giá + `inheritedAt`, lá đã có giá / đã nối kho không bị đụng, dòng đơn giá 0 của lá đích được vá,
  dòng đã có giá không đổi; chạy lại idempotent; khách sửa tay → `inheritedAt` NULL và lượt sau không ghi đè; `product-sync` tạo lá mới
  trong nhóm có nguồn → có giá ngay.
- Prod sau deploy: `SELECT count(*) FROM "ChannelProduct" WHERE "costPriceInheritedAt" IS NOT NULL` ≈ 740; 79 dòng đơn hết giá vốn 0;
  độ phủ giá vốn các gian liên quan về 100%.

### 8.6 Anh Trung chốt 18/10/2026 — và một chỉnh hướng quan trọng

Anh hỏi lại: *"giá vốn thì phải do khách đặt chứ?"* → chốt: **chỉ SỬA MỘT LẦN** phần bản 15/10 đã làm sai (trả lại cho lá tách
giá khách đã đặt cho mã); **phân loại khách thêm về sau khách tự nhập** — Hubsell đã có cơ chế nhắc giá vốn, không thêm gì; các phân
loại cũ giữ nguyên giá đã nhập. Vì thế **bỏ bước 3 của 8.4** (product-sync không gán giá cho lá tạo mới nữa) và lượt sửa chỉ chạm lá
tạo trong cửa sổ 15/10 → 19/10 (ngày deploy lát này). Điểm 1–3 còn lại giữ như đề xuất.

### 8.7 Lát 3 — đã code (18/10/2026, push `3480ef06`, sửa `4ad8f8ca`; **đã gỡ khỏi mã 18/10 chiều — mục 11**)

- Migration `20261018180000_channel_product_cost_inherited`: cột `ChannelProduct.costPriceInheritedAt` (khóa thử lại; chỉ kỹ thuật).
- `services/cost-split-repair.ts`: `inheritedCostOf` (thuần); `repairSplitLeafCosts` — MỘT câu `UPDATE … RETURNING` toàn nền tảng:
  nhóm (gian, mã thô) trên lá ACTIVE có đuôi; nguồn = lá có giá hiệu lực khách đặt (giá riêng gian hoặc giá kho qua liên kết),
  nhóm hợp lệ khi mọi nguồn cùng giá; đích = lá giá trống, chưa nối kho, `createdAt` trong [15/10, 19/10) (mốc bằng
  `timestampConst`); ghi `costPrice` + `costPriceInheritedAt`; rồi vá dòng đơn giá 0 của đúng các lá đó
  (`backfillOrderLinesByChannelProducts`, id trước) và xóa đệm hòa vốn theo chủ shop. Idempotent.
- `workers/cost-split-repair.ts`: chạy một lượt 3' sau khi worker khởi động, không lịch; `COST_SPLIT_REPAIR_OFF=1`.
- `applyChannelCostPrice`: khách đặt tay → `costPriceInheritedAt = NULL` (lượt sửa không bao giờ ghi đè số khách nhập).
- Test `cost-split-repair.test.ts` 4 ca: luật thuần; nguồn giá gian / nguồn giá kho (chép xuống, không nối kho) / hai nguồn khác giá
  / không nguồn / lá ngoài cửa sổ → đúng từng lá; dòng đơn 0 được vá, dòng có giá giữ; chạy lại 0; khách sửa tay → dấu về NULL và
  không bị ghi đè.
- ⚠️ Bẫy tìm thấy khi test: trong template literal TS, `'\s'` của regexp Postgres thành `'s'` → regexp bóc đuôi phân loại **im lặng không
  khớp**. Dính cả `inferIdsByUniqueSku` của Lát 2 (đã chạy prod một lượt với regexp hỏng: 126 dòng nó ghi là khớp mã bằng khóa y hệt →
  vẫn đúng; phần bóc đuôi bị bỏ sót sẽ được lượt kế của 5 gian `infer` còn chờ bù sau deploy). Đã sửa `\\s` ở cả hai chỗ, test Lát 2
  thêm ca lá mang đuôi.
- Kiểm prod sau deploy: log worker `[cost-split-repair] trả lại giá vốn cho ~740 lá ở ~11 gian; vá N dòng đơn`;
  `SELECT count(*) FROM "ChannelProduct" WHERE "costPriceInheritedAt" IS NOT NULL` ≈ 740; 79 dòng đơn 15–18/10 hết giá vốn 0.

### 8.8 ⚠️ Sự cố lượt chạy prod 18/10 13:18 — gán giá oan cho sản phẩm khác, và cách hoàn tác

- **Thực tế:** lượt sửa ghi **4.320 lá / 16 gian**, không phải ~740. Soi: **828 lá cùng sản phẩm** với lá nguồn (đúng ý); **3 lá khác SPU
  nhưng trùng tên** (tin đăng lại); **3.489 lá là SẢN PHẨM KHÁC, TÊN KHÁC**, chỉ trùng mã người bán (XPL2 STORE 3.257, Samba 125 + 40,
  Hi.Bé TikTok 35, Luna Bebe 15, DarkMan 10…). Đó là kiểu "giá của sản phẩm X gán cho sản phẩm Y" anh Trung dặn không làm.
- **Nguyên nhân (lỗi của em):** câu ước lượng 8.3 gom theo (gian, mã thô, **SPU**) nên ra ~740; câu sửa 8.4 gom chỉ theo (gian, mã thô).
  Về mặt lịch sử, trước 15/10 mã đó đúng là một dòng một giá cho mọi tin đăng — nhưng anh duyệt thiết kế trên con số theo sản phẩm, và
  nguyên tắc "không bịa" phải thắng tiền lệ kỹ thuật.
- **Sửa mã:** `repairSplitLeafCosts` gom theo (gian, mã thô, SPU) — test thêm ca "trùng mã, khác sản phẩm → không mang giá sang".
- **Hoàn tác:** `revertCrossProductInheritance()` — lá đang mang dấu thừa kế mà cùng (gian, mã thô, SPU) **không có** lá nguồn khách đặt
  giá → dòng đơn của lá tạo từ 15/10 đang mang **đúng giá thừa kế** về 0 (chỉ lượt vá đặt được số đó; dòng có số khác giữ), lá về
  `costPrice NULL` + dấu NULL. Idempotent; lá khách đã sửa tay (dấu NULL) không chạm. Worker chạy hoàn tác **trước** lượt sửa ở mỗi lần
  khởi động. Test: lá oan về trống + dòng về 0, lá đúng giữ nguyên, chạy lại 0.
- **Anh Trung chốt (A) 18/10 13:38** → push `4ad8f8ca` 13:40; worker hoàn tác chạy ~13:48. **Kiểm 13:52:** còn **828 lá** mang dấu thừa kế,
  **828/828 cùng SPU với nguồn, 0 khác SPU**, 12 gian; XPL2 STORE 0 lá thừa kế (1.028 lá có giá đều do khách đặt). Hoàn tác đúng phạm vi.
- **Tác dụng phụ nhỏ của hoàn tác (kiểm 13:58):** hoàn tác đưa về 0 mọi dòng từ 15/10 của lá oan đang mang đúng giá thừa kế — nhưng
  đơn đồng bộ **sáng 15/10 trước lúc tách** đã chụp giá thật của dòng gộp cũ, trùng đúng con số ấy → bị đưa về 0 oan. Đo: dòng giá 0, đơn
  tạo trước lúc lá được tạo, nhóm có lá nguồn khách đặt giá: **ANO Official Store 6, XPL2 2, PERLYCO 2, Hi.Bé 1 = 11 dòng**. Giá đúng của
  chúng = giá nguồn (giá gộp cũ lúc bán). Anh chốt trả lại → UPDATE trên Supabase 18/10 ~14:08: **11 dòng, tổng 1.081.000đ** (ANO TC077 131.000 × 6, Hi.Bé 53.000, PERLYCO
  30.000 × 2, XPL2 × 2); trigger sổ cái tự tính lại. Sự cố Lát 3 ĐÓNG.
- Bên lề (không thuộc lát này): còn ~74 dòng đơn 15–18/10 giá vốn 0 dù lá **đã có giá riêng và đã nối kho** — đơn về trước khi danh
  mục có lá, chưa ai bấm lưu lại giá nên chưa được vá. Nên có lượt vá định kỳ "dòng giá 0 của lá đã có giá" (một câu UPDATE, id trước)
  — đề xuất riêng.

## 9. Lượt vá định kỳ dòng đơn giá vốn 0 của lá đã có giá (18/10/2026)

### 9.1 Vấn đề còn lại sau Lát 3

- Kiểm prod 18/10 (mục 8.8, bên lề): ~74 dòng đơn tạo 15–18/10 có `costPriceAtSale = 0` dù lá sàn tương ứng **đã có giá hiệu lực**
  (giá riêng gian `ChannelProduct.costPrice > 0`, hoặc đã nối kho và `Product.costPrice > 0`).
- Vì sao không đường vá nào chạm tới: mọi đường vá hiện có đều chạy **theo sự kiện ghi giá** (khách lưu giá gian / giá kho, tự điền theo mã,
  lượt sửa Lát 3) và vá đúng các lá vừa được ghi. Dòng đơn này rơi vào kẽ: đơn về **trước** khi danh mục có lá (chụp 0), rồi lá được tạo
  (kéo danh mục đêm) và có giá qua đường không vá đơn (nối kho, hoặc giá đã đặt từ trước khi dòng đơn được Lát 2 bù `externalId` —
  lúc Lát 2 ghi id, không ai ghi giá nên không lượt vá nào chạy). Sau đó không ai bấm lưu lại giá → 0 mãi.
- Nguyên tắc giữ nguyên (đầu `lib/cost-price.ts`): giá vốn là của khách, **không bịa**; `0` không phải ảnh chụp hợp lệ → **chỉ vá dòng
  đang 0**; không đặt `productId` hồi tố; không tạo giá mới cho lá nào.

### 9.2 Thiết kế (đã làm theo nguyên tắc "trình trước, code sau" — trình ở đây, anh đọc + chốt khi kiểm prod)

- **Phép vá:** dòng `OrderItem` của gian có `costPriceAtSale = 0`, khớp một lá của gian theo luật của `SKU_MATCH` (**id trước**:
  `oi.externalId = cp.externalId`; dòng chưa có id khớp **ba nhánh mã**: mã hiện tại / `sku_id` sau dấu `-` / `SPE-` + externalId), lá có
  giá hiệu lực theo `effectiveSkuCost` (`COALESCE(NULLIF(cp.costPrice,0), p.costPrice, 0) > 0`) → `costPriceAtSale` = giá đó. Lá không
  giá → giữ 0. Dòng đã có số → không đụng. Chạy lại → 0 dòng (idempotent).
- **Cùng luật, khác cách ghép:** `SKU_MATCH` là một biểu thức `OR` — Postgres không hash-join được, planner ghép **vòng lặp lồng
  dòng × lá** (đo dev: `Nested Loop` + `Materialize` toàn bộ lá của gian). Hợp với các đường vá hiện có (vài lá cho trước theo id), nhưng
  một lượt quét **cả gian mỗi đêm** ở gian hàng chục nghìn dòng 0 × vài nghìn lá (XPL2 3.257 lá) là hàng trăm triệu phép so. Nên lượt
  định kỳ viết **hai câu UPDATE bằng phép bằng thuần** (cùng ngữ nghĩa với `SKU_MATCH`, bài học Lát 1b "tách khóa ra cột thật"):
  1. nhánh id: `oi.externalId = l.externalId`;
  2. nhánh mã cho dòng `externalId IS NULL`: lá bung ba khóa mã bằng `unnest(ARRAY[...])` thành cột `key`, ghép `oi.channelSku = key`.
  Cả hai đều đi chỉ mục `OrderItem(externalId)` / `OrderItem(channelSku)` và `Order(channelId)`. Lá trùng id / trùng khóa trong gian
  (dòng DELISTED cũ + dòng ACTIVE mới) chọn **một** theo thứ tự ACTIVE trước, mới cập nhật trước (`DISTINCT ON`) — các đường vá cũ để
  Postgres chọn ngẫu nhiên, lượt này làm rõ.
- **Không giới hạn ngày** (không có ngưỡng để phải biện minh): phép bằng + chỉ mục nên quét cả gian rẻ; lượt đầu cũng là lượt bù
  toàn bộ (~74 dòng đo 18/10 và mọi dòng cũ hơn cùng tình trạng).
- **Chỗ chạy:** một bước của `workers/product-catalog-sync.ts` **ngay sau khi kéo danh mục một gian thành công** — vì chính lượt kéo
  danh mục là lúc lá xuất hiện (nguyên nhân gốc), và nhịp đã sẵn: gian mới nối chạy ngay, rồi mỗi đêm 03:00–05:00 giờ VN rải theo gian;
  không thêm lịch, không thêm trạng thái ở biến module (hàng rào `no-module-state`). Lỗi của bước vá chỉ ghi log, không làm hỏng lịch
  kéo danh mục. Sau khi vá > 0 dòng → `invalidateOwnerCostCaches(userId)`. Nút "Đồng bộ từ sàn" khách bấm tay KHÔNG chạy bước này
  (đêm sau bù) — giữ nút nhẹ, một việc.
- **Công tắc:** `COST_ZERO_REPAIR_OFF=1` tắt riêng bước vá (kéo danh mục vẫn chạy).
- **Không làm:** không chạm `productId`, không ghi `ChannelProduct`/`Product`, không nhắc khách, không chạy cho gian ngủ đông / mất
  token (gian đó không có đơn mới; mở lại thì lượt kéo danh mục kế vá luôn).

### 9.3 SQL đo chỉ đọc (Supabase SQL Editor — số dòng sẽ được vá, theo gian)

```sql
WITH leaf AS (
  SELECT cp."channelId", cp."externalId", cp."channelSku",
         COALESCE(NULLIF(cp."costPrice", 0), p."costPrice", 0) AS cost
  FROM "ChannelProduct" cp LEFT JOIN "Product" p ON p."id" = cp."productId"
  WHERE COALESCE(NULLIF(cp."costPrice", 0), p."costPrice", 0) > 0
),
hit AS (
  SELECT oi."id", o."channelId", 'id' AS via
  FROM "OrderItem" oi JOIN "Order" o ON o."id" = oi."orderId"
  JOIN leaf l ON l."channelId" = o."channelId" AND l."externalId" = oi."externalId"
  WHERE oi."costPriceAtSale" = 0 AND oi."externalId" IS NOT NULL
  UNION
  SELECT oi."id", o."channelId", 'code'
  FROM "OrderItem" oi JOIN "Order" o ON o."id" = oi."orderId"
  JOIN leaf l ON l."channelId" = o."channelId"
  JOIN LATERAL unnest(ARRAY[l."channelSku", split_part(l."externalId", '-', 2), 'SPE-' || l."externalId"]) AS k(key) ON k.key = oi."channelSku"
  WHERE oi."costPriceAtSale" = 0 AND oi."externalId" IS NULL
)
SELECT c."shopName", c."channelName", c."status", count(DISTINCT h."id") AS lines,
       count(DISTINCT h."id") FILTER (WHERE h.via = 'id') AS via_id
FROM hit h JOIN "Channel" c ON c."id" = h."channelId"
GROUP BY c."id" ORDER BY lines DESC;
```

- Dự kiến (từ số đo 8.8): ~74 dòng 15–18/10 ở vài gian (ANO / and.not.or, Hi.Bé, XPL2, PERLYCO…) + phần dòng cũ hơn cùng tình trạng,
  chưa đo. DB dev: 0 dòng (không có gian thật). **Chưa kiểm prod** — anh dán SQL trên để có số thật trước/sau deploy.

### 9.4 Đã code (18/10/2026, push `03548f78`)

- `lib/cost-price.ts` → `repairZeroCostLinesForChannel(db, channelId)`: hai câu UPDATE phép bằng (nhánh id; nhánh mã cho dòng
  `externalId IS NULL` qua `unnest` ba khóa), `DISTINCT ON` chọn lá ACTIVE trước / tạo sau trước khi trùng id hoặc trùng khóa; chỉ
  dòng `costPriceAtSale = 0`; không ghi `productId`, `ChannelProduct`, `Product`. Trả `{ byId, byCode }`.
- `workers/product-catalog-sync.ts` → `repairZeroCostLinesAfterSync(channel)` gọi ngay sau `syncChannelProducts` thành công
  trong vòng poll; vá > 0 → `invalidateOwnerCostCaches(userId)` + log
  `[Catalog-sync] "<gian>": vá N dòng đơn giá vốn 0 của lá đã có giá (a theo id, b theo mã)`; lỗi chỉ log. Công tắc
  `COST_ZERO_REPAIR_OFF=1` (`.env.example`). Không thêm biến module (hàng rào `no-module-state` qua; ca event-queue.ts lỗi có sẵn).
- Test DB `integrations/__tests__/cost-zero-repair-db.test.ts` 3 ca / 10 dòng: lá giá riêng → vá; lá giá kho qua liên kết → vá bằng giá
  kho (không nối kho hộ); lá không giá → 0; dòng có số → giữ; dòng CÓ id mà không lá nào mang id (mã trùng lá khác) → 0 (id trước);
  dòng chưa có id khớp đủ ba nhánh mã; lá trùng id DELISTED 70k + ACTIVE 120k → 120k; gian khác không chạm; chạy lại 0/0; công tắc tắt
  → 0, bật → vá. Cùng chạy lại cost-per-shop-db + cost-split-repair + product-catalog-sync: 16/16. `tsc` backend sạch.
- **Kiểm prod sau deploy:** dán SQL 9.3 trước (số dự kiến ~74 dòng 15–18/10 + dòng cũ hơn, chưa đo); sau lượt kéo đêm 03:00–05:00
  (hoặc gian mới nối) đọc log Render `[Catalog-sync] … vá N dòng đơn giá vốn 0`; dán lại SQL 9.3 → kỳ vọng 0 ở gian ACTIVE đã kéo.
  Gian lỗi kéo danh mục (token hỏng) không được vá tới khi kéo lại được — chấp nhận.

## 10. Lát 4 — thiết kế: tự kiểm doanh thu cho Shopee (18/10/2026; anh chốt 10.5, LIVE `e8a3e0e4`)

### 10.1 Vì sao Shopee không chép nguyên lưới của TikTok

TikTok GMV Max báo doanh thu **mọi đơn** của sản phẩm trong chiến dịch → so hai chiều với Hubsell được (lệch quá 25% là sai, bất kể
chiều). Shopee CPC chỉ báo doanh thu **gán cho quảng cáo**: `broad_gmv` = đơn đặt sau khi bấm quảng cáo, **kể cả sản phẩm khác** trong
gian; `direct_gmv` = đơn của **chính sản phẩm quảng cáo**. Vì vậy:
- so với `broad_gmv` không có nghĩa (Hubsell có thể thấp hơn hợp lệ vì broad gom cả sản phẩm khác);
- `direct_gmv` là **cận dưới hợp lệ**: doanh thu Hubsell thấy cho các sản phẩm của chiến dịch (mọi đơn đặt, cùng những ngày) **không
  thể thấp hơn** doanh thu sàn gán trực tiếp cho chính chúng. Thấp hơn rõ rệt = cây sản phẩm của Hubsell thiếu đơn (đúng kiểu TC025).
  Chiều ngược (Hubsell cao hơn) là bình thường (đơn tự nhiên) → **không kiểm**.

### 10.2 Số đo prod 18/10 (95 chiến dịch Shopee đang chạy có `direct_gmv` 30 ngày, gian ACTIVE)

| Hubsell ÷ direct_gmv | Số chiến dịch | Ghi chú |
|---|---|---|
| ≥ 100% | 74 | bình thường |
| 80–100% | 8 | nhiễu gán ngày (Shopee ghi đơn về ngày bấm quảng cáo, đơn đặt sau vài ngày) |
| 50–80% | 3 | Hanoinest 0,64 · Thế Giới Xuyên Thấu 0,72 · Tiệm Buôn Hoài Niệm 0,74 — **ca thật cần soi** |
| < 50% (đa số = 0) | 10 | **toàn bộ thuộc gian đã NGỦ ĐÔNG** (Samba ×2, Bách Hóa Thanh Thu, LUMI SOLAR…): Lát 2 bỏ qua gian ngủ đông theo thiết kế, sổ chưa có `itemId`; khách đóng tiền → `hibernatedAt` về NULL → worker tự gieo và bù ở lượt kế |

Với ngưỡng 25% (cùng số với TikTok, tự chọn): 2 chiến dịch của gian đang hoạt động sẽ hiện "chưa tin được" ngay sau deploy — đúng
mục đích của lưới.

### 10.3 Cách làm

- **Nguyên liệu:** `AdsCampaignDailyPerf.directGmv` của chiến dịch Shopee trong cửa sổ biên lãi 30 ngày tới hết hôm qua; `checkFrom` =
  ngày đầu có số (như TikTok `tiktokCampaignCheckOf`). Hubsell `placedRevenue` = Σ `actualRevenue` dòng có giá của nhóm chiến dịch
  (khóa `i:<itemId>` | mã, như Lát 1b) trong [from, to], **mọi đơn đặt kể cả hủy** (sàn cũng đếm đơn đặt).
- **Gom:** đưa phần "checks" (đã có trong câu TikTok) vào `ledgerMarginByGroup` + mapping `checkFrom/checkTo`; đường "rows" dùng lại
  `placedRevenue` (chuyển hàm này về `lib/ads-margin.ts` cho hai sàn dùng chung). `ChannelMargins` thêm `placedRevenue(groupKey)`.
- **Luật thuần** `marginCheckProblem(check)`: `directGmv > 0` và `placed < directGmv × (1 − 25/100)` → lý do "Hubsell chỉ thấy X% doanh thu
  sàn gán trực tiếp cho sản phẩm của chiến dịch (A so với B) — dòng đơn chưa nối đúng sản phẩm, hòa vốn chưa tin được"; ngược lại "".
  Hằng `SHOPEE_MARGIN_CHECK_MAX_GAP_PCT = 25` (tự chọn; căn cứ bảng 10.2).
- **Nơi dùng:** `ads-insights` `CampaignInsight` thêm `check` + `breakevenProblem`; có problem → `breakevenRoas = null`, `marginSource = null`
  → `evaluateShopeeCampaign` / `assessRoasTarget` / `ads-auto-execute` đã coi null là "không có mốc" (auto-execute: `flagged = false`,
  không tự cắt ngân sách — đã đọc mã). Tab Gợi ý / Hòa vốn sản phẩm Shopee: nhóm **sản phẩm** không có số sàn theo ngày → không tự kiểm
  (như TikTok nguồn `product`); GMS (GMV Max cấp shop) có `direct_gmv` theo item 7d/30d → áp cùng luật cho từng item trong bảng GMS
  (phần mở rộng, làm nếu còn thời gian).
- **UI:** cột ROAS hòa vốn Shopee hiện "Chưa tin được" (vàng) + tooltip lý do, giống ô TikTok; mobile hiện "—" (kiểu đã có `null`).
- **Không đụng:** Lazada (không có số quảng cáo theo sản phẩm đủ tin), ngưỡng loại / luật tự động của khách.

### 10.4 Kiểm chứng

- Test thuần: dưới ngưỡng / đúng ngưỡng / `directGmv = 0` → ""; thấp hơn 26% → lý do; test DB hai đường bằng nhau có thêm `placedRevenue`
  (như tiktok-breakeven-sql-db).
- Prod sau deploy: Hanoinest "Máy Sưởi Mini" (0,64) và Thế Giới Xuyên Thấu "Đầm Maxi" (0,72) hiện "Chưa tin được"; 74 chiến dịch ≥ 100%
  không đổi số; soi hai ca đó xem thiếu đơn ở đâu (có thể lại là mã đổi / đăng lại tin).

### 10.5 Anh Trung chốt 18/10/2026

1. Kiểm **một chiều** theo `direct_gmv`. ✅ 2. Ngưỡng **25%**. ✅ 3. GMS theo item **để sau**. ✅

### 10.6 Lát 4 — đã code (18/10/2026, push `e8a3e0e4` 14:26)

- `lib/ads-margin.ts`: `MarginCheck`, `MarginCheckWindows`, `MARGIN_CHECK_MAX_GAP_PCT = 25`, `marginCheckProblem` (một chiều),
  `placedRevenueOf` (dùng chung hai sàn — `tiktok-breakeven.placedRevenue` gọi lại), `ChannelMargins.placedRevenue(groupKey)`,
  `adsGroupMappingOf(sets, checks?)` → `checkFrom[]` / `checkTo` + digest gồm khoảng.
- **Tự kiểm đi câu SQL riêng** `ledgerPlacedRevenueByGroup` (services/order-ledger), KHÔNG nhét vào `ledgerMarginByGroup`: digest
  của biên lãi không gồm khoảng tự kiểm nên đệm 30' vẫn dùng chung giữa Trợ lý / tab sản phẩm / gợi ý (test lưới đỡ
  `ads-margin-fallback-db` bắt được: nhét chung làm đệm vỡ, câu gom chạy thêm một lần). Câu riêng nhẹ: chỉ dòng có giá trong
  [min checkFrom, checkTo], nối cột `itemId` / `channelSku` như Lát 1b. Đệm riêng `placedRevenueCache` (cùng TTL, cùng lệnh xóa).
- `ads-margin-source.fetchChannelMargins(channel, sets, source?, checks?)`: đường sql = biên lãi (đệm chung) + tự kiểm (đệm riêng) ghép
  một mặt tiền; đường rows = `marginsFromRows(rows đã lọc, …, checks, rows THÔ)` — đệm rows nay giữ bản thô (tự kiểm cần cả đơn hủy /
  chưa đối soát), lọc theo luật sàn lúc dùng.
- `ads-insights`: khoảng tự kiểm mỗi chiến dịch = từ ngày đầu có số sàn trong 30 ngày tới hết hôm qua; `check` + `breakevenProblem`
  trên `CampaignInsight`; có problem → `margin`/`breakevenRoas` = null, `marginSource` = null (kể cả mượn gian) →
  `evaluateShopeeCampaign` / `assessRoasTarget` / `ads-auto-execute` coi là không có mốc (auto-execute `flagged = false`, không tự
  cắt). Route `/api/quang-cao/shopee` trả `breakevenProblem` + `check`.
- UI web: cột "Hòa vốn" của bảng chiến dịch hiện **"Chưa tin được"** (vàng) + tooltip lý do; mobile thêm kiểu `breakevenProblem?`
  (hiện "—" vì `breakevenRoas` null). Công cụ đối chiếu: `revenuePlaced` so theo lệch tuyệt đối (rows nhân tỷ trọng, sql cộng dòng
  đã làm tròn).
- Test: `ads-margin.test` +4 ca (luật ngưỡng, placedRevenueOf kể cả hủy / id trước mã sau / biên ngày VN, ánh xạ kèm khoảng + digest);
  `ads-margin-sql-db` +1 ca hai đường bằng nhau cho tự kiểm (đơn hủy O4 nằm trong tự kiểm nhưng không trong biên lãi); 14 tệp quảng
  cáo + lưới đỡ xanh; tsc BE + FE sạch.
- Kiểm prod sau deploy: Hanoinest "Máy Sưởi Mini" (0,64) và Thế Giới Xuyên Thấu "Đầm Maxi" (0,72) hiện "Chưa tin được"; 74 chiến
  dịch ≥ 100% không đổi số; soi hai ca đó (mã đổi / đăng lại tin?).

### 10.7 Kiểm prod sau deploy (18/10/2026 ~15:00, bằng tài khoản quản trị)

- Web `/health` = `e8a3e0e4`; worker: snapshot sức khỏe `e8a3e0e/worker @ 07:29Z` (khởi động lại 93 s sau deploy) — cả hai dịch vụ
  đã lên bản có Lát 4 + lượt vá định kỳ.
- `/api/quang-cao/shopee?channelId=<ANO Official Store>`: 73 chiến dịch, 1 đang chạy "Túi Đeo Chéo Nam ANO" → `check` placed 65,6 tr
  / direct_gmv 59,4 tr = **110 %**, `breakevenProblem = null`, hòa vốn 6,74 (nguồn chiến dịch) — đúng kỳ vọng "≥ 100 % không đổi".
  DarkMan Store (chưa nối Hubsell Ads): `direct_gmv = 0` mọi chiến dịch → kiểm một chiều không bắt oan (0 cờ).
- `/api/quang-cao/tiktok?channelId=<and.not.or>`: 4 chiến dịch đang chạy đều `problem = null`, lệch +3,8 / +8,8 / +4,3 / **+8,4 %
  (TC025 NEW, hòa vốn 7,07)** — số 8,90 cũ không còn.
- Hai ca Hanoinest / Thế Giới Xuyên Thấu dự kiến hiện "Chưa tin được" **chưa nhìn trực tiếp được** (tài khoản quản trị không có gian
  đó trong danh sách; đọc API từng gian cần đăng nhập chủ gian) — còn treo, kiểm khi có dịp hoặc hỏi khách.
- Lát 3 lượt khởi động lại sau deploy KHÔNG ghi gì: vẫn **828 lá** thừa kế, `max(costPriceInheritedAt)` giữ 06:18Z (idempotent).
- Bù id (Lát 2): `done/all = 69, done/infer = 8, error/orphan = 2` (2 gian demo không có ủy quyền, thử lại 24 h) — không đổi.
- SQL 9.3 (vá định kỳ) vẫn **209 dòng** — đúng, lượt vá chạy sau lượt kéo danh mục đêm 03:00–05:00; **kiểm lại sáng 19/10, kỳ vọng
  giảm mạnh ở 6 gian** (Nội Thất Smart Thanh Phúc 121, Mọ Mẫm LAB 62, Tiệm Bé Sâu 15…), đọc log Render `[Catalog-sync] … vá N dòng`.

## 11. Dọn dẹp sau khi 5 lát live (18/10/2026 chiều, anh Trung: "dọn code thừa, đảm bảo mô hình cây")

Nguyên tắc: mã còn lại phải phản ánh đúng cây (id lá là danh tính, mã chỉ là đường lui cho dòng chưa có id), không giữ việc đã xong, không
hai nơi tự đặt cùng một số.

| Việc | Quyết định | Vì sao |
|---|---|---|
| Lát 3 — `services/cost-split-repair.ts`, `workers/cost-split-repair.ts`, test 5 ca, dòng bật trong `workers/index.ts` | **GỠ** | Việc một lần đã chạy xong và kiểm trên prod (828 lá, 8.8; lượt khởi động lại sau deploy `e8a3e0e4` ghi 0). Cửa sổ lá tạo 15→19/10 đã khép về mặt dữ liệu: mọi gian ACTIVE đều kéo danh mục đêm, lá về sau 19/10 nằm ngoài cửa sổ. Giữ job quét mỗi lần khởi động là chi phí vô ích + mã chết. Lịch sử còn trong git (`3480ef06`, `4ad8f8ca`). |
| Cột `ChannelProduct.costPriceInheritedAt` + `applyChannelCostPriceIn` xóa dấu khi khách tự sửa | giữ | Là dấu "giá do máy thừa kế" trên 828 lá; đường lui vẫn đúng một câu: `UPDATE "ChannelProduct" SET "costPrice" = NULL, "costPriceInheritedAt" = NULL WHERE "costPriceInheritedAt" IS NOT NULL` (kèm vá dòng đơn từ 15/10 về 0 nếu muốn hoàn toàn). |
| Hai hằng 25 % (`TIKTOK_BREAKEVEN_CHECK_MAX_GAP_PCT`, `MARGIN_CHECK_MAX_GAP_PCT`) | **GỘP** thành `BREAKEVEN_CHECK_MAX_GAP_PCT` ở `lib/ads-margin.ts`; TikTok import | Một số, một chỗ, một chú thích căn cứ (B6). Khác nhau chỉ ở chiều so (TikTok hai chiều, Shopee một chiều) — nằm ở hàm, không ở số. |
| Ảnh dòng đơn `backfillOrderItemImagesTx` | **đổi id trước** | Dòng sàn có `externalId` → khớp `OrderItem.externalId`; mã (cả `startsWith "MÃ ("`) chỉ áp cho dòng đơn `externalId IS NULL` (Lazada, đơn cũ ngoài 90 ngày). Dòng có id khác mà trùng mã KHÔNG nhận ảnh nữa (mã dùng chung nhiều lá). Test DB 1 ca 3 dòng. |
| Số lượng hoàn `returns-sync` Shopee/TikTok | **đổi id trước** qua `order-line-keys.returnedQtyOf` + `needsReturnKeyExpand` (thuần, dùng chung) | Shopee khớp `item-model`, TikTok khớp phần sku_id của `product-sku`; mã thô rồi khóa mở rộng chỉ cho dòng chưa có id; `expandReturnKeys` giữ làm đường lui. `items` select thêm `externalId`. Test thuần 2 ca + 6 tệp hoàn hàng cũ xanh. |
| `SKU_MATCH` 3 nhánh mã (`lib/cost-price.ts`) | giữ | Đường lui vĩnh viễn cho dòng `externalId IS NULL` (6.4); đã là "id trước" từ 1c. |
| Worker bù id (Lát 2) | giữ chạy | Gian ngủ đông thức dậy / gian mới nối có đơn cũ → tự gieo + bù; rẻ (poll 5′, không việc thì thoát). |
| Test `workers/no-module-state` đỏ có sẵn (event-queue `sweepStarted`/`sweepRunning` từ `40ad7ed5`) | **sửa**: thêm vào `ALLOWED_LET` kèm lý do | Hai cờ cùng loại `started`/`running` đã được phép; test đỏ làm người sau không tin bộ test. |
| Đường "rows" của biên lãi (`marginsFromRows`, `ads-margin-compare`, 3 biến env đường lui — [[hubsell-quang-cao-gom-sql]]) | **chưa đụng** | Việc riêng, có bộ test đối chiếu hai đường làm lưới đỡ cho mọi lát hôm nay; gỡ là một lát riêng sau khi đường SQL chạy đủ lâu. |

Kiểm: tsc BE sạch; bộ test đầy đủ chạy sau khi sửa (kết quả ghi ở PROGRESS). Không đổi dữ liệu, không migration.

## 12. Bỏ phép so doanh thu với TikTok — lỗi cây đo trực tiếp trên dòng đơn (28/10/2026 tối, anh chốt hướng 26/10)

### 12.1 Vì sao Lát 0 sai thiết kế (không phải sai ngưỡng)

- Lát 0 giả định *"doanh thu TikTok gán cho chiến dịch = mọi đơn của các sản phẩm trong chiến dịch, cùng khoảng ngày"*. Thực tế
  TikTok chỉ ghi cho chiến dịch phần đơn của **những ngày sản phẩm thuộc nó**; ngày sản phẩm nằm trong LIVE GMV Max thì đơn về
  chiến dịch LIVE. Hubsell lấy `itemIds` **hiện tại** rồi cộng mọi đơn từ ngày đầu có số → gian xoay sản phẩm giữa nhiều chiến dịch
  lệch 2–6× dù biên lãi từng sản phẩm vẫn đúng (ca hieucon111099, PROGRESS 26/10 tối).
- Đo prod 28/10 20:05 (SQL xấp xỉ chỉ khớp `itemId`, gian TikTok ACTIVE): "cao hơn" > 25 % — **đang chạy 63 chiến dịch / 31 gian**
  (26/10: 48/25), tạm dừng 123/29, kết thúc 14/6; "khớp" đang chạy 117/38; "thấp hơn" đang chạy 13/2 gian. hieucon "Cũ led gạo
  100 quả sửa 25/10" 253 tr so với TikTok 86 tr (+196 %). Lỗi lan rộng theo thời gian, không phải ca lẻ → sửa thiết kế, không chỉnh
  ngưỡng (luật "không vá ngưỡng lần nữa").
- Nhóm "thấp hơn" (Bella Look `…amd3pt` 12 chiến dịch 1 SPU, TORANO `…vpxfpk` ~10): Hubsell/TikTok **đều đặn 0,65–0,80 ở mọi
  chiến dịch**, SPU đều có trong danh mục, đơn có đủ, `lineGross` còn thấp hơn `actualRevenue` → không phải mã/id, không phải
  thiếu đồng bộ ngẫu nhiên; giả thuyết dẫn đầu: TikTok `gross_revenue` tính trước giảm giá của shop (hai gian thời trang giảm sâu),
  and.not.or giảm ít nên chỉ lệch 4–9 %. **Chưa chứng minh** (cần so một đơn cụ thể với số TikTok báo) — ghi lại, không quyết.

### 12.2 Cách đo mới (đã code 28/10, test xanh)

- `BreakevenBase.unlinkedRevenue`: doanh thu **đã có kết cục cuối** của dòng đơn **chưa có id lá**, chỉ khớp nhóm bằng mã thô.
  Không vào biên lãi, không đếm đơn đã đối soát / hủy; đơn chưa chốt vẫn đếm `pendingOrders`; đà bán vẫn đếm (nhịp bán, không
  phải lãi). Nhóm toàn gian không tách. Dòng **có id** mà id không thuộc nhóm thì không khớp dù cùng mã → mã dùng chung không còn
  kéo đơn sản phẩm khác (chiều "THỪA" của Lát 0 hết lý do tồn tại).
- `costCoveragePct = revenue ÷ (revenue + missingCostRevenue + unlinkedRevenue)` — một rào `BREAKEVEN_MIN_COVERAGE_PCT = 90`
  (anh duyệt 18/09) cho cả thiếu giá vốn lẫn chưa nối id; **không đặt số mới**. Tên trường giữ nguyên (web/mobile đang đọc).
- Gỡ: `breakevenCheckGapPct`, `breakevenCheckProblem`, `TiktokBreakevenCheck`, `placedRevenue`, `tiktokCampaignCheckOf`,
  `TiktokCheckWindows`, `TiktokBreakeven.check/checkProblem`, `BreakevenInput.checkProblem`, CTE `checks` + `checkFrom/checkTo`
  trong `tiktokBreakevenByGroupQuery`, trường `check`/`problem` của API TikTok, dòng "Đối chiếu doanh thu" + nhãn "Chưa tin được"
  trên web TikTok. `BREAKEVEN_CHECK_MAX_GAP_PCT` chỉ còn Shopee dùng.
- SQL: `bySku` thêm `bool_or(linked)`; khóa mã thô trong nhóm → tiền đơn đã chốt dồn sang `unlinkedRevenue`, số đơn chốt về 0;
  nhánh `mapSku` của `multi` chỉ còn `cls = 0`. Đường "rows" cùng luật (`groupMatchOf`). Test DB hai đường bằng nhau ở mọi nhóm
  (fixture sẵn có A2/B/G/R* không id → bài test tự nhiên có cả hai loại dòng).
- UI web: popover ô Hòa vốn nói "Mới X % doanh thu tính được — Y đ là đơn Hubsell chưa nối được với sản phẩm (đang tự bù, khách
  không cần làm gì); phần còn lại thiếu giá vốn". Mobile đọc `problem` tùy chọn → thiếu trường chạy bình thường (1.4.1 sửa chữ sau).
- Tác động prod dự kiến: 63 chiến dịch đang chạy / 31 gian hết "Chưa tin được"; không gian ACTIVE có chiến dịch nào tụt dưới 90 %
  vì dòng không id (đo 28/10: chỉ LUMI SOLAR 100 % không id — gian **ngủ đông**, 0 chiến dịch chạy, Lát 2 bỏ qua theo thiết kế).

### 12.3 Còn lại (chưa làm, chờ anh)

- Bước 2: chiến dịch nhiều SPU — trộn lãi từng SPU theo tỷ trọng `gross_revenue` từng SPU của chiến dịch (report `item_group_id`).
  Chưa đo (tối 28/10 ưu tiên bước 1).
- Shopee Lát 4 (một chiều `direct_gmv`): cùng bản chất "so với doanh thu sàn gán"; chưa đo lại tối nay — nếu số prod có ca oan
  tương tự thì áp cùng cách đo bằng id.
- Nhóm "thấp hơn": kiểm giả thuyết `gross_revenue` trước giảm giá bằng một đơn cụ thể của Bella Look.

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
| B6 | Số liệu cấp sản phẩm phải có **tự kiểm với sàn**; lệch quá ngưỡng thì **không được dùng để quyết định** (hòa vốn, luật tự động, lãi ước tính). | `lib/tiktok-breakeven.ts breakevenCheckProblem` (Lát 0) |
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
| **0** | **Chặn tạm**: đối chiếu doanh thu lệch quá ngưỡng → hòa vốn "chưa tin được": không hiện số, luật tự động rơi về % mục tiêu, Lãi/lỗ ước tính "—", nhận định "Chưa kết luận được" kèm lý do. Không đổi dữ liệu. | ✅ code 18/10 (mục 5) |
| 1 | Nền đúng: `OrderItem.externalId` (id lá) + `itemId` (SPU) trong sổ dòng hàng; 3 luồng tạo đơn ghi id (Lazada: mã trước, id khi có mẫu — anh chốt 18/10); mọi phép gom đổi sang id trước, mã sau; gỡ dần 4 lớp vá chuỗi. Migration thêm cột NULL, lấy khóa có thử lại. | ✅ 1a code 18/10 (mục 6.8) · ⏳ 1b, 1c |
| 2 | Bù đơn cũ: mã ↔ 1 sản phẩm → điền `itemId` suy luận; mã nhiều sản phẩm → quét lại từ sàn CHỈ đơn có dòng mồ côi (~20 nghìn đơn ÷ 50/lượt ≈ 400–500 lượt, rải 32 gian, chạy nền có nhịp nghỉ, không pg-boss); ghi `externalId` + đổi `channelSku` sang khóa hiện hành; GIỮ `costPriceAtSale`, KHÔNG đặt `productId`. | ⏳ |
| 3 | Lá mới thừa kế giá vốn dòng gộp cũ cùng mã (đánh dấu "thừa kế"); vá hồi tố 79 dòng. Cần anh chốt: thừa kế tự động hay khách đặt. | ⏳ |
| 4 | Dòng đối chiếu doanh thu cho Shopee (`ads_gms_item_reports` có GMV theo item) — cùng lưới an toàn B6. | ⏳ |

## 5. Lát 0 — chi tiết (18/10/2026)

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

## 6. Lát 1 — thiết kế (18/10/2026, CHỜ ANH CHỐT trước khi code)

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
| `lib/cost-price.ts SKU_MATCH` (vá giá vốn đơn cũ) | thêm nhánh **đầu** `oi.externalId = cp.externalId` (dòng có id đi nhánh này; ba nhánh chuỗi giữ cho dòng NULL) | giữ chuỗi làm đường lui vĩnh viễn cho Lazada chưa có id |
| `order-item-images` (`startsWith "("`) | giữ | đổi sang `OR externalId = line.externalId` |
| `expandReturnKeys` (hoàn hàng) | giữ | khớp `OrderItem.externalId` trực tiếp, expand làm đường lui |
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

### 6.8 Lát 1a — đã code (18/10/2026, chưa push)

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

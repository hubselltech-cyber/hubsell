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
| 1 | Nền đúng: `OrderItem.externalId` (id lá) + `itemId` (SPU) trong sổ dòng hàng; 3 luồng tạo đơn ghi id (Lazada: mã trước, id khi có mẫu — anh chốt 18/10); mọi phép gom đổi sang id trước, mã sau; gỡ dần 4 lớp vá chuỗi. Migration thêm cột NULL, lấy khóa có thử lại. | ✅ 1a (mục 6.8) · ✅ 1b (mục 6.9) · ✅ 1c code 18/10 (mục 6.10) |
| 2 | Bù đơn cũ: HỎI SÀN cho mọi dòng chưa có id của gian ACTIVE trong 90 ngày (mồ côi trước), lô 50, nghỉ 2 s; ghi `externalId` + đổi `channelSku`; GIỮ `costPriceAtSale`, KHÔNG đặt `productId`; gian không gọi được sàn suy luận hẹp (mục 7). | ✅ code 18/10 (mục 7.7) |
| 3 | Lá mới thừa kế giá vốn THEO LỊCH SỬ khách đã đặt cho cùng mã thô (không bịa, không nhắc — anh chốt 18/10); vá hồi tố 79 dòng. | ✅ code 18/10 (mục 8.7) — chỉ sửa một lần, không áp cho lá khách thêm sau |
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
| `lib/cost-price.ts SKU_MATCH` (vá giá vốn đơn cũ) | ✅ 1c: dòng có id khớp **chỉ** bằng `oi.externalId = cp.externalId`; ba nhánh chuỗi chỉ còn cho dòng `externalId IS NULL` | giữ chuỗi làm đường lui vĩnh viễn cho Lazada chưa có id |
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

### 6.9 Lát 1b — gom theo id, đã code (18/10/2026, chưa push)

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

### 6.10 Lát 1c — vá giá vốn theo id, đã code (18/10/2026, chưa push)

- `lib/cost-price.ts SKU_MATCH` (dùng ở cả 5 đường vá: theo sản phẩm kho, theo SKU sàn, nút "Áp giá vốn cho đơn cũ", và điều
  kiện "gian có giá riêng"): `(oi.externalId IS NOT NULL AND oi.externalId = cp.externalId) OR (oi.externalId IS NULL AND <3 nhánh
  mã cũ>)`. Dòng có id không bao giờ bị vá bởi lá khác cùng mã; dòng chưa có id vẫn vá theo mã như trước. Index `OrderItem(externalId)`
  của Lát 1a phục vụ nhánh id.
- Test DB `cost-per-shop-db` (+1 ca): hai lá cùng sản phẩm mã trùng (`SHARED (Đỏ)` / `SHARED (Xanh)`); dòng ghi id Xanh nhưng mã Đỏ →
  vá giá Đỏ **không** đụng, vá giá Xanh mới ăn; dòng cũ không id mã Đỏ → vá theo mã; dòng cũ mã thô `SHARED` → chưa vá được (đợi
  Lát 2). Lưu ý: dòng mang mã thô đã đổi đuôi hôm nay **không** được vá dù nhập giá — Lát 2 bù id sẽ sửa, không vá "ké" theo mã thô.
- Hệ quả với 79 dòng (~36 triệu) đơn 15–18/10 mất giá vốn: chúng mang khóa có đuôi và từ 18/10 có id → khách nhập giá vốn cho lá mới
  là vá được ngay (Lát 3 bàn chuyện thừa kế tự động).

## 7. Lát 2 — thiết kế: bù id cho đơn cũ (18/10/2026, CHỜ ANH CHỐT trước khi code)

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

### 7.7 Lát 2 — đã code (18/10/2026, chưa push)

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

## 8. Lát 3 — thiết kế: lá mới thừa kế giá vốn THEO LỊCH SỬ khách đã đặt (18/10/2026, CHỜ ANH CHỐT)

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

### 8.7 Lát 3 — đã code (18/10/2026, chưa push)

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
- Bên lề (không thuộc lát này): còn ~74 dòng đơn 15–18/10 giá vốn 0 dù lá **đã có giá riêng và đã nối kho** — đơn về trước khi danh
  mục có lá, chưa ai bấm lưu lại giá nên chưa được vá. Nên có lượt vá định kỳ "dòng giá 0 của lá đã có giá" (một câu UPDATE, id trước)
  — đề xuất riêng.

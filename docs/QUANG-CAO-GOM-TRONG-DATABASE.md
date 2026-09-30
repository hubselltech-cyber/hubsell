# Phương án: gom biên lãi / hòa vốn quảng cáo TRONG DATABASE

Trạng thái: **ANH TRUNG ĐÃ DUYỆT 30/09/2026 chiều**; tối 30/09 anh đổi điểm 1 ở mục 9: **tách TikTok thành đợt riêng**, Shopee + Lazada làm chung đợt 1. Ba điểm còn lại giữ theo đề xuất.
**Đợt 1 (Shopee + Lazada): XONG tối 30/09 — prod 20/20 gian khớp, mặc định đã đổi sang `sql`** (đường lui `ADS_MARGIN_SOURCE=rows` giữ tới ~07/10) — chi tiết và số đo ở mục 11.
**Đợt 2 (TikTok): XONG đêm 30/09 — prod 11/11 gian khớp, mặc định đã đổi sang `sql`** (đường lui `TIKTOK_BREAKEVEN_SOURCE=rows` giữ tới ~07/10) — chi tiết và số đo ở mục 12.
Thuộc giai đoạn 1 của `docs/KIEN-TRUC-QUY-MO-TRIEU-DON.md`, tiếp nối `docs/SO-CAI-DON.md` mục 9.7.

## 1. Mục tiêu và ranh giới

- **Mục tiêu:** bỏ việc giữ đơn của một gian trong RAM để tính biên lãi (Shopee, Lazada) và hòa vốn (TikTok), nhờ đó bỏ được hai cái phanh số đơn. Phép gom chạy bằng SQL trên sổ dòng hàng `order_line_ledger`.
- **Không đổi luật nào.** Công thức biên lãi, hòa vốn, ngưỡng cỡ mẫu, ngưỡng độ phủ giá vốn, quy tắc "chỉ đơn đã đối soát thật + đơn hủy cùng lứa" của TikTok, quy tắc "Lazada chỉ đơn đã đối soát" giữ nguyên từng chữ. Chỉ đổi NƠI cộng: từ vòng lặp JS sang câu SQL.
- **Trợ lý quảng cáo vẫn giữ diễn tập.** Việc này không bật live, không đổi ngưỡng, không đụng bộ luật đánh giá chiến dịch.

## 2. Hiện trạng (sau 30/09 15:20, commit `c824e16`)

- Nguồn đã là sổ cái: `ledgerCompactOrders` đọc hai câu SELECT (đơn + dòng hàng), không còn đọc bảng đơn kèm quan hệ và không tính lại `computePnlRow`.
- Nhưng mảng "dòng gọn" của cả cửa sổ vẫn nằm trong RAM, rồi các hàm thuần duyệt mảng đó:
  - Shopee/Lazada, cửa sổ 30 ngày, phanh 20.000 đơn mới nhất: `marginOverRows` (toàn gian, từng chiến dịch, từng sản phẩm), nhịp bán và cờ thiếu giá vốn theo sản phẩm (`ads-recommend-data.ts`).
  - TikTok, cửa sổ 60 ngày, phanh 8.000 đơn mới nhất: `tiktokBreakevenBase`, `tiktokBreakevenBaseByGroup`, `placedRevenue`, `salesPaceByGroup`.
- Chạm phanh thì phép tính chỉ đại diện các đơn mới nhất mà không báo ra.
- Số prod 30/09: gian lớn nhất có 3.162 đơn trong 60 ngày (TikTok) và 1.275 đơn trong 30 ngày (Shopee). **Chưa gian nào chạm phanh**, nên hôm nay chưa có số sai; đây là việc làm trước cho shop lớn.

## 3. Thiết kế

### 3.1 Ý chính

Sổ dòng hàng đã có sẵn, cho từng dòng: mã SKU sàn, số lượng, giá trị dòng (`lineGross`), và phần doanh thu thực tế, lợi nhuận, phí GMV Max của đơn ĐÃ phân bổ về dòng theo tỷ trọng giá trị (`actualRevenue`, `profit`, `feeGmvMax`). Vì vậy:

> phần của đơn thuộc một nhóm SKU = Σ các dòng của đơn có SKU trong nhóm

đúng bằng `số của đơn × (giá trị dòng khớp ÷ giá trị cả đơn)` mà các hàm thuần đang tính. Mọi phép gom theo nhóm SKU thành `GROUP BY nhóm` trên sổ dòng hàng.

### 3.2 Bảng ánh xạ nhóm → SKU

Code hiện đã nạp sản phẩm sàn (`ChannelProduct`) và chiến dịch (`AdsCampaign.itemIds`) để dựng các tập SKU. Giữ nguyên phần dựng đó, rồi gửi ánh xạ vào câu SQL bằng hai mảng song song (`unnest($nhóm::text[], $sku::text[])`). Một SKU có thể thuộc nhiều nhóm (nhiều chiến dịch), cặp (nhóm, SKU) là duy nhất. Ba họ nhóm đi chung một câu, phân biệt bằng tiền tố: `shop` (mọi dòng), `c:<id chiến dịch>`, `p:<id sản phẩm>`.

### 3.3 Shopee / Lazada: một câu cho mọi nhóm

`ledgerMarginByGroup(gian, cửa sổ 30 ngày, ánh xạ)` trả về cho từng nhóm đúng cấu trúc `MarginBase` hiện có: số đơn có giá vốn, doanh thu, lợi nhuận, số đơn thiếu giá vốn, doanh thu của đơn thiếu giá vốn.

- Điều kiện đơn: không hủy; Lazada thêm "đã đối soát" (như `pnlRowsForMargin`).
- Bước 1 gom về (nhóm, đơn): Σ `lineGross`, Σ `actualRevenue`, Σ `profit`; chỉ giữ cặp có Σ `lineGross` > 0 (tương đương `matchTotal > 0`).
- Bước 2 gom về nhóm: đếm đơn và cộng tiền, tách theo cờ thiếu giá vốn của đơn.
- Nhịp bán và số lượng thiếu giá vốn theo sản phẩm (`ads-recommend-data.ts`): một câu `GROUP BY nhóm` nữa trên cùng điều kiện, cộng `quantity` theo mốc 7 và 30 ngày, và cộng riêng các dòng có giá vốn dòng bằng 0.

> **Khi làm (30/09 tối) em đổi cách viết câu này, luật giữ nguyên:** gom MỘT tầng thay cho hai bước, nhịp bán đi chung một câu. Lý do và số đo ở mục 11.2.

### 3.4 TikTok: một câu cho mọi nhóm

`ledgerTiktokBreakevenByGroup(gian, cửa sổ 60 ngày, ánh xạ)` trả về cho từng nhóm đúng cấu trúc `BreakevenBase` hiện có.

- Cờ "đã đối soát THẬT" của đơn = `isSettled` VÀ có bản kê TikTok VÀ bản kê không phải số ước tính VÀ đơn không hủy. Lấy bằng cách nối bảng `tiktok_order_settlements` (đã làm ở `ledgerCompactOrders`).
- Mốc cùng lứa = ngày tạo của đơn đã đối soát thật mới nhất trong cửa sổ của gian. Tính bằng một truy vấn con, dùng chung cho mọi nhóm.
- Đơn được tính ("có kết cục cuối") = đã đối soát thật, hoặc đơn hủy có ngày tạo không muộn hơn mốc cùng lứa. Còn lại đếm vào `pendingOrders`.
- Trong đơn được tính: thiếu giá vốn thì doanh thu dồn vào `missingCostRevenue`; còn lại cộng doanh thu; đơn không hủy cộng thêm lãi trước quảng cáo (`profit − feeGmvMax`) và phí quảng cáo (`−feeGmvMax`).
- Tự kiểm mẫu số theo chiến dịch (`placedRevenue`): doanh thu mọi đơn đặt của nhóm trong khoảng ngày riêng của từng chiến dịch. Gửi kèm mốc "từ ngày" của từng chiến dịch như một cột của bảng ánh xạ.
- Nhịp bán theo sản phẩm (`salesPaceByGroup`): như Shopee, trên mọi đơn không hủy.

### 3.5 Bốn chỗ dễ sai và cách giữ đúng

1. **Đếm đơn theo nhóm.** Một đơn có hai SKU cùng nhóm chỉ được đếm một lần. Vì vậy phải gom hai bước (nhóm, đơn) rồi mới tới nhóm, không cộng thẳng theo dòng.
2. **Đơn mà mọi dòng giá 0** (quà tặng). Hàm thuần bỏ qua đơn này. Trên sổ, các dòng của nó có `lineGross` = 0 nên điều kiện Σ `lineGross` > 0 tự loại.
3. **Làm tròn.** Sổ lưu phần phân bổ của từng dòng đã làm tròn 2 số lẻ, phần dư dồn về dòng lớn nhất, nên Σ các dòng của một đơn luôn bằng đơn. Tổng của một nhóm con có thể lệch hàm thuần dưới 1 đồng. Số đơn thì phải bằng tuyệt đối.
4. **Cờ thiếu giá vốn.** Biên lãi và hòa vốn dùng cờ CẤP ĐƠN (có sẵn trên dòng sổ). Riêng "số lượng thiếu giá vốn theo sản phẩm" của Gợi ý chạy quảng cáo dùng giá vốn CẤP DÒNG. Hai nơi giữ đúng như hiện tại.

### 3.6 Hàm thuần giữ lại

Các hàm thuần hiện có (`marginOverRows`, `tiktokBreakevenBase`, `…ByGroup`, `placedRevenue`, `salesPaceByGroup`) KHÔNG xóa: chúng là chuẩn đối chiếu trong test và là đường lui. Phần phía sau (`marginOf`, `toTiktokBreakeven`, kết luận từng sản phẩm, đánh giá chiến dịch) không đổi vì vẫn nhận đúng `MarginBase` / `BreakevenBase`.

## 4. Thay đổi mà khách nhìn thấy

- Với mọi gian đang có trên prod: **không thay đổi**, vì chưa gian nào chạm phanh. Chênh lệch nếu có là dưới 1 đồng do làm tròn, không đổi biên lãi hay ROAS hòa vốn hiển thị.
- Với gian vượt 20.000 đơn trong 30 ngày hoặc 8.000 đơn TikTok trong 60 ngày: số sẽ tính trên ĐỦ đơn thay vì chỉ các đơn mới nhất. Đây là sửa cho đúng.

## 5. Cách lên prod

1. Hai công tắc env RIÊNG, mỗi cái nhận `rows` (đường hiện tại) hoặc `sql`: `ADS_MARGIN_SOURCE` cho Shopee/Lazada, `TIKTOK_BREAKEVEN_SOURCE` cho TikTok. **Mỗi đợt lên prod ở `rows`**, tức là chưa đổi gì với khách. Lỗi hoặc lui đường của khối này không kéo theo khối kia.
2. Mở rộng lệnh `scripts/ledger-backfill.ts ads-compare` thêm chế độ so kết quả CUỐI giữa hai đường cho từng gian: biên lãi gian, từng chiến dịch, từng sản phẩm; hòa vốn TikTok gian, từng chiến dịch kèm số tự kiểm, từng sản phẩm; nhịp bán. Chạy trên Render Shell theo từng đợt: các gian Shopee/Lazada ở đợt 1, các gian TikTok ở đợt 2.
3. Khớp hết thì đổi mặc định của KHỐI ĐÓ sang `sql` trong code, giữ giá trị `rows` làm đường lui một tuần kể từ ngày bật khối đó. Shopee/Lazada bật tối 30/09 thì gỡ cùng đợt 07/10; TikTok gỡ sau ngày bật của nó một tuần.
4. Bộ nhớ đệm giữ nguyên: Shopee/Lazada 30 phút theo gian (đổi từ "nhớ mảng dòng" sang "nhớ kết quả gom"), TikTok 45 giây theo gian. Nhập giá vốn vẫn xóa đệm của gian đó như hiện nay.
5. **(Đề xuất 30/09 tối, CHỜ ANH CHỐT)** Trong tuần còn đường lui: câu SQL lỗi hoặc quá thời gian thì lượt đó tự tính bằng đường `rows` và ghi log lỗi, để khách vẫn thấy số thay vì trang báo lỗi. Gỡ cùng lúc với đường `rows`.

## 6. Kiểm thử

- Test thuần hiện có giữ nguyên, không sửa.
- Test tích hợp mới trên DB dev: với mọi gian Shopee/Lazada, kết quả SQL theo từng nhóm bằng hàm thuần chạy trên dòng gọn (số đơn bằng tuyệt đối, tiền lệch không quá 1 đồng).
- TikTok: DB dev không có đơn TikTok. Test tích hợp tự tạo một bộ đơn TikTok mẫu có bản kê thật, bản kê ước tính, đơn hủy trước và sau mốc cùng lứa, đơn thiếu giá vốn, đơn nhiều SKU; so SQL với hàm thuần. Sau đó so trên prod bằng lệnh ở mục 5.
- Kiểm kế hoạch truy vấn: câu gom phải đi bằng chỉ mục `(channelId, createdDate)` của sổ dòng hàng.

## 7. Tải

- Mỗi lần tính quét các dòng hàng của MỘT gian trong cửa sổ 30 hoặc 60 ngày, qua chỉ mục `order_line_ledger (channelId, createdDate)` đã có. Không cần migration mới.
- Shop 300.000 đơn mỗi tháng ở một gian: khoảng 0,5 đến 1 triệu dòng mỗi lượt quét. Con số này là ước lượng, em chưa đo; nhờ bộ nhớ đệm, mỗi gian quét nhiều nhất 2 lần mỗi giờ cho Shopee/Lazada. **Đã đo 30/09 tối cho Shopee/Lazada, xem mục 11.3.**
- Nếu đo thấy nặng ở shop lớn: bước sau là bảng cộng sẵn theo ngày × SKU (thuộc giai đoạn 4 "bảng tổng hợp theo ngày"). Không làm trong việc này.

## 8. Không làm trong việc này

- Ba việc đang treo của nhóm quảng cáo (lệch ngày 00:00–07:00 của `toShopeeDate`, bảng điểm 90 ngày chỉ nạp 30 ngày chi tiêu, trần 5 lệnh dừng mỗi ngày và thứ tự lệnh). Chúng đổi HÀNH VI của Trợ lý nên phải trình riêng từng việc.
- Đổi ngưỡng, đổi cửa sổ 30/60 ngày, bật live.

## 9. Bốn điểm đã chốt (anh Trung 30/09/2026: "4 phương án em đề xuất hợp lý rồi"; điểm 1 anh đổi tối 30/09)

| # | Câu hỏi | Đã chốt |
|---|---|---|
| 1 | Làm cả ba sàn trong một đợt hay tách? | **Tách hai đợt** (đổi tối 30/09, đề xuất ban đầu là một đợt). Đợt 1 Shopee + Lazada chung một câu SQL; đợt 2 TikTok riêng. Lý do ở mục 9.1. |
| 2 | Lên prod ở chế độ tắt rồi so xong mới bật, hay bật ngay? | Tắt trước, so 30 gian khớp mới bật. Đây là đầu vào của quyết định dừng và bật chiến dịch. |
| 3 | Có gộp ba việc đang treo của nhóm quảng cáo vào tối nay không? | Không gộp. Gộp thì không còn phân biệt được số đổi do đâu. |
| 4 | Chấp nhận lệch dưới 1 đồng do làm tròn ở tổng theo nhóm? | Chấp nhận. Số đơn vẫn bằng tuyệt đối, biên lãi và ROAS hòa vốn hiển thị không đổi. |

### 9.1 Vì sao tách TikTok (anh Trung nêu, em đồng ý)

- **Lỗi hệ thống phải rơi riêng từng khối.** Bước so prod chỉ bắt được SỐ SAI tại một thời điểm; nó không bắt được câu SQL lỗi, chậm hoặc đè tải database khi chạy thật liên tục. Bật hai khối cùng lúc thì sự cố loại này rơi lên cả ba sàn và không biết khối nào gây ra.
- **TikTok là khối nặng tải nhất.** Kết quả TikTok chỉ nhớ đệm 45 giây theo gian (`RESULT_TTL_MS`), Shopee/Lazada nhớ 30 phút (`ADS_PNL_CACHE_MIN`). Khi khách đang mở trang, câu gom TikTok chạy dày hơn nhiều lần, trên cửa sổ 60 ngày và có nối bảng bản kê. Tải thật chưa đo.
- **TikTok là khối khó kiểm nhất.** Bốn luật riêng (đối soát thật, mốc cùng lứa, đơn chờ kết cục, tự kiểm theo ngày chiến dịch) và DB dev không có đơn TikTok.
- **Không gấp.** Prod chưa gian nào chạm phanh (mục 2).
- Code hai khối vốn đã nằm ở hai nơi tách biệt (`integrations/shopee/ads-insights.ts` + `ads-recommend-data.ts` và `integrations/tiktok-ads/breakeven.ts`), nên tách không phải mở lại phần đã làm; phần dùng chung chỉ là cách gửi bảng ánh xạ nhóm → SKU.

## 10. Trình tự làm (hai đợt)

**Đợt 1: Shopee + Lazada** (khi anh nhắn "làm đi")

1. `ledgerMarginByGroup` + nhịp bán; test DB dev so với hàm thuần.
2. Nối vào `computeChannelAdsInsights`, `computeChannelProductBreakeven`, `computeChannelAdsRecommendations` sau công tắc `ADS_MARGIN_SOURCE`.
3. Mở rộng `ads-compare` cho biên lãi và nhịp bán, chạy cả bộ test, push ở chế độ `rows`.
4. So trên prod mọi gian Shopee/Lazada, ghi lại thời gian chạy câu gom. Khớp thì commit đổi mặc định sang `sql`, push, kiểm lại trang Quảng cáo Shopee của tài khoản demo.

**Đợt 2: TikTok** (phiên riêng, ngày do anh chọn, sau khi đợt 1 đã bật và chạy êm)

1. `ledgerTiktokBreakevenByGroup` + tự kiểm theo chiến dịch + nhịp bán; test DB dev bằng bộ đơn TikTok mẫu.
2. Nối vào `computeTiktokAdsBreakeven`, `computeTiktokProductBreakevens` sau công tắc `TIKTOK_BREAKEVEN_SOURCE`.
3. Mở rộng `ads-compare` cho hòa vốn TikTok, chạy cả bộ test, push ở chế độ `rows`.
4. So trên prod mọi gian TikTok và ĐO thời gian câu gom (vì đệm chỉ 45 giây). Khớp và tải ổn thì đổi mặc định sang `sql`, push, kiểm lại trang Quảng cáo TikTok của tài khoản demo.

Ước lượng (chưa đo): đợt 1 khoảng 1,5 đến 2 giờ, đợt 2 khoảng 2 giờ.

## 11. Đợt 1 (Shopee + Lazada): đã làm tối 30/09/2026

### 11.1 Bản đồ mã nguồn (sau khi dọn dẹp 30/09/2026 tối)

Cùng khuôn với các báo cáo khác của sổ cái: luật thuần ở `lib/`, câu SQL ở `services/order-ledger.ts`, phần nạp + ghép ở `integrations/`.

| Tệp (dưới `backend/`) | Giữ gì |
|---|---|
| `src/lib/ads-margin.ts` | THUẦN. Luật biên lãi (`marginOverRows`, `marginOf`, ngưỡng độ phủ 90%, `pnlRowsForMargin`), cửa sổ 30 ngày, bộ nhóm SKU của gian (`buildAdsGroupSets`: nhóm toàn gian `shop`, mỗi chiến dịch `c:<id>`, mỗi sản phẩm sàn `p:<item_id>`; `adsGroupMappingOf` kèm dấu vân tay), nhịp bán, mặt tiền `ChannelMargins` với hai bản `marginsFromRows` / `marginsFromGroups`, kiểu dữ liệu của câu gom. |
| `src/lib/ads-dates.ts` | THUẦN. Các hàm ngày của quảng cáo dùng chung ba sàn (ngày sàn, bộ lọc `?from=&to=`). |
| `src/lib/report-source.ts` | Công tắc nguồn số: `resolveReportSource` (sổ cái ↔ đơn gốc) và `resolveAdsMarginSource` (env `ADS_MARGIN_SOURCE`: mặc định `sql`, `rows` = đường lui; `LEDGER_REPORTS_SOURCE=orders` thì luôn `rows`). |
| `src/services/order-ledger.ts` | Câu SQL: `ledgerMarginByGroup` (một câu cho mọi nhóm: số đơn có giá vốn, doanh thu, lợi nhuận, đơn và doanh thu thiếu giá vốn, lượng bán 30 ngày / 7 ngày, lượng bán chưa có giá vốn dòng), `explainLedgerMarginByGroup`, `ledgerCompactOrders` (dòng gọn cho đường `rows` và TikTok); cách viết mốc kỳ `tsParam` / `dayParam` (env `LEDGER_SCOPE_PARAMS`). |
| `src/integrations/shopee/ads-margin-source.ts` | Nạp từ database + bộ đệm: `loadMarginRows`, `loadMarginGroups`, `fetchChannelMargins` (chọn đường cộng, lưới đỡ khi câu gom lỗi), `loadAdsGroupSets`. Bộ đệm 30 phút theo gian ở cả hai đường, xóa khi nhập giá vốn; đường `sql` nhớ KẾT QUẢ gom kèm dấu vân tay bộ nhóm. |
| `src/integrations/shopee/ads-insights.ts` | Ghép số thành kết luận: `computeChannelAdsInsights` (chiến dịch + kết luận của Trợ lý), `computeChannelProductBreakeven` (bảng hòa vốn sản phẩm). Ngưỡng 5 đơn, bộ luật đánh giá chiến dịch không đổi. |
| `src/integrations/shopee/ads-recommend-data.ts` | `computeChannelAdsRecommendations` (gợi ý chạy quảng cáo) — lấy biên lãi và nhịp bán từ cùng bộ `ChannelMargins` của bảng hòa vốn. |
| `src/integrations/shopee/ads-margin-compare.ts` | Công cụ so hai đường cộng ở hai tầng (số gốc từng nhóm + ba kết quả cuối). Gỡ cùng đường lui ~07/10. |
| `src/services/order-ledger-params-compare.ts` | Công cụ so hai cách viết mốc kỳ cho mọi câu đọc sổ. Gỡ cùng `LEDGER_SCOPE_PARAMS` ~07/10. |
| `src/services/channel-delete.ts` | Xóa gian theo lô (mục 11.8 việc 3). |
| `scripts/ledger-backfill.ts` | Lệnh `ads-compare`, `params-compare` (chạy trên Render Shell của worker) cùng các lệnh bảo trì sổ. |
| `scripts/bench-large-shop.ts` | Dựng / xem / dọn gian thử cỡ shop lớn trên database máy mình để đo tải (từ chối chạy nếu `DATABASE_URL` không trỏ localhost). |

Test: thuần ở `src/lib/__tests__/ads-margin.test.ts`, `ads-dates.test.ts` và `src/services/__tests__/order-ledger-scope.test.ts`; trên DB dev ở `src/integrations/__tests__/`: `ads-margin-sql-db`, `ads-margin-fallback-db`, `ads-rows-ledger-db`, `order-ledger-params-db`, `channel-delete-db`.

Việc gỡ ~07/10 (một đợt): đường `rows` (`loadMarginRows` cho Shopee/Lazada, `marginsFromRows`, bộ đệm mảng đơn, `MARGIN_MAX_ORDERS`, lưới đỡ, `ads-margin-compare.ts`, lệnh `ads-compare` phần Shopee/Lazada) và cách viết mốc kỳ cũ (nhánh `text`, `order-ledger-params-compare.ts`, lệnh `params-compare`). GIỮ `marginOverRows` làm chuẩn đối chiếu trong test.

### 11.2 Ba chỗ làm khác bản thiết kế ở mục 3 (luật không đổi)

1. **Gom một tầng thay cho hai bước (nhóm, đơn) → nhóm.** Cộng thẳng phần sổ đã phân bổ về từng dòng, chỉ lấy dòng có giá trị > 0; số đơn = số mã đơn phân biệt có ít nhất một dòng có giá thuộc nhóm. Bằng đúng luật cũ vì: đơn có dòng có giá thì dòng giá 0 được sổ phân bổ đúng 0 (phần dư làm tròn dồn về dòng giá trị lớn nhất); đơn mà mọi dòng giá 0 thì hàm thuần bỏ cả đơn, và lọc theo dòng bỏ đúng các dòng đó. Lý do đổi: đo ở quy mô shop lớn thì bản hai bước mất 8 đến 10 giây (mục 11.3).
2. **Mốc thời gian của câu gom gửi dạng số, không gửi dạng chuỗi.** Prisma gửi chuỗi dưới dạng text; `$n::timestamp` bị Postgres đổi kiểu lại ở TỪNG dòng quét (đo: mỗi mốc thời gian khoảng 1,9 micro giây mỗi dòng, mỗi mốc ngày khoảng 1,1). Viết thành "mốc 1970 + số" thì Postgres gộp thành hằng khi lập kế hoạch, ước lượng đúng số dòng và chỉ mở mảnh tháng cần đọc. Có test trên database thật xác nhận hai cách viết cho cùng giá trị tới từng mili giây.
3. **Nhịp bán đi chung câu gom** thay vì một câu riêng, và nhóm gửi vào SQL bằng số thứ tự thay cho chuỗi tên nhóm.

### 11.3 Số đo (DB dev trên máy, Postgres 17, chưa đo trên Supabase)

Gian thử dựng riêng: 300.000 đơn, 405.000 dòng hàng trong 30 ngày, 2.000 sản phẩm × 3 phân loại, 100 chiến dịch × 20 sản phẩm (12.000 cặp ánh xạ, kết quả 2.101 nhóm). Dữ liệu thử đã xóa sạch sau khi đo.

| Cách viết câu gom | Thời gian một lượt | Tệp tạm |
|---|---|---|
| Hai bước như mục 3.3, mốc thời gian dạng chuỗi (cách các báo cáo khác đang viết) | 10,0 giây | 263 MB |
| Hai bước, mốc thời gian tính một lần | 8,1 giây | 263 MB |
| Hai bước, mốc thời gian dạng hằng | 3,0 giây | chưa ghi lại |
| **Bản đang dùng: một tầng, mốc thời gian dạng hằng, đếm mã đơn theo thứ tự byte** | **1,75 giây** (2,0 giây khi Postgres dùng kế hoạch chung) | 66 MB |

- Mọi cách viết trên cho kết quả GIỐNG NHAU ở cả 2.101 nhóm.
- Gian dev thật lớn nhất (1.114 đơn, 1.551 dòng): câu gom 6 mili giây.
- Còn lại phần lớn thời gian là đếm mã đơn phân biệt trên khoảng 1,1 triệu cặp (nhóm, dòng hàng). Muốn nhanh hơn nữa ở shop rất lớn thì bước sau vẫn là bảng cộng sẵn theo ngày × SKU (giai đoạn 4).
- Nhờ bộ đệm 30 phút, mỗi gian chạy câu này nhiều nhất 2 lần mỗi giờ ở mỗi tiến trình (web, worker).

### 11.4 Kiểm thử

- `lib/__tests__/ads-margin.test.ts`: công tắc, bộ nhóm, dấu vân tay, hai bản của mặt tiền, nhịp bán.
- `integrations/__tests__/ads-margin-sql-db.test.ts` trên DB dev:
  - dữ liệu thật của mọi gian Shopee/Lazada: bộ nhóm thật + nhóm thử (từng SKU, ba SKU gộp, mọi SKU phải bằng nhóm toàn gian), hai tầng so đều 0 lệch, lệch tiền lớn nhất dưới 0,1 đồng;
  - bộ đơn tự dựng cho ca dữ liệu dev không có: đơn chỉ có quà giá 0, quà trong đơn có hàng, đơn hủy, đơn thiếu giá vốn (có quà, có hai dòng cùng SKU), đơn ngoài cửa sổ, đơn ngoài 7 ngày, phần phân bổ bị làm tròn; số kỳ vọng suy từ cách dựng.
- `services/__tests__/order-ledger-scope.test.ts`: `ledgerScopeSql` mặc định giữ nguyên câu chữ; mốc dạng hằng bằng mốc dạng chuỗi trên database thật.
- Thử đột biến: sửa tạm 16 chỗ trong câu gom (bỏ lọc đơn hủy, bỏ lọc đã đối soát, đếm dòng thay vì đếm đơn, tính cả dòng quà, lệch mốc 7 ngày, lệch mốc ngày…), cả 16 lần bộ test đều đỏ.
- Cả bộ 891 test qua, `tsc --noEmit` sạch.

### 11.5 Việc còn lại của đợt 1

1. ✅ Push ở chế độ `rows` (commit `d23d807`, web + worker live 18:54–18:55).
2. ✅ So trên prod: `npx tsx scripts/ledger-backfill.ts ads-compare --platform SHOPEE` rồi `--platform LAZADA` trên Render Shell của worker — kết quả ở mục 11.7.
3. ✅ Đổi mặc định sang `sql` trong code; `ADS_MARGIN_SOURCE=rows` là đường lui, gỡ cùng đợt ~07/10 (kèm `marginsFromRows`, bộ đệm mảng đơn, `MARGIN_MAX_ORDERS`; giữ `marginOverRows` làm chuẩn đối chiếu trong test).
4. ✅ Lưới đỡ (anh chốt 30/09 tối, mục 11.8): câu gom lỗi thì lượt đó tự tính bằng đường `rows`, ghi log `[Ads-margin]`, gian đó nghỉ câu gom 5 phút rồi tự thử lại. Lui tay hẳn vẫn là env `ADS_MARGIN_SOURCE=rows` trên CẢ web và worker.
5. ⏳ Theo dõi một tuần: log lỗi của web/worker, CPU database ở trang Supabase.

### 11.6 Hai phát hiện ngoài phạm vi — anh chốt 30/09 tối "cả ba việc phải làm cho xong", ĐÃ SỬA (mục 11.8)

1. **Mọi báo cáo trên sổ cái đang đổi kiểu mốc thời gian ở từng dòng quét** (cùng nguyên nhân với mục 11.2 điểm 2, vì dùng chung `ledgerScopeSql`). Ở số đơn hiện tại không ai thấy; ở kỳ có vài trăm nghìn dòng thì mỗi báo cáo mất thêm cỡ giây. Cách sửa đã có sẵn (bật `constParams`), nhưng đụng tới mọi báo cáo đã so khớp prod nên phải làm thành một việc riêng và so lại prod.
2. **Xóa gian lớn sẽ rất chậm.** Khóa ngoại `order_line_ledger.orderItemId` không có chỉ mục bắt đầu bằng cột đó, nên mỗi dòng hàng bị xóa kéo theo một lượt dò cả sổ dòng hàng. Đo trên DB dev khi mảnh tháng có 410.000 dòng: 59 mili giây mỗi lượt dò, có chỉ mục thì 0,4 mili giây; xóa gian thử 300.000 đơn chạy hơn 12 phút chưa xong, thêm chỉ mục tạm thì xong trong 247 giây. Ảnh hưởng tới nút Xóa gian (27/09) kể từ khi có sổ cái. Hai cách sửa: thêm chỉ mục, hoặc bỏ khóa ngoại đó (khóa ngoại theo `orderId` đã lo việc xóa theo đơn). Cần migration nên em trình riêng.

### 11.7 Kết quả so trên PROD 30/09/2026 khoảng 19:00 (bản `d23d807`, Render Shell worker)

- **Shopee: TAT CA KHOP (16 gian). Lazada: TAT CA KHOP (4 gian).** Ở cả 20 gian: lệch số gốc 0 nhóm, lệch nhịp bán 0 sản phẩm, lệch kết quả cuối 0 trường (kết luận của Trợ lý, nguồn biên lãi, ROAS hòa vốn, bảng hòa vốn sản phẩm, mức và điểm gợi ý).
- Gian nhiều nhóm nhất: 1.112 nhóm. Gian nhiều đơn nhất: 1.220 đơn trong 30 ngày. Lệch tiền lớn nhất trong mọi nhóm của mọi gian: 0,0424 đồng.
- Thời gian mỗi gian: đường `sql` 8 đến 150 mili giây (gồm cả câu kiểm sổ sạch), đường `rows` 9 đến 173 mili giây. Ở số đơn hiện tại hai đường nhanh ngang nhau; khác biệt là đường `sql` không còn phanh và không giữ đơn trong RAM.
- Kế hoạch chạy thật của gian 1.220 đơn (1.631 dòng hàng): chỉ đọc mảnh tháng 09/2026, lập kế hoạch 0,76 mili giây, chạy 13,0 mili giây, sắp xếp trong RAM 329 kB.

### 11.8 Ba việc làm thêm tối 30/09/2026 (anh Trung: "làm cho xong khi còn ít người dùng")

**1. Lưới đỡ khi câu gom lỗi** (`fetchChannelMargins`, commit `664fba0`)

- Nguồn theo env: câu gom trong database lỗi → lượt đó tính bằng đường `rows`, khách vẫn thấy số; một dòng log `[Ads-margin]` kèm mã gian và lỗi gốc. Gian đó đi thẳng đường `rows` trong 5 phút (mặc định tự chọn: không dội lại câu đang lỗi ở mỗi lượt mở trang, đủ ngắn để tự hồi) rồi thử lại câu gom.
- Nguồn chỉ định tường minh (công cụ đối chiếu, test): lỗi ném ra nguyên vẹn, để lưới đỡ không che mất lệch.
- Lưới đỡ sống cùng đường `rows`, gỡ ~07/10. Test: `integrations/__tests__/ads-margin-fallback-db.test.ts`.

**2. Mốc kỳ dạng hằng cho MỌI câu đọc sổ cái** (`services/order-ledger.ts`)

- `ledgerScopeSql`, mốc `byDaySince` của ba bảng bóc theo ngày, con trỏ danh sách Lãi/Lỗ, `markLedgerScope` và câu gom quảng cáo đều viết mốc qua `tsParam` / `dayParam`. Mặc định dạng hằng; env `LEDGER_SCOPE_PARAMS=text` lui về cách cũ (giữ tới ~07/10).
- Công cụ đối chiếu `services/order-ledger-params-compare.ts` + lệnh `npx tsx scripts/ledger-backfill.ts params-compare`: chạy 18 câu đọc (tổng theo nhóm 3 trục ngày, dòng tiền, tổng quan, Lãi/Lỗ tổng kết + danh sách + con trỏ, thuế đối soát + kê khai 2 cơ sở, đơn lỗ, SKU, dòng gọn quảng cáo, câu gom) ở cả hai cách cho từng chủ shop × 6 kỳ và từng gian × 2 kỳ; kết quả phải giống hệt từng trường.
- DB dev: 540 lượt so, 0 lệch. Gian thử 300.000 đơn: 132 lượt so, 0 lệch; thời gian trung bình mỗi lượt gọi (cách cũ → dạng hằng): đối soát thuế 0,62 → 0,13 giây; tổng kết Lãi/Lỗ 1,04 → 0,20; dòng tiền 0,85 → 0,19; tổng quan 0,83 → 0,16; kê khai theo ngày tạo 0,64 → 0,16; tổng theo nhóm 1,26 → 0,76; Lãi/Lỗ theo SKU 1,34 → 0,69. Ở shop nhỏ phần lợi chính là lập kế hoạch: cách cũ Postgres phải lập kế hoạch cho cả 84 mảnh tháng ở mỗi câu, dạng hằng thì chỉ mảnh của kỳ.
- Các câu theo ngày GIAO (`summary.delivered`, `freshness.delivered`) gần như không nhanh hơn: sổ chia mảnh theo ngày TẠO nên câu theo ngày giao vẫn phải mở mọi mảnh. Đây là giới hạn đã biết của cách chia mảnh, không phải lỗi.
- Test: `services/__tests__/order-ledger-scope.test.ts`, `integrations/__tests__/order-ledger-params-db.test.ts`.

**3. Xóa gian lớn** (migration `20260930270000_order_line_ledger_drop_item_fk` + `services/channel-delete.ts`)

- Bỏ khóa ngoại `order_line_ledger.orderItemId → OrderItem` (chọn bỏ thay vì thêm chỉ mục: xóa đơn vẫn dọn sổ qua khóa ngoại `orderId`; xóa riêng một dòng hàng thì trigger đánh dấu đơn và worker ghi lại dòng sổ; thêm chỉ mục thì mỗi lượt worker ghi sổ phải cập nhật thêm một chỉ mục ở mọi mảnh). Migration lấy khóa `OrderItem` trước, sổ dòng hàng sau, có thử lại — giao dịch ghi đơn của app không thể nằm trong vòng khóa chéo.
- Route `DELETE /api/channels/:id` xóa đơn theo lô 1.000 (mỗi lô một câu lệnh ngắn, nghỉ 100 mili giây), xong mới xóa dòng gian. Chờ tối đa 20 giây; gian lớn hơn thì trả 202 `pending: true`, xóa nốt ở nền, giao diện báo "đang được xóa dần". Tiến trình tắt giữa chừng thì gian vẫn ở trạng thái đã ngắt, bấm Xóa lại là chạy tiếp. Gian được nối lại giữa chừng thì dừng, không xóa gian đang hoạt động.
- Số đo DB dev, gian thử 300.000 đơn / 405.000 dòng hàng: xóa 200 đơn 12,7 giây → 0,28 giây; cả gian (286.600 đơn còn lại) xóa theo lô xong trong 201 giây, không có giao dịch nào dài quá một giây. Trước khi sửa, cùng việc đó ước khoảng 5 giờ trong MỘT giao dịch.
- Ba ngưỡng (lô 1.000, nghỉ 100 mili giây, chờ 20 giây) là mặc định em tự chọn theo số đo trên, đổi được ở đầu `services/channel-delete.ts`.
- Test: `integrations/__tests__/channel-delete-db.test.ts` (nhiều lô, gian đang hoạt động, nối lại giữa chừng, bấm hai lần, quá thời gian chờ, xóa riêng một dòng hàng sau khi bỏ khóa ngoại).
- Chưa làm: phần treo vào gian ngoài đơn (sản phẩm sàn, nhật ký đồng bộ tồn, số liệu quảng cáo) vẫn đi trong câu xóa dòng gian cuối cùng. Các bảng đó có giới hạn lưu giữ nên nhỏ hơn đơn nhiều, em chưa đo ở quy mô lớn.

### 11.9 Ba việc trên PROD 30/09/2026 khoảng 19:50–20:00 (bản `d0598f5`)

- Web + worker live 19:50; migration `20260930270000` áp xong ngay lần khởi động đầu (worker áp, web báo không còn migration chờ). Kiểm trong database prod: khóa ngoại `order_line_ledger_orderItemId_fkey` không còn, `order_line_ledger_orderId_fkey` còn nguyên. Webhook đơn Shopee tiếp tục ghi đơn bình thường sau deploy.
- `params-compare` trên Render Shell worker: **TAT CA KHOP — 2.976 lượt so (mọi chủ shop × 6 kỳ, mọi gian × 2 kỳ, 18 câu đọc), 0 lệch.** Tổng thời gian cách cũ / dạng hằng (mili giây): Lãi/Lỗ theo SKU 3.825 / 2.241; kiểm sổ sạch 1.885 / 1.268; tổng quan 1.974 / 1.402; dòng tiền 2.210 / 1.716; đối soát thuế 1.360 / 1.087; tổng theo nhóm 4.388 / 4.035. Riêng dòng gọn quảng cáo (`ledgerCompactOrders`) 2.263 / 2.753: chậm hơn khoảng 8 mili giây mỗi lượt gọi, em CHƯA tìm nguyên nhân (trên máy, kể cả gian thử 300.000 đơn, câu này lại nhanh hơn ở dạng hằng). Câu này đang phục vụ hòa vốn TikTok và đường lui `rows` của Shopee/Lazada; xem lại khi làm đợt 2 TikTok. Ở số đơn hiện tại mức lợi trên prod nhỏ hơn trên máy vì phần lớn thời gian mỗi câu là đường truyền tới Supabase.
- Trang Tổng quan của tài khoản Chủ Shop Hubsell mở bình thường sau khi bật. Log web sau deploy không có lỗi.
- Chưa kiểm được trên prod: xóa một gian thật (không có gian nào để xóa thử) và nhánh "đang được xóa dần" trên giao diện (cần gian trên khoảng 25.000 đơn). Hai phần này mới được kiểm bằng test trên DB dev và gian thử 300.000 đơn.

## 12. Đợt 2 (TikTok): đã làm tối 30/09/2026

Trạng thái: lên prod ở chế độ `rows` (commit `d37a9b0`, 22:45), so trên prod 11/11 gian TikTok khớp, rồi đổi mặc định sang `sql` (mục 12.7). Đường lui: env `TIKTOK_BREAKEVEN_SOURCE=rows` trên CẢ web và worker.

### 12.1 Bản đồ mã nguồn

Cùng khuôn với đợt 1: luật thuần ở `lib/`, câu SQL ở `services/order-ledger.ts`, phần nạp + bộ đệm + ghép ở `integrations/tiktok-ads/`.

| Tệp (dưới `backend/`) | Giữ gì |
|---|---|
| `src/lib/tiktok-breakeven.ts` | THUẦN. Luật hòa vốn TikTok chuyển nguyên văn từ `breakeven.ts` (`tiktokBreakevenBase`, `…ByGroup`, `settledCohortCutoff`, `toTiktokBreakeven`, `placedRevenue`, `salesPaceByGroup`), cửa sổ 60 ngày, khoảng tự kiểm của từng chiến dịch (`tiktokCampaignCheckOf`), bộ nhóm gửi vào câu SQL kèm dấu vân tay (`tiktokGroupMappingOf`), mặt tiền `ChannelBreakevens` với hai bản `breakevensFromRows` / `breakevensFromGroups`, kiểu dữ liệu của câu gom. Bộ nhóm dùng lại của đợt 1 (`buildAdsGroupSets`: `shop`, `c:<AdsCampaign.id>`, `p:<product id>`). |
| `src/lib/report-source.ts` | Thêm `resolveTiktokBreakevenSource` (env `TIKTOK_BREAKEVEN_SOURCE`: mặc định `sql`, `rows` = đường lui; `LEDGER_REPORTS_SOURCE=orders` thì luôn `rows`). |
| `src/services/order-ledger.ts` | `ledgerTiktokBreakevenByGroup` (một câu cho mọi nhóm: đơn đã đối soát / hủy cùng lứa / chờ kết cục, doanh thu, lãi trước quảng cáo, phí quảng cáo, doanh thu thiếu giá vốn, đà bán 30 / 7 ngày, số tự kiểm mẫu số, cờ "nhóm có dòng có giá"), `explainLedgerTiktokBreakevenByGroup`. |
| `src/integrations/tiktok-ads/breakeven-source.ts` | Nạp từ database + bộ đệm: `loadBreakevenInputs` (chiến dịch + sản phẩm sàn → bộ nhóm, khoảng tự kiểm), `loadBreakevenRows`, `loadBreakevenGroups`, `fetchChannelBreakevens` (chọn đường cộng, lưới đỡ khi câu gom lỗi). |
| `src/integrations/tiktok-ads/breakeven.ts` | Ghép số thành kết luận: `computeTiktokAdsBreakeven` (gian + từng chiến dịch kèm tự kiểm), `computeTiktokProductBreakevens` (tab Hòa vốn sản phẩm, kết luận từng dòng, nhận định Nên chạy), bộ đệm kết quả 45 giây. Ngưỡng 5 đơn và mọi câu chữ kết luận không đổi. |
| `src/integrations/tiktok-ads/breakeven-compare.ts` | Công cụ so hai đường cộng ở hai tầng (số gốc từng nhóm + tự kiểm + đà bán + danh sách sản phẩm; hai kết quả cuối). Gỡ cùng đường lui. |
| `src/lib/json-diff.ts` | So hai kết quả dạng JSON — tách từ công cụ so của đợt 1 để hai công cụ dùng chung. |
| `scripts/ledger-backfill.ts` | `ads-compare --platform TIKTOK` so thêm hai đường cộng hòa vốn; `--explain` in kế hoạch chạy thật của câu gom TikTok. |
| `scripts/bench-large-shop.ts` | Thêm `--platform TIKTOK` (đơn rải 59 ngày, bản kê thật / ước tính, phí GMV Max, số quảng cáo theo ngày). Sửa cho MỌI sàn: giá vốn = 20% giá bán và ghi đúng tỷ trọng dòng (`share`), để sổ dòng hàng của gian thử khớp phần sổ thật sẽ phân bổ — hai đường cộng so được với nhau trên gian thử. |

Test: thuần ở `src/lib/__tests__/tiktok-breakeven.test.ts` (luật cũ chuyển sang + công tắc, bộ nhóm, mặt tiền); `src/integrations/__tests__/tiktok-ads-breakeven.test.ts` còn kết luận sản phẩm + bộ đệm kết quả; trên DB dev: `tiktok-breakeven-sql-db`, `tiktok-breakeven-fallback-db`.

### 12.2 Câu gom viết thế nào (khác mục 3.4 ở cách cộng, luật không đổi)

1. **Cờ "đã đối soát THẬT" lấy ở cấp đơn**: nối sổ đơn (`isSettled`, không hủy) với bảng bản kê TikTok (không phải số ước tính). Mốc cùng lứa = ngày tạo lớn nhất trong tập này, nên đơn đã đối soát không có dòng hàng vẫn làm mốc như ở hàm thuần.
2. **Không nhân bản dòng hàng theo nhóm cho phần cộng tiền.** Một dòng hàng thuộc nhóm toàn gian, nhóm sản phẩm và các nhóm chiến dịch. Bản đầu viết theo khuôn đợt 1 (nhân bản rồi gom một tầng) phải sắp xếp 2,4 triệu dòng ở gian thử. Bản đang dùng chia ba phần:
   - tiền, số lượng và số đơn của các đơn chỉ có MỘT dòng có giá (tỷ trọng dòng `share = 1`) cộng dồn được qua SKU → cộng trước theo SKU (vài nghìn dòng) rồi mới nối với bộ nhóm;
   - đơn có từ hai dòng có giá: hai dòng có thể rơi vào cùng một nhóm, nên đếm mã đơn phân biệt theo nhóm, nhưng chỉ trên các dòng của những đơn đó và chỉ mang theo mã đơn;
   - tự kiểm mẫu số có ngày đầu riêng từng chiến dịch → cộng riêng, ngày đầu gửi kèm bộ nhóm như mảng song song thứ ba.
3. **Giả định duy nhất thêm vào:** `share = 1` nghĩa là "dòng có giá duy nhất của đơn". Sổ làm tròn `share` tới 10 số lẻ, nên điều này chỉ sai khi một đơn có hai dòng có giá chênh nhau trên 20 tỷ lần (đơn trên 20 tỷ đồng kèm một dòng 1 đồng).
4. Đà bán và cờ "sản phẩm có dòng có giá" (danh sách của tab Hòa vốn sản phẩm) đi chung câu gom. Mốc thời gian viết dạng hằng như đợt 1.

Hai bản của câu gom cho kết quả giống nhau từng byte ở cả 2.101 nhóm của gian thử 600.000 đơn.

### 12.3 Bộ đệm và lưới đỡ

- **Kết quả gom nhớ 30 phút theo gian** (anh Trung chốt 30/09/2026 tối; cùng env `ADS_PNL_CACHE_MIN` với Shopee/Lazada), kèm dấu vân tay bộ nhóm + khoảng tự kiểm; nhập giá vốn xóa đệm ngay. Lý do: câu gom ở shop lớn mất cỡ giây (mục 12.4), chạy lại mỗi 45 giây khi khách mở trang là quá dày; mức 45 giây cũ đặt ra để giá vốn vừa nhập hiện ngay, việc đó nay do lệnh xóa đệm lo. Hệ quả: ở đường `sql`, đơn / bản kê mới về vào hòa vốn chậm tối đa 30 phút.
- Bộ đệm KẾT QUẢ 45 giây (`memoizeByChannel`) giữ nguyên: chiến dịch và số quảng cáo theo ngày vẫn đọc lại mỗi 45 giây. Đường `rows` không đổi gì.
- Hòa vốn chiến dịch và tab Hòa vốn sản phẩm dùng chung một lượt gom.
- **Lưới đỡ** như đợt 1: nguồn theo env mà câu gom lỗi → lượt đó tính bằng `rows`, log `[Tiktok-breakeven]` kèm mã gian, gian đó nghỉ câu gom 5 phút rồi tự thử lại. Nguồn chỉ định tường minh thì lỗi ném ra nguyên vẹn.

### 12.4 Số đo (DB dev trên máy, Postgres 17, chưa đo trên Supabase)

Gian thử TikTok: 600.000 đơn, 810.000 dòng hàng trong 59 ngày (tương đương shop 300.000 đơn mỗi tháng), 2.000 sản phẩm × 3 phân loại, 100 chiến dịch × 20 sản phẩm (12.000 cặp ánh xạ, 2.101 nhóm), khoảng 435.000 đơn đã đối soát thật.

| Cách cộng | Thời gian một lượt | Ghi tệp tạm |
|---|---|---|
| Bản đầu: nhân bản dòng theo nhóm rồi gom một tầng (khuôn đợt 1) | 7,7 – 8,2 giây | 618 MB |
| **Bản đang dùng (mục 12.2)** | **5,2 – 5,5 giây** | 362 MB |
| Đường `rows` có phanh 8.000 đơn | 0,3 – 0,4 giây | — |
| Đường `rows` nếu bỏ phanh | 12,4 giây, RAM Node 1,56 GB | — |

- Đường `rows` ở gian này nhanh nhưng SAI: 8.000 đơn mới nhất chưa đầy một ngày bán, chưa đơn nào đối soát, nên không ra được hòa vốn. Đây chính là lỗ hổng mà đợt 2 đóng.
- Phần thời gian của bản đang dùng (theo kế hoạch chạy thật): tìm đơn đã đối soát thật khoảng 1 giây; đọc dòng hàng + gắn kết cục đơn 1,7 giây; cộng theo SKU 0,9 giây; đếm đơn nhiều dòng 1,5 giây; tự kiểm 0,6 giây.
- Gian thử 6.000 đơn / 221 nhóm: đường `sql` khoảng 90 mili giây, đường `rows` khoảng 200 mili giây (gồm cả câu kiểm sổ sạch).
- Muốn nhanh hơn nữa ở shop rất lớn: bảng cộng sẵn theo ngày × SKU (giai đoạn 4), như đã ghi ở mục 7.

### 12.5 Kiểm thử

- `tiktok-breakeven-sql-db` dựng một gian TikTok 30 đơn trên DB dev, mỗi đơn một ca của luật: bản kê thật, bản kê ước tính, cờ đối soát không có bản kê, bản kê thật nhưng cờ chưa bật, đơn đã đối soát không có dòng hàng làm mốc cùng lứa, đơn hủy trước / đúng / sau mốc, đơn hủy mang bản kê thật, thiếu giá vốn, quà giá 0 (riêng và kèm hàng), đơn hai dòng cùng sản phẩm ở cả ba kết cục, phần phân bổ bị làm tròn, đơn ngoài cửa sổ / ngoài 30 ngày / ngoài 7 ngày, đơn tạo đúng ngày đầu và ngày cuối của khoảng tự kiểm. Số kỳ vọng suy từ cách dựng; ngoài ra hai đường cộng phải bằng nhau ở mọi nhóm và ở hai kết quả cuối.
- `tiktok-breakeven-fallback-db`: lưới đỡ, nghỉ 5 phút, hai phép tính chung một lượt gom, đệm 30 phút, nhập giá vốn xóa đệm, nguồn tường minh không đỡ.
- **Thử đột biến 53 chỗ trong câu gom** (bỏ từng điều kiện, đổi dấu, lệch mốc, đếm dòng thay vì đếm đơn, bỏ từng phần ghép…): cả 53 lần bộ test đều đỏ. Các lượt đầu lọt 6 chỗ, em đã thêm đơn mẫu cho đủ.
- **Đường `rows` không đổi:** chạy bản `breakeven.ts` trước khi sửa và bản mới ở chế độ `rows` trên gian thử 6.000 đơn với cùng một mốc thời gian — kết quả hòa vốn chiến dịch (6 kB) và tab sản phẩm (132 kB) giống nhau từng byte.
- Gian thử 6.000 đơn và 3.000 đơn: hai đường cộng khớp, 0 lệch ở số gốc, tự kiểm, đà bán, kết quả cuối.
- Cả bộ 919 test qua (100 tệp), `tsc --noEmit` sạch.

### 12.6 Việc làm thêm / phát hiện bên lề

- **Lỗi hiệu năng của sổ cái, ảnh hưởng prod — đã sửa bằng migration `20260930280000_order_ledger_mark_collation`.** Khi dựng gian thử TikTok, bước chèn 480.000 bản kê chạy hơn 20 phút chưa xong. Nguyên nhân: trigger của hai bảng bản kê (Lazada, TikTok) gọi hàm đánh dấu sổ `order_ledger_mark` với lý do ghép từ `TG_TABLE_NAME`. Biến đó có kiểu `name`, mang luật so chuỗi "C"; PL/pgSQL áp luật của lời gọi cho mọi tham số chuỗi, nên câu tra bảng `Order` theo mã đơn bên trong hàm không dùng được chỉ mục khóa chính và **dò cả bảng `Order` cho mỗi dòng bản kê được ghi, sửa hoặc xóa**. Đo trên DB dev khi `Order` có 600.000 dòng: 55 mili giây mỗi dòng bản kê; sau khi sửa 0,4 đến 0,5 mili giây. Chi phí tăng theo tổng số đơn của mọi shop, nên trên prod hôm nay (khoảng 42.000 đơn) mỗi dòng bản kê tốn ít hơn nhiều nhưng vẫn là một lượt dò cả bảng — em CHƯA đo trên prod. Các trigger khác (đơn, dòng hàng, sổ kho, giá vốn) truyền lý do kiểu text nên không dính. Cách sửa: trong hàm, mã đơn đi qua một biến khai báo luật so chuỗi mặc định; migration chỉ `CREATE OR REPLACE FUNCTION`, không khóa bảng. Test: `integrations/__tests__/order-ledger-mark-db.test.ts` (đỏ với hàm cũ, xanh với hàm mới).
- Sửa `bench-large-shop.ts` (mục 12.1); script tắt trigger bản kê trong giao dịch dựng rồi bật lại vì câu UPDATE cuối ghi đè cả sổ đơn (dựng 600.000 đơn TikTok mất 11 phút).
- Ghi chú ở mục 11.9 về `ledgerCompactOrders` chậm hơn ~8 mili giây mỗi lượt trên prod: khi TikTok chuyển sang `sql`, câu đó chỉ còn phục vụ hai đường lui và sẽ gỡ cùng chúng, nên em không điều tra thêm.
- Còn để ngỏ: phần tìm đơn đã đối soát thật đọc sổ ĐƠN (dòng rộng) chỉ để lấy mã đơn + ngày tạo, chiếm khoảng 1 trong 5,3 giây ở gian thử. Bỏ được nếu chấp nhận "đơn không có dòng hàng không làm mốc cùng lứa" — là đổi luật ở một ca dữ liệu hỏng, nên em giữ nguyên luật.

### 12.7 Kết quả so trên PROD 30/09/2026 khoảng 22:50 (bản `d37a9b0`, Render Shell worker) và việc còn lại

- **TAT CA KHOP (11 gian TikTok).** Ở cả 11 gian: lệch số gốc 0 nhóm, lệch tự kiểm 0 chiến dịch, lệch đà bán 0 sản phẩm, lệch kết quả cuối 0 trường (hòa vốn gian + từng chiến dịch, tab Hòa vốn sản phẩm). Dòng gọn đọc từ sổ cũng khớp dòng dựng từ đơn gốc ở cả 11 gian.
- Gian nhiều đơn nhất: 3.223 đơn trong 60 ngày (132 nhóm); gian nhiều nhóm nhất: 504 nhóm (1.033 đơn). Lệch tiền lớn nhất trong mọi nhóm của mọi gian: 0,0124 đồng.
- Thời gian mỗi gian (gồm cả câu kiểm sổ sạch): đường `sql` 12 đến 208 mili giây, đường `rows` 13 đến 213 mili giây. Gian 3.223 đơn: `sql` 92, `rows` 213. Gian 504 nhóm: `sql` 208, `rows` 179.
- Kế hoạch chạy thật của gian 1.988 đơn (2.000 dòng hàng, 1.472 đơn đã đối soát thật): chỉ đọc mảnh tháng 08 và 09/2026, lập kế hoạch 5,7 mili giây, chạy 27,3 mili giây.
- Không gian nào chạm phanh 8.000 đơn của đường `rows`.

Việc còn lại:

1. ✅ Push ở chế độ `rows` (`d37a9b0`, worker live 22:45).
2. ✅ So trên prod (kết quả ở trên).
3. ✅ Đổi mặc định của `resolveTiktokBreakevenSource` sang `sql`. `TIKTOK_BREAKEVEN_SOURCE=rows` (trên CẢ web và worker) là đường lui, gỡ cùng đợt ~07/10: `loadBreakevenRows`, `breakevensFromRows`, lưới đỡ, `breakeven-compare.ts`, phần TikTok của lệnh `ads-compare`, `TIKTOK_BREAKEVEN_MAX_ORDERS` (GIỮ các hàm thuần làm chuẩn đối chiếu trong test).
4. ⏳ Theo dõi một tuần: log `[Tiktok-breakeven]` của web/worker, CPU database ở trang Supabase.

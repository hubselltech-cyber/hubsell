# Phương án: gom biên lãi / hòa vốn quảng cáo TRONG DATABASE

Trạng thái: **ANH TRUNG ĐÃ DUYỆT 30/09/2026 chiều**; tối 30/09 anh đổi điểm 1 ở mục 9: **tách TikTok thành đợt riêng**, Shopee + Lazada làm chung đợt 1. Ba điểm còn lại giữ theo đề xuất.
**Đợt 1 (Shopee + Lazada): code + test xong tối 30/09, mặc định vẫn là đường cũ `rows`** — chi tiết, số đo và việc còn lại ở mục 11. Đợt 2 (TikTok): chưa làm, chờ anh gọi.
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

### 11.1 Những gì có trong code

- `services/order-ledger.ts`
  - `ledgerMarginByGroup`: MỘT câu SQL trả về cho mọi nhóm của gian (toàn gian, từng chiến dịch, từng sản phẩm) số đơn có giá vốn, doanh thu, lợi nhuận, số đơn và doanh thu thiếu giá vốn, lượng bán 30 ngày / 7 ngày, lượng bán mà dòng hàng chưa có giá vốn. Không phanh số đơn; RAM chỉ nhận một dòng cho mỗi nhóm.
  - `explainLedgerMarginByGroup`: in kế hoạch chạy thật của câu gom.
  - `timestampConst` / `dateConst` và tùy chọn `constParams` của `ledgerScopeSql` (mục 11.2 điểm 2). Tùy chọn mặc định TẮT: mọi báo cáo khác nhận đúng câu SQL cũ (đã so từng ký tự với bản trước khi sửa, có test khóa lại).
- `integrations/shopee/ads-insights.ts`
  - Công tắc `ADS_MARGIN_SOURCE` (`rows` | `sql`). **Mặc định `rows`.** Khi `LEDGER_REPORTS_SOURCE=orders` thì luôn `rows`.
  - Bộ nhóm của gian (`groupSkusByItemId`, `buildAdsGroupSets`, `adsGroupMappingOf`): mỗi sản phẩm sàn một nhóm `p:<item_id>`, mỗi chiến dịch một nhóm `c:<id>`, nhóm toàn gian `shop`.
  - Mặt tiền `ChannelMargins` với hai bản: `marginsFromRows` (duyệt mảng đơn, dùng lại nguyên `marginOverRows`) và `marginsFromGroups` (tra kết quả đã gom). Ba nơi dùng (`computeChannelAdsInsights`, `computeChannelProductBreakeven`, `computeChannelAdsRecommendations`) gọi qua mặt tiền; phần phía sau (`marginOf`, ngưỡng 5 đơn, độ phủ 90%, bộ luật đánh giá chiến dịch, bộ chấm gợi ý) không đổi một dòng.
  - Bộ đệm đường `sql`: nhớ KẾT QUẢ gom theo gian, cùng thời hạn 30 phút và cùng lệnh xóa khi nhập giá vốn. Ba nơi dùng dựng cùng một bộ nhóm nên dùng chung một lượt gom. Bộ nhóm đổi (thêm sản phẩm, chiến dịch đổi danh sách sản phẩm) thì gom lại ngay.
- `integrations/shopee/ads-margin-compare.ts` + lệnh `scripts/ledger-backfill.ts ads-compare`: so hai đường cho từng gian ở hai tầng. Tầng số gốc: từng nhóm, số đơn bằng tuyệt đối, tiền lệch không quá 1 đồng, độ phủ bằng nhau, nhịp bán bằng tuyệt đối. Tầng kết quả cuối: chạy ba phép tính khách nhìn thấy ở cả hai đường rồi so từng trường (kết luận của Trợ lý, nguồn biên lãi, ROAS hòa vốn, bảng hòa vốn sản phẩm, mức và điểm gợi ý).

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

- `integrations/shopee/ads-insights-margin.test.ts`: công tắc, bộ nhóm, dấu vân tay, hai bản của mặt tiền, nhịp bán.
- `integrations/__tests__/ads-margin-sql-db.test.ts` trên DB dev:
  - dữ liệu thật của mọi gian Shopee/Lazada: bộ nhóm thật + nhóm thử (từng SKU, ba SKU gộp, mọi SKU phải bằng nhóm toàn gian), hai tầng so đều 0 lệch, lệch tiền lớn nhất dưới 0,1 đồng;
  - bộ đơn tự dựng cho ca dữ liệu dev không có: đơn chỉ có quà giá 0, quà trong đơn có hàng, đơn hủy, đơn thiếu giá vốn (có quà, có hai dòng cùng SKU), đơn ngoài cửa sổ, đơn ngoài 7 ngày, phần phân bổ bị làm tròn; số kỳ vọng suy từ cách dựng.
- `services/__tests__/order-ledger-scope.test.ts`: `ledgerScopeSql` mặc định giữ nguyên câu chữ; mốc dạng hằng bằng mốc dạng chuỗi trên database thật.
- Thử đột biến: sửa tạm 16 chỗ trong câu gom (bỏ lọc đơn hủy, bỏ lọc đã đối soát, đếm dòng thay vì đếm đơn, tính cả dòng quà, lệch mốc 7 ngày, lệch mốc ngày…), cả 16 lần bộ test đều đỏ.
- Cả bộ 891 test qua, `tsc --noEmit` sạch.

### 11.5 Việc còn lại của đợt 1

1. Push ở chế độ `rows` (khách chưa thấy gì đổi).
2. Trên Render Shell của worker: `npx tsx scripts/ledger-backfill.ts ads-compare --platform SHOPEE` rồi `--platform LAZADA`. Mỗi gian in thêm `GOM khop|LECH`, số nhóm, lệch tiền lớn nhất, thời gian hai đường. Phải `TAT CA KHOP`.
3. Khớp thì đổi mặc định sang `sql` trong code, giữ `ADS_MARGIN_SOURCE=rows` làm đường lui một tuần.
4. Anh chốt mục 5 điểm 5 (câu SQL lỗi thì lượt đó tự lui về đường `rows` + ghi log): chưa làm vì chưa có ý anh.

### 11.6 Hai phát hiện ngoài phạm vi, CHƯA sửa, cần anh quyết

1. **Mọi báo cáo trên sổ cái đang đổi kiểu mốc thời gian ở từng dòng quét** (cùng nguyên nhân với mục 11.2 điểm 2, vì dùng chung `ledgerScopeSql`). Ở số đơn hiện tại không ai thấy; ở kỳ có vài trăm nghìn dòng thì mỗi báo cáo mất thêm cỡ giây. Cách sửa đã có sẵn (bật `constParams`), nhưng đụng tới mọi báo cáo đã so khớp prod nên phải làm thành một việc riêng và so lại prod.
2. **Xóa gian lớn sẽ rất chậm.** Khóa ngoại `order_line_ledger.orderItemId` không có chỉ mục bắt đầu bằng cột đó, nên mỗi dòng hàng bị xóa kéo theo một lượt dò cả sổ dòng hàng. Đo trên DB dev khi mảnh tháng có 410.000 dòng: 59 mili giây mỗi lượt dò, có chỉ mục thì 0,4 mili giây; xóa gian thử 300.000 đơn chạy hơn 12 phút chưa xong, thêm chỉ mục tạm thì xong trong 247 giây. Ảnh hưởng tới nút Xóa gian (27/09) kể từ khi có sổ cái. Hai cách sửa: thêm chỉ mục, hoặc bỏ khóa ngoại đó (khóa ngoại theo `orderId` đã lo việc xóa theo đơn). Cần migration nên em trình riêng.

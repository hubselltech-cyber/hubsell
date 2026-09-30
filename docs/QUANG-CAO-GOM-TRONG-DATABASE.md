# Phương án: gom biên lãi / hòa vốn quảng cáo TRONG DATABASE

Trạng thái: **CHỜ ANH TRUNG CHỐT** (trình 30/09/2026 chiều, dự kiến làm tối 30/09).
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

1. Thêm công tắc env `ADS_MARGIN_SOURCE`: `rows` (đường hiện tại) hoặc `sql`. **Tối nay lên prod ở `rows`**, tức là chưa đổi gì với khách.
2. Mở rộng lệnh `scripts/ledger-backfill.ts ads-compare` thêm chế độ so kết quả CUỐI giữa hai đường cho từng gian: biên lãi gian, từng chiến dịch, từng sản phẩm; hòa vốn TikTok gian, từng chiến dịch kèm số tự kiểm, từng sản phẩm; nhịp bán. Chạy trên Render Shell cho cả 30 gian.
3. Khớp hết thì đổi mặc định sang `sql` trong code, giữ `ADS_MARGIN_SOURCE=rows` làm đường lui một tuần, gỡ cùng đợt 07/10.
4. Bộ nhớ đệm giữ nguyên: Shopee/Lazada 30 phút theo gian (đổi từ "nhớ mảng dòng" sang "nhớ kết quả gom"), TikTok 45 giây theo gian. Nhập giá vốn vẫn xóa đệm của gian đó như hiện nay.

## 6. Kiểm thử

- Test thuần hiện có giữ nguyên, không sửa.
- Test tích hợp mới trên DB dev: với mọi gian Shopee/Lazada, kết quả SQL theo từng nhóm bằng hàm thuần chạy trên dòng gọn (số đơn bằng tuyệt đối, tiền lệch không quá 1 đồng).
- TikTok: DB dev không có đơn TikTok. Test tích hợp tự tạo một bộ đơn TikTok mẫu có bản kê thật, bản kê ước tính, đơn hủy trước và sau mốc cùng lứa, đơn thiếu giá vốn, đơn nhiều SKU; so SQL với hàm thuần. Sau đó so trên prod bằng lệnh ở mục 5.
- Kiểm kế hoạch truy vấn: câu gom phải đi bằng chỉ mục `(channelId, createdDate)` của sổ dòng hàng.

## 7. Tải

- Mỗi lần tính quét các dòng hàng của MỘT gian trong cửa sổ 30 hoặc 60 ngày, qua chỉ mục `order_line_ledger (channelId, createdDate)` đã có. Không cần migration mới.
- Shop 300.000 đơn mỗi tháng ở một gian: khoảng 0,5 đến 1 triệu dòng mỗi lượt quét. Con số này là ước lượng, em chưa đo; nhờ bộ nhớ đệm, mỗi gian quét nhiều nhất 2 lần mỗi giờ cho Shopee/Lazada.
- Nếu đo thấy nặng ở shop lớn: bước sau là bảng cộng sẵn theo ngày × SKU (thuộc giai đoạn 4 "bảng tổng hợp theo ngày"). Không làm trong việc này.

## 8. Không làm trong việc này

- Ba việc đang treo của nhóm quảng cáo (lệch ngày 00:00–07:00 của `toShopeeDate`, bảng điểm 90 ngày chỉ nạp 30 ngày chi tiêu, trần 5 lệnh dừng mỗi ngày và thứ tự lệnh). Chúng đổi HÀNH VI của Trợ lý nên phải trình riêng từng việc.
- Đổi ngưỡng, đổi cửa sổ 30/60 ngày, bật live.

## 9. Bốn điểm cần anh chốt

| # | Câu hỏi | Em đề xuất |
|---|---|---|
| 1 | Làm cả ba sàn trong một đợt hay tách? | Một đợt. Hai câu SQL gần như cùng khuôn, tách ra thì phải so prod hai lần. |
| 2 | Lên prod ở chế độ tắt rồi so xong mới bật, hay bật ngay? | Tắt trước, so 30 gian khớp mới bật. Đây là đầu vào của quyết định dừng và bật chiến dịch. |
| 3 | Có gộp ba việc đang treo của nhóm quảng cáo vào tối nay không? | Không gộp. Gộp thì không còn phân biệt được số đổi do đâu. |
| 4 | Chấp nhận lệch dưới 1 đồng do làm tròn ở tổng theo nhóm? | Chấp nhận. Số đơn vẫn bằng tuyệt đối, biên lãi và ROAS hòa vốn hiển thị không đổi. |

## 10. Trình tự làm tối nay

1. `ledgerMarginByGroup` + nhịp bán Shopee/Lazada; test DB dev so với hàm thuần.
2. `ledgerTiktokBreakevenByGroup` + tự kiểm theo chiến dịch + nhịp bán; test DB dev bằng bộ đơn TikTok mẫu.
3. Nối vào `computeChannelAdsInsights`, `computeChannelProductBreakeven`, `computeChannelAdsRecommendations`, `computeTiktokAdsBreakeven`, `computeTiktokProductBreakevens` sau công tắc `ADS_MARGIN_SOURCE`.
4. Mở rộng `ads-compare`, chạy cả bộ test, push ở chế độ `rows`.
5. So trên prod 30 gian. Khớp thì commit đổi mặc định sang `sql`, push, kiểm lại trang Quảng cáo Shopee và TikTok của tài khoản demo.

Ước lượng: 3 đến 4 giờ, phần lớn nằm ở bước 2 và bước 5.

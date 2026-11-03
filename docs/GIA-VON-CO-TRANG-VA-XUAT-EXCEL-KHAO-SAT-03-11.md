# Trang Giá vốn: nâng cỡ trang lên 300/500 hay xuất Excel theo cả bộ lọc (khảo sát 03/11/2026)

Anh hỏi có nên nâng trang Giá vốn từ 50 lên 300 hoặc 500 sản phẩm để khách tải về điền giá. Chưa sửa gì.

## Kết luận

Không nên nâng lên 500. Việc khách cần là một file đủ mã, nên sửa nút Xuất Excel để xuất cả bộ lọc đang chọn, giữ trang xem ở mức nhỏ.

## Vì sao khách đòi trang lớn

- Gian vượt `catalogRowLimit()` (mặc định 5.000 dòng) chia trang ở máy chủ, nên `handleExport` trong `frontend/src/app/finance/cost-prices/page.tsx` chỉ xuất trang đang xem. Toast cũng nói "của trang đang xem".
- Gian dưới trần tải hết về trình duyệt, nút Xuất đã xuất cả bộ lọc. Cỡ trang không liên quan tới file của họ.
- Prod có 10 chủ shop vượt 5.000 dòng.
- Khách nhập file 4.313 dòng lúc 19:32 trong khi một trang 50 sản phẩm nhiều nhất 1.325 dòng. Suy luận: khách đang ghép nhiều file lại. Chưa hỏi khách.
- Log cho thấy khách tìm theo họ mã, ví dụ `tldc` ra 537–570 dòng. Hiện tìm xong xuất cũng chỉ được một trang.

## Số thật của khách (dòng đang bán, đo prod chỉ đọc)

Cả gian: 4.191 sản phẩm, 52.830 dòng, sản phẩm nhiều nhất 90 dòng. Nhóm chưa có giá: 1.166 sản phẩm, 13.155 dòng.

| Sản phẩm/trang | Số trang, nhóm chưa có giá | Dòng nhiều nhất, chưa có giá | Dòng nhiều nhất, tất cả |
|---|---|---|---|
| 50 | 24 | 813 | 1.325 |
| 100 | 12 | 1.382 | 1.945 |
| 300 | 4 | 3.780 | 4.843 |
| 500 | 3 | 6.247 | 7.997 |

## Đo tải

Máy chủ: DB dev, cờ heap như prod, tên và ảnh dài như khách, chỉ đo bước đọc dòng và dựng phản hồi. Trình duyệt: bản dev của Next với dữ liệu giả 12 dòng/sản phẩm, bản build thật sẽ nhanh hơn, nên chỉ so tương đối giữa các cỡ.

| Sản phẩm/trang | Phản hồi trang đông nhất | RAM web tăng, 1 người | RAM web tăng, 2 người | Vẽ trang | Gõ 1 phím giá |
|---|---|---|---|---|---|
| 50 | 882 KB | 6 MB | chưa đo | 499 ms | 142 ms |
| 100 | 1.297 KB | 8 MB | chưa đo | 657 ms | 209 ms |
| 300 | 3.235 KB | 21 MB | 46 MB | 951 ms | 662 ms |
| 500 | 5.345 KB | 34 MB | 68 MB | 1.805 ms | 994 ms |

Thời gian thật trên prod lấy từ log `[sku-products]`: 730 dòng 0,45–1,2 giây, 1.193 dòng 3 giây. Thời gian prod ở 300 và 500 chưa đo được vì route đang giới hạn 100.

## Điều làm trang lớn tệ hơn con số

- Mỗi lần lưu một giá, trang gọi `load()` đọc lại cả trang. Ở 500 sản phẩm là tới 5 MB cho mỗi ô.
- Mỗi phím gõ đổi state `drafts` ở cấp trang nên cả bảng vẽ lại. Gõ giá trực tiếp sẽ giật, đúng việc khách từng yêu cầu ("hiện ra và điền").
- RSS web prod thường 230–330 MB, `heavyRouteGuard` từ chối từ 400 MB. 2 người xem trang 500 sản phẩm có thể chạm ngưỡng và nhận "máy chủ bận".
- Trang lớn tải chậm hơn trang nhỏ, không nhanh hơn.

## Các hướng

| Hướng | Khách được gì | Chi phí, rủi ro |
|---|---|---|
| A. Xuất Excel theo cả bộ lọc (đề nghị) | Một nút ra đủ 13.155 dòng chưa có giá, hoặc đủ họ mã vừa tìm | Một lát: route đọc gọn theo lô, trình duyệt ghép file. Tất cả 52.830 dòng cần đo khi làm |
| B. Thêm lựa chọn 100 | Bớt một nửa số trang | Rất nhỏ, route đã cho 100. Vẫn phải ghép 12 file |
| C. Nâng 300 | 4 file | Cần sửa cả lưu một ô không tải lại trang và gõ không vẽ lại cả bảng, nếu không gõ giá giật khoảng 0,7 giây trên bản dev |
| D. Nâng 500 | 3 file | Như C, thêm rủi ro chạm ngưỡng máy chủ bận |

A giải quyết đúng việc. B có thể đi kèm A vì gần như không tốn gì.

## Up file số lượng lớn có lỗi không (anh hỏi thêm)

Lượt thật lớn nhất: 4.313 dòng lúc 19:32, 0 lỗi, trước bản sửa câu vá nên mất 54 giây. Chưa có lượt thật nào lớn hơn, chưa có lượt thật nào sau bản `a7953626`.

Đo đúng các bước của `POST /cost-prices/import` trên DB dev, cờ heap như prod, 2.775 dòng đơn chưa có giá. Cột RSS là mức tăng đỉnh. Cỡ file "từ Excel" là file có nén, mô phỏng khách mở rồi lưu lại, không phải lưu bằng Excel thật.

| Dòng | File Hubsell xuất | File từ Excel | Tổng thời gian | Chặn cả máy chủ khi đọc file | RSS tăng | Lỗi |
|---|---|---|---|---|---|---|
| 4.313 | 2,15 MB | 0,48 MB | 1,1 giây | 0,2 giây | 83 MB | 0 |
| 13.155 | 6,59 MB | 1,46 MB | 2,1 giây | 0,6 giây | 85 MB | 0 |
| 30.000 | 15,18 MB | 3,34 MB | 5,6 giây | 1,4 giây | 168 MB | 0 |
| 52.830 | 26,83 MB | 5,89 MB | 7,4 giây | 2,6 giây | 290 MB | 0 |

Đo prod chỉ đọc, ca rộng nhất trên dữ liệu khách: câu vá theo kho toàn shop 10,3 giây, tìm 44 nghìn mã 1,1 giây. Câu vá chạy sau khi đã lưu giá nên không còn trần 120 giây. Chưa đo được câu UPDATE thật trên prod.

Rủi ro theo cỡ, với RSS web prod 230–330 MB và trần máy 512 MB:
- Đến khoảng 13.000 dòng: ổn, đỉnh tối đa khoảng 415 MB.
- 30.000 dòng: sát trần khi web đang ở mức cao, tối đa khoảng 500 MB. 2 file cùng lúc có thể làm web chết vì route nhập không có `heavyRouteGuard`.
- Trên khoảng 45.000 dòng: file từ Excel vượt 5 MB. File xuất thẳng từ Hubsell không qua Excel vượt 5 MB từ khoảng 9.800 dòng.
- Lỗi vượt 5 MB: theo đọc mã, multer đẩy lỗi ra bộ xử lý chung nên khách thấy "Lỗi máy chủ nội bộ", không phải "file quá lớn". Route `products.ts` có xử lý riêng, route này không. Chưa chạy thử.

Hướng sửa gốc: trình duyệt đọc file, chỉ gửi 4 cột Mã SKU, Giá vốn, Gian hàng, Kênh bán lên máy chủ. Máy chủ không còn phải giải nén và dựng cả file, hết phần RAM tăng và hết chặn máy chủ, trần 5 MB không còn ý nghĩa. Nên làm cùng hướng A. Không đặt trần số dòng để chặn khách.

Giá trong file vá vào dòng đơn đang 0 nên lãi đơn cũ tính lại đúng; dòng đơn đã có giá giữ nguyên theo thiết kế đóng băng giá vốn.

## Ô tìm SKU: vì sao khách báo tìm không ra (anh hỏi thêm)

Log 24 giờ của khách chỉ có một từ khóa là `tldc`, gõ 22 lần: 19 lần ra khoảng 540–710 dòng mỗi trang, 3 lần ra 0 dòng ở tab TikTok.

| Nguyên nhân | Bằng chứng | Mức |
|---|---|---|
| Gõ một phần mã ra rất nhiều trang, sắp theo sản phẩm mới về, không theo độ khớp | `tldc` khớp 1.266 sản phẩm Shopee và 694 sản phẩm TikTok đang bán, tức 40 trang 50 sản phẩm | Đúng giả thuyết của anh |
| Kết quả là dòng sản phẩm thu gọn, cột Mã SKU hiện "—", phải mở từng dòng mới thấy mã | Dựng lại trên giao diện với dữ liệu giả | Chắc |
| Bộ lọc đang chọn che mất mã, nhưng câu báo lại nói không có trong cả gian | Dựng lại: mã đã gỡ khi lọc Đang bán và mã đã có giá khi lọc Chưa có giá đều báo "Không tìm thấy mã nào khớp trong 57.877 mã SKU" | Chắc |
| 3 lượt 0 dòng ở tab TikTok | Có 8.885 dòng `tldc` đang bán ở TikTok, hiện 0 dòng chưa có giá. Khớp với việc khách đang lọc Chưa có giá, log không ghi bộ lọc nên chưa chứng minh được | Nhiều khả năng |
| Không tìm theo mã kho | Route tìm trên mã sàn, tên, phân loại, mã mẫu, mã sàn, tên kho, không có `Product.skuCode`. 2.196 dòng có mã sàn khác mã kho | Chắc về mã, chưa biết khách có gõ mã kho không |

Mã gõ đủ không bị đẩy ra trang sau: thử 60 mã ngẫu nhiên, mã đúng luôn ở trang 1, nhiều nhất khớp 3 sản phẩm. Mẫu thử nhỏ, chỉ so trên mã SKU.

Tốc độ: log prod 2,5–6 giây mỗi lượt tìm.

Đề nghị sửa, chưa làm:
1. Sắp kết quả theo độ khớp: trùng đúng mã, rồi bắt đầu bằng từ khóa, rồi chứa từ khóa.
2. Khi đang tìm, dòng sản phẩm hiện các mã khớp, hoặc tự mở khi ít dòng.
3. Bộ lọc che kết quả thì nói rõ "có N mã ở Đã gỡ hoặc Đã có giá" kèm nút xem, không báo không tìm thấy. Ở tab sàn khác cũng vậy.
4. Tìm thêm theo mã kho.

### Đã làm 03/11 ~20:45 (anh chốt "Sửa cả 4 điểm")

1. Xếp theo độ khớp: trùng đúng mã, bắt đầu bằng, chứa, rồi tên. Cùng độ khớp xếp theo mã. `searchRank` trong `backend/src/lib/sku-catalog-page.ts`, gian dưới trần dùng `frontend/src/lib/sku-search.ts`.
2. Dòng sản phẩm hiện tối đa 3 mã khớp kèm "+N mã". Trang có từ 30 mã trở xuống thì tự mở. Số 3 và 30 là mặc định tự chọn.
3. Ra 0 kết quả mà có bộ lọc: hỏi `GET /sku-products/search-count`, báo "Có N mã khớp nhưng đang bị ẩn bởi bộ lọc" kèm một nút bỏ lọc. Không có thật thì nói không có trong toàn bộ gian hàng.
4. Tìm theo mã kho, khớp theo mã kho thì dòng ghi thêm "Kho: mã".

Thêm hai việc để không chậm đi, đo trên prod chỉ đọc trước khi đẩy. Bản đầu mất 5,8–9,5 giây vì gập dấu thêm cột:

| Cách | Gõ `tldc` | Gõ đủ mã | Không khớp gì |
|---|---|---|---|
| Bản đầu | 5,8–8,1 giây | chưa đo | 9,5 giây |
| Bỏ qua gập dấu với giá trị không dấu | 4,7–4,9 giây | 8,0 giây | 8,5 giây |
| Từ khóa giống mã chỉ dò cột mã | không áp dụng | 0,9 giây | dò tiếp đến tên |

Từ khóa giống mã là có số, gạch nối hoặc gạch dưới, không có khoảng trắng. Có mã khớp thì không dò đến tên, nên tên chứa đúng từ khóa đó sẽ không hiện. Không mã nào khớp mới dò đến tên, tổng tối đa khoảng 9–10 giây. Từ khóa chữ thường như `tldc` vẫn dò cả tên, khoảng 5 giây.

Sửa kèm: cột Giá bán chỉ còn 8 px ở khổ 1280 và làm trang tràn ngang, lỗi có từ trước, nay cột rộng cố định.

Đã soi bằng dữ liệu giả ở 1280 và 1700, sáng và tối. Phần gập dấu dùng chung nên ô tìm tab Mapping cũng nhanh hơn với giá trị không dấu.

Tốc độ tìm theo tên vẫn chậm. Muốn nhanh hơn cần cột gập sẵn kèm index, chưa làm.

LIVE 20:15 `f77b73b4`. Kiểm prod: giao diện đã là bản mới, route tìm trả 200 cả hai đường bằng tài khoản công ty không có gian nên 0 dòng. Chưa kiểm được giao diện trên tài khoản có dữ liệu; thời gian trên dữ liệu khách là đo câu lệnh chỉ đọc. Theo dõi log `[sku-products]` lượt tìm thật, không nhờ khách thử.

## Áp giá cho tất cả mã vừa tìm (anh hỏi 03/11 ~20:25, khách demo trên ShipXanh, em chưa xem ShipXanh)

Tìm hiện tại: không sót mã khớp, nhưng chưa ra hết trên một màn. `tldc` trải 40 trang, mặc định lọc Đang bán nên 1.620 dòng đã gỡ bị ẩn mà không có lời báo khi vẫn còn kết quả khác. Chưa có lượt tìm thật nào sau bản `f77b73b4` tính tới 20:20.

Đường áp giá hiện có: "Giá vốn chung" áp cho từng sản phẩm, route `update-cost-bulk` trần 500 mã, không có đường áp cho cả kết quả tìm.

Số thật của khách với `tldc`, dòng đang bán: 19.553 dòng có giá, tất cả đúng 1 mức giá; 4.992 dòng chưa có giá. Cả gian: 4.191 sản phẩm, chỉ 2 sản phẩm có từ 2 mức giá trở lên. Nên nhu cầu áp một giá cho cả họ mã là có thật.

Đề nghị nếu làm:
- Nút áp nằm cạnh kết quả tìm, máy chủ tự tính lại danh sách theo từ khóa và bộ lọc, không tin danh sách trình duyệt gửi, không vướng trần 500.
- Mặc định chỉ điền ô trống. Ghi đè giá đang có phải tick riêng và thấy hộp số cũ, số mới. Không hoàn tác được.
- Chỉ áp cho dòng khớp theo mã, không áp dòng chỉ khớp tên, đúng nguyên tắc đã có ở `lib/cost-mapping.ts`. Hộp xác nhận hiện số mã và vài mã mẫu, vì `tldc` cũng khớp mã chứa chữ đó ở giữa.
- Đơn cũ: chỉ vá dòng đơn chưa có giá, như mọi đường ghi giá khác.
- Báo thêm một dòng khi còn mã bị bộ lọc ẩn dù đã có kết quả.

Chưa làm, chờ anh chốt.

### Đã làm 03/11 (anh chốt đặt dải dưới thanh tìm)

- Dải `frontend/src/components/finance/cost-search-apply.tsx` nằm giữa thanh tìm và bảng, chỉ hiện khi có từ khóa khớp mã. Hiện số mã khớp, số mã chưa có giá, ô giá, nút áp, tick ghi đè, và dòng báo còn mã bị bộ lọc ẩn.
- Hộp xác nhận ghi số mã, giá cũ → giá mới (5 mức nhiều dòng nhất), 5 mã mẫu, cảnh báo mã chỉ chứa từ khóa ở giữa, phạm vi bộ lọc.
- `backend/src/lib/cost-search-apply.ts`: máy chủ tự tính danh sách. Không có từ khóa thì từ chối, không chạm cả gian. Mặc định chỉ ô trống. Chỉ dòng khớp mã. `expectedRows` lệch thì 409, không ghi gì. Log `[cost-apply-search]`.
- Route: `GET /sku-products/search-summary`, `POST /cost-prices/apply-search/preview`, `POST /cost-prices/apply-search` (có `heavyRouteGuard`). Trần giao dịch ghi giá trong `saveCostPlan` nâng lại 120 giây, vì một lượt có thể tới vài chục nghìn dòng.

Đo:

| Việc | Máy dev, 57.877 dòng | Prod chỉ đọc, dữ liệu khách |
|---|---|---|
| Số trên dải | 173 ms | 2,2 giây |
| Xem trước | 191 ms | 1,1 giây |
| Ghi đè 24.545 dòng | 1,4 giây, RSS +47 MB | chưa đo, không ghi thử trên prod |

Số của khách với `tldc` lúc đo: 24.643 mã đang bán khớp, 5.004 chưa có giá, 19.639 đã có giá, thêm 1.620 mã bị lọc Đang bán ẩn. Không có mã nào chỉ chứa `tldc` ở giữa, tất cả đều bắt đầu bằng `tldc`.

Đã soi bằng dữ liệu giả ở 1280, 1366×620, 1700, sáng và tối, gồm luồng áp xong báo kết quả, tải lại bảng và số trên dải.

Chưa kiểm được: chưa có lượt áp thật nào trên prod.


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


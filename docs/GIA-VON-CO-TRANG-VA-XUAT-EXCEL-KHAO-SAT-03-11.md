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

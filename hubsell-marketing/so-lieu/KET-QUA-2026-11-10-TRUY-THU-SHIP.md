# Kết quả 10/11/2026 — bóc thẻ "Truy thu phí ship" của khách bán sữa

Nguồn: `SQL-TRUY-THU-SHIP-THEO-NGUYEN-NHAN.sql` + 2 câu phụ (cùng bảng), chạy SELECT trên Supabase prod 10/11/2026.
Tài khoản: khách anh chuyển 10/11 (email trong SQL). Một gian TikTok, là gian chính hãng của một thương hiệu sữa lớn.
⛔ Không nêu tên gian hay tên thương hiệu trong video, bài đăng hay ảnh.

## Đối chiếu với thẻ trên ảnh khách gửi
- Cả lịch sử: 1.023 đơn, 32.377.474 đ.
- Tháng 9 + tháng 10 + tháng 11 (tới 10/11) = 7.659.624 + 18.035.050 + 3.981.000 = 29.675.674 đ. Thẻ trên ảnh ghi 29.652.274 đ (lọc từ khoảng 01/09). Chênh 0,08 %, do mốc giờ của bộ lọc ngày. Coi như khớp.

## Theo nguyên nhân (cả lịch sử, luật `shipping-diff-reason.ts`)
| Nhóm | Đơn | Tiền | TB/đơn | Khoảng |
|---|---:|---:|---:|---|
| Khách hoàn hàng (ship hai chiều) | 120 | 13.019.960 | 108.500 | 17/08 – 03/11 |
| Phụ phí logistics | 248 | 11.210.700 | 45.204 | **12/10** – 07/11 |
| Vượt mức sàn trợ ship | 631 | 6.806.600 | 10.787 | 15/09 – 07/11 |
| Khách 0 đ + sàn 0 đ, shop trả trọn | 4 | 719.500 | 179.875 | |
| Hủy sau khi gửi | 11 | 440.000 | 40.000 | |
| Chưa có sao kê (ước tính) | 6 | 149.400 | 24.900 | 05/11 – 09/11 |
| Khác | 3 | 31.314 | | |

## Bối cảnh cả gian (mọi đơn TikTok)
| Tháng | Đơn | Cước thực tế | Cước TB/đơn | Đơn có phụ phí / tiền | Đơn lệch / tiền |
|---|---:|---:|---:|---|---|
| 08 | 2.500 | 209,3 tr | 106.019 | 0 | 27 / 2,70 tr |
| 09 | 4.735 | 389,2 tr | 97.306 | 0 | 234 / 7,66 tr |
| 10 | 4.729 | 362,9 tr | 91.881 | 184 / 7,12 tr | 600 / 18,04 tr |
| 11 (tới 10/11) | 2.058 | 75,6 tr | 82.796 | 68 / 2,67 tr | 162 / 3,98 tr |

- Đơn hoàn: cước chiều đi TB 96.829 đ + chiều về TB 51.441 đ. Shop lệch TB **108.500 đ mỗi đơn hoàn**.
- Phụ phí là mức cố định, gặp nhiều nhất: 27.000 (132 đơn) · 65.000 (69) · 39.000 (28) · 33.000 (12) · 15.000 (5). Trước 12/10 không có đơn nào.
  Trông như một biểu phí mới theo bậc, CHƯA biết tên. ⏳ Anh mở một đơn có phụ phí 65.000 trên Seller Center xem dòng phí tên gì.
  Nếu đó là phí theo chính sách thì nhãn "khiếu nại được" của Hubsell cho nhóm này đang sai.

## Đọc số
- 30 triệu so với khoảng 750 triệu tiền cước tháng 9 + 10 thì chỉ khoảng 3–4 %. Nhưng nó tương đương lãi của nhiều đơn và nằm rải trong khoảng 1.000 đơn, nên không ai thấy.
- Phần "đòi lại chắc chắn được" gần như bằng 0. Đừng hứa trong video.

## Câu hỏi của anh: khách đã tham gia bồi hoàn sao vẫn mất nhiều? (chạy thêm 10/11)
Cột dùng: `feeShipGuarantee` (shipping_fee_guarantee_service_fee, phí Bảo đảm phí vận chuyển) và `shipReimbursement`
(gộp sfr_reimbursement, shipping_fee_guarantee_reimbursement, failed_delivery_subsidy… — không tách được từng khóa).

| Tháng | Đơn | Đơn trả phí bảo đảm / tiền phí | Đơn được bồi / tiền bồi | Đơn hoàn: có bồi / vẫn lệch / tiền lệch | Đơn có phụ phí (trong đó là đơn hoàn) |
|---|---:|---|---|---|---|
| 08 (từ 17/08) | 2.428 | 1.977 / 3,97 tr | 108 / 7,89 tr | 28 có bồi / 26 lệch / 2,63 tr | 0 |
| 09 | 4.621 | 4.003 / 9,70 tr | 178 / 14,54 tr | 47/48 có bồi / 46 lệch / 5,07 tr | 0 |
| 10 | 4.625 | 3.956 / 9,59 tr | 177 / 13,93 tr | 47/48 có bồi / 47 lệch / 5,29 tr | 184 (1) |
| 11 (tới 10/11, chưa quyết toán đủ) | 1.960 | 830 / 2,01 tr | 13 / 0,40 tr | 1/4 có bồi / 1 lệch | 68 (0) |
| **Cộng** | | **≈ 25,3 tr phí** | **≈ 36,8 tr được bồi** | | |

Đọc số:
- Chương trình đang **có lời cho shop**: trả khoảng 25,3 triệu phí, được bồi khoảng 36,8 triệu (+11,5 triệu). Phí trung bình khoảng 2.400 đ/đơn.
- Giao thất bại / hủy sau khi gửi gần như được bù trọn: chỉ còn 11 đơn lệch, 0,44 triệu.
- 30 triệu còn lại nằm ở chỗ chương trình **không bù hoặc bù không đủ**:
  1. **Khách trả hàng sau khi nhận**: gần như đơn nào cũng có bồi, nhưng vẫn lệch trung bình 108.500 đ/đơn → bồi chỉ phủ một phần. ⏳ Anh xem một đơn trên Seller Center để biết phần nào không được bù.
  2. **Phụ phí từ 12/10** (27k/39k/65k): gần như không trùng đơn hoàn (1/252) → không liên quan bồi hoàn. Trong mã, nhóm này gồm các khóa quá cân / quá khổ / hàng nguy hiểm / bảo hiểm / vùng xa… → nhiều khả năng là quá cân/quá khổ (hàng sữa), nhưng ⏳ chưa xác nhận được khóa nào.
  3. **Vượt mức sàn trợ ship** trên đơn bình thường (631 đơn, ~11k): không thuộc phạm vi bồi hoàn.
- Tiền phí bảo đảm (25,3 tr) KHÔNG nằm trong thẻ 30 triệu (nó vào phí dịch vụ).

## Nguyên nhân theo sản phẩm (chạy thêm 10/11)
**Phụ phí từ 12/10 dồn vào MỘT sản phẩm: thùng sữa nước UHT 110 ml.**
- Từ 12/10: 1.146 đơn có thùng UHT → 231 đơn bị phụ phí (**20 %**). Sản phẩm khác: 3.181 đơn → 21 đơn (**1 %**).
- Theo số món trong đơn: 1 món 4 % · 2 món 36 % · 3 món 23 % · 4 món 83 % → càng nặng càng dính.
- Top: thùng UHT ×1 153 đơn / 5,90 tr · ×2 32 đơn / 1,07 tr · 2 dòng UHT 18 đơn / 0,79 tr.
- Hubsell không lưu cân nặng / kích thước khai báo của sản phẩm TikTok, cũng không tách được khóa phụ phí → chưa biết là quá cân hay quá khổ.
  Giả thuyết: khai báo cân/kích thước thùng UHT trên sàn thấp hơn thực tế, hoặc từ 12/10 sàn bắt đầu áp phí này. ⏳ Cân thử 1 thùng + xem khai báo trên Seller Center.

**Đơn trả hàng còn lệch: tỉ lệ thấp (0,7–0,9 %) nhưng dồn vào 2 mã sữa bột lon nhập khẩu.**
- Mã "2.1" 33 đơn / 3,42 tr · mã "3.2" 34 đơn / 2,83 tr → 67/120 đơn. Thùng UHT 24 đơn / 4,19 tr.
- Hubsell KHÔNG lưu lý do trả hàng → ⏳ xem lý do trên Seller Center cho 2 mã này (móp lon? khách đổi ý? sai mô tả?).

**Vượt mức trợ ship (631 đơn, ~11k/đơn):** chi phí cấu trúc của hàng nặng, không sửa được bằng khiếu nại → phải nằm trong giá bán / ROAS hòa vốn.

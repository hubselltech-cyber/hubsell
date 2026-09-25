# Bổ sung tên tiếng Anh + tên viết tắt vào Giấy chứng nhận ĐKDN

Soạn 25/09/2026. Lý do: GCN cấp 09/09/2026 để trống "Tên công ty viết bằng tiếng nước ngoài" và "Tên viết tắt"; D&B (D-U-N-S 32-013-1497), tài khoản Cổng DVC Bộ Công Thương và landing đều đang dùng `HUBSELL TECHNOLOGY CO., LTD.` là bản dịch. Có tên trên GCN thì Apple, Google, ngân hàng, đối tác nước ngoài không phải giải thích.

## 1. Căn cứ và kết luận

| Mục | Nội dung |
|---|---|
| Thủ tục | Đăng ký thay đổi nội dung GCN ĐKDN (tên doanh nghiệp là nội dung GCN, Điều 28 + 30 Luật DN 2020) |
| Hồ sơ (Điều 41 NĐ 168/2025) | (1) Giấy đề nghị theo **Mẫu số 12** Phụ lục I TT 68/2025/TT-BTC (bản cập nhật TT 121/2026); (2) **Quyết định của Chủ sở hữu** về việc thay đổi tên. Không cần biên bản họp, không cần nộp Điều lệ sửa đổi, không cần con dấu. |
| Tên nước ngoài | `HUBSELL TECHNOLOGY CO., LTD.` (Điều 39 Luật DN: dịch từ tên tiếng Việt, tên riêng giữ nguyên). Nếu Phòng ĐKKD yêu cầu viết đầy đủ loại hình thì đổi thành `HUBSELL TECHNOLOGY COMPANY LIMITED` và chuyển `HUBSELL TECHNOLOGY CO., LTD.` sang ô tên viết tắt. |
| Tên viết tắt | `HUBSELL` |
| Kèm cập nhật (mục B Mẫu 12) | Website `hubsell.vn`, email `support@hubsell.vn` (GCN đang ghi hubselltech@gmail.com, website trống). |
| Nơi nộp | Phòng Đăng ký kinh doanh và Tài chính doanh nghiệp – Sở Tài chính TP Hà Nội, nộp online tại dangkyquamang.dkkd.gov.vn bằng tài khoản đã dùng khi thành lập (email hieunt93.haui@gmail.com). |
| Thời hạn | 3 ngày làm việc; cấp GCN mới. Luật yêu cầu đăng ký trong 10 ngày kể từ ngày Quyết định. |
| Phí | Lệ phí ĐKDN miễn khi nộp qua mạng; phí công bố nội dung ĐKDN 100.000đ nộp online (cổng tự tính, đối chiếu khi nộp). |

## 2. File đã soạn (Downloads)

| # | File | Người ký |
|---|---|---|
| 1 | `1-Giay-de-nghi-thay-doi-ten-Mau-12-HUBSELL.pdf` (2 trang) | Nguyễn Trung Hiếu, người đại diện theo pháp luật |
| 2 | `2-Quyet-dinh-chu-so-huu-bo-sung-ten-nuoc-ngoai-HUBSELL.pdf` (2 trang, số 01/2026/QĐ-CSH) | Nguyễn Trung Hiếu, chủ sở hữu |

Ngày ký để trống "ngày ....... tháng 09 năm 2026": anh ghi tay cùng một ngày cho cả hai, ký, rồi scan PDF. Nộp online có thể ký số thay chữ ký tay nếu cổng cho phép ký lên file.

Sinh lại file: `python docs/scripts-phap-ly-make-doi-ten.py` (reportlab, font Arial + Segoe UI Symbol cho ô tick).

## 3. Các bước trên dangkyquamang.dkkd.gov.vn

1. Đăng nhập → Đăng ký doanh nghiệp → **Đăng ký thay đổi nội dung ĐKDN** → chọn doanh nghiệp theo MST 0111626360.
2. Khối "Tên doanh nghiệp": nhập tên nước ngoài và tên viết tắt như mục 1. Khối "Thông tin liên hệ": website + email mới (tùy chọn).
3. Tải lên 2 PDF đã ký. Nếu cổng bắt chọn "loại giấy tờ": file 1 = Giấy đề nghị/Thông báo thay đổi; file 2 = Quyết định của chủ sở hữu.
4. Ký xác thực hồ sơ (chữ ký số hoặc tài khoản đăng ký kinh doanh), nộp phí công bố, gửi.
5. Có kết quả: tải GCN mới (bản điện tử) → cập nhật ảnh GCN trong Downloads và file `hubsell-landing/src/lib/site.ts` không cần đổi (đã ghi CO., LTD.). Gửi GCN mới cho ngân hàng MB (thông tin doanh nghiệp) và dùng khi Apple/Google hỏi.

## 4. Sau khi có GCN mới

- Không phải sửa hồ sơ Bộ Công Thương đã đăng ký (tài khoản DVC đã dùng đúng tên CO., LTD.).
- Cập nhật GCN mới ở Cổng DVC Bộ Công Thương chỉ khi bị yêu cầu.
- D&B: không cần thông báo, tên đã khớp.

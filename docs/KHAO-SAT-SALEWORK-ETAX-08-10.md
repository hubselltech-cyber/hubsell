# Khảo sát: Salework (eTax) có phải tổ chức cung cấp dịch vụ hóa đơn điện tử như MISA không? (08/10/2026)

Anh Trung gửi ảnh màn hình Salework eTax (menu Đăng ký phát hành · Hóa đơn · Hóa đơn đầu vào · Lịch sử truyền nhận:
Tờ khai / Hóa đơn / Hóa đơn từ MTT · Chứng thư số · tab Thuế GTGT có "Giảm thuế GTGT theo NQ 204/2025/QH15") và hỏi
Salework có phải một đơn vị cung cấp hóa đơn giống MISA không.

## Kết luận

**Không.** Salework là **phần mềm quản lý bán hàng** (pháp nhân CÔNG TY CỔ PHẦN ESBT, MST 0108933234, Cầu Giấy, Hà Nội).
Về hóa đơn điện tử họ ở **cùng vai với Hubsell**: phần mềm trung gian nối vào nhà cung cấp hóa đơn đã được Cục Thuế
công nhận, hóa đơn phát hành dưới tài khoản và chữ ký số của chính shop. Khác biệt duy nhất là họ chọn đối tác
nhỏ (Vietinvoice, Mắt Bão, Hilo), Hubsell chọn MISA.

## Bằng chứng

| # | Nguồn | Nội dung |
|---|---|---|
| 1 | [salework.net — Thuế TMĐT 2026](https://salework.net/thue-thuong-mai-dien-tu-2026-lo-trinh-tuan-thu-2) | Tự mô tả: hỗ trợ "**kết nối trực tiếp với các hệ thống hóa đơn điện tử được Tổng cục Thuế cấp phép**", tự tạo hóa đơn cho đơn đủ ngưỡng. Không tự nhận là nhà cung cấp hóa đơn. Chân trang: Công ty Cổ phần ESBT, MST 0108933234. |
| 2 | [docs.salework.net — Xuất hóa đơn điện tử (Kho Vận)](https://docs.salework.net/salework-tai-lieu/salework-kho-van/xuat-hoa-don-dien-t) | Ba mục "Tích hợp tài khoản **Vietinvoice** / **Mắt Bão Invoice** / **Hilo Invoice**"; cách nối = nhập MST + mật khẩu tài khoản nhà cung cấp của shop (như Hubsell nhập tài khoản meInvoice). Tài liệu không nói gì về chữ ký số — việc ký nằm bên nhà cung cấp. |
| 3 | [MISA — 102 tổ chức cung cấp HĐĐT TCT chứng thực (01/04/2024)](https://www.meinvoice.vn/tin-tuc/22115/nha-cung-cap-phan-mem-hoa-don-dien-tu/) | Không có ESBT / Salework. |
| 4 | [FAST — 113 nhà cung cấp HĐĐT (cập nhật 27/01/2026)](https://fast.com.vn/nha-cung-cap-hoa-don-dien-tu/) | Không có ESBT / Salework. |
| 5 | [Tân Hưng Hà — 20 đơn vị giải pháp HĐĐT được TCT công nhận (07/2024)](https://tanhungha.com.vn/danh-sach-cac-don-vi-cung-cap-giai-phap-hoa-don-dien-tu-hddt-duoc-tong-cuc-thue-cong-nhan-n1513.html) | Có MISA (#3), Mắt Bão (#2), ICORP/Vietinvoice (#13); không có ESBT / Salework. |
| 6 | [EFY — tổ chức giải pháp ký hợp đồng truyền nhận qua EFY](https://ihoadon.vn/hddt/danh-sach-cac-to-chuc-giai-phap-ky-hop-dong-dich-vu-nhan-truyen-du-lieu-hoa-don-dien-tu-voi-efy-viet-nam.html) | 4 tổ chức (ASIA, idocNet, ACCONLINE, ACMAN); không có ESBT. Minh họa mô hình "tổ chức giải pháp đi qua tổ chức truyền nhận". |
| 7 | [Cục Thuế — 38 đơn vị hỗ trợ HKD (25/12/2025)](https://cafef.vn/cuc-thue-thong-bao-quan-trong-danh-sach-38-doanh-nghiep-ho-tro-phan-mem-ban-hang-hoa-don-dien-tu-cho-ho-kinh-doanh-18825123111050173.chn) | Danh sách dạng ảnh, chưa đọc tên từng dòng — **chưa kiểm** có ESBT không. |

## Đọc màn hình eTax theo bằng chứng trên

- "Đăng ký phát hành", "Chứng thư số", "Lịch sử truyền nhận (Tờ khai / Hóa đơn / Hóa đơn từ MTT)" là các màn **giao diện lại**
  nghiệp vụ của nhà cung cấp hóa đơn phía sau (tờ khai ĐKSD, chứng thư của shop, kết quả truyền CQT) — giống Hubsell
  hiện trạng thái CQT kéo từ MISA. Không chứng minh Salework tự truyền dữ liệu tới Cục Thuế.
- Dòng "Hóa đơn từ Salework Kho không gửi thông tin giảm thuế cũng được áp dụng theo cài đặt này" cho thấy eTax là lớp
  cấu hình thuế **đặt trên** dữ liệu đơn của Kho Vận, rồi mới đẩy sang nhà cung cấp.
- Tab Thuế GTGT: thuế suất mặc định + giảm 20% tỷ lệ % theo NĐ 174/2025 cho hộ nộp theo tỷ lệ — Hubsell đã có thuế suất
  mặc định + bỏ qua thuế với ký hiệu hóa đơn bán hàng (mẫu 2); **chưa có ô "áp dụng giảm thuế GTGT theo NQ 204"**
  (chỉ liên quan hộ KD kê khai tỷ lệ %, tới 31/12/2026).

**Giả thuyết còn mở (cần tài khoản Salework mới kiểm được):** eTax dùng tài khoản nhà cung cấp nào phía sau — nhìn tờ
khai 01/ĐKTĐ-HĐĐT trong "Đăng ký phát hành" (mục "Tổ chức cung cấp dịch vụ HĐĐT") hoặc link tra cứu trên một tờ đã
phát hành là biết ngay. Dự đoán: Vietinvoice (đối tác chính của Kho Vận).

## Hệ quả cho Hubsell

1. Về pháp lý Hubsell và Salework **ngang vai**: đều không phải tổ chức cung cấp dịch vụ HĐĐT; hóa đơn hợp lệ nhờ nhà cung
   cấp phía sau. Hubsell dựa trên MISA (số 1 thị phần, có trong mọi danh sách) — điểm mạnh khi nói với khách.
2. Bước ký số là của shop ở cả hai bên: Salework không có phép màu "không cần ký". Đường tờ nháp + ký theo lô của
   Hubsell (lát T1 08/10) không thua kém.
3. Muốn tự thành "đơn vị cung cấp hóa đơn" (Hubtax, ý anh 01/10) thì phải xin ký hợp đồng nhận–truyền với Cục Thuế
   hoặc làm "tổ chức giải pháp" đi qua một tổ chức truyền nhận (như 4 đơn vị qua EFY): vốn ký quỹ 5 tỷ, ≥ 20 nhân sự
   CNTT, hạ tầng — không phải việc của năm nay.

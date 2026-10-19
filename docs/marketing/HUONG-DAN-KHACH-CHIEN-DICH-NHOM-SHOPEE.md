# Hướng dẫn khách: đưa "Chiến dịch Nhóm nhiều sản phẩm" của Shopee vào Trợ lý quảng cáo Hubsell

Viết 19/10/2026 (anh Trung: "hướng dẫn khách hàng theo cách của mình"). Dùng để trả lời Zalo/email, dán vào trang
Video hướng dẫn, và làm kịch bản quay 1 phút. Lý do kỹ thuật ở docs/ADS-SHOPEE-KHAI-THAC-API.md mục 15 — không cần
nói với khách, chỉ cần một câu thật: **Shopee chưa cho phần mềm nào tự thấy loại chiến dịch này, phải thêm bằng id.**

---

## Bản ngắn (gửi Zalo, ≤ 6 dòng)

> Anh/chị đang chạy **Chiến dịch Nhóm nhiều sản phẩm** (GMV Max gom nhiều SP) nên Hubsell chưa tự thấy — Shopee
> chưa mở API liệt kê loại này cho bất kỳ phần mềm nào. Hubsell có cách thêm bằng id, làm một lần 30 giây:
> 1. Trên Seller Center → Quảng cáo, bấm vào tên chiến dịch Nhóm. Nhìn thanh địa chỉ, chép dãy số sau chữ
>    `manual-mpd/` (ví dụ `…/manual-mpd/202942166?…` → chép `202942166`).
> 2. Vào Hubsell → Trợ lý quảng cáo Shopee → chọn gian → kéo xuống dưới bảng chiến dịch, bấm dòng
>    "Seller Center có Chiến dịch Nhóm nhiều sản phẩm mà bảng trên không thấy? Thêm theo id".
> 3. Dán dãy số, bấm **Thêm vào bảng**. Chiến dịch hiện ngay trong bảng với chi phí, đơn, ROAS theo ngày và từ đó
>    Hubsell tự cập nhật mỗi 30 phút.

## Bản đầy đủ (trang hướng dẫn / email)

**Vì sao chiến dịch không tự hiện?** Shopee có hai kiểu chiến dịch sản phẩm: chiến dịch **1 sản phẩm** (Tự động /
Thủ công) và **Chiến dịch Nhóm** gom tới 30 sản phẩm chung một ngân sách. Shopee mới chỉ cho phần mềm bên ngoài
đọc hiệu suất theo ngày của chiến dịch Nhóm khi biết id, chưa cho liệt kê và chưa cho đọc ngân sách / mục tiêu
ROAS / trạng thái. Hubsell đã hỏi Shopee và được xác nhận như vậy (19/10/2026). Khi Shopee mở thêm, Hubsell sẽ tự
nhận, anh/chị không phải làm lại.

**Cách thêm (một lần cho mỗi chiến dịch Nhóm):**
1. Seller Center → Kênh Marketing → Quảng cáo Shopee → bấm vào **tên** chiến dịch Nhóm.
2. Trên thanh địa chỉ trình duyệt, đường dẫn có dạng `banhang.shopee.vn/portal/marketing/pas/product/manual-mpd/202942166?…`.
   Dãy số ngay sau `manual-mpd/` là **id chiến dịch**. Chép dãy số đó (bỏ phần sau dấu `?`).
3. Hubsell → Trợ lý quảng cáo Shopee → chọn gian → cuộn xuống dưới bảng chiến dịch. Nếu gian đang có tiền ads
   "chi ngoài bảng chiến dịch", dòng vàng sẽ có sẵn link **Thêm chiến dịch Nhóm theo id**; hoặc bấm dòng thu gọn
   "Seller Center có Chiến dịch Nhóm nhiều sản phẩm mà bảng trên không thấy? Thêm theo id".
4. Dán id → **Thêm vào bảng**. Hubsell hỏi Shopee xác nhận id thuộc gian, lấy tên và 30 ngày số, rồi hiện dòng
   mới trong bảng với nhãn **Nhóm nhiều SP**.

**Sau khi thêm, Hubsell làm gì và không làm gì:**
- Có: chi phí, lượt xem, click, đơn, doanh thu, ROAS theo ngày; so với **ROAS hòa vốn toàn gian**; lãi/lỗ ước tính;
  Trợ lý cảnh báo khi lỗ hoặc vọt chi. Tự cập nhật mỗi 30 phút như chiến dịch thường.
- Không: ngân sách, mục tiêu ROAS, danh sách sản phẩm, trạng thái thật (Shopee không cho đọc) — các ô này hiện gạch
  ngang. Trợ lý **không tự tạm dừng / hạ ngân sách** chiến dịch Nhóm; muốn dừng hay đổi mục tiêu thì làm trên Seller
  Center. Muốn Trợ lý tự xử lý thì chạy chiến dịch 1 sản phẩm (Hubsell tạo được ngay trong tab Gợi ý chạy ads).
- Xóa chiến dịch trên Shopee → Hubsell tự đóng dòng ở lượt cập nhật kế tiếp. Muốn bỏ khỏi bảng sớm hơn: mở chiến
  dịch → **Bỏ theo dõi** (chỉ xóa trong Hubsell, không đụng Shopee).

**Lỗi hay gặp:**
- "Shopee không nhận id … cho gian này": chép nhầm dãy số (thường lấy phải `from=`/`to=` phía sau) hoặc id của gian
  khác. Chép lại đúng dãy sau `manual-mpd/`.
- "đã có trong bảng (loại thường)": đây là chiến dịch 1 sản phẩm, Hubsell đã tự thấy, không cần thêm.

## Kịch bản video 60 giây (quay màn hình)
0–10s: Seller Center có chiến dịch Nhóm "Đang diễn ra", Hubsell không có dòng tương ứng → "Shopee chưa cho phần mềm
tự thấy loại này, mình thêm bằng id". 10–25s: bấm tên chiến dịch, bôi đen dãy số sau `manual-mpd/`, Ctrl+C.
25–45s: Hubsell → cuộn xuống → bấm dòng "Thêm theo id" → dán → Thêm vào bảng → dòng mới hiện. 45–60s: mở dòng,
chỉ số có / gạch ngang, câu "Trợ lý chỉ cảnh báo, muốn dừng thì vào Seller Center".

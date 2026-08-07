# Nội dung ticket gửi MISA — xin mở môi trường Sandbox

> **Cách gửi:** developer.misa.vn → **Quản lý ứng dụng** → tab **Quản lý danh
> sách ticket hỗ trợ** → tạo ticket mới, dán nội dung bên dưới.
> Kênh dự phòng: hotline **19008677** hoặc email **integration@misa.com.vn**.
>
> Anh Trung là người bấm gửi (ticket đứng tên chủ tài khoản).

---

## Tiêu đề

```
[Hubsell] Xin mở môi trường Sandbox (Bước 3) và tài khoản test cho 3 sản phẩm đã duyệt
```

## Nội dung

```
Kính gửi đội ngũ hỗ trợ tích hợp MISA,

Tôi là Nguyễn Trung Hiếu, chủ tài khoản Developer của ứng dụng "Hubsell"
(Hộ Kinh Doanh Hubsell, MST 026093012010) trên developer.misa.vn.

Ứng dụng đã được duyệt 3 sản phẩm Open API:
  1. Hóa đơn điện tử (meInvoice)
  2. Hóa đơn điện tử đầu vào
  3. Chữ ký số eSign

Chúng tôi đã nhận đủ Client ID / Client Secret của cả 3 sản phẩm và đã đọc
xong tài liệu API. Tuy nhiên hiện đang vướng ở khâu kiểm thử, mong được hỗ
trợ 3 việc sau:

1. MỞ MÔI TRƯỜNG SANDBOX
   Trong mục Open API của ứng dụng, "Bước 3 — Kiểm thử & vận hành" vẫn ở
   trạng thái "Chưa thực hiện" và nút bấm hiển thị "Chưa mở khóa". Xin hỏi
   cần thực hiện thủ tục gì để mở khóa bước này?

2. TÀI KHOẢN TEST ĐỂ GỌI API
   Theo tài liệu, API lấy token yêu cầu body gồm taxcode / username / password
   của tài khoản meInvoice, và eSign cũng yêu cầu userName / password.
   Xin cho biết:
   - Đây là tài khoản meInvoice/eSign chính thức của doanh nghiệp, hay MISA
     có cấp tài khoản demo riêng cho môi trường kiểm thử?
   - Nếu có tài khoản demo, xin được cấp để chúng tôi thử nghiệm.

3. XÁC NHẬN MÔI TRƯỜNG CỦA BASE URL
   Tài liệu ghi Base URL là https://developer.misa.vn/apis/itg/meinvoice
   (và https://developer.misa.vn/apis cho hóa đơn đầu vào / eSign), nhưng
   không thấy tham số hay host riêng để phân biệt Sandbox với Production.
   Xin xác nhận giúp:
   - Nếu gọi API /invoice/publishing bằng Client ID/Secret hiện tại và tài
     khoản meInvoice thật, hóa đơn có được phát hành THẬT và gửi lên Cơ quan
     Thuế không?
   - Nếu có Base URL hoặc header riêng cho Sandbox, xin cung cấp giúp.

Lý do hỏi kỹ mục 3: hóa đơn điện tử có mã Cơ quan Thuế là chứng từ pháp lý
không thể xóa, nên chúng tôi muốn chắc chắn trước khi chạy thử nghiệm phát
hành, tránh phát sinh hóa đơn ngoài ý muốn phải làm thủ tục hủy/thay thế.

Thông tin ứng dụng để tra cứu:
  - Tên ứng dụng : Hubsell
  - Doanh nghiệp : Hộ Kinh Doanh Hubsell
  - Mã số thuế   : 026093012010
  - Email liên hệ: dev@hubsell.tech
  - Điện thoại   : 0965863292

Rất mong nhận được phản hồi từ quý đội ngũ. Xin cảm ơn!

Trân trọng,
Nguyễn Trung Hiếu
```

---

## Sau khi MISA trả lời — việc cần làm ở phía Hubsell

| MISA trả lời | Việc làm |
|---|---|
| Có Base URL Sandbox riêng | Đổi `MISA_API_BASE` / `MISA_INBOT_API_BASE` / `MISA_ESIGN_API_BASE` trong `backend/.env`, rồi mới đặt `MISA_ALLOW_PUBLISH=1` |
| Cấp tài khoản demo | Điền `MISA_USERNAME` / `MISA_PASSWORD` (và bộ `MISA_INBOT_*`, `MISA_ESIGN_*`) |
| Không có sandbox, dùng chung production | **Giữ nguyên `MISA_ALLOW_PUBLISH` để trống.** Chỉ test các API đọc; muốn thử phát hành thì xin MISA một dải ký hiệu hóa đơn dành riêng cho kiểm thử |

Chốt an toàn nằm ở `backend/src/integrations/invoice/misa-safety.ts` — mặc định
chặn mọi lệnh phát hành, có test bảo vệ trong
`src/integrations/__tests__/misa-safety.test.ts`.

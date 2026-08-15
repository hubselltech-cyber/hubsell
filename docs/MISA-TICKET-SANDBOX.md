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

---

## 📩 Vòng 1 — MISA trả lời (nhận ~15/08/2026)

Kết quả rơi vào kịch bản **"dùng chung production"** (dòng 3 của bảng trên):

1. **Mở khóa Bước 3:** MISA chưa hiểu câu hỏi, yêu cầu mô tả rõ đang nói bước
   nào / sản phẩm nào → cần trả lời lại kèm screenshot.
2. **Tài khoản sandbox meInvoice:** CÓ — MISA nói "đã cấp qua email khi duyệt
   sản phẩm". Đã kiểm Gmail hubselltech@gmail.com (cả spam/trash, 15/08):
   **KHÔNG có** — chỉ có 2 mail OTP ngày 26/07. Khả năng gửi về dev@hubsell.tech
   (email đăng ký app). MISA hứa gửi lại nếu chưa nhận.
3. **eSign:** KHÔNG BAO GIỜ có sandbox/tài khoản test (tính pháp lý) — test ký
   số phải dùng tài khoản eSign thật.
4. **⚠️ Môi trường:** KHÔNG có Base URL/header sandbox riêng. Tài khoản sandbox
   được cấp **trên môi trường production**, và nguyên văn MISA: *"khi phát hành
   hóa đơn thành công, hđ này sẽ được gửi sang CQT (kể cả gửi sandbox hay gửi
   từ MST của đơn vị)"* — tức hóa đơn test vẫn lên Cơ quan Thuế, chỉ khác là
   dưới MST của tài khoản sandbox. MISA dặn "test kỹ trước khi đổi sang MST
   chính thức".

**Hệ quả:** chốt chặn `misa-safety.ts` GIỮ NGUYÊN vĩnh viễn cho MST thật.
`MISA_ALLOW_PUBLISH=1` chỉ được bật khi `.env` đang điền credentials sandbox.

## 📤 Vòng 2 — Hubsell phản hồi (anh Trung ĐÃ GỬI 15/08/2026)

Nội dung đã gửi gồm 3 ý:

1. Mô tả lại vị trí Bước 3 "Kiểm thử & vận hành" (Open API → app Hubsell →
   sản phẩm meInvoice) + screenshot, hỏi điều kiện mở khóa.
2. Báo CHƯA nhận được email sandbox, xin gửi lại về **dev@hubsell.tech**.
3. Hỏi xác nhận: hóa đơn test từ tài khoản sandbox lên CQT dưới MST sandbox
   (không phải MST 026093012010)? Hóa đơn test có cần thủ tục hủy với CQT
   không, hay MISA tự xử lý?

**⏳ TRẠNG THÁI: ĐANG CHỜ MISA TRẢ LỜI VÒNG 2.** Khi có phản hồi:
- Nhận được credentials sandbox → điền `MISA_TAXCODE` / `MISA_USERNAME` /
  `MISA_PASSWORD` trong `backend/.env`, test luồng token → templates → paging
  trước, phát hành sau cùng (bật `MISA_ALLOW_PUBLISH=1` tạm thời khi test).
- Đồng thời anh Trung kiểm hộp thư **dev@hubsell.tech** — có thể email sandbox
  đợt đầu đang nằm ở đó.

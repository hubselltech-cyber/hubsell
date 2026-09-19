# Ticket gửi MISA — API lấy số hóa đơn còn lại (tài nguyên) của khách

> **Cách gửi:** developer.misa.vn → **Quản lý ứng dụng** → tab **Quản lý danh
> sách ticket hỗ trợ** → tạo ticket mới, dán nội dung bên dưới.
> Kênh dự phòng: hotline **19008677** hoặc email **integration@misa.com.vn**.
>
> **Trạng thái:** soạn 19/09/2026 — xem mục "Nhật ký" cuối file.
> **Trước khi hỏi đã tự kiểm:** mục lục 3 bộ tài liệu doc.meinvoice.vn (itg / api /
> webapi) không có API tài nguyên; dò cổng sandbox `/company`, `/invoice/license`,
> `/invoice/licenseinfo`, `/invoice/resource`, `/license` đều 404.

---

## Tiêu đề

```
[Hubsell] Hỏi API lấy số lượng hóa đơn còn lại (tài nguyên) của khách hàng qua cổng tích hợp meInvoice
```

## Nội dung

```
Kính gửi đội ngũ hỗ trợ tích hợp MISA,

Tôi là Nguyễn Trung Hiếu, chủ tài khoản Developer của ứng dụng "Hubsell"
(app id 019f9d4c-da7e-7234-8e3c-6b17e595f6e0) trên developer.misa.vn. Hubsell
là phần mềm quản lý bán hàng đa sàn (Shopee / Lazada / TikTok Shop); khách
hàng của chúng tôi dùng TÀI KHOẢN meInvoice CỦA CHÍNH HỌ để phát hành hóa đơn
cho đơn hàng trên sàn qua cổng https://developer.misa.vn/apis/itg/meinvoice.

Luồng phát hành (/invoice/publishing, /invoice/status, /invoice/Download,
/invoice/templates) đã chạy ổn trên sandbox. Chúng tôi xin hỏi 3 việc:

1. API LẤY SỐ HÓA ĐƠN CÒN LẠI
   Khách hàng bật "tự động phát hành" nên thường không để ý số hóa đơn đã
   mua sắp hết. Chúng tôi muốn hiển thị "còn N hóa đơn" ngay trong Hubsell và
   nhắc khách MUA THÊM trên meInvoice trước khi hết (thông tin tương đương màn
   hình Hệ thống \ Quản lý tài nguyên: đã mua / đã dùng / còn lại / hạn dùng).
   Cổng tích hợp có API nào trả thông tin này theo token của khách không?
   Chúng tôi đã tìm trong tài liệu doc.meinvoice.vn (itg, api, webapi) và trên
   portal nhưng chưa thấy.

2. NẾU CHƯA CÓ API TRÊN
   - MISA có kế hoạch bổ sung không?
   - Có cách nào khác để biết sớm (ví dụ một trường trong response của
     /invoice/publishing, hoặc thông báo/webhook khi tài nguyên dưới ngưỡng)?
   Hiện chúng tôi chỉ nhận biết được khi phát hành bị từ chối với mã
   LicenseInfo_OutOfInvoice / LicenseInfo_NotBuy / LicenseInfo_Expired — xin xác
   nhận giúp 3 mã này cũng được trả qua cổng developer.misa.vn/apis/itg/meinvoice
   (sandbox không giới hạn số nên chúng tôi chưa tái hiện được).

3. XÁC NHẬN TRA CỨU THEO RefID
   Chúng tôi thấy POST /invoice/status?inputType=2 (body là mảng RefID) trả
   đúng hóa đơn theo RefID trên sandbox, và đang dùng nó để tự nối lại hóa đơn
   khi /invoice/publishing báo InvoiceDuplicated / DuplicateInvoiceRefID (lần
   phát hành trước thành công nhưng mất kết nối lúc nhận kết quả). Xin xác nhận
   inputType=2 là cách dùng được hỗ trợ chính thức trên production.

Xin cảm ơn đội ngũ MISA.

Nguyễn Trung Hiếu — Hubsell
Email: dev@hubsell.tech · ĐT: 0965863292
```

---

## Nhật ký

- 19/09/2026 — soạn ticket (anh Trung yêu cầu gửi). ⏳ CHƯA GỬI: cổng developer.misa.vn trong Chrome đang đăng xuất, Claude không tự nhập mật khẩu — chờ anh đăng nhập (Claude điền + gửi) hoặc anh tự dán gửi.

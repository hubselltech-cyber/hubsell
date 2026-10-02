# Ticket gửi MISA — mã tham chiếu (RefID) của hóa đơn đã xóa, và các điểm cần xác nhận về phát hành lại

> **Cách gửi:** developer.misa.vn → **Quản lý ứng dụng** → tab **Quản lý danh
> sách ticket hỗ trợ** → tạo ticket mới, dán nội dung bên dưới.
> Kênh dự phòng: hotline **19008677** hoặc email **integration@misa.com.vn**.
>
> **Trạng thái:** ⏳ ĐÃ GỬI 02/10/2026, chờ MISA trả lời — xem "Nhật ký" cuối file.
> **Trước khi hỏi đã tự kiểm** (sandbox, 02/10/2026, `backend/scripts/misa-refid-probe.ts`,
> kết quả chép ở `docs/HANG-DOI-BEN.md` mục 4.6 I): RefID chưa từng gửi tra ra rỗng;
> RefID của lượt bị từ chối gửi lại được; RefID của tờ đã lập gửi lại bị
> `DuplicateInvoiceRefID`; hai lệnh cùng lúc cùng RefID chỉ lập một tờ. Câu 1 dưới
> đây KHÔNG tự thử được vì sandbox không có API xóa hóa đơn.

---

## Tiêu đề

```
[Hubsell] Hỏi về RefID của hóa đơn đã xóa bỏ và cách phát hành lại an toàn qua cổng tích hợp meInvoice
```

## Nội dung

```
Kính gửi đội ngũ hỗ trợ tích hợp MISA,

Tôi là Nguyễn Trung Hiếu, chủ tài khoản Developer của ứng dụng "Hubsell"
(app id 019f9d4c-da7e-7234-8e3c-6b17e595f6e0) trên developer.misa.vn. Khách hàng
của Hubsell dùng tài khoản meInvoice của chính họ để phát hành hóa đơn cho đơn
hàng trên sàn qua cổng https://developer.misa.vn/apis/itg/meinvoice. Chúng tôi
gửi RefID = mã đơn hàng để chống phát hành trùng.

Chúng tôi đang rà lại luồng phát hành để bảo đảm không bao giờ lập trùng hoặc
lập thiếu hóa đơn cho người bán, và xin MISA xác nhận giúp các điểm sau.

1. RefID CỦA HÓA ĐƠN ĐÃ XÓA BỎ (câu hỏi chính)
   Người bán xóa bỏ một hóa đơn trên meInvoice (hóa đơn này do Hubsell phát hành
   với RefID = mã đơn), sau đó muốn phát hành lại hóa đơn cho đúng đơn hàng đó
   từ Hubsell.
   a. Gửi /invoice/publishing với ĐÚNG RefID cũ thì MISA nhận, hay trả
      DuplicateInvoiceRefID / InvoiceDuplicated?
   b. Nếu không nhận: cách làm đúng là gì? Chúng tôi có nên dùng RefID mới (ví
      dụ thêm hậu tố) cho lần phát hành lại không?
   c. Khi tra /invoice/status?inputType=2 theo RefID của tờ đã xóa, MISA trả tờ
      đó với IsDelete=true, hay trả rỗng?
   Sandbox không có API xóa hóa đơn nên chúng tôi không tự thử được.

2. ĐỘ TRỄ CỦA TRA CỨU THEO RefID
   Trên sandbox ngày 02/10/2026, với hóa đơn ĐIỀU CHỈNH (ReferenceType=2), lệnh
   /invoice/status?inputType=2 gọi ngay sau khi /invoice/publishing trả thành
   công thì trả RỖNG; khoảng 140 ms sau gọi lại thì thấy (ví dụ hóa đơn số
   00000136 ký hiệu 1K26TYY, MST 0101243150-732). Hóa đơn bán thường thì thấy ngay.
   Xin cho biết sau khi phát hành thành công, tối đa bao lâu thì tra theo RefID
   chắc chắn thấy hóa đơn (trên production)?

3. MẤT KẾT NỐI GIỮA LÚC PHÁT HÀNH
   Khi /invoice/publishing bị đứt kết nối hoặc quá thời gian chờ, chúng tôi không
   biết hóa đơn đã được lập hay chưa. Cách chúng tôi định làm: chờ vài phút, tra
   theo RefID; không thấy thì gửi lại ĐÚNG RefID cũ. Trên sandbox, hai lệnh gửi
   cùng lúc cùng một RefID chỉ lập một tờ, lệnh kia nhận DuplicateInvoiceRefID.
   Xin xác nhận trên production MISA bảo đảm một RefID không bao giờ sinh hai hóa
   đơn còn hiệu lực, kể cả khi hai lệnh đến cùng lúc.

4. HÓA ĐƠN ĐIỀU CHỈNH TRỎ VÀO HÓA ĐƠN GỐC KHÔNG TỒN TẠI
   Trên sandbox, hóa đơn điều chỉnh với OrgInvNo không tồn tại (99999999) vẫn
   được phát hành (hóa đơn số 00000133 ký hiệu 1K26TYY, do chúng tôi thử ngày
   02/10/2026). Production có kiểm hóa đơn gốc tồn tại và còn hiệu lực không, hay
   bên tích hợp phải tự bảo đảm?

5. THỜI GIAN XỬ LÝ VÀ HẠN MỨC GỌI API
   a. /invoice/publishing trên production thường mất bao lâu và tối đa bao lâu?
      MISA khuyến nghị bên tích hợp đặt thời gian chờ (timeout) bao nhiêu giây?
   b. Mục Câu hỏi thường gặp trên developer.misa.vn có ghi MISA giới hạn số
      request theo phút / giờ tùy gói dịch vụ, nhưng chúng tôi chưa tìm thấy con
      số trong tài liệu kỹ thuật. Xin cho biết hạn mức áp cho ứng dụng Hubsell
      (theo ứng dụng hay theo mã số thuế, bao nhiêu lệnh mỗi phút / mỗi giờ) và
      mã lỗi trả về khi vượt. Chúng tôi đang phát hành lần lượt từng hóa đơn cho
      mỗi người bán và muốn giữ dưới hạn mức của MISA.

6. HỦY / XÓA HÓA ĐƠN QUA API
   Tài liệu doc.meinvoice.vn/itg có nhắc POST /cancel. Cổng
   developer.misa.vn/apis/itg/meinvoice hiện có hỗ trợ hủy hoặc xóa bỏ hóa đơn
   qua API không? Nếu có, xin đường dẫn tài liệu.

Xin cảm ơn đội ngũ MISA.

Nguyễn Trung Hiếu — Hubsell
```

---

## Vì sao hỏi (ghi cho nội bộ)

| Câu | Thiết kế Hubsell phụ thuộc thế nào |
|---|---|
| 1 | Hiện Hubsell luôn gửi RefID = mã đơn. Nếu MISA không nhận lại RefID của tờ đã xóa thì người bán xóa hóa đơn rồi xuất lại từ Hubsell sẽ bị báo trùng mãi (lỗi có sẵn, chưa ai gặp vì prod chưa có shop dùng hóa đơn). Câu trả lời quyết định luật chọn mã tham chiếu ở lát 3 của bước 5 |
| 2 | Khoảng chờ trước khi tin kết quả "không thấy" (`MISA_CAPABILITIES.findByReference.settleSeconds`, đang tự chọn 60 giây) |
| 3 | Dòng `dedupesByReference` của bảng khả năng: cho phép gửi lại khi chưa rõ kết quả |
| 4 | Dòng `validatesAdjustmentOriginal`: Hubsell có phải tự kiểm hóa đơn gốc trước khi điều chỉnh |
| 5 | Thời hạn chờ gọi nhà cung cấp (đang tự chọn 60 giây) và số shop phát hành cùng lúc (đang tự chọn 2) |
| 6 | Dòng `cancelViaApi` |

## Nhật ký

- 02/10/2026: soạn ticket theo yêu cầu của anh Trung ("phần xóa thì viết ticket gửi MISA").
- 02/10/2026 ~14:35: ĐÃ GỬI qua developer.misa.vn → Quản lý ứng dụng → Quản lý danh sách yêu cầu hỗ trợ (ứng dụng Hubsell, sản phẩm Hóa đơn điện tử). Trạng thái "Chờ xử lý", "Chưa phản hồi". ĐỪNG gửi lại; có trả lời (kể cả "không có") thì chép nguyên văn vào đây và cập nhật bảng khả năng của MISA (`MISA_CAPABILITIES`). Ticket trước (19/09) MISA trả lời sau 2 ngày.
- Tự kiểm thêm trước khi gửi: mục Câu hỏi thường gặp trên developer.misa.vn chỉ ghi "MISA áp dụng giới hạn số lượng request theo phút/giờ tùy theo gói dịch vụ", không có con số.

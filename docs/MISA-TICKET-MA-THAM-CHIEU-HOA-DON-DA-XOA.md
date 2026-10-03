# Ticket gửi MISA — mã tham chiếu (RefID) của hóa đơn đã xóa, và các điểm cần xác nhận về phát hành lại

> **Cách gửi:** developer.misa.vn → **Quản lý ứng dụng** → tab **Quản lý danh
> sách ticket hỗ trợ** → tạo ticket mới, dán nội dung bên dưới.
> Kênh dự phòng: hotline **19008677** hoặc email **integration@misa.com.vn**.
>
> **Trạng thái:** ✅ MISA ĐÃ TRẢ LỜI 02/10/2026 15:34 (Phòng Tích hợp hệ thống) — nguyên
> văn và đối chiếu từng câu ở mục "Trả lời của MISA" bên dưới; việc đã sửa theo đó
> ở `docs/HANG-DOI-BEN.md` mục 4.6 N (lát 6c). Xem "Nhật ký" cuối file.
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

## Trả lời của MISA (nguyên văn, 02/10/2026 15:34)

Thư báo từ `no-reply@misa.vn` (Zoho, thư mục Hạ tầng), ticket mã `01a0fb85-7bdd-7f94-b2d9-fad2fc905fc2`, người phản hồi "Chuyên viên hỗ trợ". Chép nguyên văn, kể cả lỗi chính tả của MISA:

```
Chào anh/chị. Cảm ơn anh/chị đã liên hệ với Phòng Tích hợp hệ thống.

Hóa đơn đã phát hành, không cho phép xóa, khi thấy hóa đơn bị sai, bắt buộc phải xử lý sai sót hóa đơn
Việc phát hành (/invoice/publishing) xong rồi ngay lập tức lấy trạng thái là không cần thiết, vì response của API phát hành đã trả về thông tin của hóa đơn rồi
Hóa đơn yêu cầu phát hành tuần tự với 1 ký hiệu hóa đơn (InvSeries), nếu anh/chị đang phát hành đồng thời, như vậy là đang làm sai quy tắc mà sản phẩm đặt ra, việc trùng gần như không xảy ra, tuy nhiên, việc xử lý đồng thời như vậy sẽ khó trace log, RefID là Key để check trùng hóa đơn, gần như sẽ không xảy ra, tuy nhiên để tránh rủi ro xảy ra, anh/chị thực hiện xử lý request tuần tự, mỗi request nên cách nhau 1-3s
Hóa đơn điều chỉnh/thay thế, vẫn cho phép điều chỉnh/thay thế hóa đơn của hệ thống khác, nên thông tin của hóa đơn gốc sẽ không validate, tuy nhiên, nếu hóa đơn k có, khi gửi sang CQT sẽ bị từ chối
Thời gian xử lý
Khi phát hành hóa đơn, lý tưởng là mỗi lần phát hành từ 20-30 hóa đơn (có ký số mỗi hóa đơn)/reuqest, hoặc tối đa 50 hóa đơn /request, request cần được xử lý tuần tự theo InvSeries, nên giãn cách 1-3s mỗi reuqest
Rate limit MISA đang nghiên cứu để việc thực hiện của đơn vị không gây ảnh hưởng lớn đến hệ thống, cũng như không quá ảnh hưởng tới việc phát hành hóa đơn của đơn vị, hiện tại chức năng này đang tắt, sẽ bật lại sớm trong thời gian tới, về tài liệu sẽ update số lượng cụ thể theo mỗi API hoặc sẽ có mô tả cụ thể hơn

Trân trọng, Phòng Tích hợp hệ thống.
```

## Đối chiếu từng câu với thiết kế bước 5 (đọc 03/10/2026)

| Câu hỏi | MISA trả lời | Nghĩa với Hubsell | Đã làm / còn chờ |
|---|---|---|---|
| 1. RefID của hóa đơn đã xóa bỏ | Không trả lời thẳng. Nói hóa đơn ĐÃ PHÁT HÀNH thì **không cho phép xóa**; sai thì bắt buộc xử lý sai sót (điều chỉnh / thay thế) | Ca "chủ shop xóa tờ đã phát hành rồi xuất lại" KHÔNG tồn tại trên production. Luật mã tham chiếu = mã đơn giữ nguyên. Tờ `IsDelete=true` mà `/invoice/status` trả về (đã gặp trên sandbox) chỉ còn là tờ chưa phát hành bị xóa hoặc tờ bị hủy | ✅ Không đổi mã. Ghi vào bảng khả năng (`cancelViaApi`, chú thích). Câu 1c (tra RefID của tờ đã xóa ra gì) chưa có trả lời, mã đã đỡ cả hai kiểu |
| 2. Độ trễ tra cứu theo RefID | Không cho con số. Nói phát hành xong **không cần** gọi trạng thái ngay vì câu trả lời của lệnh phát hành đã có đủ thông tin | Đúng với mã: lệnh phát hành thành công đọc số từ câu trả lời; chỉ tra ngược khi báo trùng hoặc chưa rõ kết quả. `settleSeconds` 60 giây VẪN là số tự chọn | ✅ Không đổi. Ghi nguồn vào bảng khả năng |
| 3. Mất kết nối giữa lúc phát hành, một RefID có sinh hai tờ không | "RefID là Key để check trùng hóa đơn", trùng "gần như sẽ không xảy ra"; muốn tránh rủi ro thì **gửi tuần tự, mỗi lệnh cách 1–3 giây** | MISA không cam kết tuyệt đối, nên chỉ mục duy nhất phía Hubsell (lát 2) và luật "gửi lại ĐÚNG mã cũ" (lát 5–6) giữ nguyên. Khoảng nghỉ 1 giây đã chốt 01/10 nay có căn cứ từ MISA | ✅ Lát 6c: thêm `publishGapMs` vào bảng khả năng (MISA = 1000), worker tự phát hành và nút phát hành hàng loạt nghỉ đủ khoảng này giữa hai tờ. Mã `Exception` / `CreateInvoiceDataError` vẫn coi là chưa rõ (anh Trung chốt 02/10; câu trả lời không nói gì khác) |
| 4. Điều chỉnh trỏ vào hóa đơn gốc không tồn tại | Production cũng **không kiểm** hóa đơn gốc (vì cho phép điều chỉnh / thay thế hóa đơn của hệ thống khác); gốc không có thì cơ quan thuế từ chối | Hubsell phải tự kiểm trước khi lập điều chỉnh — đúng việc lát 3 đã làm (`adjust-precheck.ts`) | ✅ Không đổi mã. Ghi nguồn vào bảng khả năng (`validatesAdjustmentOriginal`) |
| 5a. Thời gian xử lý, thời hạn chờ nên đặt | Không cho con số. Nói lý tưởng **mỗi lệnh 20–30 hóa đơn** (có ký số từng tờ), tối đa 50 tờ một lệnh, các lệnh tuần tự theo ký hiệu, cách 1–3 giây | Hubsell đang gửi MỘT tờ mỗi lệnh — an toàn nhưng chậm: mỗi ký hiệu cỡ 20–40 tờ một phút. Gom nhiều tờ một lệnh là việc của lát 8–9 (làn theo shop, hàng loạt chạy nền), cần hợp đồng adapter nhận lô. Thời hạn chờ 60 giây vẫn là số tự chọn | ⏳ Ghi vào sổ việc mục 7 của `HANG-DOI-BEN.md`; trình anh khi tới lát 8–9 |
| 5b. Hạn mức gọi API | **Đang tắt**, "sẽ bật lại sớm"; tài liệu sẽ ghi số theo từng API | Chưa có số để đặt trần. Khi MISA bật, lệnh bị vượt nhiều khả năng về HTTP 429 | ✅ Lát 6c: HTTP 429 xếp là lỗi TẠM (worker dừng lượt của shop, lượt sau thử lại, không ngắt mạch, không bảo chủ shop sửa gì), không phải "chưa rõ kết quả"; cửa gọi in `[NccHTTP] QUA TAI` kèm `Retry-After` nếu có. ⏳ Theo dõi tài liệu MISA để điền số |
| 6. Hủy / xóa qua API | Không trả lời. Chỉ nói hóa đơn đã phát hành không xóa được | `cancelViaApi` giữ `false` (mức an toàn) | ✅ Không đổi |

Điều MISA KHÔNG trả lời, không hỏi lại (ticket trước 19/09 cũng chỉ trả lời một lượt): số giây chắc chắn tra thấy sau khi lập; thời hạn chờ khuyến nghị; hạn mức cụ thể; hủy qua API. Ba số tự chọn (thời hạn chờ 60 giây, `settleSeconds` 60 giây, tuổi 5 phút trước khi tra lại) vẫn phải chỉnh theo số đo thật trên prod khi có shop phát hành.

## Nhật ký

- 03/10/2026 sáng: đọc trả lời (thư báo của MISA tới 02/10 15:34, anh Trung thấy 03/10 00:30, em đọc 03/10 ~08:00 qua IMAP). Chép nguyên văn + đối chiếu ở trên; sửa mã theo đó = lát 6c (`HANG-DOI-BEN.md` mục 4.6 N); anh Trung đẩy, trên prod từ 03/10 08:41 (`6ae0653`), đã kiểm web + worker + database.
- 02/10/2026: soạn ticket theo yêu cầu của anh Trung ("phần xóa thì viết ticket gửi MISA").
- 02/10/2026 ~14:35: ĐÃ GỬI qua developer.misa.vn → Quản lý ứng dụng → Quản lý danh sách yêu cầu hỗ trợ (ứng dụng Hubsell, sản phẩm Hóa đơn điện tử). Trạng thái "Chờ xử lý", "Chưa phản hồi". ĐỪNG gửi lại; có trả lời (kể cả "không có") thì chép nguyên văn vào đây và cập nhật bảng khả năng của MISA (`MISA_CAPABILITIES`). Ticket trước (19/09) MISA trả lời sau 2 ngày.
- Tự kiểm thêm trước khi gửi: mục Câu hỏi thường gặp trên developer.misa.vn chỉ ghi "MISA áp dụng giới hạn số lượng request theo phút/giờ tùy theo gói dịch vụ", không có con số.

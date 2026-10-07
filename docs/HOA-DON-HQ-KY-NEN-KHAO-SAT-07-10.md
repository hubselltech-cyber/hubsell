# Hóa đơn bán gói tự xuất — khảo sát lại vì sao eSign không ký được từ Hubsell, và hướng giải quyết

> Ngày 07/10/2026. Bối cảnh: luồng `hq-auto-invoice.ts` (PR #3–#5, LIVE 06/10) gọi cổng tích hợp
> meInvoice với `SignType 2`, prod trả `CallSignServiceFail` dù anh đã mở **Ký phiên** trên app
> MISA eSign. Phiên 06/10 nghi nguyên nhân gốc là "SignType 2 = HSM, không phải eSign" nhưng chưa
> đọc được tài liệu (môi trường chặn tên miền MISA). Hôm nay đọc được, kết luận bên dưới.
>
> **Trạng thái:** 📋 khảo sát xong, CHỜ ANH CHỐT hướng (mục 4). Chưa sửa code.

---

## 1. Kết luận ngắn

1. **Cổng tích hợp (ITG `developer.misa.vn/apis/itg/meinvoice`) KHÔNG ký được bằng MISA eSign.**
   `SignType 2` nghĩa là meInvoice tạo XML rồi gọi sang **máy chủ HSM của nhà cung cấp thứ ba** mà
   công ty đã khai trong *Hệ thống → Thiết lập ký số → Chữ ký số HSM* (SoftDreams/EasyCA, CyberLotus…).
   Sandbox 23/08 chạy được vì tài khoản thử của MISA có sẵn HSM thử. Tài khoản thật của Hubsell chỉ
   nối eSign → meInvoice không tìm thấy dịch vụ ký → `CallSignServiceFail`.
2. **MISA eSign chỉ ký được từ giao diện web meinvoice.vn.** Nút "Ký eSign & phát hành" của web gọi
   API **nội bộ** `app.meinvoice.vn/api/v2` (`POST v3invoice/code/publishesignincloud`, body
   `{ListRefId, InvDateComputer, Data, VerifyCode, CertificateSN}`) bằng phiên đăng nhập web — không
   phải cổng tích hợp, không có trong tài liệu dành cho đối tác, không dùng Bearer của ITG.
3. **Vì vậy luật "Chờ phiên ký eSign" làm hôm qua (PR #4) chỉ đúng một nửa:** không đốt lượt thử là
   đúng, nhưng lời nhắn "mở app bật Ký phiên rồi Thử lại" là sai hướng — bật phiên không thay đổi gì
   với lệnh gọi từ Hubsell. Thư nhắc HQ mỗi ngày về phiên ký cũng vô ích.
4. **Hướng đề xuất:** thuê **chứng thư số HSM** cho MST 0111626360 và khai vào meInvoice → giữ
   nguyên code (`SignType 2`), tự động 100%, không ai phải bấm gì mỗi ngày. Trong lúc chờ: xuất tay
   trên meinvoice.vn (eSign xác nhận trên điện thoại) rồi ghi số vào HQ, và sửa lời nhắn trong HQ cho
   đúng việc cần làm. Chi tiết và các hướng khác ở mục 3.

---

## 2. Bằng chứng (đọc ngày 07/10/2026)

| # | Nguồn | Nội dung chốt được |
|---|---|---|
| 1 | `doc.meinvoice.vn/api/Document/InvoicePublishHSM.html` (bộ api/v3, `/itg/invoicepublishing/publishhsm`) | Tiêu đề: *"Phát hành hóa đơn với chữ ký số HSM (softdream, cyber lotus)"*. Mô tả: *"dữ liệu sẽ được đẩy lên MISA và MISA sẽ tạo XML thô sau đó gọi qua máy chủ HSM của nhà cung cấp mà công ty đã đăng ký và đăng nhập trên…"*. → HSM = máy chủ ký của NCC thứ ba, không phải eSign. |
| 2 | `doc.meinvoice.vn/api/Document/InvoicePublishing.html` | Luồng không HSM của api/v3 là 2 bước: `createinvoice` trả XML thô → **khách tự ký XML** (tool MISA SignedService chạy trên máy Windows cắm USB token, port 12019–12023) → `invoicepublishing` gửi XML đã ký. Không có bước nào gọi eSign. |
| 3 | `app.meinvoice.vn/api/v2/Help` (controller `V3Invoice`, namespace `MISA.MEINVOICE.AppV2`) | Các route ký eSign/HSM/Viettel MySign đều nằm ở API nội bộ của web app: `v3invoice/code/publish/hsm`, `v3invoice/code/publish/esign`, `v3invoice/code/publishesignincloud`, `v3invoice/code/saveandpublish/esignV2`, `GET v3invoice/code/publish/esign/status?refID=`. Body `publishesignincloud` = `ListRefId[]` (tờ nháp đã có trên web) + `VerifyCode` + `CertificateSN`. `Common/SaveMisaESignSetting` lưu `{passCode, passCodeRequiration}` — tức VerifyCode là mã xác thực/passcode eSign của phiên web. |
| 4 | Dò cổng ITG không kèm token (`POST developer.misa.vn/apis/itg/meinvoice/...`) | `/invoice/publishing` → 400 (route có), `/invoice/publishing/token` → 400 (route có), `/invoice/publishing/esign`, `/invoice/publishing/hsm`, `/invoice/publishesignincloud` → **404** (không có route). |
| 5 | helpv4.meinvoice.vn — *Thiết lập ký số thông qua chữ ký số HSM* (cập nhật 29/09/2026) | Màn hình "Thiết lập kết nối đến máy chủ ký số": chọn *Nhà cung cấp dịch vụ HSM* (ảnh minh họa đang chọn **Cyber Lotus**), nhập *Mã ứng dụng (AppID)* + *Mã bảo mật (Secret Key)* do NCC cấp. Không cần xác nhận trên điện thoại. |
| 6 | helpv4 — *Đăng ký sử dụng song song 2 chữ ký số* | Dùng được đồng thời eSign + HSM: nối eSign → lập tờ khai → ngắt → nối HSM → **lập tờ khai thay đổi thông tin thêm chứng thư thứ hai** → ký gửi CQT; được duyệt thì chọn 1 trong 2 để ký. |
| 7 | helpv4 — *Thiết lập để chương trình tự động gửi HĐ máy tính tiền đến CQT với eSign hoặc HSM* | Chỉ hóa đơn **máy tính tiền** (ký sau, `SignType 5`) mới được meInvoice tự ký nền bằng eSign (cần Ký phiên 24h) hoặc HSM. Hóa đơn thường (ký hiệu `…T…` như `1C26THB` của Hubsell) ký tại lúc phát hành. |
| 8 | helpact.misa.vn — *Ký số HĐĐT từ xa với MISA eSign* | Mỗi lần ký eSign người ký mở app bấm Đồng ý; ký lô tối đa 50 tờ/lần xác nhận; Ký phiên 24h bỏ bước xác nhận. Không nói gì về ký qua API bên thứ ba. |
| 9 | Giá HSM (web công khai, chưa hỏi báo giá) | Viettel-CA HSM ký HĐĐT **880.000đ/năm** (sinvoice.vn; đang KM tới 15/10). EasyCA (SoftDreams) gói PRO 1 máy chủ/HSM **4.900.000đ/năm** (easyca.vn). CyberLotus chưa thấy giá công khai. |

---

## 3. Các hướng đã cân nhắc

| Hướng | Tự động? | Việc code | Chi phí | Rủi ro / nhược điểm | Kết luận |
|---|---|---|---|---|---|
| **A. Thuê HSM, khai vào meInvoice, giữ `SignType 2`** | 100%, không ai bấm gì | **0** (đúng luồng sandbox 23/08 đã chạy). Chỉ bật lại công tắc + Kiểm tra kết nối | 880k–4,9tr/năm tùy NCC + có thể phí khởi tạo; tờ khai thay đổi (anh ký USB token, xác nhận eTax Mobile như lần đầu) | Phải chắc meInvoice nhận NCC định mua (ảnh tài liệu chỉ thấy Cyber Lotus; bộ api/v3 ghi SoftDreams + CyberLotus; **Viettel chưa chắc**). HSM là chứng thư thứ hai của công ty, kế toán cần biết | ✅ **ĐỀ XUẤT** |
| B. Gọi API nội bộ web app (`publishesignincloud`) bằng tài khoản web + passcode eSign | Chỉ khi anh đang mở Ký phiên (24h) | Lớn: giả lập đăng nhập web, tạo nháp bằng `saveandpublish/esignV2` (payload `V3Invoice` nội bộ), đoán ngữ nghĩa `VerifyCode`/`CertificateSN`, không có tài liệu, không sandbox (eSign không có sandbox) | 0 | API nội bộ đổi không báo trước; dễ bị coi là lạm dụng tài khoản; vẫn phải bật phiên mỗi ngày; lỗi là tờ thật đi CQT | ❌ Không làm |
| C. Tự ký XML bằng eSign Open API (`/esign/v1/signing/hash`) rồi gửi `/invoice/publishing/token` | Chỉ khi có phiên ký, và CHƯA RÕ phiên ký có áp cho yêu cầu từ API không | Rất lớn: dựng XMLDSig (c14n, digest, enveloped) đúng chuẩn CQT; luồng `/publishing/token` chưa từng thử; eSign Open API chưa từng gọi thật | 0 | Nhiều điểm chưa biết, sai một ly là XML bị `InvalidSignature`; vẫn lệ thuộc điện thoại anh | ❌ Không làm |
| D. Chuyển hóa đơn Hubsell sang **máy tính tiền** (`SignType 5`, meInvoice tự ký sau) | Có, nhưng với eSign vẫn cần Ký phiên hằng ngày; với HSM thì quay về A | Vừa: đã có `misa-pos.ts`; đăng ký lại tờ khai + mẫu `…M…` | 0 | Hubsell bán phần mềm cho shop (B2B), không chắc thuộc diện "bán trực tiếp người tiêu dùng" của NĐ 70/2025 — rủi ro pháp lý, đổi mẫu hóa đơn đã đăng ký | ❌ Không làm |
| E. Xuất tay trên meinvoice.vn (eSign xác nhận trên điện thoại), ghi số vào HQ | Không | Nhỏ: sửa lời nhắn + nút hướng dẫn | 0 | 1–2 phút/tờ; hiện ~1 khách/ngày nên chịu được vài tuần | ✅ **Tạm thời**, cho tới khi A xong |

**Vì sao không giữ eSign làm lâu dài:** eSign là chữ ký "có người bấm", MISA thiết kế cho kế toán ký
trên điện thoại. Mọi cách ép nó ký nền đều phải đi qua Ký phiên 24h → anh phải bật mỗi ngày, hóa đơn
ngoài phiên nằm chờ. Mục tiêu anh chốt 06/10 là *"bấm là xong, tự gửi mail cho khách"* — chỉ HSM đạt.
Gói eSign đã mua (1,35tr/năm, chứng thư hiệu lực 06/10/2027) không bỏ phí: vẫn dùng ký tờ khai thuế
trên eTax, ký hợp đồng, và là chứng thư dự phòng khi HSM sự cố (tài liệu 6 cho phép 2 chứng thư).

---

## 4. Việc cần anh quyết / làm tay

1. **Chốt hướng A (HSM)?** Nếu gật, em soạn sẵn câu hỏi báo giá; anh chọn NCC.
2. **Mở app.meinvoice.vn → Hệ thống → Thiết lập ký số → Chữ ký số HSM → Kết nối ngay → bấm thả
   danh sách "Nhà cung cấp dịch vụ HSM"** và chụp cho em: cần biết có **Viettel-CA** không (880k/năm)
   hay chỉ SoftDreams/CyberLotus. 10 giây, quyết định chênh ~4tr/năm.
3. **Gửi ticket MISA** (mục 5) để có câu trả lời chính thức, phòng khi cổng tích hợp có cách ký eSign
   mà tài liệu công khai không ghi. Gửi song song với việc hỏi giá HSM, không chờ nhau.
4. **Khách đã mua gói từ 06/10 tới khi HSM xong:** xuất tay trên meinvoice.vn (dòng "Phí dịch vụ phần
   mềm Hubsell — gói X, N tháng", KCT), gửi PDF từ meInvoice, rồi vào HQ → Sổ quỹ → dòng thu → **Đã
   xuất + số HĐ**. Dòng đã ghi Đã xuất thì worker không chạm (không có mã tra cứu).

## 5. Việc em làm ngay khi anh gật (code nhỏ, 1 PR)

1. `hq-auto-invoice.ts`: đổi `SIGN_SESSION_MESSAGE` thành *"Cổng tích hợp meInvoice chưa ký nền được
   (tài khoản chỉ nối eSign, cần HSM). Xuất tay trên meinvoice.vn rồi ghi số HĐ vào dòng này."* — vẫn
   là trạng thái chờ, không đốt lượt. Thư nhắc HQ hằng ngày về "phiên ký": đổi nội dung tương tự và
   gửi **một lần** thay vì mỗi ngày (hoặc tắt hẳn tới khi HSM xong — anh chọn).
2. HQ → meInvoice: cạnh công tắc *Tự xuất* thêm dòng cảnh báo khi phương thức ký là `ESIGN_CLOUD`:
   *"eSign không ký nền được qua cổng tích hợp — cần HSM"* (thay dòng cảnh báo USB token hiện có).
3. Sửa chú thích sai trong `misa-einvoice.ts` (`SignType 2 ← MISA eSign`) thành HSM của NCC thứ ba,
   để phiên sau không lặp lại nhầm lẫn này.
4. Khi HSM nối xong: anh bấm *Kiểm tra kết nối* + *Thử lại* trên một dòng chờ. Không cần sửa code
   phát hành.

---

## 6. Ticket gửi MISA (developer.misa.vn → Quản lý ứng dụng → Ticket hỗ trợ; dự phòng integration@misa.com.vn / 19008677)

**Tiêu đề:** `[Hubsell] Cổng tích hợp meInvoice có hỗ trợ ký số bằng MISA eSign không? Danh sách HSM được hỗ trợ`

```
Kính gửi Phòng Tích hợp hệ thống MISA,

Tôi là Nguyễn Trung Hiếu, chủ tài khoản Developer của ứng dụng "Hubsell"
(app id 019f9d4c-da7e-7234-8e3c-6b17e595f6e0). Công ty TNHH Công nghệ Hubsell
(MST 0111626360) đã mua meInvoice + MISA eSign, tờ khai ĐKTĐ00001 được CQT chấp
nhận ngày 06/10/2026, và đang phát hành hóa đơn qua cổng tích hợp
POST /apis/itg/meinvoice/invoice/publishing với SignType = 2.

Kết quả: mọi lệnh phát hành trả ErrorCode "CallSignServiceFail", kể cả khi app
MISA eSign đang mở Ký phiên. Trên app.meinvoice.vn không thấy tờ nháp nào được tạo.

Xin MISA xác nhận giúp:
1. Cổng tích hợp (API REFERENCE trên developer.misa.vn) có hỗ trợ ký số bằng
   chữ ký số từ xa MISA eSign không? Nếu có, cần SignType nào, thiết lập gì
   trên meInvoice, và có cần Ký phiên trên app không?
2. Nếu SignType 2 chỉ dành cho máy chủ HSM: meInvoice hiện nhận HSM của những
   nhà cung cấp nào (SoftDreams/EasyCA, CyberLotus, Viettel-CA, VNPT-CA…)?
3. Gói MISA eSign đã mua ngày 06/10/2026 có thể đổi sang chứng thư số HSM do
   MISA cung cấp/phân phối không? Nếu có, xin báo giá.

Trân trọng cảm ơn.
Nguyễn Trung Hiếu — dev@hubsell.tech — 0965863292
```

**Trả lời của MISA:** _(chưa có — ghi nguyên văn vào đây khi nhận)_

---

## 8. BỔ SUNG 07/10 tối — hướng F KHÔNG TỐN THÊM TIỀN: Hubsell lập tờ chưa ký, anh ký eSign hàng loạt trên web

Anh phản đối chi thêm cho HSM sau khi vừa mua eSign (đúng: lỗi khảo sát 06/10 là của em). Em thử
ngay trên sandbox (`backend/scripts/misa-draft-probe.ts`, MST sandbox `0101243150-732`):

| Lệnh | Kết quả |
|---|---|
| `POST /invoice/publishing/token` với `SignType 1` | **HTTP 200, Success=true**, `CreateInvoiceResult`: RefID `HUBSELL-DRAFT-1791382606903`, `TransactionID JXF_CKQ77ENP`, **InvNo 00000178** (số cấp ngay), `InvoiceData` = XML `<HDon>` chưa có chữ ký (`DSCKS` trống). |
| `POST /invoice/publishing` với `SignType 1` | `APINotSupportTypeInvoice` — *"Không hỗ trợ giá trị SignType = 1 (tham khảo API /publishing/token)"* (như đã biết 23/08). |
| `/invoice/status` theo RefID và TransactionID, `/invoice/paging` 06–08/10 | Tờ 00000178 **không** nằm trong danh sách đã phát hành (trang chỉ có 172–177) → MISA giữ tờ ở trạng thái chưa ký/chưa phát hành. |

**Ý nghĩa:** Hubsell tạo được tờ hóa đơn đầy đủ dữ liệu trên meInvoice mà không cần ký. Phần còn lại
là anh vào meinvoice.vn → Hóa đơn → chọn các tờ chờ ký → **Ký eSign & phát hành** (một lần xác nhận
trên điện thoại cho tới 50 tờ, hoặc bật Ký phiên). Bước 2 của luồng hiện có (`getInvoiceStatuses`
theo TransactionID → điền số → tải PDF → gửi mail khách) chạy nguyên, vì tờ sau khi ký có cùng
TransactionID. Không phải nhập tay, không mua thêm gì.

**Điều CHƯA kiểm được từ môi trường này (cần anh, 1 phút):** đăng nhập app.meinvoice.vn bằng tài
khoản **sandbox** (dòng `MISA_USERNAME`/`MISA_PASSWORD` trong `backend/.env`), vào Hóa đơn → mục
*Chưa phát hành* (hoặc *Chờ ký*), xem có tờ **00000178** ký hiệu 1K26TYY ngày 07/10 không và nút ký
hiện gì. Thấy tờ đó là hướng F chắc chắn chạy được.

**Việc code nếu F chạy được (nhỏ, 1 PR):**
1. `misa-einvoice.ts`: thêm `createUnsignedInvoice()` gọi `/invoice/publishing/token` (payload y hệt,
   `SignType 1`), trả `{transactionId, invoiceNo}`.
2. `hq-auto-invoice.ts`: `signMethod = ESIGN_CLOUD` → bước 1 dùng hàm trên, ghi TransactionID + số,
   trạng thái vàng *"Chờ anh ký eSign trên meinvoice.vn"*; bước 2 giữ nguyên (poll trạng thái → PDF →
   mail). HSM thật (nếu có sau này) mới dùng `SignType 2`.
3. Thư nhắc HQ: gửi khi có tờ chờ ký quá N giờ, nội dung đúng việc cần làm. Lưu ý thuế: hóa đơn
   dịch vụ phải lập lúc hoàn thành/thu tiền, nên anh nên ký trong ngày (ví dụ 1 lần cuối ngày).
4. Lời nhắn chờ phiên ký (PR #4) đổi thành lời nhắn này; chú thích `SignType 2 ← eSign` sửa lại.

Hướng A (HSM) giữ làm phương án **sau**, chỉ khi số hóa đơn/ngày tăng tới mức ký tay 1 lần/ngày
thành gánh nặng, hoặc muốn khách nhận hóa đơn ngay trong phút.

## 9. Phân biệt hai tài khoản (anh hỏi "HB chứ YY cái gì")

| | Tài khoản THẬT của Hubsell | Tài khoản SANDBOX của MISA |
|---|---|---|
| Pháp nhân | CÔNG TY TNHH CÔNG NGHỆ HUBSELL, MST 0111626360 | Công ty cổ phần MISA(sandbox)-Meinvoice 02, MST 0101243150-732 |
| Ký hiệu hóa đơn | **1C26THB** (GTGT, **có mã CQT**, anh đăng ký 06/10) | 1K26TYY (GTGT, không mã — MISA cấp sẵn để thử API) |
| Chữ ký | MISA eSign (chứng thư 54010C6A…A0AC) | HSM thử của MISA |
| Ai dùng | HQ prod (cấu hình lưu trong HQ → meInvoice) | Chỉ script thử từ máy dev (`backend/.env`) |
| Tờ 00000178 | KHÔNG có ở đây | Có, lập thử 07/10 bằng `/invoice/publishing/token` |

Mọi hóa đơn thật đều mang 1C26THB. Số "YY" chỉ xuất hiện trong bài thử trên sandbox. Hai điểm hướng F
**chưa thử được** vì sandbox không có ký hiệu có mã và em không đăng nhập web được: (1) `/publishing/token`
với ký hiệu **có mã** `1C26THB` có chạy giống không; (2) tờ chưa ký có hiện ở Hóa đơn → Lọc → Trạng thái
HĐ = Chưa phát hành không. Cách kiểm sạch nhất: lập MỘT tờ thật cho khoản thu đang chờ (khách Hiển)
trên tài khoản thật khi anh gật, rồi anh ký eSign ngay trên web.

## 10. Hướng F ĐÃ CODE (07/10 tối, nhánh `claude/hq-esign-lap-to-chua-ky`)

- `backend/src/integrations/invoice/misa-einvoice.ts`: `postItgPublish()` dùng chung; `createUnsignedInvoice()`
  gọi `/invoice/publishing/token` (SignType 1), đọc `CreateInvoiceResult`; chú thích SignType sửa đúng;
  `MISA_SIGN_TYPE.HSM`; `misaSignType("HSM") = 2`.
- `hq-auto-invoice.ts`: `ESIGN_CLOUD` → lập tờ chưa ký, giữ TransactionID, **không ghi số** cho tới khi
  `/invoice/status` trả `PublishStatus ≠ 0`; trạng thái chờ `Chờ anh ký eSign trên meinvoice.vn…` không
  đốt lượt; `CallSignServiceFail` → "Chờ dịch vụ ký nền" (HSM chưa khai).
- `workers/hq-invoice-auto.ts`: thư nhắc 1 lần/ngày với lời đúng việc (link meinvoice.vn).
- HQ UI `hq-invoice.tsx`: phương thức ký = MISA eSign (ký theo lô trên web) / HSM / USB; route nhận `HSM`.
- Test: `hq-auto-invoice-db.test.ts` thêm ca eSign (lập tờ → chờ → PublishStatus 0 vẫn chờ → 1 → ISSUED + mail,
  không gọi SignType 2); 29/29 xanh.
- **Chưa chạy thật trên tài khoản Hubsell.** Việc anh sau khi gộp: HQ → meInvoice chọn *MISA eSign*, lưu →
  Sổ quỹ → dòng khách Hiển → Thử lại → meinvoice.vn → Hóa đơn → Lọc → Chưa phát hành → Phát hành.
- **Việc sau:** luồng tenant (`misa-provider.ts`) vẫn gọi SignType 2 cho `ESIGN_CLOUD` — shop dùng eSign sẽ
  gặp cùng lỗi; chuyển sang lập tờ chưa ký + ký trên web khi HQ chạy ổn.

## 11. HƯỚNG F THẤT BẠI khi chạy thật (07/10 đêm) — đã lùi về "Chờ xuất tay"

Trên tài khoản thật: Thử lại ra nhãn vàng (có mã tra cứu) nhưng meinvoice.vn **không có tờ nào**, kể cả
bỏ hết bộ lọc. Kiểm lại sandbox (`misa-draft-probe-4`, kết quả):

| Lệnh | Kết quả | Nghĩa |
|---|---|---|
| `/invoice/status` theo RefID và TransactionID của tờ token lúc nãy | `[]` | MISA không có bản ghi |
| Gọi lại `/publishing/token` CÙNG RefID | InvNo 00000178, TransactionID **khác** (`7NFQCJ86KLN0`) | không có gì được lưu, chỉ dựng XML + số dự kiến |
| Phát hành thật SignType 2, RefID mới | **InvNo 00000178** | số KHÔNG bị tờ token chiếm |
| Phát hành SignType 2 cùng RefID tờ token | InvNo 00000179, thành công | RefID cũng không bị giữ |

**Kết luận chắc:** `/invoice/publishing/token` là bước 1 của luồng "phần mềm tự ký" (createinvoice → client ký
XML bằng MISA SignedService/USB → gửi lại). Nó **không lưu gì**, không có "tờ chưa ký" nào trên web cho eSign
ký. Giả định "tờ sẽ hiện ở Chưa phát hành" của em ở mục 8 là sai và chưa được kiểm trước khi đưa lên prod —
lỗi em. Không gây hậu quả bên MISA (không số, không tờ); bên HQ dòng khách Hiển dính một mã tra cứu "ma".

**Đã sửa (cùng đêm):** `ESIGN_CLOUD` → máy KHÔNG gọi MISA, treo *"Chờ xuất tay trên meinvoice.vn"* (không đốt
lượt); bước 2 thấy mã tra cứu mà `/invoice/status` rỗng thì xóa mã (tự dọn dòng khách Hiển); worker nhắc
1 thư/ngày "N khoản thu chờ xuất hóa đơn"; HQ UI ghi rõ eSign = xuất tay, chỉ HSM tự động.
`createUnsignedInvoice()` giữ lại với chú thích đúng (viên gạch cho luồng tự ký XML sau này).

**Còn lại để tự động hóa thật sự (chọn một, không gấp):**
- **HSM** (hướng A, mục 3): không đổi code, ~880k–4,9tr/năm tùy NCC meInvoice nhận.
- **Tự ký XML bằng eSign Open API** (hướng C): dựng XMLDSig từ XML của `/publishing/token`, ký hash qua
  `/esign/v1/signing/hash` (anh xác nhận trên app hoặc Ký phiên 24h), gửi lại qua cổng token. Nhiều ẩn số,
  cần 1–2 ngày thử trên sandbox + tài khoản eSign thật (eSign không có sandbox).
- Trước mắt: xuất tay trên web khi có khách (hiện ~1 tờ/ngày), HQ nhắc.

## 7. Nhật ký

- **07/10/2026:** đọc được tài liệu MISA (môi trường đã mở 4 tên miền). Chốt nguyên nhân gốc: ITG
  `SignType 2` = HSM nhà cung cấp thứ ba; eSign chỉ ký từ web. Đề xuất hướng A (HSM). Chưa sửa code,
  chờ anh chốt.

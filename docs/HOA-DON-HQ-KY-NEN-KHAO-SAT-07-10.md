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

## 6. Ticket gửi MISA (viết lại 07/10 đêm sau khi thử thật; anh dán vào developer.misa.vn → Quản lý ứng dụng → Ticket hỗ trợ; dự phòng integration@misa.com.vn / 19008677)

**Tiêu đề:** `[Hubsell] Đã mua meInvoice + MISA eSign — cổng tích hợp Open API ký tự động bằng eSign cách nào?`

```
Kính gửi Phòng Tích hợp hệ thống MISA,

Tôi là Nguyễn Trung Hiếu, chủ tài khoản Developer của ứng dụng "Hubsell"
(app id 019f9d4c-da7e-7234-8e3c-6b17e595f6e0). Công ty TNHH Công nghệ Hubsell
(MST 0111626360) ngày 06/10/2026 đã mua meInvoice và chữ ký số từ xa MISA eSign
(chứng thư 54010C6A…A0AC), tờ khai ĐKTĐ00001 được CQT chấp nhận, ký hiệu 1C26THB,
eSign đã kết nối trong Hệ thống → Thiết lập ký số và ký tay trên web được bình thường.

Mục tiêu: phần mềm Hubsell gọi Open API để PHÁT HÀNH HÓA ĐƠN KÝ BẰNG eSign
TỰ ĐỘNG khi khách thanh toán, không phải vào web bấm. Chúng tôi đã thử:

1. POST /apis/itg/meinvoice/invoice/publishing, SignType = 2
   → ErrorCode "CallSignServiceFail" (kể cả khi app eSign đang mở Ký phiên).
   Tài liệu doc.meinvoice.vn/api/Document/InvoicePublishHSM.html ghi SignType 2 gọi
   "máy chủ HSM của nhà cung cấp (softdream, cyber lotus)" — không phải eSign.
2. POST /apis/itg/meinvoice/invoice/publishing/token, SignType = 1
   → trả InvNo + TransactionID + XML chưa ký, nhưng meInvoice KHÔNG lưu tờ nào
   (gọi lại cùng RefID ra TransactionID khác, tra /invoice/status rỗng, không hiện
   trên web) — chỉ dành cho phần mềm tự ký bằng USB/SignedService rồi gửi lại.
3. Trên web app.meinvoice.vn có API nội bộ v3invoice/code/publishesignincloud
   (ký eSign và phát hành trên cloud) nhưng không nằm trong Open API của đối tác.

Xin MISA trả lời cụ thể:

Câu 1. Với tài khoản ĐÃ có meInvoice + MISA eSign như trên, ứng dụng tích hợp
qua Open API phát hành hóa đơn ký bằng eSign bằng endpoint nào, SignType nào,
cần thiết lập gì thêm, và có cần Ký phiên trên app không? Xin kèm ví dụ request.

Câu 2. Nếu Open API hiện CHƯA hỗ trợ ký bằng eSign: MISA có lộ trình mở không,
dự kiến khi nào? Trong lúc chờ, meInvoice nhận máy chủ HSM của những nhà cung
cấp nào (SoftDreams, CyberLotus, Viettel-CA, VNPT-CA…)?

Câu 3. Gói eSign mua ngày 06/10/2026 có chuyển sang chứng thư số HSM (do MISA
cung cấp hoặc phân phối) được không? Nếu có, xin báo giá và cách làm.

Chúng tôi đã đầu tư meInvoice + eSign đúng theo tư vấn "ký số mọi lúc mọi nơi,
không cần USB"; mong MISA chỉ rõ cách để ứng dụng tích hợp dùng được chữ ký đó.

Trân trọng cảm ơn.
Nguyễn Trung Hiếu — dev@hubsell.tech — 0965863292
```

**Trạng thái:** ✅ ĐÃ GỬI 07/10/2026 ~21:50 qua developer.misa.vn → Quản lý ứng dụng → Quản lý danh sách yêu
cầu hỗ trợ (em gửi bằng Chrome của anh, anh đăng nhập MISA ID; sản phẩm "Hóa đơn điện tử"; có thêm đoạn lưu ý
Hubsell xuất hóa đơn cho cả shop khách hàng qua cùng cổng). Danh sách hiện 4 ticket, ticket này "Chờ xử lý".
Ticket trước (02/10) được trả lời sau ~2 ngày → kiểm lại từ 09/10 ở cùng trang hoặc mail dev@hubsell.tech.

**Bổ sung câu 4 (gửi 07/10 ~22:35, trong cùng ticket, sau khi anh hỏi "sao BigSeller nối được MISA"):**
đối chiếu tài liệu BigSeller (help.bigseller.pro "Introduction to MISA meInvoice", 07/05/2025): BigSeller chỉ
**đẩy dữ liệu** hóa đơn sang meInvoice (To Push → Pushing → Push Successfully/Failed), cột Invoice Number
trống, "xóa trên BigSeller cũng xóa bên MISA" → tờ nằm ở **Chưa phát hành**, chủ shop vào meInvoice ký
(USB/eSign/HSM) và phát hành; không chỗ nào nhắc chữ ký số. Cùng mô hình MISA eShop/KiotViet ("hóa đơn chưa
phát hành → ký khi phát hành"). Câu 4 hỏi MISA: Open API có endpoint **lưu hóa đơn chưa phát hành** không
(`/publishing/token` không lưu); nếu chỉ cấp cho đối tác thì thủ tục xin cấp cho Hubsell.

**Trả lời của MISA:** _(chưa có — ghi nguyên văn vào đây khi nhận, kèm ngày giờ)_

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

## 12. ★ TÌM THẤY API LƯU TỜ NHÁP TRÊN CỔNG developer.misa.vn (07/10 đêm) — THỬ SANDBOX THÀNH CÔNG

Anh hỏi "sao BigSeller nối được MISA" → em vào cổng developer bằng Chrome của anh (đăng nhập MISA ID), mục
lục tài liệu meInvoice **đã có thêm** so với bản đọc 07/08:

- USE CASES: *Phát hành hóa đơn lên cloud* · *Phát hành hóa đơn lên Cloud (ký số bằng USB token)* ·
  **Đẩy hóa đơn nháp lên web app Meinvoice**.
- API REFERENCE nhóm **API WEB APP (HÓA ĐƠN NHÁP)**: `POST /invoiceweb/token` · `POST /invoiceweb/templates`
  · **`POST /invoiceweb/insert`** ("đẩy hóa đơn nháp — hóa đơn thô, chưa ký điện tử — lên meinvoice web", lô ≤30,
  chống trùng RefID, xem tại app3.meinvoice.vn/v3/hoa-don) · `DELETE /invoiceweb/delete?invoiceWithCode&refid`
  (chỉ xóa tờ Chưa phát hành) · `POST /invoiceweb/getlist?invoiceWithCode` (≤50 RefID, trả số HĐ + mã tra cứu
  sau khi tờ được phát hành trên web) · `POST /invoiceweb/paging` · `/invoiceweb/paging/calculating`.
- Nhóm **PHÁT HÀNH HÓA ĐƠN KÝ BẰNG USB TOKEN/FILE** (mô hình Salework): `/invoice/publishing/token` SignType 1
  → XML thô → tool **MISA SignedService** trên máy có USB (`http://<máy>:12019/api/SignXML`, body
  `{PinCode, XmlContent}`) → `/invoice/publishing/token` lần 2 với `PublishInvoiceData[{RefID, TransactionID,
  InvSeries, InvoiceData=XML đã ký}]`. Giải thích vì sao lệnh token hôm nay "không lưu gì": nó chỉ là bước 1.

**Đây chính là API BigSeller/KiotViet dùng.** Câu 4 trong ticket MISA coi như đã có đáp án (vẫn để MISA trả lời cho
chắc, nhất là câu 1–3).

**Thử sandbox (`backend/scripts/misa-invoiceweb-probe*.ts`, MST 0101243150-732):**

| Bước | Kết quả |
|---|---|
| `POST /invoiceweb/token` header `ClientID` + `ClientSecret`, body `{TaxCode, UserName, Password}` | 200, `Data` là **JSON string** `{access_token, token_type, expires_in, UserID, OrganizationUnitID, UserName, CompanyID}` — phải parse rồi lấy `access_token` (dùng nguyên chuỗi Data → 401 UnAuthorize) |
| `POST /invoiceweb/templates?invoiceWithCode=false` header `ClientID`, body `{TypeInvoice:0, TaxCode, UserName, Password}` | 200, 2 mẫu: `1K26TYY` (IPTemplateID `d5c90289-…`), `2K26TYY` |
| `POST /invoiceweb/insert` header `ClientID` + `Authorization: Bearer <access_token>` + `TaxCode` | **200 Success=true**, Data `[{RefID, InvSeries, InvDate, EInvoiceStatus:1}]` — tờ nháp 99.000đ KCT (VATRate -1) RefID `ad24f160-ec7b-432e-a044-049e14419d9d` |
| `POST /invoiceweb/getlist?invoiceWithCode=false` body `[RefID]` | 200, 1 dòng: `InvNo "<Chưa cấp số>"`, `TransactionID null`, **`PublishStatus 0`**, `EInvoiceStatus 1`, đúng tên khách + 99.000 |
| `POST /invoiceweb/paging?invoiceWithCode=false` body `{pageIndex, pageSize, fromDate, toDate}` | 200, thấy tờ nháp (CompanyID 66465) |
| `DELETE /invoiceweb/delete?invoiceWithCode=false&refid=…` | 200 Success=true; `getlist` sau đó rỗng → xóa nháp sạch |

→ **Trọn vòng đời tờ nháp chạy được trên sandbox.** Việc còn lại để chứng minh end-to-end là ký trên web
(sandbox không có eSign; làm trên tài khoản thật của anh với tờ khách Hiển).

**Khác biệt payload so với cổng phát hành:** tên trường kiểu web (`AccountObjectName/TaxCode/Address`,
`ContactName`, `InvoiceDetails[]` với `Description`, `VATRate` số nguyên: -1 KCT, -3 KKKNT, 0/5/8/10, null = KHAC),
cần `InvoiceTemplateID` từ `/invoiceweb/templates`, `CreatedDate/ModifiedDate`, `EInvoiceStatus` 1/3/4,
`CustomField1..10` (BigSeller nhét mã đơn/mã vận đơn/kênh vào đây).

**Kế hoạch code (sáng 08/10):** `misa-invoiceweb.ts` (token cache theo shop + 4 hàm) → HQ: `ESIGN_CLOUD`/`USB_TOKEN`
→ `insert` tờ nháp, trạng thái "Chờ anh ký trên meinvoice.vn → Lọc → Chưa phát hành → Phát hành", bước 2 poll
`getlist` theo RefID tới khi có `InvNo` + `TransactionID` → tải PDF (`/invoice/Download` theo TransactionID) → mail.
Tenant (`misa-provider.ts`) đi cùng đường cho shop eSign/USB; shop HSM giữ SignType 2. Hủy/đổi ý trước khi ký →
`delete`. Test DB mock + thử thật tờ khách Hiển trên tài khoản anh (anh ký eSign trên web).

## 13. ✅ ĐÃ CODE LUỒNG TỜ NHÁP CHO HQ (07/10 đêm → 23:00, master local) — chờ anh gật rồi push + thử thật tờ khách Hiển

**Đọc lại tài liệu `/invoiceweb/insert` trên developer.misa.vn (Chrome anh) trước khi viết, chốt tên trường:**
người mua `AccountObjectName` / `AccountObjectTaxCode` / `AccountObjectAddress` / `CitizenIDNumber` (đơn vị) · `ContactName` (họ tên người mua) ·
`ReceiverEmail` / `ReceiverName` / `ReceiverMobile` · `PaymentMethod` (x) · `CurrencyCode` (x) · `ExchangeRate` (x) · `DiscountRate` (x) · bộ tổng
`TotalSaleAmountOC/TotalSaleAmount/TotalDiscount*/TotalVAT*/TotalAmount*` (x) · `CreatedDate`/`ModifiedDate` (x) · `EInvoiceStatus` 1 gốc / 3 thay thế / 4 điều chỉnh
(+ `OrgInvNo`, `OrgInvTemplateNo` = ký tự đầu, `OrgInvSeries` = 6 ký tự cuối, `OrgInvDate`, `ChangeReason`) · `BuyerOrderCode`/`BuyerSalesChannel`/`BuyerShopName` ·
`CustomField1..10`. Dòng: `InventoryItemType` 0 HHDV / 2 KM / 3 ghi chú / 4 CK dòng · `SortOrder` · `SortOrderView` · `Description` · **`UnitName` (x)** · `Quantity` ·
`UnitPrice` · `AmountOC/Amount` · `DiscountRate/DiscountAmountOC/DiscountAmount` · `VATRate` int? (x với HĐ VAT: -1 KCT · -3 KKKNT · 0/5/8/10 · null = app tự tính) ·
`VATAmountOC/VATAmount`. Công thức master = tổng dòng (TotalSaleAmountOC = Σ AmountOC loại 0; TotalAmountOC = sale − CK + VAT). `getlist` trả đúng đối tượng InvoiceData
(≤ 50 RefID), RefID không có trên web → không có dòng. `/invoiceweb/templates` body `TypeInvoice` 0 + TaxCode/UserName/Password, chỉ header ClientID (không Bearer).

**Thử sandbox bằng CHÍNH module mới (`backend/scripts/misa-invoiceweb-module-probe.ts`, 22:54):**

| Ca | Kết quả |
|---|---|
| GTGT 1K26TYY, dòng KCT 2.990.000, người mua có MST 0101243150 + địa chỉ + email | insert 200 → getlist thấy (PublishStatus 0, InvNo null, TransactionID null) → delete → rỗng ✅ |
| GTGT 1K26TYY, 10% bóc ngược (100.000 + 10.000), khách lẻ ContactName | ✅ như trên |
| BÁN HÀNG 2K26TYY, không gửi VATRate, thuế 0 | ✅ như trên |
| Gửi lại CÙNG RefID khi tờ còn chờ | MISA trả 200 nhưng getlist vẫn **1 dòng** → ghi đè, không nhân đôi (dù vậy code vẫn tra trước khi đẩy) |

**Code (test 39/39 xanh: `misa-invoiceweb.test.ts` 7 ca thuần + `hq-auto-invoice-db.test.ts` 9 ca DB mock + 23 ca thuần cũ; `tsc` BE/FE sạch, eslint sạch):**
- `backend/src/integrations/invoice/misa-invoiceweb.ts` (MỚI): `getWebAccessToken` (cache theo clientId|MST|username, parse Data JSON string, TTL theo expires_in),
  `listWebTemplates`/`findWebTemplate` (cache 1 giờ, báo rõ ký hiệu nào tài khoản có khi không khớp), `buildWebDraftPayload` (hàm thuần: đơn vị vs khách lẻ, email,
  KCT/-3, bán hàng không VATRate, quà tặng loại 2, điều chỉnh EInvoiceStatus 4 + Org*, CustomField1 = mã tham chiếu Hubsell), `insertWebDraft` (qua chốt
  MISA_ALLOW_PUBLISH), `getWebInvoices` (issued = có số + TransactionID + PublishStatus ≠ 0), `deleteWebDraft`, **`webRefIdFor` = UUID v5 ổn định** từ mã
  tham chiếu (tài liệu đòi GUID; không cần cột mới, gọi lại ra cùng RefID).
- `hq-auto-invoice.ts`: `usesWebDraft(ESIGN_CLOUD | USB_TOKEN)`; bước 1 → `settleHqWebDraft`: tra RefID → đã ký thì nối số + mã (chạy tiếp PDF + mail) · chưa có
  thì đẩy nháp · còn chờ thì để nguyên; hai ca sau ném lời nhắn **"Chờ anh ký trên meinvoice.vn: …"** (prefix `WEB_DRAFT_WAITING_PREFIX`, không đốt lượt, đã
  lưu snapshot người mua). Mã tra cứu "ma" cũ → bỏ mã, lượt sau đi lại bước 1. `cleanupHqWebDraft`: HQ đổi trạng thái hóa đơn tay (Không cần / Đã xuất) khi nháp
  còn chờ → xóa nháp (tờ đã ký không đụng).
- `issue-hq.ts`: dòng dịch vụ có `unitName: "Gói"` (web app bắt buộc ĐVT; cổng HSM cũng in ra — trước để trống).
- `routes/admin.ts`: nút xuất tay HQ với eSign/USB đi `settleHqWebDraft` (trả `webDraft: true` + lời nhắn); PATCH trạng thái hóa đơn → `cleanupHqWebDraft`.
- `workers/hq-invoice-auto.ts`: thư nhắc 1 lần/ngày đổi nội dung đúng việc (link app3 → lọc Chưa phát hành → Ký & phát hành theo lô, nhắc ký trong ngày).
- HQ UI `hq-invoice.tsx`: nhãn phương thức ký + đoạn giải thích + hộp vàng "bước ký vẫn là việc của người"; toast sau xuất tay. Nhãn vàng ở Sổ quỹ tự hiện vì
  prefix "Chờ ".

**Chưa làm (cố ý, lát sau):** luồng **tenant** (`misa-provider.ts` vẫn SignType 2 cho `ESIGN_CLOUD` → shop dùng eSign vẫn `CallSignServiceFail`); cần thêm cách
hỏi trạng thái theo RefID cho tờ nháp (vòng `checkStatuses` hiện theo TransactionID) — làm sau khi HQ chạy thật một tờ.

**Việc anh (sau khi gật):** `git push origin master` → Render deploy → HQ → meInvoice: phương thức ký **MISA eSign**, lưu → Sổ quỹ → dòng khách Hiển **Thử lại** →
nhãn "Chờ anh ký trên meinvoice.vn" → app3.meinvoice.vn/v3/hoa-don → lọc Chưa phát hành → thấy tờ 1C26THB (cột tham chiếu `HQLEDGER-…`) → kiểm số tiền/người
mua → **Ký & phát hành** (xác nhận eSign) → chờ ≤ 30' (hoặc bấm Thử lại) → dòng ISSUED có số + mail PDF về khách.

## 14. THỬ THẬT LẦN 1 (07/10 ~23:10) — tờ nháp LÊN ĐƯỢC tài khoản thật; anh chốt bổ sung SĐT + CCCD vào hồ sơ khách

- Sau khi push `48230c7`, anh bấm Thử lại dòng khách Hiển 99.000đ (gói Starter 1 tháng): lượt 1 chỉ dọn mã tra cứu "ma" (đã sửa `0e088ef` để
  dọn xong đi tiếp cùng lượt), lượt 2 đẩy nháp → **app3.meinvoice.vn hiện tờ 1C26THB ngày 07/10, 99.000, trạng thái "HĐ mới"**, mở ra thấy:
  Họ tên người mua Nguyễn Văn Hiển, email, dòng "Phí dịch vụ phần mềm Hubsell — gói Starter, 1 tháng (06/10/2026 – 06/11/2026)", ĐVT Gói,
  SL 1, 99.000, thuế KCT. Cột Khách hàng ở danh sách trống vì khách lẻ không có Tên đơn vị (bình thường). Có một dòng trống 0đ phía dưới —
  nhiều khả năng là dòng nhập tiếp của trình soạn web; nếu còn sau khi lưu thì xóa trước khi ký.
- **Quy định người mua cá nhân (tra 07/10):** NĐ 254/2026 (hiệu lực 01/07/2026, thay NĐ 123): cá nhân cung cấp tên/địa chỉ/số định danh thì
  ghi đủ; không cung cấp thì ghi "Bán cho người tiêu dùng"; hóa đơn kiểu người tiêu dùng không dùng hạch toán chi phí được. Tờ chỉ có tên là
  hợp lệ phía người bán.
- **Anh chốt:** lúc mua gói khách khai thông tin xuất hóa đơn; không khai = khách lẻ; khai gì thì tờ nháp phải mang đủ cái đó (kể cả SĐT —
  tài khoản có SĐT mà tờ không có là thiếu). Anh **xóa tờ nháp này** trên web để em đẩy lại tờ đủ thông tin sau khi sửa.
- **Đã sửa (commit kế tiếp):** `User.billingPhone` + `User.billingIdNumber` (migration `20261007230000_billing_phone_id_number`, migrate deploy
  lúc Render start); route `PUT /api/subscription/billing-profile` nhận `phone` (chuẩn hóa +84 → 0, 9–11 số) + `idNumber` (12 số, cần họ tên);
  thẻ "Thông tin xuất hóa đơn" ở /settings/plan thêm ô SĐT (trống = SĐT tài khoản) và ô CCCD (chỉ hiện khi không có MST);
  `composeHqBuyer` → `phone` = billingPhone ?? SĐT tài khoản (đổi dạng trong nước), `idNumber` = CCCD khách khai (khai CCCD cũng tính là hồ sơ
  khách); `CreateInvoiceInput.buyerPhone/buyerIdNumber` → payload web `ReceiverMobile` + `CitizenIDNumber`; xóa tài khoản xóa cả 6 trường billing.
  Cổng HSM (`buildStandardInvoicePayload`) CHƯA gửi SĐT/CCCD — tên trường ITG chưa tra, làm khi dùng HSM.
- **Luồng thử lại sau deploy:** anh đã xóa nháp → bấm Thử lại dòng Hiển → tờ mới có SĐT của Hiển (từ SĐT tài khoản) → ký. Hiển muốn ghi CCCD/MST
  thì tự khai ở Cấu hình → Gói dịch vụ, Hubsell không gọi điện thu hộ.

## 15. 🏆 HÓA ĐƠN THẬT ĐẦU TIÊN QUA LUỒNG TỜ NHÁP (07/10 ~23:45–23:50)

- Sau deploy `4001f9a`: anh bấm Thử lại dòng Hiển → tờ nháp mới (có SĐT) → anh mở hộp Phát hành trên meinvoice (bỏ tích "Gửi hóa đơn cho
  khách hàng" theo lời khuyên của em, giữ "Gửi CQT cấp mã", ký eSign) → **HĐ 1C26THB số 00000001, mã CQT `00D1A1C1091084491CABECCEB8B6F09E42`,
  mã tra cứu `Z4FDCAKXZWK0`**, danh sách chỉ có đúng một tờ (không bị nhân đôi dù máy có lượt đẩy lại).
- Sổ quỹ HQ sau lượt Thử lại kế: **Đã xuất · 00000001 · Đã gửi hiennv.th@gmail.com lúc 23:49:15** → bước nối số + gửi PDF chạy thật.
- Hộp Phát hành meInvoice: có email trên tờ là nó tự tích "Gửi hóa đơn cho khách hàng" (mail MISA không kèm PDF, khách phải bấm Tra cứu);
  "Tệp đính kèm" là chỗ gắn thêm file (hợp đồng, bảng kê), không phải PDF hóa đơn. **Chốt: Hubsell là bên gửi duy nhất** → tờ nháp KHÔNG mang
  `ReceiverEmail` nữa (sửa cùng commit), email khách vẫn ở Hubsell để gửi PDF + gửi lại.
- Thêm lưới đỡ ở `settleHqWebDraft`: web app không thấy RefID → hỏi `/invoice/status?inputType=2` theo RefID trước khi đẩy nháp mới (tờ đã ký
  nằm ở cổng phát hành) — tránh đẩy nháp trùng cho khoản thu đã có hóa đơn.
- Anh chốt thêm: HQ **không** làm ô ghi đè người mua; cần sửa thì sửa thẳng trên tờ nháp ở meinvoice trước khi ký.

## 7. Nhật ký

- **07/10/2026 đêm (23:00):** code xong luồng tờ nháp HQ (mục 13), sandbox 3 ca OK, test 39/39; chờ anh gật push + thử thật tờ khách Hiển.
- **07/10/2026:** đọc được tài liệu MISA (môi trường đã mở 4 tên miền). Chốt nguyên nhân gốc: ITG
  `SignType 2` = HSM nhà cung cấp thứ ba; eSign chỉ ký từ web. Đề xuất hướng A (HSM). Chưa sửa code,
  chờ anh chốt.
